# الإشعارات (`notifications`)

> مركز إشعارات لحظي: تنبيهات تلقائية من كل الموديولات، فحوص دورية (انتهاء العقود والإقامات، المخزون، الفواتير...)، ورسائل الإدارة للموظفين.

## الغرض

يصل لكل مستخدم ما يخصه وما يملك التصرف فيه، فور حدوثه، مرة واحدة فقط،
ومعه تفاصيله ورابط صفحته. والمدير يراسل موظفاً أو أكثر أو الجميع ويعرف من قرأ.

## المفاهيم والقواعد

**المدخل الواحد: `NotifierService.notify`.** يحدد المستلمين، يستبعد من كتم
النوع، يكتب الإشعار ومستلميه في معاملة واحدة، ثم يبثه لهم لحظياً. لا شيء آخر
يكتب في جداول الإشعارات. المستمعات والفاحصات تستخدم `notifySafe` (فشل الإشعار
يُسجَّل ولا يوقف شيئاً).

**البنية.** `notifications` تحمل المحتوى مرة واحدة (نوع، خطورة، عنوان، نص،
`details` تفاصيل منظمة تُعرض كما هي، `data` للواجهة، رابط، مرسل)،
و`notification_recipients` سطر لكل مستلم بحالته عنده (`readAt`،
`acknowledgedAt`، `hiddenAt`). رسالة لـ 300 موظف = سطر محتوى و300 سطر خفيف.

**لا تكرار أبداً.** كل إشعار يُنشأ من فحص أو حدث يحمل `dedupeKey` فريداً
(فهرس فريد في القاعدة، `INSERT ... ON CONFLICT DO NOTHING`): دورتان متزامنتان
أو نسختا سيرفر لا تنشئان إلا واحداً. التكرار القديم كان سببه تسجيل
`ScheduleModule.forRoot()` مرتين (في AppModule وفي هذا الموديول)، فكانت كل مهمة
دورية في النظام تعمل مرتين في نفس اللحظة — الجدولة الآن في AppModule وحده.

**المستلمون (`Audience`)** بلغة العمل، وكلهم مستخدمون فعّالون داخل الشركة:

| الجمهور | من يصله |
|---|---|
| `Audience.can(perm, branchId)` | من يملك الصلاحية + مدير الشركة. المقيَّد بفروع يصله حدث فرعه فقط (و`null` = غير المقيَّدين) |
| `Audience.employee(id)` / `employees(ids)` | الموظف عبر حساب دخوله (من لا حساب له لا يصله شيء) |
| `Audience.users(...)` · `admins()` · `all()` | حسابات بعينها · مديرو الشركة · الجميع |
| `branches` / `departments` | موظفو فروع أو أقسام |
| `Audience.systemAdmins()` | مالك المنصة (إشعار بلا شركة) |

`exclude` يستبعد من فعل الحدث: لا يُشعَر أحد بما فعله بنفسه.

**الأنواع** في `notification-types.ts` (المصدر الوحيد): الاسم، المجموعة
(طلبات، شؤون الموظفين، رواتب، حضور، مخزون، مبيعات ومشتريات، نقاط بيع،
محاسبة، اشتراك، نظام، رسائل)، الأيقونة، وهل يُكتم. الواجهة تقرؤها من
`GET /notifications/types`. رسائل الإدارة والترحيب والاشتراك لا تُكتم.

**أحداث الموديولات.** الموديول لا يعرف الإشعارات: يعلن ما حدث بعد الحفظ
(وبعد الـ commit) عبر `DomainEvents` (`common/events/domain-events.ts`)،
ومستمعات `listeners/` تحوّله لإشعار:

| الحدث | من يعلنه | يصل إلى |
|---|---|---|
| `leave.requested` · `advance.requested` · `loan.requested` · `resignation.submitted` | الإجازات، السلف، القروض، الاستقالات | من يملك اعتمادها في فرع الموظف (وللموظف إن سجّلته الإدارة باسمه) |
| `leave.decided` · `advance.decided` · `loan.decided` · `resignation.decided` | نفسها | صاحب الطلب |
| `resignation.cancelled` | الاستقالات | من يعتمدها |
| `bonus.approved` · `bonus.disbursed` · `deduction.activated` · `advance.disbursed` | المكافآت، الخصومات، السلف | الموظف |
| `payroll.disbursed` | مسير الرواتب | كل موظف بصافي راتبه |
| `settlement.confirmed` · `settlement.disbursed` | التسويات | الموظف |
| `employee.onboarded` | تهيئة الموظف | فريق التهيئة (`onboard_employee`) + ترحيب بالموظف إن أُنشئ له حساب |
| `contract.renewed` | العقود (امتداد تاريخ الانتهاء) | الموظف |
| `attendance.punch_changed` | الحضور (تعديل بصمة أو تسجيل يدوي) | الموظف، بالوقت السابق والجديد |
| `stock.transfer_sent` · `stock.transfer_received` | التحويلات | مستلمو فرع المخزن المستلِم · مرسلو فرع المرسِل (بالعجز إن وُجد) |
| `pos.shift_closed` (بفرق في الدرج) | نقاط البيع | `view_pos_audit` في فرع الجهاز |
| `tenant.registered` | التسجيل | مالك المنصة |
| `subscription.updated` | الاشتراكات (تجديد، تغيير باقة أو حالة) | مديرو الشركة |

**الفحوص الدورية (`scanners/`).** تعمل لكل شركة بتوقيتها، وكلها آمنة إن
تكررت (المفاتيح):

| الفحص | الجدول | القاعدة |
|---|---|---|
| انتهاء العقود والإقامات | كل 6 ساعات | مراحل 30، 14، 7، 3، 1 يوم، اليوم، ثم «انتهى» (حتى 7 أيام بعده). تنبيه للموظف بصيغة المخاطَب وآخر لمن يجدد (`update_contract` / `update_employee`). المفتاح يحمل التاريخ: التجديد يبدأ مراحل جديدة |
| انتهاء فترة التجربة | كل 6 ساعات | 14، 7، 1 يوم — لمن يجدد العقد فقط (قرار إداري) |
| انتهاء الاشتراك | كل 6 ساعات | 7، 3، 1 يوم، ثم «انتهى» — لمديري الشركة |
| نقص المخزون | كل 30 دقيقة | صنف بلغ حد إعادة الطلب: مرة عند بلوغه (مجمّع لكل مخزن) — لا يعود حتى يرتفع الرصيد ثم ينزل |
| جهاز بصمة منقطع | كل 30 دقيقة | ساعة بلا اتصال: مرة لكل انقطاع |
| أخطاء الترحيل المحاسبي | كل ساعة | مستندات تعذّر ترحيلها: مرة عند ظهورها |
| فواتير العملاء المتأخرة · مستحقات الموردين | كل 6 ساعات | كل فاتورة مرة (مجمّعة لكل فرع)، ويُمسح أثرها عند سدادها. الموردون: خلال 3 أيام أو فات موعدها |
| التنظيف | 3 فجراً | حذف ما انتهت مدة احتفاظه (180 يوماً لإشعارات النظام؛ رسائل الإدارة تبقى) |

«الحالات القائمة» (نقص، تأخر سداد، أخطاء ترحيل) تُحفظ في
`notification_alert_states`: يُنبَّه عند دخولها ويُحذف سطرها عند زوالها.
`POST /notifications/admin/run-checks` يشغّل كل الفحوص للشركة الآن.

**رسائل الإدارة.** لموظفين بعينهم (`create_notification`)، أو للجميع وفروع
وأقسام من مسار `broadcast` (`broadcast_notification` أيضاً). المقيَّد بفروع لا
يراسل خارجها. الخطورة: عادية / مهمة / عاجلة، و«يتطلب تأكيد الاطلاع» اختياري.
`preview` يقول كم سيصل ومن لا حساب له. المرسل يرى من قرأ ومن أكّد.

**صندوق المستخدم.** قائمته وعدّاد غير المقروء (إجمالي ولكل مجموعة)، القراءة
والتأكيد بصلاحية العرض وحدها (صندوقه هو)، والإخفاء بصلاحية الحذف. كتم الأنواع
من `PATCH /notifications/preferences`.

**البث اللحظي.** `GET /notifications/stream` (Server-Sent Events): الإشعار
الجديد يُكتب لكل تبويبات مستلميه فوراً، وأحداث `sync` تحدّث تبويبات المستخدم
الأخرى حين يقرأ أو يخفي. نبضة كل 25 ثانية وترويسة `X-Accel-Buffering: no`
تبقيانه حياً خلف nginx. الاتصالات في ذاكرة السيرفر: يكفي لنسخة واحدة (PM2
fork)؛ أكثر من نسخة يحتاج ناقلاً بينها (Redis pub/sub) في `NotificationStreamService.push`.

**إضافة إشعار جديد:**

1. نوع في `notification-types.ts` إن لم يوجد.
2. حدث في `DomainEventMap` ثم `this.events.emit(...)` في الخدمة بعد الحفظ —
   أو فاحص في `scanners/` إن كان حالة تُكتشف بمرور الوقت.
3. مستمع في `listeners/` يصوغ النص والتفاصيل ويختار الجمهور و`dedupeKey`.

## علاقته بباقي النظام

- يستمع لأحداث: الإجازات، السلف، القروض، الاستقالات، المكافآت، الخصومات،
  الرواتب، التسويات، الموظفين، العقود، الحضور، المخزون، نقاط البيع، التسجيل،
  والاشتراكات — ولا يستورد أياً منها.
- يقرأ (بلا كتابة) جداول الموظفين والعقود والأرصدة والفواتير وأجهزة البصمة
  وأخطاء الترحيل في فحوصه.

## صفحات الواجهة

- **الجرس** `NotificationBell` (الشريط العلوي): آخر الإشعارات، العدّاد، البث
  اللحظي، الصوت. الضغط يفتح التفاصيل.
- `/dashboard/notifications`: تبويبات (إشعاراتي · الرسائل المرسلة · كل إشعارات
  الشركة)، تصفية بالمجموعة وغير المقروء، درج التفاصيل، إرسال رسالة، وإعدادات
  الكتم.
- **صوت الإشعار الجديد**: خيار في قائمة الجرس «صوت عند وصول إشعار جديد»،
  **مقفل افتراضياً** ولكل جهاز. المحرك في `utils/sounds.ts` (نطاق
  `dashboard`) — انظر [../pos-screen.md](../pos-screen.md#الأصوات).

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/notifications/`
- الخدمات: `notification-audience.service.ts`، `notification-lookup.service.ts`، `notification-messages.service.ts`، `notification-preferences.service.ts`، `notification-stream.service.ts`، `notifications-admin.service.ts`، `notifications.service.ts`، `notifier.service.ts`، `alert-states.service.ts`، `notification-checks.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `notification_alert_states` | `NotificationAlertState` | `notification-alert-state.entity.ts` |
| `notification_preferences` | `NotificationPreference` | `notification-preference.entity.ts` |
| `notification_recipients` | `NotificationRecipient` | `notification-recipient.entity.ts` |
| `notifications` | `Notification` | `notification.entity.ts` |

### المسارات (23)

**الإشعارات** — `notification-messages.controller.ts` (القسم في Swagger: «الإشعارات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/notifications/messages/preview` | كم سيستلم الرسالة، ومن لن تصله لأنه بلا حساب دخول | إنشاء إشعار يدوي `create_notification` | — |
| POST | `/notifications/messages` | إرسال رسالة لموظفين بعينهم | إنشاء إشعار يدوي `create_notification` | — |
| POST | `/notifications/messages/broadcast` | إرسال رسالة جماعية: للجميع أو لموظفي فروع أو أقسام | إنشاء إشعار يدوي `create_notification` + إرسال إشعار جماعي `broadcast_notification` | — |
| GET | `/notifications/messages` | الرسائل المرسلة ونسبة من قرأها | إنشاء إشعار يدوي `create_notification` | — |
| GET | `/notifications/messages/:id/recipients` | مستلمو رسالة: من قرأ ومن أكّد الاطلاع | إنشاء إشعار يدوي `create_notification` | — |

**الإشعارات** — `notifications.controller.ts` (القسم في Swagger: «الإشعارات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/notifications` | إشعارات المستخدم الحالي (صفحات، وتصفية بالمجموعة أو النوع أو غير المقروء) | عرض الإشعارات `view_notifications` | — |
| GET | `/notifications/unread-count` | عدد غير المقروء (إجمالي ولكل مجموعة) | عرض الإشعارات `view_notifications` | — |
| GET | `/notifications/types` | أنواع الإشعارات ومجموعاتها (أسماؤها وأيقوناتها وهل تُكتم) | عرض الإشعارات `view_notifications` | — |
| GET | `/notifications/stream` | البث اللحظي (Server-Sent Events): إشعار جديد يصل فور إنشائه | عرض الإشعارات `view_notifications` | — |
| GET | `/notifications/preferences` | الأنواع التي كتمها المستخدم | عرض الإشعارات `view_notifications` | — |
| PATCH | `/notifications/preferences` | كتم أنواع / إلغاء كتمها (ما لا يُكتم يُرفض) | عرض الإشعارات `view_notifications` | — |
| POST | `/notifications/read` | تعليم إشعارات كمقروءة | عرض الإشعارات `view_notifications` | — |
| POST | `/notifications/read-all` | تعليم الكل كمقروء (أو مجموعة واحدة) | عرض الإشعارات `view_notifications` | — |
| POST | `/notifications/hide-read` | إخفاء كل المقروء من القائمة | حذف الإشعارات `delete_notification` | — |
| GET | `/notifications/admin/all` | كل إشعارات الشركة: من استلم كل إشعار ومن قرأه | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |
| GET | `/notifications/admin/stats` | إحصاءات إشعارات الشركة | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |
| POST | `/notifications/admin/run-checks` | تشغيل الفحوص الدورية للشركة الآن (انتهاء العقود، المخزون، الفواتير...) | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |
| GET | `/notifications/admin/:id/recipients` | مستلمو إشعار: من قرأ ومتى ومن أكّد الاطلاع | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |
| DELETE | `/notifications/admin/:id` | حذف إشعار نهائياً من عند كل مستلميه | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` + حذف الإشعارات `delete_notification` | — |
| GET | `/notifications/:id` | تفاصيل إشعار من إشعاراتي | عرض الإشعارات `view_notifications` | — |
| POST | `/notifications/:id/read` | تعليم إشعار كمقروء | عرض الإشعارات `view_notifications` | — |
| POST | `/notifications/:id/ack` | «تم الاطلاع» على رسالة تطلبه | عرض الإشعارات `view_notifications` | — |
| DELETE | `/notifications/:id` | إخفاء إشعار من قائمتي | حذف الإشعارات `delete_notification` | — |

<!-- AUTO:END -->
