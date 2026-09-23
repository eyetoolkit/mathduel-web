/**
 * 杀手数独 · 牌桌逻辑（beta 版：全部本地，无 API 依赖）
 * 模式：solo（3 难度按笼子数）/ daily（seeded 每日一题·固定 standard 29 笼）/ timed（45s 连解）/ duel（vs 本地 bot）
 * 视觉：复用 24 ARENA 同款 token（body.arena remap），自有 k9-* 前缀避免与 9×9 数独冲突。
 * 杀手专属：笼子 SVG 虚线层 + 角标 sum；HUD 显示「This cage · sum · used · needs」实时算术；
 *          cage cleared → sum 退到 mute-2；cage overspent → teal。
 *
 * 与 9×9 数独的差异：
 *   · 0 givens（设计稿明确），开局全空；
 *   · 错格不弹回（杀手数独不会当场告诉你哪格错了——只标记冲突；与 9×9 行为不同）；
 *   · duel 改为「先填满自己半边」与 9×9 一致，但 bot 按「正确 cage 解法」逐步解开自己的格子。
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
import '../24-game/styles.css';
import '../24-game/arena.css';
import './killer.css';

import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import {
  N,
  colOf,
  rowOf,
  boxOf,
  findConflicts,
  mulberry32,
  hashString,
  shanghaiDateKey,
  type Grid,
} from '../sudoku/engine';
import {
  generateKiller,
  dailyKiller,
  duelKiller,
  cageOf,
  cageStat,
  allCleared,
  type CageStat,
  type KillerDifficulty,
  type KillerPuzzle,
} from './engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'MathDuel',
  brandSub: 'Killer Sudoku',
  mark: '✠',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    ],
});

type Mode = 'solo' | 'daily' | 'timed' | 'duel';
const TIMED_LIMIT = 90; // 杀手每局比 9×9 长，给 90s
const DUEL_PENALTY = 2.5;
const MAX_MISTAKES = 5; // 杀手不弹回，给更多容错

const diffLabel = (d: KillerDifficulty): string => ({ gentle: 'Gentle', standard: 'Standard', fierce: 'Fierce' })[d];

/* ═══ 状态 ═══ */
const st = {
  mode: 'solo' as Mode,
  diff: 'standard' as KillerDifficulty,
  puzzle: null as KillerPuzzle | null,
  grid: new Array(81).fill(0) as Grid,
  owner: new Array(81).fill(0) as number[], // 0 free / 1 player / 2 bot（duel）
  filledBy: new Array(81).fill(0) as number[],
  marks: Array.from({ length: 81 }, () => new Set<number>()),
  sel: -1,
  running: false,
  startTs: 0,
  elapsed: 0,
  penalty: 0,
  timer: null as number | null,
  mistakes: 0,
  flash: new Set<number>(),
  notes: false,
  // duel
  mineTotal: 0,
  botTotal: 0,
  botDone: 0,
  botTimer: null as number | null,
  // timed
  timedSolved: 0,
  timedDealt: 0, // 本轮共发过几盘（dealt − solved = unsolved）
  timedStreak: 0,
  timedStartTs: 0,
};

let conflictCache: Set<number> = new Set();

const LS_BEST = 'ks_best_v1';
const LS_DAILY = 'ks_daily_v1';
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
  } catch {
    /* ignore */
  }
};
const fmt = (sec: number): string => `${sec.toFixed(1)}s`;
const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const LOBBY_URL = '/games/killer-sudoku/lobby/';
const goLobby = (): void => {
  location.href = LOBBY_URL;
};

/* ═══ 模式入口 ═══ */
function enterMode(m: Mode): void {
  stopAll();
  st.mode = m;
  document
    .querySelectorAll<HTMLButtonElement>('#tabs .k9-tab')
    .forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  const duel = m === 'duel';
  $('oppHead')!.hidden = !duel;
  $('chatDock')!.hidden = !duel;
  $('diffPick')!.style.display = m === 'daily' ? 'none' : '';
  startRound();
}

function stopAll(): void {
  if (st.timer) window.clearInterval(st.timer);
  if (st.botTimer) window.clearTimeout(st.botTimer);
  st.timer = null;
  st.botTimer = null;
  st.running = false;
}

let roundNonce = 0;
function newRoundPuzzle(): KillerPuzzle {
  roundNonce = (roundNonce + 1) | 0;
  return generateKiller(
    st.diff,
    mulberry32((Date.now() ^ (roundNonce * 0x9e3779b9)) >>> 0),
  );
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
    st.puzzle = dailyKiller(dk);
    banner(`<div class="k9-bn"><div class="k9-bt">🌐 Daily Cage #${dk}</div><div class="k9-bs">29 cages · 0 givens · finish to log today</div></div>`);
  } else if (m === 'duel') {
    const rng = mulberry32((Date.now() ^ hashString(String(performance.now()))) >>> 0);
    st.puzzle = duelKiller(st.diff, rng);
    banner(`<div class="k9-bn"><div class="k9-bt">🤖 Duel GridBot · claim your cells</div><div class="k9-bs">Wrong digits cost +${DUEL_PENALTY}s · cage overspent counts as clash</div></div>`);
  } else {
    st.puzzle = newRoundPuzzle();
    banner(
      m === 'timed'
        ? `<div class="k9-bn"><div class="k9-bt">⏱ Timed · ${TIMED_LIMIT}s per cage-grid</div><div class="k9-bs">Solved <b id="tmSolved">0</b> · Streak <b id="tmStreak">0</b></div></div>`
        : `<div class="k9-bn"><div class="k9-bt">🎯 Solo · ${diffLabel(st.diff)} · ${st.puzzle.cages.length} cages</div><div class="k9-bs">Every dashed cage must add to the number in its corner</div></div>`,
    );
  }
  resetBoard();
  renderBoard();
  renderCages();
  renderSums();
  updateHud();
  if (st.mode === 'duel') scheduleBot();
  beginTimer();
}

function resetBoard(keepClock = false): void {
  const p = st.puzzle!;
  st.grid = p.puzzle.slice();
  st.owner = new Array(81).fill(0);
  st.filledBy = new Array(81).fill(0);
  st.marks = Array.from({ length: 81 }, () => new Set<number>());
  st.sel = -1;
  st.penalty = 0;
  st.mistakes = 0;
  st.notes = false;
  $('notesBtn')!.classList.remove('on');
  if (!keepClock) {
    st.elapsed = 0;
    st.startTs = Date.now();
  }
  st.running = true;
  conflictCache = findConflicts(st.grid);
  st.botDone = 0;
  if (st.mode === 'duel') {
    const d = st.puzzle as KillerPuzzle & { mine: Set<number>; bots: Set<number> };
    for (const i of d.mine) st.owner[i] = 1;
    for (const i of d.bots) st.owner[i] = 2;
    st.mineTotal = d.mine.size;
    st.botTotal = d.bots.size;
    $('oppPace')!.textContent = `~${d.cages.length} cages · ${botPaceText()}`;
    renderOppStatus();
  } else {
    $('oppPace')!.textContent = '— solo pace';
  }
  $('youPace')!.textContent = mPaceText();
  $('result')!.textContent = st.mode === 'duel' ? 'Fill your cells before GridBot' : 'Pick a cell, then a number';
}

const botPaceText = (): string =>
  ({ gentle: 'gentle pace · ~8s per cell', standard: 'standard pace · ~6s per cell', fierce: 'fierce pace · ~4.5s per cell' })[st.diff];

const mPaceText = (): string =>
  st.mode === 'daily'
    ? '— daily run'
    : st.mode === 'timed'
      ? '— chained cages'
      : `— ${diffLabel(st.diff)} cage-grid${st.puzzle ? ` · ${st.puzzle.cages.length} cages` : ''}`;

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
  // 只做轻量文本刷新；笼子/棋盘渲染只在盘面变化（place/erase/bot）时走 updateHud
  const ht = $('hudTime');
  if (st.mode === 'timed') {
    const left = Math.max(0, TIMED_LIMIT - (Date.now() - st.timedStartTs) / 1000);
    const tms = $('tmSolved');
    if (tms) tms.textContent = String(st.timedSolved);
    const tmsk = $('tmStreak');
    if (tmsk) tmsk.textContent = String(st.timedStreak);
    if (ht) ht.textContent = fmtClock(left);
    if (left <= 0) endTimed();
  } else {
    if (ht) ht.textContent = fmtClock(st.elapsed); // solo/daily/duel 可见计时器
  }
}

/* ═══ 棋盘渲染 ═══ */
function cellClass(i: number): string {
  const cls = ['k9-cell'];
  if (colOf(i) % 3 === 2) cls.push('bx-c');
  if (rowOf(i) % 3 === 2) cls.push('bx-r');
  const v = st.grid[i];
  if (st.filledBy[i] === 2) cls.push('bot');
  else if (v) cls.push('entry');
  if (st.sel === i) cls.push('sel');
  if (conflictCache.has(i) || st.flash.has(i)) cls.push('conflict');
  if (st.mode === 'duel' && st.owner[i] === 1 && !v) cls.push('lock');
  // 同 cage peer 高亮
  if (st.sel >= 0) {
    const selCage = cageOf(st.puzzle!.cages, st.sel);
    if (selCage && selCage.cells.includes(i) && i !== st.sel) cls.push('cage-peer');
  }
  if (!v && st.marks[i].size) cls.push('marks');
  if (st.sel >= 0 && st.grid[st.sel] && v) {
    if (i !== st.sel && (rowOf(i) === rowOf(st.sel) || colOf(i) === colOf(st.sel) || boxOf(i) === boxOf(st.sel)) && v === st.grid[st.sel]) cls.push('same');
  }
  return cls.join(' ');
}

function renderBoard(): void {
  const el = $('k9board')!;
  if (!el.dataset.built) {
    el.innerHTML = [...Array(81)]
      .map((_, i) => `<div class="k9-cell" data-i="${i}" role="gridcell"></div>`)
      .join('');
    el.dataset.built = '1';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (t) selectCell(Number(t.dataset.i));
    });
  }
  conflictCache = findConflicts(st.grid);
  [...el.children].forEach((cell, i) => {
    const c = cell as HTMLElement;
    const v = st.grid[i];
    const cls = cellClass(i);
    if (c.className !== cls) c.className = cls;
    let html: string;
    if (v) html = `<span>${v}</span>`;
    else if (st.marks[i].size) {
      let cells = '';
      for (let n = 1; n <= 9; n++) cells += `<i class="${st.marks[i].has(n) ? 'on' : ''}">${n}</i>`;
      html = `<div class="k9-n9">${cells}</div>`;
    } else html = '';
    if (c.innerHTML !== html) c.innerHTML = html;
  });
  updatePad();
  updateLives();
}

/* ═══ 数字键盘剩余计数 + 命值实时刷新 ═══ */
function updatePad(): void {
  const pad = $('k9pad');
  if (!pad) return;
  pad.querySelectorAll<HTMLButtonElement>('.k9-pk[data-v]').forEach((b) => {
    const v = Number(b.dataset.v);
    const left = 9 - st.grid.filter((x) => x === v).length;
    const badge = b.querySelector('.pk-left');
    if (badge) badge.textContent = left > 0 ? String(left) : '';
    b.classList.toggle('done', left <= 0);
  });
}

function updateLives(): void {
  const lv = $('hudLives');
  if (lv) [...lv.children].forEach((el, idx) => (el as HTMLElement).classList.toggle('off', idx < st.mistakes));
}

function selectCell(i: number): void {
  if (!st.running) return;
  if (st.mode === 'duel' && st.owner[i] === 2) {
    toast('🤖 That cell is GridBot’s to fill');
    return;
  }
  st.sel = i;
  renderBoard();
  updateHud(); // 刷新 This cage 实时算术
}

/* ═══ 笼子 SVG / sum 层 ═══ */
/** 把每个 cage 转换成一条 SVG path。viewBox 是 9×9 grid 单位；
 * cage 的 walls 是 cell 之间相邻但 owner 不同的边界。 */
function renderCages(): void {
  const svg = $('k9cage')!;
  const cages = st.puzzle!.cages;
  const paths: string[] = [];
  for (const cage of cages) {
    const stat = cageStat(cage, st.grid, conflictCache);
    const cls = stat.state === 'cleared' ? 'solved' : stat.state === 'overspent' ? 'over' : '';
    // 把笼子的 cells 拆成 wall 段：相邻 owner 不同的边都要画
    const cells = cage.cells;
    const cellSet = new Set(cells);
    const segs: string[] = [];
    for (const i of cells) {
      const r = rowOf(i);
      const c = colOf(i);
      // 上边（如果上方不在 cage 内）
      const up = r > 0 ? r - 1 : -1;
      const upIdx = up >= 0 ? up * N + c : -1;
      if (!cellSet.has(upIdx)) segs.push(`M${c} ${r} L${c + 1} ${r}`);
      // 左边（如果左方不在 cage 内）
      const leftIdx = c > 0 ? r * N + (c - 1) : -1;
      if (!cellSet.has(leftIdx)) segs.push(`M${c} ${r} L${c} ${r + 1}`);
      // 下边（如果下方不在 cage 内或到棋盘底）
      const downIdx = r < N - 1 ? (r + 1) * N + c : -1;
      if (!cellSet.has(downIdx)) segs.push(`M${c} ${r + 1} L${c + 1} ${r + 1}`);
      // 右边（如果右方不在 cage 内或到棋盘右）
      const rightIdx = c < N - 1 ? r * N + (c + 1) : -1;
      if (!cellSet.has(rightIdx)) segs.push(`M${c + 1} ${r} L${c + 1} ${r + 1}`);
    }
    paths.push(`<path class="${cls}" d="${segs.join(' ')}"/>`);
  }
  svg.innerHTML = paths.join('');
}

function renderSums(): void {
  const host = $('k9sum')!;
  const cages = st.puzzle!.cages;
  const items = cages.map((cage) => {
    const stat = cageStat(cage, st.grid, conflictCache);
    const cls = stat.state === 'cleared' ? 'solved' : stat.state === 'overspent' ? 'over' : '';
    const cr = rowOf(cage.corner);
    const cc = colOf(cage.corner);
    return `<span class="${cls}" style="left:${(cc / N) * 100}%;top:${(cr / N) * 100}%">${cage.sum}</span>`;
  });
  host.innerHTML = items.join('');
}

/* ═══ HUD：当前 cage 算术 ═══ */
function currentCageStat(): CageStat | null {
  if (st.sel < 0) return null;
  const cage = cageOf(st.puzzle!.cages, st.sel);
  if (!cage) return null;
  return cageStat(cage, st.grid, conflictCache);
}

function cagesCleared(): { cleared: number; total: number } {
  const total = st.puzzle!.cages.length;
  let cleared = 0;
  for (const cage of st.puzzle!.cages) if (cageStat(cage, st.grid, conflictCache).state === 'cleared') cleared++;
  return { cleared, total };
}

function updateHud(): void {
  const stat = currentCageStat();
  const el = $('hudThis')!;
  if (!stat) {
    el.textContent = '— · pick a cell';
  } else if (st.sel >= 0) {
    const cage = cageOf(st.puzzle!.cages, st.sel)!;
    el.textContent = `${cage.sum} · used ${stat.used} · needs ${stat.needs}`;
    el.classList.toggle('k9-over', stat.state === 'overspent');
  }
  const c = cagesCleared();
  $('hudCages')!.textContent = `${c.cleared} / ${c.total}`;
  // 渲染/更新笼子样式（cleared/overspent 影响 stroke + sum 颜色）
  renderCages();
  renderSums();
  // 棋盘同步 cage-peer 高亮
  if (st.mode !== 'duel') {
    $('youStatus')!.innerHTML = `<span class="d"></span>Filled · ${st.grid.filter((v) => v).length} / 81`;
  } else {
    $('youStatus')!.innerHTML = `<span class="d"></span>Filled · ${correctMine()}/${st.mineTotal}`;
    $('oppStatus')!.innerHTML = `<span class="d"></span>Filled · ${st.botDone}/${st.botTotal}`;
  }
}

function correctMine(): number {
  let n = 0;
  for (let i = 0; i < 81; i++) if (st.owner[i] === 1 && st.grid[i] && st.grid[i] === st.puzzle!.solution[i]) n++;
  return n;
}

function renderOppStatus(): void {
  const s = $('oppStatus')!;
  s.innerHTML = `<span class="d"></span>Filled · ${st.botDone}/${st.botTotal}`;
}

/* ═══ 填数 / 笔记 ═══ */
let padNudgeAt = 0;
function nudgePick(): void {
  const now = Date.now();
  if (now - padNudgeAt < 2000) return; // 2s 节流，避免连点刷屏
  padNudgeAt = now;
  toast('👆 Pick a cell first');
}

/** 落子/错误的一次性动效（直接挂 class，下一次 renderBoard 自然移除） */
function flashCell(i: number, cls: string, ms: number): void {
  const el = $('k9board')!.children[i] as HTMLElement | undefined;
  if (!el) return;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

/** 从 from 之后（环绕）找下一个可填空格；duel 跳过 bot 格；无则 -1 */
function nextClaimable(from: number): number {
  for (let k = 1; k <= 81; k++) {
    const i = (from + k) % 81;
    if (st.grid[i]) continue;
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
  if (st.mode === 'duel' && st.owner[i] !== 1) {
    toast('🤖 That cell is GridBot’s to fill');
    return;
  }
  if (st.notes) {
    if (st.grid[i]) return;
    const m = st.marks[i];
    if (m.has(v)) m.delete(v);
    else m.add(v);
    renderBoard();
    return;
  }
  const correct = v === st.puzzle!.solution[i];
  if (!correct) {
    st.mistakes++;
    st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
    st.grid[i] = v;
    st.filledBy[i] = 1;
    st.flash.add(i);
    renderBoard();
    flashCell(i, 'k9shake', 400);
    updateHud();
    if (st.mode === 'duel') {
      toast(`⚔️ Mistake! +${DUEL_PENALTY}s penalty`);
    } else if (st.mistakes >= MAX_MISTAKES) {
      window.setTimeout(() => endMistakes(), 500);
    }
    window.setTimeout(() => {
      if (st.grid[i] === v) {
        st.grid[i] = 0;
        st.filledBy[i] = 0;
      }
      st.flash.delete(i);
      renderBoard();
      updateHud();
    }, 650);
    return;
  }
  st.grid[i] = v;
  st.filledBy[i] = 1;
  st.marks[i].clear();
  const nx = nextClaimable(i);
  st.sel = nx >= 0 ? nx : i; // 填对后自动跳到下一空格，连解提速
  renderBoard();
  updateHud();
  flashCell(i, 'k9pop', 320);
  checkWin();
}

function erase(): void {
  if (!st.running) return;
  if (st.sel < 0) {
    nudgePick();
    return;
  }
  const i = st.sel;
  if (st.filledBy[i] === 2) return;
  if (st.notes && !st.grid[i]) {
    st.marks[i].clear();
    renderBoard();
    return;
  }
  st.grid[i] = 0;
  st.filledBy[i] = 0;
  renderBoard();
  updateHud();
}

function toggleNotes(): void {
  st.notes = !st.notes;
  $('notesBtn')!.classList.toggle('on', st.notes);
}

/* ═══ 胜负 ═══ */
function checkWin(): void {
  if (!st.puzzle) return;
  if (st.mode === 'duel') {
    if (correctMine() >= st.mineTotal) {
      st.running = false;
      if (st.timer) window.clearInterval(st.timer);
      finishDuel(true);
    }
    return;
  }
  if (!allCleared(st.puzzle.cages, st.grid, conflictCache)) return;
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
      extra = '<div class="k9-extra">🌐 Daily cage logged — see you tomorrow!</div>';
    } else {
      extra = '<div class="k9-extra">Already logged today — replay doesn’t overwrite.</div>';
    }
  } else {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const k = st.diff;
    if (!b[k] || t < b[k]) {
      b[k] = Math.round(t * 10) / 10;
      writeJSON(LS_BEST, b);
      extra = '<div class="k9-extra">🥇 New personal best!</div>';
    }
  }
  $('result')!.innerHTML = `✅ Solved in <b>${fmt(t)}</b>${extra}`;
  showModal(
    `<div class="k9-verdict">Cage-grid complete 🎉</div>
     <div class="k9-scores"><div class="k9-me num">${fmt(t)}<small>your time</small></div></div>
     ${extra}
     <div class="k9-acts">
       <button class="k9-prim" id="mAgain">↻ New grid</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => {
        hideModal();
        startRound();
      };
      ($('mLobby') as HTMLButtonElement).onclick = () => {
        hideModal();
        goLobby();
      };
    },
  );
}

function endMistakes(): void {
  if (!st.running) return;
  stopAll();
  showModal(
    `<div class="k9-verdict">Out of lives</div>
     <div class="k9-scores"><div class="k9-op num">${st.mistakes}<small>mistakes</small></div></div>
     <div class="k9-acts">
       <button class="k9-prim" id="mAgain">↻ Try again</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => {
        hideModal();
        startRound();
      };
      ($('mLobby') as HTMLButtonElement).onclick = () => {
        hideModal();
        goLobby();
      };
    },
  );
}

function winTimed(): void {
  st.timedSolved++;
  st.timedStreak++;
  window.setTimeout(() => {
    if (st.mode === 'timed' && (Date.now() - st.timedStartTs) / 1000 < TIMED_LIMIT && st.puzzle) {
      st.puzzle = newRoundPuzzle();
      st.timedDealt++; // 续盘也算发出
      resetBoard(true);
      renderBoard();
      renderCages();
      renderSums();
      updateHud();
      beginTimer();
      $('result')!.innerHTML = `✅ #${st.timedSolved} · ${st.timedStreak} streak — next cage-grid!`;
    }
  }, 1500); // 与 24 点/6×6/9×9 对齐：留足时间看清完成盘面
  $('result')!.innerHTML = `✅ #${st.timedSolved} in <b>${fmt(st.elapsed)}</b> — next grid incoming…`;
}

function endTimed(): void {
  stopAll();
  const unsolved = Math.max(0, st.timedDealt - st.timedSolved); // 发出 − 解出 = 没解完的
  showModal(
    `<div class="k9-verdict">⏱ Time’s up</div>
     <div class="k9-scores">
       <div class="k9-me num">${st.timedSolved}<small>solved</small></div>
       <div class="k9-op num">${st.timedStreak}<small>best streak</small></div>
       <div class="k9-op num">${unsolved}<small>unsolved</small></div>
     </div>
     <div class="k9-acts">
       <button class="k9-prim" id="mAgain">↻ Run it again</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => {
        hideModal();
        st.timedSolved = 0;
        st.timedStreak = 0;
        startRound();
      };
      ($('mLobby') as HTMLButtonElement).onclick = () => {
        hideModal();
        goLobby();
      };
    },
  );
}

function scheduleBot(): void {
  const pace = { gentle: 8000, standard: 6000, fierce: 4500 }[st.diff];
  const jitter = () => pace * (0.6 + Math.random() * 0.9);
  const step = (): void => {
    if (!st.running || st.mode !== 'duel') return;
    const d = st.puzzle as KillerPuzzle & { bots: Set<number> };
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
    updateHud();
    if (st.botDone >= st.botTotal) {
      finishDuel(false);
      return;
    }
    st.botTimer = window.setTimeout(step, jitter());
  };
  st.botTimer = window.setTimeout(step, 1800);
}

function finishDuel(playerWon: boolean): void {
  stopAll();
  const t = st.elapsed;
  const verdict = playerWon ? 'You win 🏆' : 'GridBot wins 🤖';
  $('result')!.innerHTML = playerWon
    ? `🏆 You filled your half in <b>${fmt(t)}</b> — GridBot stalled at ${st.botDone}/${st.botTotal}`
    : `🤖 GridBot finished first (${fmt(t)}) — you had ${correctMine()}/${st.mineTotal}`;
  showModal(
    `<div class="k9-verdict">${verdict}</div>
     <div class="k9-scores">
       <div class="k9-me num">${playerWon ? fmt(t) : `${correctMine()}/${st.mineTotal}`}<small>you</small></div>
       <div class="k9-op num">${playerWon ? `${st.botDone}/${st.botTotal}` : fmt(t)}<small>GridBot</small></div>
     </div>
     <div class="k9-acts">
       <button class="k9-prim" id="mAgain">⚔️ Rematch</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => {
        hideModal();
        startRound();
      };
      ($('mLobby') as HTMLButtonElement).onclick = () => {
        hideModal();
        goLobby();
      };
    },
  );
}

/* ═══ banner / modal / toast ═══ */
function banner(html: string): void {
  $('modeBanner')!.innerHTML = html;
}
function showModal(html: string, bind: () => void): void {
  $('mTitle')!.innerHTML = '';
  $('mSub')!.innerHTML = '';
  $('mActs')!.innerHTML = '';
  $('modal')!.innerHTML = html;
  $('overlay')!.hidden = false;
  bind();
}
function hideModal(): void {
  $('overlay')!.hidden = true;
}

/* ═══ 事件绑定 ═══ */
document.querySelectorAll<HTMLButtonElement>('#tabs .k9-tab').forEach((t) =>
  t.addEventListener('click', () => enterMode(t.dataset.mode as Mode)),
);

document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) =>
  b.addEventListener('click', () => {
    st.diff = b.dataset.d as KillerDifficulty;
    document
      .querySelectorAll<HTMLButtonElement>('#diffPick button')
      .forEach((x) => x.classList.toggle('active', x === b));
    if (st.mode === 'solo' || st.mode === 'duel') startRound();
  }),
);

$('k9pad')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  if (b.dataset.act === 'erase') erase();
  else if (b.dataset.act === 'notes') toggleNotes();
  else if (b.dataset.v) place(Number(b.dataset.v));
});

/** 方向键在棋盘上移动选格（环绕；duel 跳过 bot 格） */
function moveSel(dr: number, dc: number): void {
  let r = st.sel >= 0 ? rowOf(st.sel) : 0;
  let c = st.sel >= 0 ? colOf(st.sel) : 0;
  for (let step = 0; step < 81; step++) {
    r = (r + dr + 9) % 9;
    c = (c + dc + 9) % 9;
    const i = r * 9 + c;
    if (st.mode === 'duel' && st.owner[i] === 2) continue;
    st.sel = i;
    renderBoard();
    updateHud();
    return;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '9') place(Number(e.key));
  else if (e.key === 'Backspace' || e.key === 'Delete') erase();
  else if (e.key === 'n' || e.key === 'N') toggleNotes();
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault(); // 阻止页面滚动
    moveSel(
      e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0,
      e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0,
    );
  } else if (e.key === 'Escape') {
    const ov = $('overlay')!;
    if (!ov.hidden) hideModal(); // 先关结算/弹窗，再考虑离开
    else goLobby();
  }
});

$('backLobby')!.addEventListener('click', goLobby);
$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', giveHint);

/* ═══ Hint（naked-single 逻辑提示，对照 9×9；附笼子和值）═══ */
/** 当前盘面下 i 格的候选数字（错误格 650ms 内自清，所以一般 ≥1） */
function candidatesOf(i: number): number[] {
  const used = new Set<number>();
  for (let j = 0; j < 81; j++) {
    if (j === i || !st.grid[j]) continue;
    if (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i)) used.add(st.grid[j]);
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => !used.has(v));
}

/** 解释「为什么必须是 n」：n 是该行/列/宫唯一缺席的数字 */
function nakedReason(i: number, n: number): string {
  const unitVals = (pred: (j: number) => boolean): Set<number> =>
    new Set(
      [...Array(81).keys()].filter((j) => j !== i && pred(j) && st.grid[j]).map((j) => st.grid[j]),
    );
  const onlyMissing = (s: Set<number>): boolean => {
    for (let v = 1; v <= 9; v++) {
      if (v === n) { if (s.has(v)) return false; }
      else if (!s.has(v)) return false;
    }
    return true;
  };
  if (onlyMissing(unitVals((j) => rowOf(j) === rowOf(i)))) return `only digit missing from row ${rowOf(i) + 1}`;
  if (onlyMissing(unitVals((j) => colOf(j) === colOf(i)))) return `only digit missing from column ${colOf(i) + 1}`;
  if (onlyMissing(unitVals((j) => boxOf(j) === boxOf(i)))) return 'only digit missing from its 3\u00d73 box';
  return 'every other digit already sits nearby';
}

function giveHint(): void {
  if (!st.running || !st.puzzle) return;
  const empties = [...Array(81).keys()].filter(
    (i) => !st.grid[i] && (st.mode !== 'duel' || st.owner[i] === 1),
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
    let min = 10;
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
  updateHud();
  const cage = cageOf(st.puzzle.cages, best);
  const cageTxt = cage ? ` · cage ${cage.sum}` : '';
  if (cands.length === 1) {
    toast(`💡 r${rowOf(best) + 1}c${colOf(best) + 1} must be ${cands[0]} — ${nakedReason(best, cands[0])}${cageTxt}`);
  } else {
    toast(`💡 r${rowOf(best) + 1}c${colOf(best) + 1}: only ${cands.join(' or ')} fit there${cageTxt}`);
  }
}

$('overlay')!.addEventListener('click', (e) => {
  if (e.target === $('overlay')!) hideModal();
});

/* ═══ init ═══ */
const isMode = (m: string): m is Mode => m === 'solo' || m === 'daily' || m === 'timed' || m === 'duel';
const isDiff = (x: string): x is KillerDifficulty => x === 'gentle' || x === 'standard' || x === 'fierce';
const qs = new URLSearchParams(location.search);
const modeFromUrl = qs.get('mode') || '';
const dFromUrl = qs.get('d') || '';
if (isDiff(dFromUrl)) {
  st.diff = dFromUrl;
  document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) => {
    b.classList.toggle('active', b.dataset.d === dFromUrl);
  });
}
if (isMode(modeFromUrl)) enterMode(modeFromUrl);
else location.replace(LOBBY_URL);
