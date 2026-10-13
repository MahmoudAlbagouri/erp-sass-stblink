# المكافآت (`bonuses`)

> مكافأة تُضاف لراتب الموظف في شهر صرفها.

## الغرض

إضافة مبلغ لمرة واحدة على راتب موظف.

## المفاهيم والقواعد

- **الحالات**: معلّقة ← معتمدة أو مرفوضة ← مدفوعة. المسير يأخذ **المعتمدة** فقط.
- **تاريخ الصرف** (`payoutDate`) يحدد المسير الذي تدخله.
- **الصرف المباشر** (`disburse`): صرفها خارج المسير. تبقى ظاهرة في القسيمة ثم
  تُخصم من الصافي حتى لا تُصرف مرتين. لا يُسمح به لمكافأة دخلت مسيراً صُرف.

## علاقته بباقي النظام

- يقرؤه `payroll` (`findByMonthAndYear`).

## صفحات الواجهة

- `/dashboard/bonuses`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/bonuses/`
- الخدمات: `bonuses.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `bonuses` | `Bonus` | `bonus.entity.ts` |

### المسارات (9)

**المكافآت** — `bonuses.controller.ts` (القسم في Swagger: «المكافآت»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/bonuses` | إضافة مكافأة لموظف | إضافة مكافأة `create_bonus` | موديول المكافآت والحوافز `bonuses_module` |
| PATCH | `/bonuses/:id/disburse` | صرف مكافأة معتمدة مباشرة خارج المسير (تُخصم من صافي المسير لمنع الصرف مرتين) | تعديل مكافأة `update_bonus` | موديول المكافآت والحوافز `bonuses_module` |
| GET | `/bonuses/export/:type` | تصدير المكافآت (excel أو pdf) | عرض المكافآت `view_bonuses` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/bonuses/:id/export/:type` | تصدير مكافأة واحدة (excel أو pdf) | عرض المكافآت `view_bonuses` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/bonuses` | قائمة المكافآت | عرض المكافآت `view_bonuses` | موديول المكافآت والحوافز `bonuses_module` |
| GET | `/bonuses/:id` | مكافأة واحدة | عرض المكافآت `view_bonuses` | موديول المكافآت والحوافز `bonuses_module` |
| PATCH | `/bonuses/:id` | تعديل مكافأة | تعديل مكافأة `update_bonus` | موديول المكافآت والحوافز `bonuses_module` |
| PATCH | `/bonuses/:id/status` | تغيير حالة مكافأة (اعتماد أو رفض) | تعديل مكافأة `update_bonus` | موديول المكافآت والحوافز `bonuses_module` |
| DELETE | `/bonuses/:id` | حذف مكافأة | حذف مكافأة `delete_bonus` | موديول المكافآت والحوافز `bonuses_module` |

<!-- AUTO:END -->
