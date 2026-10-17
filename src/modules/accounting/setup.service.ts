// src/modules/accounting/setup.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { getCountry } from '../../common/constants/countries';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { tenantTimezoneOf } from '../../common/utils/timezone.util';
import { Advance, AdvanceStatus } from '../advances/entities/advance.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { Payroll } from '../payroll/entities/payroll.entity';
import { dateOnly } from '../sales/utils/payment-recorder';
import {
  AccountType,
  DEFAULT_PAYMENT_ACCOUNTS,
  DEFAULT_RECEIPT_ACCOUNTS,
  JournalSource,
  PartyType,
  SystemAccount,
} from './accounting.constants';
import { ChartService } from './chart.service';
import {
  ActivateAccountingDto,
  UpdateAccountingSettingsDto,
} from './dto/accounting.dto';
import {
  Account,
  AccountingSettings,
  PostingError,
} from './entities/accounting.entity';
import { EntryLines } from './entry-lines';
import { LedgerService } from './ledger.service';

export interface AccountingStatus {
  active: boolean;
  settings: AccountingSettings | null;
  /** طريقة القبض/الدفع ← الحساب المستخدم فعلاً (المحدد أو الافتراضي) */
  receiptAccounts: Record<string, string>;
  paymentAccounts: Record<string, string>;
  /** مستندات تعذّر ترحيلها (الأحدث أولاً) */
  errors: PostingError[];
  errorsCount: number;
}

/**
 * تفعيل المحاسبة وإعداداتها. التفعيل مرة واحدة: ينشئ شجرة الدولة، ويقيّد
 * قيداً افتتاحياً بأرصدة تلك اللحظة (العملاء، الموردون، المخزون، جهات
 * التوصيل، سلف وقروض الموظفين) مقابل «أرصدة افتتاحية»، ومن بعدها يُرحَّل كل
 * مستند تلقائياً. النقدية والبنوك والأصول يدخلها المحاسب بقيد يدوي.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly chart: ChartService,
    private readonly ledger: LedgerService,
  ) {}

  async status(tenantId: string): Promise<AccountingStatus> {
    const settings = await this.dataSource.manager.findOne(AccountingSettings, {
      where: { tenantId },
    });
    if (!settings) {
      return {
        active: false,
        settings: null,
        receiptAccounts: {},
        paymentAccounts: {},
        errors: [],
        errorsCount: 0,
      };
    }
    const keys = await this.systemAccounts(this.dataSource.manager, tenantId);
    const resolve = (
      chosen: Record<string, string>,
      defaults: Record<string, SystemAccount>,
    ) =>
      Object.fromEntries(
        Object.entries(defaults).map(([method, key]) => [
          method,
          chosen?.[method] ?? keys.get(key) ?? '',
        ]),
      );
    const [errors, errorsCount] = await this.dataSource.manager.findAndCount(
      PostingError,
      { where: { tenantId }, order: { lastSeenAt: 'DESC' }, take: 100 },
    );
    return {
      active: true,
      settings,
      receiptAccounts: resolve(
        settings.receiptAccounts,
        DEFAULT_RECEIPT_ACCOUNTS,
      ),
      paymentAccounts: resolve(
        settings.paymentAccounts,
        DEFAULT_PAYMENT_ACCOUNTS,
      ),
      errors,
      errorsCount,
    };
  }

  /**
   * التفعيل في معاملة REPEATABLE READ: أرصدة القيد الافتتاحي لقطة واحدة
   * متسقة، ولحظة التفعيل = بداية المعاملة. ما يقع بعدها يُرحَّل بمستنده.
   */
  async activate(
    tenantId: string,
    dto: ActivateAccountingDto,
    userId?: string,
  ): Promise<AccountingStatus> {
    await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `accounting-activate:${tenantId}`,
      ]);
      if (await manager.exists(AccountingSettings, { where: { tenantId } })) {
        throw new ConflictException('المحاسبة مفعّلة لهذه الشركة من قبل');
      }

      const [tenant] = await manager.query<{ country: string | null }[]>(
        `SELECT "country" FROM tenants WHERE "id" = $1`,
        [tenantId],
      );
      const country = getCountry(dto.country ?? tenant?.country).code;
      await this.chart.seedTemplate(manager, tenantId, country);

      const [{ now }] = await manager.query<{ now: Date }[]>(
        'SELECT now() AS "now"',
      );
      const timezone = await tenantTimezoneOf(manager, tenantId);
      const settings = await manager.save(
        manager.create(AccountingSettings, {
          tenantId,
          activatedAt: now,
          startDate: dateOnly(now, timezone),
          chartCountry: country,
          receiptAccounts: {},
          paymentAccounts: {},
          activatedById: userId ?? null,
        }),
      );

      // أرصدة العملاء والموردين الافتتاحية الآن: تعديلها لاحقاً يُرحَّل فرقه
      await manager.query(
        `INSERT INTO accounting_opening_baselines ("tenantId", "partyType", "partyId", "amount")
         SELECT "tenantId", $2, "id", "openingBalance" FROM customers
          WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "openingBalance" <> 0
         UNION ALL
         SELECT "tenantId", $3, "id", "openingBalance" FROM suppliers
          WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "openingBalance" <> 0`,
        [tenantId, PartyType.CUSTOMER, PartyType.SUPPLIER],
      );

      const lines = await this.openingLines(manager, tenantId);
      await this.ledger.post(
        manager,
        {
          tenantId,
          date: settings.startDate,
          description:
            'القيد الافتتاحي عند تفعيل المحاسبة: أرصدة العملاء والموردين والمخزون وجهات التوصيل وسلف الموظفين وقروضهم',
          sourceType: JournalSource.OPENING,
          sourceId: tenantId,
          sourceEvent: 'activation',
          lines,
          createdById: userId ?? null,
          automatic: false,
        },
        settings,
      );
    });
    return this.status(tenantId);
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateAccountingSettingsDto,
  ): Promise<AccountingStatus> {
    const settings = await this.settingsOf(tenantId);
    const changes: Partial<AccountingSettings> = {};

    if (dto.lockDate !== undefined) {
      // السنة المُقفلة لا تُفتح بتاريخ القفل: بإعادة فتحها (فيُعكس قيد إقفالها)
      const closedEnd = settings.closedThroughYear
        ? `${settings.closedThroughYear}-12-31`
        : null;
      if (closedEnd && (dto.lockDate === null || dto.lockDate < closedEnd)) {
        throw new BadRequestException(
          `سنة ${settings.closedThroughYear} مُقفلة: القفل لا يقل عن ${closedEnd} — أعد فتح السنة أولاً`,
        );
      }
      if (dto.lockDate !== null) {
        if (dto.lockDate < settings.startDate) {
          throw new BadRequestException(
            `تاريخ القفل قبل بداية الدفاتر (${settings.startDate})`,
          );
        }
        const today = dateOnly(
          new Date(),
          await tenantTimezoneOf(this.dataSource.manager, tenantId),
        );
        if (dto.lockDate > today) {
          throw new BadRequestException('لا تُقفل فترة لم تنتهِ بعد');
        }
      }
      changes.lockDate = dto.lockDate;
    }
    if (dto.receiptAccounts) {
      changes.receiptAccounts = await this.methodAccounts(
        tenantId,
        dto.receiptAccounts,
        Object.keys(DEFAULT_RECEIPT_ACCOUNTS),
      );
    }
    if (dto.paymentAccounts) {
      changes.paymentAccounts = await this.methodAccounts(
        tenantId,
        dto.paymentAccounts,
        Object.keys(DEFAULT_PAYMENT_ACCOUNTS),
      );
    }
    if (Object.keys(changes).length) {
      await this.dataSource.manager.update(
        AccountingSettings,
        { tenantId },
        changes,
      );
    }
    return this.status(tenantId);
  }

  async settingsOf(tenantId: string): Promise<AccountingSettings> {
    const settings = await this.dataSource.manager.findOne(AccountingSettings, {
      where: { tenantId },
    });
    if (!settings) {
      throw new NotFoundException(
        'المحاسبة غير مفعّلة لهذه الشركة — فعّلها أولاً',
      );
    }
    return settings;
  }

  /** طريقة ← حساب: حسابات فرعية فعّالة من الأصول (صندوق، بنك…) */
  private async methodAccounts(
    tenantId: string,
    map: Record<string, string>,
    methods: string[],
  ): Promise<Record<string, string>> {
    const entries = Object.entries(map).filter(([, id]) => !!id);
    for (const [method] of entries) {
      if (!methods.includes(method)) {
        throw new BadRequestException(`طريقة دفع غير معروفة: ${method}`);
      }
    }
    const ids = entries.map(([, id]) => id);
    const accounts = ids.length
      ? await this.dataSource.manager.find(Account, {
          where: { tenantId, id: In(ids) },
        })
      : [];
    for (const id of ids) {
      const account = accounts.find((a) => a.id === id);
      if (!account) throw new BadRequestException('حساب غير موجود في الشجرة');
      if (
        account.isGroup ||
        !account.isActive ||
        account.type !== AccountType.ASSET
      ) {
        throw new BadRequestException(
          `"${account.name}": اختر حساباً فرعياً فعّالاً من الأصول (صندوق، بنك…)`,
        );
      }
    }
    return Object.fromEntries(entries);
  }

  private async systemAccounts(
    manager: EntityManager,
    tenantId: string,
  ): Promise<Map<string, string>> {
    const accounts = await manager.find(Account, {
      where: { tenantId },
      select: ['id', 'systemKey'],
    });
    return new Map(
      accounts
        .filter((a) => a.systemKey)
        .map((a) => [a.systemKey as string, a.id]),
    );
  }

  /**
   * أسطر القيد الافتتاحي: نفس صيغ أرصدة النظام (كشوف العملاء والموردين،
   * قيمة المخزون بمتوسط التكلفة، ما مع جهات التوصيل)، فيطابق الأستاذ العام
   * دفاتره المساعدة من أول يوم.
   */
  private async openingLines(manager: EntityManager, tenantId: string) {
    const lines = new EntryLines({
      keys: await this.systemAccounts(manager, tenantId),
      decimals: await moneyDecimalsOf(manager, tenantId),
    });

    // ─── العملاء (والبيع النقدي بلا عميل إن بقي منه شيء) ───
    const customers = await manager.query<
      { id: string | null; balance: string }[]
    >(
      `SELECT c."id",
              c."openingBalance"
              + COALESCE((SELECT SUM(i."total") FROM sales_invoices i
                           WHERE i."customerId" = c."id" AND i."status" = 'issued'), 0)
              - COALESCE((SELECT SUM(r."total") FROM sales_returns r
                           WHERE r."customerId" = c."id" AND r."status" = 'issued'), 0)
              - COALESCE((SELECT SUM(CASE WHEN p."direction" = 'in' THEN p."amount" ELSE -p."amount" END)
                            FROM customer_payments p
                           WHERE p."customerId" = c."id" AND p."status" = 'posted'), 0) AS "balance"
         FROM customers c
        WHERE c."tenantId" = $1 AND c."deletedAt" IS NULL
       UNION ALL
       SELECT NULL,
              COALESCE((SELECT SUM(i."total") FROM sales_invoices i
                         WHERE i."tenantId" = $1 AND i."customerId" IS NULL AND i."status" = 'issued'), 0)
              - COALESCE((SELECT SUM(r."total") FROM sales_returns r
                           WHERE r."tenantId" = $1 AND r."customerId" IS NULL AND r."status" = 'issued'), 0)
              - COALESCE((SELECT SUM(CASE WHEN p."direction" = 'in' THEN p."amount" ELSE -p."amount" END)
                            FROM customer_payments p
                           WHERE p."tenantId" = $1 AND p."customerId" IS NULL AND p."status" = 'posted'), 0)`,
      [tenantId],
    );
    for (const row of customers) {
      lines.add(SystemAccount.RECEIVABLES, row.balance, {
        party: row.id ? { type: PartyType.CUSTOMER, id: row.id } : null,
      });
    }

    // ─── الموردون (رصيدهم دائن) ───
    const suppliers = await manager.query<{ id: string; balance: string }[]>(
      `SELECT s."id",
              s."openingBalance"
              + COALESCE((SELECT SUM(i."total") FROM purchase_invoices i
                           WHERE i."supplierId" = s."id" AND i."status" = 'posted'), 0)
              - COALESCE((SELECT SUM(r."total") FROM purchase_returns r
                           WHERE r."supplierId" = s."id" AND r."status" = 'posted'), 0)
              - COALESCE((SELECT SUM(p."amount") FROM supplier_payments p
                           WHERE p."supplierId" = s."id" AND p."status" = 'posted'), 0) AS "balance"
         FROM suppliers s
        WHERE s."tenantId" = $1 AND s."deletedAt" IS NULL`,
      [tenantId],
    );
    for (const row of suppliers) {
      lines.add(SystemAccount.PAYABLES, new Decimal(row.balance).neg(), {
        party: { type: PartyType.SUPPLIER, id: row.id },
      });
    }

    // ─── المخزون بمتوسط التكلفة، لكل فرع، وما في الطريق بين المخازن ───
    const stock = await manager.query<
      { branchId: string | null; value: string }[]
    >(
      `SELECT w."branchId", SUM(l."quantity" * i."avgCost") AS "value"
         FROM stock_levels l
         JOIN inventory_items i ON i."tenantId" = l."tenantId" AND i."productId" = l."productId"
         JOIN warehouses w ON w."id" = l."warehouseId"
        WHERE l."tenantId" = $1
        GROUP BY w."branchId"
       UNION ALL
       SELECT NULL, SUM("inTransitQuantity" * "avgCost") FROM inventory_items
        WHERE "tenantId" = $1`,
      [tenantId],
    );
    for (const row of stock) {
      lines.add(SystemAccount.INVENTORY, row.value ?? 0, {
        branchId: row.branchId,
      });
    }

    // ─── ما مع جهات التوصيل: محصّل عبرها − ما رُدّ − ما سُوّي ───
    const couriers = await manager.query<
      { agentId: string | null; amount: string }[]
    >(
      `SELECT x."agentId", SUM(x."amount") AS "amount" FROM (
         SELECT o."agentId",
                CASE WHEN p."direction" = 'in' THEN p."amount" ELSE -p."amount" END AS "amount"
           FROM customer_payments p
           LEFT JOIN delivery_orders o ON o."invoiceId" = p."invoiceId"
          WHERE p."tenantId" = $1 AND p."method" = 'courier' AND p."status" = 'posted'
         UNION ALL
         SELECT s."agentId", -s."collectedTotal"
           FROM delivery_settlements s
          WHERE s."tenantId" = $1 AND s."deletedAt" IS NULL
       ) x GROUP BY x."agentId"`,
      [tenantId],
    );
    for (const row of couriers) {
      lines.add(SystemAccount.COURIER_RECEIVABLE, row.amount, {
        party: row.agentId
          ? { type: PartyType.COURIER, id: row.agentId }
          : null,
      });
    }

    // ─── سلف سُلّمت ولم يُصرف مسير شهر سدادها بعد ───
    const advances = await manager.find(Advance, {
      where: {
        tenantId,
        isDisbursed: true,
        status: Not(AdvanceStatus.REJECTED),
      },
    });
    if (advances.length) {
      const paid = await manager.find(Payroll, {
        where: { tenantId, isDisbursed: true },
        select: ['id', 'month', 'year'],
      });
      const done = new Set(paid.map((p) => `${p.year}-${p.month}`));
      for (const advance of advances) {
        const [year, month] = String(advance.repaymentDate)
          .slice(0, 7)
          .split('-');
        if (done.has(`${Number(year)}-${Number(month)}`)) continue;
        lines.add(SystemAccount.EMPLOYEE_ADVANCES, Number(advance.amount), {
          party: { type: PartyType.EMPLOYEE, id: advance.employeeId },
        });
      }
    }

    // ─── باقي القروض المعتمدة ───
    const loans = await manager.find(Loan, {
      where: { tenantId, status: LoanStatus.APPROVED },
    });
    for (const loan of loans) {
      const remaining = Decimal.max(
        new Decimal(Number(loan.totalAmount)).minus(
          new Decimal(Number(loan.monthlyInstallment)).mul(
            loan.paidInstallments,
          ),
        ),
        0,
      );
      lines.add(SystemAccount.EMPLOYEE_LOANS, remaining, {
        party: { type: PartyType.EMPLOYEE, id: loan.employeeId },
      });
    }

    // ─── المقابل: أرصدة افتتاحية ───
    lines.add(SystemAccount.OPENING_BALANCE, lines.net().neg());
    return lines.lines(SystemAccount.OPENING_BALANCE);
  }
}
