// src/modules/sales/customers.service.ts
import {
  BadRequestException,
  ConflictException,
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
import { sumMoney } from '../../common/utils/document-totals.util';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  StatementQueryDto,
  UpdateCustomerDto,
} from './dto/sales.dto';
import { Customer } from './entities/customer.entity';

const CODE_PREFIX = 'CUS-';

/**
 * ما على العميل — يُحسب دائماً من المستندات الصادرة (لا عمود رصيد يُحدَّث
 * يدوياً فيخرج عن الحقيقة). `customer` هو اسم الجدول المستعار في الاستعلام.
 */
const BALANCE_SQL = `(
  "customer"."openingBalance"
  + COALESCE((SELECT SUM(i."total") FROM sales_invoices i
               WHERE i."customerId" = "customer"."id" AND i."status" = 'issued'), 0)
  - COALESCE((SELECT SUM(r."total") FROM sales_returns r
               WHERE r."customerId" = "customer"."id" AND r."status" = 'issued'), 0)
  - COALESCE((SELECT SUM(CASE WHEN p."direction" = 'in' THEN p."amount" ELSE -p."amount" END)
                FROM customer_payments p
               WHERE p."customerId" = "customer"."id" AND p."status" = 'posted'), 0)
)`;

export type CustomerStatementEntryType =
  | 'invoice'
  | 'return'
  | 'payment'
  | 'refund';

export interface CustomerStatementEntry {
  type: CustomerStatementEntryType;
  id: string;
  number: string;
  date: string;
  reference: string | null;
  /** يزيد ما على العميل (فاتورة / مبلغ رُدّ له) */
  debit: number;
  /** ينقص ما على العميل (قبض / مرتجع) */
  credit: number;
  /** ما على العميل بعد هذا القيد */
  balance: number;
}

export interface CustomerStatement {
  customer: Customer;
  from: string | null;
  to: string | null;
  openingBalance: number;
  entries: CustomerStatementEntry[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

interface StatementRow {
  type: CustomerStatementEntryType;
  id: string;
  number: string;
  date: string;
  reference: string | null;
  amount: string;
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: CustomerQueryDto,
  ): Promise<Paginated<Customer>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.customers
      .createQueryBuilder('customer')
      .addSelect(BALANCE_SQL, 'balance')
      .where('customer.tenantId = :tenantId', { tenantId });

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(customer.name ILIKE :like OR customer.code ILIKE :like
          OR customer.phone ILIKE :like OR customer.taxNumber ILIKE :like)`,
        { like: `%${search}%` },
      );
    }
    if (query.isActive !== undefined) {
      qb.andWhere('customer.isActive = :isActive', {
        isActive: query.isActive === 'true',
      });
    }
    if (query.withBalance) {
      qb.andWhere(`${BALANCE_SQL} <> 0`);
    }

    const total = await qb.getCount();
    const { entities, raw } = await qb
      .orderBy('customer.name', 'ASC')
      .addOrderBy('customer.id', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawAndEntities<{ balance: string }>();

    entities.forEach((customer, index) => {
      customer.balance = Number(raw[index].balance);
    });
    return paginated(entities, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<Customer> {
    const { entities, raw } = await this.customers
      .createQueryBuilder('customer')
      .addSelect(BALANCE_SQL, 'balance')
      .where('customer.id = :id AND customer.tenantId = :tenantId', {
        id,
        tenantId,
      })
      .getRawAndEntities<{ balance: string }>();

    const customer = entities[0];
    if (!customer) throw new NotFoundException('العميل غير موجود');
    customer.balance = Number(raw[0].balance);
    return customer;
  }

  /**
   * ما على العميل الآن (يشمل المحذوف: فاتورته القديمة تُطبع برصيده). null إن
   * لم يوجد.
   */
  async balanceOf(id: string, tenantId: string): Promise<number | null> {
    const row = await this.customers
      .createQueryBuilder('customer')
      .withDeleted()
      .select(BALANCE_SQL, 'balance')
      .where('customer.id = :id AND customer.tenantId = :tenantId', {
        id,
        tenantId,
      })
      .getRawOne<{ balance: string }>();
    return row ? Number(row.balance) : null;
  }

  /** عميل فعّال تابع للشركة — لإنشاء مستند جديد عليه */
  async findActive(
    id: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Customer> {
    const repository = manager?.getRepository(Customer) ?? this.customers;
    const customer = await repository.findOne({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException('العميل غير موجود');
    if (!customer.isActive) {
      throw new BadRequestException(`العميل "${customer.name}" موقوف`);
    }
    return customer;
  }

  /** عملاء الشركة (مع المحذوف) الذين تغيّروا منذ وقت معيّن — لمزامنة الكاشير */
  findChangedSince(tenantId: string, since?: Date): Promise<Customer[]> {
    const qb = this.customers
      .createQueryBuilder('customer')
      .withDeleted()
      .where('customer.tenantId = :tenantId', { tenantId });

    if (since) {
      qb.andWhere(
        '(customer.updatedAt > :since OR customer.deletedAt > :since)',
        { since },
      );
    } else {
      qb.andWhere('customer.deletedAt IS NULL');
    }
    return qb.orderBy('customer.name', 'ASC').getMany();
  }

  /** إجمالي ما على كل العملاء */
  /**
   * ما على كل عميل الآن (غير الصفري فقط) — تنزّله أجهزة الكاشير لتفحص حد
   * الائتمان عند البيع الآجل بلا إنترنت.
   */
  async balances(tenantId: string): Promise<{ id: string; balance: number }[]> {
    const rows = await this.customers
      .createQueryBuilder('customer')
      .select('customer.id', 'id')
      .addSelect(BALANCE_SQL, 'balance')
      .where('customer.tenantId = :tenantId', { tenantId })
      .andWhere(`${BALANCE_SQL} <> 0`)
      .getRawMany<{ id: string; balance: string }>();
    return rows.map((row) => ({ id: row.id, balance: Number(row.balance) }));
  }

  /**
   * عميل أضافه الكاشير على شاشته (ربما بلا إنترنت) بمعرّف ولّده الجهاز،
   * لتشير إليه فواتيره التالية في الطابور.
   * @returns true إذا كان مسجّلاً من قبل (رفع مكرر)
   */
  async createFromPos(
    id: string,
    dto: Pick<CreateCustomerDto, 'name' | 'phone' | 'taxNumber'>,
    tenantId: string,
  ): Promise<boolean> {
    const existing = await this.customers.findOne({
      where: { id },
      withDeleted: true,
    });
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new NotFoundException('العميل غير موجود');
      }
      return true;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.insert(Customer, {
        id,
        tenantId,
        name: dto.name,
        phone: dto.phone ?? null,
        taxNumber: dto.taxNumber ?? null,
        code: await nextDocumentNumber(
          manager,
          'customers',
          CODE_PREFIX,
          tenantId,
          'code',
        ),
      });
    });
    return false;
  }

  async totalReceivables(tenantId: string): Promise<number> {
    const [row] = await this.customers.query<{ value: string }[]>(
      `SELECT COALESCE(SUM(${BALANCE_SQL}), 0) AS "value"
         FROM customers "customer"
        WHERE "customer"."tenantId" = $1 AND "customer"."deletedAt" IS NULL`,
      [tenantId],
    );
    return Number(row.value);
  }

  /** كشف حساب عميل: كل فاتورة وقبض ومرتجع بالترتيب مع الرصيد بعد كل قيد */
  async statement(
    id: string,
    tenantId: string,
    range: StatementQueryDto = {},
  ): Promise<CustomerStatement> {
    const customer = await this.findOne(id, tenantId);

    const rows = await this.customers.query<StatementRow[]>(
      `SELECT * FROM (
         SELECT 'invoice' AS "type", "id", "number",
                to_char("invoiceDate", 'YYYY-MM-DD') AS "date",
                "note" AS "reference", "total" AS "amount",
                COALESCE("issuedAt", "createdAt") AS "at"
           FROM sales_invoices
          WHERE "tenantId" = $1 AND "customerId" = $2 AND "status" = 'issued'
         UNION ALL
         SELECT 'return', "id", "number", to_char("returnDate", 'YYYY-MM-DD'),
                "reason", -"total", COALESCE("issuedAt", "createdAt")
           FROM sales_returns
          WHERE "tenantId" = $1 AND "customerId" = $2 AND "status" = 'issued'
         UNION ALL
         SELECT CASE WHEN "direction" = 'in' THEN 'payment' ELSE 'refund' END,
                "id", "number", to_char("paymentDate", 'YYYY-MM-DD'), "reference",
                CASE WHEN "direction" = 'in' THEN -"amount" ELSE "amount" END,
                "createdAt"
           FROM customer_payments
          WHERE "tenantId" = $1 AND "customerId" = $2 AND "status" = 'posted'
       ) entries
       ORDER BY "date" ASC, "at" ASC`,
      [tenantId, id],
    );

    // ما قبل بداية الفترة يُجمَع في الرصيد الافتتاحي لها
    const before = rows.filter((r) => range.from && r.date < range.from);
    const within = rows.filter(
      (r) =>
        (!range.from || r.date >= range.from) &&
        (!range.to || r.date <= range.to),
    );

    const openingBalance = sumMoney([
      customer.openingBalance,
      ...before.map((r) => Number(r.amount)),
    ]);

    let balance = openingBalance;
    const entries = within.map((row): CustomerStatementEntry => {
      const amount = Number(row.amount);
      balance = sumMoney([balance, amount]);
      return {
        type: row.type,
        id: row.id,
        number: row.number,
        date: row.date,
        reference: row.reference,
        debit: amount > 0 ? amount : 0,
        credit: amount < 0 ? -amount : 0,
        balance,
      };
    });

    return {
      customer,
      from: range.from ?? null,
      to: range.to ?? null,
      openingBalance,
      entries,
      totalDebit: sumMoney(entries.map((e) => e.debit)),
      totalCredit: sumMoney(entries.map((e) => e.credit)),
      closingBalance: balance,
    };
  }

  // ══════════════════════════ الكتابة ══════════════════════════

  async create(dto: CreateCustomerDto, tenantId: string): Promise<Customer> {
    const id = await this.dataSource.transaction(async (manager) => {
      const customer = await manager.save(
        manager.create(Customer, {
          ...dto,
          tenantId,
          code: await nextDocumentNumber(
            manager,
            'customers',
            CODE_PREFIX,
            tenantId,
            'code',
          ),
        }),
      );
      return customer.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    tenantId: string,
  ): Promise<Customer> {
    await this.findOne(id, tenantId);
    await this.customers.update({ id, tenantId }, dto);
    return this.findOne(id, tenantId);
  }

  /** حذف عميل بلا أي مستندات فقط — غير ذلك يوقَف (isActive) ويبقى سجله */
  async remove(id: string, tenantId: string): Promise<void> {
    const customer = await this.findOne(id, tenantId);

    const [{ count }] = await this.customers.query<{ count: number }[]>(
      `SELECT (
         (SELECT COUNT(*) FROM sales_invoices WHERE "customerId" = $1)
       + (SELECT COUNT(*) FROM customer_payments WHERE "customerId" = $1)
       )::int AS "count"`,
      [id],
    );
    if (count > 0) {
      throw new ConflictException(
        'لا يمكن حذف عميل له فواتير أو مقبوضات — يمكنك إيقافه بدلاً من ذلك',
      );
    }

    await this.customers.softRemove(customer);
  }
}
