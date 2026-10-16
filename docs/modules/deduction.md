# الخصومات (`deduction`)

> خصم من راتب الموظف، دفعة واحدة أو أقساطاً.

## الغرض

استقطاع مبلغ من الراتب (غرامة، خصم تأخير، استقطاع).

## المفاهيم والقواعد

- الخصم: اسمه أو نوعه، المبلغ الكلي، تاريخ بدء التطبيق، وعدد الدفعات
  (1 = مرة واحدة، أكثر = تقسيط شهري).
- **المبلغ الشهري يُحسب تلقائياً** (الكلي ÷ الدفعات) ويُعاد حسابه إذا تغيّرا.
- **الحالات**: معلّق ← نشط أو ملغي، والنشط ← ملغي. المكتمل والملغي لا يعودان،
  و«مكتمل» يضعه المسير مع آخر دفعة. **المسير يخصم النشط فقط ويرقّم دفعاته
  وحده** (المعلّق والملغي لا تُعدّ لهما دفعة).
- الدفعات تُرقَّم عند تأكيد صرف المسير، ويكتمل الخصم تلقائياً بآخر دفعة.
- المسار `/deductions` (بالجمع) والمجلد `deduction`.

## علاقته بباقي النظام

- يقرؤه ويحدّثه `payroll` (`getActiveForMonth`).

## صفحات الواجهة

- `/dashboard/deductions`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/deduction/`
- الخدمات: `deduction.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `deductions` | `Deduction` | `deduction.entity.ts` |

### المسارات (8)

**الخصومات** — `deduction.controller.ts` (القسم في Swagger: «الخصومات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/deductions` | إضافة خصم على موظف (دفعة واحدة أو أقساط شهرية) | إضافة خصم `create_deduction` | موديول الخصومات `deductions_module` |
| GET | `/deductions/export/:type` | تصدير الخصومات (excel أو pdf) | عرض الخصومات `view_deductions` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/deductions/:id/export/:type` | تصدير خصم واحد (excel أو pdf) | عرض الخصومات `view_deductions` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/deductions` | قائمة الخصومات | عرض الخصومات `view_deductions` | موديول الخصومات `deductions_module` |
| GET | `/deductions/:id` | خصم واحد | عرض الخصومات `view_deductions` | موديول الخصومات `deductions_module` |
| PATCH | `/deductions/:id` | تعديل خصم | تعديل خصم `update_deduction` | موديول الخصومات `deductions_module` |
| PATCH | `/deductions/:id/status` | تغيير حالة خصم (نشط، مكتمل، ملغي) | تعديل خصم `update_deduction` | موديول الخصومات `deductions_module` |
| DELETE | `/deductions/:id` | حذف خصم | حذف خصم `delete_deduction` | موديول الخصومات `deductions_module` |

<!-- AUTO:END -->
