/* === 通用竞赛外壳（1v1+多人+随机匹配） === */
import { mountCompetition } from "../_shared/mp-client";
import { createSudokuAdapter } from "../_shared/mp-adapters/sudoku";
/**
 * 6×6 数独 · UI 编排（beta 版：全部本地，无 API 依赖）
 * 模式：solo（3 难度）/ daily（seeded 每日一题）/ timed（45s 连解）/ duel（vs 本地 bot 竞速）
 * 视觉：24 ARENA 同款 token（body.arena remap），ember=你、teal=bot/冲突、paper=固定线索
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
import '../24-game/styles.css';
import '../24-game/arena.css';
import './s6.css';
import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import {
  colOf,
  dailyPuzzle,
  duelDeal,
  findConflicts,
  generatePuzzle,
  boxOf,
  rowOf,
  shanghaiDateKey,
  mulberry32,
  hashString,
  type Difficulty,
  type Grid,
  type Puzzle,
} from './engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'MathDuel',
  brandSub: 'Sudoku 6×6',
  mark: '▦',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    ],
});

type Mode = 'solo' | 'daily' | 'timed' | 'duel';

const TIMED_LIMIT = 45;
const DUEL_PENALTY = 2.5; // 填错罚时（秒）
const DUEL_PAR = 34; // 速度环满环时间（秒）
const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

const diffLabel = (d: Difficulty): string => ({ easy: 'Easy', standard: 'Standard', hard: 'Hard' })[d];

/* ─── 状态 ─── */
const st = {
  view: 'lobby' as 'lobby' | 'play',
  mode: 'solo' as Mode,
  diff: 'standard' as Difficulty,
  puzzle: null as Puzzle | null,
  grid: new Array(36).fill(0) as Grid, // 当前值（含玩家+bot 填入）
  owner: new Array(36).fill(0) as number[], // 0 公共 / 1 玩家格 / 2 bot 格（duel）
  filledBy: new Array(36).fill(0) as number[], // 1 玩家填 / 2 bot 填（着色）
  sel: -1,
  running: false,
  startTs: 0,
  elapsed: 0,
  penalty: 0,
  timer: null as number | null,
  // duel
  mineTotal: 0,
  mineDone: 0,
  botTotal: 0,
  botDone: 0,
  botTimer: null as number | null,
  botNext: 0,
  // timed
  timedSolved: 0,
  timedDealt: 0, // 本轮共发过几盘（solved 与 dealt 之差 = unsolved）
  timedStreak: 0,
  timedStartTs: 0,
  // solo/timed 错误计数
  mistakes: 0,
};

let conflictCache: Set<number> = new Set();

const LS_BEST = 's6_best_v1';
const LS_DAILY = 's6_daily_v1';
const readJSON = <T>(k: string, fb: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};
const writeJSON = (k: string, v: unknown): void => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch { /* ignore */ }
};
const fmt = (sec: number): string => `${sec.toFixed(1)}s`;

/* ═══ 模式选择页（独立 MPA 入口，与 24 点 lobby 同构）═══ */
const LOBBY_URL = '/games/sudoku-6x6/lobby/';
const goLobby = (): void => {
  location.href = LOBBY_URL;
};

function enterMode(m: Mode): void {
  stopAll();
  st.view = 'play';
  st.mode = m;
  document.querySelectorAll<HTMLButtonElement>('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  const duel = m === 'duel';
  $('oppHead')!.classList.toggle('hidden', !duel);
  $('youHead')!.classList.toggle('hidden', !duel);
  $('chatDock')!.classList.toggle('hidden', !duel);
  $('diffPick')!.style.display = m === 'daily' ? 'none' : '';
  $('padTools')!.classList.toggle('hidden', m === 'daily');
  $('hintBtn')!.style.display = '';
  if (duel) botTrashTalk('hello');
  startRound();
}

function stopAll(): void {
  if (st.timer) window.clearInterval(st.timer);
  if (st.botTimer) window.clearTimeout(st.botTimer);
  st.timer = null;
  st.botTimer = null;
  st.running = false;
}

/* ═══ 开局 ═══ */
function startRound(): void {
  stopAll();
  const m = st.mode;
  if (m === 'timed') {
    st.timedStartTs = Date.now();
    st.timedDealt = 1; // 首盘已发出
  }
  if (m === 'daily') {
    const dk = shanghaiDateKey();
    st.puzzle = dailyPuzzle(dk);
    banner(`<div class="banner daily"><div class="daily-top"><div class="daily-meta"><div class="b-title">🌐 Daily Grid #${dk}</div><div class="b-sub">One seeded puzzle worldwide · Standard · finish to log today</div></div></div></div>`);
  } else if (m === 'duel') {
    const rng = mulberry32((Date.now() ^ hashString(String(performance.now()))) >>> 0);
    st.puzzle = duelDeal(st.diff, rng) as Puzzle;
    banner('<div class="banner daily"><div class="daily-top"><div class="daily-meta"><div class="b-title">🤖 Duel Bot · claim your half</div><div class="b-sub">Fill only the cells with an ember corner · wrong digits cost +2.5s</div></div></div></div>');
  } else {
    st.puzzle = newRoundPuzzle();
    banner(
      m === 'timed'
        ? `<div class="banner daily timed"><div class="daily-top"><div class="daily-meta"><div class="b-title">⏱ Timed · ${TIMED_LIMIT}s per grid</div><div class="b-sub">Solved <b id="tmSolved">0</b> · Streak <b id="tmStreak">0</b> · wrong digits just flash</div></div></div></div>`
        : `<div class="banner"><div class="daily-top"><div class="daily-meta"><div class="b-title">🎯 Solo · ${diffLabel(st.diff)}</div><div class="b-sub">Unique solution · best time saved locally</div></div></div></div>`,
    );
  }
  resetBoard();
  renderBoard();
  renderSide();
  beginTimer();
  if (st.mode === 'duel') scheduleBot();
}

let roundNonce = 0;
function newRoundPuzzle(): Puzzle {
  // 轻量熵：时间 XOR 递增计数，避免「New Grid」连点重复
  roundNonce = (roundNonce + 1) | 0;
  return generatePuzzle(st.diff, mulberry32((Date.now() ^ (roundNonce * 0x9e3779b9)) >>> 0));
}

function resetBoard(keepClock = false): void {
  const p = st.puzzle!;
  st.grid = p.puzzle.slice();
  st.owner = new Array(36).fill(0);
  st.filledBy = new Array(36).fill(0);
  st.sel = -1;
  st.penalty = 0;
  if (!keepClock) {
    st.elapsed = 0;
    st.startTs = Date.now();
    st.mistakes = 0;
  }
  st.running = true;
  conflictCache = findConflicts(st.grid);
  st.mineDone = 0;
  st.botDone = 0;
  if (st.mode === 'duel') {
    const d = st.puzzle as Puzzle & { mine: Set<number>; bots: Set<number> };
    for (const i of d.mine) st.owner[i] = 1;
    for (const i of d.bots) st.owner[i] = 2;
    st.mineTotal = d.mine.size;
    st.botTotal = d.bots.size;
    $('youSub')!.textContent = `your cells: ${st.mineTotal}`;
    $('oppSub')!.textContent = botPaceText();
    renderOppStatus();
  }
  $('result')!.textContent = st.mode === 'duel' ? 'Claim your cells before GridBot' : 'Pick a cell, then a number';
}

const botPaceText = (): string =>
  ({ easy: 'easy pace · ~4.6s per cell', standard: 'standard pace · ~3.4s per cell', hard: 'hard pace · ~2.5s per cell' })[st.diff];

/** 我负责的格子里已填对的个数（动态统计，erase/改数后仍准确） */
function correctMine(): number {
  let n = 0;
  for (let i = 0; i < 36; i++) if (st.owner[i] === 1 && st.grid[i] && st.grid[i] === st.puzzle!.solution[i]) n++;
  return n;
}

/* ═══ 计时 ═══ */
function beginTimer(): void {
  if (st.timer) window.clearInterval(st.timer);
  st.timer = window.setInterval(tick, 100);
  tick();
}

function effElapsed(): number {
  return (Date.now() - st.startTs) / 1000 + st.penalty;
}

function tick(): void {
  if (!st.running) return;
  st.elapsed = effElapsed();
  if (st.mode === 'timed') {
    const left = Math.max(0, TIMED_LIMIT - (Date.now() - st.timedStartTs) / 1000);
    $('stMain')!.innerHTML = `⏱ <b>${left.toFixed(1)}s</b> · ✅ ${st.timedSolved}`;
    const tms = $('tmSolved');
    if (tms) tms.textContent = String(st.timedSolved);
    const tmsk = $('tmStreak');
    if (tmsk) tmsk.textContent = String(st.timedStreak);
    if (left <= 0) endTimed();
  } else if (st.mode === 'duel') {
    $('stMain')!.innerHTML = `⏱ <b>${st.elapsed.toFixed(1)}s</b>`;
    const frac = Math.min(1, st.elapsed / DUEL_PAR);
    const ring = $('speedRingFill')!;
    ring.style.strokeDashoffset = String(RING_C * frac);
    ring.classList.toggle('low', frac > 0.75);
    $('speedRingTxt')!.textContent = st.elapsed.toFixed(0) + 's';
  } else {
    $('stMain')!.innerHTML = `⏱ <b>${st.elapsed.toFixed(1)}s</b>`;
  }
}

/* ═══ 棋盘渲染 ═══ */
function cellClass(i: number): string {
  const cls = ['c6cell'];
  // 2×3 块线：竖粗线在 col3 后（0-based col 2），横粗线在每个 2 行块末行后
  if (colOf(i) === 2) cls.push('bx-c');
  if (rowOf(i) % 2 === 1) cls.push('bx-r');
  if (st.puzzle!.puzzle[i]) cls.push('given');
  else if (st.filledBy[i] === 2) cls.push('bot');
  else if (st.grid[i]) cls.push('entry');
  if (st.sel === i) cls.push('sel');
  if (conflictCache.has(i)) cls.push('conflict');
  if (st.mode === 'duel' && st.owner[i] === 1 && !st.grid[i]) cls.push('lock');
  if (st.mode === 'duel' && st.owner[i] === 0 && !st.grid[i] && !st.puzzle!.puzzle[i]) cls.push('free');
  if (st.sel >= 0 && st.grid[st.sel]) {
    if (i !== st.sel && (rowOf(i) === rowOf(st.sel) || colOf(i) === colOf(st.sel) || boxOf(i) === boxOf(st.sel))) cls.push('peer');
    if (i !== st.sel && st.grid[i] && st.grid[i] === st.grid[st.sel]) cls.push('same');
  }
  return cls.join(' ');
}

function renderBoard(): void {
  const el = $('s6board')!;
  if (!el.dataset.built) {
    el.innerHTML = [...Array(36)].map((_, i) => `<div class="c6cell" data-i="${i}" role="gridcell"></div>`).join('');
    el.dataset.built = '1';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (t) selectCell(Number(t.dataset.i));
    });
    // 首次构建棋盘后注入 SVG 网格线覆盖层（粗 2×3 宫 + 细线），并监听尺寸/DPR 变化
    buildGridLines(el);
  }
  conflictCache = findConflicts(st.grid);
  [...el.children].forEach((cell, i) => {
    const c = cell as HTMLElement;
    const v = st.grid[i];
    const cls = cellClass(i);
    if (c.className !== cls) c.className = cls;
    const html = v ? `<span>${v}</span>` : '';
    if (c.innerHTML !== html) c.innerHTML = html;
  });
  updateGridStats();
}

/* ════════ 2026-09-26 修复：SVG 网格线覆盖层 ════════
   根因：① 1px border 在小数 DPR 下细线深浅不一/消失；② 暗色主题下细线/粗线同色同宽感
         → 宫结构不可见（用户反馈「棋盘显示异常」）
   方案：JS 按当前 DPR 生成 SVG rect 网格线（shape-rendering: crispEdges 逐线吸附整数设备像素）。
         细线 = 1 物理px，2×3 宫粗线 = 2 物理px 且用更亮的 --sd-grid-line-strong。
         ResizeObserver 监听尺寸变化 + matchMedia('resolution') 监听缩放/DPR 变化 → 重建。 */
function buildGridLines(board: HTMLElement): void {
  const build = (): void => {
    const old = board.querySelector('.grid-lines');
    if (old) old.remove();
    const dpr = window.devicePixelRatio || 1;
    const W = board.clientWidth; // padding-box 宽（含 2px border）
    if (!W) return;
    // 因棋盘 border: 2px，content 区 = W - 4px；用 clientWidth 整体绘制，border 由 cell 自身外侧负责
    const cell = W / 6;
    const thin = 1 / dpr, thick = 2 / dpr;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'grid-lines');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + W);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    const rect = (x: number, y: number, w: number, h: number, strong: boolean): void => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(h));
      // 读取棋盘当前主题 token，颜色随主题切换
      const cs = getComputedStyle(board);
      const colorVar = strong ? '--sd-grid-line-strong' : '--sd-grid-line';
      const color = cs.getPropertyValue(colorVar).trim() || (strong ? '#1e1b39' : '#64748b');
      r.style.fill = color;
      svg.appendChild(r);
    };
    for (let i = 1; i <= 5; i++) {
      // 竖线：第 3 列后 = 粗线（0-based col 2 → i=3）
      const vt = i === 3 ? thick : thin;
      rect(i * cell - vt / 2, 0, vt, W, i === 3);
      // 横线：第 2、4 行后 = 粗线（每 2 行一条粗线）
      const ht = i === 2 || i === 4 ? thick : thin;
      rect(0, i * cell - ht / 2, W, ht, i === 2 || i === 4);
    }
    board.appendChild(svg);
  };
  const schedule = (): void => { requestAnimationFrame(build); };
  schedule();
  window.addEventListener('resize', schedule);
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(board);
  // DPR/缩放变化监听：resolution 媒体查询一次性监听链
  const watchDpr = (): void => {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', () => { schedule(); watchDpr(); }, { once: true });
  };
  watchDpr();
}

/* ═══ 侧栏 Grid status 实时刷新 + 数字键盘剩余计数 ═══ */
function updateGridStats(): void {
  const filled = $('statFilled');
  if (filled) filled.textContent = `${st.grid.filter((v) => v).length}/36`;
  const m = $('statMistakes');
  if (m) m.textContent = String(st.mistakes);
  updatePad();
}

function updatePad(): void {
  const pad = $('s6pad');
  if (!pad) return;
  pad.querySelectorAll<HTMLButtonElement>('.pk[data-v]').forEach((b) => {
    const v = Number(b.dataset.v);
    const left = 6 - st.grid.filter((x) => x === v).length;
    const badge = b.querySelector('.pk-left');
    if (badge) badge.textContent = left > 0 ? String(left) : '';
    b.classList.toggle('done', left <= 0);
  });
}

function selectCell(i: number): void {
  if (!st.running) return;
  if (st.mode === 'duel' && st.owner[i] === 2) {
    toast('🤖 That cell is GridBot\u2019s to fill');
    return;
  }
  if (st.puzzle!.puzzle[i]) {
    st.sel = i; // given 也允许选中做 peer/same 高亮
    renderBoard();
    return;
  }
  st.sel = i;
  renderBoard();
}

/* ═══ 填数 ═══ */
let padNudgeAt = 0;
function nudgePick(): void {
  const now = Date.now();
  if (now - padNudgeAt < 2000) return; // 2s 节流，避免连点刷屏
  padNudgeAt = now;
  toast('👆 Pick a cell first');
}

/** 落子/冲突的一次性动效（直接挂 class，下一次 renderBoard 自然移除） */
function flashCell(i: number, cls: string, ms: number): void {
  const el = $('s6board')!.children[i] as HTMLElement | undefined;
  if (!el) return;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

/** 从 from 之后（环绕）找下一个可填空格；无则 -1 */
function nextClaimable(from: number): number {
  for (let k = 1; k <= 36; k++) {
    const i = (from + k) % 36;
    if (st.grid[i] || st.puzzle!.puzzle[i]) continue;
    if (st.mode === 'duel' && st.owner[i] !== 1) continue;
    return i;
  }
  return -1;
}

function place(v: number): void {
  if (!st.running) return;
  if (st.sel < 0) {
    nudgePick();
    return;
  }
  const i = st.sel;
  if (st.puzzle!.puzzle[i]) {
    toast('📌 That clue is fixed');
    return;
  }
  if (st.mode === 'duel' && st.owner[i] !== 1) {
    toast('🏁 Free cells unlock after duels — claim yours');
    return;
  }
  st.grid[i] = v;
  st.filledBy[i] = 1;
  const conflicts = findConflicts(st.grid);
  if (conflicts.has(i)) {
    st.mistakes++;
    st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
    if (st.mode === 'duel') toast(`⚔️ Conflict! +${DUEL_PENALTY}s penalty`);
    st.sel = i;
    renderBoard();
    flashCell(i, 'shake', 400);
    window.setTimeout(() => {
      if (st.grid[i] === v) {
        st.grid[i] = 0;
        st.filledBy[i] = 0;
        renderBoard();
      }
    }, 650);
    return;
  }
  if (st.mode === 'duel') {
    renderOppStatus();
    botTrashTalk('playerFill');
  }
  const nx = nextClaimable(i);
  st.sel = nx >= 0 ? nx : i; // 填对后自动跳到下一空格，连解提速
  renderBoard();
  flashCell(i, 'pop', 320);
  checkWin();
}

function erase(): void {
  if (!st.running) return;
  if (st.sel < 0) {
    nudgePick();
    return;
  }
  const i = st.sel;
  if (st.puzzle!.puzzle[i] || st.filledBy[i] === 2) return;
  st.grid[i] = 0;
  st.filledBy[i] = 0;
  renderBoard();
}

/* ═══ 胜负 ═══ */
function checkWin(): void {
  if (!st.puzzle) return;
  if (st.mode === 'duel') {
    // duel：自己负责的格子全部填对（错格 650ms 后弹回 / 可改）即胜
    if (correctMine() >= st.mineTotal) {
      st.running = false;
      if (st.timer) window.clearInterval(st.timer);
      finishDuel(true);
    }
    return;
  }
  const complete = st.grid.every((v, i) => v === st.puzzle!.solution[i]);
  if (!complete) return;
  st.running = false;
  if (st.timer) window.clearInterval(st.timer);
  if (st.mode === 'timed') winTimed();
  else winSoloDaily();
}

function winSoloDaily(): void {
  const t = st.elapsed;
  let extra = '';
  if (st.mode === 'daily') {
    const dk = shanghaiDateKey();
    const d = readJSON<Record<string, number>>(LS_DAILY, {});
    if (!d[dk]) {
      d[dk] = Math.round(t * 10) / 10;
      writeJSON(LS_DAILY, d);
      extra = '<div class="s6-newbest">🌐 Daily grid logged — see you tomorrow!</div>';
    } else {
      extra = '<div class="s6-newbest">Already logged today — replay doesn\u2019t overwrite.</div>';
    }
  } else {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const k = st.diff;
    if (!b[k] || t < b[k]) {
      b[k] = Math.round(t * 10) / 10;
      writeJSON(LS_BEST, b);
      extra = '<div class="s6-newbest">🥇 New personal best!</div>';
    }
  }
  $('result')!.innerHTML = `✅ Solved in <b>${fmt(t)}</b>${extra}`;
  showModal(
    '<div class="s6-verdict">Grid complete 🎉</div>' +
      `<div class="s6-scores"><div class="me num">${fmt(t)}<small>your time</small></div></div>` +
      extra +
      '<div class="s6-acts"><button class="btn primary" id="mAgain">↻ New grid</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
    () => {
      $('mAgain')!.onclick = () => {
        hideModal();
        startRound();
      };
      $('mLobby')!.onclick = () => {
        hideModal();
        goLobby();
      };
    },
  );
}

/* ═══ Timed ═══ */
function winTimed(): void {
  st.timedSolved++;
  st.timedStreak++;
  window.setTimeout(() => {
    // 45s 整场窗口过后不再续盘
    if (st.mode === 'timed' && (Date.now() - st.timedStartTs) / 1000 < TIMED_LIMIT && st.puzzle) {
      st.puzzle = newRoundPuzzle();
      st.timedDealt++; // 续盘也算发出
      resetBoard(true);
      renderBoard();
      beginTimer(); // checkWin 胜利时清了计时器，续盘需重建
      $('result')!.innerHTML = `✅ #${st.timedSolved} · ${st.timedStreak} streak — next grid!`;
    }
  }, 1500); // 与 24 点 Timed 对齐：留足时间看清完成盘面
  $('result')!.innerHTML = `✅ #${st.timedSolved} in <b>${fmt(st.elapsed)}</b> — next grid incoming…`;
}

function endTimed(): void {
  stopAll();
  $('stMain')!.innerHTML = '⏱ Time!';
  const unsolved = Math.max(0, st.timedDealt - st.timedSolved); // 发出 − 解出 = 没解完的
  showModal(
    '<div class="s6-verdict">⏱ Time\u2019s up</div>' +
      `<div class="s6-scores"><div class="me num">${st.timedSolved}<small>solved</small></div>` +
      `<div class="op num">${st.timedStreak}<small>best streak</small></div>` +
      `<div class="op num">${unsolved}<small>unsolved</small></div></div>` +
      '<div class="s6-acts"><button class="btn primary" id="mAgain">↻ Run it again</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
    () => {
      $('mAgain')!.onclick = () => {
        hideModal();
        st.timedSolved = 0;
        st.timedStreak = 0;
        startRound();
      };
      $('mLobby')!.onclick = () => {
        hideModal();
        goLobby();
      };
    },
  );
}

/* ═══ Duel bot ═══ */
function scheduleBot(): void {
  const pace = { easy: 4600, standard: 3400, hard: 2500 }[st.diff];
  const jitter = () => pace * (0.6 + Math.random() * 0.9);
  const step = (): void => {
    if (!st.running || st.mode !== 'duel') return;
    const d = st.puzzle as Puzzle & { bots: Set<number> };
    const remaining = [...d.bots].filter((i) => !st.grid[i]);
    if (!remaining.length) {
      finishDuel(false);
      return;
    }
    const i = remaining[Math.floor(Math.random() * remaining.length)];
    st.grid[i] = st.puzzle!.solution[i];
    st.filledBy[i] = 2;
    st.botDone++;
    renderOppStatus();
    renderBoard();
    botTrashTalk('botFill');
    if (st.botDone >= st.botTotal) {
      finishDuel(false);
      return;
    }
    st.botTimer = window.setTimeout(step, jitter());
  };
  st.botTimer = window.setTimeout(step, 1800);
}

function renderOppStatus(): void {
  const s = $('oppStatus')!;
  s.innerHTML = `<span class="d"></span>Filled ${st.botDone}/${st.botTotal}`;
  s.classList.toggle('done', st.botDone >= st.botTotal);
  const you = $('youSub')!;
  if (you) you.textContent = `your cells: ${correctMine()}/${st.mineTotal}`;
}

function finishDuel(playerWon: boolean): void {
  stopAll();
  const t = st.elapsed;
  const verdict = playerWon ? 'You win 🏆' : 'GridBot wins 🤖';
  const mine = playerWon ? fmt(t) : `${correctMine()}/${st.mineTotal}`;
  const bots = playerWon ? `${st.botDone}/${st.botTotal}` : fmt(t);
  $('result')!.innerHTML = playerWon
    ? `🏆 You filled your half in <b>${fmt(t)}</b> — GridBot stalled at ${st.botDone}/${st.botTotal}`
    : `🤖 GridBot finished first (${fmt(t)}) — you had ${correctMine()}/${st.mineTotal}`;
  showModal(
    `<div class="s6-verdict">${verdict}</div>` +
      `<div class="s6-scores"><div class="me num">${mine}<small>you</small></div><div class="op num">${bots}<small>GridBot</small></div></div>` +
      '<div class="s6-acts"><button class="btn primary" id="mAgain">⚔️ Rematch</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
    () => {
      $('mAgain')!.onclick = () => {
        hideModal();
        startRound();
      };
      $('mLobby')!.onclick = () => {
        hideModal();
        goLobby();
      };
    },
  );
}

/* bot 聊天台词（DEMO） */
const BOT_LINES = {
  hello: ['Good luck — you\u2019ll need it.', 'Grid goes brrr.', 'I was compiled to win this.'],
  playerFill: ['Nice one.', 'Hey, that was mine-ish.', 'Okay, warm-up over.'],
  botFill: ['Claimed.', 'Mine.', 'Tick tock.', 'Beep.'],
  losing: ['You\u2019re fast for a human…', 'Recalibrating…'],
  winning: ['This is easy mode for me.', 'Almost there!'],
} as const;
let lastLine = '';
function botSay(text: string): void {
  if (text === lastLine) return;
  lastLine = text;
  const dock = $('chatDock')!;
  if (!dock.dataset.built) {
    dock.dataset.built = '1';
    dock.innerHTML =
      '<div class="ctitle"><span>Match chat · GridBot</span><span>beta demo</span></div><div class="s6-chatlog" id="s6chat"></div>';
  }
  const log = $('s6chat')!;
  const div = document.createElement('div');
  div.className = 'bub opp';
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 6) log.removeChild(log.firstChild!);
}

let botTalkBudget = 0;
function botTrashTalk(event: keyof typeof BOT_LINES): void {
  botTalkBudget++;
  if (event !== 'hello' && Math.random() > 0.22 && botTalkBudget % 4 !== 0) return;
  const lines = BOT_LINES[event];
  botSay(lines[Math.floor(Math.random() * lines.length)]);
}

/* ═══ 侧栏 / 大厅 ═══ */
function renderSide(): void {
  const el = $('side')!;
  const p = st.puzzle;
  const filled = st.grid.filter((v) => v).length;
  const holes = p ? p.holes.length : 0;
  let bestRow = '';
  if (st.mode === 'solo') {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    bestRow =
      '<div class="panel"><h3>🏅 Best times</h3>' +
      (['easy', 'standard', 'hard'] as Difficulty[])
        .map((d) => `<div class="stat-row"><span>${diffLabel(d)}</span><b>${b[d] ? fmt(b[d]) : '—'}</b></div>`)
        .join('') +
      '</div>';
  } else if (st.mode === 'daily') {
    bestRow = '<div class="panel"><h3>🌐 Daily</h3><div class="hint-step"><b>·</b><span>One attempt logs your time; replays are free but won\u2019t overwrite.</span></div></div>';
  }
  el.innerHTML =
    '<div class="panel"><h3>▦ Grid status</h3>' +
    `<div class="stat-row"><span>Cells filled</span><b id="statFilled">${filled}/36</b></div>` +
    `<div class="stat-row"><span>Mistakes</span><b id="statMistakes">${st.mistakes}</b></div>` +
    `<div class="stat-row"><span>Empty (this puzzle)</span><b>${holes}</b></div>` +
    `<div class="stat-row"><span>Difficulty</span><b>${st.mode === 'daily' ? 'Standard (fixed)' : diffLabel(st.diff)}</b></div>` +
    '<div class="hint-step"><b>·</b><span>Click a cell, then tap a number — or type 1–6, arrows to move, Backspace to erase.</span></div></div>' +
    bestRow;
}

/* ═══ banner / modal / toast ═══ */
function banner(html: string): void {
  $('modeBanner')!.innerHTML = html;
}

function showModal(html: string, bind: () => void): void {
  $('modal')!.innerHTML = html;
  $('overlay')!.classList.add('show');
  bind();
}

function hideModal(): void {
  $('overlay')!.classList.remove('show');
}

/* ═══ 事件绑定 ═══ */
document.querySelectorAll<HTMLButtonElement>('#tabs .tab').forEach((t) => {
  t.addEventListener('click', () => enterMode(t.dataset.mode as Mode));
});

document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) => {
  b.addEventListener('click', () => {
    st.diff = b.dataset.d as Difficulty;
    document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((x) => x.classList.toggle('active', x === b));
    if (st.mode === 'solo' || st.mode === 'duel') startRound();
  });
});

$('s6pad')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.act === 'erase') erase();
  else if (b.dataset.v) place(Number(b.dataset.v));
});

/** 方向键在棋盘上移动选格（环绕；duel 跳过 bot 格） */
function moveSel(dr: number, dc: number): void {
  let r = st.sel >= 0 ? rowOf(st.sel) : 0;
  let c = st.sel >= 0 ? colOf(st.sel) : 0;
  for (let step = 0; step < 36; step++) {
    r = (r + dr + 6) % 6;
    c = (c + dc + 6) % 6;
    const i = r * 6 + c;
    if (st.mode === 'duel' && st.owner[i] === 2) continue;
    st.sel = i;
    renderBoard();
    return;
  }
}

window.addEventListener('keydown', (e) => {
  if (st.view !== 'play') return;
  if (e.key >= '1' && e.key <= '6') place(Number(e.key));
  else if (e.key === 'Backspace' || e.key === 'Delete') erase();
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault(); // 阻止页面滚动
    moveSel(
      e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0,
      e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0,
    );
  } else if (e.key === 'Escape') {
    if ($('overlay')!.classList.contains('show')) hideModal(); // 先关结算/弹窗，再考虑离开
    else goLobby();
  }
});

$('backLobby')!.addEventListener('click', goLobby);
$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', giveHint);
/* ═══ Hint（naked-single 逻辑提示，不直接泄答案位次序）═══ */
/** 当前盘面下 i 格的候选数字（按可见盘面算，冲突格 650ms 内自清所以一般 ≥1） */
function candidatesOf(i: number): number[] {
  const used = new Set<number>();
  for (let j = 0; j < 36; j++) {
    if (j === i || !st.grid[j]) continue;
    if (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i)) used.add(st.grid[j]);
  }
  return [1, 2, 3, 4, 5, 6].filter((v) => !used.has(v));
}

/** 解释「为什么必须是 n」：n 是该行/列/宫唯一缺席的数字 */
function nakedReason(i: number, n: number): string {
  const unitVals = (pred: (j: number) => boolean): Set<number> =>
    new Set(
      [...Array(36).keys()].filter((j) => j !== i && pred(j) && st.grid[j]).map((j) => st.grid[j]),
    );
  const onlyMissing = (s: Set<number>): boolean => {
    for (let v = 1; v <= 6; v++) {
      if (v === n) { if (s.has(v)) return false; }
      else if (!s.has(v)) return false;
    }
    return true;
  };
  if (onlyMissing(unitVals((j) => rowOf(j) === rowOf(i)))) return `only digit missing from row ${rowOf(i) + 1}`;
  if (onlyMissing(unitVals((j) => colOf(j) === colOf(i)))) return `only digit missing from column ${colOf(i) + 1}`;
  if (onlyMissing(unitVals((j) => boxOf(j) === boxOf(i)))) return 'only digit missing from its 2\u00d73 box';
  return 'every other digit already sits nearby';
}

function giveHint(): void {
  if (!st.running || !st.puzzle) return;
  const empties = [...Array(36).keys()].filter(
    (i) => !st.grid[i] && !st.puzzle!.puzzle[i] && (st.mode !== 'duel' || st.owner[i] === 1),
  );
  if (!empties.length) return;
  // 1) 先找 naked single（唯一候选格）——最像「逻辑推理」的提示
  let best = -1;
  let cands: number[] = [];
  for (const i of empties) {
    const c = candidatesOf(i);
    if (c.length === 1) {
      best = i;
      cands = c;
      break;
    }
  }
  // 2) 退而求其次：候选最少的格（揭示可能性而非答案）
  if (best < 0) {
    let min = 7;
    for (const i of empties) {
      const c = candidatesOf(i);
      if (c.length && c.length < min) {
        min = c.length;
        best = i;
        cands = c;
      }
    }
  }
  // 3) 兜底：玩家错格污染候选（极少见）→ 直接给解
  if (best < 0) {
    best = empties[Math.floor(Math.random() * empties.length)];
    cands = [st.puzzle.solution[best]];
  }
  st.sel = best;
  renderBoard();
  if (cands.length === 1) {
    toast(`💡 r${rowOf(best) + 1}c${colOf(best) + 1} must be ${cands[0]} — ${nakedReason(best, cands[0])}`);
  } else {
    toast(`💡 r${rowOf(best) + 1}c${colOf(best) + 1}: only ${cands.join(' or ')} fit there`);
  }
}

$('overlay')!.addEventListener('click', (e) => {
  if (e.target === $('overlay')!) hideModal();
});

/* ═══ init ═══ */
// 深链契约：?mode=solo|daily|timed|duel —— 由模式选择页的模式卡链接进来。
// 不带 mode 直达牌桌时回落到模式选择页，与 24 点「lobby → card table」的两段式保持一致。
const isMode = (m: string): m is Mode => m === 'solo' || m === 'daily' || m === 'timed' || m === 'duel';
const modeFromUrl = new URLSearchParams(location.search).get('mode') || '';
if (modeFromUrl === "battle" || modeFromUrl === "random") {
  mountCompetition({
    adapter: createSudokuAdapter({ gameType: 'sudoku-6x6', label: 'Sudoku 6x6', size: 6, difficulty: st.diff, rounds: 3, timeLimit: 240 }),
    tabsEl: document.querySelector("#tabs") as HTMLElement | null,
    tabLabel: "Competition",
    hideOnOpen: ['#playView'],
  });
} else if (isMode(modeFromUrl)) {
  enterMode(modeFromUrl);
} else {
  location.replace(LOBBY_URL);
}

renderSide();
botSay(BOT_LINES.hello[Math.floor(Math.random() * BOT_LINES.hello.length)]);
