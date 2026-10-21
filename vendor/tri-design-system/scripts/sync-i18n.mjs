#!/usr/bin/env node
/**
 * sync-i18n.mjs — 把 design-system 里的「唯一 i18n 运行时真相源」推送到三站 public/i18n/
 *
 * 为什么需要它：
 *   boardduel / memoryduel 是纯静态 Vite 站，靠 <script src="/i18n/i18n.js"> 加载运行时，
 *   且它们并不直接依赖 @tri-sites/design-system。为避免「三站各抄一份、日后分叉」，
 *   运行时只在此处维护一份（src/i18n/runtime/），由本脚本同步到各站。
 *
 * 用法（在 design-system 目录下）：
 *   node scripts/sync-i18n.mjs            # 推送到所有存在的目标站
 *   node scripts/sync-i18n.mjs --check    # 只校验三站副本是否与源一致，不写入
 *   node scripts/sync-i18n.mjs --dry      # 打印将要做的事，不写入
 *
 * 安全：默认只覆盖 i18n.js / lang-switcher.js 两个运行时文件，绝不碰各站自己的 *.json 字典。
 */

import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
// design-system 位于 <repo>/vendor/tri-design-system/scripts，上溯四级即三站根目录（/d/GAME）
const ROOT = resolve(HERE, '../../../../');

const SRC_DIR = resolve(HERE, '../src/i18n/runtime');
const RUNTIME_FILES = ['i18n.js', 'lang-switcher.js'];

const TARGET_REPOS = ['mathduel-web', 'boardduel-web', 'memoryduel-web'];

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const DRY = args.includes('--dry');

function sha1(path) {
  // 轻量内容指纹，仅用于「源 vs 副本」一致性校验
  const buf = readFileSync(path);
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
}

let failures = 0;
const report = [];

for (const repo of TARGET_REPOS) {
  const destDir = resolve(ROOT, repo, 'public/i18n');
  if (!existsSync(destDir)) {
    report.push(`⊘ ${repo}: public/i18n 不存在，跳过`);
    continue;
  }
  for (const file of RUNTIME_FILES) {
    const src = resolve(SRC_DIR, file);
    const dest = resolve(destDir, file);
    if (!existsSync(src)) {
      report.push(`✗ ${repo}/${file}: 源文件缺失 ${src}`);
      failures++;
      continue;
    }
    const srcHash = await sha1(src);
    const destExists = existsSync(dest);
    const destHash = destExists ? await sha1(dest) : '(none)';
    const same = destExists && srcHash === destHash;

    if (CHECK_ONLY) {
      report.push(`${same ? '✓' : '✗'} ${repo}/${file}: src=${srcHash} dst=${destHash}${same ? '' : '  <-- 不一致'}`);
      if (!same) failures++;
      continue;
    }
    if (DRY) {
      report.push(`· ${repo}/${file}: 将写入 (src=${srcHash})`);
      continue;
    }
    if (same) {
      report.push(`= ${repo}/${file}: 已一致 (${srcHash})`);
      continue;
    }
    copyFileSync(src, dest);
    report.push(`↑ ${repo}/${file}: 已同步 (${srcHash})`);
  }
}

console.log('\n[i18n sync] ' + (CHECK_ONLY ? 'CHECK' : DRY ? 'DRY' : 'SYNC'));
console.log(report.join('\n'));
console.log(`\n结果: ${failures === 0 ? '全部一致 ✓' : failures + ' 处不一致 ✗'}`);
process.exit(failures === 0 ? 0 : 1);
