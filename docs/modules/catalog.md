# الأصناف (`catalog`)

> المنتجات والخدمات: أسعارها، وحداتها، باركوداتها، تصنيفاتها، وضرائبها.

## الغرض

دليل ما تبيعه الشركة وتشتريه. كل الموديولات التجارية تشير إلى أصنافه.

## المفاهيم والقواعد

- **نوعان**: `stocked` بضاعة لها رصيد مخزني، و`service` خدمة بلا مخزون (توصيل،
  رسوم) — لا تدخل مستندات المخزون ولا تخرج منه عند البيع.
- **كود الصنف** (SKU) فريد داخل الشركة ويُولَّد تلقائياً إن لم يُدخل.
- **وحدة الأساس**: بها يُحسب المخزون وسعر البيع الأساسي. للصنف **وحدات أخرى**
  (كرتون = 12 قطعة) لكل منها معامل تحويل وسعر خاص اختياري.
- **باركودات** متعددة للصنف، وكل باركود قد يخص وحدة معيّنة.
- **السعر شامل الضريبة أم قبلها**: يُحدَّد على الصنف (المعتاد في التجزئة: شامل).
- **أقل سعر بيع** (اختياري): حد لا ينزل عنه الكاشير بعد الخصم.
- **يُباع بالوزن**: للميزان والباركود الموزون؛ والوحدة تحدد هل تقبل كسوراً.
- **سعر مفتوح** (`openPrice`): لا سعر ثابت (خدمة، خضار بالقيمة) — شاشة الكاشير
  تطلب السعر عند إضافته، وسعر البيع اقتراح فقط. انظر
  [../pos-screen.md](../pos-screen.md#الصنف-بسعر-مفتوح).
- **التصنيفات** شجرية (رئيسي ← فرعي) ولها لون يظهر على زر الكاشير.
- **الضرائب**: نسب مع تصنيفها لدى هيئة الزكاة والضريبة، وواحدة افتراضية
  للأصناف الجديدة.
- الحذف منطقي: الفواتير القديمة تبقى تشير للصنف، والفاتورة تنسخ اسمه وكوده
  وضريبته وقت البيع فلا تتغير لو عُدّل لاحقاً.
- حد الباقة: `max_products`.
- `updatedAt` أساس مزامنة شاشة الكاشير ("ما تغيّر منذ آخر سحب").

## علاقته بباقي النظام

- يعتمد عليه: `inventory`، `purchasing`، `sales`، `pos`.
- استيراد قائمة أصناف مع رصيدها الافتتاحي: `POST /inventory/stock/import-products`.

## صفحات الواجهة

- `/dashboard/products` — الأصناف.
- `/dashboard/products/settings` — التصنيفات والوحدات والضرائب.

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/catalog/`
- الخدمات: `catalog-settings.service.ts`، `products-import.service.ts`، `products.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `product_barcodes` | `ProductBarcode` | `product-barcode.entity.ts` |
| `product_categories` | `ProductCategory` | `product-category.entity.ts` |
| `product_units` | `ProductUnit` | `product-unit.entity.ts` |
| `products` | `Product` | `product.entity.ts` |
| `tax_rates` | `TaxRate` | `tax-rate.entity.ts` |
| `units` | `Unit` | `unit.entity.ts` |

### المسارات (19)

**إعدادات الأصناف** — `catalog-settings.controller.ts` (القسم في Swagger: «إعدادات الأصناف»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/catalog/categories` | قائمة تصنيفات الأصناف | عرض الأصناف `view_products` | موديول الأصناف `products_module` |
| POST | `/catalog/categories` | إضافة تصنيف | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| PATCH | `/catalog/categories/:id` | تعديل تصنيف | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| DELETE | `/catalog/categories/:id` | حذف تصنيف | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| GET | `/catalog/units` | قائمة وحدات القياس | عرض الأصناف `view_products` | موديول الأصناف `products_module` |
| POST | `/catalog/units` | إضافة وحدة قياس | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| PATCH | `/catalog/units/:id` | تعديل وحدة قياس | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| DELETE | `/catalog/units/:id` | حذف وحدة قياس | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| GET | `/catalog/tax-rates` | قائمة نسب الضريبة | عرض الأصناف `view_products` | موديول الأصناف `products_module` |
| POST | `/catalog/tax-rates` | إضافة نسبة ضريبة | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| PATCH | `/catalog/tax-rates/:id` | تعديل نسبة ضريبة | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| DELETE | `/catalog/tax-rates/:id` | حذف نسبة ضريبة | إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |

**الأصناف** — `products.controller.ts` (القسم في Swagger: «الأصناف»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/catalog/products/import` | استيراد أصناف دفعة واحدة (حتى 1000). الموجود باسمه يُتخطى، والتصنيفات والوحدات تُنشأ بالاسم. للاستيراد مع رصيد افتتاحي: POST /inventory/stock/import-products | إضافة صنف `create_product` + إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` | موديول الأصناف `products_module` |
| POST | `/catalog/products` | إضافة صنف | إضافة صنف `create_product` | موديول الأصناف `products_module` · حد: `max_products` |
| GET | `/catalog/products` | قائمة الأصناف (بحث وفلترة وترقيم) | عرض الأصناف `view_products` | موديول الأصناف `products_module` |
| GET | `/catalog/products/barcode/:barcode` | صنف بباركوده | عرض الأصناف `view_products` | موديول الأصناف `products_module` |
| GET | `/catalog/products/:id` | صنف واحد بوحداته وباركوداته | عرض الأصناف `view_products` | موديول الأصناف `products_module` |
| PATCH | `/catalog/products/:id` | تعديل صنف | تعديل صنف `update_product` | موديول الأصناف `products_module` |
| DELETE | `/catalog/products/:id` | حذف صنف | حذف صنف `delete_product` | موديول الأصناف `products_module` |

<!-- AUTO:END -->
