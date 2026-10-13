# العقود (`contracts`)

> عقد الموظف: نوعه، مدته، وأيام إجازته السنوية.

## الغرض

توثيق شروط عمل الموظف. منه تُحسب استحقاقات الإجازة ونهاية الخدمة.

## المفاهيم والقواعد

- **عقد واحد لكل موظف**.
- يحمل: نوع العقد، تاريخ البداية والنهاية، مدة العقد بالسنوات، **أيام الإجازة
  السنوية**، فترة التجربة ونهايتها، نوع التذاكر والتأمين الطبي، ومرفقات.
- تاريخ البداية أساس حساب مدة الخدمة (نهاية الخدمة) واستحقاق الإجازة.
- العقود التي تنتهي خلال 30 يوماً تظهر في تنبيهات الصفحة الرئيسية، وصاحبها
  يُنبَّه بإشعار (فحص يومي).
- تصدير excel أو pdf (ميزة `reports_export`).

## علاقته بباقي النظام

- يقرؤه: `leaves` (الاستحقاق والترحيل)، `eos`، `settlements`، `dashboard`،
  `notifications`.

## صفحات الواجهة

- `/dashboard/contracts`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/contracts/`
- الخدمات: `contracts.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `employee_contracts` | `Contract` | `contract.entity.ts` |

### المسارات (7)

**العقود** — `contracts.controller.ts` (القسم في Swagger: «العقود»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/contracts` | إضافة عقد لموظف (عقد واحد لكل موظف) | إنشاء عقد `create_contract` | موديول العقود `contracts_module` |
| GET | `/contracts/export/:type` | تصدير العقود (excel أو pdf) | تصدير تقرير العقود `export_contracts` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/contracts/:id/export/:type` | تصدير عقد واحد (excel أو pdf) | تصدير تقرير العقود `export_contracts` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/contracts` | قائمة العقود | عرض العقود `view_contracts` | موديول العقود `contracts_module` |
| GET | `/contracts/:id` | عقد واحد | عرض العقود `view_contracts` | موديول العقود `contracts_module` |
| PATCH | `/contracts/:id` | تعديل عقد | تعديل عقد `update_contract` | موديول العقود `contracts_module` |
| DELETE | `/contracts/:id` | حذف عقد | حذف عقد `delete_contract` | موديول العقود `contracts_module` |

<!-- AUTO:END -->
