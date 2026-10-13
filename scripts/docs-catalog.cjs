// scripts/docs-catalog.cjs
// يحدّث الجزء المولَّد من كتالوج المشروع (docs/) من الكود نفسه:
//   - docs/modules/<module>.md : جداول الموديول ومساراته بصلاحياتها (بين علامتي AUTO)
//   - docs/README.md           : فهرس الموديولات (بين علامتي AUTO)
//
// ما هو خارج العلامتين يُكتب باليد ولا يُمَسّ. موديول جديد بلا ملف يُنشأ له
// هيكل فارغ تُكمل شرحه.
//
// التشغيل:  npm run docs:catalog
// الفحص فقط (يفشل إن كان الكتالوج قديماً):  npm run docs:catalog -- --check
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'src', 'modules');
const DOCS_DIR = path.join(ROOT, 'docs');
const MODULE_DOCS_DIR = path.join(DOCS_DIR, 'modules');
const START =
  '<!-- AUTO:START — يولّده npm run docs:catalog، لا تعدّله باليد -->';
const END = '<!-- AUTO:END -->';
const CHECK = process.argv.includes('--check');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
const relative = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

/** ثوابت مثل PERMS و FEATURES: المفتاح ← { name, labelAr } */
function loadLabels(file) {
  const labels = {};
  const pattern =
    /(\w+):\s*\{\s*name:\s*'([^']+)',\s*labelAr:\s*'([^']+)',?\s*\}/g;
  for (const [, key, name, labelAr] of read(file).matchAll(pattern)) {
    labels[key] = { name, labelAr };
  }
  return labels;
}
const PERMS = loadLabels(
  path.join(ROOT, 'src', 'common', 'constants', 'permissions.ts'),
);
const FEATURES = loadLabels(
  path.join(ROOT, 'src', 'common', 'constants', 'features.ts'),
);

/** أسماء أقسام Swagger: المفتاح ← الاسم العربي */
function loadTags() {
  const tags = {};
  const source = read(path.join(ROOT, 'src', 'config', 'swagger.config.ts'));
  for (const [, key, name] of source.matchAll(
    /^\s+(\w+):\s*\[\s*'([^']+)'/gm,
  )) {
    tags[key] = name;
  }
  return tags;
}
const TAGS = loadTags();

const label = (table, key) =>
  table[key] ? `${table[key].labelAr} \`${table[key].name}\`` : `\`${key}\``;

/** مسارات controller واحد مع عنوانها وصلاحيتها وميزتها */
function parseController(file) {
  const lines = read(file).split('\n');
  const source = lines.join('\n');
  const prefix = (source.match(/@Controller\('([^']*)'\)/) || [])[1] ?? '';
  const tag = TAGS[(source.match(/@ApiTags\(apiTag\('(\w+)'\)\)/) || [])[1]];
  const classStart = lines.findIndex((line) =>
    /^export class \w+Controller/.test(line),
  );
  const header = lines.slice(0, classStart).join('\n');
  const classFeature = (header.match(/@RequiresFeature\(FEATURES\.(\w+)\)/) ||
    [])[1];

  const routes = [];
  for (let i = classStart; i < lines.length; i++) {
    const route = lines[i].match(
      /^  @(Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/,
    );
    if (!route) continue;

    // مجموعة الـ decorators لهذه الدالة: من أول decorator حتى توقيع الدالة
    let start = i;
    while (start > classStart + 1 && /^  @|^    |^  \)/.test(lines[start - 1]))
      start--;
    let end = i;
    while (end < lines.length && !/^  (async )?\w+\(/.test(lines[end])) end++;
    const block = lines.slice(start, end).join('\n');

    // التعليق فوقها: سطر واحد أو عدة أسطر — يؤخذ سطره الأول
    let summary = '';
    if (/\*\/\s*$/.test(lines[start - 1] ?? '')) {
      let top = start - 1;
      while (top > 0 && !/\/\*\*/.test(lines[top])) top--;
      summary = lines
        .slice(top, start)
        .join(' ')
        .replace(/\/\*\*|\*\/|^\s*\*|\s\*\s/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    routes.push({
      method: route[1].toUpperCase(),
      path: `/${[prefix, route[2]].filter(Boolean).join('/')}`,
      summary,
      permissions: [...block.matchAll(/PERMS\.(\w+)/g)].map((m) => m[1]),
      feature:
        (block.match(/@RequiresFeature\(FEATURES\.(\w+)\)/) || [])[1] ??
        classFeature,
      quota: (block.match(/@CheckQuota\('([^']+)'\)/) || [])[1],
    });
  }
  return { file, tag, routes };
}

/** جداول القاعدة التي يعرّفها ملف entity */
function parseEntities(file) {
  const source = read(file);
  const tables = [];
  const pattern =
    /@Entity\((?:'([^']+)'|\{\s*name:\s*'([^']+)')?[^)]*\)[\s\S]*?export (?:abstract )?class (\w+)/g;
  for (const [, simple, named, className] of source.matchAll(pattern)) {
    tables.push({ table: simple ?? named ?? className, className, file });
  }
  return tables;
}

function describeModule(name) {
  const files = walk(path.join(MODULES_DIR, name));
  return {
    name,
    controllers: files
      .filter((f) => f.endsWith('.controller.ts'))
      .sort()
      .map(parseController),
    tables: files
      .filter((f) => f.endsWith('.entity.ts'))
      .sort()
      .flatMap(parseEntities),
    services: files
      .filter((f) => /\.service\.ts$/.test(f) && !f.endsWith('.spec.ts'))
      .sort()
      .map(relative),
  };
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|') || '—';

function renderAuto(module) {
  const out = [START, ''];

  out.push('### الملفات', '');
  out.push(`- المجلد: \`src/modules/${module.name}/\``);
  if (module.services.length) {
    out.push(
      `- الخدمات: ${module.services.map((f) => `\`${path.basename(f)}\``).join('، ')}`,
    );
  }
  out.push('');

  if (module.tables.length) {
    out.push(
      '### جداول قاعدة البيانات',
      '',
      '| الجدول | الكيان | الملف |',
      '|---|---|---|',
    );
    for (const t of module.tables) {
      out.push(
        `| \`${t.table}\` | \`${t.className}\` | \`${path.basename(t.file)}\` |`,
      );
    }
    out.push('');
  }

  const routeCount = module.controllers.reduce(
    (sum, c) => sum + c.routes.length,
    0,
  );
  if (routeCount) {
    out.push(`### المسارات (${routeCount})`, '');
    for (const controller of module.controllers) {
      if (!controller.routes.length) continue;
      out.push(
        `**${controller.tag ?? path.basename(controller.file)}** — \`${path.basename(controller.file)}\` (القسم في Swagger: «${controller.tag ?? '—'}»)`,
        '',
        '| الطريقة | المسار | الوظيفة | الصلاحية | ميزة الباقة |',
        '|---|---|---|---|---|',
      );
      for (const r of controller.routes) {
        const permission = r.permissions
          .map((p) => label(PERMS, p))
          .join(' + ');
        const feature = [
          r.feature ? label(FEATURES, r.feature) : '',
          r.quota ? `حد: \`${r.quota}\`` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        out.push(
          `| ${r.method} | \`${r.path}\` | ${cell(r.summary)} | ${cell(permission)} | ${cell(feature)} |`,
        );
      }
      out.push('');
    }
  } else {
    out.push(
      '### المسارات',
      '',
      'لا مسارات: موديول داخلي تستخدمه موديولات أخرى.',
      '',
    );
  }

  out.push(END);
  return out.join('\n');
}

const skeleton = (module) =>
  [
    `# ${module.name}`,
    '',
    '> اكتب هنا في سطر: ما الذي يفعله هذا الموديول.',
    '',
    '## الغرض',
    '',
    '## المفاهيم والقواعد',
    '',
    '## علاقته بباقي النظام',
    '',
    '## صفحات الواجهة',
    '',
    '## المرجع',
    '',
    START,
    END,
    '',
  ].join('\n');

/** يستبدل ما بين العلامتين، أو يضيف القسم في آخر الملف إن لم توجدا */
function withAuto(content, auto) {
  const from = content.indexOf(START.slice(0, 16));
  const to = content.indexOf(END);
  if (from === -1 || to === -1) return `${content.trimEnd()}\n\n${auto}\n`;
  return `${content.slice(0, from)}${auto}${content.slice(to + END.length)}`;
}

/** أول سطر اقتباس في ملف الموديول: وصفه في الفهرس */
const taglineOf = (content) =>
  (content.match(/^>\s*(.+)$/m) || [])[1]?.trim() ?? '';
const titleOf = (content, fallback) =>
  (content.match(/^#\s+(.+)$/m) || [])[1]?.trim() ?? fallback;

const stale = [];
function write(file, content) {
  const current = fs.existsSync(file) ? read(file) : null;
  if (current === content) return;
  stale.push(relative(file));
  if (!CHECK) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

const modules = fs
  .readdirSync(MODULES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => describeModule(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name));

const index = [
  START,
  '',
  '| الموديول | ما يفعله | المسارات | الجداول |',
  '|---|---|---|---|',
];
for (const module of modules) {
  const file = path.join(MODULE_DOCS_DIR, `${module.name}.md`);
  const existing = fs.existsSync(file) ? read(file) : skeleton(module);
  const content = withAuto(existing, renderAuto(module));
  write(file, content);

  const routes = module.controllers.reduce(
    (sum, c) => sum + c.routes.length,
    0,
  );
  index.push(
    `| [${titleOf(content, module.name)}](modules/${module.name}.md) | ${cell(taglineOf(content))} | ${routes} | ${module.tables.length} |`,
  );
}
const totals = modules.reduce(
  (sum, m) => ({
    routes: sum.routes + m.controllers.reduce((n, c) => n + c.routes.length, 0),
    tables: sum.tables + m.tables.length,
  }),
  { routes: 0, tables: 0 },
);
index.push(
  '',
  `المجموع: ${modules.length} موديولاً، ${totals.routes} مساراً، ${totals.tables} جدولاً.`,
  '',
  END,
);

const readme = path.join(DOCS_DIR, 'README.md');
if (fs.existsSync(readme))
  write(readme, withAuto(read(readme), index.join('\n')));

if (CHECK && stale.length) {
  console.error(
    `الكتالوج قديم — شغّل npm run docs:catalog:\n  ${stale.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(
  stale.length
    ? `${CHECK ? 'قديم' : 'تم تحديث'}: ${stale.length} ملف`
    : 'الكتالوج محدَّث',
);
