# الاشتراكات (`subscriptions`)

> اشتراك الشركة في باقة: حالته، مدته، وفرض مميزات الباقة وحدودها.

## الغرض

يحدد ما يحق للشركة استخدامه الآن. منه يعرف الباك إند هل يقبل الطلب، وتعرف
الواجهة أي الصفحات تعرض وأيها تقفل.

## المفاهيم والقواعد

- **الحالات**: تجريبي `trial`، فعّال `active`، منتهٍ `expired`، ملغي `cancelled`،
  موقوف يدوياً `suspended`، بانتظار التفعيل `pending`.
- **`SubscriptionGuard`** (في `common/guards`): يتحقق أن للشركة اشتراكاً فعّالاً،
  ثم الميزة المطلوبة (`@RequiresFeature`)، ثم الحد (`@CheckQuota`). مالك النظام
  يتجاوزه.
- **`SubscriptionManagerService`**: `hasFeature`، `checkQuota`،
  `assertQuotaAvailable`، و`getUsageSummary` (الاستهلاك مقابل الحد).
- **`GET /subscriptions/me/access`**: ما تحتاجه الواجهة لرسم نفسها — المميزات
  المفعّلة والحدود واستهلاكها. يكفيه تسجيل الدخول.
- **عدّادات الحدود**: كل موديول يسجّل عدّاده بـ `@QuotaResolverFor('max_x')`
  فيجمعها `QuotaRegistryService`.
- تغيير الباقة والتجديد والإيقاف والإلغاء لمالك النظام.
- شاشة الكاشير تتلقى `402` إذا توقف اشتراك الشركة (انظر `docs/pos-offline.md`).

## علاقته بباقي النظام

- يعتمد على `plans`. تعتمد عليه كل الموديولات المحمية بميزة أو حد.
- `dashboard` يسأله `hasFeature` ليُسقط الأقسام خارج الباقة.

## صفحات الواجهة

- `/dashboard/subscription` — اشتراك شركتي.
- `/dashboard/admin/subscriptions` — إدارة التجديدات (مالك النظام).
- `stores/access.ts` + المكوّن `FeatureGate` والتوجيهان `v-can` و`v-quota`.

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/subscriptions/`
- الخدمات: `quota-registry.service.ts`، `subscription-manager.service.ts`، `subscriptions.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `subscriptions` | `Subscription` | `subscription.entity.ts` |

### المسارات (7)

**الاشتراكات** — `subscriptions.controller.ts` (القسم في Swagger: «الاشتراكات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/subscriptions/me/access` | ✅ بيانات الوصول التي تحتاجها الواجهة لإظهار/قفل الموديولات والأزرار: المميزات المفعّلة + حدود الاستخدام. متاحة لأي مستخدم مسجّل (بدون صلاحية خاصة) لأن كل الواجهة تعتمد عليها، ولا تكشف بيانات مالية عن الاشتراك. | — | — |
| GET | `/subscriptions/me` | اشتراك شركتي الحالي وباقته | عرض اشتراكي الحالي `subscriptions:view-own` | — |
| GET | `/subscriptions/tenant/:tenantId` | اشتراك شركة (لمالك النظام) | عرض جميع الاشتراكات `system:subscriptions:view-any` | — |
| POST | `/subscriptions/tenant/:tenantId/change-plan` | تغيير باقة شركة | إدارة الاشتراكات (ترقية/تجديد/إلغاء) `system:subscriptions:manage` | — |
| POST | `/subscriptions/tenant/:tenantId/status` | تغيير حالة اشتراك شركة (تفعيل، إيقاف…) | إدارة الاشتراكات (ترقية/تجديد/إلغاء) `system:subscriptions:manage` | — |
| POST | `/subscriptions/tenant/:tenantId/renew` | تجديد اشتراك شركة | إدارة الاشتراكات (ترقية/تجديد/إلغاء) `system:subscriptions:manage` | — |
| POST | `/subscriptions/tenant/:tenantId/cancel` | إلغاء اشتراك شركة | إدارة الاشتراكات (ترقية/تجديد/إلغاء) `system:subscriptions:manage` | — |

<!-- AUTO:END -->
