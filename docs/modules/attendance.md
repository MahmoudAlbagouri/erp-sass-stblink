# الحضور والبصمة (`attendance`)

> استقبال بصمات أجهزة ZKTeco، وسجلات الحضور وتقاريره.

## الغرض

معرفة من حضر ومتى، ومن تأخر أو غاب، من أجهزة البصمة مباشرة.

## المفاهيم والقواعد

- **قسمان**: `/iclock/*` بروتوكول ADMS تستدعيه **الأجهزة نفسها** (بلا جلسة،
  الجهاز يُعرَّف برقمه التسلسلي)، و`/attendance/*` لواجهة النظام.
- **تسجيل الجهاز**: يُضاف برقمه التسلسلي (فريد على النظام كله) وفرعه. جهاز غير
  مسجّل أو موقوف تُرفض بصماته. حد الباقة: `max_biometric_devices`.
- **حالة الاتصال محسوبة**: متصل إن تواصل خلال آخر دقيقتين.
- **الوقت**: البصمة تُقرأ بمنطقة الجهاز (أو الشركة إن لم تُحدَّد) وتُخزَّن UTC.
- **منع التكرار**: إعادة رفع نفس البصمة لا تكرّرها.
- **يوم الوردية**: يبدأ قبل بداية الوردية بـ 4 ساعات ويمتد 24 ساعة، فتُحسب
  وردية الليل يوماً واحداً.
- **حالات اليوم**: حاضر، متأخر (بعد فترة السماح)، انصراف مبكر، ناقص (بصمة
  واحدة)، في إجازة، غائب.
- **الأوامر للجهاز** (مثل إرسال موظف) تُحفظ في طابور يسحبه الجهاز عند اتصاله.
- **التعديل اليدوي**: تسجيل بصمة أو تصحيحها بصلاحية، وصاحبها يُنبَّه بإشعار.
- الحضور يتبع **فرع الموظف** لا فرع الجهاز الذي بصم عليه.
- بصمات سُجّلت قبل تصحيح المناطق الزمنية لم تُرحَّل.

## علاقته بباقي النظام

- يقرأ `employees`، `shifts`، `leaves`. يستخدمه `dashboard` (حضور اليوم).
- يستدعي `notifications`.

## صفحات الواجهة

- `/dashboard/attendance` — الأجهزة، السجلات، الملخص اليومي، التقرير الشهري.

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/attendance/`
- الخدمات: `adms.service.ts`، `attendance.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `attendance_logs` | `AttendanceLog` | `attendance-log.entity.ts` |
| `biometric_devices` | `BiometricDevice` | `biometric-device.entity.ts` |
| `device_commands` | `DeviceCommand` | `device-command.entity.ts` |

### المسارات (18)

**أجهزة البصمة (ADMS)** — `adms.controller.ts` (القسم في Swagger: «أجهزة البصمة (ADMS)»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/iclock/cdata` | التعريف: الجهاز يطلب إعدادات المزامنة | — | — |
| POST | `/iclock/cdata` | رفع البيانات: البصمات (ATTLOG)، وغيرها يُقبل بلا معالجة | — | — |
| GET | `/iclock/getrequest` | سؤال الجهاز الدوري عن أوامره (وهو أيضاً نبض الاتصال) | — | — |
| POST | `/iclock/devicecmd` | نتيجة تنفيذ الأوامر | — | — |
| GET | `/iclock/ping` | بعض الإصدارات تفحص الاتصال بهذا المسار | — | — |

**الحضور والانصراف** — `attendance.controller.ts` (القسم في Swagger: «الحضور والانصراف»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/attendance/devices` | إضافة جهاز بصمة | إضافة جهاز بصمة `create_biometric_device` | ربط أجهزة البصمة (ZKTeco) `biometric_integration` · حد: `max_biometric_devices` |
| POST | `/attendance/devices/:id/push-user/:employeeId` | إرسال موظف إلى جهاز البصمة ليُسجَّل عليه | مزامنة جهاز البصمة `sync_biometric_device` | ربط أجهزة البصمة (ZKTeco) `biometric_integration` |
| GET | `/attendance/devices` | قائمة أجهزة البصمة وحالة اتصالها | عرض أجهزة البصمة `view_biometric_devices` | ربط أجهزة البصمة (ZKTeco) `biometric_integration` |
| GET | `/attendance/devices/:id` | جهاز بصمة واحد | عرض أجهزة البصمة `view_biometric_devices` | ربط أجهزة البصمة (ZKTeco) `biometric_integration` |
| PATCH | `/attendance/devices/:id` | تعديل جهاز بصمة أو إيقافه | تعديل جهاز بصمة `update_biometric_device` | ربط أجهزة البصمة (ZKTeco) `biometric_integration` |
| DELETE | `/attendance/devices/:id` | حذف جهاز بصمة (بصماته المسجّلة تبقى) | حذف جهاز بصمة `delete_biometric_device` | ربط أجهزة البصمة (ZKTeco) `biometric_integration` |
| GET | `/attendance/logs` | سجلات الحضور والانصراف (مع فلترة وترقيم) | عرض سجلات الحضور `view_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| POST | `/attendance/logs` | تسجيل بصمة يدوياً لموظف | إضافة سجل حضور يدوي `create_attendance_log` | موديول الحضور والانصراف `attendance_module` |
| PATCH | `/attendance/logs/:id` | تصحيح وقت بصمة أو نوعها | تعديل سجل الحضور `update_attendance_log` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/logs/export/:type` | تصدير سجلات الحضور (excel أو pdf) | عرض سجلات الحضور `view_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/logs/employee/:employeeId` | سجلات حضور موظف واحد | عرض سجلات الحضور `view_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/summary/daily` | ملخص حضور يوم: حاضر، متأخر، غائب، في إجازة | عرض ملخص الحضور اليومي `view_attendance_summary` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/summary/employee/:employeeId/monthly` | تقرير حضور موظف لشهر | عرض تقارير الحضور الشهرية `view_attendance_reports` | موديول الحضور والانصراف `attendance_module` |

<!-- AUTO:END -->
