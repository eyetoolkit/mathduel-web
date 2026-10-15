#!/usr/bin/env node
/**
 * 验证 scripts/i18n-p1-3-additions.mjs 真的能从 git HEAD 基线完整重放。
 * ----------------------------------------------------------------
 * 做法：临时目录里 checkout HEAD 版 6 个词典 → 跑 apply-additions →
 *       与工作区词典逐字节比对。
 * 通过 = 「谁 clone 到 HEAD 跑一次 apply 就能得到完全一致的词典」成立。
 * 这是 additions 文件唯一有意义的验收方式 —— 只看它自己的 key 数不算数。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ['en', 'zh', 'ja', 'es', 'fr', 'de'];
const tmp = join(tmpdir(), `i18n-replay-${Date.now()}`);

try {
  mkdirSync(join(tmp, 'public', 'i18n'), { recursive: true });
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  for (const L of LANGS) {
    writeFileSync(
      join(tmp, 'public', 'i18n', `${L}.json`),
      execSync(`git show HEAD:public/i18n/${L}.json`, { cwd: ROOT, maxBuffer: 1e8 }),
    );
  }
  cpSync(join(ROOT, 'scripts', 'i18n-p1-3-additions.mjs'), join(tmp, 'scripts', 'i18n-p1-3-additions.mjs'));
  cpSync(join(ROOT, 'scripts', 'i18n-apply-additions.mjs'), join(tmp, 'scripts', 'i18n-apply-additions.mjs'));

  execSync('node scripts/i18n-apply-additions.mjs', { cwd: tmp, stdio: 'pipe' });

  /**
   * 比对必须是「语义相等」而不是逐字节相等。
   * 原因：重放时 ADDITIONS 里的新命名空间（coins）会被追加到文件末尾，
   * 而工作区里它是插在 common 之后的。JSON 对象的键顺序不影响 i18n 运行时
   * （一律走点分 key 查表），所以顺序差异不算失败 —— 但键缺失/值不同必须算。
   */
  const flat = (o, pfx = '') =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${pfx}${k}.`) : [`${pfx}${k}`],
    );
  const get = (o, dotted) => dotted.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

  let ok = true;
  for (const L of LANGS) {
    const replay = JSON.parse(readFileSync(join(tmp, 'public', 'i18n', `${L}.json`), 'utf8'));
    const actual = JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', `${L}.json`), 'utf8'));
    const rk = new Set(flat(replay));
    const miss = flat(actual).filter((k) => !rk.has(k));
    const wrong = flat(actual).filter((k) => rk.has(k) && get(replay, k) !== get(actual, k));
    const same = !miss.length && !wrong.length;
    if (!same) ok = false;
    console.log(`  ${L}: ${same ? '✓ 键集与取值完全一致' : `✗ 缺 ${miss.length} / 值不同 ${wrong.length}`}`);
    if (!same) {
      miss.slice(0, 5).forEach((k) => console.log(`      缺键 ${k}`));
      wrong.slice(0, 5).forEach((k) => console.log(`      值不同 ${k}`));
    }
  }
  if (!ok) {
    console.error('\n✗ 重放验证失败 —— additions 已不是词典增量的完整来源\n');
    process.exit(1);
  }
  console.log('\n✓ additions 可从干净基线完整重放\n');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
