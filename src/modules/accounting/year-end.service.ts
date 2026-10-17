// src/modules/accounting/year-end.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { tenantTimezoneOf } from '../../common/utils/timezone.util';
import { dateOnly } from '../sales/utils/payment-recorder';
import { JournalSource, SystemAccount } from './accounting.constants';
import {
  Account,
  AccountingSettings,
  JournalEntry,
  PostingError,
} from './entities/accounting.entity';
import { LedgerLineInput, LedgerService } from './ledger.service';
import { PostingService } from './posting.service';
import { SetupService } from './setup.service';

export type FiscalYearStatus = 'closed' | 'open' | 'current';

export interface FiscalYearRow {
  year: number;
  /** أول يوم في السنة داخل الدفاتر (سنة البداية تبدأ ببداية الدفاتر) */
  from: string;
  to: string;
  status: FiscalYearStatus;
  /** من قيود السنة بلا قيد إقفالها */
  revenue: number;
  expenses: number;
  netProfit: number;
  closingEntry: { id: string; number: string } | null;
  canClose: boolean;
  canReopen: boolean;
}

/**
 * إقفال السنة المالية (السنة الميلادية): قيد بتاريخ آخر يوم فيها يصفّر كل
 * حسابات الإيرادات والمصروفات (لكل فرع) في «الأرباح المحتجزة»، ويقفل الفترة
 * حتى نهايتها. الإقفال بالترتيب، وإعادة الفتح للسنة الأخيرة المقفلة فقط
 * (قيد عكسي بنفس التاريخ).
 */
@Injectable()
export class YearEndService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly setup: SetupService,
    private readonly posting: PostingService,
  ) {}

  async list(tenantId: string) {
    const settings = await this.setup.settingsOf(tenantId);
    const manager = this.dataSource.manager;
    const decimals = await moneyDecimalsOf(manager, tenantId);
    const today = await this.today(manager, tenantId);
    const startYear = Number(settings.startDate.slice(0, 4));
    const currentYear = Number(today.slice(0, 4));
    const closedThrough = settings.closedThroughYear ?? startYear - 1;

    const totals = await manager.query<
      { year: number; revenue: string | null; expenses: string | null }[]
    >(
      `SELECT EXTRACT(YEAR FROM l."date")::int AS "year",
              SUM(l."credit" - l."debit") FILTER (WHERE a."type" = 'revenue') AS "revenue",
              SUM(l."debit" - l."credit") FILTER (WHERE a."type" = 'expense') AS "expenses"
         FROM journal_lines l
         JOIN accounts a ON a."id" = l."accountId"
         JOIN journal_entries e ON e."id" = l."entryId"
        WHERE l."tenantId" = $1 AND a."type" IN ('revenue', 'expense')
          AND e."sourceType" <> $2
        GROUP BY 1`,
      [tenantId, JournalSource.YEAR_CLOSING],
    );
    const byYear = new Map(totals.map((t) => [Number(t.year), t]));
    const closings = await this.activeClosings(manager, tenantId);
    const round = (v: Decimal) =>
      v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();

    const years: FiscalYearRow[] = [];
    for (let year = startYear; year <= currentYear; year++) {
      const t = byYear.get(year);
      const revenue = new Decimal(t?.revenue ?? 0);
      const expenses = new Decimal(t?.expenses ?? 0);
      const closing = closings.get(year);
      years.push({
        year,
        from: year === startYear ? settings.startDate : `${year}-01-01`,
        to: `${year}-12-31`,
        status:
          year <= closedThrough
            ? 'closed'
            : year === currentYear
              ? 'current'
              : 'open',
        revenue: round(revenue),
        expenses: round(expenses),
        netProfit: round(revenue.minus(expenses)),
        closingEntry: closing
          ? { id: closing.id, number: closing.number }
          : null,
        canClose: year === closedThrough + 1 && year < currentYear,
        canReopen: year === settings.closedThroughYear,
      });
    }
    const retained = await manager.findOne(Account, {
      where: { tenantId, systemKey: SystemAccount.RETAINED_EARNINGS },
      select: ['id', 'code', 'name'],
    });
    return {
      closedThroughYear: settings.closedThroughYear ?? null,
      retainedEarningsAccount: retained
        ? { id: retained.id, code: retained.code, name: retained.name }
        : null,
      years: years.reverse(),
    };
  }

  /** يُقفل سنة منتهية تلي آخر سنة مقفلة */
  async close(tenantId: string, year: number, userId?: string) {
    await this.setup.settingsOf(tenantId);
    // مستندات السنة كلها في الدفاتر قبل حساب أرصدتها
    await this.posting.sync(tenantId, true);
    const errors = await this.dataSource.manager.count(PostingError, {
      where: { tenantId },
    });
    if (errors) {
      throw new BadRequestException(
        `${errors} مستند تعذّر ترحيله — عالجها من صفحة المحاسبة قبل إقفال السنة`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const settings = await this.lockSettings(manager, tenantId);
      const startYear = Number(settings.startDate.slice(0, 4));
      const expected = (settings.closedThroughYear ?? startYear - 1) + 1;
      if (year !== expected) {
        throw new BadRequestException(
          year <= expected - 1
            ? `سنة ${year} مُقفلة من قبل`
            : `أقفل سنة ${expected} أولاً — السنوات تُقفل بالترتيب`,
        );
      }
      const today = await this.today(manager, tenantId);
      const yearEnd = `${year}-12-31`;
      if (yearEnd >= today) {
        throw new BadRequestException(`سنة ${year} لم تنتهِ بعد`);
      }

      const retained = await manager.findOne(Account, {
        where: { tenantId, systemKey: SystemAccount.RETAINED_EARNINGS },
      });
      if (!retained) {
        throw new BadRequestException(
          'حساب الأرباح المحتجزة غير موجود في الشجرة — أعد إضافته',
        );
      }

      // صافي كل حساب إيراد ومصروف في السنة لكل فرع (بلا قيود إقفال سابقة
      // أُعيد فتحها: القيد وعكسه)
      const balances = await manager.query<
        { accountId: string; branchId: string | null; net: string }[]
      >(
        `SELECT l."accountId", l."branchId", SUM(l."debit" - l."credit") AS "net"
           FROM journal_lines l
           JOIN accounts a ON a."id" = l."accountId"
           JOIN journal_entries e ON e."id" = l."entryId"
          WHERE l."tenantId" = $1 AND l."date" >= $2 AND l."date" <= $3
            AND a."type" IN ('revenue', 'expense') AND e."sourceType" <> $4
          GROUP BY l."accountId", l."branchId"
         HAVING SUM(l."debit" - l."credit") <> 0`,
        [tenantId, `${year}-01-01`, yearEnd, JournalSource.YEAR_CLOSING],
      );
      const lines: LedgerLineInput[] = [];
      const profitByBranch = new Map<string | null, Decimal>();
      for (const row of balances) {
        const net = new Decimal(row.net);
        lines.push({
          accountId: row.accountId,
          amount: net.neg().toNumber(),
          description: `إقفال سنة ${year}`,
          branchId: row.branchId,
        });
        profitByBranch.set(
          row.branchId,
          (profitByBranch.get(row.branchId) ?? new Decimal(0)).plus(net),
        );
      }
      for (const [branchId, net] of profitByBranch) {
        lines.push({
          accountId: retained.id,
          amount: net.toNumber(),
          description: net.lte(0)
            ? `صافي ربح سنة ${year}`
            : `صافي خسارة سنة ${year}`,
          branchId,
        });
      }

      await this.ledger.post(
        manager,
        {
          tenantId,
          date: yearEnd,
          description: `قيد إقفال السنة المالية ${year}`,
          sourceType: JournalSource.YEAR_CLOSING,
          sourceEvent: 'close',
          sourceRef: `FY${year}`,
          lines,
          createdById: userId ?? null,
          automatic: false,
          allowLocked: true,
        },
        settings,
      );
      await manager.update(
        AccountingSettings,
        { tenantId },
        {
          closedThroughYear: year,
          lockDate:
            settings.lockDate && settings.lockDate > yearEnd
              ? settings.lockDate
              : yearEnd,
        },
      );
    });
    return this.list(tenantId);
  }

  /**
   * يعيد فتح آخر سنة مقفلة: يعكس قيد إقفالها بنفس تاريخه. تاريخ القفل يبقى
   * كما هو — افتحه من الإعدادات لتسجيل قيود تسوية في السنة ثم أقفلها ثانية.
   */
  async reopen(tenantId: string, year: number, userId?: string) {
    await this.setup.settingsOf(tenantId);
    await this.dataSource.transaction(async (manager) => {
      const settings = await this.lockSettings(manager, tenantId);
      if (settings.closedThroughYear !== year) {
        throw new BadRequestException(
          settings.closedThroughYear
            ? `تُعاد فتح آخر سنة مقفلة فقط (${settings.closedThroughYear})`
            : 'لا توجد سنة مقفلة',
        );
      }
      const yearEnd = `${year}-12-31`;
      const closing = await manager.findOne(JournalEntry, {
        where: {
          tenantId,
          sourceType: JournalSource.YEAR_CLOSING,
          sourceEvent: 'close',
          date: yearEnd,
          reversedById: IsNull(),
        },
        relations: ['lines'],
      });
      if (closing?.lines?.length) {
        const reversal = await this.ledger.post(
          manager,
          {
            tenantId,
            date: yearEnd,
            description: `إعادة فتح السنة المالية ${year} (عكس القيد ${closing.number})`,
            sourceType: JournalSource.YEAR_CLOSING,
            sourceEvent: 'reopen',
            sourceRef: `FY${year}`,
            lines: closing.lines
              .sort((a, b) => a.lineOrder - b.lineOrder)
              .map((line) => ({
                accountId: line.accountId,
                debit: line.credit,
                credit: line.debit,
                description: line.description,
                branchId: line.branchId,
              })),
            createdById: userId ?? null,
            reversalOfId: closing.id,
            automatic: false,
            allowLocked: true,
          },
          settings,
        );
        if (reversal) {
          await manager.update(
            JournalEntry,
            { id: closing.id, tenantId },
            { reversedById: reversal.id },
          );
        }
      }
      const startYear = Number(settings.startDate.slice(0, 4));
      await manager.update(
        AccountingSettings,
        { tenantId },
        { closedThroughYear: year - 1 >= startYear ? year - 1 : null },
      );
    });
    return this.list(tenantId);
  }

  /** قيود الإقفال السارية (غير المعكوسة) بالسنة */
  private async activeClosings(
    manager: EntityManager,
    tenantId: string,
  ): Promise<Map<number, JournalEntry>> {
    const entries = await manager.find(JournalEntry, {
      where: {
        tenantId,
        sourceType: JournalSource.YEAR_CLOSING,
        sourceEvent: 'close',
        reversedById: IsNull(),
      },
      select: ['id', 'number', 'date'],
    });
    return new Map(entries.map((e) => [Number(e.date.slice(0, 4)), e]));
  }

  /** إقفال وإعادة فتح متزامنان لنفس الشركة: واحد بعد الآخر */
  private async lockSettings(
    manager: EntityManager,
    tenantId: string,
  ): Promise<AccountingSettings> {
    const settings = await manager.findOne(AccountingSettings, {
      where: { tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!settings) {
      throw new ConflictException('المحاسبة غير مفعّلة لهذه الشركة');
    }
    return settings;
  }

  private async today(
    manager: EntityManager,
    tenantId: string,
  ): Promise<string> {
    return dateOnly(new Date(), await tenantTimezoneOf(manager, tenantId));
  }
}
