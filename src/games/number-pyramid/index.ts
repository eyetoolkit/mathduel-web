/**
 * 数字金字塔 · 牌桌逻辑（beta：全本地，无 API）
 * 塔规则：第 k 层第 i 格 = 第 k+1 层 i 格 + 第 k+1 层 i+1 格。
 * 给定若干 given，从下往上能唯一反推。设计稿难度按塔高：Swift 4 / Standard 5 / Deep 6。
 */

import '@tri-sites/design-system/styles';
import '../24-game/styles.css';
import '../24-game/arena.css';
import './tower.css';

import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import {
  generateTower,
  dailyTower,
  duelDeal,
  posOf,
  idxAt,
  totalCells,
  nextDeterminable,
  botStep,
  type Height,
  type Tower,
} from './engine';
import { shanghaiDateKey } from '../sudoku/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader($('header')!, {
  brandName: 'MathDuel',
  brandSub: 'Number Pyramid',
  mark: '△',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    { labelKey: 'nav.leaderboard', href: '/leaderboard/' },
  ],
});

type Mode = 'solo' | 'daily' | 'timed' | 'duel';
const TIMED_LIMIT = 60; // 5 levels 塔大约 30-50s
const DUEL_PENALTY = 2.5;
const MAX_MISTAKES = 3;

const heightLabel = (h: Height): string => ({ 4: 'Swift', 5: 'Standard', 6: 'Deep' })[h];

/* ═══ 状态 ═══ */
const st = {
  mode: 'solo' as Mode,
  height: 5 as Height,
  tower: null as Tower | null,
  grid: [] as number[],
  owner: [] as number[], // 0 free / 1 player / 2 bot (duel)
  marks: Array.from<Set<number>>({ length: 0 }),
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
  mineDone: 0,
  botTotal: 0,
  botDone: 0,
  botTimer: null as number | null,
  // timed
  timedSolved: 0,
  timedSkipped: 0,
  timedStreak: 0,
  timedStartTs: 0,
};

const LS_BEST = 'np_best_v1';
const LS_DAILY = 'np_daily_v1';
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

const LOBBY_URL = '/games/number-pyramid/lobby/';
const goLobby = (): void => {
  location.href = LOBBY_URL;
};

/* ═══ 几何（viewBox 100×100） ═══ */
// brick 大小和层间距随 levels 微调；bricks 数越多越挤。
const ROW_H = (levels: Height): number => 100 / (levels + 1.5);
const CELL_W = (levels: Height): number => 100 / (levels + 0.5);
/** 第 k 层（0=顶层）brick 中心点的 (x, y) in viewBox 100 */
const cellCenter = (level: number, col: number, levels: Height): { x: number; y: number } => {
  const row = levels - level;
  const cw = CELL_W(levels);
  const w = row * cw;
  const startX = (100 - w) / 2 + cw / 2;
  return { x: startX + col * cw, y: ROW_H(levels) * (level + 0.5) };
};
/** brick 左上角的 (x, y) in viewBox */
const cellTopLeft = (level: number, col: number, levels: Height): { x: number; y: number } => {
  const c = cellCenter(level, col, levels);
  const cw = CELL_W(levels);
  return { x: c.x - cw / 2, y: c.y - ROW_H(levels) / 2 };
};

/* ═══ 模式入口 ═══ */
function enterMode(m: Mode): void {
  stopAll();
  st.mode = m;
  document.querySelectorAll<HTMLButtonElement>('#tabs .p1-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
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
function newRoundTower(): Tower {
  roundNonce = (roundNonce + 1) | 0;
  // mulberry32 import via engine
  return generateTower(st.height, mulberryFromDate());
}

/* simple rng seed from current time + roundNonce */
function mulberryFromDate(): () => number {
  let a = ((Date.now() ^ (roundNonce * 0x9e3779b9)) >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══ 开局 ═══ */
function startRound(): void {
  stopAll();
  const m = st.mode;
  if (m === 'timed') st.timedStartTs = Date.now();
  if (m === 'daily') {
    const dk = shanghaiDateKey();
    st.tower = dailyTower(dk);
    banner(`<div class="p1-bn"><div class="p1-bt">🌐 Daily Tower #${dk}</div><div class="p1-bs">5 levels · apex ${st.tower.solution[0]} · finish to log today</div></div>`);
  } else if (m === 'duel') {
    st.tower = duelDeal(st.height, mulberryFromDate());
    banner(`<div class="p1-bn"><div class="p1-bt">🤖 Duel BotBot · climb your half first</div><div class="p1-bs">Wrong digits cost +${DUEL_PENALTY}s</div></div>`);
  } else {
    st.tower = newRoundTower();
    banner(
      m === 'timed'
        ? `<div class="p1-bn"><div class="p1-bt">⏱ Timed · ${TIMED_LIMIT}s per tower</div><div class="p1-bs">Solved <b id="tmSolved">0</b> · Streak <b id="tmStreak">0</b></div></div>`
        : `<div class="p1-bn"><div class="p1-bt">🎯 Solo · ${heightLabel(st.height)} (${st.tower.levels} levels)</div><div class="p1-bs">Apex ${st.tower.solution[0]} · best time saved locally</div></div>`,
    );
  }
  resetBoard();
  renderBoard();
  renderDep();
  updateHud();
  if (st.mode === 'duel') scheduleBot();
  beginTimer();
}

function resetBoard(keepClock = false): void {
  const t = st.tower!;
  st.grid = t.puzzle.slice();
  const total = totalCells(t.levels);
  st.owner = new Array(total).fill(0);
  st.marks = Array.from({ length: total }, () => new Set<number>());
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
  st.mineDone = 0;
  st.botDone = 0;
  if (st.mode === 'duel') {
    const d = st.tower as Tower & { mine: Set<number>; bots: Set<number> };
    for (const i of d.mine) st.owner[i] = 1;
    for (const i of d.bots) st.owner[i] = 2;
    st.mineTotal = d.mine.size;
    st.botTotal = d.bots.size;
    $('oppPace')!.textContent = `duel · ${heightLabel(st.height)} · ${st.botTotal} of ${st.mineTotal + st.botTotal} bricks`;
    renderOppStatus();
  } else {
    $('oppPace')!.textContent = '— solo pace';
  }
  $('youPace')!.textContent =
    st.mode === 'daily'
      ? '— daily run'
      : st.mode === 'timed'
        ? '— chained towers'
        : `— ${heightLabel(st.height)} tower`;
  $('result')!.textContent = st.mode === 'duel' ? 'Fill your half before BotBot' : 'Pick a brick, then a number';
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
    const tms = $('tmSolved');
    if (tms) tms.textContent = String(st.timedSolved);
    const tmsk = $('tmStreak');
    if (tmsk) tmsk.textContent = String(st.timedStreak);
    if (left <= 0) endTimed();
  }
  updateHud();
}

/* ═══ 棋盘渲染 ═══ */
function cellClass(i: number, t: Tower): string {
  const cls = ['p1-cell'];
  const v = st.grid[i];
  if (t.givens.includes(i) && v) cls.push('given');
  else if (st.owner[i] === 2) cls.push('bot');
  else if (v) cls.push('entry');
  if (st.sel === i) cls.push('sel');
  if (st.flash.has(i)) cls.push('conflict');
  if (st.mode === 'duel' && st.owner[i] !== 1 && st.owner[i] !== 0) cls.push('lock');
  if (!v && st.marks[i] && st.marks[i].size) cls.push('marks');
  // 字号：3 位数 d3
  if (v && v >= 100) cls.push('d3');
  else if (v && v >= 10) cls.push('d2');
  return cls.join(' ');
}

function renderBoard(): void {
  const el = $('p1board')!;
  const t = st.tower!;
  const levels = t.levels;
  const total = totalCells(levels);
  if (!el.dataset.built) {
    el.dataset.built = '1';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const { x, y } = cellTopLeft(posOf(i, levels).level, posOf(i, levels).col, levels);
      const cw = CELL_W(levels) * 0.9;
      const rh = ROW_H(levels) * 0.7;
      const d = document.createElement('div');
      d.className = 'p1-cell';
      d.dataset.i = String(i);
      d.style.left = `${x + (CELL_W(levels) - cw) / 2}%`;
      d.style.top = `${y + (ROW_H(levels) - rh) / 2}%`;
      d.style.width = `${cw}%`;
      d.style.height = `${rh}%`;
      d.setAttribute('role', 'gridcell');
      frag.appendChild(d);
    }
    el.innerHTML = '';
    el.appendChild(frag);
    el.addEventListener('click', (e) => {
      const t2 = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (t2) selectCell(Number(t2.dataset.i));
    });
  }
  // sync
  for (let i = 0; i < total; i++) {
    const c = el.querySelector<HTMLElement>(`[data-i="${i}"]`)!;
    const v = st.grid[i];
    const cls = cellClass(i, t);
    if (c.className !== cls) c.className = cls;
    let html: string;
    if (v) html = `<span>${v}</span>`;
    else if (st.marks[i] && st.marks[i].size) {
      let cells = '';
      for (let n = 1; n <= 9; n++) cells += `<i class="${st.marks[i].has(n) ? 'on' : ''}">${n}</i>`;
      html = `<div class="p1-n3">${cells}</div>`;
    } else html = '';
    if (c.innerHTML !== html) c.innerHTML = html;
  }
}

function renderDep(): void {
  const svg = $('p1dep')!;
  const t = st.tower!;
  const levels = t.levels;
  // 每个空格都画两条线连到下层两格
  const paths: string[] = [];
  for (let i = 0; i < st.grid.length; i++) {
    const p = posOf(i, levels);
    if (p.level === levels - 1) continue; // 顶层（apex）已是顶端，没下层
    // 上层 i 连下层 (i + levelOfBelow) 和 (i + levelOfBelow + 1)
    const aIdx = idxAt(p.level + 1, p.col, levels);
    const bIdx = idxAt(p.level + 1, p.col + 1, levels);
    const x1 = cellCenter(p.level, p.col, levels).x;
    const y1 = cellCenter(p.level, p.col, levels).y;
    const x2 = cellCenter(p.level + 1, p.col, levels).x;
    const y2 = cellCenter(p.level + 1, p.col, levels).y;
    const x3 = cellCenter(p.level + 1, p.col + 1, levels).x;
    const y3 = cellCenter(p.level + 1, p.col + 1, levels).y;
    // 线条状态：若 i 是空 → 普通 mute-2；若 i 已填且正确 → hot；错误 → bad
    let cls = '';
    if (st.grid[i] !== 0) {
      const expected = st.tower!.solution[aIdx] + st.tower!.solution[bIdx];
      if (st.grid[i] === expected) cls = 'hot';
      else cls = 'bad';
    }
    paths.push(`<path class="${cls}" d="M${x1} ${y1} L${x2} ${y2}"/>`);
    paths.push(`<path class="${cls}" d="M${x1} ${y1} L${x3} ${y3}"/>`);
  }
  svg.innerHTML = paths.join('');
}

function selectCell(i: number): void {
  if (!st.running) return;
  if (st.mode === 'duel' && st.owner[i] !== 1) {
    toast('🏁 That brick is BotBot’s');
    return;
  }
  st.sel = i;
  renderBoard();
  updateHud();
}

/* ═══ 填数 / 笔记 ═══ */
function place(v: number): void {
  if (!st.running || st.sel < 0) return;
  const i = st.sel;
  if (st.tower!.givens.includes(i) && st.grid[i] !== 0) {
    toast('📌 That brick is given');
    return;
  }
  if (st.mode === 'duel' && st.owner[i] !== 1) return;
  if (st.notes) {
    if (st.grid[i]) return;
    const m = st.marks[i];
    if (m.has(v)) m.delete(v);
    else m.add(v);
    renderBoard();
    return;
  }
  // 直接填值；由 dep 显示 hot/bad
  const correct = v === st.tower!.solution[i];
  if (!correct) {
    st.mistakes++;
    st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
    st.grid[i] = v;
    st.flash.add(i);
    renderBoard();
    renderDep();
    if (st.mode === 'duel') toast(`⚔️ Mistake! +${DUEL_PENALTY}s penalty`);
    else if (st.mistakes >= MAX_MISTAKES) window.setTimeout(() => endMistakes(), 500);
    window.setTimeout(() => {
      if (st.grid[i] === v) st.grid[i] = 0;
      st.flash.delete(i);
      renderBoard();
      renderDep();
      updateHud();
    }, 650);
    return;
  }
  st.grid[i] = v;
  st.marks[i].clear();
  if (st.mode === 'duel') {
    st.mineDone++;
    renderOppStatus();
  }
  renderBoard();
  renderDep();
  updateHud();
  checkWin();
}

function erase(): void {
  if (!st.running || st.sel < 0) return;
  const i = st.sel;
  if (st.owner[i] === 2) return;
  if (st.notes && !st.grid[i]) {
    st.marks[i].clear();
    renderBoard();
    return;
  }
  st.grid[i] = 0;
  renderBoard();
  renderDep();
  updateHud();
}

function toggleNotes(): void {
  st.notes = !st.notes;
  $('notesBtn')!.classList.toggle('on', st.notes);
}

/* ═══ 胜负 ═══ */
function checkWin(): void {
  const t = st.tower!;
  const total = totalCells(t.levels);
  if (st.mode === 'duel') {
    if (correctMine() >= st.mineTotal) {
      st.running = false;
      if (st.timer) window.clearInterval(st.timer);
      finishDuel(true);
    }
    return;
  }
  for (let i = 0; i < total; i++) if (st.grid[i] !== t.solution[i]) return;
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
      extra = '<div class="p1-extra">🌐 Daily tower logged — see you tomorrow!</div>';
    } else {
      extra = '<div class="p1-extra">Already logged today — replay doesn’t overwrite.</div>';
    }
  } else {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const k = String(st.height);
    if (!b[k] || t < b[k]) {
      b[k] = Math.round(t * 10) / 10;
      writeJSON(LS_BEST, b);
      extra = '<div class="p1-extra">🥇 New personal best!</div>';
    }
  }
  $('result')!.innerHTML = `✅ Tower climbed in <b>${fmt(t)}</b>${extra}`;
  showModal(
    `<div class="p1-verdict">Tower complete 🎉</div>
     <div class="p1-scores"><div class="p1-me num">${fmt(t)}<small>your time</small></div></div>
     ${extra}
     <div class="p1-acts">
       <button class="p1-prim" id="mAgain">↻ New tower</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => { hideModal(); startRound(); };
      ($('mLobby') as HTMLButtonElement).onclick = () => { hideModal(); goLobby(); };
    },
  );
}

function endMistakes(): void {
  if (!st.running) return;
  stopAll();
  showModal(
    `<div class="p1-verdict">Out of lives</div>
     <div class="p1-scores"><div class="p1-op num">${st.mistakes}<small>mistakes</small></div></div>
     <div class="p1-acts">
       <button class="p1-prim" id="mAgain">↻ Try again</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => { hideModal(); startRound(); };
      ($('mLobby') as HTMLButtonElement).onclick = () => { hideModal(); goLobby(); };
    },
  );
}

function winTimed(): void {
  st.timedSolved++;
  st.timedStreak++;
  window.setTimeout(() => {
    if (st.mode === 'timed' && (Date.now() - st.timedStartTs) / 1000 < TIMED_LIMIT && st.tower) {
      st.tower = newRoundTower();
      resetBoard(true);
      renderBoard();
      renderDep();
      updateHud();
      beginTimer();
      $('result')!.innerHTML = `✅ #${st.timedSolved} · ${st.timedStreak} streak — next tower!`;
    }
  }, 700);
  $('result')!.innerHTML = `✅ #${st.timedSolved} in <b>${fmt(st.elapsed)}</b> — next tower incoming…`;
}

function endTimed(): void {
  stopAll();
  showModal(
    `<div class="p1-verdict">⏱ Time’s up</div>
     <div class="p1-scores">
       <div class="p1-me num">${st.timedSolved}<small>solved</small></div>
       <div class="p1-op num">${st.timedStreak}<small>best streak</small></div>
     </div>
     <div class="p1-acts">
       <button class="p1-prim" id="mAgain">↻ Run it again</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => {
        hideModal();
        st.timedSolved = 0; st.timedStreak = 0; st.timedSkipped = 0;
        startRound();
      };
      ($('mLobby') as HTMLButtonElement).onclick = () => { hideModal(); goLobby(); };
    },
  );
}

function scheduleBot(): void {
  const pace = { 4: 4500, 5: 5500, 6: 7000 }[st.height];
  const jitter = () => pace * (0.7 + Math.random() * 0.8);
  const step = (): void => {
    if (!st.running || st.mode !== 'duel') return;
    const t = st.tower!;
    const step2 = botStep(st.grid, t.solution, t.levels);
    if (!step2) {
      finishDuel(false);
      return;
    }
    st.grid[step2.idx] = step2.value;
    st.botDone++;
    renderOppStatus();
    renderBoard();
    renderDep();
    updateHud();
    if (st.botDone >= st.botTotal) {
      finishDuel(false);
      return;
    }
    st.botTimer = window.setTimeout(step, jitter());
  };
  st.botTimer = window.setTimeout(step, 1500);
}

function updateHud(): void {
  const t = st.tower!;
  $('hudApex')!.textContent = `→ ${t.solution[0]}`;
  const filled = st.grid.filter((v) => v).length;
  $('hudFilled')!.textContent = `${filled} / ${st.grid.length}`;
  if (st.mode === 'duel') {
    $('youStatus')!.innerHTML = `<span class="d"></span>Filled · ${correctMine()}/${st.mineTotal}`;
    $('oppStatus')!.innerHTML = `<span class="d"></span>Filled · ${st.botDone}/${st.botTotal}`;
  } else {
    $('youStatus')!.innerHTML = `<span class="d"></span>Filled · ${filled}/${st.grid.length}`;
  }
}

function correctMine(): number {
  let n = 0;
  for (let i = 0; i < st.grid.length; i++) if (st.owner[i] === 1 && st.grid[i] && st.grid[i] === st.tower!.solution[i]) n++;
  return n;
}

function renderOppStatus(): void {
  const s = $('oppStatus')!;
  s.innerHTML = `<span class="d"></span>Filled · ${st.botDone}/${st.botTotal}`;
}

function finishDuel(playerWon: boolean): void {
  stopAll();
  const t = st.elapsed;
  const verdict = playerWon ? 'You win 🏆' : 'BotBot wins 🤖';
  $('result')!.innerHTML = playerWon
    ? `🏆 You climbed your half in <b>${fmt(t)}</b> — BotBot stalled at ${st.botDone}/${st.botTotal}`
    : `🤖 BotBot finished first (${fmt(t)}) — you had ${correctMine()}/${st.mineTotal}`;
  showModal(
    `<div class="p1-verdict">${verdict}</div>
     <div class="p1-scores">
       <div class="p1-me num">${playerWon ? fmt(t) : `${correctMine()}/${st.mineTotal}`}<small>you</small></div>
       <div class="p1-op num">${playerWon ? `${st.botDone}/${st.botTotal}` : fmt(t)}<small>BotBot</small></div>
     </div>
     <div class="p1-acts">
       <button class="p1-prim" id="mAgain">⚔️ Rematch</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => { hideModal(); startRound(); };
      ($('mLobby') as HTMLButtonElement).onclick = () => { hideModal(); goLobby(); };
    },
  );
}

/* ═══ banner / modal / toast ═══ */
function banner(html: string): void { $('modeBanner')!.innerHTML = html; }
function showModal(html: string, bind: () => void): void {
  $('modal')!.innerHTML = html;
  $('overlay')!.hidden = false;
  bind();
}
function hideModal(): void { $('overlay')!.hidden = true; }

/* ═══ 事件绑定 ═══ */
document.querySelectorAll<HTMLButtonElement>('#tabs .p1-tab').forEach((t) =>
  t.addEventListener('click', () => enterMode(t.dataset.mode as Mode)),
);

document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) =>
  b.addEventListener('click', () => {
    const h = Number(b.dataset.h) as Height;
    if (![4, 5, 6].includes(h)) return;
    st.height = h;
    document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((x) => x.classList.toggle('active', x === b));
    if (st.mode === 'solo' || st.mode === 'duel') startRound();
  }),
);

$('p1pad')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  if (b.dataset.act === 'erase') erase();
  else if (b.dataset.act === 'notes') toggleNotes();
  else if (b.dataset.v) place(Number(b.dataset.v));
});

window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '9') place(Number(e.key));
  else if (e.key === 'Backspace' || e.key === 'Delete') erase();
  else if (e.key === 'n' || e.key === 'N') toggleNotes();
  else if (e.key === 'Escape') goLobby();
});

$('backLobby')!.addEventListener('click', goLobby);
$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', () => {
  if (!st.running || !st.tower) return;
  const det = nextDeterminable(st.grid, st.tower.levels);
  if (!det.length) return toast('🤔 No determinable brick — try guessing');
  // 选一个可确定的空格（优先不在 duel 别人的）
  const candidates = st.mode === 'duel'
    ? det.filter((i) => st.owner[i] === 1 || st.owner[i] === 0)
    : det;
  if (!candidates.length) return toast('🤔 No brick in your half is determinable');
  const i = candidates[Math.floor(Math.random() * candidates.length)];
  st.sel = i;
  renderBoard();
  updateHud();
  const p = posOf(i, st.tower.levels);
  toast(`💡 r${p.level + 1}c${p.col + 1} = ${st.tower.solution[i]} (sum of below)`);
});

$('overlay')!.addEventListener('click', (e) => {
  if (e.target === $('overlay')!) hideModal();
});

/* ═══ init ═══ */
const isMode = (m: string): m is Mode => m === 'solo' || m === 'daily' || m === 'timed' || m === 'duel';
const isH = (x: string): x is '4' | '5' | '6' => x === '4' || x === '5' || x === '6';
const qs = new URLSearchParams(location.search);
const modeFromUrl = qs.get('mode') || '';
const hFromUrl = qs.get('h') || '';
if (isH(hFromUrl)) {
  st.height = Number(hFromUrl) as Height;
  document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) => {
    b.classList.toggle('active', b.dataset.h === hFromUrl);
  });
}
if (isMode(modeFromUrl)) enterMode(modeFromUrl);
else location.replace(LOBBY_URL);