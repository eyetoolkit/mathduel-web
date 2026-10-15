#!/usr/bin/env node
/**
 * i18n 词典完整性守卫
 * ----------------------------------------------------------------
 * 为什么需要（2026-10-15 事故）：
 *   6 个 public/i18n/*.json 同时被加了一行 `"err_need_login": ...` 却漏了逗号，
 *   6 个文件全部 JSON.parse 失败。仓库里没有任何校验能拦住它 ——
 *   vite 不解析这些运行时资源，tsc 也不看，构建一路绿灯，
 *   只要一上线就是「全站 6 种语言同时塌掉」。
 *
 * 检查项：
 *   1. 每个语言文件必须是合法 JSON（硬失败）
 *   2. 各语言 key 集合必须与基准语言（en）完全一致（硬失败，防止漏译）
 *   3. 打印 key 总数与差异明细
 *
 * 接入：package.json 的 build / build:beta 已串上本脚本。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_DIR = join(ROOT, 'public', 'i18n');
const BASE = 'en';

/** 递归摊平嵌套对象成点分 key 路径 */
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.push(key);
  }
  return out;
}

const files = readdirSync(I18N_DIR).filter((f) => f.endsWith('.json'));
if (!files.length) {
  console.error('[check-i18n] ✗ public/i18n 下没有任何 .json');
  process.exit(1);
}

const dicts = new Map();
const parseFails = [];

for (const f of files) {
  const lang = f.replace(/\.json$/, '');
  const raw = readFileSync(join(I18N_DIR, f), 'utf8');
  try {
    dicts.set(lang, JSON.parse(raw));
  } catch (e) {
    parseFails.push({ lang, err: e.message });
  }
}

// ─── 1. JSON 合法性 ───
if (parseFails.length) {
  console.error(`[check-i18n] ✗ ${parseFails.length} 个词典文件 JSON 解析失败：`);
  for (const { lang, err } of parseFails) console.error(`         ${lang}.json → ${err}`);
  process.exit(1);
}

if (!dicts.has(BASE)) {
  console.error(`[check-i18n] ✗ 缺少基准语言 ${BASE}.json`);
  process.exit(1);
}

// ─── 2. key 对齐 ───
const baseKeys = new Set(flatten(dicts.get(BASE)));
const problems = [];

for (const [lang, d] of dicts) {
  if (lang === BASE) continue;
  const keys = new Set(flatten(d));
  const missing = [...baseKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !baseKeys.has(k));
  if (missing.length || extra.length) {
    problems.push({ lang, missing, extra });
  }
}

const total = baseKeys.size;

if (problems.length) {
  console.error(`[check-i18n] ✗ key 未对齐（基准 ${BASE}.json，共 ${total} 条）：`);
  for (const { lang, missing, extra } of problems) {
    console.error(`         ${lang}.json  缺 ${missing.length} / 多 ${extra.length}`);
    if (missing.length) console.error(`           缺: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`);
    if (extra.length) console.error(`           多: ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ' …' : ''}`);
  }
  process.exit(1);
}

console.log(`[check-i18n] ✓ ${dicts.size} 个语言文件全部合法且 key 对齐（各 ${total} 条）`);
