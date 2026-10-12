// src/modules/inventory/transfers.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  CreateTransferDto,
  ReceiveTransferDto,
  TransferLineDto,
  TransferQueryDto,
  UpdateTransferDto,
} from './dto/inventory.dto';
import { StockMovementType } from './entities/stock-movement.entity';
import {
  StockTransfer,
  StockTransferLine,
  StockTransferStatus,
} from './entities/stock-transfer.entity';
import { assertNoDuplicateProducts, StockService } from './stock.service';
import { WarehousesService } from './warehouses.service';

const REFERENCE_TYPE = 'transfer';
const NUMBER_PREFIX = 'TR-';

/**
 * التحويل بين المخازن على خطوتين:
 *   مسودة ──إرسال──▶ في الطريق ──استلام──▶ مستلَم
 * الإرسال يخصم من المرسِل، والاستلام يضيف للمستلِم ما وصل فعلاً. بينهما
 * البضاعة "في الطريق": ليست في أي مخزن لكنها ما زالت ضمن مخزون الشركة.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(StockTransfer)
    private readonly transfers: Repository<StockTransfer>,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: TransferQueryDto,
  ): Promise<Paginated<StockTransfer>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.transfers
      .createQueryBuilder('transfer')
      .leftJoinAndSelect('transfer.fromWarehouse', 'fromWarehouse')
      .leftJoinAndSelect('transfer.toWarehouse', 'toWarehouse')
      .loadRelationCountAndMap('transfer.linesCount', 'transfer.lines')
      .where('transfer.tenantId = :tenantId', { tenantId });

    if (query.status) {
      qb.andWhere('transfer.status = :status', { status: query.status });
    }
    if (query.warehouseId) {
      qb.andWhere(
        '(transfer.fromWarehouseId = :warehouseId OR transfer.toWarehouseId = :warehouseId)',
        { warehouseId: query.warehouseId },
      );
    }

    const [data, total] = await qb
      .orderBy('transfer.createdAt', 'DESC')
      .addOrderBy('transfer.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<StockTransfer> {
    const transfer = await this.transfers.findOne({
      where: { id, tenantId },
      relations: [
        'fromWarehouse',
        'toWarehouse',
        'lines',
        'lines.product',
        'lines.product.baseUnit',
      ],
    });
    if (!transfer) throw new NotFoundException('التحويل غير موجود');
    return transfer;
  }

  // ══════════════════════════ المسودة ══════════════════════════

  async create(
    dto: CreateTransferDto,
    tenantId: string,
    userId?: string,
  ): Promise<StockTransfer> {
    await this.assertValid(
      dto.fromWarehouseId,
      dto.toWarehouseId,
      dto.lines,
      tenantId,
    );

    const id = await this.dataSource.transaction(async (manager) => {
      const transfer = await manager.save(
        manager.create(StockTransfer, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'stock_transfers',
            NUMBER_PREFIX,
            tenantId,
          ),
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          note: dto.note ?? null,
          createdById: userId ?? null,
        }),
      );
      await this.replaceLines(manager, transfer.id, tenantId, dto.lines);
      return transfer.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateTransferDto,
    tenantId: string,
  ): Promise<StockTransfer> {
    const current = await this.findOne(id, tenantId);
    assertStatus(current, StockTransferStatus.DRAFT, 'تعديل');

    const fromWarehouseId = dto.fromWarehouseId ?? current.fromWarehouseId;
    const toWarehouseId = dto.toWarehouseId ?? current.toWarehouseId;
    await this.assertValid(
      fromWarehouseId,
      toWarehouseId,
      dto.lines ?? [],
      tenantId,
    );

    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lock(manager, id, tenantId);
      assertStatus(transfer, StockTransferStatus.DRAFT, 'تعديل');

      await manager.update(
        StockTransfer,
        { id, tenantId },
        {
          fromWarehouseId,
          toWarehouseId,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      );
      if (dto.lines) {
        await this.replaceLines(manager, id, tenantId, dto.lines);
      }
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ دورة التحويل ══════════════════════════

  /** إخراج البضاعة من المخزن المرسِل */
  async send(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<StockTransfer> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lock(manager, id, tenantId);
      assertStatus(transfer, StockTransferStatus.DRAFT, 'إرسال');
      const lines = await this.linesOf(manager, id);

      const results = await this.stock.apply(
        manager,
        tenantId,
        lines.map((line) => ({
          warehouseId: transfer.fromWarehouseId,
          productId: line.productId,
          type: StockMovementType.TRANSFER_OUT,
          quantity: -line.quantity,
          note: `تحويل ${transfer.number}`,
        })),
        { referenceType: REFERENCE_TYPE, referenceId: id, userId },
      );

      for (const [index, line] of lines.entries()) {
        await manager.update(
          StockTransferLine,
          { id: line.id },
          { unitCost: results[index].unitCost },
        );
        await this.stock.adjustInTransit(
          manager,
          tenantId,
          line.productId,
          line.quantity,
        );
      }

      await manager.update(
        StockTransfer,
        { id, tenantId },
        {
          status: StockTransferStatus.IN_TRANSIT,
          sentAt: new Date(),
          sentById: userId ?? null,
        },
      );
    });

    return this.findOne(id, tenantId);
  }

  /**
   * استلام البضاعة في المخزن المستلِم. ما لم يُذكر في dto.lines يُستلم كاملاً.
   * الكمية الأقل من المرسلة = عجز: لا تدخل أي مخزن وتظهر على التحويل.
   */
  async receive(
    id: string,
    dto: ReceiveTransferDto,
    tenantId: string,
    userId?: string,
  ): Promise<StockTransfer> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lock(manager, id, tenantId);
      assertStatus(transfer, StockTransferStatus.IN_TRANSIT, 'استلام');
      const lines = await this.linesOf(manager, id);

      const overrides = new Map(
        (dto.lines ?? []).map((l) => [l.productId, l.receivedQuantity]),
      );
      for (const productId of overrides.keys()) {
        if (!lines.some((line) => line.productId === productId)) {
          throw new BadRequestException('صنف ليس ضمن هذا التحويل');
        }
      }

      const received = lines.map((line) => {
        const quantity = overrides.get(line.productId) ?? line.quantity;
        if (quantity > line.quantity) {
          throw new BadRequestException(
            'الكمية المستلمة لا يمكن أن تتجاوز المرسلة',
          );
        }
        return { line, quantity };
      });

      await this.stock.apply(
        manager,
        tenantId,
        received
          .filter(({ quantity }) => quantity > 0)
          .map(({ line, quantity }) => ({
            warehouseId: transfer.toWarehouseId,
            productId: line.productId,
            type: StockMovementType.TRANSFER_IN,
            quantity,
            note:
              quantity < line.quantity
                ? `تحويل ${transfer.number} — استُلم ${quantity} من ${line.quantity}`
                : `تحويل ${transfer.number}`,
          })),
        { referenceType: REFERENCE_TYPE, referenceId: id, userId },
      );

      for (const { line, quantity } of received) {
        await manager.update(
          StockTransferLine,
          { id: line.id },
          { receivedQuantity: quantity },
        );
        // المرسَل كله يخرج من "في الطريق": المستلَم دخل المخزن والعجز فُقد
        await this.stock.adjustInTransit(
          manager,
          tenantId,
          line.productId,
          -line.quantity,
        );
      }

      await manager.update(
        StockTransfer,
        { id, tenantId },
        {
          status: StockTransferStatus.RECEIVED,
          receivedAt: new Date(),
          receivedById: userId ?? null,
        },
      );
    });

    return this.findOne(id, tenantId);
  }

  /** إلغاء مسودة، أو إلغاء تحويل في الطريق مع إعادة البضاعة للمرسِل */
  async cancel(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<StockTransfer> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lock(manager, id, tenantId);

      if (transfer.status === StockTransferStatus.IN_TRANSIT) {
        const lines = await this.linesOf(manager, id);
        await this.stock.apply(
          manager,
          tenantId,
          lines.map((line) => ({
            warehouseId: transfer.fromWarehouseId,
            productId: line.productId,
            type: StockMovementType.TRANSFER_IN,
            quantity: line.quantity,
            note: `إلغاء تحويل ${transfer.number}`,
          })),
          { referenceType: REFERENCE_TYPE, referenceId: id, userId },
        );
        for (const line of lines) {
          await this.stock.adjustInTransit(
            manager,
            tenantId,
            line.productId,
            -line.quantity,
          );
        }
      } else {
        assertStatus(transfer, StockTransferStatus.DRAFT, 'إلغاء');
      }

      await manager.update(
        StockTransfer,
        { id, tenantId },
        { status: StockTransferStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async assertValid(
    fromWarehouseId: string,
    toWarehouseId: string,
    lines: TransferLineDto[],
    tenantId: string,
  ): Promise<void> {
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException('اختر مخزنين مختلفين للتحويل');
    }
    await this.warehouses.findActiveByIds(
      [fromWarehouseId, toWarehouseId],
      tenantId,
    );

    const productIds = lines.map((l) => l.productId);
    assertNoDuplicateProducts(productIds);
    await this.stock.loadStockedProducts(productIds, tenantId);
  }

  /** يقفل التحويل حتى نهاية المعاملة: لا يُرسَل أو يُستلَم مرتين بالتزامن */
  private async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<StockTransfer> {
    const transfer = await manager.findOne(StockTransfer, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!transfer) throw new NotFoundException('التحويل غير موجود');
    return transfer;
  }

  private linesOf(
    manager: EntityManager,
    transferId: string,
  ): Promise<StockTransferLine[]> {
    return manager.find(StockTransferLine, { where: { transferId } });
  }

  private async replaceLines(
    manager: EntityManager,
    transferId: string,
    tenantId: string,
    lines: TransferLineDto[],
  ): Promise<void> {
    await manager.delete(StockTransferLine, { transferId, tenantId });
    await manager.save(
      lines.map((line) =>
        manager.create(StockTransferLine, {
          transferId,
          tenantId,
          productId: line.productId,
          quantity: line.quantity,
        }),
      ),
    );
  }
}

const STATUS_LABEL: Record<StockTransferStatus, string> = {
  [StockTransferStatus.DRAFT]: 'مسودة',
  [StockTransferStatus.IN_TRANSIT]: 'في الطريق',
  [StockTransferStatus.RECEIVED]: 'مستلَم',
  [StockTransferStatus.CANCELLED]: 'ملغي',
};

function assertStatus(
  transfer: StockTransfer,
  expected: StockTransferStatus,
  action: string,
): void {
  if (transfer.status !== expected) {
    throw new BadRequestException(
      `لا يمكن ${action} تحويل حالته "${STATUS_LABEL[transfer.status]}"`,
    );
  }
}
