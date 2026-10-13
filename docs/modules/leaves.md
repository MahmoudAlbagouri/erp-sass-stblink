# الإجازات (`leaves`)

> طلبات الإجازة، أرصدتها، استحقاقها اليومي، وترحيلها السنوي.

## الغرض

إدارة إجازات الموظفين: من يطلب، من يعتمد، وكم يبقى له.

## المفاهيم والقواعد

- **الأنواع**: سنوية (تستهلك الرصيد)، بدون راتب (تُخصم من المسير)، أخرى.
- **الحالات**: معلّقة ← معتمدة أو مرفوضة.
- **الاستحقاق يومي**: الرصيد يتراكم يوماً بيوم من أيام الإجازة السنوية في العقد،
  بدءاً من تاريخ التعيين (أو آخر تسوية كاملة أو ذكرى سنوية).
- **الرصيد المتاح** = المكتسب + المرحَّل − المستهلك − ما سُوّي نقداً.
- **الإجازة السنوية** تُخصم كاملة فور اعتمادها. **بدون راتب** لا تمسّ الرصيد لكنها
  تُسقط من مدة الخدمة.
- **لا تداخل**: لا يُقبل طلب يتقاطع مع إجازة أخرى للموظف.
- **حد ائتماني قابل للإعداد**: يُسمح بتجاوز الرصيد المكتسب ضمن حد.
- **الترحيل السنوي**: مهمة يومية الساعة 1 صباحاً ترحّل رصيد من أتمّ سنته، بسقف
  أقصى، ولا ترحّل رصيداً سالباً ولا ما صُرف نقداً. ويمكن إعادة الحساب يدوياً.
- **سجلّان للتدقيق**: `leave_audit_logs` (من غيّر حالة ماذا) و
  `leave_balance_history` (كل حركة على الرصيد، ومفتاح يمنع تكرار الدورة).
- **من يطلب**: الموظف لنفسه (`my-leaves`) أو الإدارة له (`admin/:employeeId`).

## علاقته بباقي النظام

- يقرأ `contracts`. يقرؤه `payroll` (غير المدفوعة)، `settlements`، `eos`،
  `attendance` (في إجازة اليوم)، `dashboard`، `profile`.

## صفحات الواجهة

- `/dashboard/leaves`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/leaves/`
- الخدمات: `leave-accrual.service.ts`، `leave-carryover.cron.service.ts`، `leaves.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `leave_audit_logs` | `LeaveAuditLog` | `leave-audit-log.entity.ts` |
| `leave_balance_history` | `LeaveBalanceHistory` | `leave-balance-history.entity.ts` |
| `leave_balances` | `LeaveBalance` | `leave-balance.entity.ts` |
| `leave_requests` | `LeaveRequest` | `leave-request.entity.ts` |

### المسارات (11)

**الإجازات** — `leaves.controller.ts` (القسم في Swagger: «الإجازات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/leaves/my-leaves` | طلب إجازة للموظف الحالي | طلب إجازة ذاتية `request_leave_self` | موديول الإجازات `leaves_module` |
| GET | `/leaves/accrual/:employeeId` | تفاصيل استحقاق إجازات موظف | عرض الإجازات `view_leaves` | موديول الإجازات `leaves_module` |
| GET | `/leaves/summary/:employeeId` | ملخص إجازات موظف وأرصدته | عرض الإجازات `view_leaves` | موديول الإجازات `leaves_module` |
| POST | `/leaves/balance` | تحديد رصيد إجازات موظف لسنة | إدارة رصيد الإجازات `manage_leave_balance` | موديول الإجازات `leaves_module` |
| POST | `/leaves/carryover/recalculate/:employeeId` | إعادة حساب الرصيد المرحَّل لموظف | إدارة رصيد الإجازات `manage_leave_balance` | موديول الإجازات `leaves_module` |
| POST | `/leaves/carryover/recalculate-all` | إعادة حساب الرصيد المرحَّل لكل الموظفين | إدارة رصيد الإجازات `manage_leave_balance` | موديول الإجازات `leaves_module` |
| POST | `/leaves/admin/:employeeId` | تسجيل إجازة لموظف (من الإدارة) | إنشاء إجازة (إداري) `create_leave_admin` | موديول الإجازات `leaves_module` |
| GET | `/leaves/export/:type` | تصدير الإجازات (excel أو pdf) | عرض الإجازات `view_leaves` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/leaves/:id/export/:type` | تصدير إجازة واحدة (excel أو pdf) | عرض الإجازات `view_leaves` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/leaves` | قائمة طلبات الإجازة | عرض الإجازات `view_leaves` | موديول الإجازات `leaves_module` |
| PATCH | `/leaves/:id/status` | تغيير حالة طلب إجازة (اعتماد أو رفض) | اعتماد الإجازات `approve_leave` | موديول الإجازات `leaves_module` |

<!-- AUTO:END -->
