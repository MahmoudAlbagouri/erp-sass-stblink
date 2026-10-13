// src/modules/purchasing/purchase-returns.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  assertWarehouseVisible,
  restrictToScopedWarehouses,
} from '../branches/branch-scope';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { StockMovementType } from '../inventory/entities/stock-movement.entity';
import { StockService } from '../inventory/stock.service';
import {
  CreatePurchaseReturnDto,
  PurchaseReturnQueryDto,
} from './dto/purchasing.dto';
import {
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchaseInvoiceStatus,
} from './entities/purchase-invoice.entity';
import {
  PurchaseReturn,
  PurchaseReturnLine,
  PurchaseReturnStatus,
} from './entities/purchase-return.entity';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import {
  computeReturnShare,
  sumMoney,
} from '../../common/utils/document-totals.util';
import { moneyDecimalsOf } from '../../common/utils/money.util';

const REFERENCE_TYPE = 'purchase_return';
const NUMBER_PREFIX = 'PR-';

/**
 * مرتجعات الشراء: إعادة بضاعة من فاتورة معتمدة إلى المورد. المرتجع يرث السعر
 * والضريبة من سطر الفاتورة، وعند اعتماده تخرج البضاعة من المخزن وينقص
 * المستحق للمورد.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    @InjectRepository(PurchaseReturn)
    private readonly returns: Repository<PurchaseReturn>,
    private readonly invoices: PurchaseInvoicesService,
    private readonly stock: StockService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    query: PurchaseReturnQueryDto,
  ): Promise<Paginated<PurchaseReturn>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.returns
      .createQueryBuilder('ret')
      .leftJoinAndSelect('ret.supplier', 'supplier')
      .leftJoinAndSelect('ret.invoice', 'invoice')
      .leftJoinAndSelect('ret.warehouse', 'warehouse')
      .loadRelationCountAndMap('ret.linesCount', 'ret.lines')
      .where('ret.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'ret.warehouseId');

    if (query.status) {
      qb.andWhere('ret.status = :status', { status: query.status });
    }
    if (query.supplierId) {
      qb.andWhere('ret.supplierId = :supplierId', {
        supplierId: query.supplierId,
      });
    }
    if (query.invoiceId) {
      qb.andWhere('ret.invoiceId = :invoiceId', {
        invoiceId: query.invoiceId,
      });
    }

    const [data, total] = await qb
      .orderBy('ret.returnDate', 'DESC')
      .addOrderBy('ret.createdAt', 'DESC')
      .addOrderBy('ret.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<PurchaseReturn> {
    const purchaseReturn = await this.returns.findOne({
      where: { id, tenantId },
      relations: [
        'supplier',
        'invoice',
        'warehouse',
        'lines',
        'lines.product',
        'lines.unit',
      ],
    });
    if (!purchaseReturn) throw new NotFoundException('المرتجع غير موجود');
    assertWarehouseVisible(purchaseReturn.warehouseId, 'المرتجع غير موجود');
    return purchaseReturn;
  }

  /** ينشئ مرتجعاً كمسودة (لا أثر له حتى يُعتمد) */
  async create(
    dto: CreatePurchaseReturnDto,
    tenantId: string,
    userId?: string,
  ): Promise<PurchaseReturn> {
    const invoice = await this.invoices.findOne(dto.invoiceId, tenantId);
    assertReturnable(invoice);

    const lineIds = dto.lines.map((l) => l.invoiceLineId);
    if (new Set(lineIds).size !== lineIds.length) {
      throw new BadRequestException('لا يمكن تكرار نفس السطر في المرتجع');
    }

    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);
    const invoiceLines = new Map((invoice.lines ?? []).map((l) => [l.id, l]));
    const lines = dto.lines.map((input) => {
      const source = invoiceLines.get(input.invoiceLineId);
      if (!source) {
        throw new BadRequestException('سطر ليس ضمن هذه الفاتورة');
      }
      assertWithinRemaining(source, input.quantity);

      return {
        invoiceLineId: source.id,
        productId: source.productId,
        unitId: source.unitId,
        quantity: input.quantity,
        baseQuantity: new Decimal(input.quantity)
          .mul(source.factor)
          .toDecimalPlaces(4)
          .toNumber(),
        ...computeReturnShare(source, input.quantity, decimals),
      };
    });

    const id = await this.dataSource.transaction(async (manager) => {
      const purchaseReturn = await manager.save(
        manager.create(PurchaseReturn, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'purchase_returns',
            NUMBER_PREFIX,
            tenantId,
          ),
          invoiceId: invoice.id,
          supplierId: invoice.supplierId,
          warehouseId: invoice.warehouseId,
          returnDate: dto.returnDate,
          reason: dto.reason ?? null,
          createdById: userId ?? null,
          subtotal: sumMoney(lines.map((l) => l.subtotal)),
          taxTotal: sumMoney(lines.map((l) => l.taxAmount)),
          total: sumMoney(lines.map((l) => l.total)),
        }),
      );
      await manager.save(
        lines.map((line) =>
          manager.create(PurchaseReturnLine, {
            ...line,
            returnId: purchaseReturn.id,
            tenantId,
          }),
        ),
      );
      return purchaseReturn.id;
    });

    return this.findOne(id, tenantId);
  }

  /** اعتماد المرتجع: إخراج البضاعة من المخزن وتخفيض المستحق للمورد */
  async post(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<PurchaseReturn> {
    await this.dataSource.transaction(async (manager) => {
      const purchaseReturn = await this.lock(manager, id, tenantId);
      assertDraft(purchaseReturn, 'اعتماد');

      // قفل الفاتورة: مرتجعان متزامنان لا يُرجعان معاً أكثر من المشترى
      const invoice = await this.invoices.lock(
        manager,
        purchaseReturn.invoiceId,
        tenantId,
      );
      assertReturnable(invoice);

      const lines = await manager.find(PurchaseReturnLine, {
        where: { returnId: id },
      });
      const invoiceLines = new Map(
        (
          await manager.find(PurchaseInvoiceLine, {
            where: { invoiceId: invoice.id },
          })
        ).map((l) => [l.id, l]),
      );

      for (const line of lines) {
        const source = invoiceLines.get(line.invoiceLineId)!;
        assertWithinRemaining(source, line.quantity);
        await manager.update(
          PurchaseInvoiceLine,
          { id: source.id },
          {
            returnedQuantity: new Decimal(source.returnedQuantity)
              .plus(line.quantity)
              .toNumber(),
          },
        );
      }

      await this.stock.apply(
        manager,
        tenantId,
        lines.map((line) => ({
          warehouseId: purchaseReturn.warehouseId,
          productId: line.productId,
          type: StockMovementType.PURCHASE_RETURN,
          quantity: -line.baseQuantity,
          note: `مرتجع شراء ${purchaseReturn.number}`,
        })),
        { referenceType: REFERENCE_TYPE, referenceId: id, userId },
      );

      await manager.update(
        PurchaseInvoice,
        { id: invoice.id, tenantId },
        {
          returnedAmount: sumMoney([
            invoice.returnedAmount,
            purchaseReturn.total,
          ]),
        },
      );
      await manager.update(
        PurchaseReturn,
        { id, tenantId },
        {
          status: PurchaseReturnStatus.POSTED,
          postedAt: new Date(),
          postedById: userId ?? null,
        },
      );
    });

    return this.findOne(id, tenantId);
  }

  async cancel(id: string, tenantId: string): Promise<PurchaseReturn> {
    await this.dataSource.transaction(async (manager) => {
      assertDraft(await this.lock(manager, id, tenantId), 'إلغاء');
      await manager.update(
        PurchaseReturn,
        { id, tenantId },
        { status: PurchaseReturnStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }

  private async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<PurchaseReturn> {
    const purchaseReturn = await manager.findOne(PurchaseReturn, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!purchaseReturn) throw new NotFoundException('المرتجع غير موجود');
    assertWarehouseVisible(purchaseReturn.warehouseId, 'المرتجع غير موجود');
    return purchaseReturn;
  }
}

function assertReturnable(invoice: PurchaseInvoice): void {
  if (invoice.status !== PurchaseInvoiceStatus.POSTED) {
    throw new BadRequestException('المرتجع يكون من فاتورة شراء معتمدة فقط');
  }
}

function assertWithinRemaining(
  line: PurchaseInvoiceLine,
  quantity: number,
): void {
  const remaining = new Decimal(line.quantity).minus(line.returnedQuantity);
  if (remaining.lt(quantity)) {
    throw new BadRequestException(
      `الكمية المُرجعة أكبر من المتاح للإرجاع (${remaining.toNumber()})`,
    );
  }
}

const STATUS_LABEL: Record<PurchaseReturnStatus, string> = {
  [PurchaseReturnStatus.DRAFT]: 'مسودة',
  [PurchaseReturnStatus.POSTED]: 'معتمد',
  [PurchaseReturnStatus.CANCELLED]: 'ملغي',
};

function assertDraft(purchaseReturn: PurchaseReturn, action: string): void {
  if (purchaseReturn.status !== PurchaseReturnStatus.DRAFT) {
    throw new BadRequestException(
      `لا يمكن ${action} مرتجع حالته "${STATUS_LABEL[purchaseReturn.status]}"`,
    );
  }
}
