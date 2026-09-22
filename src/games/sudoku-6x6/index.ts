/**
 * 6×6 数独 · UI 编排（beta 版：全部本地，无 API 依赖）
 * 模式：solo（3 难度）/ daily（seeded 每日一题）/ timed（45s 连解）/ duel（vs 本地 bot 竞速）
 * 视觉：24 ARENA 同款 token（body.arena remap），ember=你、teal=bot/冲突、paper=固定线索
 */

import '@tri-sites/design-system/styles';
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
mountHeader($('header')!, {
  brandName: 'MathDuel',
  brandSub: 'Sudoku 6×6',
  mark: '▦',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    { labelKey: 'nav.leaderboard', href: '/leaderboard/' },
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
  timedSkipped: 0,
  timedStreak: 0,
  timedStartTs: 0,
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

/* ═══ 视图切换 ═══ */
function showLobby(): void {
  stopAll();
  st.view = 'lobby';
  $('lobbyView')!.classList.remove('hidden');
  $('playView')!.classList.add('hidden');
  renderLobbySide();
}

function enterMode(m: Mode): void {
  stopAll();
  st.view = 'play';
  st.mode = m;
  $('lobbyView')!.classList.add('hidden');
  $('playView')!.classList.remove('hidden');
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
  if (m === 'timed') st.timedStartTs = Date.now();
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
function place(v: number): void {
  if (!st.running || st.sel < 0) return;
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
    st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
    if (st.mode === 'duel') toast(`⚔️ Conflict! +${DUEL_PENALTY}s penalty`);
    window.setTimeout(() => {
      if (st.grid[i] === v) {
        st.grid[i] = 0;
        st.filledBy[i] = 0;
        renderBoard();
      }
    }, 650);
    st.sel = i;
    renderBoard();
    return;
  }
  if (st.mode === 'duel') {
    renderOppStatus();
    botTrashTalk('playerFill');
  }
  st.sel = i;
  renderBoard();
  checkWin();
}

function erase(): void {
  if (!st.running || st.sel < 0) return;
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
        showLobby();
      };
    },
  );
  renderLobbySide();
}

/* ═══ Timed ═══ */
function winTimed(): void {
  st.timedSolved++;
  st.timedStreak++;
  window.setTimeout(() => {
    // 45s 整场窗口过后不再续盘
    if (st.mode === 'timed' && (Date.now() - st.timedStartTs) / 1000 < TIMED_LIMIT && st.puzzle) {
      st.puzzle = newRoundPuzzle();
      resetBoard(true);
      renderBoard();
      beginTimer(); // checkWin 胜利时清了计时器，续盘需重建
      $('result')!.innerHTML = `✅ #${st.timedSolved} · ${st.timedStreak} streak — next grid!`;
    }
  }, 700);
  $('result')!.innerHTML = `✅ #${st.timedSolved} in <b>${fmt(st.elapsed)}</b> — next grid incoming…`;
}

function endTimed(): void {
  stopAll();
  $('stMain')!.innerHTML = '⏱ Time!';
  showModal(
    '<div class="s6-verdict">⏱ Time\u2019s up</div>' +
      `<div class="s6-scores"><div class="me num">${st.timedSolved}<small>solved</small></div>` +
      `<div class="op num">${st.timedStreak}<small>best streak</small></div>` +
      `<div class="op num">${st.timedSkipped}<small>unsolved</small></div></div>` +
      '<div class="s6-acts"><button class="btn primary" id="mAgain">↻ Run it again</button><button class="btn ghost" id="mLobby">🏠 Lobby</button></div>',
    () => {
      $('mAgain')!.onclick = () => {
        hideModal();
        st.timedSolved = 0;
        st.timedStreak = 0;
        st.timedSkipped = 0;
        startRound();
      };
      $('mLobby')!.onclick = () => {
        hideModal();
        showLobby();
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
        showLobby();
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
    `<div class="stat-row"><span>Cells filled</span><b>${filled}/36</b></div>` +
    `<div class="stat-row"><span>Empty (this puzzle)</span><b>${holes}</b></div>` +
    `<div class="stat-row"><span>Difficulty</span><b>${st.mode === 'daily' ? 'Standard (fixed)' : diffLabel(st.diff)}</b></div>` +
    '<div class="hint-step"><b>·</b><span>Click a cell, then tap a number — or type 1–6, Backspace to erase.</span></div></div>' +
    bestRow;
}

function renderLobbySide(): void {
  const dk = shanghaiDateKey();
  const done = readJSON<Record<string, number>>(LS_DAILY, {});
  const best = readJSON<Record<string, number>>(LS_BEST, {});
  const today = done[dk];
  const weekly = Object.keys(done).sort().reverse().slice(0, 5);
  $('dailySide')!.innerHTML =
    (today
      ? `<div class="s6-drow me"><span class="rank">✓</span><span class="bname">Today · you</span><span class="bscore num">${fmt(today)}</span></div>`
      : `<div class="s6-drow"><span class="rank">–</span><span class="bname">Today</span><span class="bscore num">unsolved</span></div>`) +
    weekly
      .filter((k) => k !== dk)
      .map(
        (k) =>
          `<div class="s6-drow"><span class="rank">${k.slice(4)}</span><span class="bname">Daily grid</span><span class="bscore num">${fmt(done[k])}</span></div>`,
      )
      .join('') +
    `<button class="btn ghost s6-full" data-mode="daily">${today ? '↻ Replay today' : '▶ Play today\u2019s grid'}</button>` +
    `<div class="s6-bestline">Solo bests · E ${best.easy ? fmt(best.easy) : '—'} · S ${best.standard ? fmt(best.standard) : '—'} · H ${best.hard ? fmt(best.hard) : '—'}</div>`;
  $('lbBest')!.textContent = best.standard ? `Best ${fmt(best.standard)}` : 'Best —';
  $('lbCoins')!.textContent = '240';
}

/** 每日倒计时（UTC+8 次日零点）——只在 init 挂一次 */
function startDailyCountdown(): void {
  const tickCd = (): void => {
    const now = new Date();
    const utc8 = new Date(now.getTime() + 8 * 3600 * 1000);
    const next = Date.UTC(utc8.getUTCFullYear(), utc8.getUTCMonth(), utc8.getUTCDate() + 1, 0, 0, 0) - 8 * 3600 * 1000;
    const ms = Math.max(0, next - now.getTime());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const el = $('dailyCountdown');
    if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  tickCd();
  window.setInterval(tickCd, 1000);
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
document.querySelectorAll<HTMLButtonElement>('.s6-mode').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.classList.contains('ghost')) {
      toast('🚧 ' + (b.dataset.ghost || 'Coming soon'));
      return;
    }
    enterMode(b.dataset.mode as Mode);
  });
});

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

window.addEventListener('keydown', (e) => {
  if (st.view !== 'play') return;
  if (e.key >= '1' && e.key <= '6') place(Number(e.key));
  else if (e.key === 'Backspace' || e.key === 'Delete') erase();
  else if (e.key === 'Escape') showLobby();
});

$('backLobby')!.addEventListener('click', showLobby);
$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', () => {
  if (!st.running || !st.puzzle) return;
  const empties = [...Array(36)].map((_, i) => i).filter((i) => !st.grid[i] && !st.puzzle!.puzzle[i]);
  if (st.mode === 'duel') {
    const mine = empties.filter((i) => st.owner[i] === 1);
    if (!mine.length) return;
    const i = mine[Math.floor(Math.random() * mine.length)];
    st.sel = i;
    renderBoard();
    toast('💡 One of your cells — GridBot says it\u2019s ' + st.puzzle.solution[i]);
    return;
  }
  if (!empties.length) return;
  const i = empties[Math.floor(Math.random() * empties.length)];
  st.sel = i;
  renderBoard();
  toast('💡 Try cell r' + (rowOf(i) + 1) + 'c' + (colOf(i) + 1) + ' — maybe ' + st.puzzle.solution[i] + '?');
});

$('overlay')!.addEventListener('click', (e) => {
  if (e.target === $('overlay')!) hideModal();
});

/* Lobby 动态渲染的「Play today's grid」按钮（事件委托） */
$('lobbyView')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.s6-full');
  if (b) enterMode('daily');
});

/* ═══ init ═══ */
renderLobbySide();
startDailyCountdown();
renderSide();
botSay(BOT_LINES.hello[Math.floor(Math.random() * BOT_LINES.hello.length)]);
