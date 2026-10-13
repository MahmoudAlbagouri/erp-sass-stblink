# الأقسام (`departments`)

> أقسام الشركة التي يتوزع عليها الموظفون.

## الغرض

تنظيم الموظفين إدارياً (مبيعات، محاسبة، مستودعات…) للفلترة والتقارير.

## المفاهيم والقواعد

- القسم اسم فقط، يتبع الشركة.
- `/departments/stats` يعيد كل قسم مع عدد موظفيه.
- متاح بلا ميزة باقة، وبصلاحيات الأقسام.
- القسم غير الفرع: القسم تقسيم وظيفي، والفرع موقع.

## علاقته بباقي النظام

- يستخدمه `employees` (فلترة وتهيئة) و`dashboard` (الموظفون حسب القسم).

## صفحات الواجهة

- يُدار من نماذج الموظفين (اختيار قسم أو إنشاء جديد).

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/departments/`
- الخدمات: `departments.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `departments` | `Department` | `department.entity.ts` |

### المسارات (5)

**الأقسام** — `departments.controller.ts` (القسم في Swagger: «الأقسام»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/departments` | إضافة قسم | إضافة قسم `create_department` | — |
| GET | `/departments` | قائمة الأقسام | عرض الأقسام `view_departments` | — |
| GET | `/departments/stats` | الأقسام مع عدد موظفي كل قسم | عرض الأقسام `view_departments` | — |
| PATCH | `/departments/:id` | تعديل قسم | تعديل قسم `update_department` | — |
| DELETE | `/departments/:id` | حذف قسم | حذف قسم `delete_department` | — |

<!-- AUTO:END -->
