// src/config/swagger.config.ts
// توثيق الـ API التفاعلي (Swagger UI) على ‎/docs‎ وملف OpenAPI على ‎/docs-json‎.
//
// أغلب التوثيق يُستخرج من الكود نفسه، فلا يُكتب مرتين:
// - الحقول وأنواعها وقيودها: من الـ DTOs (إضافة @nestjs/swagger في nest-cli.json).
// - عنوان المسار: من تعليق ‎/** */‎ فوق دالته، وإلا من اسم صلاحيته العربي.
// - الصلاحية وميزة الباقة وحدّها: من ‎@Permissions‎ و‎@RequiresFeature‎
//   و‎@CheckQuota‎ نفسها (تُكتب في وصف كل مسار — انظر describeAccess).
//
// عند إضافة موديول: أضف ‎@ApiTags‎ على الـ controller، وسطراً في API_TAGS هنا.
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { QUOTA_EXTENSION } from '../common/decorators/check-quota.decorator';
import { PERMISSIONS_EXTENSION } from '../common/decorators/permissions.decorator';
import { FEATURE_EXTENSION } from '../common/decorators/requires-feature.decorator';
import {
  DRIVER_AGENT_HEADER,
  DRIVER_KEY_HEADER,
} from '../modules/delivery/delivery.constants';
import {
  POS_DEVICE_HEADER,
  POS_INSTALLATION_HEADER,
  POS_KEY_HEADER,
} from '../modules/pos/pos.constants';

export const SWAGGER_PATH = 'docs';

/**
 * أقسام التوثيق بترتيب ظهورها. الاسم هو نفسه ما يُكتب في ‎@ApiTags‎.
 * شرح كل موديول بالتفصيل في docs/modules.
 */
export const API_TAGS = {
  // ─── النظام ───
  AUTH: ['المصادقة', 'تسجيل شركة جديدة، الدخول، تجديد الجلسة، كلمة المرور'],
  SUPPORT: ['وضع الدعم', 'دخول مالك النظام إلى شركة لمساعدتها'],
  TENANTS: ['الشركات', 'بيانات الشركات (لمالك النظام) وإعدادات شركة المستخدم'],
  PLANS: ['الخطط', 'باقات الاشتراك: مميزاتها وحدودها'],
  SUBSCRIPTIONS: ['الاشتراكات', 'اشتراك الشركة وما يتيحه، والتجديد والإلغاء'],
  USERS: ['المستخدمون', 'حسابات الدخول وأدوارها وفروعها'],
  ROLES: ['الأدوار', 'المسميات الوظيفية وما تحمله من صلاحيات'],
  PERMISSIONS: ['الصلاحيات', 'قائمة صلاحيات النظام'],
  BRANCHES: ['الفروع', 'فروع الشركة: مخازنها وموظفوها وأجهزتها'],
  DASHBOARD: ['الصفحة الرئيسية', 'أرقام وتحليلات الصفحة الرئيسية في طلب واحد'],
  PROFILE: ['الملف الشخصي', 'بيانات المستخدم الحالي كموظف'],
  NOTIFICATIONS: ['الإشعارات', 'إشعارات المستخدم وإرسالها'],
  FILES: ['الملفات', 'رفع المرفقات وفتحها بروابط موقَّعة مؤقتة'],

  // ─── الأصناف والمخزون ───
  PRODUCTS: ['الأصناف', 'المنتجات والخدمات وأسعارها وباركوداتها'],
  CATALOG_SETTINGS: ['إعدادات الأصناف', 'التصنيفات والوحدات والضرائب'],
  WAREHOUSES: ['المخازن', 'مخازن الشركة وفروعها'],
  STOCK: ['أرصدة المخزون', 'الأرصدة والحركات والتسويات والرصيد الافتتاحي'],
  TRANSFERS: ['تحويلات المخزون', 'نقل البضاعة بين المخازن'],
  STOCKTAKES: ['الجرد', 'جرد المخزن ومطابقته'],

  // ─── المشتريات ───
  SUPPLIERS: ['الموردون', 'الموردون وأرصدتهم وكشف حسابهم'],
  PURCHASE_INVOICES: ['فواتير الشراء', 'فواتير الشراء واعتمادها'],
  PURCHASE_RETURNS: ['مرتجعات الشراء', 'إرجاع بضاعة للمورد'],
  SUPPLIER_PAYMENTS: ['سداد الموردين', 'ما يُدفع للموردين'],

  // ─── المبيعات ───
  CUSTOMERS: ['العملاء', 'العملاء وأرصدتهم وكشف حسابهم، وإعدادات الفوترة'],
  SALES_INVOICES: ['فواتير البيع', 'فواتير البيع وإصدارها'],
  SALES_RETURNS: ['مرتجعات البيع', 'إرجاع بضاعة من العميل'],
  CUSTOMER_PAYMENTS: ['مقبوضات العملاء', 'ما يُقبض من العملاء'],
  QUOTATIONS: ['عروض الأسعار', 'عروض الأسعار وتصديرها PDF'],

  // ─── نقاط البيع ───
  POS: ['نقاط البيع', 'أجهزة الكاشير والكاشيرات والورديات (بجلسة مستخدم)'],
  DELIVERY: [
    'التوصيل والشحن',
    'أوردرات التوصيل، الطيارون وشركات الشحن، المناطق، والتسويات',
  ],
  DELIVERY_DRIVER: [
    'شاشة الطيار',
    'ما تستدعيه شاشة الطيار على جواله برابطه، بلا جلسة مستخدم',
  ],
  POS_DEVICE: [
    'شاشة الكاشير',
    'ما تستدعيه شاشة الكاشير بهوية الجهاز، بلا جلسة مستخدم (انظر docs/pos-offline.md)',
  ],

  // ─── المحاسبة ───
  ACCOUNTING: [
    'المحاسبة',
    'شجرة الحسابات، القيود (اليدوية والمرحّلة من المستندات)، قفل الفترات، والقوائم المالية',
  ],

  // ─── الموارد البشرية ───
  EMPLOYEES: ['الموظفون', 'ملفات الموظفين وتهيئتهم وتصديرهم'],
  DEPARTMENTS: ['الأقسام', 'أقسام الشركة'],
  SHIFTS: ['أوقات الدوام', 'ورديات العمل التي يُقاس عليها الحضور'],
  CONTRACTS: ['العقود', 'عقود الموظفين'],
  SALARIES: ['الرواتب', 'راتب كل موظف وبدلاته'],
  PAYROLL: ['مسير الرواتب', 'إعداد مسير الشهر واعتماده وصرفه'],
  ADVANCES: ['السلف', 'سلف الموظفين'],
  LOANS: ['القروض', 'قروض الموظفين وأقساطها'],
  BONUSES: ['المكافآت', 'مكافآت الموظفين'],
  DEDUCTIONS: ['الخصومات', 'خصومات الموظفين'],
  LEAVES: ['الإجازات', 'طلبات الإجازة وأرصدتها'],
  RESIGNATIONS: ['الاستقالات', 'طلبات الاستقالة'],
  EOS: ['نهاية الخدمة', 'مكافأة نهاية الخدمة'],
  SETTLEMENTS: ['التسويات', 'تسوية الإجازات والمستحقات'],
  ATTENDANCE: ['الحضور والانصراف', 'سجلات الحضور وتقاريره وأجهزة البصمة'],
  ADMS: [
    'أجهزة البصمة (ADMS)',
    'بروتوكول ZKTeco: تستدعيه أجهزة البصمة نفسها، لا الواجهة',
  ],
} as const satisfies Record<
  string,
  readonly [name: string, description: string]
>;

/** اسم القسم كما يُمرَّر إلى ‎@ApiTags‎ */
export const apiTag = (key: keyof typeof API_TAGS): string => API_TAGS[key][0];

const DESCRIPTION = `
واجهة برمجة نظام **STB ERP** (موارد بشرية + أصناف ومخزون + مشتريات + مبيعات + نقاط بيع)، متعدد الشركات.

**المصادقة:** سجّل الدخول من \`POST /auth/login\`، ثم اضغط **Authorize** وضع الـ \`accessToken\`.
صلاحية التوكن 15 دقيقة؛ جدّده من \`POST /auth/refresh\`.

**شكل الاستجابة:** كل استجابة ناجحة تُغلَّف هكذا، والنوع المعروض مع كل مسار هو محتوى \`data\`:

\`\`\`json
{ "success": true, "message": "...", "statusCode": 200, "data": { } }
\`\`\`

**الوصول:** وصف كل مسار يذكر الصلاحية المطلوبة وميزة الباقة وحدّها. مدير الشركة يملك كل
الصلاحيات، والمستخدم المقيَّد بفروع لا يرى بيانات غيرها (انظر docs/branches.md).

**أكواد شائعة:** \`400\` بيانات غير صالحة · \`401\` بلا جلسة · \`402\` الاشتراك غير فعّال ·
\`403\` بلا صلاحية أو خارج الباقة أو تجاوز حدّها · \`404\` غير موجود (أو خارج فروع المستخدم) · \`409\` تعارض.

الشرح الكامل لكل موديول في مجلد \`docs/\` بالمشروع.
`.trim();

const BEARER = 'bearer';
const POS_DEVICE = 'pos-device';
const POS_KEY = 'pos-key';
const POS_INSTALLATION = 'pos-installation';
const DRIVER_AGENT = 'driver-agent';
const DRIVER_KEY = 'driver-key';

/** مسارات بلا جلسة مستخدم: يُزال عنها قفل التوكن في Swagger */
const PUBLIC_PATHS = [
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
];
const ADMS_PREFIX = '/iclock';
const POS_DEVICE_PREFIX = '/pos/device';
const DRIVER_PREFIX = '/delivery/driver';

interface AccessLabel {
  name: string;
  labelAr: string;
}

interface DocumentedOperation {
  summary?: string;
  description?: string;
  security?: Record<string, string[]>[];
  [extension: string]: unknown;
}

/** الصلاحية والميزة والحد كسطور تُضاف لوصف المسار */
function describeAccess(operation: DocumentedOperation): string {
  const permissions =
    (operation[PERMISSIONS_EXTENSION] as AccessLabel[] | undefined) ?? [];
  const feature = operation[FEATURE_EXTENSION] as AccessLabel | undefined;
  const quota = operation[QUOTA_EXTENSION] as string | undefined;

  const lines: string[] = [];
  if (permissions.length) {
    const list = permissions
      .map((p) => `${p.labelAr} (\`${p.name}\`)`)
      .join(' + ');
    // أكثر من صلاحية = كلها مطلوبة معاً (انظر PermissionsGuard)
    lines.push(`**الصلاحية:** ${list}`);
  }
  if (feature) {
    lines.push(`**ميزة الباقة:** ${feature.labelAr} (\`${feature.name}\`)`);
  }
  if (quota) lines.push(`**حد الباقة:** \`${quota}\``);
  return lines.join('\n\n');
}

/**
 * يكمل المستند مما في الكود: وصف الوصول لكل مسار، عنوان من اسم الصلاحية للمسار
 * الذي لا تعليق فوقه، ونوع المصادقة الصحيح لكل مجموعة مسارات.
 */
function enrich(document: OpenAPIObject): OpenAPIObject {
  for (const [path, item] of Object.entries(document.paths)) {
    for (const operation of Object.values(item) as DocumentedOperation[]) {
      if (!operation || typeof operation !== 'object') continue;

      const access = describeAccess(operation);
      if (access) {
        operation.description = [operation.description, access]
          .filter(Boolean)
          .join('\n\n');
      }
      const [permission] =
        (operation[PERMISSIONS_EXTENSION] as AccessLabel[] | undefined) ?? [];
      operation.summary ||= permission?.labelAr;

      if (path.startsWith(POS_DEVICE_PREFIX)) {
        operation.security = [
          { [POS_DEVICE]: [], [POS_KEY]: [], [POS_INSTALLATION]: [] },
        ];
      } else if (path.startsWith(DRIVER_PREFIX)) {
        operation.security = [{ [DRIVER_AGENT]: [], [DRIVER_KEY]: [] }];
      } else if (path.startsWith(ADMS_PREFIX) || PUBLIC_PATHS.includes(path)) {
        operation.security = [];
      }
    }
  }
  return document;
}

/** التوثيق مفتوح خارج الإنتاج؛ في الإنتاج يُفتح صراحةً بـ SWAGGER_ENABLED=true */
export function isSwaggerEnabled(): boolean {
  const flag = process.env.SWAGGER_ENABLED;
  if (flag) return flag === 'true';
  return process.env.NODE_ENV !== 'production';
}

export function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('STB ERP API')
    .setDescription(DESCRIPTION)
    .setVersion(process.env.npm_package_version ?? '1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      BEARER,
    )
    .addSecurityRequirements(BEARER)
    .addApiKey(
      { type: 'apiKey', in: 'header', name: POS_DEVICE_HEADER },
      POS_DEVICE,
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: POS_KEY_HEADER }, POS_KEY)
    .addApiKey(
      { type: 'apiKey', in: 'header', name: POS_INSTALLATION_HEADER },
      POS_INSTALLATION,
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: DRIVER_AGENT_HEADER },
      DRIVER_AGENT,
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: DRIVER_KEY_HEADER },
      DRIVER_KEY,
    );
  for (const [name, description] of Object.values(API_TAGS)) {
    builder.addTag(name, description);
  }

  const document = enrich(SwaggerModule.createDocument(app, builder.build()));

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    customSiteTitle: 'STB ERP API',
    swaggerOptions: {
      // التوكن يبقى بعد تحديث الصفحة
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
    },
  });
}
