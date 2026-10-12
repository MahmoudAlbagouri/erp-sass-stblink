// src/common/utils/document-totals.util.ts
// حساب مبالغ أسطر المستندات التجارية (شراء وبيع) في مكان واحد.
import Decimal from 'decimal.js';

export interface LineInput {
  /** بوحدة السطر (شراء/بيع) */
  quantity: number;
  /** سعر وحدة السطر كما أُدخل */
  unitPrice: number;
  /** خصم على السطر كمبلغ */
  discount?: number;
  /** نسبة الضريبة %: 15 تعني 15% */
  taxRate: number;
  /** السعر المُدخل شامل الضريبة */
  pricesIncludeTax: boolean;
  /** كم وحدة أساس تساوي وحدة السطر */
  factor: number;
}

export interface LineAmounts {
  /** قبل الضريبة */
  subtotal: number;
  taxAmount: number;
  total: number;
  /** بوحدة الأساس */
  baseQuantity: number;
  /** قيمة وحدة الأساس قبل الضريبة (في الشراء: تكلفتها) */
  unitCost: number;
}

const money = (value: Decimal): number => value.toDecimalPlaces(2).toNumber();

/**
 * مبالغ سطر مستند.
 *
 * في الشراء `unitCost` هي التكلفة التي تدخل المخزون، وهي **قبل الضريبة**:
 * ضريبة المشتريات تُستردّ من الهيئة فلا تُحمَّل على البضاعة.
 */
export function computeLine(input: LineInput): LineAmounts {
  const entered = new Decimal(input.quantity)
    .mul(input.unitPrice)
    .minus(input.discount ?? 0);
  const rate = new Decimal(input.taxRate).div(100);

  let subtotal: Decimal;
  let total: Decimal;
  if (input.pricesIncludeTax) {
    total = entered.toDecimalPlaces(2);
    subtotal = total.div(rate.plus(1)).toDecimalPlaces(2);
  } else {
    subtotal = entered.toDecimalPlaces(2);
    total = subtotal.plus(subtotal.mul(rate).toDecimalPlaces(2));
  }

  const baseQuantity = new Decimal(input.quantity)
    .mul(input.factor)
    .toDecimalPlaces(4);

  return {
    subtotal: money(subtotal),
    taxAmount: money(total.minus(subtotal)),
    total: money(total),
    baseQuantity: baseQuantity.toNumber(),
    unitCost: baseQuantity.isZero()
      ? 0
      : subtotal.div(baseQuantity).toDecimalPlaces(4).toNumber(),
  };
}

/**
 * مبالغ إرجاع جزء من سطر: نفس نسبة الكمية المُرجعة من مبالغ السطر الأصلي
 * (فيرث السعر والخصم والضريبة كما سُجّلت في الفاتورة).
 */
export function computeReturnShare(
  line: { quantity: number; subtotal: number; taxAmount: number },
  returnQuantity: number,
): { subtotal: number; taxAmount: number; total: number } {
  const share = new Decimal(returnQuantity).div(line.quantity);
  const subtotal = new Decimal(line.subtotal).mul(share).toDecimalPlaces(2);
  const taxAmount = new Decimal(line.taxAmount).mul(share).toDecimalPlaces(2);

  return {
    subtotal: subtotal.toNumber(),
    taxAmount: taxAmount.toNumber(),
    total: subtotal.plus(taxAmount).toNumber(),
  };
}

/** مجموع قيم مالية بلا أخطاء الفاصلة العائمة (0.1 + 0.2) */
export function sumMoney(values: number[]): number {
  return money(values.reduce((sum, v) => sum.plus(v), new Decimal(0)));
}
