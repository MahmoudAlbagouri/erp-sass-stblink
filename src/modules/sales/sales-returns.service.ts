// src/modules/sales/sales-returns.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  computeReturnShare,
  sumMoney,
} from '../../common/utils/document-totals.util';
import { StockMovementType } from '../inventory/entities/stock-movement.entity';
import { StockService } from '../inventory/stock.service';
import {
  CreateSalesReturnDto,
  IssueSalesReturnDto,
  SalesReturnQueryDto,
} from './dto/sales.dto';
import { PaymentDirection } from './entities/customer-payment.entity';
import {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceStatus,
} from './entities/sales-invoice.entity';
import {
  SalesReturn,
  SalesReturnLine,
  SalesReturnStatus,
} from './entities/sales-return.entity';
import { SalesInvoicesService } from './sales-invoices.service';
import { dateOnly, recordPayment } from './utils/payment-recorder';

const REFERENCE_TYPE = 'sales_return';
const NUMBER_PREFIX = 'CN-';

/**
 * مرتجعات البيع (إشعارات دائنة): إعادة بضاعة من فاتورة صادرة. المرتجع يرث
 * السعر والضريبة والتكلفة من سطر الفاتورة؛ عند إصداره تعود البضاعة للمخزن
 * وينقص ما على العميل، ويمكن ردّ المدفوع الزائد نقداً.
 */
@Injectable()
export class SalesReturnsService {
  constructor(
    @InjectRepository(SalesReturn)
    private readonly returns: Repository<SalesReturn>,
    private readonly invoices: SalesInvoicesService,
    private readonly stock: StockService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    query: SalesReturnQueryDto,
  ): Promise<Paginated<SalesReturn>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.returns
      .createQueryBuilder('ret')
      .leftJoinAndSelect('ret.customer', 'customer')
      .leftJoinAndSelect('ret.invoice', 'invoice')
      .leftJoinAndSelect('ret.warehouse', 'warehouse')
      .loadRelationCountAndMap('ret.linesCount', 'ret.lines')
      .where('ret.tenantId = :tenantId', { tenantId });

    if (query.status) {
      qb.andWhere('ret.status = :status', { status: query.status });
    }
    if (query.customerId) {
      qb.andWhere('ret.customerId = :customerId', {
        customerId: query.customerId,
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

  async findOne(id: string, tenantId: string): Promise<SalesReturn> {
    const salesReturn = await this.returns.findOne({
      where: { id, tenantId },
      relations: ['customer', 'invoice', 'warehouse', 'lines'],
    });
    if (!salesReturn) throw new NotFoundException('المرتجع غير موجود');
    return salesReturn;
  }

  /** ينشئ مرتجعاً كمسودة (لا أثر له حتى يصدر) */
  async create(
    dto: CreateSalesReturnDto,
    tenantId: string,
    userId?: string,
  ): Promise<SalesReturn> {
    const invoice = await this.invoices.findOne(dto.invoiceId, tenantId);
    assertReturnable(invoice);

    const lineIds = dto.lines.map((l) => l.invoiceLineId);
    if (new Set(lineIds).size !== lineIds.length) {
      throw new BadRequestException('لا يمكن تكرار نفس السطر في المرتجع');
    }

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
        productName: source.productName,
        unitName: source.unitName,
        quantity: input.quantity,
        baseQuantity: new Decimal(input.quantity)
          .mul(source.factor)
          .toDecimalPlaces(4)
          .toNumber(),
        ...computeReturnShare(source, input.quantity),
      };
    });

    const id = await this.dataSource.transaction(async (manager) => {
      const salesReturn = await manager.save(
        manager.create(SalesReturn, {
          tenantId,
          invoiceId: invoice.id,
          customerId: invoice.customerId ?? null,
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
          manager.create(SalesReturnLine, {
            ...line,
            returnId: salesReturn.id,
            tenantId,
          }),
        ),
      );
      return salesReturn.id;
    });

    return this.findOne(id, tenantId);
  }

  /**
   * إصدار المرتجع: عودة البضاعة للمخزن بتكلفتها الأصلية، تخفيض ما على
   * العميل، وردّ المدفوع الزائد إن طُلب.
   */
  async issue(
    id: string,
    dto: IssueSalesReturnDto,
    tenantId: string,
    userId?: string,
  ): Promise<SalesReturn> {
    await this.dataSource.transaction(async (manager) => {
      const salesReturn = await this.lock(manager, id, tenantId);
      assertDraft(salesReturn, 'إصدار');

      // قفل الفاتورة: مرتجعان متزامنان لا يُرجعان معاً أكثر من المباع
      const invoice = await this.invoices.lock(
        manager,
        salesReturn.invoiceId,
        tenantId,
      );
      assertReturnable(invoice);

      const lines = await manager.find(SalesReturnLine, {
        where: { returnId: id },
      });
      const invoiceLines = new Map(
        (
          await manager.find(SalesInvoiceLine, {
            where: { invoiceId: invoice.id },
          })
        ).map((l) => [l.id, l]),
      );

      for (const line of lines) {
        const source = invoiceLines.get(line.invoiceLineId)!;
        assertWithinRemaining(source, line.quantity);
        await manager.update(
          SalesInvoiceLine,
          { id: source.id },
          {
            returnedQuantity: new Decimal(source.returnedQuantity)
              .plus(line.quantity)
              .toNumber(),
          },
        );
      }

      const issuedAt = new Date();
      await this.stock.apply(
        manager,
        tenantId,
        lines
          .filter((line) => invoiceLines.get(line.invoiceLineId)!.isStocked)
          .map((line) => ({
            warehouseId: salesReturn.warehouseId,
            productId: line.productId,
            type: StockMovementType.SALE_RETURN,
            quantity: line.baseQuantity,
            // تعود بالتكلفة التي خرجت بها، فلا يتشوّه متوسط التكلفة
            unitCost: invoiceLines.get(line.invoiceLineId)!.unitCost,
          })),
        {
          referenceType: REFERENCE_TYPE,
          referenceId: id,
          userId,
          occurredAt: issuedAt,
        },
      );

      // ─── المبالغ: صافي الفاتورة ينقص، وما دُفع زائداً يُردّ ───
      const returnedAmount = sumMoney([
        invoice.returnedAmount,
        salesReturn.total,
      ]);
      const net = sumMoney([invoice.total, -returnedAmount]);
      const overpaid = Math.max(sumMoney([invoice.paidAmount, -net]), 0);
      const refund = dto.refund?.amount ?? 0;

      if (refund > overpaid) {
        throw new BadRequestException(
          `المبلغ المردود (${refund}) أكبر من المدفوع الزائد بعد المرتجع (${overpaid})`,
        );
      }
      if (!invoice.customerId && refund < overpaid) {
        // عميل عابر بلا حساب: لا مكان يُحفظ فيه رصيده
        throw new BadRequestException(
          `فاتورة نقدية بلا عميل: يجب ردّ ${overpaid} للعميل عند المرتجع`,
        );
      }

      const number = await nextDocumentNumber(
        manager,
        'sales_returns',
        NUMBER_PREFIX,
        tenantId,
      );

      if (dto.refund && refund > 0) {
        await recordPayment(manager, tenantId, {
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          salesReturnId: id,
          direction: PaymentDirection.OUT,
          paymentDate: dateOnly(issuedAt),
          amount: refund,
          method: dto.refund.method,
          reference: dto.refund.reference,
          note: `ردّ مبلغ المرتجع ${number}`,
          createdById: userId,
        });
      }

      await manager.update(
        SalesInvoice,
        { id: invoice.id, tenantId },
        {
          returnedAmount,
          paidAmount: sumMoney([invoice.paidAmount, -refund]),
        },
      );
      await manager.update(
        SalesReturn,
        { id, tenantId },
        {
          number,
          status: SalesReturnStatus.ISSUED,
          refundedAmount: refund,
          issuedAt,
          issuedById: userId ?? null,
        },
      );
    });

    return this.findOne(id, tenantId);
  }

  async cancel(id: string, tenantId: string): Promise<SalesReturn> {
    await this.dataSource.transaction(async (manager) => {
      assertDraft(await this.lock(manager, id, tenantId), 'إلغاء');
      await manager.update(
        SalesReturn,
        { id, tenantId },
        { status: SalesReturnStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }

  private async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<SalesReturn> {
    const salesReturn = await manager.findOne(SalesReturn, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!salesReturn) throw new NotFoundException('المرتجع غير موجود');
    return salesReturn;
  }
}

function assertReturnable(invoice: SalesInvoice): void {
  if (invoice.status !== SalesInvoiceStatus.ISSUED) {
    throw new BadRequestException('المرتجع يكون من فاتورة بيع صادرة فقط');
  }
}

function assertWithinRemaining(line: SalesInvoiceLine, quantity: number): void {
  const remaining = new Decimal(line.quantity).minus(line.returnedQuantity);
  if (remaining.lt(quantity)) {
    throw new BadRequestException(
      `الكمية المُرجعة أكبر من المتاح للإرجاع (${remaining.toNumber()})`,
    );
  }
}

const STATUS_LABEL: Record<SalesReturnStatus, string> = {
  [SalesReturnStatus.DRAFT]: 'مسودة',
  [SalesReturnStatus.ISSUED]: 'صادر',
  [SalesReturnStatus.CANCELLED]: 'ملغي',
};

function assertDraft(salesReturn: SalesReturn, action: string): void {
  if (salesReturn.status !== SalesReturnStatus.DRAFT) {
    throw new BadRequestException(
      `لا يمكن ${action} مرتجع حالته "${STATUS_LABEL[salesReturn.status]}"`,
    );
  }
}
