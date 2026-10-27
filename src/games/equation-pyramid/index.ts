/* === 通用竞赛外壳（1v1+多人+随机匹配） === */
import { mountCompetition } from "../_shared/mp-client";
import { recordDaily } from '../cross-game';
import { createEqpyrAdapter } from "../_shared/mp-adapters/eqpyr";
/**
 * 等式金字塔 · 牌桌逻辑
 * 玩法：金字塔 board（顶层 target，9 格按 2/3/4 三行展开），每格 = 数字 + 上行运算符；target 是 apex 目标。
 * 玩家按点击顺序选 3 格：第 1 格 = anchor（op 删除线）；
 * 公式 = a [b.op] b [c.op] c = target，按 ×÷ 优先 +− 次之 计算。
 * 难度按「解的数量」分：Warm-up 8-12 / Standard 4-7 / Tricky 恰好 3。
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
import { playSfx } from '../../shared/sfx';
import { bindLeaveCard, enterMatchMode, exitMatchToLobby } from '../_shared/match-guard';
import { bindSoundButton, keepAudioAlive } from '../_shared/match-sound';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

import { i18nT, escHtml, onI18nChange } from '../_shared/i18n-t';
initI18n();
/* 🔴 修复 (2026-10-03 移动端 P0 兜底) 监听 i18n:ready 事件 —— enterMode() 在 dict 异步加载完成之前已跑过，
   resetBoard 里 i18nT('mg.pyr_pick_first') 拿到 fallback 原 key 直接写进 #result 文本，
   等字典就绪后不再 rerender，导致对局页 #result 一直显示裸 key（gomoku 第 12 轮同款坑）。
   解决：监听 i18n:ready + i18n:change，触发时 rerenderResult 重新查 dict。 */
function rerenderResult(): void {
  const result = $('result');
  if (!result || !st.board || !st.running) return;
  if (result.classList.contains('win') || result.classList.contains('lose')) return; // 结算文案不动
  result.textContent = st.mode === 'duel' ? i18nT('mg.pyr_duel_first') : i18nT('mg.pyr_pick_first');
}
window.addEventListener('i18n:ready', rerenderResult);
window.addEventListener('i18n:change', rerenderResult);

mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'NumeriDuel',
  brandSub: 'Equation Pyramid',
  brandSubKey: 'math_home.g_pyr',
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
/** Bot 每解节奏（ms）· 按难度档递减 → 给人类留可胜区间（#09） */
const BOT_PACE: Record<Tier, number> = { warmup: 6000, standard: 3400, tricky: 1800 };
/** 玩家无操作超过该时长 → 提示一次（#09 零操作保护） */
const DUEL_IDLE_MS = 12000;

const TIER_KEY: Record<Tier, string> = { warmup: 'ml.diff_warmup', standard: 'ml.diff_standard', tricky: 'ml.diff_tricky' };
const tierLabel = (t: Tier): string => i18nT(TIER_KEY[t]);

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
  lastActTs: 0, // 玩家上次操作时刻（#09 零操作保护）
  idleWarned: false,
  timedLeft: TIMED_LIMIT, // Timed 剩余秒数（#12 倒计时）
  gatePending: false, // #14：等待玩家首点才开始计时
  gateUsed: false,
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
const MATCH_GUARD_OPTS = { leaveCardId: 'ep-leavecard', lobbyUrl: '/games/equation-pyramid/lobby/' };
bindLeaveCard(MATCH_GUARD_OPTS);
bindSoundButton('ep-sound');
keepAudioAlive();

function enterMode(m: Mode): void {
  stopAll();
  st.mode = m;
  document.querySelectorAll<HTMLButtonElement>('#tabs .ep-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  const duel = m === 'duel';
  $('oppHead')!.hidden = !duel;
  $('diffPick')!.style.display = m === 'daily' ? 'none' : '';
  startRound();
  // 进对局统一入口（24-game 范式 · 2026-10-03 接入）
  enterMatchMode(MATCH_GUARD_OPTS);
  playSfx('start');
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
/* 🔴 横幅必须独立成函数，且必须能在「字典就绪 / 语言切换」后重画。
   原因：enterMode() 在 i18n.js 异步加载字典之前就跑完了，i18nT() 只能回落到
   key 本身，于是 `mg.pyr_tier_target_sets` 这种原始键名被写进 #modeBanner，
   而 i18n.js 只重写 data-i18n* 静态骨架，不会回头修 JS 生成的节点
   —— 玩家就永久看到裸键（与 RULES-FE-D.md #88/#133 同类）。
   ⚠️ timed 的「已解/连对」是 tick() 每秒写入的活节点，标签与数值必须分开。 */
function renderModeBanner(): void {
  const b = st.board;
  if (!b) return;
  const m = st.mode;
  if (m === 'daily') {
    banner(
      `<div class="ep-bn"><div class="ep-bt">${escHtml(i18nT('mg.pyr_daily_hunt', { date: shanghaiDateKey() }))}</div>`
      + `<div class="ep-bs">${escHtml(i18nT('mg.pyr_daily_find_all', { target: b.target }))}</div></div>`,
    );
    return;
  }
  if (m === 'timed') {
    banner(
      `<div class="ep-bn"><div class="ep-bt">${escHtml(i18nT('mg.pyr_timed_banner', { limit: TIMED_LIMIT }))}</div>`
      + `<div class="ep-bs">${escHtml(i18nT('mg.pyr_lbl_solved'))} <b id="tmSolved">${st.timedSolved}</b> · `
      + `${escHtml(i18nT('mg.pyr_lbl_streak'))} <b id="tmStreak">${st.timedStreak}</b></div></div>`,
    );
    return;
  }
  // solo：gatePending（等玩家点第一格才起表）时副标题是「点这里开始」
  const sub = st.gatePending
    ? i18nT('mg.pyr_tap_to_start')
    : i18nT('mg.pyr_tier_bank_all', { sets: b.solutions.length });
  banner(
    `<div class="ep-bn"><div class="ep-bt">${escHtml(i18nT('mg.pyr_tier_target_sets', {
      tier: tierLabel(st.tier),
      target: b.target,
      sets: b.solutions.length,
    }))}</div><div class="ep-bs">${escHtml(sub)}</div></div>`,
  );
}

function startRound(): void {
  stopAll();
  const m = st.mode;
  if (m === 'timed') {
    st.timedStartTs = Date.now();
    st.timedDealt++;
  }
  if (m === 'daily') {
    st.board = dailyBoard(shanghaiDateKey());
  } else {
    st.board = newRoundBoard();
  }
  renderModeBanner();
  resetBoard();
  renderBoard();
  renderTarget();
  renderStrip();
  renderTray();
  updateHud();
  // #14：首次进入 solo/timed 不立即计时，等玩家点第一格再启动（避免“秒表已经开始”）
  st.gatePending = !st.gateUsed && (m === 'solo' || m === 'timed');
  renderModeBanner(); // gatePending 变了，副标题要跟着换
  if (st.gatePending) return;
  if (st.mode === 'duel') scheduleOpp();
  beginTimer();
}

/* 🔴 修裸键：字典就绪 / 玩家切语言时，横幅 + HUD + 计数条一起重画。
   之前只有 rerenderResult() 管 #result，#modeBanner 与 #trayLabel 一直是旧语言。 */
onI18nChange(() => {
  renderModeBanner();
  updateHud();
  if (st.board) {
    const lab = $('trayLabel');
    if (lab) lab.textContent = st.board.solutions.length
      ? i18nT('mg.pyr_found_of', { found: st.banked.size, total: st.board.solutions.length })
      : '—';
  }
  rerenderResult();
});

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
  st.lastActTs = Date.now();
  st.idleWarned = false;
  st.timedLeft = TIMED_LIMIT;
  $('result')!.textContent = st.mode === 'duel' ? i18nT('mg.pyr_duel_first') : i18nT('mg.pyr_pick_first');
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
    st.timedLeft = left;
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
  const b = st.board;
  if (!b) return; // P1 guard：st.board 在 startRound() 前为 null，避免 'reading target' 崩溃
  $('targetNum')!.textContent = String(b.target);
}

function renderBoard(): void {
  const el = $('epgrid')!;
  const b = st.board;
  if (!el.dataset.built) {
    // 金字塔布局：顶层 target（HTML 静态），9 个 cell 按 2/3/4 三行排布
    el.innerHTML = '';
    let i = 0;
    for (const n of [2, 3, 4]) {
      const row = document.createElement('div');
      row.className = 'ep-row';
      for (let k = 0; k < n; k++, i++) {
        const d = document.createElement('div');
        d.className = 'epc';
        d.dataset.i = String(i);
        d.setAttribute('role', 'gridcell');
        d.innerHTML = '<span class="ep-op">·</span><span class="ep-num">·</span>';
        row.appendChild(d);
      }
      el.appendChild(row);
    }
    el.dataset.built = '1';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!t) return;
      onCellClick(Number(t.dataset.i));
    });
  }
  // 更新内容 + 状态类
  if (!b) return; // P1 guard：st.board 为 null（首屏尚未 startRound）时只建骨架不渲染内容
  const cells = el.querySelectorAll<HTMLElement>('.epc');
  for (let i = 0; i < 9; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const c = b.cells[i];
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
  const t = st.board;
  if (!t) return; // P1 guard
  const [a, b, c] = [st.picks[0], st.picks[1], st.picks[2]];
  const strip = $('strip')!;
  strip.classList.remove('ok', 'bad', 'eshake');
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
      } else {
        // #10：同一组 3 格换顺序 → 提示“已找到”，不静默、不扣分
        sres.textContent = String(val);
        sres.classList.add('ok');
        strip.classList.add('ok');
        toast(i18nT('mg.ep_already_found'));
      }
    } else if (val === null) {
      sres.textContent = '÷0!';
      sres.classList.add('bad');
      strip.classList.add('bad');
      st.misses++;
      st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
      toast(i18nT('mg.ep_div_zero'));
    } else {
      sres.textContent = String(val);
      sres.classList.add('bad');
      strip.classList.add('bad');
      st.misses++;
      st.penalty += st.mode === 'duel' ? DUEL_PENALTY : 0;
      toast(i18nT('mg.pyr_target_note', {
        eq: describeSolution([a, b, c], t),
        val,
        target: t.target,
      }));
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
  const t = st.board;
  if (!t) return; // P1 guard
  const found = st.banked.size;
  const total = t.solutions.length;
  // #11：复用页面里唯一的 #trayLabel，不再往 #trayList 里再插一个并列计数标签
  const lab = $('trayLabel');
  if (lab) lab.textContent = total ? i18nT('mg.pyr_found_of', { found, total }) : '—';
  const chips: string[] = [];
  for (const triple of t.solutions) {
    const k = tripleKey(triple);
    if (st.banked.has(k)) chips.push(`<span class="ep-chip">✓ ${escHtml(describeSolution(triple, t))}</span>`);
  }
  const remaining = total - found;
  $('trayList')!.innerHTML = [
    ...chips,
    ...Array.from({ length: remaining }, () => '<span class="ep-dot"></span>'),
  ].join('');
}

/* 🔴 escHtml 已统一到 ../_shared/i18n-t（本文件原本有一份私有实现）。
   私有版本只转义 & < >，漏了引号 —— 译文里出现 " 或 ' 时会把属性截断。
   共享版覆盖 & < > " '，且对 unknown 入参做了 String() 兜底。 */

/* ═══ 单元格点击 ═══ */
let lastJudgeNudge = 0;
function nudgeJudge(): void {
  const now = Date.now();
  if (now - lastJudgeNudge < 2000) return;
  lastJudgeNudge = now;
  toast(i18nT('mg.ep_judging'));
}

function onCellClick(i: number): void {
  if (!st.running || !st.board) return;
  // #14：首局点击即启动计时（gate）
  if (st.gatePending) {
    st.gatePending = false;
    st.gateUsed = true;
    st.startTs = Date.now();
    if (st.mode === 'timed') st.timedStartTs = Date.now();
    beginTimer();
  }
  st.lastActTs = Date.now();
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
  const t = st.board;
  if (!t) return; // P1 guard
  $('hudScore')!.textContent = String(st.score);
  $('hudTime')!.textContent = fmtClock(st.mode === 'timed' ? st.timedLeft : st.elapsed);
  $('hudLeft')!.textContent = String(Math.max(0, t.solutions.length - st.banked.size));
  $('hudMiss')!.textContent = String(st.misses);
  $('hintLeft')!.textContent = `×${st.hintsLeft}`;
  if (st.mode === 'duel') {
    $('youStatus')!.innerHTML = `<span class="d"></span>${escHtml(i18nT('mg.pyr_banks', { n: st.myBanks }))}`;
    $('oppStatus')!.innerHTML = `<span class="d"></span>${escHtml(i18nT('mg.pyr_banks', { n: st.oppBanks }))}`;
  } else {
    $('youStatus')!.innerHTML = `<span class="d"></span>${escHtml(i18nT('mg.pyr_of_total', {
      done: st.banked.size,
      total: t.solutions.length,
    }))}`;
  }
}

/* ═══ 胜负 ═══ */
function winBoard(): void {
  st.running = false;
  if (st.timer) window.clearInterval(st.timer);
  if (st.mode === 'duel') {
    endDuel();
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
        $('result')!.innerHTML = i18nT('mg.ep_board_cleared_html', { time: escHtml(fmt(st.elapsed)) });
      }
    }, 1500);
    $('result')!.innerHTML = i18nT('mg.ep_cleared_streak_html', {
    time: escHtml(fmt(st.elapsed)),
    streak: st.timedStreak,
  });
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
      recordDaily('equation-pyramid', { durationSec: t });
      extra = `<div class="ep-extra">${escHtml(i18nT('mg.ep_daily_logged'))}</div>`;
    } else {
      extra = `<div class="ep-extra">${escHtml(i18nT('mg.ep_daily_already'))}</div>`;
    }
  } else {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const k = st.tier;
    if (!b[k] || t < b[k]) {
      b[k] = Math.round(t * 10) / 10;
      writeJSON(LS_BEST, b);
      extra = `<div class="ep-extra">${escHtml(i18nT('mg.sd_newbest'))}</div>`;
    }
  }
  $('result')!.innerHTML = `${i18nT('mg.pyr_exhausted_html', { time: escHtml(fmt(t)) })}${extra}`;
  showModal(
    `<div class="ep-verdict">${escHtml(i18nT('mg.pyr_verdict_all_banked'))}</div>
     <div class="ep-scores"><div class="ep-me num">${fmt(t)}<small>${escHtml(i18nT('mg.pyr_lbl_your_time'))}</small></div></div>
     ${extra}
     <div class="ep-acts">
       <button class="ep-prim" id="mAgain">${escHtml(i18nT('mg.pyr_btn_new_board'))}</button>
       <button id="mLobby">${escHtml(i18nT('mg.shared_lobby'))}</button>
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
    `<div class="ep-verdict">${escHtml(i18nT('mg.pyr_verdict_timeup'))}</div>
     <div class="ep-scores">
       <div class="ep-me num">${st.timedSolved}<small>${escHtml(i18nT('mg.pyr_lbl_boards_cleared'))}</small></div>
       <div class="ep-op num">${st.timedStreak}<small>${escHtml(i18nT('mg.sd_lbl_best_streak'))}</small></div>
       <div class="ep-op num">${Math.max(0, st.timedDealt - st.timedSolved)}<small>${escHtml(i18nT('mg.sd_lbl_unsolved'))}</small></div>
     </div>
     <div class="ep-acts">
       <button class="ep-prim" id="mAgain">${escHtml(i18nT('mg.sd_btn_run_again'))}</button>
       <button id="mLobby">${escHtml(i18nT('mg.shared_lobby'))}</button>
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
  // Bot：按难度档 pace 从剩余解中随机 bank 一个（#09 可胜区间 + 零操作保护）
  const pace = BOT_PACE[st.tier] ?? 3400;
  const step = (): void => {
    if (!st.running || st.mode !== 'duel') return;
    const t = st.board;
    if (!t) return; // P1 guard
    const remaining = t.solutions.filter((tri) => !st.banked.has(tripleKey(tri)));
    if (!remaining.length) return;
    // 零操作保护：玩家长时间无操作 → 提示一次，避免被误判“卡死/作弊”
    if (Date.now() - st.lastActTs > DUEL_IDLE_MS && !st.idleWarned) {
      st.idleWarned = true;
      toast(i18nT('mg.ep_bot_banking'));
    }
    const triple = remaining[Math.floor(Math.random() * remaining.length)];
    st.banked.add(tripleKey(triple));
    st.oppBanks++;
    st.score = Math.max(0, st.score - 50);
    toast(i18nT('mg.ep_bot_banked', { solution: escHtml(describeSolution(triple, t)) }));
    renderBoard();
    renderTray();
    updateHud();
    if (st.banked.size >= t.solutions.length) {
      // 池子被清空 → 按 banks 计数统一结算（#09）
      endDuel();
      return;
    }
    // 每解节奏：难度档 pace + ±30% 抖动
    st.oppTimer = window.setTimeout(step, Math.round(pace * (0.7 + Math.random() * 0.6)));
  };
  st.oppTimer = window.setTimeout(step, Math.round(pace * 0.6));
}

/** 对局结算：统一以「bank 数」判定胜负与展示（#09） */
function endDuel(): void {
  stopAll();
  const t = st.board;
  if (!t) return; // P1 guard
  const total = t.solutions.length;
  const p = st.myBanks;
  const b = st.oppBanks;
  const playerWon = p > b;
  const tie = p === b;
  $('result')!.innerHTML = playerWon
    ? i18nT('mg.pyr_duel_you_bank_html', { n: p, total })
    : tie
      ? i18nT('mg.pyr_draw_banks_html', { n: p })
      : i18nT('mg.pyr_duel_bot_bank_html', { b, p });
  showModal(
    `<div class="ep-verdict">${escHtml(playerWon ? i18nT('mg.pyr_verdict_you_win') : tie ? i18nT('mg.pyr_verdict_draw') : i18nT('mg.pyr_verdict_bot_wins'))}</div>
     <div class="ep-scores">
       <div class="ep-me num">${p}<small>${escHtml(i18nT('mg.pyr_lbl_your_banks'))}</small></div>
       <div class="ep-op num">${b}<small>${escHtml(i18nT('mg.pyr_lbl_bot_banks'))}</small></div>
     </div>
     <div class="ep-acts">
       <button class="ep-prim" id="mAgain">${escHtml(i18nT('mg.sd_btn_rematch'))}</button>
       <button id="mLobby">${escHtml(i18nT('mg.shared_lobby'))}</button>
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
  if (st.hintsLeft <= 0) return toast(i18nT('mg.ep_no_hints'));
  const t = st.board;
  const remaining = t.solutions.filter((tri) => !st.banked.has(tripleKey(tri)));
  if (!remaining.length) return toast(i18nT('mg.ep_all_banked'));
  // 随机挑一个解的三个 cell 标 hinted（半透明提示）
  const tri = remaining[Math.floor(Math.random() * remaining.length)];
  // 只点亮解中的一个格（原实现三格全标 + 泄整条等式，剧透太狠）
  const cell = document.querySelector<HTMLElement>(`#epgrid [data-i="${tri[Math.floor(Math.random() * 3)]}"]`);
  if (cell) cell.dataset.hinted = '1';
  renderBoard();
  st.hintsLeft--;
  updateHud();
  toast(i18nT('mg.ep_hint_glow'));
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

$('backLobby')!.addEventListener('click', () => exitMatchToLobby(MATCH_GUARD_OPTS));
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
if (modeFromUrl === "battle" || modeFromUrl === "random" || (new URLSearchParams(location.search).get('room') || '').trim()) {
  mountCompetition({
    adapter: createEqpyrAdapter({ label: 'Equation Pyramid', tier: st.tier, rounds: 3, timeLimit: 60 }),
    tabsEl: document.querySelector("#tabs") as HTMLElement | null,
    tabLabelKey: 'mg.shared_tab_competition',
    hideOnOpen: [],
  });
} else if (isMode(modeFromUrl)) {
  enterMode(modeFromUrl);
} else {
  location.replace(LOBBY_URL);
}