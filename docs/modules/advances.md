# السلف (`advances`)

> سلفة على الراتب تُخصم في شهر سدادها.

## الغرض

مبلغ يأخذه الموظف مقدماً ويُسترد من راتبه.

## المفاهيم والقواعد

- **الحالات**: معلّقة ← معتمدة أو مرفوضة ← مدفوعة.
- **السقف**: السلفة، ومعها سلف الموظف المعلّقة والمعتمدة، لا تتجاوز إجمالي راتبه.
  الموظف بلا راتب مسجّل لا يطلب سلفة.
- **تاريخ السداد** يحدد المسير الذي تُخصم فيه.
- **من يطلب**: الموظف لنفسه (`my-advances`) أو الإدارة له (`admin/:employeeId`).
- **تأكيد التسليم** (`disburse`): يسجّل أن المبلغ سُلّم للموظف خارج المسير، ولا
  يغيّر خصم السداد. للمعتمدة فقط، ومرة واحدة.

## علاقته بباقي النظام

- يقرأ `salaries` (السقف). يقرؤه `payroll` (الخصم) و`profile`.

## صفحات الواجهة

- `/dashboard/advances`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/advances/`
- الخدمات: `advances.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `advances` | `Advance` | `advance.entity.ts` |

### المسارات (7)

**السلف** — `advances.controller.ts` (القسم في Swagger: «السلف»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| PATCH | `/advances/:id/disburse` | تأكيد تسليم السلفة للموظف خارج المسير (السداد يبقى خصماً من الراتب) | اعتماد السلف `approve_advance` | موديول السلف `advances_module` |
| POST | `/advances/my-advances` | طلب سلفة للموظف الحالي | طلب سلفة ذاتية `request_advance_self` | موديول السلف `advances_module` |
| POST | `/advances/admin/:employeeId` | تسجيل سلفة لموظف (من الإدارة) | إنشاء سلفة (إداري) `create_advance_admin` | موديول السلف `advances_module` |
| GET | `/advances/export/:type` | تصدير السلف (excel أو pdf) | عرض السلف `view_advances` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/advances/:id/export/:type` | تصدير سلفة واحدة (excel أو pdf) | عرض السلف `view_advances` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/advances` | قائمة السلف | عرض السلف `view_advances` | موديول السلف `advances_module` |
| PATCH | `/advances/:id/status` | تغيير حالة سلفة (اعتماد أو رفض) | اعتماد السلف `approve_advance` | موديول السلف `advances_module` |

<!-- AUTO:END -->
