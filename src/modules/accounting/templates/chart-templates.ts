// src/modules/accounting/templates/chart-templates.ts
//
// شجرة الحسابات الجاهزة لكل دولة مسجّلة في النظام (common/constants/countries).
//
// هيكل واحد على المعيار الدولي للمنشآت الصغيرة والمتوسطة، بأكواد متسلسلة
// (1 ← 11 ← 1101 ← 110101)، وفيه ما يخص كل دولة: اسم ضريبة المبيعات ووجودها،
// الزكاة (السعودية)، ضرائب مصر (الخصم والإضافة، كسب العمل)، ضريبة الشركات
// (الإمارات)، مخصص نهاية الخدمة (دول الخليج والمشرق)، والاحتياطي النظامي أو
// القانوني. الشركة تعدّل شجرتها بعد إنشائها كما تشاء؛ حسابات النظام
// (systemKey) يرحّل إليها القيد التلقائي ولا تُحذف.
import { getCountry } from '../../../common/constants/countries';
import { AccountType, SystemAccount } from '../accounting.constants';

export interface TemplateAccount {
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  isGroup: boolean;
  systemKey?: SystemAccount;
  /** كود الأب (لا شيء للحسابات الرئيسية الخمسة) */
  parentCode?: string;
}

/** دول الخليج: مخصص نهاية الخدمة إلزامي، والتأمينات للمواطنين */
const GULF = new Set(['SA', 'AE', 'KW', 'QA', 'BH', 'OM']);
/** دول قوانين عملها تفرض مكافأة نهاية خدمة على صاحب العمل */
const EOS_COUNTRIES = new Set([
  ...GULF,
  'JO',
  'IQ',
  'LB',
  'SY',
  'YE',
  'PS',
  'LY',
]);

interface CountryProfile {
  /** اسم ضريبة المبيعات كما يعرفه محاسبو الدولة */
  taxName: string;
  taxNameEn: string;
  /** اسم المدفوعات بالبطاقات قيد التسوية */
  cardName: string;
  socialInsurance: string;
  legalReserve: string;
  legalReserveEn: string;
}

const profileOf = (code: string): CountryProfile => {
  const vat = getCountry(code).vatRate > 0;
  const base: CountryProfile = {
    taxName: vat ? 'ضريبة القيمة المضافة' : 'ضريبة المبيعات',
    taxNameEn: vat ? 'VAT' : 'Sales tax',
    cardName: 'مدفوعات البطاقات تحت التسوية',
    socialInsurance: 'التأمينات الاجتماعية',
    legalReserve: 'الاحتياطي القانوني',
    legalReserveEn: 'Legal reserve',
  };
  switch (code) {
    case 'SA':
      return {
        ...base,
        cardName: 'مدى والبطاقات تحت التسوية',
        socialInsurance: 'التأمينات الاجتماعية (GOSI)',
        legalReserve: 'الاحتياطي النظامي',
        legalReserveEn: 'Statutory reserve',
      };
    case 'JO':
      return {
        ...base,
        taxName: 'الضريبة العامة على المبيعات',
        taxNameEn: 'General sales tax',
        socialInsurance: 'الضمان الاجتماعي',
      };
    case 'LB':
    case 'TN':
    case 'DZ':
    case 'MA':
      return { ...base, socialInsurance: 'الضمان الاجتماعي' };
    default:
      return base;
  }
};

/**
 * يبني شجرة الدولة: قائمة مرتبة (الأب قبل أبنائه) جاهزة للإدخال كما هي.
 * دولة غير معروفة تأخذ الشجرة الافتراضية (السعودية).
 */
export function buildChartTemplate(
  countryCode?: string | null,
): TemplateAccount[] {
  const code = getCountry(countryCode).code;
  const p = profileOf(code);
  const accounts: TemplateAccount[] = [];

  const add = (
    accountCode: string,
    name: string,
    nameEn: string,
    options: { group?: boolean; key?: SystemAccount; parent?: string } = {},
  ) => {
    const parent = options.parent
      ? accounts.find((a) => a.code === options.parent)
      : undefined;
    accounts.push({
      code: accountCode,
      name,
      nameEn,
      type: parent?.type ?? ROOT_TYPES[accountCode],
      isGroup: options.group ?? false,
      systemKey: options.key,
      parentCode: options.parent,
    });
  };
  const group = (c: string, n: string, e: string, parent?: string) =>
    add(c, n, e, { group: true, parent });

  // ═══ 1 الأصول ═══
  group('1', 'الأصول', 'Assets');
  group('11', 'الأصول المتداولة', 'Current assets', '1');
  group('1101', 'النقدية وما في حكمها', 'Cash and cash equivalents', '11');
  add('110101', 'الصندوق الرئيسي', 'Main cash box', {
    parent: '1101',
    key: SystemAccount.CASH,
  });
  add('110102', 'البنك — الحساب الجاري', 'Bank — current account', {
    parent: '1101',
    key: SystemAccount.BANK,
  });
  add('110103', p.cardName, 'Card payments clearing', {
    parent: '1101',
    key: SystemAccount.CARD_CLEARING,
  });
  add('110104', 'شيكات تحت التحصيل', 'Cheques under collection', {
    parent: '1101',
    key: SystemAccount.CHEQUES_RECEIVABLE,
  });
  add('110105', 'العهد النقدية', 'Petty cash advances', { parent: '1101' });

  group('1102', 'الذمم المدينة', 'Receivables', '11');
  add('110201', 'العملاء', 'Customers (trade receivables)', {
    parent: '1102',
    key: SystemAccount.RECEIVABLES,
  });
  add('110202', 'ذمم جهات التوصيل', 'Delivery agents receivable', {
    parent: '1102',
    key: SystemAccount.COURIER_RECEIVABLE,
  });
  add('110203', 'أوراق القبض', 'Notes receivable', { parent: '1102' });
  add(
    '110204',
    'مخصص الديون المشكوك في تحصيلها',
    'Allowance for doubtful debts',
    { parent: '1102' },
  );

  group('1103', 'ذمم الموظفين', 'Employee receivables', '11');
  add('110301', 'سلف الموظفين', 'Employee salary advances', {
    parent: '1103',
    key: SystemAccount.EMPLOYEE_ADVANCES,
  });
  add('110302', 'قروض الموظفين', 'Employee loans', {
    parent: '1103',
    key: SystemAccount.EMPLOYEE_LOANS,
  });
  add('110303', 'ذمم موظفين أخرى', 'Other employee receivables', {
    parent: '1103',
    key: SystemAccount.EMPLOYEE_RECEIVABLES,
  });

  group('1104', 'المخزون', 'Inventory', '11');
  add('110401', 'مخزون البضاعة', 'Merchandise inventory', {
    parent: '1104',
    key: SystemAccount.INVENTORY,
  });
  add('110402', 'بضاعة في الطريق', 'Goods in transit', { parent: '1104' });

  group(
    '1105',
    'مدينون وأرصدة مدينة أخرى',
    'Other receivables and prepayments',
    '11',
  );
  add('110501', `${p.taxName} — المدخلات`, `Input ${p.taxNameEn}`, {
    parent: '1105',
    key: SystemAccount.VAT_INPUT,
  });
  add('110502', 'مصروفات مدفوعة مقدماً', 'Prepaid expenses', {
    parent: '1105',
  });
  add('110503', 'دفعات مقدمة للموردين', 'Advances to suppliers', {
    parent: '1105',
  });
  add('110504', 'تأمينات مستردة', 'Refundable deposits', { parent: '1105' });
  add(
    '110505',
    'حركات درج الكاشير تحت التسوية',
    'POS drawer movements clearing',
    { parent: '1105', key: SystemAccount.POS_CASH_CLEARING },
  );
  if (code === 'EG') {
    add(
      '110506',
      'ضرائب خصم وإضافة لنا (مدينة)',
      'Withholding tax receivable',
      { parent: '1105' },
    );
  }

  group('12', 'الأصول غير المتداولة', 'Non-current assets', '1');
  group('1201', 'الأصول الثابتة', 'Property, plant and equipment', '12');
  add('120101', 'الأراضي', 'Land', { parent: '1201' });
  add('120102', 'المباني والإنشاءات', 'Buildings', { parent: '1201' });
  add('120103', 'الأثاث والتجهيزات', 'Furniture and fixtures', {
    parent: '1201',
  });
  add('120104', 'الأجهزة والحاسبات', 'Computers and equipment', {
    parent: '1201',
  });
  add('120105', 'السيارات ووسائل النقل', 'Vehicles', { parent: '1201' });
  add('120106', 'تحسينات على مبانٍ مستأجرة', 'Leasehold improvements', {
    parent: '1201',
  });
  group('1202', 'مجمع الإهلاك', 'Accumulated depreciation', '12');
  add('120201', 'مجمع إهلاك المباني', 'Acc. depreciation — buildings', {
    parent: '1202',
  });
  add(
    '120202',
    'مجمع إهلاك الأثاث والتجهيزات',
    'Acc. depreciation — furniture',
    { parent: '1202' },
  );
  add(
    '120203',
    'مجمع إهلاك الأجهزة والحاسبات',
    'Acc. depreciation — equipment',
    { parent: '1202' },
  );
  add('120204', 'مجمع إهلاك السيارات', 'Acc. depreciation — vehicles', {
    parent: '1202',
  });
  add('120205', 'مجمع إهلاك التحسينات', 'Acc. depreciation — improvements', {
    parent: '1202',
  });
  group('1203', 'الأصول غير الملموسة', 'Intangible assets', '12');
  add('120301', 'البرامج والتراخيص', 'Software and licenses', {
    parent: '1203',
  });

  // ═══ 2 الخصوم ═══
  group('2', 'الخصوم', 'Liabilities');
  group('21', 'الخصوم المتداولة', 'Current liabilities', '2');
  group('2101', 'الذمم الدائنة', 'Payables', '21');
  add('210101', 'الموردون', 'Suppliers (trade payables)', {
    parent: '2101',
    key: SystemAccount.PAYABLES,
  });
  add('210102', 'أوراق الدفع', 'Notes payable', { parent: '2101' });
  add('210103', 'دفعات مقدمة من العملاء', 'Customer advances', {
    parent: '2101',
  });

  group('2102', 'المصروفات المستحقة', 'Accrued liabilities', '21');
  add('210201', 'رواتب وأجور مستحقة', 'Salaries payable', {
    parent: '2102',
    key: SystemAccount.SALARIES_PAYABLE,
  });
  add('210202', 'مصروفات مستحقة', 'Accrued expenses', { parent: '2102' });
  add('210203', `${p.socialInsurance} المستحقة`, 'Social insurance payable', {
    parent: '2102',
  });

  group(
    '2103',
    'الضرائب والالتزامات الحكومية',
    'Taxes and government dues',
    '21',
  );
  add('210301', `${p.taxName} — المخرجات`, `Output ${p.taxNameEn}`, {
    parent: '2103',
    key: SystemAccount.VAT_OUTPUT,
  });
  add('210302', `${p.taxName} — صافي المستحق`, `${p.taxNameEn} payable (net)`, {
    parent: '2103',
  });
  if (code === 'SA') {
    add('210303', 'الزكاة المستحقة', 'Zakat payable', { parent: '2103' });
  } else if (code === 'EG') {
    add('210303', 'ضريبة الخصم والإضافة المستحقة', 'Withholding tax payable', {
      parent: '2103',
    });
    add('210304', 'ضريبة كسب العمل المستحقة', 'Payroll income tax payable', {
      parent: '2103',
    });
    add('210305', 'ضريبة الدخل المستحقة', 'Income tax payable', {
      parent: '2103',
    });
  } else if (code === 'AE') {
    add('210303', 'ضريبة الشركات المستحقة', 'Corporate tax payable', {
      parent: '2103',
    });
  } else {
    add('210303', 'ضريبة الدخل المستحقة', 'Income tax payable', {
      parent: '2103',
    });
  }

  group('22', 'الخصوم غير المتداولة', 'Non-current liabilities', '2');
  if (EOS_COUNTRIES.has(code)) {
    add(
      '2201',
      'مخصص مكافأة نهاية الخدمة',
      'End-of-service benefits provision',
      { parent: '22' },
    );
  }
  add('2202', 'قروض طويلة الأجل', 'Long-term loans', { parent: '22' });

  // ═══ 3 حقوق الملكية ═══
  group('3', 'حقوق الملكية', 'Equity');
  add('31', 'رأس المال', 'Share capital', {
    parent: '3',
    key: SystemAccount.CAPITAL,
  });
  add('32', 'جاري الشركاء / المالك', "Owners' current account", {
    parent: '3',
  });
  group('33', 'الاحتياطيات', 'Reserves', '3');
  add('3301', p.legalReserve, p.legalReserveEn, { parent: '33' });
  add('3302', 'احتياطي عام', 'General reserve', { parent: '33' });
  add('34', 'الأرباح (الخسائر) المحتجزة', 'Retained earnings', {
    parent: '3',
    key: SystemAccount.RETAINED_EARNINGS,
  });
  add('35', 'أرصدة افتتاحية', 'Opening balance equity', {
    parent: '3',
    key: SystemAccount.OPENING_BALANCE,
  });

  // ═══ 4 الإيرادات ═══
  group('4', 'الإيرادات', 'Revenue');
  group('41', 'إيرادات النشاط', 'Operating revenue', '4');
  add('4101', 'المبيعات', 'Sales', { parent: '41', key: SystemAccount.SALES });
  add('4102', 'مردودات ومسموحات المبيعات', 'Sales returns and allowances', {
    parent: '41',
    key: SystemAccount.SALES_RETURNS,
  });
  add('4103', 'إيرادات خدمات التوصيل', 'Delivery service revenue', {
    parent: '41',
    key: SystemAccount.DELIVERY_REVENUE,
  });
  group('42', 'إيرادات أخرى', 'Other income', '4');
  add('4201', 'إيرادات متنوعة', 'Miscellaneous income', { parent: '42' });
  add('4202', 'جزاءات وخصومات الموظفين', 'Employee penalties', {
    parent: '42',
    key: SystemAccount.EMPLOYEE_PENALTIES,
  });
  add('4203', 'أرباح بيع أصول ثابتة', 'Gain on disposal of assets', {
    parent: '42',
  });
  add('4204', 'خصم مكتسب من الموردين', 'Purchase discounts received', {
    parent: '42',
  });

  // ═══ 5 المصروفات ═══
  group('5', 'المصروفات', 'Expenses');
  group('51', 'تكلفة المبيعات', 'Cost of sales', '5');
  add('5101', 'تكلفة البضاعة المباعة', 'Cost of goods sold', {
    parent: '51',
    key: SystemAccount.COGS,
  });
  add('5102', 'فروقات وتسويات المخزون', 'Inventory adjustments and variances', {
    parent: '51',
    key: SystemAccount.INVENTORY_ADJUSTMENTS,
  });
  add('5103', 'مصروفات نقل المشتريات', 'Freight-in', { parent: '51' });

  group(
    '52',
    'المصروفات العمومية والإدارية',
    'General and administrative expenses',
    '5',
  );
  add('5201', 'الرواتب والأجور', 'Salaries and wages', {
    parent: '52',
    key: SystemAccount.SALARIES,
  });
  add('5202', 'البدلات', 'Allowances', {
    parent: '52',
    key: SystemAccount.ALLOWANCES,
  });
  add('5203', 'المكافآت والحوافز', 'Bonuses and incentives', {
    parent: '52',
    key: SystemAccount.BONUSES,
  });
  add('5204', 'بدل الإجازات', 'Leave pay', {
    parent: '52',
    key: SystemAccount.LEAVE_PAY,
  });
  add('5205', 'مكافأة نهاية الخدمة', 'End-of-service benefits', {
    parent: '52',
    key: SystemAccount.EOS_EXPENSE,
  });
  add(
    '5206',
    `${p.socialInsurance} — حصة المنشأة`,
    'Social insurance — employer share',
    { parent: '52' },
  );
  add('5207', 'الإيجارات', 'Rent', { parent: '52' });
  add('5208', 'الكهرباء والمياه', 'Electricity and water', { parent: '52' });
  add('5209', 'الاتصالات والإنترنت', 'Telecom and internet', { parent: '52' });
  add('5210', 'الأدوات المكتبية والمطبوعات', 'Stationery and printing', {
    parent: '52',
  });
  add('5211', 'الصيانة والإصلاحات', 'Repairs and maintenance', {
    parent: '52',
  });
  add(
    '5212',
    GULF.has(code)
      ? 'الرسوم الحكومية والإقامات والتأشيرات'
      : 'الرسوم الحكومية والاشتراكات',
    'Government fees and subscriptions',
    { parent: '52' },
  );
  add('5213', 'المصروفات البنكية', 'Bank charges', { parent: '52' });
  add('5214', 'مصروف الإهلاك', 'Depreciation expense', { parent: '52' });
  add('5215', 'أتعاب مهنية واستشارات', 'Professional fees', { parent: '52' });
  add('5216', 'الضيافة والنظافة', 'Hospitality and cleaning', { parent: '52' });
  add('5217', 'مصروفات متنوعة', 'Miscellaneous expenses', { parent: '52' });

  group(
    '53',
    'مصروفات البيع والتوزيع',
    'Selling and distribution expenses',
    '5',
  );
  add('5301', 'مصروفات التوصيل والشحن', 'Delivery and shipping expenses', {
    parent: '53',
    key: SystemAccount.DELIVERY_EXPENSE,
  });
  add('5302', 'الدعاية والإعلان', 'Advertising and marketing', {
    parent: '53',
  });
  add('5303', 'عمولات البيع', 'Sales commissions', { parent: '53' });
  add(
    '5304',
    'عمولات البطاقات وبوابات الدفع',
    'Card and payment gateway fees',
    { parent: '53' },
  );

  group('54', 'مصروفات وخسائر أخرى', 'Other expenses and losses', '5');
  add('5401', 'عجز وزيادة الصندوق', 'Cash over and short', {
    parent: '54',
    key: SystemAccount.CASH_OVER_SHORT,
  });
  add('5402', 'فروقات تسويات جهات التوصيل', 'Delivery settlement differences', {
    parent: '54',
    key: SystemAccount.COURIER_DIFFERENCES,
  });
  add('5403', 'ديون معدومة', 'Bad debts', { parent: '54' });
  add('5404', 'خسائر بيع أصول ثابتة', 'Loss on disposal of assets', {
    parent: '54',
  });
  if (code === 'SA') {
    add('5405', 'الزكاة', 'Zakat', { parent: '54' });
  } else if (code === 'AE') {
    add('5405', 'ضريبة الشركات', 'Corporate tax', { parent: '54' });
  } else {
    add('5405', 'ضريبة الدخل', 'Income tax', { parent: '54' });
  }

  return accounts;
}

/** نوع الحسابات الرئيسية الخمسة (رأس كل فرع) */
const ROOT_TYPES: Record<string, AccountType> = {
  '1': AccountType.ASSET,
  '2': AccountType.LIABILITY,
  '3': AccountType.EQUITY,
  '4': AccountType.REVENUE,
  '5': AccountType.EXPENSE,
};
