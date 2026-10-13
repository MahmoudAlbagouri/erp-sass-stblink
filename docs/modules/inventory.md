# المخزون (`inventory`)

> المخازن، الأرصدة، دفتر الحركات، التحويلات، الجرد، ومتوسط التكلفة.

## الغرض

معرفة "كم عندي من كل صنف، في أي مخزن، وبكم تكلفته" في كل لحظة، مع سجل يفسّر
كل تغيير.

## المفاهيم والقواعد

- **مدخل واحد لتغيير أي رصيد**: `StockService.apply`. المشتريات والمبيعات
  والتحويلات والجرد كلها تمرّ منه، ولا يكتب أحد في جداول المخزون مباشرة.
- **دفتر الحركات** (`stock_movements`) لا يُعدَّل ولا يُحذف: كل تغيير له سطر،
  وتصحيح الخطأ بحركة عكسية. أنواع الحركة: افتتاحي، شراء، مرتجع شراء، بيع،
  مرتجع بيع، تحويل خارج/داخل، تسوية، جرد.
- **الكميات بوحدة الأساس** دائماً (موجبة = دخول، سالبة = خروج).
- **متوسط التكلفة المرجّح على مستوى الشركة** لا المخزن (`inventory_items`):
  يتغير فقط عند دخول بضاعة بتكلفة جديدة (شراء، افتتاحي)، والتحويل لا يغيّره.
- **قفل الصنف**: كل حركة تقفل سجل الصنف أولاً، فحركات نفس الصنف المتزامنة
  تُنفَّذ بالتتابع ولا يفسد الرصيد أو المتوسط.
- **الرصيد السالب**: يُسمح به لكل مخزن على حدة (`allowNegativeStock`). الافتراضي:
  مسموح لمخازن الفروع (الكاشير لا يتعطل) وممنوع للرئيسي.
- **المخازن**: كل مخزن يتبع فرعاً. المخزن الرئيسي يُنشأ تلقائياً ولا يُحذف ولا
  يُوقف. لا يُحذف مخزن به أرصدة أو عليه تحويلات مفتوحة. حد الباقة: `max_warehouses`.
- **التحويل**: مسودة ← مُرسَل (تخرج من المرسِل وتصير "في الطريق") ← مُستلَم
  (تدخل المستلِم). إلغاء المُرسَل يعيد البضاعة لمخزنها.
- **الجرد**: مسودة بالكميات المعدودة ← اعتماد يسوّي كل رصيد على المعدود.
- **حد إعادة الطلب** لكل صنف في كل مخزن، ومنه تنبيه "ناقص".
- المستخدم المقيَّد بفروع يعمل على مخازن فروعه فقط (انظر `docs/branches.md`).

## علاقته بباقي النظام

- يعتمد على `catalog` و`branches`. يستخدمه `purchasing` و`sales` و`pos`
  و`dashboard`.
- `WarehousesService.findActiveByIds` نقطة التحقق من المخزن لكل مستند.

## صفحات الواجهة

- `/dashboard/inventory` — الأرصدة.
- `/dashboard/inventory/movements`، `/transfers`، `/stocktakes`، `/warehouses`.

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/inventory/`
- الخدمات: `stock-import.service.ts`، `stock.service.ts`، `stocktakes.service.ts`، `transfers.service.ts`، `warehouses.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `inventory_items` | `InventoryItem` | `inventory-item.entity.ts` |
| `stock_levels` | `StockLevel` | `stock-level.entity.ts` |
| `stock_movements` | `StockMovement` | `stock-movement.entity.ts` |
| `stock_transfers` | `StockTransfer` | `stock-transfer.entity.ts` |
| `stock_transfer_lines` | `StockTransferLine` | `stock-transfer.entity.ts` |
| `stocktakes` | `Stocktake` | `stocktake.entity.ts` |
| `stocktake_lines` | `StocktakeLine` | `stocktake.entity.ts` |
| `warehouses` | `Warehouse` | `warehouse.entity.ts` |

### المسارات (24)

**أرصدة المخزون** — `stock.controller.ts` (القسم في Swagger: «أرصدة المخزون»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/inventory/stock/import-products` | استيراد أصناف مع رصيدها الافتتاحي في طلب واحد (قائمة عميل جديد). يتطلب موديولي الأصناف والمخزون معاً. | إضافة صنف `create_product` + إدارة التصنيفات والوحدات والضرائب `manage_catalog_settings` + تسوية المخزون والرصيد الافتتاحي `adjust_stock` | موديول المخزون والمخازن `inventory_module` |
| GET | `/inventory/stock` | أرصدة الأصناف في المخازن (مع تنبيه الناقص والسالب) | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| GET | `/inventory/stock/summary` | ملخص المخزون: عدد الأصناف، قيمته، الناقص، السالب | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| GET | `/inventory/stock/lookup` | بحث أصناف لإضافتها في مستند مخزني، مع رصيدها في المخزن المحدد | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| PATCH | `/inventory/stock/min-quantity` | تحديد حد إعادة الطلب لصنف في مخزن | تسوية المخزون والرصيد الافتتاحي `adjust_stock` | موديول المخزون والمخازن `inventory_module` |
| GET | `/inventory/movements` | دفتر حركات المخزون | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/adjustments` | تسوية مخزون أو رصيد افتتاحي | تسوية المخزون والرصيد الافتتاحي `adjust_stock` | موديول المخزون والمخازن `inventory_module` |

**الجرد** — `stocktakes.controller.ts` (القسم في Swagger: «الجرد»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/inventory/stocktakes` | قائمة عمليات الجرد | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| GET | `/inventory/stocktakes/:id` | جرد واحد ببنوده (والمسودة تعرض رصيد النظام الحالي) | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/stocktakes` | بدء جرد (مسودة) | الجرد واعتماده `manage_stocktakes` | موديول المخزون والمخازن `inventory_module` |
| PATCH | `/inventory/stocktakes/:id` | تعديل مسودة جرد | الجرد واعتماده `manage_stocktakes` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/stocktakes/:id/post` | اعتماد الجرد: تُسوّى الأرصدة على المعدود | الجرد واعتماده `manage_stocktakes` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/stocktakes/:id/cancel` | إلغاء مسودة جرد | الجرد واعتماده `manage_stocktakes` | موديول المخزون والمخازن `inventory_module` |

**تحويلات المخزون** — `transfers.controller.ts` (القسم في Swagger: «تحويلات المخزون»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/inventory/transfers` | قائمة التحويلات بين المخازن | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| GET | `/inventory/transfers/:id` | تحويل واحد ببنوده | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/transfers` | إنشاء تحويل (مسودة) | إنشاء وإرسال التحويلات بين المخازن `manage_stock_transfers` | موديول المخزون والمخازن `inventory_module` |
| PATCH | `/inventory/transfers/:id` | تعديل مسودة تحويل | إنشاء وإرسال التحويلات بين المخازن `manage_stock_transfers` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/transfers/:id/send` | إرسال التحويل: تخرج البضاعة من المخزن المرسِل | إنشاء وإرسال التحويلات بين المخازن `manage_stock_transfers` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/transfers/:id/receive` | استلام التحويل: تدخل البضاعة المخزن المستلِم | استلام التحويلات بين المخازن `receive_stock_transfers` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/transfers/:id/cancel` | إلغاء تحويل (تعود البضاعة المرسَلة لمخزنها) | إنشاء وإرسال التحويلات بين المخازن `manage_stock_transfers` | موديول المخزون والمخازن `inventory_module` |

**المخازن** — `warehouses.controller.ts` (القسم في Swagger: «المخازن»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/inventory/warehouses` | قائمة المخازن مع فرع كل مخزن | عرض المخزون وحركاته `view_inventory` | موديول المخزون والمخازن `inventory_module` |
| POST | `/inventory/warehouses` | إضافة مخزن لفرع | إدارة المخازن `manage_warehouses` | موديول المخزون والمخازن `inventory_module` · حد: `max_warehouses` |
| PATCH | `/inventory/warehouses/:id` | تعديل مخزن أو نقله لفرع آخر أو إيقافه | إدارة المخازن `manage_warehouses` | موديول المخزون والمخازن `inventory_module` |
| DELETE | `/inventory/warehouses/:id` | حذف مخزن (بلا أرصدة ولا تحويلات مفتوحة) | إدارة المخازن `manage_warehouses` | موديول المخزون والمخازن `inventory_module` |

<!-- AUTO:END -->
