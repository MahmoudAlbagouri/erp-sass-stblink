# الصلاحيات (`permissions`)

> قائمة صلاحيات النظام، تُكتشف تلقائياً من الكود.

## الغرض

كل عملية حساسة لها صلاحية باسم ثابت (`create_user`، `issue_sales`…). هذا
الموديول يحفظ القائمة لتُسند للأدوار.

## المفاهيم والقواعد

- **المصدر الوحيد**: `common/constants/permissions.ts` (`PERMS`) — اسم إنجليزي
  ثابت + اسم عربي للعرض. مرآتها في الواجهة `utils/access.ts`.
- **الاكتشاف التلقائي**: عند تشغيل النظام يقرأ `PermissionDiscoveryService` كل
  `@Permissions(...)` على المسارات وينشئ ما ليس موجوداً في الجدول. إضافة صلاحية
  = إضافتها في `PERMS` ووضعها على مسار.
- **النطاق**: ما يبدأ بـ `system:` محجوز لمالك النظام وموظفيه، والباقي للشركات.
- **`PermissionsGuard`**: مالك النظام يمرّ دائماً؛ مدير الشركة يمرّ إلا في صلاحيات
  `system:`؛ الموظف يجب أن يحمل دوره **كل** الصلاحيات المطلوبة على المسار.
- صلاحية المسار تظهر في Swagger تلقائياً (وصف كل مسار).

## علاقته بباقي النظام

- يستخدمه `roles`. تعتمد عليه كل المسارات المحمية.

## صفحات الواجهة

- `/dashboard/permissions`
- في الواجهة: `v-can="'اسم_الصلاحية'"` يخفي الزر عمّن لا يملكها.

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/permissions/`
- الخدمات: `permission-core.service.ts`، `permission-discovery.service.ts`، `permissions.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `permissions` | `Permission` | `permission.entity.ts` |

### المسارات (5)

**الصلاحيات** — `permissions.controller.ts` (القسم في Swagger: «الصلاحيات»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/permissions` | إضافة صلاحية | إنشاء صلاحية جديدة `create_permission` | — |
| GET | `/permissions` | قائمة الصلاحيات | عرض قائمة الصلاحيات `view_permissions` | — |
| GET | `/permissions/:id` | صلاحية واحدة | عرض قائمة الصلاحيات `view_permissions` | — |
| PATCH | `/permissions/:id` | تعديل صلاحية | تعديل صلاحية `update_permission` | — |
| DELETE | `/permissions/:id` | حذف صلاحية | حذف صلاحية `delete_permission` | — |

<!-- AUTO:END -->
