import { COUNTRIES } from '../../../common/constants/countries';
import { AccountType, SystemAccount } from '../accounting.constants';
import { buildChartTemplate } from './chart-templates';

describe('chart of accounts templates', () => {
  it.each(COUNTRIES.map((c) => [c.code, c.nameAr]))(
    '%s (%s): a valid tree with every system account exactly once',
    (code) => {
      const chart = buildChartTemplate(code);
      const byCode = new Map(chart.map((a) => [a.code, a]));

      // أكواد فريدة
      expect(byCode.size).toBe(chart.length);

      // الرؤوس الخمسة بأنواعها
      const roots = chart.filter((a) => !a.parentCode);
      expect(roots.map((a) => [a.code, a.type])).toEqual([
        ['1', AccountType.ASSET],
        ['2', AccountType.LIABILITY],
        ['3', AccountType.EQUITY],
        ['4', AccountType.REVENUE],
        ['5', AccountType.EXPENSE],
      ]);

      for (const account of chart) {
        expect(account.name.trim()).not.toBe('');
        expect(account.nameEn.trim()).not.toBe('');
        if (!account.parentCode) continue;
        const parent = byCode.get(account.parentCode);
        // الأب قبل ابنه، تجميعي، من نفس النوع، وكود الابن يبدأ بكوده
        expect(parent).toBeDefined();
        expect(chart.indexOf(parent!)).toBeLessThan(chart.indexOf(account));
        expect(parent!.isGroup).toBe(true);
        expect(account.type).toBe(parent!.type);
        expect(account.code.startsWith(parent!.code)).toBe(true);
        expect(account.code.length).toBeGreaterThan(parent!.code.length);
      }

      // كل حساب نظام مرة واحدة، فرعي (يُرحَّل عليه)
      const keys = chart.filter((a) => a.systemKey).map((a) => a.systemKey);
      expect([...keys].sort()).toEqual(Object.values(SystemAccount).sort());
      for (const account of chart.filter((a) => a.systemKey)) {
        expect(account.isGroup).toBe(false);
      }
    },
  );

  it('names taxes and statutory accounts per country', () => {
    const name = (code: string, key: SystemAccount) =>
      buildChartTemplate(code).find((a) => a.systemKey === key)?.name;
    expect(name('SA', SystemAccount.VAT_OUTPUT)).toContain(
      'ضريبة القيمة المضافة',
    );
    expect(name('JO', SystemAccount.VAT_OUTPUT)).toContain(
      'الضريبة العامة على المبيعات',
    );
    expect(name('KW', SystemAccount.VAT_OUTPUT)).toContain('ضريبة المبيعات');

    const names = (code: string) => buildChartTemplate(code).map((a) => a.name);
    expect(names('SA')).toContain('الزكاة');
    expect(names('EG')).toContain('ضريبة الخصم والإضافة المستحقة');
    expect(names('EG')).not.toContain('مخصص مكافأة نهاية الخدمة');
    expect(names('AE')).toContain('ضريبة الشركات المستحقة');
    expect(names('AE')).toContain('مخصص مكافأة نهاية الخدمة');
  });

  it('falls back to the default country for an unknown code', () => {
    expect(buildChartTemplate('XX')).toEqual(buildChartTemplate('SA'));
  });
});
