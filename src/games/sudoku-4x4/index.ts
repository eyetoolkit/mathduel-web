/**
 * 4×4 数独 · UI 编排（小朋友入门款）
 * 模式：solo / daily（每日种子题）/ timed（45s 连解）/ battle（好友对战）/ random（随机匹配，走竞赛外壳）
 * 视觉：24 ARENA 同款 token（body.arena remap），三级 SVG 网格线（2×2 宫粗线），
 *       大字号数字（clamp 1.8–2.7rem），2×2 数字键盘呼应宫结构。
 * 单档（无难度分级）；battle/random 由 mountCompetition 接管（CF DO 路径）。
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
import '../24-game/styles.css';
import '../24-game/arena.css';
import './s4.css';
import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import {
  colOf,
  findConflicts,
  generatePuzzle,
  boxOf,
  rowOf,
  mulberry32,
  dailyPuzzle4x4,
  shanghaiDateKey,
  type Grid,
  type Puzzle,
} from './engine';
import { mountCompetition } from '../_shared/mp-client';
import { createSudokuAdapter } from '../_shared/mp-adapters/sudoku';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'MathDuel',
  brandSub: 'Sudoku 4×4',
  mark: '▦',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    ],
});

type Mode = 'solo' | 'timed' | 'daily';

const TIMED_LIMIT = 45;
const MAX_MISTAKES = 3; // 累计 3 次错误即负

/* ─── 状态 ─── */
const st = {
  view: 'lobby' as 'lobby' | 'play',
  mode: 'solo' as Mode,
  puzzle: null as Puzzle | null,
  grid: new Array(16).fill(0) as Grid,
  filledBy: new Array(16).fill(0) as number[], // 1 玩家填（着色用）
  marks: Array.from({ length: 16 }, () => new Set<number>()), // pencil marks
  sel: -1,
  running: false,
  startTs: 0,
  elapsed: 0,
  timer: null as number | null,
  mistakes: 0,
  flash: new Set<number>(), // 临时错误高亮
  notes: false,
  // timed
  timedSolved: 0,
  timedDealt: 0,
  timedStreak: 0,
  timedStartTs: 0,
};

let conflictCache: Set<number> = new Set();

const LS_BEST = 's4_best_v1';
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

/* ═══ 模式选择页（独立 MPA 入口）═══ */
const LOBBY_URL = '/games/sudoku-4x4/lobby/';
const goLobby = (): void => {
  location.href = LOBBY_URL;
};

function enterMode(m: Mode): void {
  stopAll();
  st.view = 'play';
  st.mode = m;
  document.querySelectorAll<HTMLButtonElement>('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  startRound();
}

function stopAll(): void {
  if (st.timer) window.clearInterval(st.timer);
  st.timer = null;
  st.running = false;
}

/* ═══ 开局 ═══ */
function startRound(): void {
  stopAll();
  if (st.mode === 'timed') {
    st.timedStartTs = Date.now();
    st.timedDealt = 1;
    st.timedSolved = 0;
    st.timedStreak = 0;
    st.puzzle = newRoundPuzzle();
    banner(`<div class="banner daily timed"><div class="daily-top"><div class="daily-meta"><div class="b-title">⏱ Timed · ${TIMED_LIMIT}s per grid</div><div class="b-sub">Solved <b id="tmSolved">0</b> · Streak <b id="tmStreak">0</b> · wrong digits just flash</div></div></div></div>`);
  } else if (st.mode === 'daily') {
    st.puzzle = newRoundPuzzle();
    banner(`<div class="banner"><div class="daily-top"><div class="daily-meta"><div class="b-title">📅 Daily Grid · ${shanghaiDateKey()}</div><div class="b-sub">Same puzzle for everyone today · best time saved locally</div></div></div></div>`);
  } else {
    st.puzzle = newRoundPuzzle();
    banner(`<div class="banner"><div class="daily-top"><div class="daily-meta"><div class="b-title">🎯 Solo</div><div class="b-sub">Unique solution · best time saved locally</div></div></div></div>`);
  }
  resetBoard();
  renderBoard();
  renderSide();
  beginTimer();
}

let roundNonce = 0;
function newRoundPuzzle(): Puzzle {
  roundNonce = (roundNonce + 1) | 0;
  if (st.mode === 'daily') return dailyPuzzle4x4(shanghaiDateKey());
  return generatePuzzle(mulberry32((Date.now() ^ (roundNonce * 0x9e3779b9)) >>> 0));
}

function resetBoard(keepClock = false): void {
  const p = st.puzzle!;
  st.grid = p.puzzle.slice();
  st.filledBy = new Array(16).fill(0);
  st.marks = Array.from({ length: 16 }, () => new Set<number>());
  st.sel = -1;
  st.mistakes = 0;
  st.notes = false;
  $('notesBtn')!.classList.remove('on');
  if (!keepClock) {
    st.elapsed = 0;
    st.startTs = Date.now();
  }
  st.running = true;
  conflictCache = findConflicts(st.grid);
  $('result')!.textContent = 'Pick a cell, then a number';
}

/* ═══ 计时 ═══ */
function beginTimer(): void {
  if (st.timer) window.clearInterval(st.timer);
  st.timer = window.setInterval(tick, 100);
  tick();
}

function tick(): void {
  if (!st.running) return;
  st.elapsed = (Date.now() - st.startTs) / 1000;
  if (st.mode === 'timed') {
    const left = Math.max(0, TIMED_LIMIT - (Date.now() - st.timedStartTs) / 1000);
    $('stMain')!.innerHTML = `⏱ <b>${left.toFixed(1)}s</b> · ✅ ${st.timedSolved}`;
    const tms = $('tmSolved');
    if (tms) tms.textContent = String(st.timedSolved);
    const tmsk = $('tmStreak');
    if (tmsk) tmsk.textContent = String(st.timedStreak);
    if (left <= 0) endTimed();
  } else {
    $('stMain')!.innerHTML = `⏱ <b>${fmtClock(st.elapsed)}</b>`;
  }
}

/* ═══ 棋盘渲染 ═══ */
function cellClass(i: number): string {
  const cls = ['c4cell'];
  const v = st.grid[i];
  if (st.puzzle!.puzzle[i]) cls.push('given');
  else if (v) cls.push('entry');
  if (st.sel === i) cls.push('sel');
  if (conflictCache.has(i) || st.flash.has(i)) cls.push('conflict');
  if (!v && st.marks[i].size) cls.push('marks');
  if (st.sel >= 0 && st.grid[st.sel]) {
    if (i !== st.sel && (rowOf(i) === rowOf(st.sel) || colOf(i) === colOf(st.sel) || boxOf(i) === boxOf(st.sel))) cls.push('peer');
    if (i !== st.sel && v && v === st.grid[st.sel]) cls.push('same');
  }
  return cls.join(' ');
}

function renderBoard(): void {
  const el = $('s4board')!;
  if (!el.dataset.built) {
    el.innerHTML = [...Array(16)].map((_, i) => `<div class="c4cell" data-i="${i}" role="gridcell"></div>`).join('');
    el.dataset.built = '1';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (t) selectCell(Number(t.dataset.i));
    });
    // 首次构建棋盘后注入 SVG 网格线覆盖层（2×2 宫粗线 + 细线），并监听尺寸/DPR 变化
    buildGridLines(el);
  }
  conflictCache = findConflicts(st.grid);
  [...el.children].forEach((cell, i) => {
    const c = cell as HTMLElement;
    if (!c.classList.contains('c4cell')) return; // 跳过 SVG 覆盖层等非 cell 子元素
    const v = st.grid[i];
    const cls = cellClass(i);
    if (c.className !== cls) c.className = cls;
    let html: string;
    if (v) html = `<span>${v}</span>`;
    else if (st.marks[i].size) {
      let cells = '';
      for (let n = 1; n <= 4; n++) cells += `<i class="${st.marks[i].has(n) ? 'on' : ''}">${n}</i>`;
      html = `<div class="n4">${cells}</div>`;
    } else html = '';
    if (c.innerHTML !== html) c.innerHTML = html;
  });
  updateSideStats();
}

/** 三级网格线的中间两级（细线 + 2×2 宫粗线），SVG crispEdges 按 1/dpr 折算物理像素；
 *  外框最粗一级由 .s4-board 的 CSS border 承担。ResizeObserver + matchMedia(resolution) 监听重建。 */
function buildGridLines(board: HTMLElement): void {
  const build = (): void => {
    const old = board.querySelector('.grid-lines');
    if (old) old.remove();
    const dpr = window.devicePixelRatio || 1;
    const W = board.clientWidth;
    if (!W) return;
    const cell = W / 4;
    const thin = 1 / dpr, thick = 2 / dpr;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'grid-lines');
    svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    const rect = (x: number, y: number, w: number, h: number, cls: string): void => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(h));
      r.setAttribute('class', cls); // 颜色由 CSS token 驱动（.l-cell / .l-box），主题切换免重建
      svg.appendChild(r);
    };
    for (let i = 1; i <= 3; i++) {
      // 2×2 宫线：i=2（第 2 格后）为粗线，其余为细线
      const box = i % 2 === 0;
      const w = box ? thick : thin;
      const cls = box ? 'l-box' : 'l-cell';
      rect(i * cell - w / 2, 0, w, W, cls);
      rect(0, i * cell - w / 2, W, w, cls);
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

/* ═══ 侧栏实时刷新 + 数字键盘剩余计数 ═══ */
function updateSideStats(): void {
  const filled = $('statFilled');
  if (filled) filled.textContent = `${st.grid.filter((v) => v).length}/16`;
  const lv = $('sideLives');
  if (lv) [...lv.children].forEach((el, idx) => (el as HTMLElement).classList.toggle('off', idx < st.mistakes));
  updatePad();
}

function updatePad(): void {
  const pad = $('s4pad');
  if (!pad) return;
  pad.querySelectorAll<HTMLButtonElement>('.pk[data-v]').forEach((b) => {
    const v = Number(b.dataset.v);
    const left = 4 - st.grid.filter((x) => x === v).length;
    const badge = b.querySelector('.pk-left');
    if (badge) badge.textContent = left > 0 ? String(left) : '';
    b.classList.toggle('done', left <= 0);
  });
}

function selectCell(i: number): void {
  if (!st.running) return;
  st.sel = i; // given 也允许选中做 peer/same 高亮
  renderBoard();
}

/* ═══ 填数 / 笔记 ═══ */
let padNudgeAt = 0;
function nudgePick(): void {
  const now = Date.now();
  if (now - padNudgeAt < 2000) return;
  padNudgeAt = now;
  toast('👆 Pick a cell first');
}

/** 落子/错误的一次性动效（直接挂 class，下一次 renderBoard 自然移除） */
function flashCell(i: number, cls: string, ms: number): void {
  const el = $('s4board')!.children[i] as HTMLElement | undefined;
  if (!el) return;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

function place(v: number): void {
  if (!st.running) return;
  if (st.sel < 0) {
    nudgePick();
    return;
  }
  const i = st.sel;
  if (st.puzzle!.puzzle[i]) return;
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
    st.grid[i] = v;
    st.filledBy[i] = 1;
    st.flash.add(i);
    renderBoard();
    flashCell(i, 'shake', 400);
    if (st.mistakes >= MAX_MISTAKES) {
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
    return;
  }
  // 正确
  st.grid[i] = v;
  st.filledBy[i] = 1;
  st.marks[i].clear();
  // 填对后自动跳到下一空格，连解提速
  let nx = -1;
  for (let k = 1; k <= 16; k++) {
    const j = (i + k) % 16;
    if (st.grid[j] || st.puzzle!.puzzle[j]) continue;
    nx = j;
    break;
  }
  st.sel = nx >= 0 ? nx : i;
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
  if (st.puzzle!.puzzle[i]) return;
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
  const complete = st.grid.every((v, i) => v === st.puzzle!.solution[i]);
  if (!complete) return;
  st.running = false;
  if (st.timer) window.clearInterval(st.timer);
  if (st.mode === 'timed') winTimed();
  else winSolo();
}

function winSolo(): void {
  const t = st.elapsed;
  let extra = '';
  const b = readJSON<Record<string, number>>(LS_BEST, {});
  const k = st.mode; // 'solo' | 'daily'
  if (!b[k] || t < b[k]) {
    b[k] = Math.round(t * 10) / 10;
    writeJSON(LS_BEST, b);
    extra = '<div class="s4-newbest">🥇 New personal best!</div>';
  }
  $('result')!.innerHTML = `✅ Solved in <b>${fmt(t)}</b>${extra}`;
  showModal(
    '<div class="s4-verdict">Grid complete 🎉</div>' +
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
    '<div class="s4-verdict">Out of lives</div>' +
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
      st.timedDealt++;
      resetBoard(true);
      renderBoard();
      renderSide();
      beginTimer();
      $('result')!.innerHTML = `✅ #${st.timedSolved} · ${st.timedStreak} streak — next grid!`;
    }
  }, 1500); // 留足时间看清完成盘面
  $('result')!.innerHTML = `✅ #${st.timedSolved} in <b>${fmt(st.elapsed)}</b> — next grid incoming…`;
}

function endTimed(): void {
  stopAll();
  $('stMain')!.innerHTML = '⏱ Time!';
  const unsolved = Math.max(0, st.timedDealt - st.timedSolved);
  showModal(
    '<div class="s4-verdict">⏱ Time’s up</div>' +
      `<div class="s9-scores"><div class="me num">${st.timedSolved}<small>solved</small></div>` +
      `<div class="op num">${st.timedStreak}<small>best streak</small></div>` +
      `<div class="op num">${unsolved}<small>unsolved</small></div></div>` +
      '<div class="s9-acts"><button class="btn primary" id="mAgain">↻ Run it again</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
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

/* ═══ 侧栏 ═══ */
function renderSide(): void {
  const el = $('side')!;
  const p = st.puzzle;
  const filled = st.grid.filter((v) => v).length;
  const holes = p ? p.holes.length : 0;
  let bestRow = '';
  if (st.mode !== 'timed') {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const label = st.mode === 'daily' ? 'Daily' : 'Solo';
    bestRow =
      '<div class="panel"><h3>🏅 Best time</h3>' +
      `<div class="stat-row"><span>${label}</span><b>${b[st.mode] ? fmt(b[st.mode]) : '—'}</b></div>` +
      '</div>';
  }
  el.innerHTML =
    '<div class="panel"><h3>▦ Grid status</h3>' +
    `<div class="stat-row"><span>Cells filled</span><b id="statFilled">${filled}/16</b></div>` +
    `<div class="stat-row"><span>Empty (this puzzle)</span><b>${holes}</b></div>` +
    `<div class="stat-row"><span>Mistakes</span><span class="lives" id="sideLives"><i class="${st.mistakes < 1 ? '' : 'off'}"></i><i class="${st.mistakes < 2 ? '' : 'off'}"></i><i class="${st.mistakes < 3 ? '' : 'off'}"></i></span></div>` +
    '<div class="hint-step"><b>·</b><span>Click a cell, then tap a number — or type 1–4, arrows to move. Toggle Notes (✏) to pencil candidates; Backspace erases.</span></div></div>' +
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

$('s4pad')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.act === 'erase') erase();
  else if (b.dataset.act === 'notes') toggleNotes();
  else if (b.dataset.v) place(Number(b.dataset.v));
});

$('backLobby')!.addEventListener('click', goLobby);
$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', giveHint);

/** 方向键在棋盘上移动选格（环绕） */
function moveSel(dr: number, dc: number): void {
  let r = st.sel >= 0 ? rowOf(st.sel) : 0;
  let c = st.sel >= 0 ? colOf(st.sel) : 0;
  r = (r + dr + 4) % 4;
  c = (c + dc + 4) % 4;
  st.sel = r * 4 + c;
  renderBoard();
}

window.addEventListener('keydown', (e) => {
  if (st.view !== 'play') return;
  if (e.key >= '1' && e.key <= '4') place(Number(e.key));
  else if (e.key === 'Backspace' || e.key === 'Delete') erase();
  else if (e.key === 'n' || e.key === 'N') toggleNotes();
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault(); // 阻止页面滚动
    moveSel(
      e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0,
      e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0,
    );
  } else if (e.key === 'Escape') {
    if ($('overlay')!.classList.contains('show')) hideModal();
    else goLobby();
  }
});

/* ═══ Hint（naked-single 逻辑提示）═══ */
/** 当前盘面下 i 格的候选数字（错误格 650ms 内自清，所以一般 ≥1） */
function candidatesOf(i: number): number[] {
  const used = new Set<number>();
  for (let j = 0; j < 16; j++) {
    if (j === i || !st.grid[j]) continue;
    if (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i)) used.add(st.grid[j]);
  }
  return [1, 2, 3, 4].filter((v) => !used.has(v));
}

/** 解释「为什么必须是 n」：n 是该行/列/宫唯一缺席的数字 */
function nakedReason(i: number, n: number): string {
  const unitVals = (pred: (j: number) => boolean): Set<number> =>
    new Set(
      [...Array(16).keys()].filter((j) => j !== i && pred(j) && st.grid[j]).map((j) => st.grid[j]),
    );
  const onlyMissing = (s: Set<number>): boolean => {
    for (let v = 1; v <= 4; v++) {
      if (v === n) { if (s.has(v)) return false; }
      else if (!s.has(v)) return false;
    }
    return true;
  };
  if (onlyMissing(unitVals((j) => rowOf(j) === rowOf(i)))) return `only digit missing from row ${rowOf(i) + 1}`;
  if (onlyMissing(unitVals((j) => colOf(j) === colOf(i)))) return `only digit missing from column ${colOf(i) + 1}`;
  if (onlyMissing(unitVals((j) => boxOf(j) === boxOf(i)))) return 'only digit missing from its 2\u00d72 box';
  return 'every other digit already sits nearby';
}

function giveHint(): void {
  if (!st.running || !st.puzzle) return;
  const empties = [...Array(16).keys()].filter((i) => !st.grid[i] && !st.puzzle!.puzzle[i]);
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
  if (best < 0 || !cands.length) return;
  const n = cands[0];
  st.grid[best] = n;
  st.filledBy[best] = 1;
  st.marks[best].clear();
  st.sel = best;
  renderBoard();
  flashCell(best, 'pop', 320);
  const why = nakedReason(best, n);
  $('result')!.innerHTML = `💡 Row ${rowOf(best) + 1}, Col ${colOf(best) + 1} takes <b>${n}</b> — ${why}`;
  checkWin();
}

/* ═══ boot：深链 ?mode= ═══ */
const isMode = (x: string): x is Mode => x === 'solo' || x === 'timed' || x === 'daily';
const qs = new URLSearchParams(location.search);
const modeFromUrl = qs.get('mode') || '';

// 好友对战 / 随机匹配 → 走通用竞赛外壳（CF DO 路径，worker 端出题）
if (modeFromUrl === 'battle' || modeFromUrl === 'random' || (new URLSearchParams(location.search).get('room') || '').trim()) {
  mountCompetition({
    adapter: createSudokuAdapter({ gameType: 'sudoku-4x4', label: 'Sudoku 4×4', size: 4, rounds: 3, timeLimit: 240 }),
    tabsEl: document.querySelector('#tabs') as HTMLElement | null,
    tabLabel: 'Competition',
    hideOnOpen: ['#playView'],
  });
} else if (isMode(modeFromUrl)) {
  enterMode(modeFromUrl);
} else {
  location.replace(LOBBY_URL);
}

renderSide();
