#!/usr/bin/env node
/**
 * 🔴 vendor/tri-design-system → node_modules 同步器
 *
 * 背景（本项目专属坑，已在 RULES-FE-D.md 登记）：
 *   package.json 里 `"@tri-sites/design-system": "file:vendor/tri-design-system"`，
 *   pnpm 对 file: 协议做的是**硬拷贝**而不是软链，所以：
 *     - 改 vendor/ 里的源码，node_modules/ 里那份不会跟着变；
 *     - 症状是「明明改了 header.ts，tsc 却报 brandSubKey 不存在于 HeaderConfig」，
 *       看起来像自己没保存，其实类型解析的是另一份文件；
 *     - 构建产物也照旧用旧的，导致上线才发现改动没生效。
 *
 * 用法：
 *   node scripts/sync-vendor-design-system.cjs          # 同步并报告
 *   node scripts/sync-vendor-design-system.cjs --check  # 只检查差异（CI 用，有差异则退出码 1）
 */
const { readFileSync, writeFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'vendor', 'tri-design-system');
const DST = join(ROOT, 'node_modules', '@tri-sites', 'design-system');

const CHECK_ONLY = process.argv.includes('--check');

/** 递归列出 src 下所有文件（按 posix 相对路径排序，保证输出稳定） */
function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out.sort();
}

if (!statSync(DST, { throwIfNoOpening: false })) {
  console.error('✗ node_modules/@tri-sites/design-system 不存在，请先 pnpm install');
  process.exit(1);
}

const files = walk(join(SRC, 'src'));
const diffs = [];
const missing = [];

for (const rel of files) {
  const s = join(SRC, 'src', rel);
  const d = join(DST, 'src', rel);
  let dText = null;
  try { dText = readFileSync(d, 'utf8'); } catch { /* 副本里没有 → 记为新增 */ }
  const sText = readFileSync(s, 'utf8');
  if (dText === null) missing.push(rel);
  else if (dText !== sText) diffs.push(rel);
}

const problems = [...missing.map((f) => `新增  ${f}`), ...diffs.map((f) => `修改  ${f}`)];

if (!problems.length) {
  console.log(`✓ vendor 与 node_modules 已一致（${files.length} 个文件）`);
  process.exit(0);
}

console.log(`vendor → node_modules 存在 ${problems.length} 处不同：`);
for (const p of problems) console.log('  ' + p);

if (CHECK_ONLY) {
  console.log('\n✗ CI 模式：跑 node scripts/sync-vendor-design-system.cjs 同步后再构建。');
  process.exit(1);
}

for (const rel of missing) {
  const s = join(SRC, 'src', rel);
  const d = join(DST, 'src', rel);
  try {
    writeFileSync(d, readFileSync(s, 'utf8'));
    console.log(`  + 写入 ${rel}`);
  } catch (e) {
    console.error(`  ! 写入失败 ${rel}: ${e.message}`);
    process.exit(1);
  }
}
for (const rel of diffs) {
  writeFileSync(join(DST, 'src', rel), readFileSync(join(SRC, 'src', rel), 'utf8'));
  console.log(`  = 覆盖 ${rel}`);
}

console.log(`\n✓ 已同步 ${missing.length + diffs.length} 个文件到 node_modules`);
console.log('  提醒：这是 node_modules 内的副本，CI 上跑构建前也必须执行本脚本。');
