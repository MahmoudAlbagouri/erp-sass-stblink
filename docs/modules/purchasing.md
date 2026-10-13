# المشتريات (`purchasing`)

> الموردون، فواتير الشراء، مرتجعاتها، وسداد الموردين.

## الغرض

تسجيل ما تشتريه الشركة: يدخل المخزن بتكلفته، ويُعرف ما للمورد وما دُفع له.

## المفاهيم والقواعد

- **المورد**: كود تسلسلي (`SUP-000001`)، رقم ضريبي، مهلة سداد بالأيام يُقترح منها
  تاريخ الاستحقاق، ورصيد افتتاحي. **المستحق للمورد** = الافتتاحي + الفواتير
  المعتمدة − المرتجعات − المدفوعات (سالب = المورد مدين لنا).
- **فاتورة الشراء**: مسودة (بلا أثر) ← **اعتماد** يُدخل البضاعة المخزن ويحدّث
  متوسط التكلفة ← قد تُلغى: المعتمدة تُلغى فقط إن لم يكن عليها سداد أو مرتجع،
  وتخرج بضاعتها من المخزن.
- **وحدة الشراء** قد تختلف عن وحدة الأساس (شراء بالكرتون وبيع بالقطعة).
- **مرتجع الشراء**: على فاتورة معتمدة؛ اعتماده يُخرج البضاعة ويخصم من مستحق
  المورد.
- **السداد**: على فاتورة (لا يتجاوز المتبقي عليها) أو على الحساب. إلغاؤه يعيد
  المبلغ مستحقاً.
- المبالغ تُقرَّب لخانات عملة الشركة.
- المقيَّد بفروع يرى فواتير ومرتجعات مخازن فروعه؛ الموردون وأرصدتهم مشتركة.

## علاقته بباقي النظام

- يعتمد على `catalog` و`inventory` (`StockService.apply`).
- `dashboard` يقرأ إجمالي المشتريات والمستحق وأكبر الموردين.

## صفحات الواجهة

- `/dashboard/purchasing` — الفواتير.
- `/dashboard/purchasing/returns`، `/payments`، `/suppliers`.

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/purchasing/`
- الخدمات: `purchase-invoices.service.ts`، `purchase-returns.service.ts`، `supplier-payments.service.ts`، `suppliers.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `purchase_invoices` | `PurchaseInvoice` | `purchase-invoice.entity.ts` |
| `purchase_invoice_lines` | `PurchaseInvoiceLine` | `purchase-invoice.entity.ts` |
| `purchase_returns` | `PurchaseReturn` | `purchase-return.entity.ts` |
| `purchase_return_lines` | `PurchaseReturnLine` | `purchase-return.entity.ts` |
| `supplier_payments` | `SupplierPayment` | `supplier-payment.entity.ts` |
| `suppliers` | `Supplier` | `supplier.entity.ts` |

### المسارات (21)

**فواتير الشراء** — `purchase-invoices.controller.ts` (القسم في Swagger: «فواتير الشراء»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/purchasing/invoices` | قائمة فواتير الشراء | عرض فواتير الشراء `view_purchases` | موديول المشتريات والموردين `purchasing_module` |
| GET | `/purchasing/invoices/:id` | فاتورة شراء واحدة ببنودها | عرض فواتير الشراء `view_purchases` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/invoices` | إنشاء فاتورة شراء (مسودة) | إنشاء وتعديل فواتير الشراء (مسودة) `manage_purchases` | موديول المشتريات والموردين `purchasing_module` |
| PATCH | `/purchasing/invoices/:id` | تعديل مسودة فاتورة شراء | إنشاء وتعديل فواتير الشراء (مسودة) `manage_purchases` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/invoices/:id/post` | اعتماد فاتورة الشراء: تدخل البضاعة المخزن ويُحدَّث متوسط التكلفة | اعتماد وإلغاء فواتير الشراء `post_purchases` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/invoices/:id/cancel` | إلغاء فاتورة شراء (المعتمدة تخرج بضاعتها من المخزن) | اعتماد وإلغاء فواتير الشراء `post_purchases` | موديول المشتريات والموردين `purchasing_module` |

**مرتجعات الشراء** — `purchase-returns.controller.ts` (القسم في Swagger: «مرتجعات الشراء»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/purchasing/returns` | قائمة مرتجعات الشراء | عرض فواتير الشراء `view_purchases` | موديول المشتريات والموردين `purchasing_module` |
| GET | `/purchasing/returns/:id` | مرتجع شراء واحد ببنوده | عرض فواتير الشراء `view_purchases` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/returns` | إنشاء مرتجع شراء على فاتورة (مسودة) | مرتجعات الشراء `manage_purchase_returns` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/returns/:id/post` | اعتماد مرتجع الشراء: تخرج البضاعة ويُخصم من مستحق المورد | مرتجعات الشراء `manage_purchase_returns` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/returns/:id/cancel` | إلغاء مسودة مرتجع شراء | مرتجعات الشراء `manage_purchase_returns` | موديول المشتريات والموردين `purchasing_module` |

**سداد الموردين** — `supplier-payments.controller.ts` (القسم في Swagger: «سداد الموردين»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/purchasing/payments` | قائمة سدادات الموردين | عرض فواتير الشراء `view_purchases` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/payments` | تسجيل سداد لمورد (على فاتورة أو على الحساب) | سداد الموردين `manage_supplier_payments` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/payments/:id/cancel` | إلغاء سداد: يعود المبلغ مستحقاً | سداد الموردين `manage_supplier_payments` | موديول المشتريات والموردين `purchasing_module` |

**الموردون** — `suppliers.controller.ts` (القسم في Swagger: «الموردون»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/purchasing/summary` | أرقام لوحة المشتريات: المستحق، المتأخر، مشتريات الشهر | عرض فواتير الشراء `view_purchases` | موديول المشتريات والموردين `purchasing_module` |
| GET | `/purchasing/suppliers` | قائمة الموردين وأرصدتهم | عرض الموردين `view_suppliers` | موديول المشتريات والموردين `purchasing_module` |
| GET | `/purchasing/suppliers/:id` | مورد واحد | عرض الموردين `view_suppliers` | موديول المشتريات والموردين `purchasing_module` |
| GET | `/purchasing/suppliers/:id/statement` | كشف حساب مورد | عرض الموردين `view_suppliers` | موديول المشتريات والموردين `purchasing_module` |
| POST | `/purchasing/suppliers` | إضافة مورد | إضافة وتعديل وحذف الموردين `manage_suppliers` | موديول المشتريات والموردين `purchasing_module` |
| PATCH | `/purchasing/suppliers/:id` | تعديل مورد | إضافة وتعديل وحذف الموردين `manage_suppliers` | موديول المشتريات والموردين `purchasing_module` |
| DELETE | `/purchasing/suppliers/:id` | حذف مورد | إضافة وتعديل وحذف الموردين `manage_suppliers` | موديول المشتريات والموردين `purchasing_module` |

<!-- AUTO:END -->
