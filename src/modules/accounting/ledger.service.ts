// src/modules/accounting/ledger.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In } from 'typeorm';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import {
  JOURNAL_NUMBER_PREFIX,
  JournalSource,
  PartyType,
} from './accounting.constants';
import {
  Account,
  AccountingSettings,
  JournalEntry,
  JournalLine,
} from './entities/accounting.entity';

export interface LedgerLineInput {
  accountId: string;
  /** موجب = مدين، سالب = دائن (أو debit/credit صريحان) */
  amount?: number;
  debit?: number;
  credit?: number;
  description?: string | null;
  branchId?: string | null;
  partyType?: PartyType | null;
  partyId?: string | null;
}

export interface LedgerEntryInput {
  tenantId: string;
  /** التاريخ المحاسبي المطلوب (YYYY-MM-DD) */
  date: string;
  description: string;
  sourceType: JournalSource;
  sourceId?: string | null;
  sourceEvent?: string | null;
  sourceRef?: string | null;
  lines: LedgerLineInput[];
  createdById?: string | null;
  reversalOfId?: string | null;
  /**
   * قيد تلقائي من مستند: تاريخه في فترة مقفلة (أو قبل بداية الدفاتر) يُنقل
   * لأول يوم مفتوح ويُحفظ تاريخ المستند. القيد اليدوي في فترة مقفلة يُرفض.
   */
  automatic: boolean;
}

/**
 * دفتر اليومية: المدخل الوحيد لتسجيل أي قيد (يدوي أو من مستند)، كما
 * StockService.apply للمخزون. يتحقق من التوازن والحسابات والفترة، ويرقّم،
 * ويحفظ. القيد لا يُعدَّل ولا يُحذف بعدها — التصحيح بقيد عكسي.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * يسجّل قيداً داخل معاملة المستدعي. يعيد null إن لم يبقَ للقيد أثر (كل
   * أسطره صفر بعد التقريب).
   */
  async post(
    manager: EntityManager,
    input: LedgerEntryInput,
    settings?: AccountingSettings | null,
  ): Promise<JournalEntry | null> {
    const { tenantId } = input;
    const config =
      settings ??
      (await manager.findOne(AccountingSettings, { where: { tenantId } }));
    if (!config) {
      throw new BadRequestException('المحاسبة غير مفعّلة لهذه الشركة');
    }

    const decimals = await moneyDecimalsOf(manager, tenantId);
    const lines = normalizeLines(input.lines, decimals);
    if (!lines.length) return null;

    const debit = lines.reduce((sum, l) => sum.plus(l.debit), new Decimal(0));
    const credit = lines.reduce((sum, l) => sum.plus(l.credit), new Decimal(0));
    if (!debit.eq(credit)) {
      throw new BadRequestException(
        `القيد غير متوازن: المدين ${debit.toFixed(decimals)} والدائن ${credit.toFixed(decimals)}`,
      );
    }
    if (lines.length < 2) {
      throw new BadRequestException(
        'القيد يحتاج طرفاً مديناً وطرفاً دائناً على الأقل',
      );
    }

    await this.assertPostable(
      manager,
      tenantId,
      lines.map((l) => l.accountId),
    );
    const { date, documentDate } = this.resolveDate(input, config);

    const entry = await manager.save(
      manager.create(JournalEntry, {
        tenantId,
        number: await nextDocumentNumber(
          manager,
          'journal_entries',
          JOURNAL_NUMBER_PREFIX,
          tenantId,
        ),
        date,
        documentDate,
        description: input.description.slice(0, 500),
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        sourceEvent: input.sourceEvent ?? null,
        sourceRef: input.sourceRef ?? null,
        total: debit.toNumber(),
        reversalOfId: input.reversalOfId ?? null,
        createdById: input.createdById ?? null,
      }),
    );
    await manager.insert(
      JournalLine,
      lines.map((line, index) => ({
        tenantId,
        entryId: entry.id,
        lineOrder: index,
        accountId: line.accountId,
        date,
        debit: line.debit.toNumber(),
        credit: line.credit.toNumber(),
        description: line.description?.slice(0, 300) ?? null,
        branchId: line.branchId ?? null,
        partyType: line.partyType ?? null,
        partyId: line.partyId ?? null,
      })),
    );
    return entry;
  }

  /**
   * يعكس قيداً يدوياً (أو الافتتاحي) بقيد بأطراف معكوسة. قيود المستندات لا
   * تُعكس من هنا: يعكسها مستندها (مرتجع، إلغاء سند…).
   */
  async reverse(
    tenantId: string,
    entryId: string,
    date: string,
    userId?: string,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOne(JournalEntry, {
        where: { id: entryId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!entry) throw new NotFoundException('القيد غير موجود');
      const reversible: string[] = [
        JournalSource.MANUAL,
        JournalSource.OPENING,
      ];
      if (!reversible.includes(entry.sourceType)) {
        throw new BadRequestException(
          'قيد مستند يُصحَّح بمستنده (مرتجع، إلغاء سند…) لا بعكسه يدوياً',
        );
      }
      if (entry.reversedById) {
        throw new ConflictException('هذا القيد معكوس من قبل');
      }
      if (entry.reversalOfId) {
        throw new BadRequestException('لا يُعكس قيد عكسي — سجّل قيداً جديداً');
      }

      const lines = await manager.find(JournalLine, {
        where: { entryId: entry.id },
        order: { lineOrder: 'ASC' },
      });
      const reversal = await this.post(manager, {
        tenantId,
        date,
        description: `عكس القيد ${entry.number}: ${entry.description}`,
        sourceType: JournalSource.MANUAL,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit,
          credit: line.debit,
          description: line.description,
          branchId: line.branchId,
          partyType: line.partyType as PartyType | null,
          partyId: line.partyId,
        })),
        createdById: userId ?? null,
        reversalOfId: entry.id,
        automatic: false,
      });
      if (!reversal) throw new BadRequestException('القيد بلا أثر لعكسه');
      await manager.update(
        JournalEntry,
        { id: entry.id, tenantId },
        { reversedById: reversal.id },
      );
      return reversal;
    });
  }

  /** الحسابات موجودة، فرعية (لا تجميعية)، وفعّالة */
  private async assertPostable(
    manager: EntityManager,
    tenantId: string,
    accountIds: string[],
  ): Promise<void> {
    const unique = [...new Set(accountIds)];
    const accounts = await manager.find(Account, {
      where: { tenantId, id: In(unique) },
    });
    if (accounts.length !== unique.length) {
      throw new BadRequestException('حساب في القيد غير موجود في شجرة الشركة');
    }
    const group = accounts.find((a) => a.isGroup);
    if (group) {
      throw new BadRequestException(
        `"${group.code} ${group.name}" حساب تجميعي — القيد على الحسابات الفرعية تحته`,
      );
    }
    const inactive = accounts.find((a) => !a.isActive);
    if (inactive) {
      throw new BadRequestException(
        `الحساب "${inactive.code} ${inactive.name}" موقوف`,
      );
    }
  }

  /**
   * تاريخ القيد: لا قبل بداية الدفاتر ولا في فترة مقفلة. التلقائي يُنقل لأول
   * يوم مفتوح (ويحفظ تاريخ مستنده)، واليدوي يُرفض.
   */
  private resolveDate(
    input: LedgerEntryInput,
    settings: AccountingSettings,
  ): { date: string; documentDate: string | null } {
    const firstOpen = settings.lockDate
      ? maxDate(settings.startDate, nextDay(settings.lockDate))
      : settings.startDate;
    if (input.date >= firstOpen)
      return { date: input.date, documentDate: null };

    if (!input.automatic) {
      if (input.date < settings.startDate) {
        throw new BadRequestException(
          `تاريخ القيد قبل بداية الدفاتر (${settings.startDate})`,
        );
      }
      throw new BadRequestException(
        `الفترة مقفلة حتى ${settings.lockDate} — سجّل القيد بتاريخ بعدها`,
      );
    }
    return { date: firstOpen, documentDate: input.date };
  }
}

interface NormalizedLine {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  description?: string | null;
  branchId?: string | null;
  partyType?: PartyType | null;
  partyId?: string | null;
}

/**
 * سطر واحد = طرف واحد: الصافي (مدين − دائن) مقرَّباً لخانات العملة يحدد
 * جانبه. الأسطر الصفرية تُحذف.
 */
function normalizeLines(
  lines: LedgerLineInput[],
  decimals: number,
): NormalizedLine[] {
  const result: NormalizedLine[] = [];
  for (const line of lines) {
    const net = new Decimal(line.amount ?? 0)
      .plus(line.debit ?? 0)
      .minus(line.credit ?? 0)
      .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
    if (net.isZero()) continue;
    result.push({
      accountId: line.accountId,
      debit: net.gt(0) ? net : new Decimal(0),
      credit: net.lt(0) ? net.abs() : new Decimal(0),
      description: line.description,
      branchId: line.branchId,
      partyType: line.partyType,
      partyId: line.partyId,
    });
  }
  return result;
}

const maxDate = (a: string, b: string) => (a >= b ? a : b);

/** اليوم التالي لتاريخ (YYYY-MM-DD) */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
