/* === 通用竞赛外壳（1v1+多人+随机匹配） === */
import { mountCompetition } from "../_shared/mp-client";
import { createEqpyrAdapter } from "../_shared/mp-adapters/eqpyr";
/**
 * 等式金字塔 · 牌桌逻辑
 * 玩法：3×3 board，每格 = 数字 + 上行运算符；target 是 apex 目标。
 * 玩家按点击顺序选 3 格：第 1 格 = anchor（op 删除线）；
 * 公式 = a [b.op] b [c.op] c = target，按 ×÷ 优先 +− 次之 计算。
 * 难度按「解的数量」分：Warm-up 6-12 / Standard 4-7 / Tricky 恰好 3。
 * 目标：穷尽所有解（banked chips），而非填空白格。
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
import '../24-game/styles.css';
import '../24-game/arena.css';
import './eqpy.css';

import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import { shanghaiDateKey } from '../sudoku/engine';
import {
  generateBoard,
  dailyBoard,
  evalTriple,
  describeSolution,
  type Board,
  type Tier,
} from './engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'MathDuel',
  brandSub: 'Equation Pyramid',
  mark: '△',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    ],
});

type Mode = 'solo' | 'daily' | 'timed' | 'duel';
const TIMED_LIMIT = 60;
const DUEL_PENALTY = 2.5;
const HINT_BUDGET = 3;

const tierLabel = (t: Tier): string => ({ warmup: 'Warm-up', standard: 'Standard', tricky: 'Tricky' })[t];

/* ═══ 状态 ═══ */
const st = {
  mode: 'solo' as Mode,
  tier: 'standard' as Tier,
  board: null as Board | null,
  picks: [] as number[], // 按点击顺序的 cell idx
  banked: new Set<string>(), // 已经银行过的 solution key（避免同一解被重复 bank）
  running: false,
  startTs: 0,
  elapsed: 0,
  penalty: 0,
  timer: null as number | null,
  score: 0,
  misses: 0,
  hintsLeft: HINT_BUDGET,
  // timed
  timedSolved: 0,
  timedDealt: 0,
  timedStreak: 0,
  timedStartTs: 0,
  // duel
  myBanks: 0, // 玩家本人的 bank 数（st.banked 是共享池，含 bot 的）
  oppBanks: 0,
  oppTimer: null as number | null,
};

const LS_BEST = 'ep_best_v1';
const LS_DAILY = 'ep_daily_v1';
const LS_TIER = 'ep_tier_v1';
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

const LOBBY_URL = '/games/equation-pyramid/lobby/';
const goLobby = (): void => { location.href = LOBBY_URL; };

function mulberryFromDate(seedExtra: number): () => number {
  let a = ((Date.now() ^ (seedExtra * 0x9e3779b9)) >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══ 模式入口 ═══ */
function enterMode(m: Mode): void {
  stopAll();
  st.mode = m;
  document.querySelectorAll<HTMLButtonElement>('#tabs .ep-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  const duel = m === 'duel';
  $('oppHead')!.hidden = !duel;
  $('diffPick')!.style.display = m === 'daily' ? 'none' : '';
  startRound();
}

function stopAll(): void {
  if (st.timer) window.clearInterval(st.timer);
  if (st.oppTimer) window.clearTimeout(st.oppTimer);
  st.timer = null;
  st.oppTimer = null;
  st.running = false;
}

let roundNonce = 0;
function newRoundBoard(): Board {
  roundNonce = (roundNonce + 1) | 0;
  return generateBoard(st.tier, mulberryFromDate(roundNonce));
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
    st.board = dailyBoard(dk);
    banner(`<div class="ep-bn"><div class="ep-bt">🌐 Daily Hunt #${dk}</div><div class="ep-bs">Find every equation that lands on ${st.board.target}</div></div>`);
  } else {
    st.board = newRoundBoard();
    banner(
      m === 'timed'
        ? `<div class="ep-bn"><div class="ep-bt">⏱ Timed · ${TIMED_LIMIT}s · exhaust as many as you can</div><div class="ep-bs">Found <b id="tmSolved">0</b> · Streak <b id="tmStreak">0</b></div></div>`
        : `<div class="ep-bn"><div class="ep-bt">🎯 ${tierLabel(st.tier)} · target ${st.board.target} · ${st.board.solutions.length} ways in</div><div class="ep-bs">Bank every equation; bank all ${st.board.solutions.length} to clear.</div></div>`,
    );
  }
  resetBoard();
  renderBoard();
  renderTarget();
  renderStrip();
  renderTray();
  updateHud();
  if (st.mode === 'duel') scheduleOpp();
  beginTimer();
}

function resetBoard(): void {
  st.picks = [];
  st.banked = new Set();
  st.score = 0;
  st.misses = 0;
  st.hintsLeft = HINT_BUDGET;
  st.myBanks = 0;
  st.oppBanks = 0;
  // 清掉上一局的 hint 残留（dataset.hinted 挂在复用的 cell DOM 上，不删会跨局发光）
  document.querySelectorAll<HTMLElement>('#epgrid .epc').forEach((c) => { delete c.dataset.hinted; });
  st.elapsed = 0;
  st.penalty = 0;
  st.startTs = Date.now();
  st.running = true;
  $('result')!.textContent = st.mode === 'duel' ? 'Find equations before Bot does' : 'Click three cells · the click order is the formula';
}

/* ═══ 计时 ═══ */
function beginTimer(): void {
  if (st.timer) window.clearInterval(st.timer);
  st.timer = window.setInterval(tick, 100);
  tick();
}
function effElapsed(): number { return (Date.now() - st.startTs) / 1000 + st.penalty; }
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

/* ═══ 渲染：board / target / strip / tray ═══ */
function renderTarget(): void {
  $('targetNum')!.textContent = String(st.board!.target);
}

function renderBoard(): void {
  const el = $('epgrid')!;
  if (!el.dataset.built) {
    el.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'epc';
      d.dataset.i = String(i);
      d.setAttribute('role', 'gridcell');
      d.innerHTML = '<span class="ep-op">·</span><span class="ep-num">·</span>';
      el.appendChild(d);
    }
    el.dataset.built = '1';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!t) return;
      onCellClick(Number(t.dataset.i));
    });
  }
  // 更新内容 + 状态类
  for (let i = 0; i < 9; i++) {
    const cell = el.children[i] as HTMLElement;
    const c = st.board!.cells[i];
    cell.querySelector('.ep-op')!.textContent = c.op;
    cell.querySelector('.ep-num')!.textContent = String(c.num);
    // 状态：pick1/2/3 在 picks 中？banked？hinted？
    const pickIdx = st.picks.indexOf(i);
    const isBanked = isInBankedSolution(i);
    cell.classList.toggle('p1', pickIdx === 0);
    cell.classList.toggle('p2', pickIdx === 1);
    cell.classList.toggle('p3', pickIdx === 2);
    cell.classList.toggle('banked', isBanked && pickIdx < 0);
    cell.classList.toggle('hinted', (cell.dataset.hinted === '1'));
  }
}

/** 单元 i 是否出现在任一已 banked 解中（用于渲染灰金色） */
function isInBankedSolution(i: number): boolean {
  if (!st.board) return false;
  for (const triple of st.board.solutions) {
    const k = tripleKey(triple);
    if (st.banked.has(k) && triple.includes(i)) return true;
  }
  return false;
}

function tripleKey(triple: number[]): string {
  return [...triple].sort((a, b) => a - b).join(',');
}

function renderStrip(): void {
  const t = st.board!;
  const [a, b, c] = [st.picks[0], st.picks[1], st.picks[2]];
  const strip = $('strip')!;
  strip.classList.remove('ok', 'bad');
  // anchor slot
  const slotA = $('slotA')!;
  if (a != null) {
    slotA.classList.add('anchor');
    $('slotANum')!.textContent = String(t.cells[a].num);
  } else {
    slotA.classList.remove('anchor');
    $('slotANum')!.textContent = '—';
  }
  // sop1
  $('sop1')!.textContent = b != null ? t.cells[b].op : '?';
  // slotB
  $('slotB')!.innerHTML = b != null ? `<b>${t.cells[b].num}</b>` : '<b>—</b>';
  // sop2
  $('sop2')!.textContent = c != null ? t.cells[c].op : '?';
  // slotC
  $('slotC')!.innerHTML = c != null ? `<b>${t.cells[c].num}</b>` : '<b>—</b>';
  // result
  const sres = $('sresult')!;
  sres.classList.remove('ok', 'bad');
  if (c != null) {
    const parts = { a: t.cells[a].num, op1: t.cells[b].op, b: t.cells[b].num, op2: t.cells[c].op, c: t.cells[c].num };
    const val = evalTriple(parts.a, parts.op1, parts.b, parts.op2, parts.c);
    if (val === t.target) {
      // 检查是否构成新解
      const key = tripleKey([a, b, c]);
      if (!st.banked.has(key)) {
        st.banked.add(key);
        st.myBanks++;
        st.score += 100;
        sres.textContent = String(val);
        sres.classList.add('ok');
        strip.classList.add('ok');
        for (const ci of [a, b, c]) {
          const cell = document.querySelector<HTMLElement>(`#epgrid [data-i="${ci}"]`);
          if (cell) {
            cell.classList.add('epop');
            window.setTimeout(() => cell.classList.remove('epop'), 420);
          }
        }
        toast('✓ ' + describeSolution([a, b, c], t) + ' = ' + val);
        // 检查 board 是否已被穷尽
        if (st.banked.size >= t.solutions.length) {
          winBoard();
        }
      }
    } else if (val === null) {
      sres.textContent = '÷0!';
      sres.classList.add('bad');
      strip.classList.add('bad');
      st.misses++;
      st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
      toast('⚠️ Can’t divide by zero');
    } else {
      sres.textContent = String(val);
      sres.classList.add('bad');
      strip.classList.add('bad');
      st.misses++;
      st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
      toast(`✗ ${describeSolution([a, b, c], t)} = ${val} (target ${t.target})`);
    }
    if (sres.classList.contains('bad')) {
      strip.classList.add('eshake');
      window.setTimeout(() => strip.classList.remove('eshake'), 420);
    }
    renderTray();
  } else {
    sres.textContent = '—';
  }
}

function renderTray(): void {
  const t = st.board!;
  const chips: string[] = [];
  for (const triple of t.solutions) {
    const k = tripleKey(triple);
    if (st.banked.has(k)) chips.push(`<span class="ep-chip">✓ ${escHtml(describeSolution(triple, t))}</span>`);
  }
  const remaining = t.solutions.length - st.banked.size;
  const html = [
    `<span class="ep-lab">Found ${st.banked.size} of ${t.solutions.length}</span>`,
    ...chips,
    ...Array.from({ length: remaining }, () => '<span class="ep-dot"></span>'),
  ].join('');
  $('trayList')!.innerHTML = html;
}

function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

/* ═══ 单元格点击 ═══ */
let lastJudgeNudge = 0;
function nudgeJudge(): void {
  const now = Date.now();
  if (now - lastJudgeNudge < 2000) return;
  lastJudgeNudge = now;
  toast('⏳ Judging current pick — tap ↻ Clear to reset');
}

function onCellClick(i: number): void {
  if (!st.running || !st.board) return;
  // 同格重复点 → 取消该格（移除）
  const idx = st.picks.indexOf(i);
  if (idx >= 0) {
    st.picks.splice(idx, 1);
    renderBoard();
    renderStrip();
    return;
  }
  if (st.picks.length >= 3) {
    nudgeJudge(); // 已选满 3 格，判定中
    return;
  }
  st.picks.push(i);
  renderBoard();
  renderStrip();
  // 第三格点击后 strip 自动判（renderStrip 内已判）
  if (st.picks.length === 3) {
    // 0.7s 后重置 picks，让玩家继续选下一组
    window.setTimeout(() => {
      if (st.picks.length === 3) {
        st.picks = [];
        renderBoard();
        renderStrip();
      }
    }, 800);
  }
}

/* ═══ HUD ═══ */
function updateHud(): void {
  const t = st.board!;
  $('hudScore')!.textContent = String(st.score);
  $('hudTime')!.textContent = fmtClock(st.elapsed);
  $('hudLeft')!.textContent = String(Math.max(0, t.solutions.length - st.banked.size));
  $('hudMiss')!.textContent = String(st.misses);
  $('hintLeft')!.textContent = `×${st.hintsLeft}`;
  if (st.mode === 'duel') {
    $('youStatus')!.innerHTML = `<span class="d"></span>${st.myBanks} banks`;
    $('oppStatus')!.innerHTML = `<span class="d"></span>${st.oppBanks} banks`;
  } else {
    $('youStatus')!.innerHTML = `<span class="d"></span>${st.banked.size} of ${t.solutions.length}`;
  }
}

/* ═══ 胜负 ═══ */
function winBoard(): void {
  st.running = false;
  if (st.timer) window.clearInterval(st.timer);
  if (st.mode === 'duel') {
    finishDuel(true);
    return;
  }
  if (st.mode === 'timed') {
    st.timedSolved++;
    st.timedStreak++;
    window.setTimeout(() => {
      if (st.mode === 'timed' && (Date.now() - st.timedStartTs) / 1000 < TIMED_LIMIT) {
        st.board = newRoundBoard();
        st.timedDealt++;
        resetBoard();
        renderBoard();
        renderTarget();
        renderStrip();
        renderTray();
        updateHud();
        beginTimer();
        $('result')!.innerHTML = `✅ Board cleared in <b>${fmt(st.elapsed)}</b> — next!`;
      }
    }, 1500);
    $('result')!.innerHTML = `✅ Cleared in <b>${fmt(st.elapsed)}</b> — ${st.timedStreak} streak`;
    return;
  }
  // solo / daily
  const t = st.elapsed;
  let extra = '';
  if (st.mode === 'daily') {
    const dk = shanghaiDateKey();
    const d = readJSON<Record<string, number>>(LS_DAILY, {});
    if (!d[dk]) {
      d[dk] = Math.round(t * 10) / 10;
      writeJSON(LS_DAILY, d);
      extra = '<div class="ep-extra">🌐 Daily hunt logged — see you tomorrow!</div>';
    } else {
      extra = '<div class="ep-extra">Already logged today — replay doesn’t overwrite.</div>';
    }
  } else {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const k = st.tier;
    if (!b[k] || t < b[k]) {
      b[k] = Math.round(t * 10) / 10;
      writeJSON(LS_BEST, b);
      extra = '<div class="ep-extra">🥇 New personal best!</div>';
    }
  }
  $('result')!.innerHTML = `✅ Exhausted in <b>${fmt(t)}</b>${extra}`;
  showModal(
    `<div class="ep-verdict">All equations banked 🎉</div>
     <div class="ep-scores"><div class="ep-me num">${fmt(t)}<small>your time</small></div></div>
     ${extra}
     <div class="ep-acts">
       <button class="ep-prim" id="mAgain">↻ New board</button>
       <button id="mLobby">🏠 Lobby</button>
     </div>`,
    () => {
      ($('mAgain') as HTMLButtonElement).onclick = () => { hideModal(); startRound(); };
      ($('mLobby') as HTMLButtonElement).onclick = () => { hideModal(); goLobby(); };
    },
  );
}

function endTimed(): void {
  stopAll();
  showModal(
    `<div class="ep-verdict">⏱ Time’s up</div>
     <div class="ep-scores">
       <div class="ep-me num">${st.timedSolved}<small>boards cleared</small></div>
       <div class="ep-op num">${st.timedStreak}<small>best streak</small></div>
       <div class="ep-op num">${Math.max(0, st.timedDealt - st.timedSolved)}<small>unsolved</small></div>
     </div>
     <div class="ep-acts">
       <button class="ep-prim" id="mAgain">↻ Run it again</button>
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

function scheduleOpp(): void {
  // 简化 bot：每 2-4s 随机从剩余解中 bank 一个
  const step = (): void => {
    if (!st.running || st.mode !== 'duel') return;
    const t = st.board!;
    const remaining = t.solutions.filter((tri) => !st.banked.has(tripleKey(tri)));
    if (!remaining.length) return;
    const triple = remaining[Math.floor(Math.random() * remaining.length)];
    st.banked.add(tripleKey(triple));
    st.oppBanks++;
    st.score = Math.max(0, st.score - 50);
    toast(`🤖 Bot banked ${describeSolution(triple, t)}`);
    renderBoard();
    renderTray();
    updateHud();
    if (st.banked.size >= t.solutions.length) {
      // bot 收下最后一解 → bot 胜（玩家收尾走 renderStrip → winBoard → finishDuel(true)）
      finishDuel(false);
      return;
    }
    st.oppTimer = window.setTimeout(step, 2000 + Math.random() * 2000);
  };
  st.oppTimer = window.setTimeout(step, 2200);
}

function finishDuel(playerWon: boolean): void {
  stopAll();
  $('result')!.innerHTML = playerWon
    ? `🏆 You banked the last one in <b>${fmt(st.elapsed)}</b>`
    : `🤖 Bot banked the last one — you had ${st.myBanks} banks`;
  showModal(
    `<div class="ep-verdict">${playerWon ? 'You win 🏆' : 'Bot wins 🤖'}</div>
     <div class="ep-scores">
       <div class="ep-me num">${playerWon ? fmt(st.elapsed) : `${st.myBanks} banks`}<small>you</small></div>
       <div class="ep-op num">${playerWon ? `${st.oppBanks} banks` : fmt(st.elapsed)}<small>Bot</small></div>
     </div>
     <div class="ep-acts">
       <button class="ep-prim" id="mAgain">⚔️ Rematch</button>
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
document.querySelectorAll<HTMLButtonElement>('#tabs .ep-tab').forEach((t) =>
  t.addEventListener('click', () => enterMode(t.dataset.mode as Mode)),
);

document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) =>
  b.addEventListener('click', () => {
    st.tier = b.dataset.t as Tier;
    document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((x) => x.classList.toggle('active', x === b));
    try { localStorage.setItem(LS_TIER, st.tier); } catch { /* ignore */ }
    if (st.mode === 'solo' || st.mode === 'duel') startRound();
  }),
);

$('clearBtn')!.addEventListener('click', () => {
  if (!st.running) return;
  st.picks = [];
  renderBoard();
  renderStrip();
});

$('newBtn')!.addEventListener('click', () => startRound());
$('hintBtn')!.addEventListener('click', () => {
  if (!st.running || !st.board) return;
  if (st.hintsLeft <= 0) return toast('🤔 No hints left');
  const t = st.board;
  const remaining = t.solutions.filter((tri) => !st.banked.has(tripleKey(tri)));
  if (!remaining.length) return toast('🤔 All banked');
  // 随机挑一个解的三个 cell 标 hinted（半透明提示）
  const tri = remaining[Math.floor(Math.random() * remaining.length)];
  // 只点亮解中的一个格（原实现三格全标 + 泄整条等式，剧透太狠）
  const cell = document.querySelector<HTMLElement>(`#epgrid [data-i="${tri[Math.floor(Math.random() * 3)]}"]`);
  if (cell) cell.dataset.hinted = '1';
  renderBoard();
  st.hintsLeft--;
  updateHud();
  toast('💡 One cell of an unbanked equation is glowing — build around it');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (!st.running) return;
    st.picks.pop();
    renderBoard();
    renderStrip();
  } else if (e.key === 'Escape') {
    // 结算弹窗打开时先关弹窗，再退 lobby
    if (!$('overlay')!.hidden) hideModal();
    else goLobby();
  }
});

$('backLobby')!.addEventListener('click', goLobby);
$('overlay')!.addEventListener('click', (e) => { if (e.target === $('overlay')!) hideModal(); });

/* ═══ init ═══ */
const isMode = (m: string): m is Mode => m === 'solo' || m === 'daily' || m === 'timed' || m === 'duel';
const isT = (x: string): x is Tier => x === 'warmup' || x === 'standard' || x === 'tricky';
const qs = new URLSearchParams(location.search);
const modeFromUrl = qs.get('mode') || '';
const tFromUrl = qs.get('t') || '';
if (isT(tFromUrl)) {
  st.tier = tFromUrl;
  document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) => {
    b.classList.toggle('active', b.dataset.t === tFromUrl);
  });
}
if (modeFromUrl === "battle" || modeFromUrl === "random") {
  mountCompetition({
    adapter: createEqpyrAdapter({ label: 'Equation Pyramid', tier: st.tier, rounds: 3, timeLimit: 60 }),
    tabsEl: document.querySelector("#tabs") as HTMLElement | null,
    tabLabel: "Competition",
    hideOnOpen: [],
  });
} else if (isMode(modeFromUrl)) {
  enterMode(modeFromUrl);
} else {
  location.replace(LOBBY_URL);
}