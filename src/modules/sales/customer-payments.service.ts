// src/modules/sales/customer-payments.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { sumMoney } from '../../common/utils/document-totals.util';
import {
  assertBranchAllowed,
  assertBranchVisible,
  restrictToScopedBranches,
} from '../branches/branch-scope';
import { CustomersService } from './customers.service';
import {
  CreateCustomerPaymentDto,
  CustomerPaymentQueryDto,
} from './dto/sales.dto';
import {
  CustomerPayment,
  CustomerPaymentStatus,
  PaymentDirection,
  SalesPaymentMethod,
} from './entities/customer-payment.entity';
import {
  SalesInvoice,
  SalesInvoiceStatus,
} from './entities/sales-invoice.entity';
import { SalesInvoicesService } from './sales-invoices.service';
import { recordPayment } from './utils/payment-recorder';

/**
 * مقبوضات العملاء: قبض على فاتورة آجلة (يُخصم من المتبقي عليها)، أو دفعة على
 * الحساب تظهر في كشف حساب العميل فقط. ما يُقبض لحظة إصدار الفاتورة يُسجَّل
 * من خدمة الفواتير نفسها.
 */
@Injectable()
export class CustomerPaymentsService {
  constructor(
    @InjectRepository(CustomerPayment)
    private readonly payments: Repository<CustomerPayment>,
    private readonly customers: CustomersService,
    private readonly invoices: SalesInvoicesService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    query: CustomerPaymentQueryDto,
  ): Promise<Paginated<CustomerPayment>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.payments
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.customer', 'customer')
      .leftJoinAndSelect('payment.invoice', 'invoice')
      .where('payment.tenantId = :tenantId', { tenantId });
    restrictToScopedBranches(qb, 'payment.branchId');

    if (query.branchId) {
      qb.andWhere('payment.branchId = :branchId', { branchId: query.branchId });
    }

    if (query.customerId) {
      qb.andWhere('payment.customerId = :customerId', {
        customerId: query.customerId,
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
    if (query.direction) {
      qb.andWhere('payment.direction = :direction', {
        direction: query.direction,
      });
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

  async findOne(id: string, tenantId: string): Promise<CustomerPayment> {
    const payment = await this.payments.findOne({
      where: { id, tenantId },
      relations: ['customer', 'invoice'],
    });
    if (!payment) throw new NotFoundException('سند القبض غير موجود');
    assertBranchVisible(payment.branchId, 'سند القبض غير موجود');
    return payment;
  }

  async create(
    dto: CreateCustomerPaymentDto,
    tenantId: string,
    userId?: string,
  ): Promise<CustomerPayment> {
    if (!dto.invoiceId && !dto.customerId) {
      throw new BadRequestException('اختر العميل أو الفاتورة');
    }
    if (dto.branchId) assertBranchAllowed(dto.branchId);
    if (dto.customerId) {
      await this.customers.findActive(dto.customerId, tenantId);
    }

    const id = await this.dataSource.transaction(async (manager) => {
      let customerId = dto.customerId ?? null;

      if (dto.invoiceId) {
        // القفل يمنع قبضين متزامنين من تجاوز المتبقي على الفاتورة
        const invoice = await this.invoices.lock(
          manager,
          dto.invoiceId,
          tenantId,
        );
        if (dto.customerId && invoice.customerId !== dto.customerId) {
          throw new BadRequestException('الفاتورة ليست لهذا العميل');
        }
        if (invoice.status !== SalesInvoiceStatus.ISSUED) {
          throw new BadRequestException('القبض يكون على فاتورة صادرة فقط');
        }
        const remaining = invoice.remaining ?? 0;
        if (dto.amount > remaining) {
          throw new BadRequestException(
            `المبلغ أكبر من المتبقي على الفاتورة (${remaining})`,
          );
        }
        customerId = invoice.customerId ?? null;
        await manager.update(
          SalesInvoice,
          { id: invoice.id, tenantId },
          { paidAmount: sumMoney([invoice.paidAmount, dto.amount]) },
        );
      }

      const payment = await recordPayment(manager, tenantId, {
        customerId,
        invoiceId: dto.invoiceId,
        branchId: dto.branchId,
        direction: PaymentDirection.IN,
        paymentDate: dto.paymentDate,
        amount: dto.amount,
        method: dto.method ?? SalesPaymentMethod.CASH,
        reference: dto.reference,
        note: dto.note,
        createdById: userId,
      });
      return payment.id;
    });

    return this.findOne(id, tenantId);
  }

  /** إلغاء قبض: يعود المبلغ على العميل (وعلى الفاتورة إن كان مرتبطاً بها) */
  async cancel(id: string, tenantId: string): Promise<CustomerPayment> {
    await this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(CustomerPayment, {
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException('سند القبض غير موجود');
      assertBranchVisible(payment.branchId, 'سند القبض غير موجود');
      if (payment.status !== CustomerPaymentStatus.POSTED) {
        throw new BadRequestException('هذا السند ملغي بالفعل');
      }
      if (payment.direction === PaymentDirection.OUT) {
        throw new BadRequestException(
          'مبلغ رُدّ للعميل عند مرتجع لا يُلغى من هنا',
        );
      }
      if (!payment.customerId) {
        // فاتورة نقدية لعميل عابر: إلغاء قبضها يتركها آجلة بلا عميل يُطالَب
        throw new BadRequestException(
          'لا يمكن إلغاء قبض فاتورة نقدية بلا عميل — سجّل مرتجع بيع',
        );
      }

      if (payment.invoiceId) {
        const invoice = await this.invoices.lock(
          manager,
          payment.invoiceId,
          tenantId,
        );
        await manager.update(
          SalesInvoice,
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
        CustomerPayment,
        { id, tenantId },
        { status: CustomerPaymentStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }
}
