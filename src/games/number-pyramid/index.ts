/* === 通用竞赛外壳（1v1+多人+随机匹配） === */
import { mountCompetition } from "../_shared/mp-client";
import { createNumberPyramidAdapter } from "../_shared/mp-adapters/number-pyramid";
/**
 * 数字金字塔 · 牌桌逻辑（beta：全本地，无 API）
 * 塔规则：第 k 层第 i 格 = 第 k+1 层 i 格 + 第 k+1 层 i+1 格。
 * 给定若干 given，从下往上能唯一反推。设计稿难度按塔高：Swift 4 / Standard 5 / Deep 6。
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
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
  cellsAt,
  totalCells,
  nextDeterminable,
  botStep,
  type Height,
  type Tower,
} from './engine';
import { shanghaiDateKey } from '../sudoku/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'MathDuel',
  brandSub: 'Number Pyramid',
  mark: '△',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
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
  botTotal: 0,
  botDone: 0,
  botTimer: null as number | null,
  // timed
  timedSolved: 0,
  timedDealt: 0,
  timedStreak: 0,
  timedStartTs: 0,
  // 多位数组合输入：正在逐位输入的格下标（-1 = 无）
  composing: -1,
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
const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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
  const row = level + 1; // cellsAt(level)：apex 1 格居中，底行 levels 格铺满（勿用 levels - level，会整塔反置）
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
  if (m === 'timed') {
    st.timedStartTs = Date.now();
    st.timedDealt++;
  }
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
  st.composing = -1;
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
  $('result')!.classList.remove('win');
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
  const ht = $('hudTime');
  if (ht) {
    ht.textContent = st.mode === 'timed'
      ? fmtClock(Math.max(0, TIMED_LIMIT - (Date.now() - st.timedStartTs) / 1000))
      : fmtClock(st.elapsed);
  }
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
  if (st.mode === 'duel' && st.owner[i] === 1 && !v) cls.push('mine');
  if (st.composing === i) cls.push('composing');
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
    if (st.grid[i] !== 0 && st.composing !== i) {
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
  if (st.composing >= 0 && st.composing !== i) {
    // 离开未完成的组合输入（半截数字不构成任何判定）→ 丢弃
    st.grid[st.composing] = 0;
    st.composing = -1;
  }
  st.sel = i;
  renderBoard();
  updateHud();
}

/* ═══ 填数 / 笔记 ═══ */
let lastNudge = 0;
function nudgePick(): void {
  const now = Date.now();
  if (now - lastNudge < 2000) return;
  lastNudge = now;
  toast('👆 Pick a brick first');
}

function flashCell(i: number, cls: string): void {
  const c = document.querySelector<HTMLElement>(`#p1board [data-i="${i}"]`);
  if (!c) return;
  c.classList.add(cls);
  window.setTimeout(() => c.classList.remove(cls), 420);
}

function place(v: number): void {
  if (!st.running) return;
  if (st.sel < 0) {
    nudgePick();
    return;
  }
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
  // 多位数组合输入：洞格值 = 两数之和，常 ≥ 10（最大 131）。
  // 连按组成多位：等于解 → 提交判对；是解的前缀（如 15 打了 1）→ 挂起虚线待续；否则判错。
  const next = st.grid[i] && st.composing === i ? st.grid[i] * 10 + v : v;
  const sol = st.tower!.solution[i];
  if (next !== sol && String(sol).startsWith(String(next))) {
    st.grid[i] = next;
    st.composing = i;
    renderBoard();
    renderDep();
    updateHud();
    return;
  }
  st.composing = -1;
  const correct = next === sol;
  if (!correct) {
    st.mistakes++;
    st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
    st.grid[i] = next;
    st.flash.add(i);
    renderBoard();
    renderDep();
    flashCell(i, 'p1shake');
    if (st.mode === 'duel') toast(`⚔️ Mistake! +${DUEL_PENALTY}s penalty`);
    else if (st.mistakes >= MAX_MISTAKES) window.setTimeout(() => endMistakes(), 500);
    window.setTimeout(() => {
      if (st.grid[i] === next) st.grid[i] = 0;
      st.flash.delete(i);
      renderBoard();
      renderDep();
      updateHud();
    }, 650);
    return;
  }
  st.grid[i] = next;
  st.marks[i].clear();
  // 自动跳到下一个可确定格（duel 只跳自己半边的）——须在 renderBoard 前改 sel，否则 DOM 停在旧格
  const det = nextDeterminable(st.grid, st.tower!.levels);
  const adv = st.mode === 'duel' ? det.filter((j) => st.owner[j] === 1) : det;
  if (adv.length) st.sel = adv[0];
  if (st.mode === 'duel') renderOppStatus();
  renderBoard();
  renderDep();
  flashCell(i, 'p1pop');
  updateHud();
  checkWin();
}

function erase(): void {
  if (!st.running) return;
  if (st.sel < 0) {
    nudgePick();
    return;
  }
  const i = st.sel;
  if (st.owner[i] === 2) return;
  if (st.tower!.givens.includes(i) && st.grid[i] !== 0) {
    toast('📌 That brick is given');
    return;
  }
  if (st.notes && !st.grid[i]) {
    st.marks[i].clear();
    renderBoard();
    return;
  }
  if (st.composing === i) st.composing = -1;
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
  const res = $('result')!;
  res.classList.add('win');
  res.innerHTML = `✅ Tower climbed in <b>${fmt(t)}</b>${extra}`;
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
      st.timedDealt++;
      resetBoard(true);
      renderBoard();
      renderDep();
      updateHud();
      beginTimer();
      $('result')!.innerHTML = `✅ #${st.timedSolved} · ${st.timedStreak} streak — next tower!`;
    }
  }, 1500);
  const res2 = $('result')!;
  res2.classList.add('win');
  res2.innerHTML = `✅ #${st.timedSolved} in <b>${fmt(st.elapsed)}</b> — next tower incoming…`;
}

function endTimed(): void {
  stopAll();
  showModal(
    `<div class="p1-verdict">⏱ Time’s up</div>
     <div class="p1-scores">
       <div class="p1-me num">${st.timedSolved}<small>solved</small></div>
       <div class="p1-op num">${st.timedStreak}<small>best streak</small></div>
       <div class="p1-op num">${Math.max(0, st.timedDealt - st.timedSolved)}<small>unsolved</small></div>
     </div>
     <div class="p1-acts">
       <button class="p1-prim" id="mAgain">↻ Run it again</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => {
        hideModal();
        st.timedSolved = 0; st.timedStreak = 0; st.timedDealt = 0;
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
  const filled = st.grid.reduce((n, v, idx) => (v && st.composing !== idx ? n + 1 : n), 0);
  $('hudFilled')!.textContent = `${filled} / ${st.grid.length}`;
  const lives = $('hudLives');
  if (lives) [...lives.children].forEach((dot, k) => dot.classList.toggle('off', st.mistakes > k));
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

/** 方向键金字塔导航：左右同行环绕；上/下跨层（越界不动）；
 *  duel 中跳过 bot 的格子（同行环绕扫、跨层就近扫）。 */
function arrowNav(dc: number, dl: number): void {
  const t = st.tower;
  if (!t || !st.running) return;
  const levels = t.levels;
  const playable = (i: number): boolean => st.mode !== 'duel' || st.owner[i] === 1;
  if (st.sel < 0) {
    const first = t.holes.find((i) => playable(i));
    if (first != null) {
      st.sel = first;
      renderBoard();
      updateHud();
    }
    return;
  }
  const p = posOf(st.sel, levels);
  let target = -1;
  if (dl === 0) {
    const rowSize = cellsAt(p.level, levels);
    for (let step = 1; step <= rowSize; step++) {
      const col = (((p.col + dc * step) % rowSize) + rowSize) % rowSize;
      const i = idxAt(p.level, col, levels);
      if (playable(i)) {
        target = i;
        break;
      }
    }
  } else {
    const nl = p.level + dl;
    if (nl >= 0 && nl <= levels - 1) {
      const rowSize = cellsAt(nl, levels);
      const col = Math.min(p.col, rowSize - 1);
      for (let off = 0; off < rowSize && target < 0; off++) {
        const dirs = off === 0 ? [0] : [-off, off];
        for (const d of dirs) {
          const c2 = col + d;
          if (c2 < 0 || c2 >= rowSize) continue;
          const i = idxAt(nl, c2, levels);
          if (playable(i)) {
            target = i;
            break;
          }
        }
      }
    }
  }
  if (target >= 0 && target !== st.sel) {
    st.sel = target;
    renderBoard();
    updateHud();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '9') place(Number(e.key));
  else if (e.key === 'Backspace' || e.key === 'Delete') erase();
  else if (e.key === 'n' || e.key === 'N') toggleNotes();
  else if (e.key === 'ArrowLeft') { e.preventDefault(); arrowNav(-1, 0); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); arrowNav(1, 0); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); arrowNav(0, -1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); arrowNav(0, 1); }
  else if (e.key === 'Escape') {
    // 结算弹窗打开时先关弹窗，再退 lobby
    if (!$('overlay')!.hidden) hideModal();
    else goLobby();
  }
});

$('backLobby')!.addEventListener('click', goLobby);
$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', () => {
  if (!st.running || !st.tower) return;
  const det = nextDeterminable(st.grid, st.tower.levels);
  if (!det.length) return toast('🤔 No determinable brick right now');
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
  // 逻辑提示：指向可确定格但不泄值（把下方两格相加正是玩法本身）
  toast(`💡 r${p.level + 1}c${p.col + 1} is determinable — sum the two bricks below it`);
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
if (modeFromUrl === "battle") {
  mountCompetition({
    adapter: createNumberPyramidAdapter({ label: 'Number Pyramid', height: st.height, rounds: 3, timeLimit: 180 }),
    tabsEl: document.querySelector("#tabs") as HTMLElement | null,
    tabLabel: "Competition",
    hideOnOpen: ['#boardWrap'],
  });
} else if (isMode(modeFromUrl)) {
  enterMode(modeFromUrl);
} else {
  location.replace(LOBBY_URL);
}