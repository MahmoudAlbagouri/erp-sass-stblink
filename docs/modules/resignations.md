# الاستقالات (`resignations`)

> طلب استقالة يقدّمه الموظف وتبتّ فيه الإدارة.

## الغرض

مسار رسمي للاستقالة: طلب، قرار، وتاريخ آخر يوم عمل.

## المفاهيم والقواعد

- الموظف يقدّم طلبه بنفسه (`my-request`) ويسحبه ما دام معلّقاً.
- طلب معلّق واحد لكل موظف، وآخر يوم عمل لا يكون في الماضي.
- الإدارة تقبل أو ترفض (`decision`)، ولا يُبتّ في طلب سبق البتّ فيه.
- قبول الاستقالة لا يحسب نهاية الخدمة تلقائياً: تُسجَّل من `eos`.

## علاقته بباقي النظام

- يتبعه يدوياً: `eos` و`settlements`.

## صفحات الواجهة

- `/dashboard/resignations`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/resignations/`
- الخدمات: `resignations.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `resignation_requests` | `ResignationRequest` | `resignation.entity.ts` |

### المسارات (6)

**الاستقالات** — `resignations.controller.ts` (القسم في Swagger: «الاستقالات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| GET | `/resignations/my-requests` | طلبات استقالة الموظف الحالي | تقديم طلب استقالة ذاتي `request_resignation_self` | موديول الاستقالات `resignations_module` |
| POST | `/resignations/my-request` | تقديم طلب استقالة | تقديم طلب استقالة ذاتي `request_resignation_self` | موديول الاستقالات `resignations_module` |
| POST | `/resignations/my-request/cancel` | سحب طلب الاستقالة المعلَّق | تقديم طلب استقالة ذاتي `request_resignation_self` | موديول الاستقالات `resignations_module` |
| POST | `/resignations/:id/decision` | قبول طلب استقالة أو رفضه | اتخاذ قرار بشأن الاستقالات (اعتماد/رفض) `approve_resignation` | موديول الاستقالات `resignations_module` |
| GET | `/resignations` | قائمة طلبات الاستقالة | عرض جميع طلبات الاستقالة `view_all_resignations` | موديول الاستقالات `resignations_module` |
| GET | `/resignations/:id` | طلب استقالة واحد | عرض جميع طلبات الاستقالة `view_all_resignations` | موديول الاستقالات `resignations_module` |

<!-- AUTO:END -->
