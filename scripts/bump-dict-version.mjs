#!/usr/bin/env node
/**
 * bump / 校验字典 cache-buster 版本号
 * ----------------------------------------------------------------
 * 背景：public/i18n/*.json 是运行时按需 fetch 的静态资源，
 * 浏览器/CDN 会按 URL 缓存。要让玩家拿到新文案，必须让 URL 变一下 ——
 * 也就是各页面 <script>window.__I18N_CONFIG__={...dictVersion:45...}</script>
 * 里的那个数字。
 *
 * 🔴 这个仓库有 17 个页面各写一份 dictVersion，手改必然漏改 ——
 *    漏改的那几个页面会把旧字典留在玩家浏览器缓存里，
 *    表现为「我改了文案但部分页面没变」，极难定位。
 *    所以：改词典后跑 `node scripts/bump-dict-version.mjs 46`，
 *    一次改全部；跑 `node scripts/bump-dict-version.mjs --check`
 *    只校验全站一致（进 build 前置）。
 *
 * 用法：
 *   node scripts/bump-dict-version.mjs 46     # 全部设成 46
 *   node scripts/bump-dict-version.mjs --check # 校验一致性，不写盘
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RE = /dictVersion\s*:\s*(\d+)/g;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f === '.git') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.html$/.test(f)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const hits = []; // {file, versions:[…]}
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const vs = [...src.matchAll(RE)].map((m) => m[1]);
  if (vs.length) hits.push({ file: f, versions: vs, src });
}

if (!hits.length) {
  console.log('\n[i18n] 未找到任何 dictVersion 声明\n');
  process.exit(0);
}

const uniq = [...new Set(hits.flatMap((h) => h.versions))];
const allSame = hits.every((h) => h.versions.every((v) => v === uniq[0]));

const arg = process.argv[2];

if (!arg || arg === '--check') {
  console.log(`\n[i18n] dictVersion 出现在 ${hits.length} 个文件，当前取值：${uniq.join(' / ')}`);
  if (!allSame) {
    const bad = hits.filter((h) => h.versions.some((v) => v !== uniq[0]));
    console.error('\n✗ 版本不一致 —— 漏改的页面会继续吃浏览器旧缓存：');
    bad.forEach((h) => console.error(`   ${relative(ROOT, h.file)}: ${h.versions.join(', ')}`));
    console.error('\n  修复：node scripts/bump-dict-version.mjs <新版本号>\n');
    process.exit(1);
  }
  if (!arg) console.log('  ✓ 全站一致\n');
  else console.log('  ✓ 全站一致\n');
  process.exit(0);
}

if (!/^\d+$/.test(arg)) {
  console.error(`\n✗ 版本号必须是纯数字，收到：${arg}\n`);
  process.exit(1);
}

let changed = 0;
for (const h of hits) {
  const next = h.src.replace(RE, `dictVersion:${arg}`);
  if (next !== h.src) {
    writeFileSync(h.file, next);
    changed++;
  }
}
console.log(`\n[i18n] dictVersion → ${arg}，已更新 ${changed}/${hits.length} 个文件\n`);
