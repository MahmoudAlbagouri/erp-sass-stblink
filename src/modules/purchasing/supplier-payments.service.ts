// src/modules/purchasing/supplier-payments.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { scopedWarehouseIds } from '../branches/branch-scope';
import { DataSource, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  CreateSupplierPaymentDto,
  SupplierPaymentQueryDto,
} from './dto/purchasing.dto';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
} from './entities/purchase-invoice.entity';
import {
  PaymentMethod,
  SupplierPayment,
  SupplierPaymentStatus,
} from './entities/supplier-payment.entity';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { SuppliersService } from './suppliers.service';
import { sumMoney } from '../../common/utils/document-totals.util';

const NUMBER_PREFIX = 'SP-';

/**
 * سداد الموردين: على فاتورة محددة (يُخصم من المتبقي عليها)، أو دفعة على
 * الحساب تظهر في كشف حساب المورد فقط.
 */
@Injectable()
export class SupplierPaymentsService {
  constructor(
    @InjectRepository(SupplierPayment)
    private readonly payments: Repository<SupplierPayment>,
    private readonly suppliers: SuppliersService,
    private readonly invoices: PurchaseInvoicesService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    query: SupplierPaymentQueryDto,
  ): Promise<Paginated<SupplierPayment>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.payments
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.supplier', 'supplier')
      .leftJoinAndSelect('payment.invoice', 'invoice')
      .where('payment.tenantId = :tenantId', { tenantId });

    // سداد فاتورة فرع آخر لا يظهر؛ الدفعة على الحساب (بلا فاتورة) للشركة كلها
    const allowed = scopedWarehouseIds();
    if (allowed) {
      qb.andWhere(
        '(payment.invoiceId IS NULL OR invoice.warehouseId IN (:...allowed))',
        { allowed },
      );
    }

    if (query.supplierId) {
      qb.andWhere('payment.supplierId = :supplierId', {
        supplierId: query.supplierId,
      });
    }
    if (query.invoiceId) {
      qb.andWhere('payment.invoiceId = :invoiceId', {
        invoiceId: query.invoiceId,
      });
    }
    if (query.status) {
      qb.andWhere('payment.status = :status', { status: query.status });
    }

    const [data, total] = await qb
      .orderBy('payment.paymentDate', 'DESC')
      .addOrderBy('payment.createdAt', 'DESC')
      .addOrderBy('payment.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<SupplierPayment> {
    const payment = await this.payments.findOne({
      where: { id, tenantId },
      relations: ['supplier', 'invoice'],
    });
    if (!payment) throw new NotFoundException('السداد غير موجود');
    return payment;
  }

  async create(
    dto: CreateSupplierPaymentDto,
    tenantId: string,
    userId?: string,
  ): Promise<SupplierPayment> {
    await this.suppliers.findActive(dto.supplierId, tenantId);

    const id = await this.dataSource.transaction(async (manager) => {
      if (dto.invoiceId) {
        // القفل يمنع سدادين متزامنين من تجاوز المتبقي على الفاتورة
        const invoice = await this.invoices.lock(
          manager,
          dto.invoiceId,
          tenantId,
        );
        if (invoice.supplierId !== dto.supplierId) {
          throw new BadRequestException('الفاتورة ليست لهذا المورد');
        }
        if (invoice.status !== PurchaseInvoiceStatus.POSTED) {
          throw new BadRequestException('السداد يكون على فاتورة معتمدة فقط');
        }
        const remaining = invoice.remaining ?? 0;
        if (dto.amount > remaining) {
          throw new BadRequestException(
            `المبلغ أكبر من المتبقي على الفاتورة (${remaining})`,
          );
        }
        await manager.update(
          PurchaseInvoice,
          { id: invoice.id, tenantId },
          { paidAmount: sumMoney([invoice.paidAmount, dto.amount]) },
        );
      }

      const payment = await manager.save(
        manager.create(SupplierPayment, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'supplier_payments',
            NUMBER_PREFIX,
            tenantId,
          ),
          supplierId: dto.supplierId,
          invoiceId: dto.invoiceId ?? null,
          paymentDate: dto.paymentDate,
          amount: dto.amount,
          method: dto.method ?? PaymentMethod.CASH,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          createdById: userId ?? null,
        }),
      );
      return payment.id;
    });

    return this.findOne(id, tenantId);
  }

  /** إلغاء سداد: يعود المبلغ مستحقاً (وعلى الفاتورة إن كان مرتبطاً بها) */
  async cancel(id: string, tenantId: string): Promise<SupplierPayment> {
    await this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(SupplierPayment, {
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('السداد غير موجود');
      if (payment.status !== SupplierPaymentStatus.POSTED) {
        throw new BadRequestException('هذا السداد ملغي بالفعل');
      }

      if (payment.invoiceId) {
        const invoice = await this.invoices.lock(
          manager,
          payment.invoiceId,
          tenantId,
        );
        await manager.update(
          PurchaseInvoice,
          { id: invoice.id, tenantId },
          {
            paidAmount: Math.max(
              sumMoney([invoice.paidAmount, -payment.amount]),
              0,
            ),
          },
        );
      }

      await manager.update(
        SupplierPayment,
        { id, tenantId },
        { status: SupplierPaymentStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }
}
