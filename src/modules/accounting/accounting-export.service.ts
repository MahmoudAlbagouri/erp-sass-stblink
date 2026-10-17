// src/modules/accounting/accounting-export.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getCurrencyDecimals } from '../../common/constants/countries';
import type {
  ReportColumn,
  ReportDefinition,
  ReportFormat,
  ReportRow,
} from '../../common/reports/report.service';
import { formatAmount } from '../../common/utils/format.util';
import { JOURNAL_SOURCE_LABEL, JournalSource } from './accounting.constants';
import {
  BalanceSheetQueryDto,
  ExpenseQueryDto,
  JournalQueryDto,
  LedgerQueryDto,
  PeriodQueryDto,
  TrialBalanceQueryDto,
  VatReturnQueryDto,
} from './dto/accounting.dto';
import {
  ExpenseVoucher,
  ExpenseVoucherStatus,
} from './entities/expense-voucher.entity';
import { AmountRow, ReportsService } from './reports.service';
import { VatReturnRow, VatReturnService } from './vat-return.service';

/** أقصى أسطر في ملف تصدير واحد (اليومية، السندات) */
const MAX_EXPORT_ROWS = 20_000;

export type ExportReport = ReportDefinition & { filename: string };

/** مبلغ في الملف: رقم في Excel (يُجمع ويُفرز)، ونص منسّق في الـ PDF */
type Money = (value: number | string | null | undefined) => string | number;

/**
 * تصدير تقارير المحاسبة (Excel / PDF) بنفس أرقام الشاشة: كل دالة تبني
 * التقرير من خدمته وتحوّله لأسطر وأعمدة لـ ReportService.
 */
@Injectable()
export class AccountingExportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reports: ReportsService,
    private readonly vat: VatReturnService,
  ) {}

  async trialBalance(
    tenantId: string,
    query: TrialBalanceQueryDto,
    format: ReportFormat,
  ): Promise<ExportReport> {
    const money = await this.money(tenantId, format);
    const report = await this.reports.trialBalance(tenantId, query);
    const split = (value: number) => ({
      debit: value > 0 ? money(value) : '',
      credit: value < 0 ? money(-value) : '',
    });
    const row = (
      code: string,
      name: string,
      v: { opening: number; debit: number; credit: number; closing: number },
    ): ReportRow => {
      const opening = split(v.opening);
      const closing = split(v.closing);
      return {
        code,
        name,
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        debit: v.debit ? money(v.debit) : '',
        credit: v.credit ? money(v.credit) : '',
        closingDebit: closing.debit,
        closingCredit: closing.credit,
      };
    };
    const rows = report.rows
      .filter((r) => r.opening || r.debit || r.credit || r.closing)
      .map((r) => row(r.code, indent(r.name, r.depth), r));
    rows.push(row('', 'الإجمالي', report.totals));
    return {
      title: `ميزان المراجعة من ${query.from} إلى ${query.to}`,
      filename: `trial_balance_${query.from}_${query.to}`,
      columns: [
        { header: 'الكود', key: 'code' },
        { header: 'الحساب', key: 'name' },
        { header: 'أول المدة مدين', key: 'openingDebit' },
        { header: 'أول المدة دائن', key: 'openingCredit' },
        { header: 'حركة مدين', key: 'debit' },
        { header: 'حركة دائن', key: 'credit' },
        { header: 'آخر المدة مدين', key: 'closingDebit' },
        { header: 'آخر المدة دائن', key: 'closingCredit' },
      ],
      rows,
    };
  }

  async ledger(
    tenantId: string,
    query: LedgerQueryDto,
    format: ReportFormat,
  ): Promise<ExportReport> {
    const money = await this.money(tenantId, format);
    const report = await this.reports.ledger(tenantId, query);
    const rows: ReportRow[] = [
      {
        date: query.from,
        description: 'رصيد أول المدة',
        balance: money(report.opening),
      },
      ...report.lines.map((line) => ({
        date: line.date,
        number: line.entryNumber,
        source:
          JOURNAL_SOURCE_LABEL[line.sourceType as JournalSource] ??
          line.sourceType,
        reference: line.sourceRef ?? '',
        description: line.description,
        account: `${line.accountCode} ${line.accountName}`,
        party: line.partyName ?? '',
        debit: line.debit ? money(line.debit) : '',
        credit: line.credit ? money(line.credit) : '',
        balance: money(line.balance),
      })),
      {
        description: report.truncated
          ? 'الإجمالي (الكشف مقتطع — اختر فترة أقصر)'
          : 'الإجمالي ورصيد آخر المدة',
        debit: money(report.debit),
        credit: money(report.credit),
        balance: money(report.closing),
      },
    ];
    const { code, name } = report.account;
    return {
      title: `كشف حساب ${code} ${name} من ${query.from} إلى ${query.to}`,
      filename: `ledger_${code}_${query.from}_${query.to}`,
      columns: [
        { header: 'التاريخ', key: 'date' },
        { header: 'رقم القيد', key: 'number' },
        { header: 'المصدر', key: 'source' },
        { header: 'المستند', key: 'reference' },
        { header: 'البيان', key: 'description' },
        { header: 'الحساب', key: 'account' },
        { header: 'الطرف', key: 'party' },
        { header: 'مدين', key: 'debit' },
        { header: 'دائن', key: 'credit' },
        { header: 'الرصيد (موجب مدين)', key: 'balance' },
      ],
      rows,
    };
  }

  async incomeStatement(
    tenantId: string,
    query: PeriodQueryDto,
    format: ReportFormat,
  ): Promise<ExportReport> {
    const money = await this.money(tenantId, format);
    const report = await this.reports.incomeStatement(tenantId, query);
    const { totals } = report;
    const rows: ReportRow[] = [
      { name: 'الإيرادات' },
      ...amountRows(report.revenue, money),
      { name: 'إجمالي الإيرادات', amount: money(totals.revenue) },
      { name: 'المصروفات' },
      ...amountRows(report.expenses, money),
      { name: 'إجمالي المصروفات', amount: money(totals.expenses) },
    ];
    if (totals.grossProfit !== null) {
      rows.push({ name: 'مجمل الربح', amount: money(totals.grossProfit) });
    }
    rows.push({
      name: totals.netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة',
      amount: money(totals.netProfit),
    });
    return {
      title: `قائمة الدخل من ${query.from} إلى ${query.to}`,
      filename: `income_statement_${query.from}_${query.to}`,
      columns: AMOUNT_COLUMNS,
      rows,
    };
  }

  async balanceSheet(
    tenantId: string,
    query: BalanceSheetQueryDto,
    format: ReportFormat,
  ): Promise<ExportReport> {
    const money = await this.money(tenantId, format);
    const report = await this.reports.balanceSheet(tenantId, query);
    const { totals, earnings } = report;
    const rows: ReportRow[] = [
      { name: 'الأصول' },
      ...amountRows(report.assets, money),
      { name: 'إجمالي الأصول', amount: money(totals.assets) },
      { name: 'الخصوم' },
      ...amountRows(report.liabilities, money),
      { name: 'إجمالي الخصوم', amount: money(totals.liabilities) },
      { name: 'حقوق الملكية' },
      ...amountRows(report.equity, money),
    ];
    if (earnings.retained) {
      rows.push({
        name: 'أرباح سنوات سابقة لم تُقفل',
        amount: money(earnings.retained),
      });
    }
    rows.push(
      {
        name: 'صافي ربح السنة حتى التاريخ',
        amount: money(earnings.currentYear),
      },
      { name: 'إجمالي حقوق الملكية', amount: money(totals.equity) },
      {
        name: 'إجمالي الخصوم وحقوق الملكية',
        amount: money(totals.liabilitiesAndEquity),
      },
    );
    return {
      title: `الميزانية في ${query.asOf}`,
      filename: `balance_sheet_${query.asOf}`,
      columns: AMOUNT_COLUMNS,
      rows,
    };
  }

  async vatReturn(
    tenantId: string,
    query: VatReturnQueryDto,
    format: ReportFormat,
  ): Promise<ExportReport> {
    const money = await this.money(tenantId, format);
    const report = await this.vat.build(tenantId, query);
    const section = (
      title: string,
      data: typeof report.sales,
      totalLabel: string,
    ): ReportRow[] => [
      { label: title },
      ...data.rows.map((r: VatReturnRow) => ({
        label: r.nonRecoverable ? `${r.label} (لا تُخصم)` : r.label,
        amount: money(r.amount),
        adjustment: money(r.adjustment),
        tax: money(r.tax),
      })),
      {
        label: totalLabel,
        amount: money(data.totals.amount),
        adjustment: money(data.totals.adjustment),
        tax: money(data.totals.tax),
      },
    ];
    const rows: ReportRow[] = [
      ...section('المبيعات', report.sales, 'إجمالي المبيعات وضريبة المخرجات'),
      ...section(
        'المشتريات والمصروفات',
        report.purchases,
        'إجمالي المشتريات وضريبة المدخلات',
      ),
      { label: 'ضريبة المخرجات', tax: money(report.totals.outputTax) },
      { label: 'ضريبة المدخلات', tax: money(report.totals.inputTax) },
      {
        label:
          report.totals.netVat >= 0
            ? 'صافي الضريبة المستحقة'
            : 'صافي الضريبة (رصيد لصالح المنشأة)',
        tax: money(report.totals.netVat),
      },
    ];
    if (report.ledger) {
      rows.push(
        { label: 'المطابقة مع الدفاتر' },
        {
          label: 'حركة حساب ضريبة المخرجات',
          tax: money(report.ledger.outputTax),
        },
        {
          label: 'حركة حساب ضريبة المدخلات',
          tax: money(report.ledger.inputTax),
        },
      );
    }
    return {
      title: `إقرار ضريبة القيمة المضافة من ${query.from} إلى ${query.to}${
        report.taxNumber ? ` — الرقم الضريبي ${report.taxNumber}` : ''
      }`,
      filename: `vat_return_${query.from}_${query.to}`,
      columns: [
        { header: 'البند', key: 'label' },
        { header: 'المبلغ', key: 'amount' },
        { header: 'التعديلات', key: 'adjustment' },
        { header: 'الضريبة', key: 'tax' },
      ],
      rows,
    };
  }

  /** أسطر القيود (لا رؤوسها فقط) بفلاتر دفتر اليومية */
  async journals(
    tenantId: string,
    query: JournalQueryDto,
    format: ReportFormat,
  ): Promise<ExportReport> {
    const money = await this.money(tenantId, format);
    const params: unknown[] = [tenantId];
    const where: string[] = ['e."tenantId" = $1'];
    if (query.from) {
      params.push(query.from);
      where.push(`e."date" >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`e."date" <= $${params.length}`);
    }
    if (query.sourceType) {
      params.push(query.sourceType);
      where.push(`e."sourceType" = $${params.length}`);
    }
    if (query.accountId) {
      params.push(query.accountId);
      where.push(`EXISTS (SELECT 1 FROM journal_lines x
                  WHERE x."entryId" = e."id" AND x."accountId" = $${params.length})`);
    }
    const search = query.search?.trim();
    if (search) {
      params.push(`%${search}%`);
      const p = `$${params.length}`;
      where.push(
        `(e."number" ILIKE ${p} OR e."description" ILIKE ${p} OR e."sourceRef" ILIKE ${p})`,
      );
    }
    const lines = await this.dataSource.query<
      {
        number: string;
        date: string;
        sourceType: string;
        sourceRef: string | null;
        entryDescription: string;
        code: string;
        name: string;
        description: string | null;
        branch: string | null;
        debit: string;
        credit: string;
      }[]
    >(
      `SELECT e."number", to_char(e."date", 'YYYY-MM-DD') AS "date",
              e."sourceType", e."sourceRef", e."description" AS "entryDescription",
              a."code", a."name", l."description", b."name" AS "branch",
              l."debit", l."credit"
         FROM journal_entries e
         JOIN journal_lines l ON l."entryId" = e."id"
         JOIN accounts a ON a."id" = l."accountId"
         LEFT JOIN branches b ON b."id" = l."branchId"
        WHERE ${where.join(' AND ')}
        ORDER BY e."date", e."number", l."lineOrder"
        LIMIT ${MAX_EXPORT_ROWS + 1}`,
      params,
    );
    this.assertSize(lines.length);
    return {
      title: 'دفتر اليومية',
      filename: `journal_${query.from ?? 'all'}_${query.to ?? 'all'}`,
      columns: [
        { header: 'رقم القيد', key: 'number' },
        { header: 'التاريخ', key: 'date' },
        { header: 'المصدر', key: 'source' },
        { header: 'المستند', key: 'reference' },
        { header: 'بيان القيد', key: 'entryDescription' },
        { header: 'كود الحساب', key: 'code' },
        { header: 'الحساب', key: 'account' },
        { header: 'بيان السطر', key: 'description' },
        { header: 'الفرع', key: 'branch' },
        { header: 'مدين', key: 'debit' },
        { header: 'دائن', key: 'credit' },
      ],
      rows: lines.map((line) => ({
        number: line.number,
        date: line.date,
        source:
          JOURNAL_SOURCE_LABEL[line.sourceType as JournalSource] ??
          line.sourceType,
        reference: line.sourceRef ?? '',
        entryDescription: line.entryDescription,
        code: line.code,
        account: line.name,
        description: line.description ?? '',
        branch: line.branch ?? '',
        debit: Number(line.debit) ? money(line.debit) : '',
        credit: Number(line.credit) ? money(line.credit) : '',
      })),
    };
  }

  async expenses(
    tenantId: string,
    query: ExpenseQueryDto,
    format: ReportFormat,
  ): Promise<ExportReport> {
    const money = await this.money(tenantId, format);
    const qb = this.dataSource
      .getRepository(ExpenseVoucher)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.paidFromAccount', 'paidFrom')
      .where('v.tenantId = :tenantId', { tenantId });
    if (query.from) qb.andWhere('v.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('v.date <= :to', { to: query.to });
    if (query.status) {
      qb.andWhere('v.status = :status', { status: query.status });
    }
    if (query.accountId) {
      qb.andWhere(
        `(v.paidFromAccountId = :accountId OR EXISTS (SELECT 1 FROM expense_voucher_lines l
           WHERE l."voucherId" = v.id AND l."accountId" = :accountId))`,
        { accountId: query.accountId },
      );
    }
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(v.number ILIKE :like OR v.payee ILIKE :like OR v.reference ILIKE :like
          OR v.description ILIKE :like)`,
        { like: `%${search}%` },
      );
    }
    const vouchers = await qb
      .orderBy('v.date', 'ASC')
      .addOrderBy('v.number', 'ASC')
      .take(MAX_EXPORT_ROWS + 1)
      .getMany();
    this.assertSize(vouchers.length);
    return {
      title: 'سندات الصرف',
      filename: `expense_vouchers_${query.from ?? 'all'}_${query.to ?? 'all'}`,
      columns: [
        { header: 'رقم السند', key: 'number' },
        { header: 'التاريخ', key: 'date' },
        { header: 'المستفيد', key: 'payee' },
        { header: 'الرقم الضريبي', key: 'payeeTaxNumber' },
        { header: 'المرجع', key: 'reference' },
        { header: 'البيان', key: 'description' },
        { header: 'دُفع من', key: 'paidFrom' },
        { header: 'قبل الضريبة', key: 'subtotal' },
        { header: 'الضريبة', key: 'taxTotal' },
        { header: 'الإجمالي', key: 'total' },
        { header: 'الحالة', key: 'status' },
      ],
      rows: vouchers.map((v) => ({
        number: v.number,
        date: v.date,
        payee: v.payee,
        payeeTaxNumber: v.payeeTaxNumber ?? '',
        reference: v.reference ?? '',
        description: v.description,
        paidFrom: v.paidFromAccount
          ? `${v.paidFromAccount.code} ${v.paidFromAccount.name}`
          : '',
        subtotal: money(v.subtotal),
        taxTotal: money(v.taxTotal),
        total: money(v.total),
        status:
          v.status === ExpenseVoucherStatus.CANCELLED
            ? `ملغي (${v.cancelDate ?? ''})`
            : 'مُقيَّد',
      })),
    };
  }

  private assertSize(count: number): void {
    if (count > MAX_EXPORT_ROWS) {
      throw new BadRequestException(
        `أكثر من ${MAX_EXPORT_ROWS.toLocaleString('en-US')} سطر — ضيّق الفترة أو الفلاتر`,
      );
    }
  }

  private async money(tenantId: string, format: ReportFormat): Promise<Money> {
    if (format === 'excel') return (value) => Number(value ?? 0);
    const [row] = await this.dataSource.query<{ currency: string }[]>(
      `SELECT "currency" FROM tenants WHERE "id" = $1`,
      [tenantId],
    );
    const decimals = getCurrencyDecimals(row?.currency);
    return (value) =>
      formatAmount(Number(value ?? 0), {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
  }
}

const AMOUNT_COLUMNS: ReportColumn[] = [
  { header: 'الكود', key: 'code' },
  { header: 'الحساب', key: 'name' },
  { header: 'المبلغ', key: 'amount' },
];

/** أسطر قسم في قائمة: الرئيسية دائماً، وما تحتها إن كان له رصيد */
function amountRows(list: AmountRow[], money: Money): ReportRow[] {
  return list
    .filter((r) => r.depth === 1 || r.amount)
    .map((r) => ({
      code: r.code,
      name: indent(r.name, r.depth),
      amount: money(r.amount),
    }));
}

/** إزاحة اسم الحساب بعمقه في الشجرة */
const indent = (name: string, depth: number): string =>
  `${'— '.repeat(Math.max(0, depth - 1))}${name}`;
