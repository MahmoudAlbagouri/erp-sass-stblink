// src/modules/accounting/reports.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { AccountType, SystemAccount } from './accounting.constants';
import {
  BalanceSheetQueryDto,
  LedgerQueryDto,
  PeriodQueryDto,
  TrialBalanceQueryDto,
} from './dto/accounting.dto';
import { Account } from './entities/accounting.entity';
import { JournalsService } from './journals.service';

/** حساب في تقرير: بموضعه في الشجرة (depth 1 = رئيسي) */
export interface ReportAccount {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  type: AccountType;
  parentId: string | null;
  isGroup: boolean;
  depth: number;
}

export interface TrialBalanceRow extends ReportAccount {
  /** الأرصدة بإشارة المدين: موجب = مدين، سالب = دائن */
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface AmountRow extends ReportAccount {
  /** بطبيعة القسم: الإيراد والخصوم وحقوق الملكية دائنة موجبة */
  amount: number;
}

export interface LedgerLineRow {
  id: string;
  date: string;
  entryId: string;
  entryNumber: string;
  description: string;
  sourceType: string;
  sourceRef: string | null;
  accountCode: string;
  accountName: string;
  partyName: string | null;
  debit: number;
  credit: number;
  balance: number;
}

/** أقصى أسطر في كشف حساب واحد (فترة أطول = أسطر أكثر) */
const MAX_LEDGER_LINES = 5000;

/**
 * القوائم المالية من أسطر القيود مباشرة: ميزان المراجعة، كشف الحساب، قائمة
 * الدخل، والميزانية. أرصدة الحسابات التجميعية = مجموع ما تحتها.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly journals: JournalsService,
  ) {}

  async trialBalance(tenantId: string, query: TrialBalanceQueryDto) {
    const { accounts, decimals } = await this.chartOf(tenantId);
    const params: unknown[] = [tenantId, query.from, query.to];
    const branch = this.branchFilter(query.branchId, params);
    const rows = await this.dataSource.query<
      { accountId: string; opening: string; debit: string; credit: string }[]
    >(
      `SELECT l."accountId",
              COALESCE(SUM(l."debit" - l."credit") FILTER (WHERE l."date" < $2), 0) AS "opening",
              COALESCE(SUM(l."debit") FILTER (WHERE l."date" >= $2), 0) AS "debit",
              COALESCE(SUM(l."credit") FILTER (WHERE l."date" >= $2), 0) AS "credit"
         FROM journal_lines l
        WHERE l."tenantId" = $1 AND l."date" <= $3${branch}
        GROUP BY l."accountId"`,
      params,
    );
    const totals = rollUp(accounts, rows, ['opening', 'debit', 'credit']);
    const result: TrialBalanceRow[] = accounts
      .filter((a) => !query.level || a.depth <= query.level)
      .map((account) => {
        const t = totals.get(account.id);
        const opening = t?.opening ?? new Decimal(0);
        const debit = t?.debit ?? new Decimal(0);
        const credit = t?.credit ?? new Decimal(0);
        return {
          ...account,
          opening: round(opening, decimals),
          debit: round(debit, decimals),
          credit: round(credit, decimals),
          closing: round(opening.plus(debit).minus(credit), decimals),
        };
      });
    const roots = result.filter((r) => r.depth === 1);
    return {
      from: query.from,
      to: query.to,
      rows: result,
      totals: {
        opening: sumRound(
          roots.map((r) => r.opening),
          decimals,
        ),
        debit: sumRound(
          roots.map((r) => r.debit),
          decimals,
        ),
        credit: sumRound(
          roots.map((r) => r.credit),
          decimals,
        ),
        closing: sumRound(
          roots.map((r) => r.closing),
          decimals,
        ),
      },
    };
  }

  async ledger(tenantId: string, query: LedgerQueryDto) {
    const { accounts, decimals } = await this.chartOf(tenantId);
    const account = accounts.find((a) => a.id === query.accountId);
    if (!account) throw new NotFoundException('الحساب غير موجود');
    const ids = descendants(accounts, account.id);

    const params: unknown[] = [tenantId, ids, query.from, query.to];
    let filters = this.branchFilter(query.branchId, params);
    if (query.partyType && query.partyId) {
      params.push(query.partyType, query.partyId);
      filters += ` AND l."partyType" = $${params.length - 1} AND l."partyId" = $${params.length}`;
    }

    // نفس المعاملات للاستعلامين ($4 لا يحتاجه الرصيد السابق، لكن ترقيم
    // معاملات الفلاتر بعده مشترك)
    const [opening] = await this.dataSource.query<{ balance: string }[]>(
      `SELECT COALESCE(SUM(l."debit" - l."credit"), 0) AS "balance"
         FROM journal_lines l
        WHERE l."tenantId" = $1 AND l."accountId" = ANY($2::uuid[])
          AND l."date" < $3 AND $4::date IS NOT NULL${filters}`,
      params,
    );
    const lines = await this.dataSource.query<
      {
        id: string;
        date: string;
        entryId: string;
        number: string;
        description: string | null;
        entryDescription: string;
        sourceType: string;
        sourceRef: string | null;
        code: string;
        name: string;
        partyType: string | null;
        partyId: string | null;
        debit: string;
        credit: string;
      }[]
    >(
      `SELECT l."id", to_char(l."date", 'YYYY-MM-DD') AS "date", l."entryId",
              e."number", l."description", e."description" AS "entryDescription",
              e."sourceType", e."sourceRef", a."code", a."name",
              l."partyType", l."partyId", l."debit", l."credit"
         FROM journal_lines l
         JOIN journal_entries e ON e."id" = l."entryId"
         JOIN accounts a ON a."id" = l."accountId"
        WHERE l."tenantId" = $1 AND l."accountId" = ANY($2::uuid[])
          AND l."date" >= $3 AND l."date" <= $4${filters}
        ORDER BY l."date", e."number", l."lineOrder"
        LIMIT ${MAX_LEDGER_LINES + 1}`,
      params,
    );
    const truncated = lines.length > MAX_LEDGER_LINES;
    const shown = truncated ? lines.slice(0, MAX_LEDGER_LINES) : lines;
    const parties = await this.journals.partyNames(
      this.dataSource.manager,
      tenantId,
      shown,
    );

    let balance = new Decimal(opening?.balance ?? 0);
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    const rows: LedgerLineRow[] = shown.map((line) => {
      balance = balance.plus(line.debit).minus(line.credit);
      debit = debit.plus(line.debit);
      credit = credit.plus(line.credit);
      return {
        id: line.id,
        date: line.date,
        entryId: line.entryId,
        entryNumber: line.number,
        description: line.description || line.entryDescription,
        sourceType: line.sourceType,
        sourceRef: line.sourceRef,
        accountCode: line.code,
        accountName: line.name,
        partyName: line.partyId
          ? (parties.get(`${line.partyType}:${line.partyId}`) ?? null)
          : null,
        debit: Number(line.debit),
        credit: Number(line.credit),
        balance: round(balance, decimals),
      };
    });
    return {
      account,
      from: query.from,
      to: query.to,
      opening: round(new Decimal(opening?.balance ?? 0), decimals),
      debit: round(debit, decimals),
      credit: round(credit, decimals),
      closing: round(balance, decimals),
      lines: rows,
      truncated,
    };
  }

  async incomeStatement(tenantId: string, query: PeriodQueryDto) {
    const { accounts, decimals, keyed } = await this.chartOf(tenantId);
    const params: unknown[] = [tenantId, query.from, query.to];
    const branch = this.branchFilter(query.branchId, params);
    const rows = await this.dataSource.query<
      { accountId: string; net: string }[]
    >(
      `SELECT l."accountId", SUM(l."debit" - l."credit") AS "net"
         FROM journal_lines l
         JOIN accounts a ON a."id" = l."accountId"
        WHERE l."tenantId" = $1 AND l."date" >= $2 AND l."date" <= $3
          AND a."type" IN ('revenue', 'expense')${branch}
        GROUP BY l."accountId"`,
      params,
    );
    const totals = rollUp(accounts, rows, ['net']);
    const section = (type: AccountType, sign: 1 | -1) =>
      accounts
        .filter((a) => a.type === type)
        .map((a) => ({
          ...a,
          amount: round(
            (totals.get(a.id)?.net ?? new Decimal(0)).mul(sign),
            decimals,
          ),
        }));
    const revenue = section(AccountType.REVENUE, -1);
    const expenses = section(AccountType.EXPENSE, 1);
    const totalOf = (list: AmountRow[]) =>
      sumRound(
        list.filter((r) => r.depth === 1).map((r) => r.amount),
        decimals,
      );
    const totalRevenue = totalOf(revenue);
    const totalExpenses = totalOf(expenses);

    // مجمل الربح = إيرادات النشاط − تكلفة المبيعات (المجموعتان اللتان تضمان
    // حسابي المبيعات وتكلفتها، أينما نقلتهما الشركة في شجرتها)
    const groupAmount = (key: SystemAccount, list: AmountRow[]) => {
      const parentId = accounts.find((a) => a.id === keyed.get(key))?.parentId;
      return list.find((r) => r.id === parentId)?.amount ?? null;
    };
    const operatingRevenue = groupAmount(SystemAccount.SALES, revenue);
    const costOfSales = groupAmount(SystemAccount.COGS, expenses);
    return {
      from: query.from,
      to: query.to,
      revenue,
      expenses,
      totals: {
        revenue: totalRevenue,
        expenses: totalExpenses,
        grossProfit:
          operatingRevenue !== null && costOfSales !== null
            ? round(new Decimal(operatingRevenue).minus(costOfSales), decimals)
            : null,
        netProfit: round(
          new Decimal(totalRevenue).minus(totalExpenses),
          decimals,
        ),
      },
    };
  }

  async balanceSheet(tenantId: string, query: BalanceSheetQueryDto) {
    const { accounts, decimals } = await this.chartOf(tenantId);
    const yearStart = `${query.asOf.slice(0, 4)}-01-01`;
    const params: unknown[] = [tenantId, query.asOf];
    const branch = this.branchFilter(query.branchId, params);
    const rows = await this.dataSource.query<
      { accountId: string; net: string }[]
    >(
      `SELECT l."accountId", SUM(l."debit" - l."credit") AS "net"
         FROM journal_lines l
         JOIN accounts a ON a."id" = l."accountId"
        WHERE l."tenantId" = $1 AND l."date" <= $2
          AND a."type" IN ('asset', 'liability', 'equity')${branch}
        GROUP BY l."accountId"`,
      params,
    );
    const earningsParams: unknown[] = [tenantId, query.asOf, yearStart];
    const earningsBranch = this.branchFilter(query.branchId, earningsParams);
    const [earnings] = await this.dataSource.query<
      { prior: string | null; current: string | null }[]
    >(
      `SELECT SUM(l."credit" - l."debit") FILTER (WHERE l."date" < $3) AS "prior",
              SUM(l."credit" - l."debit") FILTER (WHERE l."date" >= $3) AS "current"
         FROM journal_lines l
         JOIN accounts a ON a."id" = l."accountId"
        WHERE l."tenantId" = $1 AND l."date" <= $2
          AND a."type" IN ('revenue', 'expense')${earningsBranch}`,
      earningsParams,
    );
    const totals = rollUp(accounts, rows, ['net']);
    const section = (type: AccountType, sign: 1 | -1) =>
      accounts
        .filter((a) => a.type === type)
        .map((a) => ({
          ...a,
          amount: round(
            (totals.get(a.id)?.net ?? new Decimal(0)).mul(sign),
            decimals,
          ),
        }));
    const assets = section(AccountType.ASSET, 1);
    const liabilities = section(AccountType.LIABILITY, -1);
    const equity = section(AccountType.EQUITY, -1);
    const rootTotal = (list: AmountRow[]) =>
      sumRound(
        list.filter((r) => r.depth === 1).map((r) => r.amount),
        decimals,
      );
    const retained = round(new Decimal(earnings?.prior ?? 0), decimals);
    const currentProfit = round(new Decimal(earnings?.current ?? 0), decimals);
    const totalAssets = rootTotal(assets);
    const totalLiabilities = rootTotal(liabilities);
    const totalEquity = round(
      new Decimal(rootTotal(equity)).plus(retained).plus(currentProfit),
      decimals,
    );
    return {
      asOf: query.asOf,
      assets,
      liabilities,
      equity,
      /** أرباح السنوات السابقة غير المقفلة في حساب، وصافي ربح السنة حتى التاريخ */
      earnings: { retained, currentYear: currentProfit },
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        liabilitiesAndEquity: round(
          new Decimal(totalLiabilities).plus(totalEquity),
          decimals,
        ),
        balanced: new Decimal(totalAssets).eq(
          new Decimal(totalLiabilities).plus(totalEquity),
        ),
      },
    };
  }

  /** حسابات الشركة بعمقها في الشجرة، مرتبة بالكود */
  private async chartOf(tenantId: string) {
    const list = await this.dataSource.manager.find(Account, {
      where: { tenantId },
      order: { code: 'ASC' },
    });
    const byId = new Map(list.map((a) => [a.id, a]));
    const depthOf = (account: Account): number => {
      let depth = 1;
      let parent = account.parentId ? byId.get(account.parentId) : undefined;
      while (parent && depth < 20) {
        depth++;
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return depth;
    };
    const accounts: ReportAccount[] = list.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      nameEn: a.nameEn ?? null,
      type: a.type,
      parentId: a.parentId ?? null,
      isGroup: a.isGroup,
      depth: depthOf(a),
    }));
    const keyed = new Map(
      list.filter((a) => a.systemKey).map((a) => [a.systemKey as string, a.id]),
    );
    return {
      accounts,
      keyed,
      decimals: await moneyDecimalsOf(this.dataSource.manager, tenantId),
    };
  }

  private branchFilter(
    branchId: string | undefined,
    params: unknown[],
  ): string {
    if (!branchId) return '';
    params.push(branchId);
    return ` AND l."branchId" = $${params.length}`;
  }
}

/** يجمع مبالغ كل حساب في نفسه وفي كل آبائه */
function rollUp<K extends string>(
  accounts: ReportAccount[],
  rows: ({ accountId: string } & Record<K, string>)[],
  fields: K[],
): Map<string, Record<K, Decimal>> {
  const parentOf = new Map(accounts.map((a) => [a.id, a.parentId]));
  const totals = new Map<string, Record<K, Decimal>>();
  for (const row of rows) {
    let id: string | null | undefined = row.accountId;
    let guard = 0;
    while (id && guard++ < 20) {
      const current =
        totals.get(id) ??
        (Object.fromEntries(fields.map((f) => [f, new Decimal(0)])) as Record<
          K,
          Decimal
        >);
      for (const field of fields)
        current[field] = current[field].plus(row[field] ?? 0);
      totals.set(id, current);
      id = parentOf.get(id);
    }
  }
  return totals;
}

/** الحساب وكل ما تحته */
function descendants(accounts: ReportAccount[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const a of accounts) {
    if (!a.parentId) continue;
    children.set(a.parentId, [...(children.get(a.parentId) ?? []), a.id]);
  }
  const result: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    result.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

const round = (value: Decimal, decimals: number): number =>
  value.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();

const sumRound = (values: number[], decimals: number): number =>
  round(
    values.reduce((total, v) => total.plus(v), new Decimal(0)),
    decimals,
  );
