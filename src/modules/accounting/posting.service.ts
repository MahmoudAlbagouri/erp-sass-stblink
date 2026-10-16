// src/modules/accounting/posting.service.ts
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  DataSource,
  EntityManager,
  In,
  ObjectLiteral,
  SelectQueryBuilder,
} from 'typeorm';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { tenantTimezoneOf } from '../../common/utils/timezone.util';
import { Advance } from '../advances/entities/advance.entity';
import { Bonus } from '../bonuses/entities/bonus.entity';
import { DELIVERY_FEE_SKU } from '../delivery/delivery.service';
import {
  DeliveryOrder,
  DeliverySettlement,
} from '../delivery/entities/delivery.entity';
import { Employee } from '../employees/entities/employee.entity';
import {
  StockMovement,
  StockMovementType,
} from '../inventory/entities/stock-movement.entity';
import { Warehouse } from '../inventory/entities/warehouse.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { PayrollItem } from '../payroll/entities/payroll-item.entity';
import { Payroll } from '../payroll/entities/payroll.entity';
import {
  CashMovementType,
  PosCashMovement,
} from '../pos/entities/pos-extras.entity';
import { PosDevice, PosShift } from '../pos/entities/pos.entity';
import {
  PurchaseInvoice,
  PurchaseInvoiceLine,
} from '../purchasing/entities/purchase-invoice.entity';
import { PurchaseReturn } from '../purchasing/entities/purchase-return.entity';
import { SupplierPayment } from '../purchasing/entities/supplier-payment.entity';
import { PaymentMethodEnum } from '../../common/enums/salary.enums';
import { Salary } from '../salaries/entities/salary.entity';
import {
  CustomerPayment,
  PaymentDirection,
  SalesPaymentMethod,
} from '../sales/entities/customer-payment.entity';
import {
  SalesInvoice,
  SalesInvoiceLine,
} from '../sales/entities/sales-invoice.entity';
import {
  SalesReturn,
  SalesReturnLine,
} from '../sales/entities/sales-return.entity';
import { dateOnly } from '../sales/utils/payment-recorder';
import { Settlement } from '../settlements/entities/settlement.entity';
import {
  DEFAULT_PAYMENT_ACCOUNTS,
  DEFAULT_RECEIPT_ACCOUNTS,
  JournalSource,
  PartyType,
  SYNC_BATCH,
  SystemAccount,
} from './accounting.constants';
import {
  Account,
  AccountingSettings,
  PostingError,
  SkippedSource,
} from './entities/accounting.entity';
import { customerParty, EntryLines, Party } from './entry-lines';
import { LedgerEntryInput, LedgerService } from './ledger.service';

/** ما تحتاجه دورة ترحيل شركة واحدة (يُحمَّل مرة لكل دورة) */
interface SyncContext {
  tenantId: string;
  settings: AccountingSettings;
  decimals: number;
  timezone: string;
  /** حساب النظام ← معرّفه */
  keys: Map<string, string>;
  warehouseBranch: Map<string, string | null>;
  deviceWarehouse: Map<string, string>;
  /** إعادة محاولة ما فشل حديثاً أيضاً (الترحيل اليدوي) */
  force: boolean;
}

interface Candidate {
  id: string;
  event: string;
}

interface SourceHandler {
  type: JournalSource;
  candidates: (ctx: SyncContext) => Promise<Candidate[]>;
  build: (
    manager: EntityManager,
    ctx: SyncContext,
    candidate: Candidate,
  ) => Promise<LedgerEntryInput | null>;
}

export interface SyncResult {
  skipped: boolean;
  posted: number;
  failed: number;
}

/** ما فشل يُعاد بعد هذه المدة في الدورات التلقائية */
const RETRY_AFTER_MINUTES = 10;

/**
 * محرك الترحيل: يحوّل كل مستند وقع بعد تفعيل المحاسبة إلى قيده، بقواعد ثابتة
 * لكل نوع (docs/modules/accounting.md).
 *
 * منفصل عن المستند عمداً: البيع والكاشير والمسير لا ينتظرون المحاسبة ولا
 * يتعطلون بخطئها. المحرك يمر كل دقيقة (وقبل كل تقرير) على ما لم يُرحَّل:
 *   - لكل مستند وحدث قيد واحد (فهرس فريد) — إعادة المرور لا تكرره.
 *   - كل مستند في معاملته: فشل واحد لا يوقف الباقي، ويُسجَّل سببه
 *     (accounting_posting_errors) ويُعاد حتى ينجح.
 *   - "الحدث بعد التفعيل" بوقت وقوعه (الإصدار، الإلغاء…)؛ ما قبله دخل في القيد
 *     الافتتاحي. إلغاء بعد التفعيل لمستند قبله يُرحَّل (عكس أثره في الأرصدة).
 */
@Injectable()
export class PostingService {
  private readonly logger = new Logger(PostingService.name);
  private readonly handlers: SourceHandler[];

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {
    this.handlers = [
      this.salesInvoices(),
      this.salesReturns(),
      this.customerPayments(),
      this.purchaseInvoices(),
      this.purchaseReturns(),
      this.supplierPayments(),
      this.stockAdjustments(),
      this.stocktakes(),
      this.deliverySettlements(),
      this.posShifts(),
      this.posCashMovements(),
      this.payrolls(),
      this.advances(),
      this.loans(),
      this.bonuses(),
      this.leaveSettlements(),
      this.customerOpenings(),
      this.supplierOpenings(),
    ];
  }

  /** دورة لكل شركة فعّلت المحاسبة (المهمة الدورية) */
  async syncAll(): Promise<void> {
    const rows = await this.dataSource.query<{ tenantId: string }[]>(
      `SELECT "tenantId" FROM accounting_settings`,
    );
    for (const { tenantId } of rows) {
      try {
        await this.sync(tenantId);
      } catch (error) {
        this.logger.error(
          `accounting sync failed for ${tenantId}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * يرحّل ما لم يُرحَّل لشركة. دورة واحدة لكل شركة في اللحظة (قفل استشاري
   * يعمل عبر أكثر من نسخة سيرفر): من يجد الدورة جارية يعود فوراً.
   */
  async sync(tenantId: string, force = false): Promise<SyncResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const lockKey = `accounting-sync:${tenantId}`;
    try {
      const rows = (await runner.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS "locked"`,
        [lockKey],
      )) as { locked: boolean }[];
      if (!rows[0]?.locked) return { skipped: true, posted: 0, failed: 0 };
      try {
        return await this.run(tenantId, force);
      } finally {
        await runner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
          lockKey,
        ]);
      }
    } finally {
      await runner.release();
    }
  }

  private async run(tenantId: string, force: boolean): Promise<SyncResult> {
    const ctx = await this.context(tenantId, force);
    if (!ctx) return { skipped: true, posted: 0, failed: 0 };

    let posted = 0;
    let failed = 0;
    for (const handler of this.handlers) {
      const candidates = await handler.candidates(ctx);
      for (const candidate of candidates) {
        const ok = await this.postOne(ctx, handler, candidate);
        if (ok) posted++;
        else failed++;
      }
    }
    await this.dataSource.manager.update(
      AccountingSettings,
      { tenantId },
      { lastSyncAt: new Date() },
    );
    return { skipped: false, posted, failed };
  }

  /** مستند واحد في معاملته: ينجح فيُمسح خطؤه السابق، أو يُسجَّل سببه */
  private async postOne(
    ctx: SyncContext,
    handler: SourceHandler,
    candidate: Candidate,
  ): Promise<boolean> {
    const key = {
      tenantId: ctx.tenantId,
      sourceType: handler.type,
      sourceId: candidate.id,
      sourceEvent: candidate.event,
    };
    try {
      await this.dataSource.transaction(async (manager) => {
        const input = await handler.build(manager, ctx, candidate);
        const entry = input
          ? await this.ledger.post(manager, input, ctx.settings)
          : null;
        // بلا أثر محاسبي (مبالغ صفرية): يُعلَّم فلا يُعاد فحصه كل دورة
        if (!entry) await manager.save(manager.create(SkippedSource, key));
        await manager.delete(PostingError, key);
      });
      return true;
    } catch (error) {
      // دورة أخرى رحّلته في نفس اللحظة: الفهرس الفريد منعه، لا خطأ
      if (isUniqueViolation(error)) return true;
      const message =
        (error as Error).message?.slice(0, 500) || 'خطأ غير متوقع';
      await this.dataSource.query(
        `INSERT INTO accounting_posting_errors
           ("tenantId", "sourceType", "sourceId", "sourceEvent", "message")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("tenantId", "sourceType", "sourceId", "sourceEvent")
         DO UPDATE SET "message" = EXCLUDED."message",
                       "attempts" = accounting_posting_errors."attempts" + 1,
                       "lastSeenAt" = now()`,
        [key.tenantId, key.sourceType, key.sourceId, key.sourceEvent, message],
      );
      return false;
    }
  }

  private async context(
    tenantId: string,
    force: boolean,
  ): Promise<SyncContext | null> {
    const manager = this.dataSource.manager;
    const settings = await manager.findOne(AccountingSettings, {
      where: { tenantId },
    });
    if (!settings) return null;

    const accounts = await manager.find(Account, {
      where: { tenantId },
      select: ['id', 'systemKey'],
    });
    const keys = new Map<string, string>();
    for (const account of accounts) {
      if (account.systemKey) keys.set(account.systemKey, account.id);
    }

    const warehouses = await manager.find(Warehouse, {
      where: { tenantId },
      withDeleted: true,
      select: ['id', 'branchId'],
    });
    const devices = await manager.find(PosDevice, {
      where: { tenantId },
      withDeleted: true,
      select: ['id', 'warehouseId'],
    });

    return {
      tenantId,
      settings,
      decimals: await moneyDecimalsOf(manager, tenantId),
      timezone: await tenantTimezoneOf(manager, tenantId),
      keys,
      warehouseBranch: new Map(
        warehouses.map((w) => [w.id, w.branchId ?? null]),
      ),
      deviceWarehouse: new Map(devices.map((d) => [d.id, d.warehouseId])),
      force,
    };
  }

  // ══════════════════════════ القواعد ══════════════════════════

  /**
   * فاتورة بيع صادرة: من العميل (بإجماليها) إلى المبيعات وإيراد التوصيل
   * والضريبة، ومن المخزون إلى تكلفة المبيعات بتكلفتها.
   */
  private salesInvoices(): SourceHandler {
    const type = JournalSource.SALES_INVOICE;
    return {
      type,
      candidates: (ctx) =>
        this.pick(ctx, SalesInvoice, 'i', type, 'issue', (qb) =>
          qb
            .andWhere(`i.status = 'issued'`)
            .andWhere('i.issuedAt >= :activatedAt')
            .orderBy('i.issuedAt', 'ASC'),
        ),
      build: async (manager, ctx, { id }) => {
        const invoice = await manager.findOneOrFail(SalesInvoice, {
          where: { id, tenantId: ctx.tenantId },
          withDeleted: true,
        });
        const lines = await manager.find(SalesInvoiceLine, {
          where: { invoiceId: id },
        });
        const branchId = this.branchOf(ctx, invoice.warehouseId);
        const feeSubtotal = sum(
          lines
            .filter((l) => l.sku === DELIVERY_FEE_SKU)
            .map((l) => l.subtotal),
        );
        const e = new EntryLines(ctx);
        e.add(SystemAccount.RECEIVABLES, invoice.total, {
          branchId,
          party: customerParty(invoice.customerId),
        });
        e.add(
          SystemAccount.SALES,
          new Decimal(invoice.subtotal).minus(feeSubtotal).neg(),
          { branchId },
        );
        e.add(SystemAccount.DELIVERY_REVENUE, feeSubtotal.neg(), { branchId });
        e.add(SystemAccount.VAT_OUTPUT, -invoice.taxTotal, { branchId });
        e.add(SystemAccount.COGS, invoice.costTotal, { branchId });
        e.add(SystemAccount.INVENTORY, -invoice.costTotal, { branchId });
        return {
          ...base(ctx, type, id, 'issue', invoice.number),
          date: invoice.invoiceDate,
          description: `فاتورة بيع ${invoice.number ?? ''}`,
          lines: e.lines(SystemAccount.SALES),
        };
      },
    };
  }

  /** مرتجع بيع صادر: عكس الفاتورة بقدره، والبضاعة تعود بتكلفتها الأصلية */
  private salesReturns(): SourceHandler {
    const type = JournalSource.SALES_RETURN;
    return {
      type,
      candidates: (ctx) =>
        this.pick(ctx, SalesReturn, 'r', type, 'issue', (qb) =>
          qb
            .andWhere(`r.status = 'issued'`)
            .andWhere('COALESCE(r.issuedAt, r.createdAt) >= :activatedAt')
            .orderBy('r.createdAt', 'ASC'),
        ),
      build: async (manager, ctx, { id }) => {
        const ret = await manager.findOneOrFail(SalesReturn, {
          where: { id, tenantId: ctx.tenantId },
          withDeleted: true,
          relations: ['invoice'],
        });
        const lines = await manager.find(SalesReturnLine, {
          where: { returnId: id },
        });
        const invoiceLines = new Map(
          (
            await manager.find(SalesInvoiceLine, {
              where: { id: In(lines.map((l) => l.invoiceLineId)) },
            })
          ).map((l) => [l.id, l]),
        );
        const cost = sum(
          lines.map((line) => {
            const source = invoiceLines.get(line.invoiceLineId);
            return source?.isStocked
              ? new Decimal(line.baseQuantity).mul(source.unitCost)
              : 0;
          }),
        );
        const branchId = this.branchOf(ctx, ret.warehouseId);
        const party = customerParty(ret.customerId ?? ret.invoice?.customerId);
        const e = new EntryLines(ctx);
        e.add(SystemAccount.SALES_RETURNS, ret.subtotal, { branchId });
        e.add(SystemAccount.VAT_OUTPUT, ret.taxTotal, { branchId });
        e.add(SystemAccount.RECEIVABLES, -ret.total, { branchId, party });
        e.add(SystemAccount.INVENTORY, cost, { branchId });
        e.add(SystemAccount.COGS, cost.neg(), { branchId });
        return {
          ...base(ctx, type, id, 'issue', ret.number),
          date: ret.returnDate,
          description: `مرتجع بيع ${ret.number ?? ''} على الفاتورة ${ret.invoice?.number ?? ''}`,
          lines: e.lines(SystemAccount.SALES_RETURNS),
        };
      },
    };
  }

  /**
   * سند قبض (أو ردّ لعميل): بين حساب طريقة الدفع والعميل. التحصيل عبر جهة
   * توصيل (courier) على ذمة الجهة حتى تسويتها. إلغاء السند يعكسه بتاريخه.
   */
  private customerPayments(): SourceHandler {
    const type = JournalSource.CUSTOMER_PAYMENT;
    return {
      type,
      candidates: async (ctx) => [
        ...(await this.pick(ctx, CustomerPayment, 'p', type, 'record', (qb) =>
          qb
            .andWhere('p.amount > 0')
            .andWhere('p.createdAt >= :activatedAt')
            .orderBy('p.createdAt', 'ASC'),
        )),
        ...(await this.pick(ctx, CustomerPayment, 'p', type, 'cancel', (qb) =>
          qb
            .andWhere('p.amount > 0')
            .andWhere(`p.status = 'cancelled'`)
            .andWhere('p.updatedAt >= :activatedAt')
            .orderBy('p.updatedAt', 'ASC'),
        )),
      ],
      build: async (manager, ctx, { id, event }) => {
        const payment = await manager.findOneOrFail(CustomerPayment, {
          where: { id, tenantId: ctx.tenantId },
          withDeleted: true,
        });
        const cancel = event === 'cancel';
        const incoming = payment.direction === PaymentDirection.IN;
        let accountId: string;
        let moneyParty: Party | null = null;
        if (payment.method === SalesPaymentMethod.COURIER) {
          accountId = this.key(ctx, SystemAccount.COURIER_RECEIVABLE);
          const order = payment.invoiceId
            ? await manager.findOne(DeliveryOrder, {
                where: { invoiceId: payment.invoiceId },
                withDeleted: true,
                select: ['id', 'agentId'],
              })
            : null;
          moneyParty = order?.agentId
            ? { type: PartyType.COURIER, id: order.agentId }
            : null;
        } else {
          accountId = this.receiptAccount(ctx, payment.method);
        }
        const sign = (incoming ? 1 : -1) * (cancel ? -1 : 1);
        const amount = new Decimal(payment.amount).mul(sign);
        const branchId = payment.branchId ?? null;
        const e = new EntryLines(ctx);
        e.addId(accountId, amount, { branchId, party: moneyParty });
        e.add(SystemAccount.RECEIVABLES, amount.neg(), {
          branchId,
          party: customerParty(payment.customerId),
        });
        const what = incoming ? 'سند قبض' : 'ردّ لعميل';
        return {
          ...base(ctx, type, id, event, payment.number),
          date: cancel
            ? dateOnly(payment.updatedAt, ctx.timezone)
            : payment.paymentDate,
          description: `${cancel ? 'إلغاء ' : ''}${what} ${payment.number}`,
          lines: e.lines(),
        };
      },
    };
  }

  /**
   * فاتورة شراء معتمدة: للمخزون (بتكلفته) والضريبة المستردة، على المورد.
   * المنشأة غير المسجّلة في الضريبة تحمّل الضريبة على التكلفة (لا مستردة).
   * الإلغاء بعد الاعتماد يعكسها، والبضاعة تخرج بمتوسط تكلفتها وقت الإلغاء
   * (الفرق إلى فروقات المخزون).
   */
  private purchaseInvoices(): SourceHandler {
    const type = JournalSource.PURCHASE_INVOICE;
    return {
      type,
      candidates: async (ctx) => [
        ...(await this.pick(ctx, PurchaseInvoice, 'i', type, 'post', (qb) =>
          qb
            .andWhere(`i.status IN ('posted', 'cancelled')`)
            .andWhere('i.postedAt >= :activatedAt')
            .orderBy('i.postedAt', 'ASC'),
        )),
        ...(await this.pick(ctx, PurchaseInvoice, 'i', type, 'cancel', (qb) =>
          qb
            .andWhere(`i.status = 'cancelled'`)
            .andWhere('i.postedAt IS NOT NULL')
            .andWhere('i.updatedAt >= :activatedAt')
            .orderBy('i.updatedAt', 'ASC'),
        )),
      ],
      build: async (manager, ctx, { id, event }) => {
        const invoice = await manager.findOneOrFail(PurchaseInvoice, {
          where: { id, tenantId: ctx.tenantId },
          withDeleted: true,
        });
        const vat = await this.recoverableVat(
          manager,
          invoice,
          invoice.taxTotal,
        );
        const branchId = this.branchOf(ctx, invoice.warehouseId);
        const party = { type: PartyType.SUPPLIER, id: invoice.supplierId };
        const total = new Decimal(invoice.total);
        const e = new EntryLines(ctx);

        if (event === 'post') {
          e.add(SystemAccount.INVENTORY, total.minus(vat), { branchId });
          e.add(SystemAccount.VAT_INPUT, vat, { branchId });
          e.add(SystemAccount.PAYABLES, total.neg(), { branchId, party });
          return {
            ...base(ctx, type, id, event, invoice.number),
            date: invoice.invoiceDate,
            description: `فاتورة شراء ${invoice.number}`,
            lines: e.lines(SystemAccount.INVENTORY),
          };
        }

        const out = await this.movementsValue(
          manager,
          'purchase_invoice',
          id,
          'out',
        );
        e.add(SystemAccount.PAYABLES, total, { branchId, party });
        e.add(SystemAccount.VAT_INPUT, vat.neg(), { branchId });
        e.add(SystemAccount.INVENTORY, out.neg(), { branchId });
        e.add(
          SystemAccount.INVENTORY_ADJUSTMENTS,
          total.minus(vat).minus(out).neg(),
          { branchId },
        );
        return {
          ...base(ctx, type, id, event, invoice.number),
          date: dateOnly(invoice.updatedAt, ctx.timezone),
          description: `إلغاء فاتورة الشراء ${invoice.number}`,
          lines: e.lines(SystemAccount.INVENTORY_ADJUSTMENTS),
        };
      },
    };
  }

  /** مرتجع شراء: يخصم من المورد، والبضاعة تخرج بمتوسط تكلفتها */
  private purchaseReturns(): SourceHandler {
    const type = JournalSource.PURCHASE_RETURN;
    return {
      type,
      candidates: (ctx) =>
        this.pick(ctx, PurchaseReturn, 'r', type, 'post', (qb) =>
          qb
            .andWhere(`r.status = 'posted'`)
            .andWhere('r.postedAt >= :activatedAt')
            .orderBy('r.postedAt', 'ASC'),
        ),
      build: async (manager, ctx, { id }) => {
        const ret = await manager.findOneOrFail(PurchaseReturn, {
          where: { id, tenantId: ctx.tenantId },
          withDeleted: true,
          relations: ['invoice'],
        });
        const vat = ret.invoice
          ? await this.recoverableVat(manager, ret.invoice, ret.taxTotal)
          : new Decimal(0);
        const out = await this.movementsValue(
          manager,
          'purchase_return',
          id,
          'out',
        );
        const branchId = this.branchOf(ctx, ret.warehouseId);
        const total = new Decimal(ret.total);
        const e = new EntryLines(ctx);
        e.add(SystemAccount.PAYABLES, total, {
          branchId,
          party: { type: PartyType.SUPPLIER, id: ret.supplierId },
        });
        e.add(SystemAccount.VAT_INPUT, vat.neg(), { branchId });
        e.add(SystemAccount.INVENTORY, out.neg(), { branchId });
        e.add(
          SystemAccount.INVENTORY_ADJUSTMENTS,
          total.minus(vat).minus(out).neg(),
          { branchId },
        );
        return {
          ...base(ctx, type, id, 'post', ret.number),
          date: ret.returnDate,
          description: `مرتجع شراء ${ret.number} على الفاتورة ${ret.invoice?.number ?? ''}`,
          lines: e.lines(SystemAccount.INVENTORY_ADJUSTMENTS),
        };
      },
    };
  }

  /** سداد مورد: من المورد إلى حساب طريقة الدفع. الإلغاء يعكسه */
  private supplierPayments(): SourceHandler {
    const type = JournalSource.SUPPLIER_PAYMENT;
    return {
      type,
      candidates: async (ctx) => [
        ...(await this.pick(ctx, SupplierPayment, 'p', type, 'record', (qb) =>
          qb
            .andWhere('p.amount > 0')
            .andWhere('p.createdAt >= :activatedAt')
            .orderBy('p.createdAt', 'ASC'),
        )),
        ...(await this.pick(ctx, SupplierPayment, 'p', type, 'cancel', (qb) =>
          qb
            .andWhere('p.amount > 0')
            .andWhere(`p.status = 'cancelled'`)
            .andWhere('p.updatedAt >= :activatedAt')
            .orderBy('p.updatedAt', 'ASC'),
        )),
      ],
      build: async (manager, ctx, { id, event }) => {
        const payment = await manager.findOneOrFail(SupplierPayment, {
          where: { id, tenantId: ctx.tenantId },
          withDeleted: true,
        });
        const cancel = event === 'cancel';
        const amount = new Decimal(payment.amount).mul(cancel ? -1 : 1);
        const e = new EntryLines(ctx);
        e.add(SystemAccount.PAYABLES, amount, {
          party: { type: PartyType.SUPPLIER, id: payment.supplierId },
        });
        e.addId(this.paymentAccount(ctx, payment.method), amount.neg());
        return {
          ...base(ctx, type, id, event, payment.number),
          date: cancel
            ? dateOnly(payment.updatedAt, ctx.timezone)
            : payment.paymentDate,
          description: `${cancel ? 'إلغاء ' : ''}سداد مورد ${payment.number}`,
          lines: e.lines(),
        };
      },
    };
  }

  /**
   * تسوية المخزون اليدوية والرصيد الافتتاحي (بقيمة الحركات): الافتتاحي مقابل
   * الأرصدة الافتتاحية، والتسوية مقابل فروقات المخزون.
   */
  private stockAdjustments(): SourceHandler {
    const type = JournalSource.STOCK_ADJUSTMENT;
    return {
      type,
      candidates: (ctx) => this.pickMovementGroups(ctx, type, 'adjustment'),
      build: async (manager, ctx, { id }) => {
        const movements = await manager.find(StockMovement, {
          where: {
            tenantId: ctx.tenantId,
            referenceType: 'adjustment',
            referenceId: id,
          },
        });
        if (!movements.length) return null;
        const opening = movements.every(
          (m) => m.type === StockMovementType.OPENING,
        );
        const e = new EntryLines(ctx);
        for (const m of movements) {
          const value = new Decimal(m.quantity).mul(m.unitCost);
          const branchId = this.branchOf(ctx, m.warehouseId);
          e.add(SystemAccount.INVENTORY, value, { branchId });
          e.add(
            m.type === StockMovementType.OPENING
              ? SystemAccount.OPENING_BALANCE
              : SystemAccount.INVENTORY_ADJUSTMENTS,
            value.neg(),
            { branchId },
          );
        }
        const note = movements[0].note ? ` — ${movements[0].note}` : '';
        return {
          ...base(ctx, type, id, 'apply', null),
          date: dateOnly(movements[0].occurredAt, ctx.timezone),
          description: `${opening ? 'رصيد افتتاحي للمخزون' : 'تسوية مخزون'}${note}`,
          lines: e.lines(
            opening
              ? SystemAccount.OPENING_BALANCE
              : SystemAccount.INVENTORY_ADJUSTMENTS,
          ),
        };
      },
    };
  }

  /** اعتماد جرد: فرق المعدود عن الرصيد بقيمته إلى فروقات المخزون */
  private stocktakes(): SourceHandler {
    const type = JournalSource.STOCKTAKE;
    return {
      type,
      candidates: (ctx) => this.pickMovementGroups(ctx, type, 'stocktake'),
      build: async (manager, ctx, { id }) => {
        const movements = await manager.find(StockMovement, {
          where: {
            tenantId: ctx.tenantId,
            referenceType: 'stocktake',
            referenceId: id,
          },
        });
        if (!movements.length) return null;
        const [stocktake] = await manager.query<{ number: string }[]>(
          `SELECT "number" FROM stocktakes WHERE "id" = $1`,
          [id],
        );
        const e = new EntryLines(ctx);
        for (const m of movements) {
          const value = new Decimal(m.quantity).mul(m.unitCost);
          const branchId = this.branchOf(ctx, m.warehouseId);
          e.add(SystemAccount.INVENTORY, value, { branchId });
          e.add(SystemAccount.INVENTORY_ADJUSTMENTS, value.neg(), { branchId });
        }
        return {
          ...base(ctx, type, id, 'post', stocktake?.number ?? null),
          date: dateOnly(movements[0].occurredAt, ctx.timezone),
          description: `فروقات الجرد ${stocktake?.number ?? ''}`,
          lines: e.lines(SystemAccount.INVENTORY_ADJUSTMENTS),
        };
      },
    };
  }

  /**
   * تسوية جهة توصيل: المستلم في حساب طريقة الاستلام، وأجرتها مصروف توصيل،
   * وما حصّلته يُخصم من ذمتها، والفرق (عجز/زيادة) إلى فروقات التسويات.
   */
  private deliverySettlements(): SourceHandler {
    const type = JournalSource.DELIVERY_SETTLEMENT;
    return {
      type,
      candidates: (ctx) =>
        this.pick(ctx, DeliverySettlement, 's', type, 'settle', (qb) =>
          qb
            .andWhere('s.createdAt >= :activatedAt')
            .orderBy('s.createdAt', 'ASC'),
        ),
      build: async (manager, ctx, { id }) => {
        const s = await manager.findOneOrFail(DeliverySettlement, {
          where: { id, tenantId: ctx.tenantId },
          withDeleted: true,
          relations: ['agent'],
        });
        const e = new EntryLines(ctx);
        e.addId(this.receiptAccount(ctx, s.method), s.receivedAmount);
        e.add(SystemAccount.DELIVERY_EXPENSE, s.feesTotal);
        e.add(SystemAccount.COURIER_RECEIVABLE, -s.collectedTotal, {
          party: { type: PartyType.COURIER, id: s.agentId },
        });
        e.add(SystemAccount.COURIER_DIFFERENCES, -s.difference);
        return {
          ...base(ctx, type, id, 'settle', s.number),
          date: dateOnly(s.settledAt, ctx.timezone),
          description: `تسوية ${s.agent?.name ?? 'جهة توصيل'} ${s.number}`,
          lines: e.lines(SystemAccount.COURIER_DIFFERENCES),
        };
      },
    };
  }

  /**
   * عجز أو زيادة الصندوق عند تقفيل وردية الكاشير. وردية أُعيد حسابها بعد
   * التقفيل (عملية متأخرة) يُرحَّل فرق ما تغيّر فقط.
   */
  private posShifts(): SourceHandler {
    const type = JournalSource.POS_SHIFT;
    return {
      type,
      candidates: async (ctx) => {
        const overShort = this.key(ctx, SystemAccount.CASH_OVER_SHORT);
        const rows = await this.dataSource.query<
          { id: string; entries: string }[]
        >(
          `SELECT s."id", COALESCE(posted."entries", 0) AS "entries"
             FROM pos_shifts s
             LEFT JOIN LATERAL (
               SELECT COUNT(DISTINCT e."id") AS "entries",
                      SUM(l."credit" - l."debit") FILTER (WHERE l."accountId" = $3) AS "overage"
                 FROM journal_entries e
                 LEFT JOIN journal_lines l ON l."entryId" = e."id"
                WHERE e."tenantId" = s."tenantId" AND e."sourceType" = $4
                  AND e."sourceId" = s."id"
             ) posted ON true
            WHERE s."tenantId" = $1 AND s."status" = 'closed' AND s."closedAt" >= $2
              AND ABS(s."cashDifference" - COALESCE(posted."overage", 0)) > 0.0005
              ${this.recentlyFailedSql('s."id"', '$4', ctx.force)}
            ORDER BY s."closedAt" ASC
            LIMIT ${SYNC_BATCH}`,
          [ctx.tenantId, ctx.settings.activatedAt, overShort, type],
        );
        return rows.map((row) => ({
          id: row.id,
          event:
            Number(row.entries) === 0
              ? 'close'
              : `recalc:${Number(row.entries)}`,
        }));
      },
      build: async (manager, ctx, { id, event }) => {
        const shift = await manager.findOneOrFail(PosShift, {
          where: { id, tenantId: ctx.tenantId },
        });
        const [posted] = await manager.query<{ overage: string | null }[]>(
          `SELECT SUM(l."credit" - l."debit") AS "overage"
             FROM journal_entries e JOIN journal_lines l ON l."entryId" = e."id"
            WHERE e."tenantId" = $1 AND e."sourceType" = $2 AND e."sourceId" = $3
              AND l."accountId" = $4`,
          [
            ctx.tenantId,
            type,
            id,
            this.key(ctx, SystemAccount.CASH_OVER_SHORT),
          ],
        );
        const delta = new Decimal(shift.cashDifference).minus(
          posted?.overage ?? 0,
        );
        const branchId = this.branchOf(
          ctx,
          ctx.deviceWarehouse.get(shift.deviceId),
        );
        const e = new EntryLines(ctx);
        e.addId(this.receiptAccount(ctx, 'cash'), delta, { branchId });
        e.add(SystemAccount.CASH_OVER_SHORT, delta.neg(), { branchId });
        const first = event === 'close';
        const who = shift.cashierName ? ` (${shift.cashierName})` : '';
        return {
          ...base(ctx, type, id, event, null),
          date: dateOnly(
            first
              ? (shift.closedAt ?? new Date())
              : (shift.recalculatedAt ?? new Date()),
            ctx.timezone,
          ),
          description: `${delta.gt(0) ? 'زيادة' : 'عجز'} الصندوق في وردية كاشير${who}${first ? '' : ' — بعد إعادة حسابها'}`,
          lines: e.lines(),
        };
      },
    };
  }

  /**
   * إيداع في درج الكاشير أو سحب منه (مصروف نثري، توريد للخزنة): مقابل حساب
   * «حركات الدرج تحت التسوية» — المحاسب يصنّفه (مصروف، تحويل…) بقيد.
   */
  private posCashMovements(): SourceHandler {
    const type = JournalSource.POS_CASH_MOVEMENT;
    return {
      type,
      candidates: (ctx) =>
        this.pick(ctx, PosCashMovement, 'm', type, 'record', (qb) =>
          qb
            .andWhere('m.amount > 0')
            .andWhere('m.createdAt >= :activatedAt')
            .orderBy('m.createdAt', 'ASC'),
        ),
      build: async (manager, ctx, { id }) => {
        const movement = await manager.findOneOrFail(PosCashMovement, {
          where: { id, tenantId: ctx.tenantId },
        });
        const amount = new Decimal(movement.amount).mul(
          movement.type === CashMovementType.IN ? 1 : -1,
        );
        const branchId = this.branchOf(
          ctx,
          ctx.deviceWarehouse.get(movement.deviceId),
        );
        const e = new EntryLines(ctx);
        e.addId(this.receiptAccount(ctx, 'cash'), amount, { branchId });
        e.add(SystemAccount.POS_CASH_CLEARING, amount.neg(), { branchId });
        return {
          ...base(ctx, type, id, 'record', null),
          date: dateOnly(movement.occurredAt, ctx.timezone),
          description: `${movement.type === CashMovementType.IN ? 'إيداع في' : 'سحب من'} درج الكاشير: ${movement.reason}`,
          lines: e.lines(),
        };
      },
    };
  }

  /**
   * صرف مسير الرواتب: الأجور والبدلات والمكافآت ونهاية الخدمة مصروفات (بلا
   * ما صُرف مباشرة من قبل — قُيِّد يوم صرفه)، وأقساط القروض والسلف تُخصم من
   * ذممها، والخصومات إيراد، والصافي من حساب طريقة دفع راتب كل موظف. خصومات
   * فاقت المستحق (الصافي صفر): الباقي ذمة على الموظف.
   */
  private payrolls(): SourceHandler {
    const type = JournalSource.PAYROLL;
    return {
      type,
      candidates: (ctx) =>
        this.pick(ctx, Payroll, 'p', type, 'disburse', (qb) =>
          qb
            .andWhere('p.isDisbursed = true')
            .andWhere('p.disbursedAt >= :activatedAt')
            .orderBy('p.disbursedAt', 'ASC'),
        ),
      build: async (manager, ctx, { id }) => {
        const payroll = await manager.findOneOrFail(Payroll, {
          where: { id, tenantId: ctx.tenantId },
        });
        const items = await manager.find(PayrollItem, {
          where: { payrollId: id },
        });
        if (!items.length) return null;
        const employeeIds = items.map((i) => i.employeeId);
        const [employees, salaries] = await Promise.all([
          manager.find(Employee, {
            where: { id: In(employeeIds) },
            withDeleted: true,
            select: ['id', 'branchId'],
          }),
          manager.find(Salary, {
            where: { employeeId: In(employeeIds), tenantId: ctx.tenantId },
            select: ['employeeId', 'paymentMethod'],
          }),
        ]);
        const branchOf = new Map(
          employees.map((e) => [e.id, e.branchId ?? null]),
        );
        const methodOf = new Map(
          salaries.map((s) => [s.employeeId, s.paymentMethod]),
        );

        const e = new EntryLines(ctx);
        for (const item of items) {
          const branchId = branchOf.get(item.employeeId) ?? null;
          const party = { type: PartyType.EMPLOYEE, id: item.employeeId };
          const n = (v: unknown) => new Decimal(Number(v) || 0);
          const amounts: [string, Decimal][] = [
            [
              SystemAccount.SALARIES,
              n(item.basicSalary)
                .plus(n(item.overtimeAmount))
                .minus(n(item.unpaidLeaveDeduction)),
            ],
            [
              SystemAccount.ALLOWANCES,
              n(item.housingAllowance)
                .plus(n(item.transportAllowance))
                .plus(n(item.otherAllowances))
                .minus(n(item.prepaidAllowances)),
            ],
            [
              SystemAccount.BONUSES,
              n(item.bonusesAmount).minus(n(item.prepaidBonuses)),
            ],
            [
              SystemAccount.LEAVE_PAY,
              n(item.settlementsAmount).minus(n(item.prepaidSettlements)),
            ],
            [SystemAccount.EOS_EXPENSE, n(item.eosAmount)],
          ];
          let balance = new Decimal(0);
          for (const [key, amount] of amounts) {
            e.add(key, amount, { branchId });
            balance = balance.plus(amount);
          }
          const credits: [string, Decimal, Party | null][] = [
            [SystemAccount.EMPLOYEE_LOANS, n(item.loanDeduction), party],
            [SystemAccount.EMPLOYEE_ADVANCES, n(item.advanceDeduction), party],
            [SystemAccount.EMPLOYEE_PENALTIES, n(item.otherDeductions), null],
          ];
          for (const [key, amount, who] of credits) {
            e.add(key, amount.neg(), { branchId, party: who });
            balance = balance.minus(amount);
          }
          const method =
            methodOf.get(item.employeeId) === PaymentMethodEnum.BANK
              ? 'bank_transfer'
              : 'cash';
          e.addId(this.paymentAccount(ctx, method), n(item.netSalary).neg(), {
            branchId,
          });
          balance = balance.minus(n(item.netSalary));
          // الصافي قُصّ عند صفر لأن الخصومات فاقت المستحق: الباقي على الموظف
          if (balance.lt(0)) {
            e.add(SystemAccount.EMPLOYEE_RECEIVABLES, balance.neg(), {
              branchId,
              party,
            });
          } else if (!balance.isZero()) {
            e.add(SystemAccount.SALARIES, balance.neg(), { branchId });
          }
        }
        const period = `${String(payroll.month).padStart(2, '0')}/${payroll.year}`;
        return {
          ...base(ctx, type, id, 'disburse', `PR-${period}`),
          date: dateOnly(payroll.disbursedAt ?? new Date(), ctx.timezone),
          description: `صرف مسير رواتب ${period}`,
          lines: e.lines(SystemAccount.SALARIES),
        };
      },
    };
  }

  /** تسليم سلفة لموظف (خارج المسير): ذمة عليه تُسترد من رواتبه */
  private advances(): SourceHandler {
    return this.employeeCash({
      type: JournalSource.ADVANCE,
      entity: Advance,
      event: 'disburse',
      where: (qb) =>
        qb
          .andWhere('x.amount > 0')
          .andWhere('x.isDisbursed = true')
          .andWhere('x.disbursedAt >= :activatedAt')
          .orderBy('x.disbursedAt', 'ASC'),
      load: async (manager, id, tenantId) => {
        const a = await manager.findOneOrFail(Advance, {
          where: { id, tenantId },
        });
        return {
          employeeId: a.employeeId,
          amount: a.amount,
          at: a.disbursedAt ?? new Date(),
          debit: SystemAccount.EMPLOYEE_ADVANCES,
          description: 'تسليم سلفة لموظف',
        };
      },
    });
  }

  /** اعتماد قرض موظف: يُسلَّم مبلغه ويصير ذمة تُسترد أقساطاً */
  private loans(): SourceHandler {
    return this.employeeCash({
      type: JournalSource.LOAN,
      entity: Loan,
      event: 'approve',
      where: (qb) =>
        qb
          .andWhere('x.status IN (:...loanStatuses)', {
            loanStatuses: [LoanStatus.APPROVED, LoanStatus.COMPLETED],
          })
          .andWhere('x.totalAmount > 0')
          .andWhere('x.approvedAt >= :activatedAt')
          .orderBy('x.approvedAt', 'ASC'),
      load: async (manager, id, tenantId) => {
        const loan = await manager.findOneOrFail(Loan, {
          where: { id, tenantId },
        });
        return {
          employeeId: loan.employeeId,
          amount: loan.totalAmount,
          at: loan.approvedAt ?? new Date(),
          debit: SystemAccount.EMPLOYEE_LOANS,
          description: `قرض موظف على ${loan.installmentsCount} قسط`,
        };
      },
    });
  }

  /** مكافأة صُرفت مباشرة خارج المسير (المسير يطرحها فلا تُقيَّد مرتين) */
  private bonuses(): SourceHandler {
    return this.employeeCash({
      type: JournalSource.BONUS,
      entity: Bonus,
      event: 'disburse',
      where: (qb) =>
        qb
          .andWhere('x.amount > 0')
          .andWhere('x.isDisbursed = true')
          .andWhere('x.disbursedAt >= :activatedAt')
          .orderBy('x.disbursedAt', 'ASC'),
      load: async (manager, id, tenantId) => {
        const b = await manager.findOneOrFail(Bonus, {
          where: { id, tenantId },
        });
        return {
          employeeId: b.employeeId,
          amount: b.amount,
          at: b.disbursedAt ?? new Date(),
          debit: SystemAccount.BONUSES,
          description: 'صرف مكافأة مباشرة',
          withParty: false,
        };
      },
    });
  }

  /** بدل إجازة صُرف مباشرة خارج المسير */
  private leaveSettlements(): SourceHandler {
    return this.employeeCash({
      type: JournalSource.LEAVE_SETTLEMENT,
      entity: Settlement,
      event: 'disburse',
      where: (qb) =>
        qb
          .andWhere('x.totalAmount > 0')
          .andWhere('x.isDisbursed = true')
          .andWhere('x.disbursedAt >= :activatedAt')
          .orderBy('x.disbursedAt', 'ASC'),
      load: async (manager, id, tenantId) => {
        const s = await manager.findOneOrFail(Settlement, {
          where: { id, tenantId },
        });
        return {
          employeeId: s.employeeId,
          amount: s.totalAmount,
          at: s.disbursedAt ?? new Date(),
          debit: SystemAccount.LEAVE_PAY,
          description: `صرف بدل إجازة (${Number(s.unusedLeaveDays)} يوم)`,
          withParty: false,
        };
      },
    });
  }

  /**
   * رصيد افتتاحي لعميل أُضيف أو عُدّل بعد التفعيل: يُرحَّل الفرق بين الحالي
   * وما في القيد الافتتاحي (baseline) وما رُحّل من فروق قبل.
   */
  private customerOpenings(): SourceHandler {
    return this.partyOpenings({
      type: JournalSource.CUSTOMER_OPENING,
      table: 'customers',
      partyType: PartyType.CUSTOMER,
      account: SystemAccount.RECEIVABLES,
      /** رصيد العميل مدين: الفرق موجب = مدين على العملاء */
      sign: 1,
      label: 'عميل',
    });
  }

  private supplierOpenings(): SourceHandler {
    return this.partyOpenings({
      type: JournalSource.SUPPLIER_OPENING,
      table: 'suppliers',
      partyType: PartyType.SUPPLIER,
      account: SystemAccount.PAYABLES,
      /** رصيد المورد دائن: الفرق موجب = دائن للموردين */
      sign: -1,
      label: 'مورد',
    });
  }

  // ══════════════════════════ قواعد مشتركة ══════════════════════════

  private employeeCash(config: {
    type: JournalSource;
    entity: new () => ObjectLiteral;
    event: string;
    where: (
      qb: SelectQueryBuilder<ObjectLiteral>,
    ) => SelectQueryBuilder<ObjectLiteral>;
    load: (
      manager: EntityManager,
      id: string,
      tenantId: string,
    ) => Promise<{
      employeeId: string;
      amount: number;
      at: Date;
      debit: SystemAccount;
      description: string;
      withParty?: boolean;
    }>;
  }): SourceHandler {
    const { type, event } = config;
    return {
      type,
      candidates: (ctx) =>
        this.pick(ctx, config.entity, 'x', type, event, (qb) =>
          config.where(qb),
        ),
      build: async (manager, ctx, { id }) => {
        const doc = await config.load(manager, id, ctx.tenantId);
        const employee = await manager.findOne(Employee, {
          where: { id: doc.employeeId },
          withDeleted: true,
          select: ['id', 'branchId', 'fullName'],
        });
        const branchId = employee?.branchId ?? null;
        const e = new EntryLines(ctx);
        e.add(doc.debit, doc.amount, {
          branchId,
          party:
            doc.withParty === false
              ? null
              : { type: PartyType.EMPLOYEE, id: doc.employeeId },
        });
        e.addId(this.paymentAccount(ctx, 'cash'), -Number(doc.amount), {
          branchId,
        });
        return {
          ...base(ctx, type, id, event, null),
          date: dateOnly(doc.at, ctx.timezone),
          description: `${doc.description}${employee?.fullName ? ` — ${employee.fullName}` : ''}`,
          lines: e.lines(),
        };
      },
    };
  }

  private partyOpenings(config: {
    type: JournalSource;
    table: 'customers' | 'suppliers';
    partyType: PartyType;
    account: SystemAccount;
    sign: 1 | -1;
    label: string;
  }): SourceHandler {
    const { type, table, partyType, account, sign } = config;
    return {
      type,
      candidates: async (ctx) => {
        const rows = await this.dataSource.query<
          { id: string; entries: string }[]
        >(
          `SELECT p."id", COALESCE(posted."entries", 0) AS "entries"
             FROM ${table} p
             LEFT JOIN accounting_opening_baselines b
               ON b."tenantId" = p."tenantId" AND b."partyType" = $3 AND b."partyId" = p."id"
             LEFT JOIN LATERAL (
               SELECT COUNT(DISTINCT e."id") AS "entries",
                      SUM(l."debit" - l."credit") * $5::numeric AS "amount"
                 FROM journal_entries e
                 JOIN journal_lines l ON l."entryId" = e."id" AND l."accountId" = $4
                WHERE e."tenantId" = p."tenantId" AND e."sourceType" = $2
                  AND e."sourceId" = p."id"
             ) posted ON true
            WHERE p."tenantId" = $1 AND p."deletedAt" IS NULL
              AND ABS(p."openingBalance" - COALESCE(b."amount", 0)
                      - COALESCE(posted."amount", 0)) > 0.0005
              ${this.recentlyFailedSql('p."id"', '$2', ctx.force)}
            LIMIT ${SYNC_BATCH}`,
          [ctx.tenantId, type, partyType, this.key(ctx, account), sign],
        );
        return rows.map((row) => ({
          id: row.id,
          event: `opening:${Number(row.entries) + 1}`,
        }));
      },
      build: async (manager, ctx, { id, event }) => {
        const [party] = await manager.query<
          {
            code: string;
            name: string;
            openingBalance: string;
            updatedAt: Date;
          }[]
        >(
          `SELECT "code", "name", "openingBalance", "updatedAt" FROM ${table}
            WHERE "id" = $1 AND "tenantId" = $2`,
          [id, ctx.tenantId],
        );
        const [baseline] = await manager.query<{ amount: string }[]>(
          `SELECT "amount" FROM accounting_opening_baselines
            WHERE "tenantId" = $1 AND "partyType" = $2 AND "partyId" = $3`,
          [ctx.tenantId, partyType, id],
        );
        const [posted] = await manager.query<{ amount: string | null }[]>(
          `SELECT SUM(l."debit" - l."credit") * $4::numeric AS "amount"
             FROM journal_entries e JOIN journal_lines l ON l."entryId" = e."id"
            WHERE e."tenantId" = $1 AND e."sourceType" = $2 AND e."sourceId" = $3
              AND l."accountId" = $5`,
          [ctx.tenantId, type, id, sign, this.key(ctx, account)],
        );
        const delta = new Decimal(party.openingBalance)
          .minus(baseline?.amount ?? 0)
          .minus(posted?.amount ?? 0);
        const e = new EntryLines(ctx);
        e.add(account, delta.mul(sign), { party: { type: partyType, id } });
        e.add(SystemAccount.OPENING_BALANCE, delta.mul(sign).neg());
        return {
          ...base(ctx, type, id, event, party.code),
          date: dateOnly(party.updatedAt, ctx.timezone),
          description: `رصيد افتتاحي ${config.label}: ${party.name}`,
          lines: e.lines(),
        };
      },
    };
  }

  /**
   * المستندات التي لم يُرحَّل حدثها بعد (ولم تُعلَّم بلا أثر، ولم تفشل
   * حديثاً)، بأقدمها أولاً. جداول الموارد البشرية الأقدم تحفظ معرّف الشركة
   * نصاً (tenant_id)، فيُحوَّل لـ uuid عند مقارنته بجداول المحاسبة.
   */
  private async pick(
    ctx: SyncContext,
    entity: new () => ObjectLiteral,
    alias: string,
    type: JournalSource,
    event: string,
    where: (
      qb: SelectQueryBuilder<ObjectLiteral>,
    ) => SelectQueryBuilder<ObjectLiteral>,
  ): Promise<Candidate[]> {
    const qb = this.dataSource
      .getRepository(entity)
      .createQueryBuilder(alias)
      .withDeleted()
      .select(`${alias}.id`, 'id')
      .where(`${alias}.tenantId = :tenantId`, { tenantId: ctx.tenantId })
      .setParameters({
        activatedAt: ctx.settings.activatedAt,
        sourceType: type,
        sourceEvent: event,
        retryAfter: retryAfter(),
      })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM journal_entries je
          WHERE je."tenantId" = CAST(:tenantId AS uuid) AND je."sourceType" = :sourceType
            AND je."sourceId" = ${alias}.id AND je."sourceEvent" = :sourceEvent)`,
      )
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM accounting_skipped_sources ss
          WHERE ss."tenantId" = CAST(:tenantId AS uuid) AND ss."sourceType" = :sourceType
            AND ss."sourceId" = ${alias}.id AND ss."sourceEvent" = :sourceEvent)`,
      );
    if (!ctx.force) {
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM accounting_posting_errors pe
          WHERE pe."tenantId" = CAST(:tenantId AS uuid) AND pe."sourceType" = :sourceType
            AND pe."sourceId" = ${alias}.id AND pe."sourceEvent" = :sourceEvent
            AND pe."lastSeenAt" > :retryAfter)`,
      );
    }
    const rows = await where(qb).limit(SYNC_BATCH).getRawMany<{ id: string }>();
    return rows.map((row) => ({ id: row.id, event }));
  }

  /** حركات مخزون مجمّعة بمستندها (تسوية / جرد) لم تُرحَّل */
  private async pickMovementGroups(
    ctx: SyncContext,
    type: JournalSource,
    referenceType: string,
  ): Promise<Candidate[]> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT m."referenceId" AS "id"
         FROM stock_movements m
        WHERE m."tenantId" = $1 AND m."referenceType" = $2
          AND m."referenceId" IS NOT NULL AND m."createdAt" >= $3
          AND NOT EXISTS (SELECT 1 FROM journal_entries je
                WHERE je."tenantId" = $1 AND je."sourceType" = $4
                  AND je."sourceId" = m."referenceId")
          AND NOT EXISTS (SELECT 1 FROM accounting_skipped_sources ss
                WHERE ss."tenantId" = $1 AND ss."sourceType" = $4
                  AND ss."sourceId" = m."referenceId")
          ${this.recentlyFailedSql('m."referenceId"', '$4', ctx.force)}
        GROUP BY m."referenceId"
        ORDER BY MIN(m."createdAt") ASC
        LIMIT ${SYNC_BATCH}`,
      [ctx.tenantId, referenceType, ctx.settings.activatedAt, type],
    );
    const event = type === JournalSource.STOCKTAKE ? 'post' : 'apply';
    return rows.map((row) => ({ id: row.id, event }));
  }

  private recentlyFailedSql(
    idExpr: string,
    typeParam: string,
    force: boolean,
  ): string {
    if (force) return '';
    return `AND NOT EXISTS (SELECT 1 FROM accounting_posting_errors pe
              WHERE pe."tenantId" = $1 AND pe."sourceType" = ${typeParam}
                AND pe."sourceId" = ${idExpr}
                AND pe."lastSeenAt" > now() - interval '${RETRY_AFTER_MINUTES} minutes')`;
  }

  /** الضريبة المستردة من فاتورة شراء: صفر لمنشأة حمّلتها على التكلفة */
  private async recoverableVat(
    manager: EntityManager,
    invoice: PurchaseInvoice,
    taxTotal: number,
  ): Promise<Decimal> {
    if (!Number(taxTotal)) return new Decimal(0);
    const lines = await manager.find(PurchaseInvoiceLine, {
      where: { invoiceId: invoice.id },
      select: ['id', 'baseQuantity', 'unitCost'],
    });
    const cost = sum(
      lines.map((l) => new Decimal(l.baseQuantity).mul(l.unitCost)),
    );
    const total = new Decimal(invoice.total);
    // التكلفة على السطر بلا ضريبة (مسجّلة) أقرب لـ "الإجمالي − الضريبة"، وشاملتها
    // (غير مسجّلة) أقرب للإجمالي
    const registered = cost
      .plus(invoice.taxTotal)
      .minus(total)
      .abs()
      .lt(cost.minus(total).abs());
    return registered ? new Decimal(taxTotal) : new Decimal(0);
  }

  /** قيمة حركات مستند (بالموجب): الداخلة in أو الخارجة out */
  private async movementsValue(
    manager: EntityManager,
    referenceType: string,
    referenceId: string,
    direction: 'in' | 'out',
  ): Promise<Decimal> {
    const [row] = await manager.query<{ value: string | null }[]>(
      `SELECT SUM(ABS("quantity" * "unitCost")) AS "value"
         FROM stock_movements
        WHERE "referenceType" = $1 AND "referenceId" = $2
          AND "quantity" ${direction === 'in' ? '>' : '<'} 0`,
      [referenceType, referenceId],
    );
    return new Decimal(row?.value ?? 0);
  }

  private branchOf(
    ctx: SyncContext,
    warehouseId?: string | null,
  ): string | null {
    return warehouseId ? (ctx.warehouseBranch.get(warehouseId) ?? null) : null;
  }

  private key(ctx: SyncContext, key: SystemAccount | string): string {
    const id = ctx.keys.get(key);
    if (!id) {
      throw new Error(
        `حساب النظام "${key}" غير موجود في الشجرة — أعد إضافته من شجرة الحسابات`,
      );
    }
    return id;
  }

  private receiptAccount(ctx: SyncContext, method: string): string {
    return (
      ctx.settings.receiptAccounts?.[method] ??
      this.key(ctx, DEFAULT_RECEIPT_ACCOUNTS[method] ?? SystemAccount.CASH)
    );
  }

  private paymentAccount(ctx: SyncContext, method: string): string {
    return (
      ctx.settings.paymentAccounts?.[method] ??
      this.key(ctx, DEFAULT_PAYMENT_ACCOUNTS[method] ?? SystemAccount.CASH)
    );
  }
}

// ══════════════════════════ أدوات ══════════════════════════

function base(
  ctx: SyncContext,
  sourceType: JournalSource,
  sourceId: string,
  sourceEvent: string,
  sourceRef: string | null | undefined,
): Omit<LedgerEntryInput, 'date' | 'description' | 'lines'> {
  return {
    tenantId: ctx.tenantId,
    sourceType,
    sourceId,
    sourceEvent,
    sourceRef: sourceRef ?? null,
    automatic: true,
  };
}

function sum(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((total, v) => total.plus(v), new Decimal(0));
}

function retryAfter(): Date {
  return new Date(Date.now() - RETRY_AFTER_MINUTES * 60_000);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505';
}
