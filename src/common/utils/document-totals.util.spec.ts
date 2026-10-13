import {
  computeLine,
  computeReturnShare,
  sumMoney,
} from './document-totals.util';

describe('document totals', () => {
  describe('computeLine', () => {
    it('adds tax on top when prices exclude tax', () => {
      const line = computeLine({
        quantity: 10,
        unitPrice: 20,
        taxRate: 15,
        pricesIncludeTax: false,
        factor: 1,
        decimals: 2,
      });

      expect(line).toEqual({
        subtotal: 200,
        taxAmount: 30,
        total: 230,
        baseQuantity: 10,
        unitCost: 20,
      });
    });

    it('extracts tax when prices include it', () => {
      const line = computeLine({
        quantity: 10,
        unitPrice: 23,
        taxRate: 15,
        pricesIncludeTax: true,
        factor: 1,
        decimals: 2,
      });

      expect(line).toMatchObject({ subtotal: 200, taxAmount: 30, total: 230 });
      expect(line.unitCost).toBe(20); // التكلفة قبل الضريبة
    });

    it('converts a purchase unit to base units for stock and cost', () => {
      // 5 كراتين × 24 قطعة، الكرتون بـ 36
      const line = computeLine({
        quantity: 5,
        unitPrice: 36,
        taxRate: 15,
        pricesIncludeTax: false,
        factor: 24,
        decimals: 2,
      });

      expect(line.baseQuantity).toBe(120);
      expect(line.unitCost).toBe(1.5);
      expect(line.total).toBe(207);
    });

    it('applies the line discount before tax', () => {
      const line = computeLine({
        quantity: 4,
        unitPrice: 25,
        discount: 10,
        taxRate: 15,
        pricesIncludeTax: false,
        factor: 1,
        decimals: 2,
      });

      expect(line).toMatchObject({ subtotal: 90, taxAmount: 13.5 });
      expect(line.unitCost).toBe(22.5);
    });

    it('handles zero-rated lines and awkward decimals', () => {
      const zero = computeLine({
        quantity: 3,
        unitPrice: 0.1,
        taxRate: 0,
        pricesIncludeTax: false,
        factor: 1,
        decimals: 2,
      });
      const thirds = computeLine({
        quantity: 3,
        unitPrice: 3.3333,
        taxRate: 15,
        pricesIncludeTax: false,
        factor: 1,
        decimals: 2,
      });

      expect(zero).toMatchObject({ subtotal: 0.3, taxAmount: 0, total: 0.3 });
      expect(thirds).toMatchObject({ subtotal: 10, taxAmount: 1.5 });
    });

    it('rounds to three decimals for dinar-style currencies', () => {
      // 3 × 1.125 د.ك بضريبة 5%: الفلس الثالث يضيع عند التقريب لخانتين
      const input = {
        quantity: 3,
        unitPrice: 1.125,
        taxRate: 5,
        pricesIncludeTax: false,
        factor: 1,
      };

      expect(computeLine({ ...input, decimals: 3 })).toMatchObject({
        subtotal: 3.375,
        taxAmount: 0.169,
        total: 3.544,
      });
      expect(computeLine({ ...input, decimals: 2 })).toMatchObject({
        subtotal: 3.38,
        taxAmount: 0.17,
        total: 3.55,
      });
    });
  });

  describe('computeReturnShare', () => {
    const line = { quantity: 10, subtotal: 200, taxAmount: 30 };

    it('returns a proportional share of the original line', () => {
      expect(computeReturnShare(line, 4, 2)).toEqual({
        subtotal: 80,
        taxAmount: 12,
        total: 92,
      });
    });

    it('keeps fils when the currency has three decimals', () => {
      const dinarLine = { quantity: 3, subtotal: 3.375, taxAmount: 0.169 };
      expect(computeReturnShare(dinarLine, 1, 3)).toEqual({
        subtotal: 1.125,
        taxAmount: 0.056,
        total: 1.181,
      });
    });

    it('returns the whole line exactly', () => {
      expect(computeReturnShare(line, 10, 2).total).toBe(230);
    });
  });

  it('sums money without floating point drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([1.125, 2.25, 0.001])).toBe(3.376);
    expect(sumMoney([])).toBe(0);
  });
});
