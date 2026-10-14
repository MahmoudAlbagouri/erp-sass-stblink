# الإشعارات (`notifications`)

> إشعارات داخل النظام للمستخدمين، تُنشأ تلقائياً عند الأحداث أو يدوياً.

## الغرض

إبلاغ المستخدم بما يخصه (بصمته عُدّلت، حسابه أُنشئ، عقده يقترب من الانتهاء)، ولوحة للمديرين تعرض إشعارات الشركة كلها.

## المفاهيم والقواعد

- **من الخدمات**: الخدمة تستدعي `NotificationsService.create` عند الحدث. يفعل
  ذلك الآن: تعديل بصمة موظف أو تسجيلها يدوياً (`attendance`) وتهيئة موظف جديد
  (`employees`).
- **دورياً**: `ExpiryCheckStrategy` يفحص كل منتصف ليل العقود التي تنتهي خلال
  30 يوماً وينبّه أصحابها.
- **`@Notify`** + `NotificationInterceptor`: آلية جاهزة لإرسال إشعار بعد نجاح
  مسار (بلا انتظار، وفشلها لا يُفشل العملية) — لا مسار يستخدمها حالياً.
- **يدوياً**: `POST /notifications` لمن يملك صلاحية الإرسال، ولا يرسل لمستخدم في
  شركة أخرى.
- المستخدم يرى إشعاراته فقط ويعلّمها مقروءة أو يحذفها.
- **المديرون**: يرون إشعارات مستخدمي شركتهم (ومالك النظام يرى الكل) مع فلترة
  وإحصاءات.

## علاقته بباقي النظام

- يستدعيه `attendance` و`employees`. اعتماد الطلبات (سلف، إجازات…) لا يرسل
  إشعاراً بعد.

## صفحات الواجهة

- `/dashboard/notifications` + جرس الإشعارات `NotificationBell`.
- **صوت الإشعار الجديد**: خيار في قائمة الجرس «صوت عند وصول إشعار جديد»،
  **مقفل افتراضياً** ولكل جهاز. يُسمع حين يزيد غير المقروء في الفحص الدوري (كل
  دقيقة)، لا لما كان موجوداً عند فتح الصفحة. المحرك في `utils/sounds.ts` (نطاق
  `dashboard`) — انظر [../pos-screen.md](../pos-screen.md#الأصوات).

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/notifications/`
- الخدمات: `notifications.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `notifications` | `Notification` | `notification.entity.ts` |

### المسارات (10)

**الإشعارات** — `notifications.controller.ts` (القسم في Swagger: «الإشعارات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/notifications` | إشعارات المستخدم الحالي | عرض الإشعارات `view_notifications` | — |
| GET | `/notifications/unread-count` | عدد الإشعارات غير المقروءة | عرض الإشعارات `view_notifications` | — |
| POST | `/notifications/:id/read` | تعليم إشعار كمقروء | تحديث حالة الإشعار `update_notification_status` | — |
| POST | `/notifications/read-all` | تعليم كل الإشعارات كمقروءة | تحديث حالة الإشعار `update_notification_status` | — |
| DELETE | `/notifications/:id` | حذف إشعار | حذف الإشعارات `delete_notification` | — |
| POST | `/notifications` | إرسال إشعار لمستخدمين | إنشاء إشعار يدوي `create_notification` | — |
| GET | `/notifications/admin/all` | كل إشعارات الشركة (للمديرين) | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |
| GET | `/notifications/admin/stats` | إحصائيات الإشعارات (للمديرين) | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |
| POST | `/notifications/admin/:id/read` | تعليم إشعار أي مستخدم كمقروء (للمديرين) | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |
| DELETE | `/notifications/admin/:id` | حذف إشعار أي مستخدم (للمديرين) | عرض جميع إشعارات النظام (للمديرين) `view_all_notifications` | — |

<!-- AUTO:END -->
