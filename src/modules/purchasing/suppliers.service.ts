// src/modules/purchasing/suppliers.service.ts
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
import {
  CreateSupplierDto,
  StatementQueryDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from './dto/purchasing.dto';
import { Supplier } from './entities/supplier.entity';
import { sumMoney } from '../../common/utils/document-totals.util';

const CODE_PREFIX = 'SUP-';

/**
 * المستحق للمورد — يُحسب دائماً من المستندات المعتمدة (لا عمود رصيد يُحدَّث
 * يدوياً فيخرج عن الحقيقة). `supplier` هو اسم الجدول المستعار في الاستعلام.
 */
const BALANCE_SQL = `(
  "supplier"."openingBalance"
  + COALESCE((SELECT SUM(i."total") FROM purchase_invoices i
               WHERE i."supplierId" = "supplier"."id" AND i."status" = 'posted'), 0)
  - COALESCE((SELECT SUM(r."total") FROM purchase_returns r
               WHERE r."supplierId" = "supplier"."id" AND r."status" = 'posted'), 0)
  - COALESCE((SELECT SUM(p."amount") FROM supplier_payments p
               WHERE p."supplierId" = "supplier"."id" AND p."status" = 'posted'), 0)
)`;

export type StatementEntryType = 'invoice' | 'return' | 'payment';

export interface StatementEntry {
  type: StatementEntryType;
  id: string;
  number: string;
  date: string;
  reference: string | null;
  /** يزيد المستحق للمورد (فاتورة) */
  credit: number;
  /** ينقص المستحق للمورد (سداد / مرتجع) */
  debit: number;
  /** المستحق للمورد بعد هذا القيد */
  balance: number;
}

export interface SupplierStatement {
  supplier: Supplier;
  from: string | null;
  to: string | null;
  openingBalance: number;
  entries: StatementEntry[];
  totalCredit: number;
  totalDebit: number;
  closingBalance: number;
}

export interface PurchasingSummary {
  /** إجمالي المستحق لكل الموردين */
  payables: number;
  /** المتبقي على فواتير تجاوزت تاريخ استحقاقها */
  overdue: number;
  /** مشتريات الشهر الحالي (فواتير معتمدة) */
  monthPurchases: number;
  draftInvoices: number;
}

interface StatementRow {
  type: StatementEntryType;
  id: string;
  number: string;
  date: string;
  reference: string | null;
  amount: string;
}

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: SupplierQueryDto,
  ): Promise<Paginated<Supplier>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.suppliers
      .createQueryBuilder('supplier')
      .addSelect(BALANCE_SQL, 'balance')
      .where('supplier.tenantId = :tenantId', { tenantId });

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(supplier.name ILIKE :like OR supplier.code ILIKE :like
          OR supplier.phone ILIKE :like OR supplier.taxNumber ILIKE :like)`,
        { like: `%${search}%` },
      );
    }
    if (query.isActive !== undefined) {
      qb.andWhere('supplier.isActive = :isActive', {
        isActive: query.isActive === 'true',
      });
    }
    if (query.withBalance) {
      qb.andWhere(`${BALANCE_SQL} <> 0`);
    }

    const total = await qb.getCount();
    const { entities, raw } = await qb
      .orderBy('supplier.name', 'ASC')
      .addOrderBy('supplier.id', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawAndEntities<{ balance: string }>();

    entities.forEach((supplier, index) => {
      supplier.balance = Number(raw[index].balance);
    });
    return paginated(entities, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<Supplier> {
    const { entities, raw } = await this.suppliers
      .createQueryBuilder('supplier')
      .addSelect(BALANCE_SQL, 'balance')
      .where('supplier.id = :id AND supplier.tenantId = :tenantId', {
        id,
        tenantId,
      })
      .getRawAndEntities<{ balance: string }>();

    const supplier = entities[0];
    if (!supplier) throw new NotFoundException('المورد غير موجود');
    supplier.balance = Number(raw[0].balance);
    return supplier;
  }

  /** مورد فعّال تابع للشركة — لإنشاء مستند جديد عليه */
  async findActive(
    id: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Supplier> {
    const repository = manager?.getRepository(Supplier) ?? this.suppliers;
    const supplier = await repository.findOne({ where: { id, tenantId } });
    if (!supplier) throw new NotFoundException('المورد غير موجود');
    if (!supplier.isActive) {
      throw new BadRequestException(`المورد "${supplier.name}" موقوف`);
    }
    return supplier;
  }

  /** كشف حساب مورد: كل فاتورة وسداد ومرتجع بالترتيب مع الرصيد بعد كل قيد */
  async statement(
    id: string,
    tenantId: string,
    range: StatementQueryDto = {},
  ): Promise<SupplierStatement> {
    const supplier = await this.findOne(id, tenantId);

    const rows = await this.suppliers.query<StatementRow[]>(
      `SELECT * FROM (
         SELECT 'invoice' AS "type", "id", "number",
                to_char("invoiceDate", 'YYYY-MM-DD') AS "date",
                "supplierReference" AS "reference", "total" AS "amount", "createdAt"
           FROM purchase_invoices
          WHERE "tenantId" = $1 AND "supplierId" = $2 AND "status" = 'posted'
         UNION ALL
         SELECT 'return', "id", "number", to_char("returnDate", 'YYYY-MM-DD'),
                "reason", -"total", "createdAt"
           FROM purchase_returns
          WHERE "tenantId" = $1 AND "supplierId" = $2 AND "status" = 'posted'
         UNION ALL
         SELECT 'payment', "id", "number", to_char("paymentDate", 'YYYY-MM-DD'),
                "reference", -"amount", "createdAt"
           FROM supplier_payments
          WHERE "tenantId" = $1 AND "supplierId" = $2 AND "status" = 'posted'
       ) entries
       ORDER BY "date" ASC, "createdAt" ASC`,
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
      supplier.openingBalance,
      ...before.map((r) => Number(r.amount)),
    ]);

    let balance = openingBalance;
    const entries = within.map((row): StatementEntry => {
      const amount = Number(row.amount);
      balance = sumMoney([balance, amount]);
      return {
        type: row.type,
        id: row.id,
        number: row.number,
        date: row.date,
        reference: row.reference,
        credit: amount > 0 ? amount : 0,
        debit: amount < 0 ? -amount : 0,
        balance,
      };
    });

    return {
      supplier,
      from: range.from ?? null,
      to: range.to ?? null,
      openingBalance,
      entries,
      totalCredit: sumMoney(entries.map((e) => e.credit)),
      totalDebit: sumMoney(entries.map((e) => e.debit)),
      closingBalance: balance,
    };
  }

  async summary(tenantId: string): Promise<PurchasingSummary> {
    const [payables] = await this.suppliers.query<{ value: string }[]>(
      `SELECT COALESCE(SUM(${BALANCE_SQL}), 0) AS "value"
         FROM suppliers "supplier"
        WHERE "supplier"."tenantId" = $1 AND "supplier"."deletedAt" IS NULL`,
      [tenantId],
    );
    const [invoices] = await this.suppliers.query<
      { overdue: string; month: string; drafts: number }[]
    >(
      `SELECT
         COALESCE(SUM("total" - "returnedAmount" - "paidAmount") FILTER (
           WHERE "status" = 'posted' AND "dueDate" < CURRENT_DATE
             AND "total" - "returnedAmount" - "paidAmount" > 0), 0) AS "overdue",
         COALESCE(SUM("total" - "returnedAmount") FILTER (
           WHERE "status" = 'posted'
             AND "invoiceDate" >= date_trunc('month', CURRENT_DATE)), 0) AS "month",
         (COUNT(*) FILTER (WHERE "status" = 'draft'))::int AS "drafts"
       FROM purchase_invoices
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL`,
      [tenantId],
    );

    return {
      payables: Number(payables.value),
      overdue: Number(invoices.overdue),
      monthPurchases: Number(invoices.month),
      draftInvoices: invoices.drafts,
    };
  }

  // ══════════════════════════ الكتابة ══════════════════════════

  async create(dto: CreateSupplierDto, tenantId: string): Promise<Supplier> {
    await this.assertNameFree(dto.name, tenantId);

    const id = await this.dataSource.transaction(async (manager) => {
      const supplier = await manager.save(
        manager.create(Supplier, {
          ...dto,
          tenantId,
          code: await nextDocumentNumber(
            manager,
            'suppliers',
            CODE_PREFIX,
            tenantId,
            'code',
          ),
        }),
      );
      return supplier.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    tenantId: string,
  ): Promise<Supplier> {
    const supplier = await this.findOne(id, tenantId);
    if (dto.name && dto.name !== supplier.name) {
      await this.assertNameFree(dto.name, tenantId, id);
    }

    await this.suppliers.update({ id, tenantId }, dto);
    return this.findOne(id, tenantId);
  }

  /** حذف مورد بلا أي مستندات فقط — غير ذلك يوقَف (isActive) ويبقى سجله */
  async remove(id: string, tenantId: string): Promise<void> {
    const supplier = await this.findOne(id, tenantId);

    const [{ count }] = await this.suppliers.query<{ count: number }[]>(
      `SELECT (
         (SELECT COUNT(*) FROM purchase_invoices WHERE "supplierId" = $1)
       + (SELECT COUNT(*) FROM supplier_payments WHERE "supplierId" = $1)
       )::int AS "count"`,
      [id],
    );
    if (count > 0) {
      throw new ConflictException(
        'لا يمكن حذف مورد له فواتير أو مدفوعات — يمكنك إيقافه بدلاً من ذلك',
      );
    }

    await this.suppliers.softRemove(supplier);
  }

  private async assertNameFree(
    name: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.suppliers.findOne({
      where: { tenantId, name },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`يوجد مورد آخر باسم "${name}"`);
    }
  }
}
