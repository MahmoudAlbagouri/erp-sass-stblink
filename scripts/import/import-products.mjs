!/usr/bin/env node
// scripts/import/import-products.mjs
// استيراد أصناف (بتصنيفاتها وأسعارها) ورصيد افتتاحي لشركة، عبر الـ API نفسه —
// فيمرّ بكل قواعد النظام (عزل الشركات، حدّ الخطة، التحقق، متوسط التكلفة).
//
// الاستخدام:
//   node scripts/import/import-products.mjs <ملف.json> --api <عنوان الـ API> \
//        --email <بريد مدير الشركة> --password <كلمة المرور> [خيارات]
//
// بدون ‎--apply‎ يعرض ما سيفعله فقط ولا يكتب شيئاً.
//
// الخيارات:
//   --apply                 نفّذ فعلاً (الافتراضي: معاينة فقط)
//   --quantity <n>          الرصيد الافتتاحي لكل صنف في المخزن الرئيسي (الافتراضي 0 = بلا رصيد)
//   --cost-ratio <0..1>     تكلفة الوحدة = السعر × النسبة (الافتراضي: بلا تكلفة)
//   --price-excludes-tax    الأسعار قبل الضريبة (الافتراضي: شاملة)
//   --tax <اسم الضريبة>     ضريبة الأصناف (الافتراضي: ضريبة الشركة الافتراضية)
//   --include-unpriced      استورد الأصناف التي بلا سعر بسعر 0 (الافتراضي: تُتخطى)
//   --token <jwt>           توكن وصول جاهز بدل البريد وكلمة المرور
//
// آمن للتكرار: الصنف الموجود باسمه يُتخطى (لا يتكرر ولا يُضاف رصيده مرتين).
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.json'));
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const API = (option('api') ?? '').replace(/\/$/, '');
const APPLY = flag('apply');
const QUANTITY = Number(option('quantity') ?? 0);
const COST_RATIO =
  option('cost-ratio') === undefined ? null : Number(option('cost-ratio'));
const PAGE = 200;
/** أقصى عدد أسطر في تسوية واحدة (حد السيرفر 500) */
const OPENING_CHUNK = 200;

if (!file || !API) {
  console.error(
    'الاستخدام: node import-products.mjs <ملف.json> --api <url> --email <e> --password <p> [--apply]',
  );
  process.exit(1);
}

let token = option('token') ?? '';

const request = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      json.errors?.[0] ??
      (Array.isArray(json.message) ? json.message[0] : json.message);
    throw new Error(`${method} ${path} → ${res.status}: ${message ?? 'خطأ'}`);
  }
  return json.data;
};

const login = async () => {
  if (token) return;
  const email = option('email');
  const password = option('password');
  if (!email || !password)
    throw new Error('أدخل --email و --password (أو --token)');
  const tokens = await request('POST', '/auth/login', { email, password });
  token = tokens.accessToken;
};

/** كل أصناف الشركة الحالية (بأسمائها) لتخطي الموجود */
const existingProducts = async () => {
  const names = new Map();
  for (let page = 1; ; page++) {
    const res = await request(
      'GET',
      `/catalog/products?limit=${PAGE}&page=${page}`,
    );
    res.data.forEach((p) => names.set(p.name.trim(), p.id));
    if (page >= res.totalPages) return names;
  }
};

const main = async () => {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const items = data.categories.flatMap((category) =>
    category.items.map((item) => ({ ...item, category: category.name })),
  );
  const unpriced = items.filter(
    (i) => i.price === null || i.price === undefined,
  );
  const toImport = flag('include-unpriced')
    ? items
    : items.filter((i) => !unpriced.includes(i));

  // أسماء مكررة في الملف نفسه تُستورد مرة واحدة
  const seen = new Set();
  const unique = toImport.filter((i) => !seen.has(i.name) && seen.add(i.name));

  console.log(`الملف: ${file}`);
  console.log(`الأصناف: ${items.length} في ${data.categories.length} تصنيفاً`);
  if (unpriced.length) {
    console.log(
      `\nبلا سعر (${flag('include-unpriced') ? 'ستُستورد بسعر 0' : 'ستُتخطى'}):`,
    );
    unpriced.forEach((i) =>
      console.log(`  - ${i.name}${i.note ? ` — ${i.note}` : ''}`),
    );
  }
  if (unique.length !== toImport.length) {
    console.log(
      `\nأسماء مكررة في الملف: ${toImport.length - unique.length} (تُستورد مرة واحدة)`,
    );
  }

  await login();

  // ─── ما في الشركة الآن ───
  const [units, categories, taxRates, warehouses, existing] = await Promise.all(
    [
      request('GET', '/catalog/units'),
      request('GET', '/catalog/categories'),
      request('GET', '/catalog/tax-rates'),
      QUANTITY > 0 ? request('GET', '/inventory/warehouses') : [],
      existingProducts(),
    ],
  );

  const taxName = option('tax');
  const taxRate = taxName
    ? taxRates.find((t) => t.name === taxName)
    : taxRates.find((t) => t.isDefault);
  if (!taxRate)
    throw new Error(`الضريبة غير موجودة: ${taxName ?? '(الافتراضية)'}`);

  const unitNames = [...new Set(unique.map((i) => i.unit ?? data.defaultUnit))];
  const missingUnits = unitNames.filter(
    (name) => !units.some((u) => u.name === name),
  );
  const missingCategories = data.categories
    .map((c) => c.name)
    .filter((name) => !categories.some((c) => c.name === name));
  const fresh = unique.filter((i) => !existing.has(i.name));
  const mainWarehouse = warehouses.find((w) => w.type === 'main');
  if (QUANTITY > 0 && !mainWarehouse)
    throw new Error('لا يوجد مخزن رئيسي للشركة');

  console.log(`\nالخطة:`);
  console.log(
    `  أصناف جديدة: ${fresh.length} (موجود بالفعل ويُتخطى: ${unique.length - fresh.length})`,
  );
  console.log(
    `  تصنيفات جديدة: ${missingCategories.length}، وحدات جديدة: ${missingUnits.length}`,
  );
  console.log(
    `  الضريبة: ${taxRate.name} — الأسعار ${flag('price-excludes-tax') ? 'قبل' : 'شاملة'} الضريبة`,
  );
  console.log(
    QUANTITY > 0
      ? `  رصيد افتتاحي: ${QUANTITY} لكل صنف جديد في "${mainWarehouse.name}"` +
          (COST_RATIO === null
            ? ' (بلا تكلفة)'
            : ` بتكلفة = السعر × ${COST_RATIO}`)
      : `  بلا رصيد افتتاحي`,
  );

  if (!APPLY) {
    console.log(`\nمعاينة فقط — لم يُكتب شيء. أضف --apply للتنفيذ.`);
    return;
  }

  // ─── التنفيذ ───
  for (const name of missingUnits) {
    units.push(await request('POST', '/catalog/units', { name }));
  }
  for (const name of missingCategories) {
    categories.push(await request('POST', '/catalog/categories', { name }));
  }
  const unitId = (name) => units.find((u) => u.name === name).id;
  const categoryId = (name) => categories.find((c) => c.name === name).id;

  const created = [];
  const failed = [];
  for (const item of fresh) {
    try {
      const product = await request('POST', '/catalog/products', {
        name: item.name,
        categoryId: categoryId(item.category),
        baseUnitId: unitId(item.unit ?? data.defaultUnit),
        taxRateId: taxRate.id,
        salePrice: item.price ?? 0,
        priceIncludesTax: !flag('price-excludes-tax'),
      });
      created.push({ id: product.id, price: item.price ?? 0 });
    } catch (error) {
      failed.push(`${item.name}: ${error.message}`);
      // حدّ الخطة: لا فائدة من محاولة الباقي
      if (error.message.includes('403')) break;
    }
  }
  console.log(`\nأُضيف ${created.length} صنفاً`);

  if (QUANTITY > 0 && created.length) {
    for (let start = 0; start < created.length; start += OPENING_CHUNK) {
      await request('POST', '/inventory/adjustments', {
        warehouseId: mainWarehouse.id,
        type: 'opening',
        note: 'رصيد افتتاحي — استيراد',
        lines: created.slice(start, start + OPENING_CHUNK).map((p) => ({
          productId: p.id,
          quantity: QUANTITY,
          ...(COST_RATIO === null
            ? {}
            : { unitCost: Math.round(p.price * COST_RATIO * 10000) / 10000 }),
        })),
      });
    }
    console.log(`سُجّل رصيد افتتاحي ${QUANTITY} لـ ${created.length} صنفاً`);
  }

  if (failed.length) {
    console.log(`\nفشل ${failed.length}:`);
    failed.forEach((line) => console.log(`  - ${line}`));
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`\nفشل الاستيراد: ${error.message}`);
  process.exit(1);
});
