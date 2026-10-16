// src/modules/accounting/entry-lines.ts
import Decimal from 'decimal.js';
import { PartyType, SystemAccount } from './accounting.constants';
import { LedgerEntryInput } from './ledger.service';

export interface Party {
  type: PartyType;
  id: string;
}

export const customerParty = (id?: string | null): Party | null =>
  id ? { type: PartyType.CUSTOMER, id } : null;

/**
 * يجمع أسطر القيد بالحساب والفرع والطرف (موجب = مدين)، ثم يقرّبها لخانات
 * العملة ويضع فرق التقريب على حساب يحدده المستدعي، فيبقى القيد متوازناً.
 */
export class EntryLines {
  private readonly items = new Map<
    string,
    {
      accountId: string;
      amount: Decimal;
      branchId: string | null;
      party: Party | null;
    }
  >();

  constructor(
    private readonly ctx: { keys: Map<string, string>; decimals: number },
  ) {}

  add(
    key: SystemAccount | string,
    amount: Decimal.Value,
    options: { branchId?: string | null; party?: Party | null } = {},
  ): void {
    const id = this.ctx.keys.get(key);
    if (!id) {
      // سطر صفري لا يحتاج حسابه (ضريبة صفر في دولة بلا ضريبة…)
      if (new Decimal(amount).isZero()) return;
      throw new Error(
        `حساب النظام "${key}" غير موجود في الشجرة — أعد إضافته من شجرة الحسابات`,
      );
    }
    this.addId(id, amount, options);
  }

  addId(
    accountId: string,
    amount: Decimal.Value,
    options: { branchId?: string | null; party?: Party | null } = {},
  ): void {
    const value = new Decimal(amount);
    if (value.isZero()) return;
    const branchId = options.branchId ?? null;
    const party = options.party ?? null;
    const mapKey = `${accountId}|${branchId ?? ''}|${party?.type ?? ''}|${party?.id ?? ''}`;
    const existing = this.items.get(mapKey);
    if (existing) existing.amount = existing.amount.plus(value);
    else this.items.set(mapKey, { accountId, amount: value, branchId, party });
  }

  /** صافي الأسطر (مدين − دائن) بعد تقريب كلٍّ منها — قبل أي موازنة */
  net(): Decimal {
    return [...this.items.values()].reduce(
      (total, item) =>
        total.plus(
          item.amount.toDecimalPlaces(this.ctx.decimals, Decimal.ROUND_HALF_UP),
        ),
      new Decimal(0),
    );
  }

  /** الأسطر مقرّبة، وفرق التقريب على `plug` (أو أكبر سطر) */
  lines(plug?: SystemAccount): LedgerEntryInput['lines'] {
    const rows = [...this.items.values()]
      .map((item) => ({
        ...item,
        amount: item.amount.toDecimalPlaces(
          this.ctx.decimals,
          Decimal.ROUND_HALF_UP,
        ),
      }))
      .filter((item) => !item.amount.isZero());
    const residual = rows.reduce(
      (total, row) => total.plus(row.amount),
      new Decimal(0),
    );
    if (!residual.isZero() && rows.length) {
      const plugId = plug ? this.ctx.keys.get(plug) : undefined;
      const target =
        rows.find((row) => row.accountId === plugId) ??
        rows.reduce((a, b) => (a.amount.abs().gte(b.amount.abs()) ? a : b));
      target.amount = target.amount.minus(residual);
    }
    return rows.map((row) => ({
      accountId: row.accountId,
      amount: row.amount.toNumber(),
      branchId: row.branchId,
      partyType: row.party?.type ?? null,
      partyId: row.party?.id ?? null,
    }));
  }
}
