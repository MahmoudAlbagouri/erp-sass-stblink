// src/modules/notifications/listeners/operations.listener.ts
// العمليات اليومية: تحويلات المخزون بين الفروع، وفروق درج الكاشير.
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PERMS } from '../../../common/constants/permissions';
import type { DomainEventMap } from '../../../common/events/domain-events';
import { Audience } from '../notification-audience.service';
import { NotificationLookupService } from '../notification-lookup.service';
import { NotifierService } from '../notifier.service';

const EVENT = { async: true } as const;

@Injectable()
export class OperationsListener {
  constructor(
    private readonly notifier: NotifierService,
    private readonly lookup: NotificationLookupService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** تحويل خرج: يصل لمن يستلم في فرع المخزن المستلِم */
  @OnEvent('stock.transfer_sent', EVENT)
  async onTransferSent(
    e: DomainEventMap['stock.transfer_sent'],
  ): Promise<void> {
    const [from, to] = await Promise.all([
      this.lookup.warehouse(e.tenantId, e.fromWarehouseId),
      this.lookup.warehouse(e.tenantId, e.toWarehouseId),
    ]);
    if (!from || !to) return;
    const by = await this.lookup.userName(e.actorUserId);

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'stock_transfer',
      title: `تحويل وارد ${e.number} بانتظار الاستلام`,
      body: `من «${from.name}» إلى «${to.name}»`,
      details: [
        { label: 'رقم التحويل', value: e.number },
        { label: 'من مخزن', value: from.name },
        { label: 'إلى مخزن', value: to.name },
        ...(by ? [{ label: 'أرسله', value: by }] : []),
      ],
      entity: { type: 'stock_transfer', id: e.transferId },
      link: '/dashboard/inventory/transfers',
      to: Audience.can(PERMS.STOCK_TRANSFER_RECEIVE.name, to.branchId),
      exclude: [e.actorUserId],
      dedupeKey: `transfer_sent:${e.transferId}`,
    });
  }

  /** تحويل استُلم: يعرف المرسِل (وبالعجز إن وُجد) */
  @OnEvent('stock.transfer_received', EVENT)
  async onTransferReceived(
    e: DomainEventMap['stock.transfer_received'],
  ): Promise<void> {
    const [from, to] = await Promise.all([
      this.lookup.warehouse(e.tenantId, e.fromWarehouseId),
      this.lookup.warehouse(e.tenantId, e.toWarehouseId),
    ]);
    if (!from || !to) return;
    const by = await this.lookup.userName(e.actorUserId);
    const short = e.shortLines > 0;

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'stock_transfer',
      severity: short ? 'warning' : 'success',
      title: short
        ? `استُلم التحويل ${e.number} بعجز`
        : `استُلم التحويل ${e.number}`,
      body: short
        ? `«${to.name}» استلم أقل من المرسَل في ${e.shortLines} صنف`
        : `«${to.name}» استلم التحويل كاملاً`,
      details: [
        { label: 'رقم التحويل', value: e.number },
        { label: 'من مخزن', value: from.name },
        { label: 'إلى مخزن', value: to.name },
        ...(short ? [{ label: 'أصناف بعجز', value: e.shortLines }] : []),
        ...(by ? [{ label: 'استلمه', value: by }] : []),
      ],
      entity: { type: 'stock_transfer', id: e.transferId },
      link: '/dashboard/inventory/transfers',
      to: Audience.can(PERMS.STOCK_TRANSFER_MANAGE.name, from.branchId),
      exclude: [e.actorUserId],
      dedupeKey: `transfer_received:${e.transferId}`,
    });
  }

  /** وردية أُقفلت والدرج لا يطابق المفترض: عجز أو زيادة */
  @OnEvent('pos.shift_closed', EVENT)
  async onShiftClosed(e: DomainEventMap['pos.shift_closed']): Promise<void> {
    if (Number(e.cashDifference) === 0) return;
    const devices = await this.dataSource.query<
      { name: string; branchId: string | null }[]
    >(
      `SELECT d.name, w."branchId" FROM pos_devices d
         LEFT JOIN warehouses w ON w.id = d."warehouseId"
        WHERE d.id = $1 AND d."tenantId" = $2`,
      [e.deviceId, e.tenantId],
    );
    const device = devices[0];
    const shortage = e.cashDifference < 0;
    const difference = await this.lookup.money(
      e.tenantId,
      Math.abs(e.cashDifference),
    );

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'cash_variance',
      severity: shortage ? 'danger' : 'warning',
      title: `${shortage ? 'عجز' : 'زيادة'} ${difference} في درج ${device?.name ?? 'الكاشير'}`,
      body: `أُقفلت وردية ${e.cashierName ?? 'الكاشير'} والنقد المعدود ${shortage ? 'أقل' : 'أكثر'} من المفترض`,
      details: [
        { label: 'الجهاز', value: device?.name ?? null },
        { label: 'الكاشير', value: e.cashierName },
        { label: 'المفترض في الدرج', value: e.expectedCash, format: 'money' },
        { label: 'المعدود', value: e.closingCash, format: 'money' },
        { label: 'الفرق', value: e.cashDifference, format: 'money' },
      ],
      entity: { type: 'pos_shift', id: e.shiftId },
      link: '/dashboard/pos/shifts',
      to: Audience.can(PERMS.POS_AUDIT_VIEW.name, device?.branchId ?? null),
      exclude: [e.actorUserId],
      dedupeKey: `cash_variance:${e.shiftId}`,
    });
  }
}
