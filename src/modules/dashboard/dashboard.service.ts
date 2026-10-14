// src/modules/dashboard/dashboard.service.ts
// أرقام الصفحة الرئيسية في طلب واحد: كل قسم يُحسب في قاعدة البيانات (لا تُحمَّل
// جداول كاملة للواجهة لتجمعها)، ويغيب القسم الذي لا تشمله خطة الشركة أو لا
// يملك المستخدم صلاحية عرضه.
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import type { CurrentUserData } from '../../common/types/auth.types';
import {
  dayKeyInZone,
  dayOffsetInZone,
  startOfDayInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import { AttendanceService } from '../attendance/attendance.service';
import { scopedBranchIds, scopedWarehouseIds } from '../branches/branch-scope';
import { Branch } from '../branches/entities/branch.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Department } from '../departments/entities/department.entity';
import { Employee } from '../employees/entities/employee.entity';
import { StockService } from '../inventory/stock.service';
import {
  LeaveRequest,
  LeaveStatus,
} from '../leaves/entities/leave-request.entity';
import { Payroll } from '../payroll/entities/payroll.entity';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';

const DAY_MINUTES = 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAYROLL_MONTHS = 6;
/** طول القوائم المرتبة (الأكثر مبيعاً، أكبر العملاء…) */
const TOP_PRODUCTS = 7;
const TOP_LIST = 5;
const RECENT_INVOICES = 6;
const LOW_STOCK_ITEMS = 6;
/** نافذة تنبيهات الموارد البشرية: ما ينتهي خلالها يظهر */
const EXPIRY_WINDOW_DAYS = 30;

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export const DEFAULT_DASHBOARD_RANGE = 30;
/** أطول فترة مخصصة: سنة (ما بعدها تقرير، لا صفحة رئيسية) */
export const MAX_RANGE_DAYS = 366;

/** ما يحدد أرقام الصفحة */
export interface DashboardQuery {
  /** آخر N يوماً حتى اليوم */
  days?: number;
  /** أو فترة مخصصة (YYYY-MM-DD، الطرفان مشمولان) — لها الأولوية على `days` */
  from?: string;
  to?: string;
  /** فرع واحد: يقيّد كل أقسام الصفحة. غائب = كل الفروع (المسموحة للمستخدم) */
  branchId?: string;
}

export interface DashboardOverview {
  /** الفترة بأيام الشركة المحلية (الطرفان مشمولان)، والفترة السابقة المساوية لها */
  range: {
    days: number;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    /** true = فترة اختارها المستخدم، false = "آخر N يوماً" */
    custom: boolean;
  };
  /** الفرع المختار، أو null لكل الفروع */
  branchId: string | null;
  /** فروع الشركة النشطة المسموحة للمستخدم، لقائمة الاختيار */
  branches: { id: string; name: string }[];
  sales: SalesOverview | null;
  purchasing: PurchasingOverview | null;
  inventory: InventoryOverview | null;
  hr: HrOverview | null;
  attendance: AttendanceOverview | null;
}

export interface NamedAmount {
  name: string;
  total: number;
}

export interface SalesOverview {
  /** إجمالي الفواتير الصادرة في الفترة (شامل الضريبة، قبل طرح المرتجعات) */
  total: number;
  previousTotal: number;
  invoices: number;
  previousInvoices: number;
  /** ما قبل الضريبة، للفواتير الصادرة: أساس نسبة هامش الربح */
  subtotal: number;
  /** ما قبل الضريبة − تكلفة البضاعة، للفواتير الصادرة (المرتجعات غير مطروحة) */
  grossProfit: number;
  previousGrossProfit: number;
  returnsTotal: number;
  /** ما لم يُحصَّل من كل الفواتير الصادرة حتى الآن (لا يتقيد بالفترة) */
  receivables: number;
  /** يوم بيوم، وكل أيام الفترة حاضرة (اليوم بلا مبيعات = صفر) */
  daily: { date: string; total: number; invoices: number }[];
  /** مبيعات الفترة السابقة يوماً بيوم، بنفس طول `daily` وترتيبه */
  previousDaily: number[];
  /** 24 خانة: مبيعات كل ساعة من اليوم بتوقيت الشركة (ساعات الذروة) */
  byHour: { hour: number; total: number; invoices: number }[];
  byCategory: NamedAmount[];
  /** المقبوض في الفترة حسب طريقة الدفع */
  paymentMethods: { method: string; amount: number }[];
  topProducts: { name: string; quantity: number; total: number }[];
  topCustomers: (NamedAmount & { invoices: number })[];
  /** أكبر العملاء مديونية حتى الآن (لا يتقيد بالفترة) */
  topDebtors: NamedAmount[];
  /** مبيعات كل فرع (مجموع مخازنه) في الفترة — كل الفروع دائماً، حتى مع اختيار فرع */
  branches: {
    id: string;
    name: string;
    total: number;
    invoices: number;
    grossProfit: number;
  }[];
  /** مبيعات كل كاشير عبر ورديّاته؛ null إن لم تشمل الخطة نقاط البيع */
  cashiers: (NamedAmount & { invoices: number })[] | null;
  recentInvoices: {
    id: string;
    number: string | null;
    issuedAt: string;
    customer: string | null;
    total: number;
    remaining: number;
  }[];
  /** ورديات كاشير مفتوحة الآن؛ null إن لم تشمل الخطة نقاط البيع */
  openShifts: number | null;
}

export interface PurchasingOverview {
  total: number;
  previousTotal: number;
  invoices: number;
  /** المستحق للموردين عن كل الفواتير المعتمدة حتى الآن */
  payables: number;
  topSuppliers: NamedAmount[];
}

export interface InventoryOverview {
  value: number;
  /** أرصدة (صنف × مخزن) */
  items: number;
  low: number;
  negative: number;
  /** الأبعد عن حدها الأدنى أولاً */
  lowStock: {
    product: string;
    warehouse: string;
    quantity: number;
    minQuantity: number;
  }[];
}

export interface HrOverview {
  employees: { active: number; inactive: number; terminated: number };
  /** الموظفون النشطون حسب القسم، الأكبر أولاً ("بلا قسم" لمن لا قسم له) */
  departments: { name: string; count: number }[];
  pending: {
    leaves: number;
    advances: number;
    loans: number;
    bonuses: number;
    deductions: number;
  };
  /** الموظفون النشطون في كل فرع */
  branches: { name: string; count: number }[];
  /** ما يحتاج متابعة خلال 30 يوماً */
  alerts: {
    /** عقود تنتهي خلال المدة */
    contractsEnding: number;
    /** إقامات/هويات تنتهي خلال المدة (أو انتهت) */
    residencyExpiring: number;
    /** في إجازة معتمدة اليوم */
    onLeaveToday: number;
    /** انضموا خلال المدة الماضية */
    newHires: number;
  };
  /**
   * آخر مسيرات الرواتب، الأقدم أولاً. المسير للشركة كلها، فيغيب (null) بلا
   * صلاحية عرضه، ومع اختيار فرع أو لمستخدم مقيَّد بفروع.
   */
  payroll:
    | { year: number; month: number; total: number; paid: boolean }[]
    | null;
}

export interface AttendanceOverview {
  /** اليوم بتوقيت الشركة */
  date: string;
  /** حضر في موعده (أو بلا وردية تُقاس عليها) */
  present: number;
  late: number;
  onLeave: number;
  /** لم يسجّل حضوراً حتى الآن */
  absent: number;
}

interface Period {
  days: number;
  custom: boolean;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** حدود الفترتين كلحظات: [بداية السابقة، بداية الحالية، نهاية الحالية) */
  previousStart: Date;
  start: Date;
  end: Date;
  /** اليوم بتوقيت الشركة */
  today: string;
  zone: string;
}

/** معرّف لا يطابق أي فرع */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly subscriptions: SubscriptionManagerService,
    private readonly stock: StockService,
    private readonly attendance: AttendanceService,
  ) {}

  async overview(
    user: CurrentUserData,
    query: DashboardQuery = {},
  ): Promise<DashboardOverview> {
    const tenantId = user.tenantId;
    const period = await this.resolvePeriod(tenantId, query);
    const allowed = await this.accessOf(user);

    const branches = await this.branchesOf(tenantId);
    const branchId = query.branchId ?? null;
    if (branchId && !branches.some((b) => b.id === branchId)) {
      throw new BadRequestException('الفرع المختار غير موجود');
    }
    // ما تُقيَّد به الأرقام: الفرع المختار، وإلا فروع المستخدم المقيَّد، وإلا
    // null = الشركة كلها. المستندات تُقيَّد بمخازن الفروع، والموظفون بالفروع
    const branchIds = branchId ? [branchId] : scopedBranchIds();
    const warehouseIds = branchId
      ? await this.warehousesOf(tenantId, branchId)
      : scopedWarehouseIds();

    const [sales, purchasing, inventory, hr, attendance] = await Promise.all([
      allowed.sales
        ? this.sales(tenantId, period, warehouseIds, branchIds, allowed.pos)
        : null,
      allowed.purchasing
        ? this.purchasing(tenantId, period, warehouseIds)
        : null,
      allowed.inventory ? this.inventory(tenantId, warehouseIds) : null,
      allowed.employees
        ? this.hr(tenantId, period, branchIds, allowed.payroll)
        : null,
      allowed.attendance ? this.attendanceToday(user, period, branchIds) : null,
    ]);

    return {
      range: {
        days: period.days,
        from: period.from,
        to: period.to,
        previousFrom: period.previousFrom,
        previousTo: period.previousTo,
        custom: period.custom,
      },
      branchId,
      branches,
      sales,
      purchasing,
      inventory,
      hr,
      attendance,
    };
  }

  // ══════════════════════════ الفترة والصلاحيات ══════════════════════════

  /**
   * الفترة بأيام الشركة المحلية لا بأيام UTC: مخصصة (from/to)، وإلا آخر
   * `days` يوماً حتى اليوم. الفترة السابقة بنفس الطول وتسبقها مباشرة.
   */
  private async resolvePeriod(
    tenantId: string,
    query: DashboardQuery,
  ): Promise<Period> {
    const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const today = dayKeyInZone(new Date(), zone);
    const custom = !!(query.from || query.to);

    let from: string;
    let to: string;
    if (custom) {
      if (!query.from || !query.to) {
        throw new BadRequestException('حدّد بداية الفترة ونهايتها معاً');
      }
      const start = this.parseDay(query.from, zone);
      const end = this.parseDay(query.to, zone);
      if (start > end) {
        throw new BadRequestException('بداية الفترة بعد نهايتها');
      }
      from = query.from;
      to = query.to;
    } else {
      const days = query.days ?? DEFAULT_DASHBOARD_RANGE;
      to = today;
      from = dayKeyInZone(
        dayOffsetInZone(today, -(days - 1) * DAY_MINUTES, zone),
        zone,
      );
    }

    const start = dayOffsetInZone(from, 0, zone);
    const end = dayOffsetInZone(to, DAY_MINUTES, zone);
    // أيام تقويمية لا ساعات: يوم تغيير التوقيت الصيفي 23 أو 25 ساعة
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `أطول فترة ${MAX_RANGE_DAYS} يوماً — اختر فترة أقصر`,
      );
    }

    const previousStart = dayOffsetInZone(from, -days * DAY_MINUTES, zone);
    return {
      days,
      custom,
      zone,
      today,
      from,
      to,
      previousFrom: dayKeyInZone(previousStart, zone),
      previousTo: dayKeyInZone(dayOffsetInZone(from, -DAY_MINUTES, zone), zone),
      previousStart,
      start,
      end,
    };
  }

  private parseDay(value: string, zone: string): Date {
    const parsed = DATE_ONLY.test(value) ? startOfDayInZone(value, zone) : null;
    if (!parsed) {
      throw new BadRequestException('التاريخ يجب أن يكون بصيغة YYYY-MM-DD');
    }
    return parsed;
  }

  /** القسم يظهر إذا شملته خطة الشركة وملك المستخدم صلاحية عرضه */
  private async accessOf(user: CurrentUserData) {
    const owned = new Set(user.permissions ?? []);
    const can = (permission: { name: string }) =>
      user.isSuperAdmin || owned.has(permission.name);
    const has = (feature: { name: string }) =>
      this.subscriptions
        .hasFeature(user.tenantId, feature.name)
        // شركة بلا اشتراك: لا قسم يظهر
        .catch(() => false);

    const [sales, pos, purchasing, inventory, employees, payroll, attendance] =
      await Promise.all([
        has(FEATURES.SALES_MODULE),
        has(FEATURES.POS_MODULE),
        has(FEATURES.PURCHASING_MODULE),
        has(FEATURES.INVENTORY_MODULE),
        has(FEATURES.EMPLOYEES_MODULE),
        has(FEATURES.PAYROLL_MODULE),
        has(FEATURES.ATTENDANCE_MODULE),
      ]);

    return {
      sales: sales && can(PERMS.SALES_VIEW),
      pos: pos && can(PERMS.POS_VIEW),
      purchasing: purchasing && can(PERMS.PURCHASE_VIEW),
      inventory: inventory && can(PERMS.INVENTORY_VIEW),
      employees: employees && can(PERMS.EMPLOYEE_VIEW),
      payroll: payroll && can(PERMS.PAYROLL_VIEW),
      attendance: attendance && can(PERMS.ATTENDANCE_SUMMARY_VIEW),
    };
  }

  /** فروع الشركة النشطة التي يحق للمستخدم رؤيتها، الرئيسي أولاً */
  private branchesOf(tenantId: string) {
    return this.query<{ id: string; name: string }>(
      `SELECT "id", "name" FROM branches
        WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "isActive" = true
          AND ($2::uuid[] IS NULL OR "id" = ANY($2::uuid[]))
        ORDER BY "isMain" DESC, "name" ASC`,
      [tenantId, scopedBranchIds()],
    );
  }

  /** مخازن فرع (حتى الموقوفة: فواتيرها القديمة تُحسب) */
  private async warehousesOf(
    tenantId: string,
    branchId: string,
  ): Promise<string[]> {
    const rows = await this.query<{ id: string }>(
      `SELECT "id" FROM warehouses
        WHERE "tenantId" = $1 AND "branchId" = $2 AND "deletedAt" IS NULL`,
      [tenantId, branchId],
    );
    return rows.map((row) => row.id);
  }

  private query<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  // ══════════════════════════ المبيعات ══════════════════════════

  private async sales(
    tenantId: string,
    period: Period,
    warehouseIds: string[] | null,
    branchIds: string[] | null,
    withPos: boolean,
  ): Promise<SalesOverview> {
    /** فواتير صادرة للشركة، مقيّدة بمخازن الفروع. `$2` = المخازن أو NULL */
    const issued = (alias = '') => {
      const col = (name: string) =>
        alias ? `${alias}."${name}"` : `"${name}"`;
      return `${col('tenantId')} = $1 AND ${col('status')} = 'issued'
              AND ${col('deletedAt')} IS NULL
              AND ($2::uuid[] IS NULL OR ${col('warehouseId')} = ANY($2::uuid[]))`;
    };
    const scope = [tenantId, warehouseIds];
    // الإجماليات بتاريخ الفاتورة (التاريخ المحاسبي) — نفس صفحة المبيعات وقائمة
    // الفواتير وكشف الحساب. التوزيع حسب الساعة وحده بلحظة الإصدار
    const inPeriod = [...scope, period.from, period.to];
    const atMoment = [...scope, period.start, period.end];

    const [
      byDay,
      byHour,
      byCategory,
      returns,
      receivables,
      methods,
      products,
      customers,
      debtors,
      branches,
      cashiers,
      recent,
      shifts,
    ] = await Promise.all([
      // الفترتان معاً، مجمّعتين بتاريخ الفاتورة
      this.query<{
        day: string;
        total: number;
        invoices: number;
        subtotal: number;
        profit: number;
      }>(
        `SELECT "invoiceDate"::text AS "day",
                COALESCE(SUM("total"), 0)::float AS "total",
                COUNT(*)::int AS "invoices",
                COALESCE(SUM("subtotal"), 0)::float AS "subtotal",
                COALESCE(SUM("subtotal" - "costTotal"), 0)::float AS "profit"
           FROM sales_invoices
          WHERE ${issued()} AND "invoiceDate" BETWEEN $3 AND $4
          GROUP BY 1`,
        [...scope, period.previousFrom, period.to],
      ),
      // ساعة البيع الفعلية بتوقيت الشركة (لتاريخ الفاتورة لا ساعة)
      this.query<{ hour: number; total: number; invoices: number }>(
        `SELECT EXTRACT(HOUR FROM "issuedAt" AT TIME ZONE $5)::int AS "hour",
                SUM("total")::float AS "total",
                COUNT(*)::int AS "invoices"
           FROM sales_invoices
          WHERE ${issued()} AND "issuedAt" >= $3 AND "issuedAt" < $4
          GROUP BY 1`,
        [...atMoment, period.zone],
      ),
      this.query<NamedAmount>(
        `SELECT COALESCE(category."name", 'بلا تصنيف') AS "name",
                SUM(line."total")::float AS "total"
           FROM sales_invoice_lines line
           JOIN sales_invoices invoice ON invoice."id" = line."invoiceId"
           LEFT JOIN products product ON product."id" = line."productId"
           LEFT JOIN product_categories category ON category."id" = product."categoryId"
          WHERE ${issued('invoice')}
            AND invoice."invoiceDate" BETWEEN $3 AND $4
          GROUP BY 1
          ORDER BY 2 DESC`,
        inPeriod,
      ),
      this.query<{ total: number }>(
        `SELECT COALESCE(SUM("total"), 0)::float AS "total"
           FROM sales_returns
          WHERE ${issued()} AND "returnDate" BETWEEN $3 AND $4`,
        inPeriod,
      ),
      this.query<{ amount: number }>(
        `SELECT COALESCE(SUM(GREATEST("total" - "returnedAmount" - "paidAmount", 0)), 0)::float AS "amount"
           FROM sales_invoices
          WHERE ${issued()}`,
        scope,
      ),
      // سند القبض يحمل فرعه (فرع فاتورته، أو المختار لدفعة على الحساب)
      this.query<{ method: string; amount: number }>(
        `SELECT payment."method"::text AS "method",
                SUM(payment."amount")::float AS "amount"
           FROM customer_payments payment
          WHERE payment."tenantId" = $1 AND payment."direction" = 'in'
            AND payment."status" = 'posted' AND payment."deletedAt" IS NULL
            AND payment."paymentDate" BETWEEN $3 AND $4
            AND ($2::uuid[] IS NULL OR payment."branchId" = ANY($2::uuid[]))
          GROUP BY 1
          ORDER BY 2 DESC`,
        [tenantId, branchIds, period.from, period.to],
      ),
      this.query<{ name: string; quantity: number; total: number }>(
        `SELECT MAX(line."productName") AS "name",
                SUM(line."baseQuantity")::float AS "quantity",
                SUM(line."total")::float AS "total"
           FROM sales_invoice_lines line
           JOIN sales_invoices invoice ON invoice."id" = line."invoiceId"
          WHERE ${issued('invoice')}
            AND invoice."invoiceDate" BETWEEN $3 AND $4
          GROUP BY line."productId"
          ORDER BY 3 DESC
          LIMIT ${TOP_PRODUCTS}`,
        inPeriod,
      ),
      this.query<NamedAmount & { invoices: number }>(
        `SELECT customer."name" AS "name",
                SUM(invoice."total")::float AS "total",
                COUNT(*)::int AS "invoices"
           FROM sales_invoices invoice
           JOIN customers customer ON customer."id" = invoice."customerId"
          WHERE ${issued('invoice')}
            AND invoice."invoiceDate" BETWEEN $3 AND $4
          GROUP BY customer."id", customer."name"
          ORDER BY 2 DESC
          LIMIT ${TOP_LIST}`,
        inPeriod,
      ),
      this.query<NamedAmount>(
        `SELECT customer."name" AS "name",
                SUM(GREATEST(invoice."total" - invoice."returnedAmount" - invoice."paidAmount", 0))::float AS "total"
           FROM sales_invoices invoice
           JOIN customers customer ON customer."id" = invoice."customerId"
          WHERE ${issued('invoice')}
          GROUP BY customer."id", customer."name"
         HAVING SUM(GREATEST(invoice."total" - invoice."returnedAmount" - invoice."paidAmount", 0)) > 0
          ORDER BY 2 DESC
          LIMIT ${TOP_LIST}`,
        scope,
      ),
      // المقارنة بين الفروع: كلها دائماً، حتى مع اختيار فرع واحد
      this.query<{
        id: string;
        name: string;
        total: number;
        invoices: number;
        profit: number;
      }>(
        `SELECT branch."id" AS "id", branch."name" AS "name",
                COALESCE(SUM(invoice."total"), 0)::float AS "total",
                COUNT(invoice."id")::int AS "invoices",
                COALESCE(SUM(invoice."subtotal" - invoice."costTotal"), 0)::float AS "profit"
           FROM branches branch
           LEFT JOIN warehouses warehouse
                  ON warehouse."branchId" = branch."id"
           LEFT JOIN sales_invoices invoice
                  ON invoice."warehouseId" = warehouse."id"
                 AND invoice."status" = 'issued' AND invoice."deletedAt" IS NULL
                 AND invoice."invoiceDate" BETWEEN $2 AND $3
          WHERE branch."tenantId" = $1 AND branch."deletedAt" IS NULL
            AND ($4::uuid[] IS NULL OR branch."id" = ANY($4::uuid[]))
          GROUP BY branch."id", branch."name"
         HAVING branch."isActive" = true OR COUNT(invoice."id") > 0
          ORDER BY 3 DESC, 2 ASC`,
        [tenantId, period.from, period.to, scopedBranchIds()],
      ),
      withPos
        ? this.query<NamedAmount & { invoices: number }>(
            `SELECT COALESCE(NULLIF(shift."cashierName", ''), 'بلا اسم') AS "name",
                    SUM(invoice."total")::float AS "total",
                    COUNT(*)::int AS "invoices"
               FROM sales_invoices invoice
               JOIN pos_shifts shift ON shift."id" = invoice."shiftId"
              WHERE ${issued('invoice')}
                AND invoice."invoiceDate" BETWEEN $3 AND $4
              GROUP BY 1
              ORDER BY 2 DESC
              LIMIT ${TOP_LIST}`,
            inPeriod,
          )
        : null,
      this.query<{
        id: string;
        number: string | null;
        issuedAt: Date;
        customer: string | null;
        total: number;
        remaining: number;
      }>(
        `SELECT invoice."id" AS "id", invoice."number" AS "number",
                invoice."issuedAt" AS "issuedAt", customer."name" AS "customer",
                invoice."total"::float AS "total",
                GREATEST(invoice."total" - invoice."returnedAmount" - invoice."paidAmount", 0)::float AS "remaining"
           FROM sales_invoices invoice
           LEFT JOIN customers customer ON customer."id" = invoice."customerId"
          WHERE ${issued('invoice')}
          ORDER BY invoice."issuedAt" DESC
          LIMIT ${RECENT_INVOICES}`,
        scope,
      ),
      withPos
        ? this.query<{ count: number }>(
            `SELECT COUNT(*)::int AS "count" FROM pos_shifts shift
               JOIN pos_devices device ON device."id" = shift."deviceId"
              WHERE shift."tenantId" = $1 AND shift."status" = 'open'
                AND ($2::uuid[] IS NULL OR device."warehouseId" = ANY($2::uuid[]))`,
            scope,
          )
        : null,
    ]);

    const rows = new Map(byDay.map((row) => [row.day, row]));
    const sumOf = (from: string, to: string) => {
      const totals = { total: 0, invoices: 0, subtotal: 0, profit: 0 };
      for (const row of byDay) {
        // صيغة YYYY-MM-DD تُقارن نصياً كما تُقارن زمنياً
        if (row.day < from || row.day > to) continue;
        totals.total += row.total;
        totals.invoices += row.invoices;
        totals.subtotal += row.subtotal;
        totals.profit += row.profit;
      }
      return totals;
    };
    const current = sumOf(period.from, period.to);
    const previous = sumOf(period.previousFrom, period.previousTo);
    const dayAt = (from: string, index: number) =>
      dayKeyInZone(
        dayOffsetInZone(from, index * DAY_MINUTES, period.zone),
        period.zone,
      );
    const hours = new Map(byHour.map((row) => [row.hour, row]));

    return {
      total: round(current.total),
      previousTotal: round(previous.total),
      invoices: current.invoices,
      previousInvoices: previous.invoices,
      subtotal: round(current.subtotal),
      grossProfit: round(current.profit),
      previousGrossProfit: round(previous.profit),
      returnsTotal: round(returns[0]?.total ?? 0),
      receivables: round(receivables[0]?.amount ?? 0),
      daily: Array.from({ length: period.days }, (_, index) => {
        const date = dayAt(period.from, index);
        const row = rows.get(date);
        return {
          date,
          total: round(row?.total ?? 0),
          invoices: row?.invoices ?? 0,
        };
      }),
      previousDaily: Array.from({ length: period.days }, (_, index) =>
        round(rows.get(dayAt(period.previousFrom, index))?.total ?? 0),
      ),
      byHour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        total: round(hours.get(hour)?.total ?? 0),
        invoices: hours.get(hour)?.invoices ?? 0,
      })),
      byCategory: byCategory.map(named),
      paymentMethods: methods.map((m) => ({
        method: m.method,
        amount: round(m.amount),
      })),
      topProducts: products.map((p) => ({
        name: p.name,
        quantity: round(p.quantity),
        total: round(p.total),
      })),
      topCustomers: customers.map((c) => ({
        ...named(c),
        invoices: c.invoices,
      })),
      topDebtors: debtors.map(named),
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        total: round(b.total),
        invoices: b.invoices,
        grossProfit: round(b.profit),
      })),
      cashiers: cashiers
        ? cashiers.map((c) => ({ ...named(c), invoices: c.invoices }))
        : null,
      recentInvoices: recent.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        issuedAt: new Date(invoice.issuedAt).toISOString(),
        customer: invoice.customer,
        total: round(invoice.total),
        remaining: round(invoice.remaining),
      })),
      openShifts: shifts ? (shifts[0]?.count ?? 0) : null,
    };
  }

  // ══════════════════════════ المشتريات والمخزون ══════════════════════════

  private async purchasing(
    tenantId: string,
    period: Period,
    warehouseIds: string[] | null,
  ): Promise<PurchasingOverview> {
    const posted = (alias = '') => {
      const col = (name: string) =>
        alias ? `${alias}."${name}"` : `"${name}"`;
      return `${col('tenantId')} = $1 AND ${col('status')} = 'posted'
              AND ${col('deletedAt')} IS NULL
              AND ($2::uuid[] IS NULL OR ${col('warehouseId')} = ANY($2::uuid[]))`;
    };
    const scope = [tenantId, warehouseIds];
    const totalsBetween = (from: string, to: string) =>
      this.query<{ total: number; invoices: number }>(
        `SELECT COALESCE(SUM("total"), 0)::float AS "total", COUNT(*)::int AS "invoices"
           FROM purchase_invoices
          WHERE ${posted()} AND "invoiceDate" BETWEEN $3 AND $4`,
        [...scope, from, to],
      );

    const [current, previous, payables, suppliers] = await Promise.all([
      totalsBetween(period.from, period.to),
      totalsBetween(period.previousFrom, period.previousTo),
      this.query<{ amount: number }>(
        `SELECT COALESCE(SUM(GREATEST("total" - "returnedAmount" - "paidAmount", 0)), 0)::float AS "amount"
           FROM purchase_invoices
          WHERE ${posted()}`,
        scope,
      ),
      this.query<NamedAmount>(
        `SELECT supplier."name" AS "name", SUM(invoice."total")::float AS "total"
           FROM purchase_invoices invoice
           JOIN suppliers supplier ON supplier."id" = invoice."supplierId"
          WHERE ${posted('invoice')} AND invoice."invoiceDate" BETWEEN $3 AND $4
          GROUP BY supplier."id", supplier."name"
          ORDER BY 2 DESC
          LIMIT ${TOP_LIST}`,
        [...scope, period.from, period.to],
      ),
    ]);

    return {
      total: round(current[0]?.total ?? 0),
      previousTotal: round(previous[0]?.total ?? 0),
      invoices: current[0]?.invoices ?? 0,
      payables: round(payables[0]?.amount ?? 0),
      topSuppliers: suppliers.map(named),
    };
  }

  private async inventory(
    tenantId: string,
    warehouseIds: string[] | null,
  ): Promise<InventoryOverview> {
    const [summary, lowStock] = await Promise.all([
      this.stock.summary(tenantId, warehouseIds ?? undefined),
      this.query<{
        product: string;
        warehouse: string;
        quantity: number;
        minQuantity: number;
      }>(
        `SELECT product."name" AS "product", warehouse."name" AS "warehouse",
                level."quantity"::float AS "quantity",
                level."minQuantity"::float AS "minQuantity"
           FROM stock_levels level
           JOIN products product ON product."id" = level."productId" AND product."deletedAt" IS NULL
           JOIN warehouses warehouse ON warehouse."id" = level."warehouseId" AND warehouse."deletedAt" IS NULL
          WHERE level."tenantId" = $1
            AND ($2::uuid[] IS NULL OR level."warehouseId" = ANY($2::uuid[]))
            AND level."minQuantity" IS NOT NULL
            AND level."quantity" <= level."minQuantity"
          ORDER BY (level."quantity" - level."minQuantity") ASC, product."name" ASC
          LIMIT ${LOW_STOCK_ITEMS}`,
        [tenantId, warehouseIds],
      ),
    ]);

    return {
      value: summary.value,
      items: summary.items,
      low: summary.low,
      negative: summary.negative,
      lowStock: lowStock.map((row) => ({
        product: row.product,
        warehouse: row.warehouse,
        quantity: round(row.quantity),
        minQuantity: round(row.minQuantity),
      })),
    };
  }

  // ══════════════════════════ الموارد البشرية ══════════════════════════

  private async hr(
    tenantId: string,
    period: Period,
    branchIds: string[] | null,
    withPayroll: boolean,
  ): Promise<HrOverview> {
    const manager = this.dataSource.manager;
    /** طلبات معلّقة لموظفي الفروع. `employeeColumn`: عمود الموظف في الجدول */
    const pendingIn = (table: string, employeeColumn = 'employee_id') =>
      this.query<{ count: number }>(
        `SELECT COUNT(*)::int AS "count" FROM ${table} request
           JOIN employees employee ON employee."id" = request."${employeeColumn}"
          WHERE request."tenant_id" = $1 AND request."status" = 'pending'
            AND ($2::uuid[] IS NULL OR employee."branch_id" = ANY($2::uuid[]))`,
        [tenantId, branchIds],
      ).then((rows) => rows[0]?.count ?? 0);
    /** يقيّد استعلاماً فيه الموظف باسم `employee` بالفروع */
    const inBranches = <T extends ObjectLiteral>(qb: SelectQueryBuilder<T>) =>
      branchIds
        ? qb.andWhere('employee.branchId IN (:...branchIds)', {
            // قائمة فارغة = لا شيء (لا خطأ صياغة في IN)
            branchIds: branchIds.length ? branchIds : [NO_BRANCH],
          })
        : qb;

    const { today, zone } = period;
    const windowEnd = dayKeyInZone(
      dayOffsetInZone(today, EXPIRY_WINDOW_DAYS * DAY_MINUTES, zone),
      zone,
    );
    const windowStart = dayOffsetInZone(
      today,
      -EXPIRY_WINDOW_DAYS * DAY_MINUTES,
      zone,
    );
    const activeEmployees = () =>
      inBranches(
        manager
          .createQueryBuilder(Employee, 'employee')
          .where('employee.tenantId = :tenantId', { tenantId })
          .andWhere(`employee.status = 'active'`),
      );

    const [byStatus, byDepartment, byBranch, pending, alerts, payrolls] =
      await Promise.all([
        inBranches(
          manager
            .createQueryBuilder(Employee, 'employee')
            .select('employee.status', 'status')
            .addSelect('COUNT(*)::int', 'count')
            .where('employee.tenantId = :tenantId', { tenantId }),
        )
          .groupBy('employee.status')
          .getRawMany<{ status: string; count: number }>(),
        activeEmployees()
          .leftJoin(
            Department,
            'department',
            'department.id = employee.departmentId',
          )
          .select('department.name', 'name')
          .addSelect('COUNT(*)::int', 'count')
          .groupBy('department.name')
          .orderBy('count', 'DESC')
          .getRawMany<{ name: string | null; count: number }>(),
        activeEmployees()
          .leftJoin(Branch, 'branch', 'branch.id = employee.branchId')
          .select('branch.name', 'name')
          .addSelect('COUNT(*)::int', 'count')
          .groupBy('branch.name')
          .orderBy('count', 'DESC')
          .getRawMany<{ name: string | null; count: number }>(),
        Promise.all([
          pendingIn('leave_requests', 'employeeId'),
          pendingIn('advances'),
          pendingIn('loans'),
          pendingIn('bonuses'),
          pendingIn('deductions'),
        ]),
        Promise.all([
          // عقد موظف نشط ينتهي من اليوم حتى نهاية النافذة
          inBranches(
            manager
              .createQueryBuilder(Contract, 'contract')
              .innerJoin(
                Employee,
                'employee',
                `employee.id = contract.employeeId AND employee.status = 'active'`,
              )
              .where('contract.tenantId = :tenantId', { tenantId })
              .andWhere('contract.endDate BETWEEN :today AND :windowEnd', {
                today,
                windowEnd,
              }),
          ).getCount(),
          // منتهية بالفعل أو تنتهي خلال النافذة: كلاهما يحتاج تجديداً
          activeEmployees()
            .andWhere('employee.iqamaExpiryDate <= :windowEnd', { windowEnd })
            .getCount(),
          inBranches(
            manager
              .createQueryBuilder(LeaveRequest, 'leave')
              .innerJoin(Employee, 'employee', 'employee.id = leave.employeeId')
              .where('leave.tenantId = :tenantId', { tenantId })
              .andWhere('leave.status = :status', {
                status: LeaveStatus.APPROVED,
              })
              .andWhere(':today BETWEEN leave.startDate AND leave.endDate', {
                today,
              }),
          ).getCount(),
          activeEmployees()
            .andWhere('employee.createdAt >= :windowStart', { windowStart })
            .getCount(),
        ]),
        // المسير للشركة كلها: لا يُعرض ضمن أرقام فرع
        withPayroll && !branchIds
          ? manager.find(Payroll, {
              where: { tenantId },
              order: { year: 'DESC', month: 'DESC' },
              take: PAYROLL_MONTHS,
            })
          : null,
      ]);

    const countOf = (status: string) =>
      byStatus.find((row) => row.status === status)?.count ?? 0;
    const [leaves, advances, loans, bonuses, deductions] = pending;
    const [contractsEnding, residencyExpiring, onLeaveToday, newHires] = alerts;

    return {
      employees: {
        active: countOf('active'),
        inactive: countOf('inactive'),
        terminated: countOf('terminated'),
      },
      departments: byDepartment.map((row) => ({
        name: row.name ?? 'بلا قسم',
        count: row.count,
      })),
      branches: byBranch.map((row) => ({
        name: row.name ?? 'بلا فرع',
        count: row.count,
      })),
      pending: { leaves, advances, loans, bonuses, deductions },
      alerts: { contractsEnding, residencyExpiring, onLeaveToday, newHires },
      payroll: payrolls
        ? payrolls
            .map((p) => ({
              year: p.year,
              month: p.month,
              total: round(Number(p.totalNetSalary)),
              paid: p.isDisbursed,
            }))
            .reverse()
        : null,
    };
  }

  /** حضور اليوم: من ملخص الحضور نفسه (نفس حدود اليوم والوردية) */
  private async attendanceToday(
    user: CurrentUserData,
    period: Period,
    branchIds: string[] | null,
  ): Promise<AttendanceOverview> {
    // الملخص نفسه يقتصر على فروع المستخدم المقيَّد؛ هنا يُضاف الفرع المختار
    const [rows, inBranch] = await Promise.all([
      this.attendance.getDailySummary(period.today, user),
      branchIds
        ? this.query<{ id: string }>(
            `SELECT "id" FROM employees
              WHERE "tenant_id" = $1 AND "branch_id" = ANY($2::uuid[])`,
            [user.tenantId, branchIds],
          ).then((found) => new Set(found.map((row) => row.id)))
        : null,
    ]);
    const count = (...statuses: string[]) =>
      rows.filter(
        (row) =>
          !!row.employeeId &&
          statuses.includes(row.status) &&
          (!inBranch || inBranch.has(row.employeeId)),
      ).length;

    return {
      date: period.today,
      present: count('present', 'early_leave', 'incomplete', 'unclassified'),
      late: count('late', 'late_and_early_leave'),
      onLeave: count('on_leave'),
      absent: count('absent'),
    };
  }
}

/** ضجيج الفاصلة العائمة بعد الجمع (المبالغ مخزّنة بثلاث خانات على الأكثر) */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function named(row: NamedAmount): NamedAmount {
  return { name: row.name, total: round(row.total) };
}
