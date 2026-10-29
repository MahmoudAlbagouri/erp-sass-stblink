#!/usr/bin/env node
// scripts/postman/generate.mjs
// يولّد Postman collection لكل الـ endpoints من الكود نفسه (الـ controllers
// والـ DTOs)، مجلد لكل موديول. أعد تشغيله بعد إضافة أو تعديل أي endpoint:
//
//   node scripts/postman/generate.mjs
//
// الناتج في docs/postman/:
//   STB-ERP.postman_collection.json    كل الطلبات
//   STB-ERP.postman_environment.json   المتغيرات (baseUrl، بيانات الدخول...)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "docs", "postman");

/** اسم كل موديول كما يظهر مجلداً في Postman */
const MODULE_LABELS = {
  auth: "Auth — المصادقة ووضع الدعم",
  users: "Users — المستخدمون",
  roles: "Roles — الأدوار",
  permissions: "Permissions — الصلاحيات",
  tenants: "Tenants — الشركات",
  plans: "Plans — الخطط",
  subscriptions: "Subscriptions — الاشتراكات",
  profile: "Profile — الملف الشخصي",
  notifications: "Notifications — الإشعارات",
  files: "Files — الملفات",
  quotation: "Quotations — عروض الأسعار",
  catalog: "Catalog — الأصناف",
  inventory: "Inventory — المخزون",
  purchasing: "Purchasing — المشتريات والموردون",
  sales: "Sales — المبيعات والعملاء",
  pos: "POS — نقاط البيع",
  employees: "Employees — الموظفون",
  departments: "Departments — الأقسام",
  contracts: "Contracts — العقود",
  salaries: "Salaries — الرواتب",
  payroll: "Payroll — مسير الرواتب",
  attendance: "Attendance — الحضور والانصراف",
  shifts: "Shifts — الورديات",
  leaves: "Leaves — الإجازات",
  advances: "Advances — السلف",
  loans: "Loans — القروض",
  bonuses: "Bonuses — المكافآت",
  deduction: "Deductions — الخصومات",
  resignations: "Resignations — الاستقالات",
  eos: "EOS — نهاية الخدمة",
  settlements: "Settlements — التسويات",
};

/** ترتيب المجلدات: المصادقة أولاً ثم الإدارة ثم التجارة ثم الموارد البشرية */
const MODULE_ORDER = Object.keys(MODULE_LABELS);

/** مسارات تستدعيها أجهزة البصمة نفسها (بلا توكن) */
const DEVICE_PREFIXES = ["/iclock", "/attendance-push"];

/** طلبات لا تحتاج توكن */
const PUBLIC_PATHS = new Set([
  "POST /auth/login",
  "POST /auth/register",
  "POST /auth/forgot-password",
  "POST /auth/reset-password",
]);

// ══════════════════════════ قراءة الملفات ══════════════════════════

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const files = walk(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8").replace(/\r\n/g, "\n")]));

// ─── فهرس الـ enums: الاسم ← أول قيمة ───
const enums = new Map();
for (const text of sources.values()) {
  for (const match of text.matchAll(/export enum (\w+)\s*\{([^}]*)\}/g)) {
    const first = match[2].match(/=\s*(['"])([^'"]*)\1/) ?? match[2].match(/=\s*(\d+)/);
    if (first) enums.set(match[1], first[2] ?? Number(first[1]));
  }
}

// ─── فهرس الـ DTO classes: الاسم ← { parent, props[] } ───
const classes = new Map();

/** يقطع جسم class من أول { حتى القوس المقابل */
const classBody = (text, from) => {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(from + 1, i);
  }
  return "";
};

for (const text of sources.values()) {
  const header = /export class (\w+)(?:\s+extends\s+([^{]+?))?\s*\{/g;
  for (const match of text.matchAll(header)) {
    const body = classBody(text, match.index + match[0].length - 1);
    const parentRaw = match[2]?.trim() ?? "";
    // PartialType(X) / OmitType(X, [...]) / PickType(X, [...]) ← X
    const parent = parentRaw.match(/\(\s*(\w+)/)?.[1] ?? parentRaw.match(/^(\w+)/)?.[1] ?? null;

    const props = [];
    // خاصية: مجموعة decorators ثم  name!?: type;
    const propPattern = /((?:\s*@\w+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*)+)\s*(?:readonly\s+)?(\w+)[!?]?:\s*([^;=]+)[;=]/g;
    for (const prop of body.matchAll(propPattern)) {
      props.push({ name: prop[2], decorators: prop[1], type: prop[3].trim() });
    }
    if (props.length || parent) classes.set(match[1], { parent, props });
  }
}

// ══════════════════════════ قيم نموذجية ══════════════════════════

/** معرّفات تُملأ من متغيرات البيئة ليسهل ربط الطلبات ببعضها */
const ID_VARIABLES = new Set([
  "tenantId", "productId", "warehouseId", "fromWarehouseId", "toWarehouseId",
  "customerId", "supplierId", "invoiceId", "deviceId", "shiftId", "employeeId",
  "roleId", "planId", "categoryId", "baseUnitId", "unitId", "taxRateId",
  "departmentId", "userId", "invoiceLineId",
]);

const STRING_HINTS = [
  [/email/i, "user@example.com"],
  [/password/i, "P@ssw0rd123"],
  [/phone|mobile/i, "0500000000"],
  [/taxNumber/i, "300000000000003"],
  [/iban/i, "SA0380000000608010167519"],
  [/^name$|nameAr|companyName|fullName|username/i, "اسم تجريبي"],
  [/nameEn/i, "Sample name"],
  [/barcode/i, "6281000000017"],
  [/^code$/, "POS1"],
  [/note|reason|description|address/i, ""],
];

const sampleFor = (prop, depth) => {
  const { name, decorators, type } = prop;
  const nested = decorators.match(/@Type\(\(\)\s*=>\s*(\w+)\)/)?.[1];
  const isArray = /@IsArray\(/.test(decorators) || /\[\]$/.test(type);

  let value;
  if (nested && nested !== "Number" && nested !== "Date" && nested !== "String") {
    value = depth < 3 ? sampleOf(nested, depth + 1) : {};
  } else if (/@IsUUID\(/.test(decorators)) {
    if (name === "uuid") value = "{{$guid}}";
    else value = ID_VARIABLES.has(name) ? `{{${name}}}` : "00000000-0000-4000-8000-000000000000";
  } else if (/@IsEnum\((\w+)/.test(decorators)) {
    value = enums.get(decorators.match(/@IsEnum\((\w+)/)[1]) ?? "";
  } else if (/@IsIn\(\[/.test(decorators)) {
    const first = decorators.match(/@IsIn\(\[\s*([^,\]]+)/)[1].trim();
    const literal = first.match(/^(['"])(.*)\1$/);
    value = literal ? literal[2] : enums.get(first.split(".")[0]) ?? "";
  } else if (/@IsBoolean\(/.test(decorators) || type === "boolean") {
    value = true;
  } else if (/@Is(Int|Number|Positive)\(/.test(decorators) || /^number\b/.test(type)) {
    value = /quantity|amount|price|cash|cost|salary|total/i.test(name) ? 100 : 1;
  } else if (/@IsEmail\(/.test(decorators)) {
    value = "user@example.com";
  } else if (/@IsDateString\(|DATE_ONLY|@IsDate\(/.test(decorators) || /date$|At$/i.test(name)) {
    value = /At$/.test(name) ? "2026-10-12T09:00:00.000Z" : "2026-10-12";
  } else if (/@IsObject\(/.test(decorators)) {
    value = {};
  } else {
    value = STRING_HINTS.find(([pattern]) => pattern.test(name))?.[1] ?? "";
  }
  return isArray ? [value] : value;
};

/** جسم طلب نموذجي من DTO (يشمل ما يرثه) */
const sampleOf = (className, depth = 0) => {
  const cls = classes.get(className);
  if (!cls) return {};
  const sample = cls.parent ? sampleOf(cls.parent, depth) : {};
  for (const prop of cls.props) sample[prop.name] = sampleFor(prop, depth);
  return sample;
};

// ══════════════════════════ قراءة الـ controllers ══════════════════════════

const HTTP = /@(Get|Post|Patch|Put|Delete)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g;

const endpoints = [];
for (const [file, text] of sources) {
  if (!file.endsWith(".controller.ts")) continue;
  const module = relative(join(SRC, "modules"), file).split(sep)[0];
  const base = text.match(/@Controller\(\s*(?:(['"`])([^'"`]*)\1)?\s*\)/)?.[2] ?? "";

  const marks = [...text.matchAll(HTTP)];
  marks.forEach((mark, index) => {
    // من الـ decorator حتى بداية الـ endpoint التالي: فيه التوقيع وباقي الـ decorators
    const chunk = text.slice(mark.index, marks[index + 1]?.index ?? text.length);
    const signature = chunk.match(/\n\s+(?:async\s+)?(\w+)\s*\(([\s\S]*?)\)\s*(?::\s*[^{]+)?\{/);
    if (!signature) return;

    // التعليق الذي يسبق مجموعة الـ decorators مباشرة = وصف الطلب
    const before = text.slice(0, mark.index);
    const stackStart = before.search(/(?:\n\s*@\w+\((?:[^()]|\([^()]*\))*\)\s*)*$/);
    const comment = before
      .slice(0, stackStart)
      .match(/(?:\/\*\*((?:(?!\*\/)[\s\S])*)\*\/|((?:\n[ \t]*\/\/[^\n]*)+))\s*$/);
    const description = (comment?.[1] ?? comment?.[2] ?? "")
      .split("\n")
      .map((line) => line.replace(/^\s*(\*|\/\/)\s?/, "").trim())
      .filter(Boolean)
      .join("\n");

    const params = signature[2];
    const path = "/" + [base, mark[3] ?? ""].filter(Boolean).join("/").replace(/\/+/g, "/");
    endpoints.push({
      module,
      method: mark[1].toUpperCase(),
      path: path === "/" ? "/" : path.replace(/\/$/, ""),
      handler: signature[1],
      description,
      bodyDto: params.match(/@Body\(\)\s+\w+:\s*(\w+)/)?.[1] ?? null,
      bodyFields: [...params.matchAll(/@Body\(\s*['"](\w+)['"]/g)].map((m) => m[1]),
      queryDto: params.match(/@Query\(\)\s+\w+:\s*(\w+)/)?.[1] ?? null,
      queryParams: [...params.matchAll(/@Query\(\s*['"](\w+)['"]/g)].map((m) => m[1]),
      permissions: [...chunk.slice(0, signature.index).matchAll(/PERMS\.(\w+)/g)].map((m) => m[1]),
      upload: /FileInterceptor|FilesInterceptor|UploadedFile/.test(chunk.slice(0, signature.index + signature[0].length)),
      order: mark.index,
      file,
    });
  });
}

// ══════════════════════════ أجسام مكتوبة يدوياً ══════════════════════════

/** قائمة عميل حقيقية (إن وُجد ملفها) كجسم جاهز لطلب الاستيراد */
const importList = (() => {
  try {
    const data = JSON.parse(readFileSync(join(ROOT, "scripts", "import", "jozoor-products.json"), "utf8"));
    return {
      defaultUnit: data.defaultUnit,
      items: data.categories.flatMap((category) =>
        category.items
          .filter((item) => item.price !== null && item.price !== undefined)
          .map((item) => ({
            name: item.name,
            category: category.name,
            ...(item.unit ? { unit: item.unit } : {}),
            salePrice: item.price,
          })),
      ),
    };
  } catch {
    return null;
  }
})();

const SAMPLE_ITEMS = [
  { name: "فلفل أبيض", category: "التوابل والبهارات", salePrice: 560 },
  { name: "كمون بلدي منحور", category: "التوابل والبهارات", salePrice: 250 },
  { name: "دستة بخور المدينة", category: "البخور والعطور", unit: "قطعة", salePrice: 320 },
];

const BODY_OVERRIDES = {
  "POST /auth/login": { email: "{{email}}", password: "{{password}}" },
  "POST /catalog/products/import": {
    defaultUnit: "كيلوجرام",
    priceIncludesTax: true,
    items: SAMPLE_ITEMS,
  },
  "POST /inventory/stock/import-products": {
    defaultUnit: importList?.defaultUnit ?? "كيلوجرام",
    priceIncludesTax: true,
    quantity: 200,
    items: importList?.items ?? SAMPLE_ITEMS,
  },
  "POST /pos/sync": {
    deviceId: "{{deviceId}}",
    operations: [
      {
        id: "open-1",
        type: "shift.open",
        payload: { id: "{{shiftId}}", openedAt: "2026-10-12T05:00:00.000Z", openingCash: 100, cashierName: "سالم" },
      },
    ],
  },
};

const DESCRIPTION_OVERRIDES = {
  "POST /auth/login": "يسجّل الدخول ويحفظ التوكن في متغيرات البيئة تلقائياً (accessToken / refreshToken)، فتعمل باقي الطلبات مباشرة.",
  "POST /inventory/stock/import-products":
    "استيراد أصناف مع رصيدها الافتتاحي في طلب واحد.\n\n" +
    "- `quantity`: الرصيد لكل صنف (يمكن تحديده لكل صنف داخل items).\n" +
    "- `costRatio`: تكلفة الوحدة كنسبة من سعر البيع (0.8 = 80%). بدونها يدخل الرصيد بلا تكلفة.\n" +
    "- `warehouseId`: اختياري، الافتراضي المخزن الرئيسي.\n" +
    "- آمن للتكرار: الصنف الموجود باسمه يُتخطى ولا يتضاعف رصيده.\n\n" +
    (importList ? `الجسم الجاهز هنا: قائمة جذور للعطارة (${importList.items.length} صنفاً) برصيد 200 لكل صنف.` : ""),
};

/** سكربت يحفظ التوكن بعد تسجيل الدخول */
const LOGIN_TEST = [
  "const body = pm.response.json();",
  "const tokens = body.data || body;",
  "if (tokens.accessToken) {",
  "  pm.environment.set('accessToken', tokens.accessToken);",
  "  pm.environment.set('refreshToken', tokens.refreshToken || '');",
  "  pm.collectionVariables.set('accessToken', tokens.accessToken);",
  "}",
];

// ══════════════════════════ بناء الـ collection ══════════════════════════

const queryOf = (endpoint) => {
  const names = new Set(endpoint.queryParams);
  const collect = (className) => {
    const cls = classes.get(className);
    if (!cls) return;
    if (cls.parent) collect(cls.parent);
    cls.props.forEach((prop) => names.add(prop.name));
  };
  if (endpoint.queryDto) collect(endpoint.queryDto);
  // معطّلة افتراضياً: تُفعَّل من Postman عند الحاجة
  return [...names].map((key) => ({
    key,
    value: key === "page" ? "1" : key === "limit" ? "25" : ID_VARIABLES.has(key) ? `{{${key}}}` : "",
    disabled: true,
  }));
};

const toRequest = (endpoint) => {
  const key = `${endpoint.method} ${endpoint.path}`;
  const segments = endpoint.path.split("/").filter(Boolean);
  const variables = segments
    .filter((s) => s.startsWith(":"))
    .map((s) => ({ key: s.slice(1), value: ID_VARIABLES.has(s.slice(1)) ? `{{${s.slice(1)}}}` : "" }));
  const query = queryOf(endpoint);

  const hasBody = ["POST", "PATCH", "PUT"].includes(endpoint.method);
  const body =
    BODY_OVERRIDES[key] ??
    (endpoint.bodyDto
      ? sampleOf(endpoint.bodyDto)
      : endpoint.bodyFields.length
        ? Object.fromEntries(endpoint.bodyFields.map((field) => [field, ""]))
        : null);

  const notes = [
    DESCRIPTION_OVERRIDES[key] ?? endpoint.description,
    endpoint.permissions.length ? `**الصلاحيات:** ${[...new Set(endpoint.permissions)].join("، ")}` : "",
    endpoint.upload ? "**رفع ملف:** هذا الطلب يستقبل `multipart/form-data` — غيّر الـ Body إلى form-data وأضف الملف." : "",
  ].filter(Boolean);

  const item = {
    name: `${endpoint.method} ${endpoint.path}`,
    request: {
      method: endpoint.method,
      header: hasBody && body ? [{ key: "Content-Type", value: "application/json" }] : [],
      url: {
        raw: `{{baseUrl}}${endpoint.path}`,
        host: ["{{baseUrl}}"],
        path: segments,
        ...(variables.length ? { variable: variables } : {}),
        ...(query.length ? { query } : {}),
      },
      description: notes.join("\n\n"),
    },
  };
  if (hasBody && body) {
    item.request.body = {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  if (PUBLIC_PATHS.has(key)) item.request.auth = { type: "noauth" };
  // أجهزة البصمة تتصل بلا جلسة: ZKTeco برقمها، وغيرها بمفتاح الجهاز
  if (DEVICE_PREFIXES.some((prefix) => endpoint.path.startsWith(prefix))) {
    item.request.auth = { type: "noauth" };
  }
  if (key === "POST /attendance-push/api") {
    item.request.header.push(
      { key: "X-Device-Id", value: "{{deviceId}}" },
      { key: "X-Device-Key", value: "{{deviceKey}}" },
    );
  }
  // تجديد الجلسة والخروج يُرسلان توكن التجديد لا توكن الوصول
  if (key === "POST /auth/refresh" || key === "POST /auth/logout") {
    item.request.auth = {
      type: "bearer",
      bearer: [{ key: "token", value: "{{refreshToken}}", type: "string" }],
    };
  }
  if (key === "POST /auth/login") {
    item.event = [{ listen: "test", script: { type: "text/javascript", exec: LOGIN_TEST } }];
  }
  return item;
};

const byModule = new Map();
for (const endpoint of endpoints) {
  if (!byModule.has(endpoint.module)) byModule.set(endpoint.module, []);
  byModule.get(endpoint.module).push(endpoint);
}

const moduleNames = [...byModule.keys()].sort((a, b) => {
  const ia = MODULE_ORDER.indexOf(a);
  const ib = MODULE_ORDER.indexOf(b);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
});

const folders = moduleNames.map((module) => {
  const list = byModule.get(module).sort((a, b) => a.file.localeCompare(b.file) || a.order - b.order);
  // تسجيل الدخول أول طلب في مجلد المصادقة
  if (module === "auth") {
    list.sort((a, b) => Number(b.path === "/auth/login") - Number(a.path === "/auth/login"));
  }
  return { name: MODULE_LABELS[module] ?? module, item: list.map(toRequest) };
});

const collection = {
  info: {
    name: "STB ERP API",
    description:
      "كل endpoints النظام، مجلد لكل موديول. مولَّدة من الكود (scripts/postman/generate.mjs).\n\n" +
      "**البدء:** اختر الـ environment، اكتب `email` و `password`، ثم شغّل `POST /auth/login` من مجلد Auth — " +
      "يُحفظ التوكن تلقائياً وتعمل باقي الطلبات.\n\n" +
      "**ملاحظة:** الموديولات التجارية (الأصناف، المخزون، المشتريات، المبيعات، الكاشير) تحتاج حساب شركة. " +
      "مالك النظام يدخل الشركة أولاً بـ `POST /auth/support/:tenantId` ويستخدم التوكن الناتج.\n\n" +
      "أجسام الطلبات قيم نموذجية مولَّدة من الـ DTO: عدّلها قبل الإرسال، واحذف الحقول الاختيارية التي لا تحتاجها.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }] },
  variable: [{ key: "accessToken", value: "" }],
  item: folders,
};

const environment = {
  name: "STB ERP — Local",
  values: [
    { key: "baseUrl", value: "http://localhost:3003", enabled: true },
    { key: "email", value: "", enabled: true },
    { key: "password", value: "", type: "secret", enabled: true },
    { key: "accessToken", value: "", type: "secret", enabled: true },
    { key: "refreshToken", value: "", type: "secret", enabled: true },
    // مفتاح جهاز بصمة (Hikvision / API) كما ظهر عند إضافته
    { key: "deviceKey", value: "", type: "secret", enabled: true },
    ...[...ID_VARIABLES].map((key) => ({ key, value: "", enabled: true })),
  ],
  _postman_variable_scope: "environment",
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "STB-ERP.postman_collection.json"), JSON.stringify(collection, null, 2) + "\n");
writeFileSync(join(OUT, "STB-ERP.postman_environment.json"), JSON.stringify(environment, null, 2) + "\n");

console.log(`endpoints: ${endpoints.length} في ${folders.length} مجلداً`);
for (const folder of folders) console.log(`  ${String(folder.item.length).padStart(3)}  ${folder.name}`);
const noBody = endpoints.filter((e) => ["POST", "PATCH", "PUT"].includes(e.method) && e.bodyDto && !classes.has(e.bodyDto));
if (noBody.length) console.log(`\nDTO غير معروف (جسم فارغ): ${[...new Set(noBody.map((e) => e.bodyDto))].join(", ")}`);
