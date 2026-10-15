#!/usr/bin/env node
/**
 * 把 ADDITIONS 幂等地写进 public/i18n/{lang}.json
 * ----------------------------------------------------------------
 * 🔴 为什么不按行插入（2026-10-15 踩坑记录）：
 *   最初版本试图「找到命名空间块的末行 → 在它前面插几行」。
 *   在这个仓库里连续失败 4 次：
 *     1. 「向后找第一个 /^  \}/ 的行」会切错块 —— 词典里嵌套着同形态的行
 *     2. 补尾逗号的判断依据（`}` vs `},`）在不同文件里结论相反
 *     3. Node 的 JSON.parse 报错「位置」在有 emoji（代理对）时会指向错误的行，
 *        按报错行去改，越改越坏
 *     4. 回退脚本按「键+值」整行匹配，会误删本来就存在的同名键
 *
 * ✅ 现在采用「解析 → 改对象 → 稳定序列化写回」：
 *   - JSON.parse 已经把真值读进来，结构性问题在内存里就暴露了
 *   - 序列化后必然是合法 JSON（不需要猜逗号）
 *   - 已验证：这些文件里没有「同名键在同一命名空间内重复」的情况，
 *     JSON.parse 不会吞掉任何键（跨命名空间同名是允许的，序列化保留）
 *   - 缩进/键序与原文件一致（2空格 + 原顺序）
 *
 * 🔴 幂等的正确含义（2026-10-15 修正）：
 *   不是「键存在就跳过」，而是「值相同就跳过」。
 *   ADDITIONS 里既有纯新增键，也有对既有键的**文案修订**；按存在性跳过
 *   会让修订永远重放不出来 —— 实测 math_home.btn_exchange 就这样漏过：
 *   工作区是新文案，从 HEAD 重放出来是旧文案，两边悄悄分叉。
 *   所以判定改成 `dict[ns][k] === v ? skip : write`。
 *
 *   另：命名空间不存在时自动创建（新增功能自带新词典段，如 coins），
 *   早期版本直接 throw，导致「从 HEAD 基线重放」永远失败 —— HEAD 里
 *   当然还没有 coins 段。
 *
 * 🔴🔴 用法红线：**绝对不要对单个 public/i18n/*.json 跑 `git checkout` / `git restore`**。
 *
 * 事故记录（2026-10-15，本仓库真实发生）：
 *   为修 de 的 3 处 ASCII 转义（fuellen→füllen），执行了
 *     git checkout public/i18n/de.json
 *   结果把 de 本轮新增的 **219 条**（coins 43 / mg 135 / mp 28 / common 4 …）一次性抹掉。
 *   更糟的是 `scripts/i18n-p1-3-additions.mjs` 是**未跟踪文件**且刚被 regen 按回滚后的
 *   状态覆盖过 —— 基线和增量同时失效，git 也救不回来，
 *   de 从 1126 条掉到 907 条，只能逐条重译（见 _de-restore.mjs 的教训）。
 *
 *   正确做法：
 *     1. 单文件改前后各跑一次 `node scripts/check-i18n.mjs`，盯住「各 NNNN 条」有没有掉；
 *     2. 真要回退某语言，用 `node scripts/i18n-apply-additions.mjs` 重放增量，别用 git；
 *     3. 想批量替换某个语言里的字符串，先 `cp` 一份 `.bak` 再改，改完立刻 diff .bak。
 *
 * 用法：node scripts/i18n-apply-additions.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDITIONS } from './i18n-p1-3-additions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];
const dry = process.argv.includes('--dry');

/** 递归摊平成点分 key（用于对齐检查） */
const flat = (o, pfx = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${pfx}${k}.`) : [`${pfx}${k}`],
  );

let totalAdded = 0;
const report = [];

for (const lang of LANGS) {
  const p = join(ROOT, 'public', 'i18n', `${lang}.json`);
  const dict = JSON.parse(readFileSync(p, 'utf8'));
  const add = ADDITIONS[lang];
  if (!add) throw new Error(`ADDITIONS 缺少语言：${lang}`);

  const addedKeys = []; // {ns, key}，直接存两段，避免事后切分点分键出错
  const createdNs = [];
  for (const [ns, kv] of Object.entries(add)) {
    if (!dict[ns] || typeof dict[ns] !== 'object') {
      // 🔴 命名空间不存在 = 这一批键引入了全新命名空间（如 coins），
      //    属于正常情况（新增功能自带新词典段），不是打错字。
      //    早期版本在这里直接 throw，导致「从 HEAD 基线重放」永远失败 ——
      //    因为 HEAD 里当然还没有 coins 段。
      dict[ns] = {};
      createdNs.push(ns);
    }
    for (const [k, v] of Object.entries(kv)) {
      // 🔴 幂等不等于「已存在就跳过」。
      //    键已存在但**值不同**说明这是一次文案修订，必须覆盖 —— 否则
      //    「从 HEAD 重放」会拿到旧文案，而工作区是新的，两者悄悄分叉。
      //    （2026-10-15 实测：math_home.btn_exchange 就是这样漏掉的。）
      //    值相同才跳过，这样重跑不产生噪音 diff。
      if (dict[ns][k] === v) continue;
      const existed = k in dict[ns];
      dict[ns][k] = v;
      addedKeys.push({ ns, key: k, label: `${ns}.${k}`, kind: existed ? '改' : '增' });
    }
  }

  const out = JSON.stringify(dict, null, 2) + '\n';
  // 自检：写回的内容必须能重新解析，且每条变更都真的落到文件里
  const verify = JSON.parse(out);
  for (const { ns, key, label, kind } of addedKeys) {
    if (verify[ns]?.[key] === undefined) {
      throw new Error(`[${lang}] 写入后仍缺键：${label}`);
    }
    if (verify[ns][key] !== ADDITIONS[lang][ns][key]) {
      throw new Error(`[${lang}] 写入后值不一致：${label}（${kind}）`);
    }
  }

  if (addedKeys.length && !dry) writeFileSync(p, out);
  totalAdded += addedKeys.length;
  const nUpd = addedKeys.filter((k) => k.kind === '改').length;
  const parts = [`+${addedKeys.length - nUpd}`];
  if (nUpd) parts.push(`改${nUpd}`);
  const nsNote = createdNs.length ? `（新建命名空间 ${createdNs.join(', ')}）` : '';
  report.push(`  ${lang}: ${parts.join(' / ')} → ${flat(verify).length} 条 ${nsNote}`);
}

console.log(`\n[apply-additions] ${dry ? 'DRY-RUN' : '已写入'}，新增 ${totalAdded} 条`);
console.log(report.join('\n'));

/** 跨语言 key 对齐复核 */
const dicts = LANGS.map((l) => JSON.parse(readFileSync(join(ROOT, 'public/i18n', `${l}.json`), 'utf8')));
const base = new Set(flat(dicts[0]));
let bad = 0;
for (let i = 1; i < dicts.length; i++) {
  const cur = new Set(flat(dicts[i]));
  const miss = [...base].filter((k) => !cur.has(k));
  const extra = [...cur].filter((k) => !base.has(k));
  if (miss.length || extra.length) {
    bad++;
    console.log(`  ✗ ${LANGS[i]} 缺 ${miss.length} / 多 ${extra.length}：${[...miss, ...extra].slice(0, 5).join(', ')}`);
  }
}
if (bad) {
  console.error('\n✗ key 未对齐，退出码 1\n');
  process.exit(1);
}
console.log(`\n✓ 6 语言 key 完全对齐（各 ${base.size} 条）\n`);
