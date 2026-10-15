#!/usr/bin/env node
/**
 * 临时：把 public/i18n/*.json 相对 HEAD 的全部新增键，重建成
 * scripts/i18n-p1-3-additions.mjs 的完整 ADDITIONS 常量。
 *
 * 为什么要重建而不是手工补：
 *   这批键最初是分几路写进词典的 —— 一路走 ADDITIONS，另一路用临时脚本
 *   直接改 JSON。结果 ADDITIONS 只覆盖了 44 条/语言，实际有 168 条/语言，
 *   「从干净基线重放」这条路已经断了。重建后 ADDITIONS == 词典增量，
 *   任何人 checkout 到 HEAD 后跑一次 apply 都能得到完全一致的词典。
 *
 * 唯一真相源原则：本脚本从 git HEAD 的词典取基线，从工作区词典取增量，
 * 两者都不是从 ADDITIONS 推导 —— 避免「用 ADDITIONS 验证 ADDITIONS」。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];

const flat = (o, pfx = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${pfx}${k}.`) : [`${pfx}${k}`],
  );

const get = (obj, dotted) => dotted.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);

/** 单引号字符串转义：内容里的 ' 要转义，\ 也要转义 */
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const perLang = {};
for (const lang of LANGS) {
  const base = JSON.parse(
    execSync(`git show HEAD:public/i18n/${lang}.json`, { cwd: ROOT, maxBuffer: 1e8 }).toString(),
  );
  const now = JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', `${lang}.json`), 'utf8'));
  const a = new Set(flat(base));
  // 🔴 不只是新增键：对既有键的**文案修订**也必须进 ADDITIONS，
  //    否则 apply 的「值相同才跳过」规则拿不到新值，重放出来是旧文案。
  const changed = flat(now).filter((k) => !a.has(k) || get(base, k) !== get(now, k));
  const tree = {};
  for (const k of changed) {
    const [ns, ...rest] = k.split('.');
    (tree[ns] ||= {});
    let node = tree[ns];
    for (let i = 0; i < rest.length - 1; i++) node = (node[rest[i]] ||= {});
    node[rest[rest.length - 1]] = get(now, k);
  }
  perLang[lang] = { tree, count: changed.length };
}

// ── 序列化 ADDITIONS ─────────────────────────────────────────────
const emit = (obj, ind) => {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      lines.push(`${ind}${k}: {`);
      lines.push(...emit(v, ind + '  '));
      lines.push(`${ind}},`);
    } else {
      lines.push(`${ind}${k}: ${q(v)},`);
    }
  }
  return lines;
};

const bodyLines = [];
for (const lang of LANGS) {
  const { tree, count } = perLang[lang];
  bodyLines.push(`  // ${count} 条`);
  bodyLines.push(`  ${lang}: {`);
  for (const [ns, kv] of Object.entries(tree)) {
    bodyLines.push(`    ${ns}: {`);
    bodyLines.push(...emit(kv, '      '));
    bodyLines.push('    },');
  }
  bodyLines.push('  },');
}

const header = `/**
 * P1-3 多语言 · 新增键全集（6 语言）
 * ----------------------------------------------------------------
 * 来源：scan-html-i18n.mjs 的 HTML 扫描 + scan-hardcoded-i18n.mjs 的 TS 扫描
 *       + CDP 真机验收（切 zh/ja/es/fr/de 后残留的英文与原始 key 泄漏）。
 * 每条都对应一个真实可见的英文出口，键缺失时页面直接显示原始 key。
 *
 * 🔴 本文件是 public/i18n/*.json 相对 git HEAD 的**完整增量**
 *    （2026-10-15 用 scripts/_regen-additions.mjs 从 git 重建生成）。
 *    历史教训：新增键分散在「ADDITIONS + 若干临时脚本」两条路里写入，
 *    导致从干净基线无法重放词典。现在改为一处生成、一处应用。
 *
 * 用法：node scripts/i18n-apply-additions.mjs [--dry]
 *       —— 幂等；已存在的键会跳过。
 */

export const ADDITIONS = {
`;

const out = header + bodyLines.join('\n') + '\n};\n';
writeFileSync(join(ROOT, 'scripts', 'i18n-p1-3-additions.mjs'), out);

// 自检：生成的常量必须能 import 且键数与词典增量一致
// （Windows 上绝对路径不能直接 dynamic import，必须转 file:// URL —— 见 ERR_UNSUPPORTED_ESM_URL_SCHEME）
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'i18n-p1-3-additions.mjs')).href + '?t=' + Date.now());
for (const lang of LANGS) {
  const ks = flat(mod.ADDITIONS[lang]);
  if (ks.length !== perLang[lang].count) {
    throw new Error(`[${lang}] 生成键数 ${ks.length} ≠ 增量 ${perLang[lang].count}`);
  }
  console.log(`  ${lang}: ${ks.length} 条 ✓`);
}
console.log('\n✓ i18n-p1-3-additions.mjs 已重建');
