# عروض الأسعار (`quotation`)

> عروض أسعار تُعتمد فتتحول إلى فاتورة، وتُصدَّر PDF.

## الغرض

إعداد عرض سعر لعميل، اعتماده، وتصديره هو وفاتورته PDF.

## المفاهيم والقواعد

- **خاص بمالك النظام**: صلاحياته كلها `system:`، وجدوله بلا معرّف شركة — ليس
  موديولاً للشركات المشتركة.
- الحالات: مسودة، مُرسل، معتمد، مرفوض.
- **الاعتماد** يحوّل العرض إلى فاتورة برقم (`INV-YYYY-0001`)، ولا يُعتمد مرتين.
- فاتورة PDF تُصدَّر للعرض المعتمد فقط.
- مستقل عن موديول المبيعات: لا يؤثر على المخزون ولا على حسابات العملاء.
- توليد الـ PDF عبر `quotation-pdf.service.ts` (puppeteer).

## علاقته بباقي النظام

- مستقل. لا يعتمد على `sales` ولا `catalog`.

## صفحات الواجهة

- `/dashboard/quotations`

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/quotation/`
- الخدمات: `quotation-pdf.service.ts`، `quotation.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `quotations` | `Quotation` | `quotation.entity.ts` |

### المسارات (8)

**عروض الأسعار** — `quotation.controller.ts` (القسم في Swagger: «عروض الأسعار»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/quotations` | إنشاء عرض سعر | إنشاء عرض سعر `system:create_quotation` | — |
| GET | `/quotations` | قائمة عروض الأسعار | عرض عروض الأسعار `system:view_quotations` | — |
| GET | `/quotations/:id` | عرض سعر واحد | عرض عروض الأسعار `system:view_quotations` | — |
| PATCH | `/quotations/:id` | تعديل عرض سعر | تعديل عرض السعر `system:update_quotation` | — |
| DELETE | `/quotations/:id` | حذف عرض سعر | حذف عرض السعر `system:delete_quotation` | — |
| GET | `/quotations/:id/pdf` | تصدير عرض السعر PDF | تصدير عرض السعر PDF `system:export_quotation_pdf` | — |
| PATCH | `/quotations/:id/approve` | اعتماد عرض سعر | الموافقة على عرض السعر `system:approve_quotation` | — |
| GET | `/quotations/:id/invoice-pdf` | تصدير فاتورة عرض السعر المعتمد PDF | تصدير عرض السعر PDF `system:export_quotation_pdf` | — |

<!-- AUTO:END -->
