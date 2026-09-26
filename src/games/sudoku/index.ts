/* === 通用竞赛外壳（1v1+多人+随机匹配） === */
import { mountCompetition } from "../_shared/mp-client";
import { createSudokuAdapter } from "../_shared/mp-adapters/sudoku";
/**
 * 9×9 数独 · UI 编排（beta 版：全部本地，无 API 依赖）
 * 模式：solo（3 难度）/ daily（seeded 每日一题）/ timed（45s 连解）/ duel（vs 本地 bot 竞速）
 * 视觉：24 ARENA 同款 token（body.arena remap），ember=你、teal=bot/冲突、paper=固定线索
 * 9×9 专属：pencil-mark 笔记模式（cell 内 3×3 候选微格）、3×3 宫线、进度 HUD（filled/mistakes/time）。
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
import '../24-game/styles.css';
import '../24-game/arena.css';
import './sudoku.css';
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
  brandSub: 'Sudoku 9×9',
  mark: '▦',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    ],
});

type Mode = 'solo' | 'daily' | 'timed' | 'duel';

const TIMED_LIMIT = 45;
const DUEL_PENALTY = 2.5; // 填错罚时（秒）
const MAX_MISTAKES = 3; // 非 duel 模式累计 3 次错误即负

const diffLabel = (d: Difficulty): string => ({ easy: 'Easy', standard: 'Medium', hard: 'Hard' })[d];

/* ─── 状态 ─── */
const st = {
  view: 'lobby' as 'lobby' | 'play',
  mode: 'solo' as Mode,
  diff: 'standard' as Difficulty,
  puzzle: null as Puzzle | null,
  grid: new Array(81).fill(0) as Grid, // 当前值（含玩家+bot 填入）
  owner: new Array(81).fill(0) as number[], // 0 公共 / 1 玩家格 / 2 bot 格（duel）
  filledBy: new Array(81).fill(0) as number[], // 1 玩家填 / 2 bot 填（着色）
  marks: Array.from({ length: 81 }, () => new Set<number>()), // pencil marks
  sel: -1,
  running: false,
  startTs: 0,
  elapsed: 0,
  penalty: 0,
  timer: null as number | null,
  mistakes: 0,
  flash: new Set<number>(), // 临时错误高亮
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

const LS_BEST = 's9_best_v1';
const LS_DAILY = 's9_daily_v1';
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
const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* ═══ 模式选择页（独立 MPA 入口，与 24 点 lobby 同构）═══ */
const LOBBY_URL = '/games/sudoku/lobby/';
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
    banner(`<div class="banner daily"><div class="daily-top"><div class="daily-meta"><div class="b-title">🌐 Daily Grid #${dk}</div><div class="b-sub">One seeded puzzle worldwide · Medium · finish to log today</div></div></div></div>`);
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
  if (st.mode === 'duel') {
    updateHud();
    scheduleBot();
  }
  beginTimer();
}

let roundNonce = 0;
function newRoundPuzzle(): Puzzle {
  roundNonce = (roundNonce + 1) | 0;
  return generatePuzzle(st.diff, mulberry32((Date.now() ^ (roundNonce * 0x9e3779b9)) >>> 0));
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
    const d = st.puzzle as Puzzle & { mine: Set<number>; bots: Set<number> };
    for (const i of d.mine) st.owner[i] = 1;
    for (const i of d.bots) st.owner[i] = 2;
    st.mineTotal = d.mine.size;
    st.botTotal = d.bots.size;
    $('oppSub')!.textContent = botPaceText();
    renderOppStatus();
  }
  $('result')!.textContent = st.mode === 'duel' ? 'Claim your cells before GridBot' : 'Pick a cell, then a number';
}

const botPaceText = (): string =>
  ({ easy: 'easy pace · ~7s per cell', standard: 'standard pace · ~5s per cell', hard: 'hard pace · ~3.8s per cell' })[st.diff];

/** 我负责的格子里已填对的个数（动态统计，erase/改数后仍准确） */
function correctMine(): number {
  let n = 0;
  for (let i = 0; i < 81; i++) if (st.owner[i] === 1 && st.grid[i] && st.grid[i] === st.puzzle!.solution[i]) n++;
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
    $('stMain')!.innerHTML = `⏱ <b>${fmtClock(st.elapsed)}</b>`;
    updateHud();
  } else {
    $('stMain')!.innerHTML = `⏱ <b>${fmtClock(st.elapsed)}</b>`;
  }
}

/* ═══ 棋盘渲染 ═══ */
function cellClass(i: number): string {
  const cls = ['c9cell'];
  // 3×3 宫线：竖粗线在 col3、6 后（0-based col 2、5），横粗线在 row3、6 后（row 2、5）
  if (colOf(i) % 3 === 2) cls.push('bx-c');
  if (rowOf(i) % 3 === 2) cls.push('bx-r');
  const v = st.grid[i];
  if (st.puzzle!.puzzle[i]) cls.push('given');
  else if (st.filledBy[i] === 2) cls.push('bot');
  else if (v) cls.push('entry');
  if (st.sel === i) cls.push('sel');
  if (conflictCache.has(i) || st.flash.has(i)) cls.push('conflict');
  if (!v && st.marks[i].size) cls.push('marks');
  if (st.mode === 'duel' && st.owner[i] === 1 && !v) cls.push('lock');
  if (st.sel >= 0 && st.grid[st.sel]) {
    if (i !== st.sel && (rowOf(i) === rowOf(st.sel) || colOf(i) === colOf(st.sel) || boxOf(i) === boxOf(st.sel))) cls.push('peer');
    if (i !== st.sel && v && v === st.grid[st.sel]) cls.push('same');
  }
  return cls.join(' ');
}

/** 三级网格线的中间两级（细线 + 3×3 宫粗线），SVG crispEdges 按 1/dpr 折算物理像素；
 *  外框最粗一级由 .s9-board 的 CSS border 承担。ResizeObserver + matchMedia(resolution) 监听重建。 */
function buildGridLines(board: HTMLElement): void {
  const build = (): void => {
    const old = board.querySelector('.grid-lines');
    if (old) old.remove();
    const dpr = window.devicePixelRatio || 1;
    const W = board.clientWidth;
    if (!W) return;
    const cell = W / 9;
    const thin = 1 / dpr, thick = 2 / dpr;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'grid-lines');
    svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    // 读取棋盘当前主题 token，颜色随主题切换
    const cs = getComputedStyle(board);
    const cCell = cs.getPropertyValue('--s9-line-cell').trim() || '#e5e1f0';
    const cBox = cs.getPropertyValue('--s9-line-box').trim() || '#3730a3';
    const rect = (x: number, y: number, w: number, h: number, color: string): void => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(h));
      r.style.fill = color;
      svg.appendChild(r);
    };
    for (let i = 1; i <= 8; i++) {
      // 3×3 宫线：i=3、6（第 3、6 格后）为粗线，其余为细线
      const box = i % 3 === 0;
      const w = box ? thick : thin;
      const color = box ? cBox : cCell;
      rect(i * cell - w / 2, 0, w, W, color);
      rect(0, i * cell - w / 2, W, w, color);
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

function renderBoard(): void {
  const el = $('s9board')!;
  if (!el.dataset.built) {
    el.innerHTML = [...Array(81)].map((_, i) => `<div class="c9cell" data-i="${i}" role="gridcell"></div>`).join('');
    el.dataset.built = '1';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (t) selectCell(Number(t.dataset.i));
    });
    // 首次构建棋盘后注入 SVG 网格线覆盖层（宫粗线 + 细线），并监听尺寸/DPR 变化
    buildGridLines(el);
  }
  conflictCache = findConflicts(st.grid);
  [...el.children].forEach((cell, i) => {
    const c = cell as HTMLElement;
    if (!c.classList.contains('c9cell')) return; // 跳过 SVG 覆盖层等非 cell 子元素
    const v = st.grid[i];
    const cls = cellClass(i);
    if (c.className !== cls) c.className = cls;
    let html: string;
    if (v) html = `<span>${v}</span>`;
    else if (st.marks[i].size) {
      let cells = '';
      for (let n = 1; n <= 9; n++) cells += `<i class="${st.marks[i].has(n) ? 'on' : ''}">${n}</i>`;
      html = `<div class="n9">${cells}</div>`;
    } else html = '';
    if (c.innerHTML !== html) c.innerHTML = html;
  });
  updateSideStats();
}

/* ═══ 侧栏 Grid status 实时刷新 + 数字键盘剩余计数 ═══ */
function updateSideStats(): void {
  const filled = $('statFilled');
  if (filled) filled.textContent = `${st.grid.filter((v) => v).length}/81`;
  const lv = $('sideLives');
  if (lv) [...lv.children].forEach((el, idx) => (el as HTMLElement).classList.toggle('off', idx < st.mistakes));
  updatePad();
}

function updatePad(): void {
  const pad = $('s9pad');
  if (!pad) return;
  pad.querySelectorAll<HTMLButtonElement>('.pk[data-v]').forEach((b) => {
    const v = Number(b.dataset.v);
    const left = 9 - st.grid.filter((x) => x === v).length;
    const badge = b.querySelector('.pk-left');
    if (badge) badge.textContent = left > 0 ? String(left) : '';
    b.classList.toggle('done', left <= 0);
  });
}

function selectCell(i: number): void {
  if (!st.running) return;
  if (st.mode === 'duel' && st.owner[i] === 2) {
    toast('🤖 That cell is GridBot’s to fill');
    return;
  }
  st.sel = i; // given 也允许选中做 peer/same 高亮
  renderBoard();
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
  const el = $('s9board')!.children[i] as HTMLElement | undefined;
  if (!el) return;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

/** 从 from 之后（环绕）找下一个可填空格；无则 -1 */
function nextClaimable(from: number): number {
  for (let k = 1; k <= 81; k++) {
    const i = (from + k) % 81;
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
  // 笔记模式：切换候选标记
  if (st.notes) {
    if (st.grid[i]) return;
    const m = st.marks[i];
    if (m.has(v)) m.delete(v);
    else m.add(v);
    renderBoard();
    return;
  }
  // 普通模式：填入并即时校验对错（有解 → 与解比对）
  const correct = v === st.puzzle!.solution[i];
  if (!correct) {
    st.mistakes++;
    st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
    st.grid[i] = v;
    st.filledBy[i] = 1;
    st.flash.add(i);
    renderBoard();
    flashCell(i, 'shake', 400);
    if (st.mode === 'duel') {
      toast(`⚔️ Mistake! +${DUEL_PENALTY}s penalty`);
      botTrashTalk('playerFill');
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
    }, 650);
    st.sel = i;
    if (st.mode === 'duel') updateHud();
    return;
  }
  // 正确
  st.grid[i] = v;
  st.filledBy[i] = 1;
  st.marks[i].clear();
  if (st.mode === 'duel') {
    renderOppStatus();
    botTrashTalk('playerFill');
  }
  const nx = nextClaimable(i);
  st.sel = nx >= 0 ? nx : i; // 填对后自动跳到下一空格，连解提速
  renderBoard();
  flashCell(i, 'pop', 320);
  if (st.mode === 'duel') updateHud();
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
  if (st.notes && !st.grid[i]) {
    st.marks[i].clear();
    renderBoard();
    return;
  }
  st.grid[i] = 0;
  st.filledBy[i] = 0;
  renderBoard();
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
      extra = '<div class="s9-newbest">🌐 Daily grid logged — see you tomorrow!</div>';
    } else {
      extra = '<div class="s9-newbest">Already logged today — replay doesn’t overwrite.</div>';
    }
  } else {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const k = st.diff;
    if (!b[k] || t < b[k]) {
      b[k] = Math.round(t * 10) / 10;
      writeJSON(LS_BEST, b);
      extra = '<div class="s9-newbest">🥇 New personal best!</div>';
    }
  }
  $('result')!.innerHTML = `✅ Solved in <b>${fmt(t)}</b>${extra}`;
  showModal(
    '<div class="s9-verdict">Grid complete 🎉</div>' +
      `<div class="s9-scores"><div class="me num">${fmt(t)}<small>your time</small></div></div>` +
      extra +
      '<div class="s9-acts"><button class="btn primary" id="mAgain">↻ New grid</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
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

function endMistakes(): void {
  if (!st.running) return;
  stopAll();
  $('stMain')!.innerHTML = '💥 Too many mistakes';
  showModal(
    '<div class="s9-verdict">Out of lives</div>' +
      '<div class="s9-scores"><div class="op num">3<small>mistakes</small></div></div>' +
      '<div class="s9-acts"><button class="btn primary" id="mAgain">↻ Try again</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
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
    if (st.mode === 'timed' && (Date.now() - st.timedStartTs) / 1000 < TIMED_LIMIT && st.puzzle) {
      st.puzzle = newRoundPuzzle();
      st.timedDealt++; // 续盘也算发出
      resetBoard(true);
      renderBoard();
      beginTimer();
      $('result')!.innerHTML = `✅ #${st.timedSolved} · ${st.timedStreak} streak — next grid!`;
    }
  }, 1500); // 与 24 点/6×6 对齐：留足时间看清完成盘面
  $('result')!.innerHTML = `✅ #${st.timedSolved} in <b>${fmt(st.elapsed)}</b> — next grid incoming…`;
}

function endTimed(): void {
  stopAll();
  $('stMain')!.innerHTML = '⏱ Time!';
  const unsolved = Math.max(0, st.timedDealt - st.timedSolved); // 发出 − 解出 = 没解完的
  showModal(
    '<div class="s9-verdict">⏱ Time’s up</div>' +
      `<div class="s9-scores"><div class="me num">${st.timedSolved}<small>solved</small></div>` +
      `<div class="op num">${st.timedStreak}<small>best streak</small></div>` +
      `<div class="op num">${unsolved}<small>unsolved</small></div></div>` +
      '<div class="s9-acts"><button class="btn primary" id="mAgain">↻ Run it again</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
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
  const pace = { easy: 7000, standard: 5000, hard: 3800 }[st.diff];
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

function updateHud(): void {
  $('youFilled')!.textContent = `${correctMine()}/${st.mineTotal}`;
  $('oppFilled')!.textContent = `${st.botDone}/${st.botTotal}`;
  $('duelTime')!.textContent = fmtClock(st.elapsed);
  const lv = $('lives')!;
  [...lv.children].forEach((el, idx) => (el as HTMLElement).classList.toggle('off', idx < st.mistakes));
}

function renderOppStatus(): void {
  const s = $('oppStatus')!;
  s.innerHTML = `<span class="d"></span>Filled ${st.botDone}/${st.botTotal}`;
  s.classList.toggle('done', st.botDone >= st.botTotal);
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
    `<div class="s9-verdict">${verdict}</div>` +
      `<div class="s9-scores"><div class="me num">${mine}<small>you</small></div><div class="op num">${bots}<small>GridBot</small></div></div>` +
      '<div class="s9-acts"><button class="btn primary" id="mAgain">⚔️ Rematch</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
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
  hello: ['Good luck — you’ll need it.', 'Grid goes brrr.', 'I was compiled to win this.'],
  playerFill: ['Nice one.', 'Hey, that was mine-ish.', 'Okay, warm-up over.'],
  botFill: ['Claimed.', 'Mine.', 'Tick tock.', 'Beep.'],
  losing: ['You’re fast for a human…', 'Recalibrating…'],
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
      '<div class="ctitle"><span>Match chat · GridBot</span><span>beta demo</span></div><div class="s9-chatlog" id="s9chat"></div>';
  }
  const log = $('s9chat')!;
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
  const mistakesLine =
    st.mode === 'duel'
      ? ''
      : `<div class="stat-row"><span>Mistakes</span><span class="lives" id="sideLives"><i class="${st.mistakes < 1 ? '' : 'off'}"></i><i class="${st.mistakes < 2 ? '' : 'off'}"></i><i class="${st.mistakes < 3 ? '' : 'off'}"></i></span></div>`;
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
    bestRow = '<div class="panel"><h3>🌐 Daily</h3><div class="hint-step"><b>·</b><span>One attempt logs your time; replays are free but won’t overwrite.</span></div></div>';
  }
  el.innerHTML =
    '<div class="panel"><h3>▦ Grid status</h3>' +
    `<div class="stat-row"><span>Cells filled</span><b id="statFilled">${filled}/81</b></div>` +
    `<div class="stat-row"><span>Empty (this puzzle)</span><b>${holes}</b></div>` +
    (st.mode === 'duel' ? '' : `<div class="stat-row"><span>Difficulty</span><b>${st.mode === 'daily' ? 'Medium (fixed)' : diffLabel(st.diff)}</b></div>`) +
    mistakesLine +
    '<div class="hint-step"><b>·</b><span>Click a cell, then tap a number — or type 1–9, arrows to move. Toggle Notes (✏) to pencil candidates; Backspace erases.</span></div></div>' +
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

$('s9pad')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.act === 'erase') erase();
  else if (b.dataset.act === 'notes') toggleNotes();
  else if (b.dataset.v) place(Number(b.dataset.v));
});

$('backLobby')!.addEventListener('click', goLobby);
$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', giveHint);

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
    return;
  }
}

window.addEventListener('keydown', (e) => {
  if (st.view !== 'play') return;
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
    if ($('overlay')!.classList.contains('show')) hideModal(); // 先关结算/弹窗，再考虑离开
    else goLobby();
  }
});

/* ═══ Hint（naked-single 逻辑提示）═══ */
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
const qs = new URLSearchParams(location.search);
const modeFromUrl = qs.get('mode') || '';

// 深链 ?d=easy|standard|hard —— 由模式选择页的难度行带入。
// 必须在 enterMode() 之前落到 st.diff，否则会先用默认难度发牌再被覆盖。
const isDiff = (x: string): x is Difficulty => x === 'easy' || x === 'standard' || x === 'hard';
const dFromUrl = qs.get('d') || '';
if (isDiff(dFromUrl)) {
  st.diff = dFromUrl;
  document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) => {
    b.classList.toggle('active', b.dataset.d === dFromUrl);
  });
}

if (modeFromUrl === "battle" || modeFromUrl === "random") {
  mountCompetition({
    adapter: createSudokuAdapter({ gameType: 'sudoku', label: 'Sudoku', size: 9, difficulty: st.diff, rounds: 3, timeLimit: 240 }),
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
