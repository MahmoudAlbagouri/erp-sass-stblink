// src/modules/accounting/vat-return.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { getCountry } from '../../common/constants/countries';
import { moneyDecimalsOf } from '../../common/utils/money.util';
import { tenantTimezoneOf } from '../../common/utils/timezone.util';
import { vatRegisteredOf } from '../../common/utils/vat.util';
import { SystemAccount } from './accounting.constants';
import { VatReturnQueryDto } from './dto/accounting.dto';
import { AccountingSettings } from './entities/accounting.entity';

/** فئة الضريبة (كما في tax_rates.category) */
type Category = 'S' | 'Z' | 'E' | 'O';

export interface VatReturnRow {
  key: string;
  label: string;
  /** النسبة للبنود الخاضعة، null لغيرها */
  rate: number | null;
  /** قيمة المستندات قبل الضريبة (فواتير، سندات صرف) */
  amount: number;
  /** التعديلات: المرتجعات والإلغاءات (سالبة) */
  adjustment: number;
  /** صافي الضريبة بعد التعديلات */
  tax: number;
  /** ضريبة مدفوعة لا تُسترد (لا تدخل في ضريبة المدخلات) */
  nonRecoverable?: boolean;
}

export interface VatReturnSection {
  rows: VatReturnRow[];
  totals: { amount: number; adjustment: number; net: number; tax: number };
}

interface Bucket {
  category: Category;
  rate: number;
  recoverable: boolean;
  amount: Decimal;
  adjustment: Decimal;
  tax: Decimal;
}

const LIMIT_DAYS = 366;

/**
 * إقرار ضريبة القيمة المضافة لفترة من المستندات نفسها (لا يحتاج تفعيل
 * المحاسبة): المبيعات الصادرة ومرتجعاتها بفئة ضريبة كل بند، والمشتريات
 * المعتمدة ومرتجعاتها وإلغاءاتها، وسندات الصرف. التقسيم كنموذج الإقرار
 * (خاضع بالنسبة الأساسية، صفري، معفى، خارج النطاق)، ومعه مطابقة مع
 * حسابي ضريبة المخرجات والمدخلات إن كانت المحاسبة مفعّلة.
 */
@Injectable()
export class VatReturnService {
  constructor(private readonly dataSource: DataSource) {}

  async build(tenantId: string, query: VatReturnQueryDto) {
    const { from, to } = query;
    if (from > to) {
      throw new BadRequestException('بداية الفترة بعد نهايتها');
    }
    const days =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000;
    if (days > LIMIT_DAYS) {
      throw new BadRequestException('أقصى فترة للإقرار سنة واحدة');
    }
    const manager = this.dataSource.manager;
    const decimals = await moneyDecimalsOf(manager, tenantId);
    const [tenant] = await manager.query<{ country: string | null }[]>(
      `SELECT "country" FROM tenants WHERE "id" = $1`,
      [tenantId],
    );
    const [seller] = await manager.query<{ taxNumber: string | null }[]>(
      `SELECT "taxNumber" FROM sales_settings WHERE "tenantId" = $1`,
      [tenantId],
    );
    const timezone = await tenantTimezoneOf(manager, tenantId);
    const params = [tenantId, from, to];

    // ─── المبيعات: الفواتير الصادرة، ومرتجعاتها (إشعارات دائنة) تعديلاً ───
    const sales = new Map<string, Bucket>();
    const salesInvoices = await manager.query<
      { category: string; rate: string; amount: string; tax: string }[]
    >(
      `SELECT il."taxCategory" AS "category", il."taxRate" AS "rate",
              SUM(il."subtotal") AS "amount", SUM(il."taxAmount") AS "tax"
         FROM sales_invoice_lines il
         JOIN sales_invoices i ON i."id" = il."invoiceId"
        WHERE i."tenantId" = $1 AND i."status" = 'issued'
          AND i."invoiceDate" >= $2 AND i."invoiceDate" <= $3
        GROUP BY 1, 2`,
      params,
    );
    for (const row of salesInvoices) {
      add(sales, category(row.category, row.rate), row.rate, true, {
        amount: row.amount,
        tax: row.tax,
      });
    }
    const salesReturns = await manager.query<
      { category: string; rate: string; amount: string; tax: string }[]
    >(
      `SELECT il."taxCategory" AS "category", il."taxRate" AS "rate",
              SUM(rl."subtotal") AS "amount", SUM(rl."taxAmount") AS "tax"
         FROM sales_return_lines rl
         JOIN sales_returns r ON r."id" = rl."returnId"
         JOIN sales_invoice_lines il ON il."id" = rl."invoiceLineId"
        WHERE r."tenantId" = $1 AND r."status" = 'issued'
          AND r."returnDate" >= $2 AND r."returnDate" <= $3
        GROUP BY 1, 2`,
      params,
    );
    for (const row of salesReturns) {
      add(sales, category(row.category, row.rate), row.rate, true, {
        adjustment: row.amount,
        tax: row.tax,
        negative: true,
      });
    }

    // ─── المشتريات: المعتمدة (ومنها ما أُلغي بعد اعتماده)، والإلغاء والمرتجع تعديل ───
    // الضريبة مستردة إن كانت تكلفة البنود بلا ضريبة (المنشأة مسجّلة وقت
    // الاعتماد) — نفس قاعدة الترحيل المحاسبي
    const recoverableSql = `(
      SELECT (pi."taxTotal" = 0 OR
              ABS(SUM(x."baseQuantity" * x."unitCost") + pi."taxTotal" - pi."total")
                < ABS(SUM(x."baseQuantity" * x."unitCost") - pi."total"))
        FROM purchase_invoice_lines x WHERE x."invoiceId" = pi."id")`;
    const categorySql = `COALESCE(t."category"::text,
      CASE WHEN pl."taxRate" > 0 THEN 'S' ELSE 'O' END)`;
    const purchases = new Map<string, Bucket>();
    const purchaseRows = await manager.query<
      {
        category: string;
        rate: string;
        recoverable: boolean;
        cancelled: boolean;
        amount: string;
        tax: string;
      }[]
    >(
      `SELECT ${categorySql} AS "category", pl."taxRate" AS "rate",
              ${recoverableSql} AS "recoverable", FALSE AS "cancelled",
              SUM(pl."subtotal") AS "amount", SUM(pl."taxAmount") AS "tax"
         FROM purchase_invoice_lines pl
         JOIN purchase_invoices pi ON pi."id" = pl."invoiceId"
         LEFT JOIN tax_rates t ON t."id" = pl."taxRateId"
        WHERE pi."tenantId" = $1 AND pi."postedAt" IS NOT NULL
          AND pi."status" IN ('posted', 'cancelled')
          AND pi."invoiceDate" >= $2 AND pi."invoiceDate" <= $3
        GROUP BY pi."id", 1, 2
       UNION ALL
       SELECT ${categorySql}, pl."taxRate", ${recoverableSql}, TRUE,
              SUM(pl."subtotal"), SUM(pl."taxAmount")
         FROM purchase_invoice_lines pl
         JOIN purchase_invoices pi ON pi."id" = pl."invoiceId"
         LEFT JOIN tax_rates t ON t."id" = pl."taxRateId"
        WHERE pi."tenantId" = $1 AND pi."postedAt" IS NOT NULL
          AND pi."status" = 'cancelled'
          AND (pi."updatedAt" AT TIME ZONE $4)::date BETWEEN $2 AND $3
        GROUP BY pi."id", 1, 2`,
      [...params, timezone],
    );
    for (const row of purchaseRows) {
      add(
        purchases,
        category(row.category, row.rate),
        row.rate,
        row.recoverable,
        row.cancelled
          ? { adjustment: row.amount, tax: row.tax, negative: true }
          : { amount: row.amount, tax: row.tax },
      );
    }
    const purchaseReturns = await manager.query<
      {
        category: string;
        rate: string;
        recoverable: boolean;
        amount: string;
        tax: string;
      }[]
    >(
      `SELECT ${categorySql} AS "category", pl."taxRate" AS "rate",
              ${recoverableSql} AS "recoverable",
              SUM(rl."subtotal") AS "amount", SUM(rl."taxAmount") AS "tax"
         FROM purchase_return_lines rl
         JOIN purchase_returns r ON r."id" = rl."returnId"
         JOIN purchase_invoice_lines pl ON pl."id" = rl."invoiceLineId"
         JOIN purchase_invoices pi ON pi."id" = pl."invoiceId"
         LEFT JOIN tax_rates t ON t."id" = pl."taxRateId"
        WHERE r."tenantId" = $1 AND r."status" = 'posted'
          AND r."returnDate" >= $2 AND r."returnDate" <= $3
        GROUP BY pi."id", 1, 2`,
      params,
    );
    for (const row of purchaseReturns) {
      add(
        purchases,
        category(row.category, row.rate),
        row.rate,
        row.recoverable,
        { adjustment: row.amount, tax: row.tax, negative: true },
      );
    }

    // ─── سندات الصرف: بتاريخها، وإلغاؤها تعديل بتاريخ إلغائه ───
    const expenses = await manager.query<
      {
        rate: string;
        recoverable: boolean;
        cancelled: boolean;
        amount: string;
        tax: string;
      }[]
    >(
      `SELECT l."taxRate" AS "rate", v."taxRecoverable" AS "recoverable",
              FALSE AS "cancelled",
              SUM(l."amount") AS "amount", SUM(l."taxAmount") AS "tax"
         FROM expense_voucher_lines l
         JOIN expense_vouchers v ON v."id" = l."voucherId"
        WHERE v."tenantId" = $1 AND v."date" >= $2 AND v."date" <= $3
        GROUP BY 1, 2
       UNION ALL
       SELECT l."taxRate", v."taxRecoverable", TRUE,
              SUM(l."amount"), SUM(l."taxAmount")
         FROM expense_voucher_lines l
         JOIN expense_vouchers v ON v."id" = l."voucherId"
        WHERE v."tenantId" = $1 AND v."status" = 'cancelled'
          AND v."cancelDate" >= $2 AND v."cancelDate" <= $3
        GROUP BY 1, 2`,
      params,
    );
    for (const row of expenses) {
      add(
        purchases,
        Number(row.rate) > 0 ? 'S' : 'O',
        row.rate,
        row.recoverable,
        row.cancelled
          ? { adjustment: row.amount, tax: row.tax, negative: true }
          : { amount: row.amount, tax: row.tax },
      );
    }

    const countryRate = getCountry(tenant?.country).vatRate;
    const salesSection = this.section(sales, 'sales', countryRate, decimals);
    const purchasesSection = this.section(
      purchases,
      'purchases',
      countryRate,
      decimals,
    );
    const round = (v: Decimal) =>
      v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();
    const outputTax = new Decimal(salesSection.totals.tax);
    const inputTax = new Decimal(purchasesSection.totals.tax);

    return {
      from,
      to,
      taxNumber: seller?.taxNumber ?? null,
      vatRegistered: await vatRegisteredOf(manager, tenantId),
      sales: salesSection,
      purchases: purchasesSection,
      totals: {
        outputTax: round(outputTax),
        inputTax: round(inputTax),
        /** موجب: مستحق للهيئة. سالب: رصيد دائن يُرحَّل أو يُسترد */
        netVat: round(outputTax.minus(inputTax)),
      },
      ledger: await this.ledgerBalances(tenantId, from, to, decimals),
    };
  }

  /**
   * حركة حسابي ضريبة المخرجات والمدخلات في الدفاتر للفترة نفسها (للمطابقة)،
   * أو null إن لم تُفعَّل المحاسبة
   */
  private async ledgerBalances(
    tenantId: string,
    from: string,
    to: string,
    decimals: number,
  ): Promise<{ outputTax: number; inputTax: number; netVat: number } | null> {
    const settings = await this.dataSource.manager.findOne(AccountingSettings, {
      where: { tenantId },
    });
    if (!settings) return null;
    const [row] = await this.dataSource.query<
      { output: string | null; input: string | null }[]
    >(
      `SELECT SUM(l."credit" - l."debit") FILTER (WHERE a."systemKey" = $4) AS "output",
              SUM(l."debit" - l."credit") FILTER (WHERE a."systemKey" = $5) AS "input"
         FROM journal_lines l
         JOIN accounts a ON a."id" = l."accountId"
         JOIN journal_entries e ON e."id" = l."entryId"
        WHERE l."tenantId" = $1 AND l."date" >= $2 AND l."date" <= $3
          AND a."systemKey" IN ($4, $5) AND e."sourceType" <> 'opening'`,
      [tenantId, from, to, SystemAccount.VAT_OUTPUT, SystemAccount.VAT_INPUT],
    );
    const round = (v: Decimal) =>
      v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();
    const output = new Decimal(row?.output ?? 0);
    const input = new Decimal(row?.input ?? 0);
    return {
      outputTax: round(output),
      inputTax: round(input),
      netVat: round(output.minus(input)),
    };
  }

  private section(
    buckets: Map<string, Bucket>,
    kind: 'sales' | 'purchases',
    countryRate: number,
    decimals: number,
  ): VatReturnSection {
    const round = (v: Decimal) =>
      v.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toNumber();
    const noun = kind === 'sales' ? 'مبيعات' : 'مشتريات ومصروفات';
    const list = [...buckets.values()];
    const rows: VatReturnRow[] = [];
    const push = (
      key: string,
      label: string,
      rate: number | null,
      items: Bucket[],
      always: boolean,
      nonRecoverable = false,
    ) => {
      if (!items.length && !always) return;
      const sum = (pick: (b: Bucket) => Decimal) =>
        items.reduce((t, b) => t.plus(pick(b)), new Decimal(0));
      rows.push({
        key,
        label,
        rate,
        amount: round(sum((b) => b.amount)),
        adjustment: round(sum((b) => b.adjustment)),
        tax: round(sum((b) => b.tax)),
        ...(nonRecoverable ? { nonRecoverable } : {}),
      });
    };

    // الخاضعة بنسبة موجبة: صف لكل نسبة (نسبة الدولة دائماً أولاً)
    const standard = list.filter(
      (b) => b.category === 'S' && b.rate > 0 && b.recoverable,
    );
    const rates = [...new Set([countryRate, ...standard.map((b) => b.rate)])]
      .filter((r) => r > 0)
      .sort((a, b) => b - a);
    for (const rate of rates) {
      push(
        `standard:${rate}`,
        `${noun} خاضعة للضريبة ${rate}%`,
        rate,
        standard.filter((b) => b.rate === rate),
        rate === countryRate,
      );
    }
    push(
      'zero',
      `${noun} خاضعة لنسبة الصفر`,
      0,
      list.filter((b) => b.category === 'Z'),
      true,
    );
    push(
      'exempt',
      `${noun} معفاة`,
      null,
      list.filter((b) => b.category === 'E'),
      true,
    );
    if (kind === 'purchases') {
      push(
        'non_recoverable',
        'مشتريات ومصروفات بضريبة غير مستردة',
        null,
        list.filter((b) => b.category === 'S' && b.rate > 0 && !b.recoverable),
        false,
        true,
      );
    }
    push(
      'out_of_scope',
      kind === 'sales'
        ? 'مبيعات خارج نطاق الضريبة'
        : 'مشتريات ومصروفات بلا ضريبة',
      null,
      list.filter(
        (b) => b.category === 'O' || (b.category === 'S' && b.rate <= 0),
      ),
      false,
    );

    const counted = rows.filter((r) => !r.nonRecoverable);
    const total = (pick: (r: VatReturnRow) => number) =>
      round(rows.reduce((t, r) => t.plus(pick(r)), new Decimal(0)));
    const amount = total((r) => r.amount);
    const adjustment = total((r) => r.adjustment);
    return {
      rows,
      totals: {
        amount,
        adjustment,
        net: round(new Decimal(amount).plus(adjustment)),
        // الضريبة غير المستردة لا تُخصم
        tax: round(counted.reduce((t, r) => t.plus(r.tax), new Decimal(0))),
      },
    };
  }
}

function category(value: string | null, rate: string | number): Category {
  if (value === 'S' || value === 'Z' || value === 'E' || value === 'O') {
    return value;
  }
  return Number(rate) > 0 ? 'S' : 'O';
}

/** يضيف مبالغ لبند (فئة + نسبة + استرداد). التعديلات سالبة */
function add(
  buckets: Map<string, Bucket>,
  cat: Category,
  rateValue: string | number,
  recoverable: boolean,
  values: {
    amount?: string;
    adjustment?: string;
    tax: string;
    negative?: boolean;
  },
): void {
  const rate = Number(rateValue) || 0;
  const key = `${cat}:${rate}:${recoverable}`;
  const bucket = buckets.get(key) ?? {
    category: cat,
    rate,
    recoverable,
    amount: new Decimal(0),
    adjustment: new Decimal(0),
    tax: new Decimal(0),
  };
  const sign = values.negative ? -1 : 1;
  bucket.amount = bucket.amount.plus(values.amount ?? 0);
  bucket.adjustment = bucket.adjustment.plus(
    new Decimal(values.adjustment ?? 0).mul(sign),
  );
  bucket.tax = bucket.tax.plus(new Decimal(values.tax ?? 0).mul(sign));
  buckets.set(key, bucket);
}
