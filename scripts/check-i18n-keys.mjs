#!/usr/bin/env node
/**
 * i18n 键存在性守卫（check-i18n-keys）
 * ----------------------------------------------------------------
 * 为什么需要（2026-10-17 发现）：
 *   check-i18n.mjs 只做两件事——JSON 合法 + 六语 key 集合对齐。
 *   它**完全不看代码引用了哪些 key**，于是「代码里 i18nT('mp.xxx')
 *   而六本字典都没有这个键」这类缺陷可以无限期潜伏：构建全绿、
 *   六语对齐（对齐的是「都没有」），用户侧永久显示裸 key。
 *   实测本站有 50+ 个这样的键，全部经 i18nT() 插 innerHTML 真上屏。
 *
 * 检查项：
 *   1. src/**\/*.ts、public/**\/*.js 里的 i18nT('k') / t('k') / __('k') /
 *      hasTranslation('k') 字面量键，必须 6 语词典全都有
 *   2. 源码 *.html 里的 data-i18n / -html / -content / -title /
 *      -aria-label / -placeholder 绑定键，同样必须 6 语全有
 *   3. 模板动态键（i18nT(`difficulty.${d}`)）取 `${` 前的静态前缀，
 *      前缀必须能匹配到至少一个真实键（匹配不到 = 必然缺键，硬失败）；
 *      匹配到的只提示不红——运行时值域静态不可知
 *
 * 不在检查范围（有意为之）：
 *   - scripts/\/*.mjs：构建期脚本，additions 文件自己就是键的定义方
 *   - dist/、node_modules/、.verify*：产物
 *   - 🔴 legacy/\/*.html：**已死的源码**——vite.config.ts 的 rollupOptions.input
 *     未注册 legacy 入口，publicDir 也不复制它，dist/ 里没有 legacy/ 目录；
 *     线上由 public/_redirects 把 /legacy/** 301 到新路径（2026-10-12 建）。
 *     这些文件里约 65 处 data-i18n 指向的键随旧字典一起被裁掉了，
 *     但它们永远不会构建、永远不会上屏，报出来只是噪声。
 *     若未来 legacy 重新进构建，把 legacy 从 SKIP_DIRS 移除即可。
 *   - data-i18n-vars（JSON 变量表，不是键）/ data-i18n-ready（标志位）
 *
 * 接入：package.json 的 build / build:beta 已串上本脚本。
 * 用法：node scripts/check-i18n-keys.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_DIR = join(ROOT, 'public', 'i18n');
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];
const KEY_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;

/** 递归摊平嵌套对象成点分 key 路径 */
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.push(key);
  }
  return out;
}

// ─── 1. 载入六语词典 ───
const dicts = new Map();
for (const lang of LANGS) {
  const raw = readFileSync(join(I18N_DIR, `${lang}.json`), 'utf8');
  dicts.set(lang, new Set(flatten(JSON.parse(raw))));
}

// ─── 2. 枚举源码文件 ───
const SKIP_DIRS = new Set(['node_modules', 'dist', 'scripts', '.git', 'legacy']);

function walk(dir, out = [], ext) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const f of entries) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(f) || f.startsWith('.verify')) continue;
      walk(p, out, ext);
    } else if (!ext || ext.test(f)) {
      out.push(p);
    }
  }
  return out;
}

const tsFiles = walk(join(ROOT, 'src'), [], /\.ts$/);
const jsFiles = walk(join(ROOT, 'public'), [], /\.js$/);
const htmlFiles = walk(ROOT, [], /\.html$/);

// ─── 3. 去注释（保留换行维持行号）───
function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

// ─── 4. 提取键引用 ───
/** TS/JS：函数调用字面量键 */
const FN_RE = /\b(?:i18nT|t|__|hasTranslation)\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"]/g;
/** TS/JS：模板动态键，取 ${ 前的静态前缀 */
const FN_TPL_RE = /\b(?:i18nT|t)\s*\(\s*`([^`]*\$\{[\s\S]*?)`/g;
/** HTML：data-i18n* 绑定（-vars 是变量表、-ready 是标志位，都不算键） */
const HTML_RE = /data-i18n(?:-html|-content|-title|-aria-label|-placeholder)\s*=\s*"([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)"/g;
/**
 * 🔴 第二通道：命名空间形状字面量。
 * 为什么需要（2026-10-17）：daily.ts 有 `data-i18n="${c.nameKey}"` 这类
 * **动态绑定**，键值存放在数据表里（`{ nameKey: 'ml.dc_24_name' }`）。
 * 它既不是函数调用的第一参、也不是 HTML 属性字面量，前两通道全都扫不到。
 * 判据：任何形状为 '<已知命名空间>.<子键>' 的字符串字面量，一律当键引用核对。
 * （命名空间取自六语词典真实存在的一级键，不是硬编码名单。）
 */
const NAMESPACES = [...dicts.get('en')].map((k) => k.split('.')[0]);
const NS_RE = new RegExp(`['"\`](${NAMESPACES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\.([A-Za-z0-9_]+)['"\`]`, 'g');

const refs = new Map(); // key -> Set of "file:line"
const dynPrefixes = new Map(); // prefix -> Set of "file:line"

function add(map, key, where) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(where);
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

for (const f of [...tsFiles, ...jsFiles]) {
  const rel = relative(ROOT, f);
  const src = stripJsComments(readFileSync(f, 'utf8'));
  for (const re of [FN_RE, FN_TPL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const where = `${rel}:${lineOf(src, m.index)}`;
      if (re === FN_RE) {
        const key = m[1];
        if (KEY_SHAPE.test(key)) add(refs, key, where);
      } else {
        const prefix = m[1].split('${')[0];
        if (prefix.includes('.')) add(dynPrefixes, prefix, where);
      }
    }
  }
  // 第二通道：命名空间形状字面量（数据表里的动态键值）
  NS_RE.lastIndex = 0;
  let nm;
  while ((nm = NS_RE.exec(src))) {
    const key = `${nm[1]}.${nm[2]}`;
    if (KEY_SHAPE.test(key)) add(refs, key, `${rel}:${lineOf(src, nm.index)}`);
  }
}

for (const f of htmlFiles) {
  const rel = relative(ROOT, f);
  const src = stripHtmlComments(readFileSync(f, 'utf8'));
  for (const re of [HTML_RE, NS_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const key = re === HTML_RE ? m[1] : `${m[1]}.${m[2]}`;
      if (KEY_SHAPE.test(key)) add(refs, key, `${rel}:${lineOf(src, m.index)}`);
    }
  }
}

// ─── 5. 核对 ───
const missing = []; // { key, where[], langs[] }
for (const [key, wheres] of refs) {
  const absentLangs = LANGS.filter((l) => !dicts.get(l).has(key));
  if (absentLangs.length) missing.push({ key, wheres: [...wheres], langs: absentLangs });
}
missing.sort((a, b) => a.key.localeCompare(b.key));

const allKeys = new Set([...dicts.get('en')]);
const dynBroken = [];
const dynOk = [];
for (const [prefix, wheres] of dynPrefixes) {
  const hit = [...allKeys].some((k) => k.startsWith(prefix));
  const entry = { prefix, wheres: [...wheres] };
  if (hit) dynOk.push(entry);
  else dynBroken.push(entry);
}

// ─── 6. 报告 ───
console.log(`[check-i18n-keys] 扫描 ${tsFiles.length} TS + ${jsFiles.length} JS + ${htmlFiles.length} HTML`);
console.log(`[check-i18n-keys] 字面量键引用 ${refs.size} 个，动态前缀 ${dynPrefixes.size} 个`);

if (dynOk.length) {
  console.log(`\n── 动态键（前缀可匹配，运行时值域静态不可知，仅提示）──`);
  for (const { prefix, wheres } of dynOk) {
    console.log(`   ${prefix}\${…}  ← ${wheres.join(', ')}`);
  }
}

let fail = false;

if (missing.length) {
  fail = true;
  console.error(`\n[check-i18n-keys] ✗ ${missing.length} 个被引用的键在词典中不存在：`);
  for (const { key, wheres, langs } of missing) {
    console.error(`   ${key}  （缺于: ${langs.join('/')}）`);
    for (const w of wheres.slice(0, 3)) console.error(`      ← ${w}`);
    if (wheres.length > 3) console.error(`      … +${wheres.length - 3} 处`);
  }
}

if (dynBroken.length) {
  fail = true;
  console.error(`\n[check-i18n-keys] ✗ ${dynBroken.length} 个动态键前缀匹配不到任何真实键：`);
  for (const { prefix, wheres } of dynBroken) {
    console.error(`   ${prefix}\${…}  ← ${wheres.join(', ')}`);
  }
}

if (fail) {
  console.error('\n✗ 键存在性检查失败——修法：补六语键值，或删掉死引用\n');
  process.exit(1);
}
console.log('\n[check-i18n-keys] ✓ 全部被引用键均存在于六语词典\n');
