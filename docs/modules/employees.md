# الموظفون (`employees`)

> ملف الموظف وكل ما يتفرع عنه، وتهيئة موظف جديد دفعة واحدة.

## الغرض

سجل موظفي الشركة. ملف الموظف هو المحور الذي ترتبط به العقود والرواتب
والإجازات والسلف والحضور.

## المفاهيم والقواعد

- **كود الموظف** يُولَّد تلقائياً وفريد. **رقم الهوية** لا يتكرر داخل الشركة.
- **الحالة**: نشط، غير نشط، منتهي الخدمة. المسير والحضور يحسبان النشطين فقط.
- **الجنسية**: سعودي، غير سعودي (له تاريخ انتهاء إقامة)، خارج الكفالة — تصنيف
  خاص بالسعودية.
- **الفرع**: كل موظف يتبع فرعاً (الرئيسي إن لم يُحدَّد). المقيَّد بفروع يرى
  موظفي فروعه فقط.
- **القسم** و**وقت الدوام** علاقتان اختياريتان.
- **المؤهلات** (`educations`) تُحفظ مع الملف.
- **حساب المستخدم**: الموظف قد يرتبط بمستخدم واحد فيدخل ويرى ملفه ويقدّم طلباته.
- **التهيئة** (`POST /employees/onboard`): في معاملة واحدة تنشئ الملف، وحساب
  الدخول ودوره (جديد أو موجود)، والعقد، والراتب. فشل أي جزء يلغي الكل. (القسم
  ووقت الدوام الجديدان ينشئهما معالج الواجهة قبلها بطلبين مستقلين.)
- **الفلترة** على السيرفر (قسم، فرع، وردية، حالة، له حساب، له عقد، إقامة تنتهي
  خلال 60 يوماً، بحث) وتصدير نتيجتها excel أو pdf.
- الحذف منطقي. حد الباقة: `max_employees`.

## علاقته بباقي النظام

- يرتبط به: `contracts`، `salaries`، `leaves`، `advances`، `loans`،
  `bonuses`، `deduction`، `eos`، `settlements`، `resignations`، `attendance`،
  `payroll`.
- يعتمد على `departments`، `shifts`، `branches`، `users`، `roles`.

## صفحات الواجهة

- `/dashboard/employees` — القائمة والفلترة والتعديل.
- `/dashboard/employees/[id]` — ملف الموظف الكامل.
- `components/employees/OnboardingModal.vue` — معالج التهيئة.

## المرجع

<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->

### الملفات

- المجلد: `src/modules/employees/`
- الخدمات: `employees-onboarding.service.ts`، `employees.service.ts`

### جداول قاعدة البيانات

| الجدول | الكيان | الملف |
|---|---|---|
| `employee_educations` | `Education` | `education.entity.ts` |
| `employees` | `Employee` | `employee.entity.ts` |

### المسارات (10)

**الموظفون** — `employees.controller.ts` (القسم في Swagger: «الموظفون»)

| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |
|---|---|---|---|---|
| POST | `/employees/onboard` | تهيئة موظف جديد دفعة واحدة: ملفه، حسابه، عقده، راتبه | تشغيل موظف جديد (Onboarding) `onboard_employee` | موديول الموظفين `employees_module` · حد: `max_employees` |
| POST | `/employees` | إضافة موظف | إضافة موظف `create_employee` | موديول الموظفين `employees_module` · حد: `max_employees` |
| GET | `/employees/filter` | قائمة الموظفين بفلترة متقدمة (قسم، فرع، وردية، حالة…) | عرض الموظفين `view_employees` | موديول الموظفين `employees_module` |
| GET | `/employees/export-filtered/:type` | تصدير نتائج الفلترة (excel أو pdf) | تصدير تقرير الموظفين `export_employees` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/employees/export/:type` | تصدير كل الموظفين (excel أو pdf) | تصدير تقرير الموظفين `export_employees` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/employees/:id/export/:type` | تصدير ملف موظف واحد (excel أو pdf) | تصدير تقرير الموظفين `export_employees` | تصدير التقارير (Excel / PDF) `reports_export` |
| GET | `/employees` | قائمة الموظفين | عرض الموظفين `view_employees` | موديول الموظفين `employees_module` |
| GET | `/employees/:id` | ملف موظف كامل: عقده، رواتبه، سلفه، إجازاته… | عرض الموظفين `view_employees` | موديول الموظفين `employees_module` |
| PATCH | `/employees/:id` | تعديل موظف | تعديل بيانات الموظف `update_employee` | موديول الموظفين `employees_module` |
| DELETE | `/employees/:id` | حذف موظف | حذف موظف `delete_employee` | موديول الموظفين `employees_module` |

<!-- AUTO:END -->
