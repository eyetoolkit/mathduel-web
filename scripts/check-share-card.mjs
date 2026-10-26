#!/usr/bin/env node
/**
 * 24 点分享卡门禁（2026-10-26 · 卡片第 2 批）
 * ----------------------------------------------------------------
 * 为什么需要这个脚本：
 *   本仓库没有单元测试框架，门禁都在 scripts/ 里（check-i18n /
 *   check-i18n-keys / check-i18n-replay / scan-hardcoded-i18n …）。
 *   但那些通用门禁覆盖不到**分享卡**的两个特有风险：
 *
 *   1. Canvas 是像素。i18n.js 的 MutationObserver 只处理 DOM 属性，
 *      管不到 canvas —— 一句硬编码英文画上去就永远翻不了，且不报错。
 *      scan-hardcoded-i18n.mjs 虽然把 fillText 列为 sink，但它的正则要求
 *      坐标形如 `x, y`（纯 [\w.]+），而本仓库写的是 `W / 2, 332`，
 *      **匹配不上** → 这条路径长期是假绿。
 *   2. 分享卡的字典键缺一个语言 = 那一种语言的卡片永久露英文，
 *      而键是动态拼的（shareText('mg.g24_share_xxx', ...)），
 *      check-i18n-keys 虽能扫到字面量键，但缺键时的表现是"静默降级"，
 *      这里再加一道显式断言更稳。
 *
 * 本脚本断言：
 *   A. renderShareCard 内的英文文案必须走 shareText（不得有裸字面量）
 *   B. shareText 必须把「返回值 === key」判为降级（防裸 key 烧进像素）
 *   C. 大数字必须走 toLocaleString 千分位
 *   D. 弹窗预览必须放大到 600px（竖版 600×760 缩到 300px 看不清）
 *   E. 用到的 mg.g24_share_* 键必须在 6 语言词典里都存在
 *
 * 用法：node scripts/check-share-card.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_FILE = join(ROOT, 'src/games/24-game/share.ts');
const CSS_FILE = join(ROOT, 'src/games/24-game/styles.css');
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];

const SRC = readFileSync(SRC_FILE, 'utf8');
const CSS = readFileSync(CSS_FILE, 'utf8');

const errors = [];
const fail = (msg) => errors.push(msg);

/* ── A. Canvas 内不得有裸英文文案 ─────────────────────────────── */

const fnStart = SRC.indexOf('export function renderShareCard');
const fnEnd = SRC.indexOf('export function openShareOverlay');
if (fnStart < 0 || fnEnd < 0 || fnEnd <= fnStart) {
  fail('定位不到 renderShareCard 函数体 —— 源码结构变了，先人工确认');
} else {
  const BODY = SRC.slice(fnStart, fnEnd);
  // 剥注释（先块后行，顺序反了块注释会失效）
  const CODE = BODY
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

  /** 非文案字面量白名单：颜色、字体简写、画布 API 取值、品牌/域名 */
  const NOT_COPY = [
    /^#[0-9a-f]{3,8}$/i,
    /^rgba?\(/,
    /\dpx\s/,
    /^\s*$/,
    // 🔴 i18n **键名**不是文案（'mg.g24_share_cleared' 是 key，不是要显示的字）。
    //    漏掉这条会把每一个 shareText 的第一个参数都报成硬编码。
    /^[a-z][a-z0-9_]*\.[a-z0-9_.]+$/i,
  ];
  const NOT_COPY_EXACT = new Set([
    'Space Grotesk', 'Sora', 'NumeriDuel', 'numeriduel.com', 'center', 'left',
    'right', 'alphabetic', 'middle', 'top', 'bottom', '✓', '✓ ',
  ]);

  // 抓所有单引号/双引号字面量
  const litRe = /(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = litRe.exec(CODE)) !== null) {
    const raw = m[2];
    if (NOT_COPY.some((re) => re.test(raw))) continue;
    if (NOT_COPY_EXACT.has(raw)) continue;
    // 只关心「看起来像英文文案」的：含 3 个连续 ASCII 字母
    if (!/[A-Za-z]{3,}/.test(raw)) continue;

    // 判定：是否位于 shareText('key', '兜底') 的第二参位置
    const before = CODE.slice(Math.max(0, m.index - 140), m.index);
    const inShareText = /shareText\(\s*'[^']+',\s*$/i.test(before);
    if (!inShareText) {
      const line = CODE.slice(0, m.index).split('\n').length;
      fail(`第 ${line} 行附近有裸英文文案「${raw.slice(0, 60)}」—— Canvas 是像素，必须走 shareText()`);
    }
  }
}

/* ── B. shareText 必须判降级 ──────────────────────────────────── */
if (!/function shareText/.test(SRC)) fail('缺少 shareText() —— 分享卡必须有一层带兜底的取值');
if (!/v\s*&&\s*v\s*!==\s*key/.test(SRC)) {
  fail('shareText 必须显式判定「返回值 === key」为降级（字典未就绪时否则会烧进裸 key）');
}
if (!/return fb/.test(SRC)) fail('shareText 降级时必须回退英文兜底（fb）');

/* ── C. 千分位 ───────────────────────────────────────────────── */
if (!/function fmtNum/.test(SRC)) fail('缺少 fmtNum() —— 大数字必须带千分位');
if (!/toLocaleString/.test(SRC)) fail('必须用 toLocaleString（各语言分隔符不同）');
if (!/i18nLocale\(\)/.test(SRC)) fail('必须显式传 i18nLocale()，不能依赖浏览器默认 locale');
// 🔴 只查 **Canvas 绘制区**：buildShareUrl() 里的 String(d.solved || 0) 是拼
//    URL 查询参数的，那边**必须**用裸数字（带千分位会拼出坏链接）。
const CANVAS_REGION = SRC.slice(
  SRC.indexOf('export function renderShareCard'),
  SRC.indexOf('export function openShareOverlay'),
);
if (/String\(d\.solved\s*\|\|\s*0\)/.test(CANVAS_REGION)) fail('不得再用裸 String() 显示解出数');
if (/String\(d\.total\s*\|\|\s*0\)/.test(CANVAS_REGION)) fail('不得再用裸 String() 显示玩家数');
if (/String\(streak\)/.test(CANVAS_REGION)) fail('不得再用裸 String() 显示连胜数');
if (!/fmtNum\(d\.solved/.test(CANVAS_REGION)) fail('解出数必须走 fmtNum()');
if (!/fmtNum\(d\.total/.test(CANVAS_REGION)) fail('玩家数必须走 fmtNum()');
if (!/fmtNum\(streak\)/.test(CANVAS_REGION)) fail('连胜数必须走 fmtNum()');

/* ── D. 预览放大到 600px ─────────────────────────────────────── */
const canvas = CSS.match(/\.share-canvas-wrap canvas\s*\{[^}]*max-width:\s*(\d+)px/);
if (!canvas) fail('未找到 .share-canvas-wrap canvas 的 max-width');
else if (Number(canvas[1]) < 600) fail(`预览宽度应 ≥600px（原 300px），实际 ${canvas[1]}px`);

/* 🔴 容器宽度必须按**盒模型倒推**，不能拍脑袋给个数。
 *   画布真要显示成 600px（原生尺寸），容器得放下：
 *     画布 600 + 卡片左右 padding + border + wrap 左右 padding
 *   2026-10-26 在 boardduel 上踩过这个坑：容器写 640px → 线上实测画布
 *   只有 582px（漏算了 wrap 的 10px×2 padding），等于没放大到位。 */
const TOKENS = (() => {
  for (const f of [
    'vendor/tri-design-system/src/styles/tokens.css',
    'legacy/css/shared/tokens.css',
  ]) {
    try { return readFileSync(join(ROOT, f), 'utf8'); } catch (e) { /* 继续找 */ }
  }
  return '';
})();
function pxOf(v) {
  v = (v || '').trim();
  let m = v.match(/^([\d.]+)px$/);
  if (m) return parseFloat(m[1]);
  m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (m && TOKENS) {
    const t = TOKENS.match(new RegExp(m[1].replace(/[-]/g, '\\-') + ':\\s*([\\d.]+)px'));
    if (t) return parseFloat(t[1]);
  }
  return 0;
}
function padX(padStr) {
  const parts = (padStr || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return pxOf(parts[1]) * 2;
  if (parts.length === 2) return pxOf(parts[0]) + pxOf(parts[1]);
  return pxOf(parts[0]) * 2;
}
const cardBlock = CSS.match(/\.share-card\s*\{([^}]*)\}/);
if (!cardBlock) fail('未找到 .share-card 规则');
else {
  const cardMaxM = cardBlock[1].match(/max-width:\s*(\d+)px/);
  if (!cardMaxM) fail('未找到 .share-card 的 max-width');
  else {
    const cardMax = Number(cardMaxM[1]);
    const cardPadM = cardBlock[1].match(/padding:\s*([^;]+);/);
    const cardPadX = cardPadM ? padX(cardPadM[1]) : 0;
    const borderM = cardBlock[1].match(/border:\s*(\d+)px/);
    const borderX = borderM ? Number(borderM[1]) * 2 : 0;
    const wrapBlock = CSS.match(/\.share-canvas-wrap\s*\{([^}]*)\}/);
    const wrapPadM = wrapBlock && wrapBlock[1].match(/padding:\s*([^;]+);/);
    const wrapPadX = wrapPadM ? padX(wrapPadM[1]) : 0;
    const need = 600 + cardPadX + borderX + wrapPadX;
    if (cardMax < need) {
      fail(`弹窗容器应 ≥${need}px（600 画布 + 卡片 padding ${cardPadX} + border ${borderX} + wrap padding ${wrapPadX}），实际 ${cardMax}px`);
    }
  }
}

/* ── E. 字典键覆盖 ───────────────────────────────────────────── */
const used = new Set();
for (const mm of SRC.matchAll(/'(mg\.g24_share_[a-z_]+)'/g)) used.add(mm[1]);
if (used.size < 15) fail(`分享卡引用了 ${used.size} 个 mg.g24_share_* 键，数量异常（预期 ≥15）`);

const dicts = LANGS.map((l) => [
  l,
  JSON.parse(readFileSync(join(ROOT, 'public/i18n', `${l}.json`), 'utf8')),
]);
const missing = [];
for (const [lang, dict] of dicts) {
  for (const key of used) {
    const [ns, sub] = key.split('.');
    const v = dict[ns]?.[sub];
    if (typeof v !== 'string' || !v.trim()) missing.push(`${lang}:${key}`);
  }
}
if (missing.length) {
  fail(`这些键在词典里缺失，分享卡会永久露英文：\n    ${missing.join('\n    ')}`);
}

if (errors.length) {
  console.error('\n✗ 分享卡门禁未通过：\n');
  for (const e of errors) console.error(`  · ${e}`);
  console.error('');
  process.exit(1);
}
console.log(`[check-share-card] ✓ Canvas 无裸英文 / 降级判定 / 千分位 / 预览 600px / ${used.size} 个键 6 语言齐备`);
