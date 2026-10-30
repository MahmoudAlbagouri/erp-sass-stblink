# الحضور والبصمة (`attendance`)

> بصمات أجهزة ZKTeco وHikvision وأي جهاز (API أو ملف Excel)، والحضور بتقويم الشركة وأثره في المسير.

## الغرض

معرفة من حضر ومتى، ومن تأخر أو غاب أو عمل إضافياً، من أجهزة البصمة مباشرة —
مع احترام أيام الراحة والعطلات والإجازات المعتمدة.

## مصادر البصمات

| المصدر | كيف يتصل | يُعرَّف بـ |
|---|---|---|
| **ZKTeco** (وما بُني على برمجياتها) | الجهاز يتصل بـ `/iclock/*` (بروتوكول ADMS / Push) | رقمه التسلسلي، ومن عنوان IP مسموح إن قُفل |
| **Hikvision** | الجهاز يرسل أحداثه (HTTP Listening) إلى `/attendance-push/hikvision/:deviceId/:key` | معرّف الجهاز + مفتاحه في الرابط |
| **API** (أي جهاز أو برنامج وسيط) | `POST /attendance-push/api` بـ JSON حتى 1000 بصمة | ترويستا `X-Device-Id` و `X-Device-Key` |
| **ملف Excel/CSV** | من الواجهة: معاينة الأعمدة ثم استيراد | المستخدم (صلاحية الاستيراد) |

- **المفتاح** (Hikvision/API) يُولَّد عند إضافة الجهاز ويُعرض **مرة واحدة**؛ تُحفظ
  بصمته فقط، ويُجدَّد من `regenerate-key` (القديم يتوقف فوراً).
- كل المصادر تمر بـ `PunchIngestService`: **منع التكرار** (نفس البصمة من نفس
  المصدر لا تُحفظ مرتين، حتى بين ملف مستورد وما أرسله الجهاز نفسه)، والربط
  بالموظف.
- `GET /attendance/devices/:id/setup` يعطي ما يُكتب في الجهاز. أجهزة ZKTeco
  كثيرة لا تدعم HTTPS ولا تتبع التحويل: عنوانها `DEVICE_SERVER_URL` إن ضُبط،
  وإلا نفس الدومين على HTTP:80 (انظر إعداد nginx أدناه).
- ملفات `.xls` القديمة غير مدعومة (تُحفظ xlsx أو csv). التواريخ النصية تُقرأ
  بترتيب يختاره المستخدم (يوم/شهر/سنة…)، والأوقات بتوقيت الجهاز المختار أو الشركة.
- Hikvision: تُقبل أحداث `AccessControllerEvent` لشخص تعرّف عليه الجهاز (المجموعة
  5 ومعها رقم الموظف)؛ نبض الاتصال والغرباء يُردّ عليهم 200 دون حفظ.

## ربط البصمة بالموظف

- **الموظف يُعرف بكوده، وبرقم البصمة** (`attendancePin`) إن حُدد لموظف مسجّل على
  جهاز من قبل برقم مختلف (1، 2، 3…) — أيهما وصل، فجهاز قديم بالرقم وآخر بالكود
  يعملان معاً. التسجيل على الأجهزة من النظام برقم البصمة إن وُجد، وإلا بالكود.
- المقارنة **بلا أصفار البداية**: الأجهزة تخزّن الأرقام أعداداً فتصل `0420001`
  بـ `420001`.
- بصمة لرقم غير مربوط تُحفظ بلا موظف وتظهر في `GET /attendance/unlinked-pins`.
  ربطها (`POST /attendance/unlinked-pins/link`، أو حقل رقم البصمة في ملف الموظف)
  يُنسب له **كل ما وصل بهذا الرقم من قبل**.
- رقم البصمة فريد في الشركة (بعد التطبيع)، ولا يأخذ موظفٌ كودَ موظف آخر. كود
  الموظف نفسه لا يُعدَّل.

## تقويم الحضور

- **يوم الوردية** يبدأ قبل بداية الوردية بـ 4 ساعات ويمتد 24 ساعة، فتُحسب وردية
  الليل يوماً واحداً.
- **اليوم يُقاس بأول بصمة وآخرها** أياً كان نوعهما: أغلب الأجهزة بلا زر
  "حضور/انصراف" فتصل كل البصمات "حضوراً".
- **أيام الراحة**: للشركة (`weeklyOffDays`، الافتراضي الجمعة، والإمارات
  السبت والأحد)، وللوردية أن تحدد غيرها (`offDays`؛ `[]` = تعمل كل الأسبوع).
- **العطلات الرسمية**: يوم أو فترة (حتى 60 يوماً).
- **الإجازات المعتمدة** من موديول الإجازات تظهر في الحضور تلقائياً.
- **حالات اليوم**: حاضر، متأخر، انصراف مبكر، ناقص (بصمة واحدة)، في إجازة،
  راحة (`off_day`)، عطلة (`holiday`)، غائب، بلا وردية (`unclassified`)، وقبل
  التحاقه (`not_employed`: قبل بداية عقده أو تسجيله، إلا إن بصم قبلها).
- **الإضافي**: ما زاد على مدة الوردية، وكل العمل في يوم راحة أو عطلة. أقل من
  `overtimeMinMinutes` (الافتراضي 30) في اليوم لا يُحتسب.
- **ساعات العمل لا تُخزَّن**: تُحسب عند القراءة، وتظهر في السجل والتصدير على آخر
  بصمة في اليوم.

## أثره في مسير الرواتب

بإعدادات الحضور (`PATCH /attendance/settings`)، وكلها **مغلقة افتراضياً**:

- `deductAbsence`: يُخصم كل يوم غياب بأجر اليوم (الأساسي ÷ 30).
- `deductLateness`: تُخصم دقائق التأخير والانصراف المبكر بأجر الدقيقة (أجر اليوم ÷
  مدة الوردية).
- `payOvertime`: يُضاف الإضافي بأجر الدقيقة × `overtimeRatePercent` (الافتراضي 150%).
- يُحاسَب **موظفو الورديات فقط** (من لا وردية له لا يُقاس بالبصمة). أيام الراحة
  والعطلات والإجازات المعتمدة ليست غياباً، والإجازة غير المدفوعة تُخصم مرة واحدة
  (من الإجازات). في شهر جارٍ تُحسب الأيام حتى اليوم.

## أمان الأجهزة

- **القفل على عنوان IP** (`allowedIps`: عناوين أو نطاقات مثل `41.33.10.0/24`):
  اتصال من غيرها يُرفض ولا تُقبل منه بصمة، مع تنبيه `device_security`.
- بلا قفل: **تنبيه حين يتغير عنوان الجهاز** — جهاز منتحَل الرقم يظهر هنا.
- عنوان العميل الحقيقي خلف nginx من `X-Forwarded-For` (`TRUST_PROXY`، الافتراضي
  `loopback`).

## أوامر ZKTeco ونسخ البصمات

- الأوامر تُحفظ بصيغة Push 2.x (`DATA UPDATE USERINFO …`) وتُترجم للأجهزة
  القديمة (`DATA USER …`) حسب `pushver` الذي يعلنه الجهاز عند اتصاله. الجهاز
  الحديث يأخذ حتى 10 أوامر في السؤال الواحد.
- كل أمر يُرسل `C:<seq>:<الأمر>` وينتهي بسطر جديد، و`seq` **عدد صحيح** يعود في
  نتيجة التنفيذ (`ID=<seq>&Return=<code>`). الأجهزة تتجاهل أمراً رقمه غير عددي
  (UUID): لا تنفّذه ولا تردّ عليه.
- "إرسال للجهاز" لموظف أو لكل الموظفين (`sync-users`) يسجّل الاسم والرقم.
- **نسخ البصمات بين الأجهزة** (`syncBiometrics`، مغلق افتراضياً): الجهاز يرفع
  قوالب من يسجّل إصبعه/وجهه (OPERLOG / BIODATA)، فتُحفظ **مشفّرة** (AES-256-GCM
  بـ `BIOMETRIC_SECRET`) لموظفين مربوطين، وتُرسل لباقي أجهزة ZKTeco في الشركة.
  القالب العائد من جهاز نُسخ إليه لا يُنسخ ثانية. أمر الطابور يشير للقالب ولا
  يحمله. **إيقاف النسخ يحذف كل القوالب** وما ينتظر إرساله منها.
- توافق القوالب بين موديلات مختلفة (خوارزمية الإصبع، الوجه) يحدده الجهاز: قالب
  لا يقبله يُسجَّل خطأً في نتيجة الأمر ولا يكسر شيئاً.

## تشخيص توصيل جهاز ZKTeco

- `ADMS_DEBUG=true` يسجّل كل طلب على `/iclock` (المسار، العنوان، نوع الجسم
  وحجمه، ورمز الرد) — ومنها مسارات لا نعالجها (404) تكشف جهازاً بإصدار بروتوكول
  مختلف. يُطفأ بعد التوصيل.
- جسم طلبات الجهاز يُقرأ **أياً كان `Content-Type`** (وبعض الأجهزة لا ترسله).
- جهاز غير مسجّل يظهر في السجل `Rejected device SN=…` ومعه رقمه التسلسلي وعنوانه.
- للتجربة على شبكة محلية: `DEVICE_SERVER_URL=http://<IP الجهاز المضيف>:<PORT>`،
  ومنفذ السيرفر مفتوح في جدار الحماية.

## إعداد nginx في الإنتاج

```nginx
# أجهزة ZKTeco: HTTP عادي بلا تحويل لـ HTTPS (كثير منها لا يدعمه)
server {
  listen 80;
  server_name erp.api.stblink.com;
  location /iclock/ {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location / { return 301 https://$host$request_uri; }
}
```

وفي كتلة HTTPS: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
(بدونه كل الأجهزة تظهر بعنوان السيرفر نفسه ولا يعمل القفل)، و
`client_max_body_size` 10m على الأقل لرفع البصمات.

## علاقته بباقي النظام

- يقرأ `employees` (ورقم البصمة)، `shifts` (وأيام راحتها)، `leaves` (المعتمدة)،
  `contracts` (بداية العمل). يستخدمه `dashboard` (حضور اليوم) و`payroll`.
- يستدعي `notifications` (`device_offline`، `device_security`،
  `attendance_change`).

## صفحات الواجهة

- `/dashboard/attendance` — الأجهزة وطريقة توصيلها، السجل والاستيراد والأرقام
  غير المربوطة، الملخص اليومي، التقرير الشهري، والإعدادات (الراحة والعطلات
  والمسير ونسخ البصمات).

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/attendance/`
- الخدمات: `adms.service.ts`، `attendance-import.service.ts`، `attendance-settings.service.ts`، `attendance.service.ts`، `biometric-sync.service.ts`، `device-push.service.ts`، `punch-ingest.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `attendance_logs` | `AttendanceLog` | `attendance-log.entity.ts` |
| `attendance_settings` | `AttendanceSettings` | `attendance-settings.entity.ts` |
| `biometric_devices` | `BiometricDevice` | `biometric-device.entity.ts` |
| `biometric_templates` | `BiometricTemplate` | `biometric-template.entity.ts` |
| `device_commands` | `DeviceCommand` | `device-command.entity.ts` |
| `public_holidays` | `PublicHoliday` | `public-holiday.entity.ts` |

### المسارات (34)

**أجهزة البصمة (ADMS)** — `adms.controller.ts` (القسم في Swagger: «أجهزة البصمة (ADMS)»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/iclock/cdata` | التعريف: الجهاز يطلب إعدادات المزامنة | — | — |
| POST | `/iclock/cdata` | رفع البيانات: البصمات (ATTLOG)، والمستخدمون وقوالب بصماتهم (OPERLOG / BIODATA) لنسخها بين الأجهزة. غيرها (الصور…) يُقبل بلا معالجة. | — | — |
| GET | `/iclock/getrequest` | سؤال الجهاز الدوري عن أوامره (وهو أيضاً نبض الاتصال) | — | — |
| POST | `/iclock/devicecmd` | نتيجة تنفيذ الأوامر | — | — |
| GET | `/iclock/ping` | بعض الإصدارات تفحص الاتصال بهذا المسار | — | — |

**الحضور والانصراف** — `attendance-settings.controller.ts` (القسم في Swagger: «الحضور والانصراف»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/attendance/settings` | سياسة الحضور: أيام الراحة، ربط الحضور بالمسير، نسخ البصمات | عرض ملخص الحضور اليومي `view_attendance_summary` | موديول الحضور والانصراف `attendance_module` |
| PATCH | `/attendance/settings` | تعديل سياسة الحضور. إيقاف نسخ البصمات يحذف كل القوالب المحفوظة | إعدادات الحضور: أيام الراحة والعطلات الرسمية وربط الحضور بالرواتب ونسخ البصمات `manage_attendance_settings` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/holidays` | العطلات الرسمية (لسنة إن حُددت) | عرض ملخص الحضور اليومي `view_attendance_summary` | موديول الحضور والانصراف `attendance_module` |
| POST | `/attendance/holidays` | إضافة عطلة رسمية (يوم أو فترة) | إعدادات الحضور: أيام الراحة والعطلات الرسمية وربط الحضور بالرواتب ونسخ البصمات `manage_attendance_settings` | موديول الحضور والانصراف `attendance_module` |
| PATCH | `/attendance/holidays/:id` | تعديل عطلة رسمية | إعدادات الحضور: أيام الراحة والعطلات الرسمية وربط الحضور بالرواتب ونسخ البصمات `manage_attendance_settings` | موديول الحضور والانصراف `attendance_module` |
| DELETE | `/attendance/holidays/:id` | حذف عطلة رسمية | إعدادات الحضور: أيام الراحة والعطلات الرسمية وربط الحضور بالرواتب ونسخ البصمات `manage_attendance_settings` | موديول الحضور والانصراف `attendance_module` |

**الحضور والانصراف** — `attendance.controller.ts` (القسم في Swagger: «الحضور والانصراف»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/attendance/devices` | إضافة جهاز بصمة | إضافة جهاز بصمة `create_biometric_device` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` · حد: `max_biometric_devices` |
| POST | `/attendance/devices/:id/push-user/:employeeId` | إرسال موظف (وبصماته المحفوظة) إلى جهاز ZKTeco ليُسجَّل عليه | مزامنة جهاز البصمة `sync_biometric_device` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| POST | `/attendance/devices/:id/sync-users` | إرسال كل الموظفين النشطين (وبصماتهم المحفوظة) لجهاز ZKTeco | مزامنة جهاز البصمة `sync_biometric_device` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| GET | `/attendance/devices/:id/setup` | ما يُكتب في إعدادات الجهاز ليتصل بالسيرفر | عرض أجهزة البصمة `view_biometric_devices` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| POST | `/attendance/devices/:id/regenerate-key` | مفتاح إرسال جديد لجهاز Hikvision أو API (القديم يتوقف فوراً) | تعديل جهاز بصمة `update_biometric_device` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| GET | `/attendance/devices` | قائمة أجهزة البصمة وحالة اتصالها | عرض أجهزة البصمة `view_biometric_devices` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| GET | `/attendance/devices/:id` | جهاز بصمة واحد | عرض أجهزة البصمة `view_biometric_devices` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| PATCH | `/attendance/devices/:id` | تعديل جهاز بصمة أو إيقافه | تعديل جهاز بصمة `update_biometric_device` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| DELETE | `/attendance/devices/:id` | حذف جهاز بصمة (بصماته المسجّلة تبقى) | حذف جهاز بصمة `delete_biometric_device` | ربط أجهزة البصمة (ZKTeco وHikvision وغيرها) `biometric_integration` |
| GET | `/attendance/logs` | سجلات الحضور والانصراف (مع فلترة وترقيم) | عرض سجلات الحضور `view_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| POST | `/attendance/logs` | تسجيل بصمة يدوياً لموظف | إضافة سجل حضور يدوي `create_attendance_log` | موديول الحضور والانصراف `attendance_module` |
| PATCH | `/attendance/logs/:id` | تصحيح وقت بصمة أو نوعها | تعديل سجل الحضور `update_attendance_log` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/logs/export/:type` | تصدير سجلات الحضور (excel أو pdf) | عرض سجلات الحضور `view_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/unlinked-pins` | أرقام وصلت منها بصمات ولا يقابلها موظف | عرض سجلات الحضور `view_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| POST | `/attendance/unlinked-pins/link` | ربط رقم على الجهاز بموظف، ومعه كل البصمات التي وصلت به من قبل | تعديل سجل الحضور `update_attendance_log` | موديول الحضور والانصراف `attendance_module` |
| POST | `/attendance/import/preview` | معاينة ملف بصمات (Excel/CSV): أعمدته وأول صفوفه وتخمين معانيها | استيراد بصمات من ملف Excel أو CSV `import_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| POST | `/attendance/import` | استيراد بصمات من ملف صدّره برنامج أي جهاز بصمة | استيراد بصمات من ملف Excel أو CSV `import_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/logs/employee/:employeeId` | سجلات حضور موظف واحد | عرض سجلات الحضور `view_attendance_logs` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/summary/daily` | ملخص حضور يوم: حاضر، متأخر، غائب، في إجازة | عرض ملخص الحضور اليومي `view_attendance_summary` | موديول الحضور والانصراف `attendance_module` |
| GET | `/attendance/summary/employee/:employeeId/monthly` | تقرير حضور موظف لشهر | عرض تقارير الحضور الشهرية `view_attendance_reports` | موديول الحضور والانصراف `attendance_module` |

**أجهزة البصمة (Hikvision / API)** — `device-push.controller.ts` (القسم في Swagger: «أجهزة البصمة (Hikvision / API)»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/attendance-push/hikvision/:deviceId/:key` | فحص الرابط من المتصفح أو من زر "اختبار" في الجهاز | — | — |
| POST | `/attendance-push/hikvision/:deviceId/:key` | أحداث جهاز Hikvision (HTTP Listening): JSON أو multipart بحقل event_log. يرد 200 على كل حدث مقبول — بصمةً كان أو غيره — فلا يعيد الجهاز إرساله. | — | — |
| POST | `/attendance-push/api` | بصمات من أي جهاز أو برنامج وسيط: حتى 1000 بصمة في الطلب. الجهاز يُعرَّف بترويستي X-Device-Id و X-Device-Key. | — | — |

<!-- AUTO:END -->
