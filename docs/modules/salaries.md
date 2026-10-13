# الرواتب (`salaries`)

> راتب كل موظف: الأساسي والبدلات وطريقة الدفع.

## الغرض

تحديد ما يستحقه الموظف شهرياً. منه يبني المسير صافي الراتب.

## المفاهيم والقواعد

- الراتب: أساسي + بدل سكن + بدل نقل + بدلات أخرى = **الإجمالي**.
- **طريقة الدفع**: نقدي أو بنكي. البنكي يتطلب IBAN صالحاً.
- الراتب يتبع ميزة `employees_module` (لا ميزة مستقلة).
- الإجمالي هو سقف السلفة، وأساس حساب نهاية الخدمة وبدل الإجازة.
- المبالغ بخانات عملة الشركة.

## علاقته بباقي النظام

- يقرؤه: `payroll`، `advances`، `eos`، `settlements`، `profile`.
- `employees` (التهيئة) ينشئه مع الملف.

## صفحات الواجهة

- `/dashboard/salaries`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/salaries/`
- الخدمات: `salaries.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `salaries` | `Salary` | `salary.entity.ts` |

### المسارات (5)

**الرواتب** — `salaries.controller.ts` (القسم في Swagger: «الرواتب»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/salaries` | تحديد راتب موظف وبدلاته | إدارة الرواتب `manage_salary` | موديول الموظفين `employees_module` |
| GET | `/salaries/export/:type` | تصدير الرواتب (excel أو pdf) | عرض الرواتب `view_salaries` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/salaries/:id/export/:type` | تصدير راتب موظف واحد (excel أو pdf) | عرض الرواتب `view_salaries` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/salaries` | قائمة رواتب الموظفين | عرض الرواتب `view_salaries` | موديول الموظفين `employees_module` |
| PATCH | `/salaries/:id` | تعديل راتب موظف | إدارة الرواتب `manage_salary` | موديول الموظفين `employees_module` |

<!-- AUTO:END -->
