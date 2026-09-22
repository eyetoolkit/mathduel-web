import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * MathDuel 前端构建
 * - 多页应用（MPA）：首页 + 每款游戏一个 HTML 入口，产出干净路径（/games/24-game/）
 * - 无运行时注入壳：所有样式/脚本在构建期确定，保证「线上 = 预览」
 */
export default defineConfig({
  root: '.',
  base: '/',
  plugins: [
    {
      // 生产环境未注入变量时，Vite 会保留 %VITE_XXX% 占位符，这里统一清掉
      name: 'strip-env-placeholders',
      transformIndexHtml(html) {
        return html.replace(/%VITE_[A-Z0-9_]+%/g, '');
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: {
        home: resolve(here, 'index.html'),
        '24-game': resolve(here, 'games/24-game/index.html'),
        '24-game-lobby': resolve(here, 'games/24-game/lobby/index.html'),
        bulls: resolve(here, 'games/bulls/index.html'),
        'sudoku-6x6': resolve(here, 'games/sudoku-6x6/index.html'),
        'sudoku-6x6-lobby': resolve(here, 'games/sudoku-6x6/lobby/index.html'),
        'sudoku': resolve(here, 'games/sudoku/index.html'),
        'sudoku-lobby': resolve(here, 'games/sudoku/lobby/index.html'),
        'killer-sudoku': resolve(here, 'games/killer-sudoku/index.html'),
        'killer-sudoku-lobby': resolve(here, 'games/killer-sudoku/lobby/index.html'),
        'number-pyramid': resolve(here, 'games/number-pyramid/index.html'),
        'number-pyramid-lobby': resolve(here, 'games/number-pyramid/lobby/index.html'),
      },
    },
  },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
