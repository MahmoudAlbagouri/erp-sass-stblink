// src/modules/accounting/accounting.constants.ts

/** الأنواع الخمسة في رأس الشجرة: منها طبيعة الحساب وموضعه في القوائم */
export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  [AccountType.ASSET]: 'الأصول',
  [AccountType.LIABILITY]: 'الخصوم',
  [AccountType.EQUITY]: 'حقوق الملكية',
  [AccountType.REVENUE]: 'الإيرادات',
  [AccountType.EXPENSE]: 'المصروفات',
};

/** طبيعة الحساب: رصيده الطبيعي مدين (الأصول والمصروفات) أم دائن */
export const isDebitNature = (type: AccountType): boolean =>
  type === AccountType.ASSET || type === AccountType.EXPENSE;

/**
 * حسابات النظام: يرحّل إليها القيد التلقائي بمفتاحها لا بكودها، فتغيير اسمها
 * أو كودها أو نقلها في الشجرة لا يكسر الترحيل. لا تُحذف ولا تُوقف.
 */
export enum SystemAccount {
  CASH = 'cash',
  BANK = 'bank',
  CARD_CLEARING = 'card_clearing',
  CHEQUES_RECEIVABLE = 'cheques_receivable',
  RECEIVABLES = 'receivables',
  COURIER_RECEIVABLE = 'courier_receivable',
  EMPLOYEE_ADVANCES = 'employee_advances',
  EMPLOYEE_LOANS = 'employee_loans',
  EMPLOYEE_RECEIVABLES = 'employee_receivables',
  INVENTORY = 'inventory',
  VAT_INPUT = 'vat_input',
  POS_CASH_CLEARING = 'pos_cash_clearing',
  PAYABLES = 'payables',
  SALARIES_PAYABLE = 'salaries_payable',
  VAT_OUTPUT = 'vat_output',
  CAPITAL = 'capital',
  RETAINED_EARNINGS = 'retained_earnings',
  OPENING_BALANCE = 'opening_balance',
  SALES = 'sales',
  SALES_RETURNS = 'sales_returns',
  DELIVERY_REVENUE = 'delivery_revenue',
  EMPLOYEE_PENALTIES = 'employee_penalties',
  COGS = 'cogs',
  INVENTORY_ADJUSTMENTS = 'inventory_adjustments',
  SALARIES = 'salaries',
  ALLOWANCES = 'allowances',
  BONUSES = 'bonuses',
  LEAVE_PAY = 'leave_pay',
  EOS_EXPENSE = 'eos_expense',
  DELIVERY_EXPENSE = 'delivery_expense',
  CASH_OVER_SHORT = 'cash_over_short',
  COURIER_DIFFERENCES = 'courier_differences',
}

/** من أين جاء القيد */
export enum JournalSource {
  MANUAL = 'manual',
  OPENING = 'opening',
  SALES_INVOICE = 'sales_invoice',
  SALES_RETURN = 'sales_return',
  CUSTOMER_PAYMENT = 'customer_payment',
  PURCHASE_INVOICE = 'purchase_invoice',
  PURCHASE_RETURN = 'purchase_return',
  SUPPLIER_PAYMENT = 'supplier_payment',
  STOCK_ADJUSTMENT = 'stock_adjustment',
  STOCKTAKE = 'stocktake',
  DELIVERY_SETTLEMENT = 'delivery_settlement',
  POS_SHIFT = 'pos_shift',
  POS_CASH_MOVEMENT = 'pos_cash_movement',
  PAYROLL = 'payroll',
  ADVANCE = 'advance',
  LOAN = 'loan',
  BONUS = 'bonus',
  LEAVE_SETTLEMENT = 'leave_settlement',
  CUSTOMER_OPENING = 'customer_opening',
  SUPPLIER_OPENING = 'supplier_opening',
  EXPENSE_VOUCHER = 'expense_voucher',
  YEAR_CLOSING = 'year_closing',
}

export const JOURNAL_SOURCE_LABEL: Record<JournalSource, string> = {
  [JournalSource.MANUAL]: 'قيد يدوي',
  [JournalSource.OPENING]: 'قيد افتتاحي',
  [JournalSource.SALES_INVOICE]: 'فاتورة بيع',
  [JournalSource.SALES_RETURN]: 'مرتجع بيع',
  [JournalSource.CUSTOMER_PAYMENT]: 'سند قبض / ردّ لعميل',
  [JournalSource.PURCHASE_INVOICE]: 'فاتورة شراء',
  [JournalSource.PURCHASE_RETURN]: 'مرتجع شراء',
  [JournalSource.SUPPLIER_PAYMENT]: 'سداد مورد',
  [JournalSource.STOCK_ADJUSTMENT]: 'تسوية مخزون',
  [JournalSource.STOCKTAKE]: 'جرد',
  [JournalSource.DELIVERY_SETTLEMENT]: 'تسوية جهة توصيل',
  [JournalSource.POS_SHIFT]: 'عجز/زيادة وردية كاشير',
  [JournalSource.POS_CASH_MOVEMENT]: 'حركة درج كاشير',
  [JournalSource.PAYROLL]: 'مسير رواتب',
  [JournalSource.ADVANCE]: 'سلفة موظف',
  [JournalSource.LOAN]: 'قرض موظف',
  [JournalSource.BONUS]: 'مكافأة مصروفة',
  [JournalSource.LEAVE_SETTLEMENT]: 'بدل إجازة مصروف',
  [JournalSource.CUSTOMER_OPENING]: 'رصيد افتتاحي لعميل',
  [JournalSource.SUPPLIER_OPENING]: 'رصيد افتتاحي لمورد',
  [JournalSource.EXPENSE_VOUCHER]: 'سند صرف',
  [JournalSource.YEAR_CLOSING]: 'إقفال السنة المالية',
};

/** الطرف في سطر القيد (الدفتر المساعد) */
export enum PartyType {
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
  EMPLOYEE = 'employee',
  COURIER = 'courier',
}

/** طرق القبض في المستندات وحسابها الافتراضي (قابلة للتغيير من الإعدادات) */
export const DEFAULT_RECEIPT_ACCOUNTS: Record<string, SystemAccount> = {
  cash: SystemAccount.CASH,
  card: SystemAccount.CARD_CLEARING,
  bank_transfer: SystemAccount.BANK,
  cheque: SystemAccount.CHEQUES_RECEIVABLE,
};

/** طرق الدفع (للموردين والرواتب) وحسابها الافتراضي */
export const DEFAULT_PAYMENT_ACCOUNTS: Record<string, SystemAccount> = {
  cash: SystemAccount.CASH,
  bank_transfer: SystemAccount.BANK,
  card: SystemAccount.BANK,
  cheque: SystemAccount.BANK,
};

export const JOURNAL_NUMBER_PREFIX = 'JV-';
export const EXPENSE_VOUCHER_PREFIX = 'PV-';

/**
 * حسابات لها دفتر مساعد في النظام (كشف العملاء، الموردين، المخزون، ذمم
 * الموظفين والتوصيل) أو تحسبها المستندات (الضريبة): لا يُصرف عليها بسند
 * صرف — تتحرك بمستنداتها فيبقى الأستاذ مطابقاً لدفاترها.
 */
export const SUBLEDGER_ACCOUNTS: readonly SystemAccount[] = [
  SystemAccount.RECEIVABLES,
  SystemAccount.PAYABLES,
  SystemAccount.INVENTORY,
  SystemAccount.COURIER_RECEIVABLE,
  SystemAccount.EMPLOYEE_ADVANCES,
  SystemAccount.EMPLOYEE_LOANS,
  SystemAccount.VAT_INPUT,
  SystemAccount.VAT_OUTPUT,
];

/** أقصى أسطر في قيد يدوي (القيد الافتتاحي التلقائي بلا حد) */
export const MAX_MANUAL_LINES = 300;

/** كم مستنداً من كل نوع يُرحَّل في الدورة الواحدة */
export const SYNC_BATCH = 300;
