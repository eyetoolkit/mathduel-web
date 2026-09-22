/**
 * 按环境决定是否把 legacy（旧站）资源打进产物。
 *
 * - 生产环境：不打进 —— 主站保持轻量，只含新架构内容
 * - beta 环境（VITE_SHOW_BETA=1）：打进 —— beta 站可运行尚未重写的老游戏
 *
 * 老游戏是自包含的旧站页面，依赖整套旧运行时（shared/*.js、i18n、旧 CSS），
 * 因此以「目录整体复制」的方式原样发布，不做构建，避免破坏内联脚本。
 */
import { cp, stat } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const legacyDir = resolve(root, 'legacy');
const distDir = resolve(root, 'dist');

const showBeta = process.env.VITE_SHOW_BETA === '1';

/**
 * 已用新架构重写并拥有 MPA 入口的 legacy 游戏 —— 不再拷贝，
 * 避免旧页面覆盖 vite build 产出的同名目录（dist/games/<id>/）。
 * 重写新游戏后把它加进这里。
 */
const REWRITTEN_LEGACY_GAMES = ['games/sudoku-6x6'];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

if (!showBeta) {
  console.log('[legacy] skipped (production build)');
  process.exit(0);
}

if (!(await exists(distDir))) {
  console.error('[legacy] dist 不存在，请先执行 vite build');
  process.exit(1);
}
if (!(await exists(legacyDir))) {
  console.error('[legacy] legacy 目录不存在');
  process.exit(1);
}

await cp(legacyDir, distDir, {
  recursive: true,
  filter: (src) => {
    // Windows 下 relative() 返回反斜杠路径，统一成正斜杠再匹配
    const rel = relative(legacyDir, src).split(sep).join('/');
    if (REWRITTEN_LEGACY_GAMES.some((g) => rel === g || rel.startsWith(g + '/'))) return false;
    return true;
  },
});
console.log('[legacy] copied into dist (beta build), excluded:', REWRITTEN_LEGACY_GAMES.join(', '));
