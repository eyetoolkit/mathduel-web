/**
 * 品牌一致性构建期守卫（2026-10-15 · 依据 numeriduel 调研报告 X1 / 1.1）
 *
 * 背景：MathDuel → NumeriDuel 品牌迁移反复留尾巴（i18n 字典 meta、静态 HTML 兜底文案、
 * `data-site` 属性两套值）。HTML 一旦发布，爬虫与社媒预览读到的就是旧品牌，
 * 而线上 = 构建产物，任何遗漏都会静默上线。
 *
 * 本脚本在 vite build 之后跑，出现以下任一情况即**构建失败**（exit 1）：
 *   1. 产物 HTML 的 `data-site` 不是 `numeriduel`
 *   2. 产物 HTML 含 `MathDuel`（legacy 旧站目录除外 —— 那是刻意保留的旧资产，
 *      且只在 beta 环境发布；其内部文案不属于主站品牌面）
 *   3. 产物 HTML 的 og:image 指向 `.svg`（Twitter/Facebook/LinkedIn 不渲染 SVG）
 *   4. 产物 HTML 缺 `theme-color` 或值不是站点统一的浅色纸面 `#F4F5F9`
 *
 * 用法：node scripts/check-brand.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const distDir = resolve(root, 'dist');

const SITE = 'numeriduel';
const THEME = '#F4F5F9';

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

const problems = [];
let checked = 0;

for await (const file of walk(distDir)) {
  const rel = relative(distDir, file).split(sep).join('/');
  // legacy 旧站资产：只随 beta 发布，品牌面不归主站管
  if (rel.startsWith('legacy/')) continue;
  const html = await readFile(file, 'utf8');
  checked++;

  const site = /<html[^>]*\bdata-site="([^"]*)"/.exec(html);
  if (!site) problems.push(`${rel}: 缺 data-site`);
  else if (site[1] !== SITE) problems.push(`${rel}: data-site="${site[1]}"（应为 ${SITE}）`);

  if (/MathDuel/.test(html)) problems.push(`${rel}: 含 MathDuel 品牌残留`);

  const og = /<meta property="og:image" content="([^"]*)"/.exec(html);
  if (og && /\.svg(\?|$)/.test(og[1])) problems.push(`${rel}: og:image 用 SVG（${og[1]}）`);

  const tc = /<meta name="theme-color" content="([^"]*)"/.exec(html);
  if (!tc) problems.push(`${rel}: 缺 theme-color`);
  else if (tc[1] !== THEME) problems.push(`${rel}: theme-color="${tc[1]}"（应为 ${THEME}）`);
}

if (problems.length) {
  console.error(`[check-brand] ✗ ${problems.length} 个问题（扫描 ${checked} 个 HTML）：`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`[check-brand] ✓ ${checked} 个 HTML 全部通过（data-site=${SITE} / 无 MathDuel / og PNG / theme-color=${THEME}）`);
