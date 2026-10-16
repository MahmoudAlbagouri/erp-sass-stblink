// src/modules/sales/sales-invoices.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import {
  lockDocumentSequence,
  nextDocumentNumber,
} from '../../common/utils/document-number.util';
import { computeLine, sumMoney } from '../../common/utils/document-totals.util';
import {
  startOfDayInZone,
  tenantCalendarOf,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import {
  MAX_MONEY_DECIMALS,
  moneyDecimalsOf,
  roundMoney,
} from '../../common/utils/money.util';
import {
  assertWarehouseVisible,
  restrictToScopedWarehouses,
  scopedWarehouseIds,
} from '../branches/branch-scope';
import { Product, ProductType } from '../catalog/entities/product.entity';
import { TaxCategory } from '../catalog/entities/tax-rate.entity';
import { ProductsService } from '../catalog/products.service';
import { StockMovementType } from '../inventory/entities/stock-movement.entity';
import { StockService } from '../inventory/stock.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { CustomersService } from './customers.service';
import {
  CreateSalesInvoiceDto,
  IssueSalesInvoiceDto,
  SalesInvoiceQueryDto,
  SalesLineDto,
  TenderDto,
  UpdateSalesInvoiceDto,
} from './dto/sales.dto';
import { PaymentDirection } from './entities/customer-payment.entity';
import { Customer } from './entities/customer.entity';
import {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from './entities/sales-invoice.entity';
import { SalesSettings } from './entities/sales-settings.entity';
import { SalesSettingsService } from './sales-settings.service';
import { dateOnly, recordPayment } from './utils/payment-recorder';
import { buildZatcaQr, computeInvoiceHash } from './utils/zatca.util';

export const SALES_INVOICE_REFERENCE = 'sales_invoice';
const NUMBER_PREFIX = 'INV-';
/**
 * أقصى فرق تقريب مقبول بين حساب الجهاز وحساب السيرفر: جزءان من أصغر وحدة
 * في العملة (هللتان للريال، فلسان للدينار)
 */
const amountTolerance = (decimals: number): number => 2 / 10 ** decimals;

/** سطر محسوب جاهز للحفظ */
type ComputedLine = Pick<
  SalesInvoiceLine,
  | 'sortOrder'
  | 'productId'
  | 'productName'
  | 'sku'
  | 'isStocked'
  | 'unitId'
  | 'unitName'
  | 'factor'
  | 'quantity'
  | 'unitPrice'
  | 'listPrice'
  | 'priceReason'
  | 'discount'
  | 'taxRate'
  | 'taxCategory'
  | 'subtotal'
  | 'taxAmount'
  | 'total'
  | 'baseQuantity'
>;

/** فاتورة أصدرها جهاز كاشير، كما يرفعها */
export interface PosSaleInput {
  uuid: string;
  /** رقم الفاتورة كما وُلّد على الجهاز وطُبع */
  number: string;
  /** وقت البيع الفعلي على الجهاز */
  issuedAt: Date;
  deviceId: string;
  shiftId: string;
  warehouseId: string;
  customerId?: string | null;
  pricesIncludeTax: boolean;
  lines: {
    productId: string;
    unitId?: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    /** نسبة الضريبة وقت البيع */
    taxRate: number;
    subtotal: number;
    taxAmount: number;
    total: number;
    /** السعر الأصلي حين غيّر الكاشير السعر في هذه الفاتورة */
    listPrice?: number;
    priceReason?: string;
  }[];
  payments: TenderDto[];
}

export interface ShiftTotals {
  invoicesCount: number;
  salesTotal: number;
  /** ما قُبض في الوردية نفسها لكل طريقة دفع: { cash: 120, card: 80 } */
  byMethod: Record<string, number>;
  /** ما بيع على الحساب (آجل): المبيعات − ما قُبض في الوردية */
  creditTotal: number;
}

interface FinalizeOptions {
  issuedAt: Date;
  tenders: TenderDto[];
  seller: SalesSettings;
  userId?: string;
  /** رقم جاهز من جهاز الكاشير. بدونه يؤخذ الرقم التسلسلي التالي */
  number?: string;
  deviceId?: string;
  shiftId?: string;
  /** بيع وقع فعلاً (كاشير): يُسجَّل ولو نزل الرصيد تحت الصفر */
  allowNegativeStock?: boolean;
}

/** سطر فاتورة كاشير مقابل بيانات صنفه في السيرفر (للإبلاغ، لا للرفض) */
export interface PosLineCheck {
  productId: string;
  categoryId: string | null;
  productName: string;
  /** النسبة التي طبّقها الجهاز */
  taxRate: number;
  /** النسبة المتوقعة الآن: نسبة الصنف، أو صفر لمنشأة غير مسجّلة */
  productTaxRate: number;
  /** المنشأة مسجّلة في ضريبة القيمة المضافة */
  vatRegistered: boolean;
  /** صافي سعر الوحدة بعد الخصم أقل من أقل سعر مسموح للصنف */
  belowMinPrice: boolean;
  /** ما بيعت به الوحدة، وسعرها في الكتالوج بأساس الفاتورة */
  unitPrice: number;
  catalogPrice: number;
  /** السعر غير سعر الكتالوج والسطر لا يحمل تعديل سعر مسجّلاً */
  unmarkedPrice: boolean;
}

export interface PosSaleRecord {
  invoice: SalesInvoice;
  duplicate: boolean;
  overdrawn: OverdrawnLine[];
  checks: PosLineCheck[];
}

/** صنف نزل رصيده تحت الصفر بفاتورة كاشير في مخزن لا يسمح بذلك */
export interface OverdrawnLine {
  productId: string;
  productName: string;
  /** الرصيد بعد البيع (بوحدة الأساس) */
  quantity: number;
}

interface Totals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export interface SalesSummary {
  /** صافي مبيعات اليوم (بعد المرتجعات) شامل الضريبة */
  todaySales: number;
  monthSales: number;
  /** مجمل ربح الشهر = المبيعات قبل الضريبة − تكلفة البضاعة المباعة */
  monthProfit: number;
  /** إجمالي ما على العملاء */
  receivables: number;
  /** المتبقي على فواتير آجلة تجاوزت تاريخ استحقاقها */
  overdue: number;
  draftInvoices: number;
}

/**
 * فواتير البيع:
 *   مسودة ──إصدار──▶ صادرة   (رقم تسلسلي + QR + خروج البضاعة + قيد على العميل)
 * الفاتورة الصادرة لا تُعدَّل ولا تُلغى (متطلب هيئة الزكاة والضريبة)؛ تصحيحها
 * بمرتجع بيع (إشعار دائن).
 */
@Injectable()
export class SalesInvoicesService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly invoices: Repository<SalesInvoice>,
    private readonly customers: CustomersService,
    private readonly warehouses: WarehousesService,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly settings: SalesSettingsService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: SalesInvoiceQueryDto,
  ): Promise<Paginated<SalesInvoice>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.invoices
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.customer', 'customer')
      .leftJoinAndSelect('invoice.warehouse', 'warehouse')
      .loadRelationCountAndMap('invoice.linesCount', 'invoice.lines')
      .where('invoice.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'invoice.warehouseId');

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        '(invoice.number ILIKE :like OR customer.name ILIKE :like OR customer.phone ILIKE :like)',
        { like: `%${search}%` },
      );
    }
    if (query.status) {
      qb.andWhere('invoice.status = :status', { status: query.status });
    }
    if (query.customerId) {
      qb.andWhere('invoice.customerId = :customerId', {
        customerId: query.customerId,
      });
    }
    if (query.warehouseId) {
      qb.andWhere('invoice.warehouseId = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    }
    if (query.payment) {
      qb.andWhere('invoice.status = :issued', {
        issued: SalesInvoiceStatus.ISSUED,
      }).andWhere(
        'invoice.total - invoice.returnedAmount - invoice.paidAmount > 0',
      );
      if (query.payment === 'overdue') {
        const { today } = await tenantCalendarOf(
          this.dataSource.manager,
          tenantId,
        );
        qb.andWhere('invoice.dueDate < :today', { today });
      }
    }
    if (query.from) {
      qb.andWhere('invoice.invoiceDate >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('invoice.invoiceDate <= :to', { to: query.to });
    }

    const [data, total] = await qb
      .orderBy('invoice.invoiceDate', 'DESC')
      .addOrderBy('invoice.createdAt', 'DESC')
      .addOrderBy('invoice.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<SalesInvoice> {
    const invoice = await this.invoices.findOne({
      where: { id, tenantId },
      relations: ['customer', 'warehouse', 'warehouse.branch', 'lines'],
    });
    if (!invoice) throw new NotFoundException('فاتورة البيع غير موجودة');
    assertWarehouseVisible(invoice.warehouseId, 'فاتورة البيع غير موجودة');

    invoice.lines?.sort((a, b) => a.sortOrder - b.sortOrder);
    // ما على العميل الآن: يُطبع على الفاتورة (إجمالي الآجل عليه)
    if (invoice.customer) {
      invoice.customer.balance =
        (await this.customers.balanceOf(invoice.customer.id, tenantId)) ??
        undefined;
    }
    return invoice;
  }

  /** فاتورة برقمها المطبوع (لمرتجع الكاشير: العميل يحمل الإيصال) */
  async findByNumber(number: string, tenantId: string): Promise<SalesInvoice> {
    const invoice = await this.invoices.findOne({
      // الأرقام تُولَّد بحروف كبيرة؛ الكاشير قد يكتبها صغيرة
      where: { number: number.trim().toUpperCase(), tenantId },
      relations: ['customer', 'lines'],
    });
    if (!invoice) {
      throw new NotFoundException(`لا توجد فاتورة برقم "${number}"`);
    }

    invoice.lines?.sort((a, b) => a.sortOrder - b.sortOrder);
    return invoice;
  }

  /**
   * يقفل الفاتورة حتى نهاية المعاملة — للإصدار هنا، وللقبض والمرتجع اللذين
   * يعدّلان مبالغها (فلا يُقبض أو يُرجَع أكثر من المتاح بطلبين متزامنين).
   */
  async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<SalesInvoice> {
    const invoice = await manager.findOne(SalesInvoice, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException('فاتورة البيع غير موجودة');
    assertWarehouseVisible(invoice.warehouseId, 'فاتورة البيع غير موجودة');
    return invoice;
  }

  /** عدد الفواتير الصادرة هذا الشهر — يستخدمه حد الخطة (max_invoices) */
  async countIssuedThisMonth(tenantId: string): Promise<number> {
    // بلحظة الإصدار لا بتاريخ الفاتورة (تأريخها للخلف لا يتجاوز الحد)، وبداية
    // الشهر بتقويم الشركة
    const { zone, monthStart } = await tenantCalendarOf(
      this.dataSource.manager,
      tenantId,
    );
    const [row] = await this.invoices.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS "count" FROM sales_invoices
        WHERE "tenantId" = $1 AND "status" = 'issued'
          AND "issuedAt" >= $2`,
      [tenantId, startOfDayInZone(monthStart, zone)],
    );
    return row.count;
  }

  /**
   * مبيعات ورديات كاشير ومقبوضاتها حسب طريقة الدفع — لتقفيل الدرج. استعلامان
   * لكل الورديات معاً (وردية بلا مبيعات تعود أصفاراً).
   */
  async shiftTotals(
    tenantId: string,
    shiftIds: string[],
  ): Promise<Map<string, ShiftTotals>> {
    const result = new Map<string, ShiftTotals>();
    if (shiftIds.length === 0) return result;

    const sales = await this.invoices.query<
      { shiftId: string; count: number; total: string }[]
    >(
      `SELECT "shiftId", COUNT(*)::int AS "count", COALESCE(SUM("total"), 0) AS "total"
         FROM sales_invoices
        WHERE "tenantId" = $1 AND "shiftId" = ANY($2::uuid[]) AND "status" = 'issued'
        GROUP BY "shiftId"`,
      [tenantId, shiftIds],
    );
    const methods = await this.invoices.query<
      { shiftId: string; method: string; amount: string }[]
    >(
      `SELECT p."shiftId", p."method", SUM(p."amount") AS "amount"
         FROM customer_payments p
        WHERE p."tenantId" = $1 AND p."shiftId" = ANY($2::uuid[])
          AND p."status" = 'posted' AND p."direction" = 'in'
        GROUP BY p."shiftId", p."method"`,
      [tenantId, shiftIds],
    );

    for (const shiftId of shiftIds) {
      const row = sales.find((s) => s.shiftId === shiftId);
      const paid = methods.filter((m) => m.shiftId === shiftId);
      const salesTotal = Number(row?.total ?? 0);
      result.set(shiftId, {
        invoicesCount: row?.count ?? 0,
        salesTotal,
        byMethod: Object.fromEntries(
          paid.map((m) => [m.method, Number(m.amount)]),
        ),
        creditTotal: Math.max(
          sumMoney([salesTotal, ...paid.map((m) => -Number(m.amount))]),
          0,
        ),
      });
    }
    return result;
  }

  /**
   * أرقام صفحة المبيعات. "اليوم" و"الشهر" بتقويم الشركة وبتاريخ الفاتورة
   * (invoiceDate، التاريخ المحاسبي) — نفس تعريف الصفحة الرئيسية.
   */
  async summary(tenantId: string): Promise<SalesSummary> {
    // المستخدم المقيَّد بفروع يرى أرقام فروعه (ذمم العملاء تبقى للشركة كلها:
    // العميل ليس تابعاً لفرع)
    const allowed = scopedWarehouseIds();
    const { today, monthStart } = await tenantCalendarOf(
      this.dataSource.manager,
      tenantId,
    );
    const [row] = await this.invoices.query<
      {
        today: string;
        month: string;
        profit: string;
        overdue: string;
        drafts: number;
      }[]
    >(
      `SELECT
         COALESCE(SUM("total" - "returnedAmount") FILTER (
           WHERE "status" = 'issued' AND "invoiceDate" = $2::date), 0) AS "today",
         COALESCE(SUM("total" - "returnedAmount") FILTER (
           WHERE "status" = 'issued'
             AND "invoiceDate" BETWEEN $3::date AND $2::date), 0) AS "month",
         COALESCE(SUM("subtotal" - "costTotal") FILTER (
           WHERE "status" = 'issued'
             AND "invoiceDate" BETWEEN $3::date AND $2::date), 0) AS "profit",
         COALESCE(SUM("total" - "returnedAmount" - "paidAmount") FILTER (
           WHERE "status" = 'issued' AND "dueDate" < $2::date
             AND "total" - "returnedAmount" - "paidAmount" > 0), 0) AS "overdue",
         (COUNT(*) FILTER (WHERE "status" = 'draft'))::int AS "drafts"
       FROM sales_invoices
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL
         AND ($4::uuid[] IS NULL OR "warehouseId" = ANY($4::uuid[]))`,
      [tenantId, today, monthStart, allowed],
    );

    return {
      todaySales: Number(row.today),
      monthSales: Number(row.month),
      monthProfit: Number(row.profit),
      receivables: await this.customers.totalReceivables(tenantId),
      overdue: Number(row.overdue),
      draftInvoices: row.drafts,
    };
  }

  // ══════════════════════════ المسودة ══════════════════════════

  async create(
    dto: CreateSalesInvoiceDto,
    tenantId: string,
    userId?: string,
    options: DeliveryAccess = {},
  ): Promise<SalesInvoice> {
    // نفس الـ uuid أُرسل من قبل (إعادة محاولة بعد انقطاع): نعيد الفاتورة نفسها
    if (dto.uuid) {
      const existing = await this.invoices.findOne({
        where: { tenantId, uuid: dto.uuid },
      });
      if (existing) return this.findOne(existing.id, tenantId);
    }

    const customer = dto.customerId
      ? await this.customers.findActive(dto.customerId, tenantId)
      : null;
    await this.warehouses.findActiveByIds([dto.warehouseId], tenantId);

    // الافتراضي أساس تسعير الشركة (شامل الضريبة أو قبلها)
    const seller = await this.settings.get(tenantId);
    const pricesIncludeTax = dto.pricesIncludeTax ?? seller.pricesIncludeTax;
    const lines = await this.computeLines(
      dto.lines,
      pricesIncludeTax,
      tenantId,
      seller.vatRegistered,
    );

    const id = await this.dataSource.transaction(async (manager) => {
      const invoice = await manager.save(
        manager.create(SalesInvoice, {
          tenantId,
          uuid: dto.uuid ?? randomUUID(),
          customerId: customer?.id ?? null,
          invoiceType: invoiceTypeFor(customer),
          warehouseId: dto.warehouseId,
          invoiceDate: dto.invoiceDate,
          dueDate: dto.dueDate ?? defaultDueDate(dto.invoiceDate, customer),
          pricesIncludeTax,
          note: dto.note ?? null,
          createdById: userId ?? null,
          isDelivery: options.delivery ?? false,
          ...totalsOf(lines),
        }),
      );
      await this.replaceLines(manager, invoice.id, tenantId, lines);
      return invoice.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateSalesInvoiceDto,
    tenantId: string,
  ): Promise<SalesInvoice> {
    const current = await this.findOne(id, tenantId);
    assertStatus(current, SalesInvoiceStatus.DRAFT, 'تعديل');
    assertNotDelivery(current);

    const customerId =
      dto.customerId === undefined ? current.customerId : dto.customerId;
    const customer = customerId
      ? await this.customers.findActive(customerId, tenantId)
      : null;
    const warehouseId = dto.warehouseId ?? current.warehouseId;
    if (dto.warehouseId) {
      await this.warehouses.findActiveByIds([warehouseId], tenantId);
    }

    // الأسطر تُعاد حسابها دائماً: تغيير "شامل الضريبة" وحده يغيّر كل المبالغ
    const pricesIncludeTax = dto.pricesIncludeTax ?? current.pricesIncludeTax;
    const lineInputs: SalesLineDto[] =
      dto.lines ??
      (current.lines ?? []).map((line) => ({
        productId: line.productId,
        unitId: line.unitId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
      }));
    const lines = await this.computeLines(
      lineInputs,
      pricesIncludeTax,
      tenantId,
      (await this.settings.get(tenantId)).vatRegistered,
    );

    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lock(manager, id, tenantId);
      assertStatus(invoice, SalesInvoiceStatus.DRAFT, 'تعديل');

      await manager.update(
        SalesInvoice,
        { id, tenantId },
        {
          customerId: customer?.id ?? null,
          invoiceType: invoiceTypeFor(customer),
          warehouseId,
          pricesIncludeTax,
          invoiceDate: dto.invoiceDate ?? current.invoiceDate,
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...totalsOf(lines),
        },
      );
      await this.replaceLines(manager, id, tenantId, lines);
    });

    return this.findOne(id, tenantId);
  }

  /** إلغاء مسودة فقط. الصادرة لا تُلغى — تُصحَّح بمرتجع بيع */
  async cancel(
    id: string,
    tenantId: string,
    options: DeliveryAccess = {},
  ): Promise<SalesInvoice> {
    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lock(manager, id, tenantId);
      if (!options.delivery) assertNotDelivery(invoice);
      if (invoice.status === SalesInvoiceStatus.ISSUED) {
        throw new BadRequestException(
          'الفاتورة الصادرة لا تُلغى — سجّل مرتجع بيع (إشعار دائن) لتصحيحها',
        );
      }
      assertStatus(invoice, SalesInvoiceStatus.DRAFT, 'إلغاء');

      await manager.update(
        SalesInvoice,
        { id, tenantId },
        { status: SalesInvoiceStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ الإصدار ══════════════════════════

  /**
   * إصدار الفاتورة: رقم تسلسلي، رمز QR، خروج البضاعة من المخزن بمتوسط
   * تكلفتها، وتسجيل ما قُبض. بعدها الفاتورة لا تتغير.
   */
  async issue(
    id: string,
    dto: IssueSalesInvoiceDto,
    tenantId: string,
    userId?: string,
  ): Promise<SalesInvoice> {
    await this.dataSource.transaction((manager) =>
      this.issueWithin(manager, id, dto, tenantId, userId),
    );
    return this.findOne(id, tenantId);
  }

  /**
   * الإصدار داخل معاملة المستدعي: موديول يربط الإصدار بتغيير حالته (أوردر
   * توصيل يخرج مع الطيار) فيقعان معاً أو لا يقع أيهما.
   *
   * `issuedAt`: وقت الإصدار الفعلي إن سبق وقت التسجيل (طيار استلم الأوردر بلا
   * إنترنت ورُفع الاستلام لاحقاً). الافتراضي الآن.
   */
  async issueWithin(
    manager: EntityManager,
    id: string,
    dto: IssueSalesInvoiceDto,
    tenantId: string,
    userId?: string,
    options: DeliveryAccess & { issuedAt?: Date } = {},
  ): Promise<void> {
    // ─── تحقق قبل القفل (قراءات لا تحتاج قفلاً) ───
    const draft = await this.findOne(id, tenantId);
    assertStatus(draft, SalesInvoiceStatus.DRAFT, 'إصدار');
    if (!options.delivery) assertNotDelivery(draft);

    const tenders = dto.payments ?? [];
    const tendered = sumMoney(tenders.map((t) => t.amount));
    if (tendered > draft.total) {
      throw new BadRequestException(
        `المقبوض (${tendered}) أكبر من إجمالي الفاتورة (${draft.total})`,
      );
    }

    const customer = draft.customerId
      ? await this.customers.findOne(draft.customerId, tenantId)
      : null;
    const credit = sumMoney([draft.total, -tendered]);
    if (!customer && credit > 0) {
      throw new BadRequestException(
        'البيع الآجل يحتاج عميلاً — اختر العميل أو اقبض كامل المبلغ',
      );
    }
    if (customer) {
      if (!customer.isActive) {
        throw new BadRequestException(`العميل "${customer.name}" موقوف`);
      }
      const limit = customer.creditLimit;
      const balanceAfter = sumMoney([customer.balance ?? 0, credit]);
      if (limit !== null && limit !== undefined && balanceAfter > limit) {
        throw new BadRequestException(
          `تجاوز الحد الائتماني للعميل "${customer.name}": الحد ${limit} وسيصبح عليه ${balanceAfter}`,
        );
      }
    }

    const seller = await this.settings.get(tenantId);
    // مسودة حُسبت ضريبتها قبل أن تُلغى الشركة تسجيلها: تُعاد حسابها أولاً
    if (!seller.vatRegistered && draft.taxTotal > 0) {
      throw new BadRequestException(
        'المنشأة غير مسجّلة في ضريبة القيمة المضافة والمسودة محسوبة بضريبة — افتحها واحفظها لتُحسب بلا ضريبة ثم أصدرها',
      );
    }

    const invoice = await this.lock(manager, id, tenantId);
    assertStatus(invoice, SalesInvoiceStatus.DRAFT, 'إصدار');

    const lines = await manager.find(SalesInvoiceLine, {
      where: { invoiceId: id },
      order: { sortOrder: 'ASC' },
    });
    await this.finalize(manager, invoice, lines, {
      issuedAt: options.issuedAt ?? new Date(),
      tenders,
      seller,
      userId,
    });
  }

  // ══════════════════════════ نقاط البيع ══════════════════════════

  /**
   * يسجّل فاتورة أصدرها جهاز كاشير (ربما بلا إنترنت ثم رُفعت لاحقاً).
   *
   * البيع وقع فعلاً والإيصال طُبع، فالسيرفر هنا **يسجّل ولا يفاوض**: الرقم
   * والوقت والمبالغ كما أصدرها الجهاز، وقواعد التسعير لا تُعاد (طُبّقت على
   * الجهاز). يُرفض فقط ما لا يمكن تسجيله (صنف غير معروف، مبالغ لا تطابق
   * الحساب). نفس الـ uuid مرتين ← الفاتورة نفسها (الرفع قد يتكرر بعد انقطاع).
   */
  async recordPosSale(
    sale: PosSaleInput,
    tenantId: string,
    userId?: string,
  ): Promise<PosSaleRecord> {
    const existing = await this.invoices.findOne({
      where: { tenantId, uuid: sale.uuid },
    });
    if (existing) {
      return {
        invoice: await this.findOne(existing.id, tenantId),
        duplicate: true,
        overdrawn: [],
        checks: [],
      };
    }

    const customer = sale.customerId
      ? await this.customers.findOne(sale.customerId, tenantId)
      : null;
    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);
    const seller = await this.settings.get(tenantId);
    const { lines, checks } = await this.posLines(
      sale,
      tenantId,
      decimals,
      seller.vatRegistered,
    );
    const totals = totalsOf(lines);

    // البيع تمّ على الجهاز والإيصال طُبع: هنا يُتحقق من الاتساق فقط. الباقي
    // على الحساب يُقبل لعميل مسجّل (حد الائتمان فحصته الشاشة عند البيع)
    const tendered = sumMoney(sale.payments.map((t) => t.amount));
    const tolerance = amountTolerance(decimals);
    if (tendered - totals.total > tolerance) {
      throw new BadRequestException(
        `المقبوض (${tendered}) أكبر من إجمالي الفاتورة (${totals.total})`,
      );
    }
    const onAccount = totals.total - tendered > tolerance;
    if (onAccount && !customer) {
      throw new BadRequestException(
        `المقبوض (${tendered}) لا يساوي إجمالي الفاتورة (${totals.total}) — البيع الآجل لعميل مسجّل فقط`,
      );
    }
    // تاريخ الفاتورة = يوم البيع بتوقيت الشركة، لا بساعة السيرفر
    const saleDay = dateOnly(
      sale.issuedAt,
      await tenantTimezoneOf(this.dataSource.manager, tenantId),
    );

    const { id, overdrawn } = await this.dataSource.transaction(
      async (manager) => {
        const invoice = await manager.save(
          manager.create(SalesInvoice, {
            tenantId,
            uuid: sale.uuid,
            customerId: customer?.id ?? null,
            invoiceType: invoiceTypeFor(customer),
            warehouseId: sale.warehouseId,
            invoiceDate: saleDay,
            dueDate: onAccount ? defaultDueDate(saleDay, customer) : saleDay,
            pricesIncludeTax: sale.pricesIncludeTax,
            createdById: userId ?? null,
            ...totals,
          }),
        );
        await this.replaceLines(manager, invoice.id, tenantId, lines);

        const overdrawn = await this.finalize(
          manager,
          invoice,
          await manager.find(SalesInvoiceLine, {
            where: { invoiceId: invoice.id },
            order: { sortOrder: 'ASC' },
          }),
          {
            issuedAt: sale.issuedAt,
            tenders: sale.payments,
            seller,
            userId,
            number: sale.number,
            deviceId: sale.deviceId,
            shiftId: sale.shiftId,
            // البضاعة خرجت مع العميل: رصيد الشاشة كان قديماً، لا يُرفض البيع
            allowNegativeStock: true,
          },
        );
        return { id: invoice.id, overdrawn };
      },
    );

    return {
      invoice: await this.findOne(id, tenantId),
      duplicate: false,
      overdrawn,
      checks,
    };
  }

  /** أسطر فاتورة الكاشير: بيانات الصنف من السيرفر، والمبالغ كما طُبعت */
  private async posLines(
    sale: PosSaleInput,
    tenantId: string,
    decimals: number,
    /** منشأة غير مسجّلة: نسبة الضريبة المتوقعة صفر لكل الأصناف */
    vatRegistered: boolean,
  ): Promise<{ lines: ComputedLine[]; checks: PosLineCheck[] }> {
    const tolerance = amountTolerance(decimals);
    const checks: PosLineCheck[] = [];
    const productIds = [...new Set(sale.lines.map((l) => l.productId))];
    const found = await this.products.findSoldByIds(productIds, tenantId);
    if (found.length !== productIds.length) {
      throw new NotFoundException('الصنف غير موجود');
    }
    const products = new Map(found.map((p) => [p.id, p]));

    const lines = sale.lines.map((input, index) => {
      const product = products.get(input.productId)!;

      const unitId = input.unitId ?? product.baseUnitId;
      let factor = 1;
      let unitName = product.baseUnit?.name ?? '';
      /** سعر وحدة البيع في الكتالوج (بأساس الصنف: شامل الضريبة أو قبلها) */
      let catalogPrice = product.salePrice;
      if (unitId !== product.baseUnitId) {
        const productUnit = product.units?.find((u) => u.unitId === unitId);
        if (!productUnit) {
          throw new BadRequestException(
            `الوحدة المختارة ليست من وحدات الصنف "${product.name}"`,
          );
        }
        factor = productUnit.factor;
        unitName = productUnit.unit?.name ?? '';
        // نفس ما ينزل للجهاز (toPosProduct)
        catalogPrice =
          productUnit.salePrice ??
          roundMoney(product.salePrice * productUnit.factor, decimals);
      }

      // نعيد الحساب للتحقق فقط؛ المعتمد ما طبعه الجهاز على الإيصال
      const expected = computeLine({
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        discount: input.discount,
        taxRate: input.taxRate,
        pricesIncludeTax: sale.pricesIncludeTax,
        factor,
        decimals,
      });
      if (
        Math.abs(expected.total - input.total) > tolerance ||
        Math.abs(input.subtotal + input.taxAmount - input.total) > tolerance
      ) {
        throw new BadRequestException(
          `مبالغ الصنف "${product.name}" لا تطابق الحساب (${input.total} ≠ ${expected.total})`,
        );
      }

      // ما يخالف بيانات الصنف لا يُرفض (البيع تمّ) لكن يُبلَّغ عنه للمراجعة
      // النسبة التي كان يجب أن تطبّقها الشاشة (صفر لمنشأة غير مسجّلة)
      const productTaxRate = vatRegistered ? (product.taxRate?.rate ?? 0) : 0;
      let minNetPrice: number | null = null;
      if (product.minSalePrice !== null && product.minSalePrice !== undefined) {
        minNetPrice = product.priceIncludesTax
          ? product.minSalePrice / (1 + productTaxRate / 100)
          : product.minSalePrice;
      }
      const netUnitPrice = expected.baseQuantity
        ? input.subtotal / expected.baseQuantity
        : 0;
      // سعر الكتالوج بأساس الفاتورة: شاشة الكاشير تبيع شاملاً الضريبة دائماً
      const expectedPrice = new Decimal(catalogPrice)
        .mul(
          product.priceIncludesTax === sale.pricesIncludeTax
            ? 1
            : sale.pricesIncludeTax
              ? 1 + productTaxRate / 100
              : 1 / (1 + productTaxRate / 100),
        )
        .toDecimalPlaces(4)
        .toNumber();
      const priceChanged = input.listPrice !== undefined;
      checks.push({
        productId: product.id,
        categoryId: product.categoryId ?? null,
        productName: product.name,
        taxRate: input.taxRate,
        productTaxRate,
        vatRegistered,
        belowMinPrice:
          minNetPrice !== null &&
          netUnitPrice + 0.5 / 10 ** decimals < minNetPrice,
        // سعر غير سعر الصنف وليس مسجّلاً كتعديل (ولا سعراً مفتوحاً)
        unitPrice: input.unitPrice,
        catalogPrice: expectedPrice,
        unmarkedPrice:
          !priceChanged &&
          !product.openPrice &&
          Math.abs(input.unitPrice - expectedPrice) > 0.5 / 10 ** decimals,
      });

      return {
        sortOrder: index,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        isStocked: product.type === ProductType.STOCKED,
        unitId,
        unitName,
        factor,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        listPrice: priceChanged ? input.listPrice! : null,
        priceReason: priceChanged ? (input.priceReason ?? null) : null,
        discount: input.discount,
        taxRate: input.taxRate,
        // بيع بلا ضريبة لمنشأة غير مسجّلة: خارج النطاق. وما حُسبت عليه ضريبة
        // (شاشة لم تعرف بالتغيير بعد) يُسجَّل كما طُبع ويُبلَّغ عنه
        taxCategory:
          !vatRegistered && input.taxRate === 0
            ? TaxCategory.OUT_OF_SCOPE
            : (product.taxRate?.category ?? TaxCategory.STANDARD),
        subtotal: input.subtotal,
        taxAmount: input.taxAmount,
        total: input.total,
        baseQuantity: expected.baseQuantity,
      };
    });
    return { lines, checks };
  }

  // ══════════════════════════ داخلي ══════════════════════════

  /**
   * إتمام الإصدار داخل معاملة المستدعي: خروج المخزون، الرقم، سلسلة البصمات،
   * رمز QR، ثم تسجيل المقبوض. مشترك بين الإصدار من لوحة التحكم وتسجيل مبيعات
   * الكاشير.
   */
  private async finalize(
    manager: EntityManager,
    invoice: SalesInvoice,
    lines: SalesInvoiceLine[],
    options: FinalizeOptions,
  ): Promise<OverdrawnLine[]> {
    const { issuedAt, tenders, seller, userId } = options;
    const { id, tenantId } = invoice;

    // ─── المخزون: الأصناف المخزنية تخرج بمتوسط تكلفتها ───
    const stocked = lines.filter((line) => line.isStocked);
    const movements = await this.stock.apply(
      manager,
      tenantId,
      stocked.map((line) => ({
        warehouseId: invoice.warehouseId,
        productId: line.productId,
        type: StockMovementType.SALE,
        quantity: -line.baseQuantity,
      })),
      {
        referenceType: SALES_INVOICE_REFERENCE,
        referenceId: id,
        userId,
        occurredAt: issuedAt,
        allowNegative: options.allowNegativeStock,
      },
    );
    const overdrawn = stocked
      .map((line, index) => ({ line, result: movements[index] }))
      .filter(({ result }) => result.overdrawn)
      .map(({ line, result }) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: result.quantity,
      }));

    let costTotal = new Decimal(0);
    for (const [index, line] of stocked.entries()) {
      const unitCost = movements[index].unitCost;
      costTotal = costTotal.plus(new Decimal(unitCost).mul(line.baseQuantity));
      await manager.update(SalesInvoiceLine, { id: line.id }, { unitCost });
    }

    // ─── الترقيم وسلسلة البصمات: القفل يجعل الإصدارات تتوالى واحداً واحداً ───
    // رقم الكاشير يولّده الجهاز (يعمل بلا إنترنت)؛ غيره تسلسلي من السيرفر
    await lockDocumentSequence(manager, 'sales_invoices', tenantId);
    const number =
      options.number ??
      (await nextDocumentNumber(
        manager,
        'sales_invoices',
        NUMBER_PREFIX,
        tenantId,
      ));
    const [last] = await manager.query<
      { counter: number; invoiceHash: string }[]
    >(
      `SELECT "counter", "invoiceHash" FROM sales_invoices
        WHERE "tenantId" = $1 AND "counter" IS NOT NULL
        ORDER BY "counter" DESC LIMIT 1`,
      [tenantId],
    );
    const previousInvoiceHash = last?.invoiceHash ?? '';

    await manager.update(
      SalesInvoice,
      { id, tenantId },
      {
        number,
        status: SalesInvoiceStatus.ISSUED,
        issuedAt,
        issuedById: userId ?? null,
        costTotal: roundMoney(
          costTotal,
          await moneyDecimalsOf(manager, tenantId),
        ),
        paidAmount: sumMoney(tenders.map((t) => t.amount)),
        deviceId: options.deviceId ?? null,
        shiftId: options.shiftId ?? null,
        counter: (last?.counter ?? 0) + 1,
        previousInvoiceHash,
        invoiceHash: computeInvoiceHash({
          uuid: invoice.uuid,
          number,
          issuedAt,
          total: invoice.total,
          taxTotal: invoice.taxTotal,
          previousHash: previousInvoiceHash,
        }),
        // رمز هيئة الزكاة والضريبة للمنشأة المسجّلة فقط (برقمها الضريبي)
        qrCode:
          seller.vatRegistered && seller.taxNumber
            ? buildZatcaQr({
                sellerName: seller.sellerName ?? '',
                taxNumber: seller.taxNumber,
                issuedAt,
                total: invoice.total,
                taxTotal: invoice.taxTotal,
              })
            : null,
      },
    );

    // ─── المقبوض عند الإصدار (بتاريخ يوم الإصدار بتوقيت الشركة) ───
    const paymentDate = tenders.length
      ? dateOnly(issuedAt, await tenantTimezoneOf(manager, tenantId))
      : '';
    for (const tender of tenders) {
      await recordPayment(manager, tenantId, {
        customerId: invoice.customerId,
        invoiceId: id,
        direction: PaymentDirection.IN,
        paymentDate,
        amount: tender.amount,
        method: tender.method,
        reference: tender.reference,
        createdById: userId,
        shiftId: options.shiftId,
      });
    }
    return overdrawn;
  }

  /** يتحقق من الأصناف والوحدات وقواعد التسعير ويحسب مبالغ كل سطر */
  private async computeLines(
    inputs: SalesLineDto[],
    pricesIncludeTax: boolean,
    tenantId: string,
    /** منشأة غير مسجّلة: بلا ضريبة مهما كانت نسبة الصنف */
    vatRegistered: boolean,
  ): Promise<ComputedLine[]> {
    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);
    const productIds = [...new Set(inputs.map((l) => l.productId))];
    const found = await this.products.findByIds(
      productIds,
      tenantId,
      undefined,
      ['baseUnit', 'units', 'units.unit', 'taxRate'],
    );
    if (found.length !== productIds.length) {
      throw new NotFoundException('الصنف غير موجود');
    }
    const products = new Map(found.map((p) => [p.id, p]));

    return inputs.map((input, index) => {
      const product = products.get(input.productId)!;
      if (!product.isActive) {
        throw new BadRequestException(`الصنف "${product.name}" موقوف`);
      }

      const unitId = input.unitId ?? product.baseUnitId;
      let factor = 1;
      let unitName = product.baseUnit?.name ?? '';
      if (unitId !== product.baseUnitId) {
        const productUnit = product.units?.find((u) => u.unitId === unitId);
        if (!productUnit) {
          throw new BadRequestException(
            `الوحدة المختارة ليست من وحدات الصنف "${product.name}"`,
          );
        }
        factor = productUnit.factor;
        unitName = productUnit.unit?.name ?? '';
      }

      const discount = input.discount ?? 0;
      const taxRate = vatRegistered ? (product.taxRate?.rate ?? 0) : 0;
      assertPricing(
        product,
        input,
        discount,
        factor,
        taxRate,
        pricesIncludeTax,
        decimals,
      );

      const amounts = computeLine({
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        discount,
        taxRate,
        pricesIncludeTax,
        factor,
        decimals,
      });

      return {
        sortOrder: index,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        isStocked: product.type === ProductType.STOCKED,
        unitId,
        unitName,
        factor,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        discount,
        taxRate,
        // غير المسجّلة خارج نطاق الضريبة
        taxCategory: vatRegistered
          ? (product.taxRate?.category ?? TaxCategory.STANDARD)
          : TaxCategory.OUT_OF_SCOPE,
        subtotal: amounts.subtotal,
        taxAmount: amounts.taxAmount,
        total: amounts.total,
        baseQuantity: amounts.baseQuantity,
      };
    });
  }

  private async replaceLines(
    manager: EntityManager,
    invoiceId: string,
    tenantId: string,
    lines: ComputedLine[],
  ): Promise<void> {
    await manager.delete(SalesInvoiceLine, { invoiceId, tenantId });
    await manager.save(
      lines.map((line) =>
        manager.create(SalesInvoiceLine, { ...line, invoiceId, tenantId }),
      ),
    );
  }
}

/** قواعد التسعير المعرّفة على الصنف: منع الخصم، وأقل سعر بيع */
function assertPricing(
  product: Product,
  input: SalesLineDto,
  discount: number,
  factor: number,
  taxRate: number,
  pricesIncludeTax: boolean,
  decimals: number,
): void {
  const gross = new Decimal(input.quantity).mul(input.unitPrice);
  if (gross.lt(discount)) {
    throw new BadRequestException(`خصم الصنف "${product.name}" أكبر من قيمته`);
  }
  if (discount > 0 && !product.allowDiscount) {
    throw new BadRequestException(
      `الصنف "${product.name}" لا يُسمح بالخصم عليه`,
    );
  }

  const minPrice = product.minSalePrice;
  if (minPrice === null || minPrice === undefined) return;

  // سعر وحدة الأساس بعد الخصم، بنفس أساس سعر الصنف (شامل/قبل الضريبة)
  let effective = gross.minus(discount).div(input.quantity).div(factor);
  const rate = new Decimal(taxRate).div(100).plus(1);
  if (pricesIncludeTax && !product.priceIncludesTax) {
    effective = effective.div(rate);
  } else if (!pricesIncludeTax && product.priceIncludesTax) {
    effective = effective.mul(rate);
  }

  // نصف أصغر جزء من العملة: فرق التقريب لا يُعدّ بيعاً تحت الحد
  if (effective.plus(new Decimal(0.5).div(10 ** decimals)).lt(minPrice)) {
    throw new BadRequestException(
      `سعر "${product.name}" بعد الخصم (${effective.toDecimalPlaces(MAX_MONEY_DECIMALS).toNumber()}) أقل من أقل سعر مسموح (${minPrice})`,
    );
  }
}

function totalsOf(lines: ComputedLine[]): Totals {
  return {
    subtotal: sumMoney(lines.map((l) => l.subtotal)),
    discountTotal: sumMoney(lines.map((l) => l.discount)),
    taxTotal: sumMoney(lines.map((l) => l.taxAmount)),
    total: sumMoney(lines.map((l) => l.total)),
  };
}

/** عميل برقم ضريبي ← فاتورة ضريبية، غير ذلك ← مبسطة */
function invoiceTypeFor(customer: Customer | null): SalesInvoiceType {
  return customer?.taxNumber
    ? SalesInvoiceType.STANDARD
    : SalesInvoiceType.SIMPLIFIED;
}

/** استحقاق الفاتورة = تاريخها + مهلة سداد العميل (العابر: نفس اليوم) */
function defaultDueDate(
  invoiceDate: string,
  customer: Customer | null,
): string {
  const result = new Date(`${invoiceDate}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + (customer?.paymentTermsDays ?? 0));
  return result.toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<SalesInvoiceStatus, string> = {
  [SalesInvoiceStatus.DRAFT]: 'مسودة',
  [SalesInvoiceStatus.ISSUED]: 'صادرة',
  [SalesInvoiceStatus.CANCELLED]: 'ملغاة',
};

/** للاستدعاء من موديول التوصيل وحده: يسمح بالعمل على مسودة أوردر توصيل */
export interface DeliveryAccess {
  delivery?: boolean;
}

function assertNotDelivery(invoice: SalesInvoice): void {
  if (invoice.isDelivery) {
    throw new BadRequestException(
      'فاتورة أوردر توصيل: تُدار من شاشة التوصيل (خروج الأوردر يصدرها، وإلغاؤه يلغيها)',
    );
  }
}

function assertStatus(
  invoice: SalesInvoice,
  expected: SalesInvoiceStatus,
  action: string,
): void {
  if (invoice.status !== expected) {
    throw new BadRequestException(
      `لا يمكن ${action} فاتورة حالتها "${STATUS_LABEL[invoice.status]}"`,
    );
  }
}
