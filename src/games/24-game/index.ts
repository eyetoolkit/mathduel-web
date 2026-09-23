/**
 * 24 点游戏 · UI 编排
 * 保留原实现全部行为（练习 / 每日挑战 5题·60s / 多人竞赛 99 人 / 分享），
 * 仅重组为模块化结构：engine（纯函数） + competition（联机） + share（分享） + 本文件（DOM 与状态机）。
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
// 24-game 公式区需要严格等宽对齐（formula / race-row / db-clock 等），保留 JetBrains Mono
import '@tri-sites/design-system/styles/mono';
import '../24-game/styles.css';
import './arena.css';
import './social.css';
import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import {
  countSolutions,
  dailyKeyStr,
  generate24Puzzle,
  hashString,
  isCompleteExpr,
  normalize24,
  safeEval,
  SeededRandom,
  solve,
  type Difficulty,
} from './engine';
import { Competition, isProdEnv, type RaceEntry, type EloEntry, type ChatMsg } from './competition';
import { initShareBindings, openShareOverlay, renderQR } from './share';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'MathDuel',
  brandSub: '24 · Card Table',
  mark: '24',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/games/24-game/' },
    { labelKey: 'nav.leaderboard', href: '/leaderboard/' },
  ],
});

/* ===================== 状态 ===================== */
const SUITS = ['♠', '♥', '♦', '♣'];
let difficulty: Difficulty = (localStorage.getItem('24_diff') as Difficulty) || 'standard';
let numbers: number[] = [];
let formula = '';
let historyStack: string[] = [];
const usedCardIndices = new Set<number>();
let timer = 0;
let interval: number | null = null;
let scores = { solved: 0, skipped: 0 };
let combo = 0;
let mode = 'practice';
let dailySeedVal = 0;

const cardsEl = $('cards')!;
const formulaEl = $('formula')!;
const resultEl = $('result')!;
const sideEl = $('side')!;

/* ===================== 本地统计 ===================== */
function loadScores(): void {
  try {
    scores = JSON.parse(localStorage.getItem('twentyfour_scores') || '{"solved":0,"skipped":0}');
  } catch {
    scores = { solved: 0, skipped: 0 };
  }
}
const saveScores = () => {
  try { localStorage.setItem('twentyfour_scores', JSON.stringify(scores)); } catch {}
};
const loadCombo = () => (combo = parseInt(localStorage.getItem('twentyfour_combo') || '0', 10) || 0);
const saveCombo = () => {
  try { localStorage.setItem('twentyfour_combo', String(combo)); } catch {}
};
function refreshTop(): void {
  const s = $('stSolved');
  const c = $('stCombo');
  if (s) s.textContent = String(scores.solved);
  if (c) c.textContent = String(combo);
}

/* ===================== 发牌与渲染 ===================== */
function deal(override?: number[]): void {
  numbers = override ? override.slice() : generate24Puzzle(undefined, difficulty);
  formula = '';
historyStack = [];
usedCardIndices.clear();
lastClickIndex = -1;
if (lastClickTimeout != null) {
  window.clearTimeout(lastClickTimeout);
  lastClickTimeout = null;
}
dealingAnim = true;
timer = 0;
  // 新发牌 = 清掉「答案已揭晓」锁
  document.body.classList.remove('answer-revealed');
  if (interval) window.clearInterval(interval);
  interval = window.setInterval(() => {
    if (comp.active) return;
    timer++;
    if (mode === 'practice') paintPracticeTimer();
  }, 1000);
  render();
  resultEl.className = 'result';
  resultEl.textContent = 'Use each card once — make 24';
}

const prettyFormula = (f: string) => f.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/-/g, ' − ');

/** 只在真正发牌那一刻播 dealIn 动画；此后每次点击重渲染不再复播
    —— 否则每次点击都会让整排牌重播发牌动画，看起来就是"点一下闪一下" */
let dealingAnim = false;
/** 最后点击的牌（用于 .selected 高亮，纯视觉反馈） */
let lastClickIndex = -1;
let lastClickTimeout: number | null = null;

function render(): void {
  const dealing = dealingAnim;
  dealingAnim = false;
  cardsEl.innerHTML = numbers
    .map((n, i) => {
      const used = usedCardIndices.has(i);
      const red = i === 1 || i === 3;
      const dealCls = dealing && !used ? 'dealing' : '';
      const selCls = !used && i === lastClickIndex ? 'selected' : '';
      const delay = dealing ? ` style="animation-delay:${i * 70}ms"` : '';
      return (
        `<div class="card ${used ? 'used' : ''} ${red ? 'red' : ''} ${dealCls} ${selCls}" data-i="${i}"` +
        ` role="button" tabindex="0" aria-label="card ${n}"${delay}>` +
        `<div class="suit">${SUITS[i]}</div>` +
        `<div class="num">${n}</div>` +
        `<div class="suit br">${SUITS[i]}</div></div>`
      );
    })
    .join('');

  // Practice 模式：刷新本局用时显示
  if (mode === 'practice') updatePracticeTimer();

  if (formula) {
    formulaEl.innerHTML = prettyFormula(formula)
      .split('')
      .map((c) => {
        if ('+-*/'.includes(c)) {
          const sym = ({ '+': '+', '-': '−', '*': '×', '/': '÷' } as Record<string, string>)[c];
          return `<span class="op">${sym}</span>`;
        }
        return `<span class="tok">${c}</span>`;
      })
      .join('');
  } else {
    formulaEl.classList.remove('success');
    formulaEl.innerHTML = '<span class="ph">Pick cards + operators to make 24</span>';
  }

  document.querySelectorAll('#diffPick button').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.d === difficulty);
  });
}

function computeUsedIndices(): void {
  usedCardIndices.clear();
  const runs = (formula.match(/[0-9]+/g) || []).map(Number);
  const need: Record<number, number> = {};
  for (const n of runs) {
    if (isNaN(n)) continue;
    need[n] = (need[n] || 0) + 1;
  }
  for (let i = 0; i < numbers.length; i++) {
    const n = numbers[i];
    if ((need[n] || 0) > 0) {
      usedCardIndices.add(i);
      need[n]--;
    }
  }
}

function append(text: string): void {
  historyStack.push(formula);
  formula += text;
  computeUsedIndices();
  render();
  checkAnswer();
}

const endsWithDigit = (s: string) => /\d$/.test(s);
const endsWithOp = (s: string) => /[+\-*/]$/.test(s);

/** 点数字：算式以数字或「)」结尾时自动补一个「+」再入数
    —— 连点数字即自动相加，不用先按运算符（旧版便捷行为，恢复） */
function appendNumber(n: string): void {
  if (endsWithDigit(formula) || formula.endsWith(')')) {
    append('+' + n);
    return;
  }
  append(n);
}

/** 点运算符：开头或「(」后无效（忽略）；连点运算符 = 替换上一个；其余正常追加 */
function appendOp(op: string): void {
  if (!formula || formula.endsWith('(')) return;
  if (endsWithOp(formula)) {
    historyStack.push(formula);
    formula = formula.slice(0, -1) + op;
    computeUsedIndices();
    render();
    checkAnswer();
    return;
  }
  append(op);
}

/** 点「(」：紧跟数字或「)」时自动补「×」（数学上相邻即乘，如 3×(4+5) 只需点 3 再点 ( ） */
function appendOpenParen(): void {
  if (endsWithDigit(formula) || formula.endsWith(')')) {
    append('*(');
    return;
  }
  append('(');
}

/** 点「)」：存在未闭合括号且前一个字符是数字或「)」时才闭合，否则忽略（杜绝空括号/乱闭合） */
function appendCloseParen(): void {
  const opens = (formula.match(/\(/g) || []).length;
  const closes = (formula.match(/\)/g) || []).length;
  if (opens <= closes) return;
  if (endsWithDigit(formula) || formula.endsWith(')')) append(')');
}
function undo(): void {
  if (!historyStack.length) return;
  formula = historyStack.pop()!;
  computeUsedIndices();
  render();
  checkAnswer();
}
function clearFormula(): void {
  formula = '';
  historyStack = [];
  computeUsedIndices();
  render();
  resultEl.className = 'result';
  resultEl.textContent = 'Use each card once — make 24';
}

const trim = (r: number) => (Math.round(r * 100) / 100).toString();

function checkAnswer(): void {
  if (!formula) return;
  const f = normalize24(formula);

  const fVals = (f.match(/[0-9]+/g) || []).map(Number);
  for (const v of fVals) {
    if (numbers.indexOf(v) === -1) {
      resultEl.className = 'result';
      resultEl.textContent = `Number ${v} is not in your cards`;
      return;
    }
  }
  if (!isCompleteExpr(f)) return; // 还没写完：保持安静，不打断输入节奏
  const uniq = [...new Set(numbers)];
  const cnt: Record<number, number> = {};
  for (const v of fVals) cnt[v] = (cnt[v] || 0) + 1;
  for (const n of uniq) {
    if ((cnt[n] || 0) !== numbers.filter((x) => x === n).length) {
      resultEl.className = 'result';
      resultEl.textContent = 'Each card must be used exactly once';
      return;
    }
  }
  try {
    const r = safeEval(f);
    if (Math.abs(r - 24) < 0.0001) onWin();
    else {
      resultEl.className = 'result';
      resultEl.textContent = `= ${trim(r)} — ${trim(24 - r)} away from 24`;
    }
  } catch {
    resultEl.className = 'result';
    resultEl.textContent = 'Incomplete — keep typing';
  }
}

function onWin(): void {
  resultEl.className = 'result ok';
  resultEl.textContent = '🎉 Solved!';
  formulaEl.classList.add('success');
  scores.solved++;
  saveScores();
  combo++;
  saveCombo();
  refreshTop();
  if (interval) {
    window.clearInterval(interval);
    interval = null;
  }
  const sols = countSolutions(numbers);
  if (comp.active) {
    // 记录本轮真实用时（DEMO 排名用；真实环境由服务端计时为准）
    comp.myTime = Math.max(0, (Date.now() - raceStartTs) / 1000);
    comp.submit(true, formula);
    return;
  }
  if (daily.active) {
    void dailySolve();
    return;
  }
  if (timed.active) {
    timedSolve();
    return;
  }
  window.setTimeout(() => showResult({ win: true, sols }), 600);
}

function showResult(o: { win: boolean; sols?: number; answer?: string | null }): void {
  const m = $('modal');
  if (!m) return;
  let html = '<h2 class="win-c">🎉 Solved!</h2>';
  if (o.sols != null) html += `<p class="sub">${o.sols} solution${o.sols === 1 ? '' : 's'} for this puzzle</p>`;
  if (o.answer) {
    let p = o.answer;
    if (p.startsWith('(') && p.endsWith(')')) p = p.slice(1, -1);
    html += `<div class="sol">${p.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−')} = 24</div>`;
  }
  html += '<div class="row"><button class="btn primary" id="mNext">🂠 New Deal</button></div>';
  $('overlay')?.classList.add('show');
  m.innerHTML = html;
  $('mNext')!.onclick = () => {
    $('overlay')?.classList.remove('show');
    deal();
  };
}

function giveHint(): void {
  const ans = solve(numbers.map((n) => ({ value: n, expr: String(n) })));
  if (!ans) {
    toast('No hint for this one');
    return;
  }
  // 去掉最外层括号，再按从左到右优先级拆出"算一步即可"的最小子表达式
  // 例: "(1 + 3) × (12 - 6)" → 先看 "1 + 3 = 4"，再算 "4 × 6 = 24"
  const e = ans[1].replace(/^\(|\)$/g, '');
  // 匹配形如 "-?d+ ×/÷/+/− -?d+" 的最小二元组（× ÷ 优先于 + −，按出现顺序抓最早的非 + - 项）
  const bin = e.match(/-?\d+\s*[×÷÷\*\/]\s*-?\d+/);
  const step = bin ? bin[0] : e;
  // 算这一步的近似结果（仅做"该多大"提示；具体数字精度由玩家自行核算）
  let approx = '';
  try {
    const v = safeEval(step.replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/[−]/g, '-'));
    approx = ` → ~${Math.round(v)}`;
  } catch { /* 拆不出来也不强算 */ }
  const kind = difficulty === 'easy' ? 'Try first:' : difficulty === 'hard' ? 'From here:' : 'Try first:';
  toast(`${kind} ${step.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−')}${approx}`);
}

function showAnswer(): void {
  const ans = solve(numbers.map((n) => ({ value: n, expr: String(n) })));
  if (!ans) {
    toast('No solution');
    return;
  }
  let p = ans[1];
  if (p.startsWith('(') && p.endsWith(')')) p = p.slice(1, -1);
  showResult({ win: true, answer: ans[1] });
  resultEl.className = 'result ok';
  resultEl.textContent = 'Answer: ' + p.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−') + ' = 24';
  // 答案揭晓后锁定输入：清空式子与已用牌状态，并拒绝后续 append，防止"接着上一题往下算"
  // —— 同时把已用牌保留为视觉提示，玩家可点 New Deal 重新发牌
  formula = '';
historyStack = [];
usedCardIndices.clear();
lastClickIndex = -1;
if (lastClickTimeout != null) {
  window.clearTimeout(lastClickTimeout);
  lastClickTimeout = null;
}
document.body.classList.add('answer-revealed');
render();
}

/* ===================== 每日挑战（服务端权威：/api/daily24/* · 全球同题 5 题 · 每题 60s · 连续制）
   线上契约（照 worker 实现，勿臆造）：
   · GET  /api/account/me             无 cookie 时自动建号并下发签名 cookie（HttpOnly; Secure）
   · GET  /api/daily24/puzzle?d=      → {date, puzzles:[[4 张牌]×5], times:[秒|null ×5], serverTime, windowSec}
                                       ★ 拉题即开 Q1 计时 → 必须等玩家点「开始」才拉题，否则白耗时间
   · POST /api/daily24/answer         {d,q,formula} → {ok,correct,elapsed,done,total,rank,times}
                                       超时不报错：{correct:false,timeout:true,elapsed:60} 且服务端推进下一题
   · GET  /api/daily24/leaderboard?d= → {date,count,top:[{rank,nickname,avatar,total,times}],me:{...}}
   接不上时（离线，或本地 http 下 Secure cookie 被浏览器拒收）→ 自动降级为本地确定性出题，不上全球榜。 */
const DAILY_N = 5; // 与服务端 dailyHands() 固定 5 题一致
const DAILY_WINDOW = 60; // 与服务端 D24_WINDOW_SEC 一致
// 必须与服务端 dailyHands 的分层计划对齐（T1,T1,T2,T2,T3）——标签要反映真实分层，否则误导玩家
const DAILY_DIFFS: Difficulty[] = ['easy', 'easy', 'standard', 'standard', 'hard'];
const diffForIndex = (i: number): Difficulty => DAILY_DIFFS[i % DAILY_DIFFS.length];
const diffLabel = (d: Difficulty): string => (d === 'easy' ? 'Easy' : d === 'hard' ? 'Hard' : 'Medium');
// 上海时间(UTC+8)的 YYYYMMDD：确保全球玩家"同一天"一致，不依赖浏览器本地时区
function shanghaiDateKey(d = new Date()): string {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const sh = new Date(utc + 8 * 3600000);
  return `${sh.getFullYear()}${String(sh.getMonth() + 1).padStart(2, '0')}${String(sh.getDate()).padStart(2, '0')}`;
}
function seedFromDateKey(dk: string): number {
  const y = parseInt(dk.slice(0, 4), 10);
  const m = parseInt(dk.slice(4, 6), 10);
  const d = parseInt(dk.slice(6, 8), 10);
  return (y * 10000 + m * 100 + d) * 1000 + (hashString('24-game') % 1000);
}
const daily = {
  active: false,
  started: false,
  canSubmit: false, // true = 已接入服务端，本局可上全球榜
  total: DAILY_N,
  idx: 0,
  limit: DAILY_WINDOW,
  timeLeft: DAILY_WINDOW,
  solved: 0,
  times: [] as (number | null)[],
  puzzles: [] as { idx: number; diff: Difficulty; cards: number[] }[],
  submits: [] as ({ solved: boolean; solution: string | null; time: number } | null)[],
  curDiff: 'standard' as Difficulty,
  key: '',
  dateKey: '',
  session: '',
  startTs: 0,
  qStartTs: 0, // 本题开始时刻（对齐服务端 qStartAt；连续制 = 上一题提交那一刻起跳）
  _iv: null as number | null,
};

const genSession = () => Math.random().toString(36).slice(2, 10);
const fmtClock = (s: number) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m + ':' + (ss < 10 ? '0' : '') + ss;
};

/** Practice 模式：本局用时 mm:ss（与 timed/daily 共用 fmtClock，便于在窄屏一致） */
function paintPracticeTimer(): void {
  const el = document.getElementById('practiceTimer');
  if (!el) return;
  el.textContent = '⏱ ' + fmtClock(timer);
}
function updatePracticeTimer(): void {
  if (mode === 'practice') paintPracticeTimer();
}

const dailyCompletedToday = () => {
  try {
    return JSON.parse(localStorage.getItem('twentyfour_daily') || '{}')[dailyKeyStr()] === true;
  } catch {
    return false;
  }
};
function dailyComplete(): void {
  const o: Record<string, boolean> = {};
  try {
    Object.assign(o, JSON.parse(localStorage.getItem('twentyfour_daily') || '{}'));
  } catch {
    /* ignore */
  }
  o[dailyKeyStr()] = true;
  try { localStorage.setItem('twentyfour_daily', JSON.stringify(o)); } catch {}
}

function startDaily(): void {
  daily.active = true;
  mode = 'daily';
  daily.total = DAILY_N;
  daily.limit = DAILY_WINDOW;
  daily.idx = 0;
  daily.solved = 0;
  daily.times = [];
  daily.submits = [];
  daily.puzzles = [];
  daily.session = genSession();
  daily.key = dailyKeyStr();
  daily.dateKey = shanghaiDateKey();
  dailySeedVal = seedFromDateKey(daily.dateKey);
  daily.started = false;
  daily.canSubmit = false;
  daily.qStartTs = 0;

  $('diffPick')!.style.display = 'none';
  $('hintBtn')!.style.display = 'none';
  $('answerBtn')!.style.display = '';
  $('enterBtn')!.classList.add('hidden');
  $('newBtn')!.classList.add('hidden');

  // 这里刻意不拉题：线上是「拉题即开 Q1 计时」，拉题必须推迟到玩家点「开始挑战」那一刻
  renderDailyPreStart();
  renderSide();
}

/* ─── 匿名身份 ───
   线上 /api/daily24/* 需要 md_uuid cookie；该端点在没有 cookie 时会自动建号并下发签名 cookie，
   所以前端只需在首次需要时调一次。本地 http 下 cookie 带 Secure 会被浏览器拒收 → 返回 false（走降级）。 */
let identityReady = false;
async function ensureIdentity(): Promise<boolean> {
  if (identityReady) return true;
  try {
    const res = await fetch('/api/account/me', { credentials: 'include' });
    if (res.ok) {
      identityReady = true;
      return true;
    }
  } catch {
    /* 离线 */
  }
  return false;
}

/** 取今日 5 题（全球同题）。成功 → canSubmit=true（可上全球榜）；失败 → 返回 false 由调用方降级。 */
async function loadDailyPuzzles(): Promise<boolean> {
  try {
    if (!(await ensureIdentity())) return false;
    const res = await fetch(`/api/daily24/puzzle?d=${daily.dateKey}`, { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    const raw: unknown = data.puzzles;
    if (!Array.isArray(raw) || raw.length !== DAILY_N) return false;
    const mapped = raw.map((cards: unknown, i: number) => ({
      idx: i,
      diff: DAILY_DIFFS[i] || ('standard' as Difficulty),
      cards: (Array.isArray(cards) ? cards : []).map(Number),
    }));
    if (mapped.some((p) => p.cards.length !== 4 || p.cards.some((n) => !Number.isFinite(n)))) return false;
    daily.puzzles = mapped;
    daily.times = Array.isArray(data.times) ? (data.times as (number | null)[]) : [];
    daily.limit = Number(data.windowSec) > 0 ? Number(data.windowSec) : DAILY_WINDOW;
    daily.timeLeft = daily.limit;
    daily.canSubmit = true;
    return true;
  } catch {
    return false;
  }
}

/** 离线兜底：同一天同一套题的确定性出题（照常可玩，但不参与全球榜）。 */
function buildLocalPuzzles(): void {
  daily.puzzles = [];
  for (let i = 0; i < DAILY_N; i++) {
    const diff = diffForIndex(i);
    const rng = SeededRandom(dailySeedVal + i * 7919 + 1);
    let cards = generate24Puzzle(rng, diff);
    let guard = 0;
    while (!solve(cards.map((n) => ({ value: n, expr: String(n) }))) && guard++ < 80) cards = generate24Puzzle(rng, diff);
    daily.puzzles.push({ idx: i, diff, cards });
  }
  daily.times = [];
  daily.limit = DAILY_WINDOW;
  daily.timeLeft = DAILY_WINDOW;
  daily.canSubmit = false;
}

function renderDailyPreStart(): void {
  // 题面尚未拉取（要等点「开始」），难度标签直接用服务端分层计划渲染
  const diffChips = DAILY_DIFFS.map((d) => `<span class="diff-chip d-${d}">${diffLabel(d)}</span>`).join('');
  $('modeBanner')!.innerHTML =
    '<div class="banner daily">' +
    '<div class="daily-top"><div class="daily-meta">' +
    `<div class="b-title">📅 Daily Challenge ${daily.key}</div>` +
    `<div class="b-sub">${DAILY_N} 道不同难度 · 全球同题 · 每题 ${DAILY_WINDOW} 秒 · 服务端统一计时</div>` +
    '</div></div>' +
    '<div class="db-diffs">' + diffChips + '</div>' +
    '<button class="btn primary db-start" id="dbStart">🂠 开始挑战</button>' +
    `<p class="db-hint">点击开始后将同时揭牌并启动计时；${DAILY_N} 题全部在限时内解出即「挑战成功」</p>` +
    '</div>';
  cardsEl.innerHTML = Array.from({ length: DAILY_N }, () => '<div class="cb"><span class="cb-q">?</span></div>').join('');
  resultEl.className = 'result';
  resultEl.textContent = '准备开始每日挑战';
  const sb = $('dbStart');
  if (sb) sb.onclick = beginDaily;
}

let dailyFetching = false;
async function beginDaily(): Promise<void> {
  if (!daily.active || daily.started || dailyFetching) return;
  dailyFetching = true;
  const sb = $('dbStart') as HTMLButtonElement | null;
  if (sb) {
    sb.disabled = true;
    sb.textContent = '⏳ 正在取题…';
  }
  const online = await loadDailyPuzzles();
  if (!online) buildLocalPuzzles();
  dailyFetching = false;
  if (!daily.active) return; // 取题期间用户切走了模式
  if (!online) toast('离线模式 — 本局不上全球榜');
  daily.started = true;
  daily.startTs = Date.now();
  daily.qStartTs = Date.now(); // 与服务端「拉题即开 Q1」对齐（响应延迟百毫秒级，对 60s 窗口无感）
  renderSide();
  dealDailyPuzzle();
}

function renderDailyBanner(): void {
  // 题数/时长由服务端固定（5 题 × 60s），不再提供选择器，避免「选了 90s 却被服务端按 60s 判超时」
  $('modeBanner')!.innerHTML =
    '<div class="banner daily">' +
    '<div class="daily-top"><div class="daily-meta">' +
    `<div class="b-title">📅 Daily Challenge ${daily.key}</div>` +
    `<div class="b-sub">Puzzle <b id="dbIdx">${daily.idx + 1}</b> / ${daily.total} · <b>${diffLabel(daily.curDiff)}</b> · Global same puzzle` +
    (daily.canSubmit ? '' : ' · <b>Offline</b>') +
    '</div></div></div>' +
    '<div class="db-timer"><div class="db-timer-fill" id="dbTimerFill"></div></div>' +
    `<div class="db-clock" id="dbClock">${fmtClock(daily.timeLeft)}</div>`;
}

function dealDailyPuzzle(): void {
  const p = daily.puzzles[daily.idx];
  if (!p) return;
  daily.curDiff = p.diff;
  if (!daily.qStartTs) daily.qStartTs = Date.now();
  renderDailyBanner();
  deal(p.cards);
  startDailyTimer();
}

/** 倒计时以「本题开始时刻」实时推算（与服务端权威计时同源），而不是本地逐秒自减。 */
function startDailyTimer(): void {
  if (daily._iv) window.clearInterval(daily._iv);
  if (!daily.qStartTs) daily.qStartTs = Date.now();
  const tick = () => {
    if (!daily.active) return;
    daily.timeLeft = Math.max(0, daily.limit - (Date.now() - daily.qStartTs) / 1000);
    updateDailyClock();
    if (daily.timeLeft <= 0) {
      if (daily._iv) window.clearInterval(daily._iv);
      daily._iv = null;
      void dailyTimeUp();
    }
  };
  tick();
  daily._iv = window.setInterval(tick, 200);
}

function updateDailyClock(): void {
  const f = $('dbTimerFill');
  const c = $('dbClock');
  if (!f || !c) return;
  const pct = Math.max(0, (daily.timeLeft / daily.limit) * 100);
  f.style.width = pct + '%';
  f.classList.toggle('low', pct < 30);
  c.textContent = fmtClock(daily.timeLeft);
  c.classList.toggle('low', pct < 30);
}

/** 推进到下一题（或结算）。qStartTs 必须立刻对齐 —— 服务端在收到本题提交的当下就让下一题起跳。 */
function advanceDaily(ok: boolean): void {
  daily.qStartTs = Date.now();
  if (daily.idx >= daily.total - 1) window.setTimeout(finishDaily, ok ? 650 : 1500);
  else
    window.setTimeout(
      () => {
        daily.idx++;
        dealDailyPuzzle();
      },
      ok ? 800 : 1700,
    );
}

async function dailySolve(): Promise<void> {
  if (daily._iv) {
    window.clearInterval(daily._iv);
    daily._iv = null;
  }
  // 用户可能在 await 服务端结果期间切到其它模式；如已切走，不写 resultEl、不推进题
  if (!daily.active) return;
  const q = daily.idx;
  const localT = Math.max(0, daily.limit - daily.timeLeft);
  // 先本地记账（离线兜底用），随后用服务端权威用时覆盖
  daily.times[q] = localT;
  daily.submits[q] = { solved: true, solution: formula, time: localT };
  daily.solved++;
  formulaEl.classList.add('success');
  resultEl.className = 'result ok';

  let elapsed = localT;
  if (daily.canSubmit) {
    const r = await submitDailyAnswer(q, normalize24(formula));
    if (r && typeof r.elapsed === 'number') {
      elapsed = r.elapsed;
      daily.times[q] = r.elapsed;
      const prev = daily.submits[q];
      if (prev) prev.time = r.elapsed;
    }
    if (r && r.timeout) {
      // 服务端判超时（本地倒计时略快 / 网络延迟）→ 以服务端为准，本题按失败收尾
      daily.times[q] = null;
      daily.solved = Math.max(0, daily.solved - 1);
      daily.submits[q] = { solved: false, solution: null, time: daily.limit };
      resultEl.className = 'result bad';
      resultEl.textContent = '⏰ 服务器判定超时';
      advanceDaily(false);
      return;
    }
  }
  resultEl.textContent = `🎉 Solved in ${elapsed.toFixed(1)}s!`;
  combo++;
  saveCombo();
  refreshTop();
  advanceDaily(true);
}

async function dailyTimeUp(): Promise<void> {
  if (daily._iv) {
    window.clearInterval(daily._iv);
    daily._iv = null;
  }
  // 计时器回调可能在用户切走模式后才触发；daily.active 已是 false 时不写 DOM、不推进题
  if (!daily.active) return;
  const q = daily.idx;
  daily.times[q] = null;
  daily.submits[q] = { solved: false, solution: null, time: daily.limit };
  resultEl.className = 'result bad';
  resultEl.textContent = '⏰ Time up — unsolved';
  const ans = solve(numbers.map((n) => ({ value: n, expr: String(n) })));
  if (ans) {
    let p = ans[1];
    if (p.startsWith('(') && p.endsWith(')')) p = p.slice(1, -1);
    toast('Answer: ' + p.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−'));
  }
  // 必须主动告知服务端本题超时（空公式 → 服务端判 timedOut 记满窗并推进），否则对局卡死在本题
  if (daily.canSubmit) await submitDailyAnswer(q, '');
  advanceDaily(false);
}

function finishDaily(): void {
  daily.active = false;
  if (daily._iv) {
    window.clearInterval(daily._iv);
    daily._iv = null;
  }
  $('diffPick')!.style.display = '';
  $('hintBtn')!.style.display = '';
  $('answerBtn')!.style.display = '';
  $('newBtn')!.classList.remove('hidden');
  $('modeBanner')!.innerHTML = '';

  // 总用时：完成题取实际秒数，未完成题计满分惩罚（保证"全完成"才最快）
  const totalTime = daily.times.reduce<number>((a, t) => a + (t == null ? daily.limit : t), 0);
  const solvedTimes = daily.times.filter((x): x is number => x != null);
  const avg = solvedTimes.length ? solvedTimes.reduce<number>((a, b) => a + b, 0) / solvedTimes.length : 0;
  const best = solvedTimes.length ? Math.min(...solvedTimes) : 0;
  const success = daily.solved === daily.total;

  // 供「模式选择页」展示我今天的最好成绩（本机，仅用于入门页的"You"行）
  try {
    localStorage.setItem(
      'twentyfour_daily_last',
      JSON.stringify({ dateKey: daily.dateKey, solved: daily.solved, total: daily.total, totalTime }),
    );
  } catch {
    /* localStorage 不可用时忽略 */
  }

  if (!dailyCompletedToday()) {
    dailyComplete();
    combo++;
    saveCombo();
    refreshTop();
    toast(`✓ Daily complete — streak ${combo}`);
  }
  openShareOverlay(
    {
      daily: true,
      key: daily.key,
      session: daily.session,
      solved: daily.solved,
      total: daily.total,
      totalTime,
      avg,
      best,
      success,
    },
    combo,
  );
  setMode('practice');
}

interface DailyAnswerResp {
  ok?: boolean;
  correct?: boolean;
  already?: boolean;
  timeout?: boolean;
  q?: number;
  elapsed?: number;
  done?: boolean;
  total?: number | null;
  rank?: { position: number; count: number; total: number | null } | null;
  times?: (number | null)[];
  leftSec?: number;
  error?: string;
}

/** 逐题提交（服务端权威校验 + 计时）。超时用空公式提交 —— 服务端会记满窗并推进下一题。 */
async function submitDailyAnswer(q: number, f: string): Promise<DailyAnswerResp | null> {
  try {
    const res = await fetch('/api/daily24/answer', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ d: daily.dateKey, q, formula: f }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DailyAnswerResp;
  } catch {
    return null;
  }
}

interface DailyRankRow {
  rank?: number;
  nickname?: string;
  avatar?: string | null;
  total?: number;
  times?: (number | null)[];
}

/* 每日挑战完成速度徽章（金 ≤30s / 银 ≤60s / 铜 ≤120s，超出无）—— 与 PvP Elo 段位严格区分 */
const dailySpeedBadge = (total: unknown): string => {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return '';
  if (t <= 30) return '<span class="rr-badge gold" title="Speedrun Gold · ≤30s">🥇</span>';
  if (t <= 60) return '<span class="rr-badge silver" title="Speedrun Silver · ≤60s">🥈</span>';
  if (t <= 120) return '<span class="rr-badge bronze" title="Speedrun Bronze · ≤120s">🥉</span>';
  return '';
};

const dailyRow = (rankLabel: string, name: string, score: string, extraCls = '', avatarGlyph = '🐱', badgeHtml = ''): string =>
  `<div class="race-row ${extraCls}">` +
  `<span class="rr-avatar md-av">${avatarGlyph}</span>` +
  `<span class="rr-rank">${rankLabel}</span>` +
  `<span class="rr-name">${escapeHtml(name)}</span>` +
  `<span class="rr-time">${score}${badgeHtml}</span></div>`;

const dailyScoreText = (times: unknown, total: unknown): string => {
  const solved = Array.isArray(times) ? times.filter((x) => x != null).length : 0;
  return `${solved}/${DAILY_N} · ${Number(total ?? 0).toFixed(1)}s`;
};

async function loadDailyBoard(): Promise<void> {
  const el = $('dailyBoard');
  if (!el) return;
  if (!daily.canSubmit) {
    el.innerHTML = '<div class="race-empty">🌐 离线模式 — 未接入全球榜</div>';
    return;
  }
  try {
    const res = await fetch(`/api/daily24/leaderboard?d=${daily.dateKey}`, { credentials: 'include' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const top: DailyRankRow[] = Array.isArray(data.top) ? data.top : [];
    if (!top.length) {
      el.innerHTML = '<div class="race-empty">还没有人完成今天的挑战，抢首杀！</div>';
      return;
    }
    let html = top
      .slice(0, 20)
      .map((e, i) =>
        dailyRow(
          String(e.rank ?? i + 1),
          e.nickname || 'Player',
          dailyScoreText(e.times, e.total),
          i === 0 ? 'r1' : '',
          avatarIcon(e.avatar),
          dailySpeedBadge(e.total),
        ),
      )
      .join('');
    const me = data.me as DailyRankRow | null;
    if (me && me.rank)
      html += dailyRow(String(me.rank), '你', dailyScoreText(me.times, me.total), 'me', avatarIcon(profile.avatar), dailySpeedBadge(me.total));
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<div class="race-empty">🌐 全球榜加载失败</div>';
  }
}

/* ===================== 限时练习（每题 60s · 超时自动换题 · 记录个人最快） ===================== */
const TIMED_LIMIT = 60;
const timed = {
  active: false,
  limit: TIMED_LIMIT,
  timeLeft: TIMED_LIMIT,
  solved: 0,
  best: 0,
  _iv: null as number | null,
};

function startTimed(): void {
  timed.active = true;
  mode = 'timed';
  timed.timeLeft = timed.limit;
  timed.solved = 0;
  timed.best = 0;

  $('diffPick')!.style.display = '';
  $('hintBtn')!.style.display = '';
  $('answerBtn')!.style.display = 'none';
  $('newBtn')!.classList.remove('hidden');
  $('enterBtn')!.classList.add('hidden');

  renderTimedBanner();
  deal();
  startTimedTimer();
  renderSide();
}

function renderTimedBanner(): void {
  $('modeBanner')!.innerHTML =
    '<div class="banner daily timed">' +
    '<div class="daily-top"><div class="daily-meta">' +
    `<div class="b-title">⏱ Timed Practice · ${timed.limit}s per deal</div>` +
    '<div class="b-sub">Solved <b id="tmSolved">' +
    timed.solved +
    '</b> · Best <b id="tmBest">' +
    (timed.best ? timed.best.toFixed(1) + 's' : '—') +
    '</b> · unsolved deals just move on</div>' +
    '</div></div>' +
    '<div class="db-timer"><div class="db-timer-fill" id="dbTimerFill"></div></div>' +
    `<div class="db-clock" id="dbClock">${fmtClock(timed.timeLeft)}</div>`;
}

function startTimedTimer(): void {
  if (timed._iv) window.clearInterval(timed._iv);
  timed.timeLeft = timed.limit;
  updateTimedClock();
  timed._iv = window.setInterval(() => {
    if (!timed.active) return;
    timed.timeLeft--;
    updateTimedClock();
    if (timed.timeLeft <= 0) {
      if (timed._iv) window.clearInterval(timed._iv);
      timed._iv = null;
      timedTimeUp();
    }
  }, 1000);
}

function updateTimedClock(): void {
  const f = $('dbTimerFill');
  const c = $('dbClock');
  if (!f || !c) return;
  const pct = Math.max(0, (timed.timeLeft / timed.limit) * 100);
  f.style.width = pct + '%';
  f.classList.toggle('low', pct < 30);
  c.textContent = fmtClock(timed.timeLeft);
  c.classList.toggle('low', pct < 30);
}

function stopTimedTimer(): void {
  if (timed._iv) {
    window.clearInterval(timed._iv);
    timed._iv = null;
  }
}

/** 解出当前题：记时 → 刷新最快 → 1500ms 后自动换题（足够读完"X.Xs"，且不拖慢速度党） */
function timedSolve(): void {
  const t = Math.max(0, timed.limit - timed.timeLeft);
  stopTimedTimer();
  timed.solved++;
  if (!timed.best || t < timed.best) timed.best = t;
  resultEl.className = 'result ok';
  // 用 toFixed(1) 保留 1 位小数让 "5.3s" 更有成就感
  resultEl.textContent = `🎉 Solved in ${t.toFixed(1)}s · best ${timed.best.toFixed(1)}s — next…`;
  renderSide();
  window.setTimeout(() => {
    if (!timed.active) return;
    renderTimedBanner();
    deal();
    startTimedTimer();
  }, 1500);
}

/** 本题超时：揭晓答案 → 1700ms 后自动换题（让玩家看清答案 + 表情反馈） */
function timedTimeUp(): void {
  resultEl.className = 'result bad';
  resultEl.textContent = '⏰ Time up — answer revealed, next…';
  scores.skipped++;
  saveScores();
  refreshTop();
  renderSide();
  const ans = solve(numbers.map((n) => ({ value: n, expr: String(n) })));
  if (ans) {
    let p = ans[1];
    if (p.startsWith('(') && p.endsWith(')')) p = p.slice(1, -1);
    toast('Answer: ' + p.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−'));
  }
  window.setTimeout(() => {
    if (!timed.active) return;
    renderTimedBanner();
    deal();
    startTimedTimer();
  }, 1700);
}

/* ===================== 账号档案（头像 / 段位 / Elo / 金币） =====================
   服务端头像是 emoji id（FREE_AVATARS: a-dog → 🐶），映射同步自
   worker/src/sites/mathduel/stores/account.js；未知 id 兜底 🎭。
   ⚠️ 金币走会员体系（需 auth_sid 注册会话），匿名 md_uuid 拿不到 ⇒ 未登录时不渲染，不是 bug。 */
const AVATAR_ICON: Record<string, string> = {
  'a-cat': '🐱', 'a-dog': '🐶', 'a-frog': '🐸', 'a-owl': '🦉',
  'a-tiger': '🐯', 'a-bear': '🐻', 'a-penguin': '🐧', 'a-unicorn': '🦄',
  'a-robot': '🤖', 'a-ghost': '👻', 'a-turtle': '🐢', 'a-rabbit': '🐰',
  'a-fox': '🦊', 'a-panda': '🐼', 'a-lion': '🦁', 'a-octo': '🐙',
};
const avatarIcon = (id?: string | null): string => (id && AVATAR_ICON[id]) || '🎭';

/* 段位表同步自 worker/src/shared/elo.js TIERS —— 仅用于把 elo 换算成本地展示用段位名。
   真实结算与升降段判定一律以服务端 game_over.elo[].tier / tierChange 为准。 */
const TIERS = [
  { name: 'Bronze', emoji: '🥉', min: 0 },
  { name: 'Silver', emoji: '🥈', min: 1200 },
  { name: 'Gold', emoji: '🥇', min: 1400 },
  { name: 'Platinum', emoji: '💠', min: 1600 },
  { name: 'Diamond', emoji: '💎', min: 1800 },
  { name: 'Master', emoji: '👑', min: 2000 },
];
const tierOf = (elo: number) => [...TIERS].reverse().find((t) => elo >= t.min) || TIERS[0];
const tierEmoji = (n?: string | null): string => TIERS.find((t) => t.name === n)?.emoji || '';
const tierClass = (n?: string | null): string => (n ? ' t-' + n.toLowerCase().replace(/[^a-z]/g, '') : '');

const profile = {
  avatar: null as string | null,
  nickname: null as string | null,
  elo: null as number | null,
  tier: null as string | null,
  coins: null as number | null,
  loaded: false,
};

/** 玩家状态条：头像 + 昵称 + Elo + 段位（设计稿 Screen 1 顶栏元素） */
function pstatHtml(o: { avatar?: string | null; name?: string | null; elo?: number | null; tier?: string | null }): string {
  const elo = o.elo != null ? `<span class="elo">${o.elo}</span>` : '';
  const tier = o.tier ? `<span class="tier">${tierEmoji(o.tier)}${escapeHtml(o.tier)}</span>` : '';
  return (
    `<span class="pstat${tierClass(o.tier)}"><span class="md-av">${avatarIcon(o.avatar)}</span>` +
    `<span>${escapeHtml(o.name || 'You')}</span>${elo}${tier}</span>`
  );
}

function renderProfileChips(): void {
  document.querySelectorAll<HTMLElement>('[data-profile]').forEach((el) => {
    el.innerHTML = pstatHtml({ avatar: profile.avatar, name: profile.nickname || 'You', elo: profile.elo, tier: profile.tier });
  });
  // 大厅房间视图的身份条（档案异步返回后补渲染一次）
  const lm = $('lobbyMe');
  if (lm && comp.myName) {
    lm.innerHTML = pstatHtml({ avatar: profile.avatar, name: comp.myName, elo: profile.elo, tier: profile.tier });
  }
  document.querySelectorAll<HTMLElement>('[data-coins]').forEach((el) => {
    if (profile.coins == null) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `◆ <span>${profile.coins}</span>`;
  });
}

async function loadProfile(): Promise<void> {
  try {
    // 无 cookie 时服务端自动建号并下发签名 md_uuid（与每日挑战共用同一身份）
    const res = await fetch('/api/account/me', { credentials: 'include' });
    if (res.ok) {
      const d: any = await res.json();
      profile.avatar = d?.avatar || d?.account?.active?.avatar || profile.avatar;
      profile.nickname = d?.nickname || profile.nickname;
      const r = d?.account?.ratings?.['24'] || d?.account?.ratings?.['24-game'];
      if (r && typeof r.elo === 'number') {
        profile.elo = r.elo;
        profile.tier = tierOf(r.elo).name;
      }
      profile.loaded = true;
      renderProfileChips();
    }
  } catch {
    /* 离线：不渲染身份条，不影响游戏 */
  }
  try {
    const r2 = await fetch('/api/coins/me', { credentials: 'include' });
    if (r2.ok) {
      const c: any = await r2.json();
      if (c && c.authenticated && typeof c.coins === 'number') {
        profile.coins = c.coins;
        renderProfileChips();
      }
    }
  } catch {
    /* 未登录 / 网络失败：金币 chip 保持隐藏 */
  }
}

/* ===================== 对局内聊天（服务端 case 'chat'） =====================
   契约：发 {type:'chat',text}；收 {type:'chat',name,text,ts}。
   服务端 broadcast 不排除发送者 ⇒ 自己那条也会收到，无需本地回声。 */
const CHAT_EMOJI = ['😂', '🔥', '😡', '👍', '💡', '🎯', '😱', '🏆'];
let chatMsgs: ChatMsg[] = [];

function chatBubble(m: ChatMsg): string {
  return (
    `<div class="chat-bub ${m.self ? 'me' : 'opp'}">` +
    `<span class="who">${escapeHtml(m.self ? 'You' : m.name)}</span>${escapeHtml(m.text)}</div>`
  );
}

function renderChatLog(): void {
  document.querySelectorAll<HTMLElement>('[data-chat-log]').forEach((el) => {
    el.innerHTML = chatMsgs.map(chatBubble).join('');
    el.scrollTop = el.scrollHeight;
  });
}

function pushChat(m: ChatMsg): void {
  chatMsgs.push(m);
  if (chatMsgs.length > 60) chatMsgs = chatMsgs.slice(-60);
  renderChatLog();
}

// 保留 clearChat 以备未来"清空全场聊天"用例；当前 compLeave 不再调用（避免清掉观战条/race-list 状态）
// function clearChat(): void {
//   chatMsgs = [];
//   renderChatLog();
// }

/** 把样式化的聊天条挂到任意容器（arena board 与大厅房间视图各一处） */
function chatDockHtml(scope: string): string {
  return (
    `<div class="chat-dock" data-chat-dock="${scope}">` +
    '<div class="chat-hd"><b>💬 Room chat</b><span>only this room</span></div>' +
    '<div class="chat-log" data-chat-log></div>' +
    `<div class="chat-rail">${CHAT_EMOJI.map((e) => `<button type="button" data-chat-emoji="${e}" aria-label="Send ${e}">${e}</button>`).join('')}</div>` +
    '<div class="chat-input-row">' +
    '<input type="text" maxlength="200" placeholder="Say something…" data-chat-input aria-label="Chat message" />' +
    '<button type="button" class="send" data-chat-send>Send</button>' +
    '</div></div>'
  );
}

function submitChatFrom(input: HTMLInputElement): void {
  const t = input.value.trim();
  if (!t) return;
  comp.sendChat(t);
  input.value = '';
}

/** 事件委托：两处聊天条共用一套绑定，避免重复监听 */
function initChatDelegation(): void {
  document.addEventListener('click', (ev) => {
    const el = ev.target as HTMLElement;
    if (!el) return;
    const emoji = el.closest<HTMLElement>('[data-chat-emoji]');
    if (emoji) {
      comp.sendChat(emoji.dataset.chatEmoji || '');
      return;
    }
    const send = el.closest<HTMLElement>('[data-chat-send]');
    if (send) {
      const row = send.closest<HTMLElement>('.chat-input-row');
      const input = row?.querySelector<HTMLInputElement>('[data-chat-input]');
      if (input) submitChatFrom(input);
    }
  });
  document.addEventListener('keydown', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (!input || !input.matches || !input.matches('[data-chat-input]')) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      submitChatFrom(input);
    }
  });
}

/** 速度环（设计稿 Screen 2）：剩余时间比例 → SVG 环 dashoffset */
const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

/* ===================== 竞赛 ===================== */
const comp = new Competition({
  onRoomReady: () => {
    showRoomView();
  },
  onPlayersChanged: (players, isHost, room) => {
    comp.players = players;
    comp.isHost = isHost;
    if (room) comp.room = room;
    showRoomView();
  },
  onRoundStart: ({ cards, round, maxRounds, timeLimit }) => {
    numbers = cards.slice();
    comp.round = round;
    comp.maxRounds = maxRounds;
    comp.timeLimit = timeLimit;
    compEnterGame();
    closeLobby();
  },
  onProgress: (p) => {
    comp.done = p.doneCount;
    comp.total = p.total;
    renderRaceProgress({ doneCount: p.doneCount, total: p.total, done: p.done });
  },
  onRoundResult: (p) => {
    showRaceRoundResult(p);
  },
  onGameOver: (p) => {
    showRaceGameOver(p);
  },
  onTimer: (left) => updateCompTimer(left),
  onError: (msg) => {
    const e = $('lobbyErr');
    if (e) e.textContent = msg;
    toast(msg);
  },
  onChat: (m) => pushChat(m),
  onSpectator: ({ count }) => renderSpecBar(count),
  onSelfSpectator: () => {
    toast('👀 Spectating — this room is full, you are watching');
    renderSpecBar(comp.spectatorCount);
  },
});

/** 观战条：仅观战者可见（服务端把 duel 第 3+ 人放进 spectator 槽位） */
function renderSpecBar(count: number): void {
  const el = $('specBar');
  if (!el) return;
  el.classList.toggle('hidden', !comp.spectator);
  el.innerHTML = comp.spectator
    ? `👀 <b>Spectating</b> — read-only view${count > 1 ? ` · ${count} watchers` : ''}`
    : '';
}

initChatDelegation();

const lobby = $('lobby')!;
let raceMax = 99;

function openLobby(): void {
  lobby.classList.add('show');
  $('lobbyForm')!.style.display = '';
  $('roomView')!.style.display = 'none';
  $('lobbyErr')!.textContent = '';
  $('joinRow')!.classList.add('hidden');
  const ni = $<HTMLInputElement>('nameInput');
  if (ni) {
    if (comp.myName) ni.value = comp.myName;
    else {
      const s = localStorage.getItem('twentyfour_name');
      if (s) ni.value = s;
    }
  }
}
const closeLobby = () => lobby.classList.remove('show');

/** 邀请链接：打开站点并预填房间码（与「Copy Invite Link」完全同一个 URL） */
function roomInviteUrl(): string {
  return location.origin + location.pathname + '?room=' + encodeURIComponent(comp.room || '');
}

function renderRoomQr(): void {
  const img = $<HTMLImageElement>('roomQr');
  if (!img || !comp.room) return;
  renderQR(img, roomInviteUrl());
}

function showRoomView(): void {
  $('lobbyForm')!.style.display = 'none';
  $('roomView')!.style.display = 'block';
  $('roomCode')!.textContent = comp.room;
  renderRoomQr();
  renderRoomPlayers();
  // 大厅房间视图也挂一条聊天（等待开局时就能闲聊——服务端任何时刻都接受 chat）
  const rp = $('roomPlayers');
  if (rp && !$('lobbyChat')) {
    const box = document.createElement('div');
    box.id = 'lobbyChat';
    box.className = 'chat-dock';
    box.style.marginTop = '14px';
    box.innerHTML = chatDockHtml('lobby');
    rp.insertAdjacentElement('afterend', box);
  }
  renderChatLog();
  const mine = $('lobbyMe');
  if (mine) mine.innerHTML = pstatHtml({ avatar: profile.avatar, name: comp.myName || profile.nickname || 'You' });
}

function renderRoomPlayers(): void {
  const names = Object.keys(comp.players);
  const n = names.length;
  const list = $('roomPlayers');
  if (list) {
    list.innerHTML = names
      .map((name) => {
        const me = name === comp.myName;
        const p = comp.players[name] || ({} as { avatar?: string | null });
        return (
          `<div class="rp-item${me ? ' me' : ''}"><span class="md-av">${avatarIcon(p.avatar)}</span>` +
          `<span>${escapeHtml(name)}</span>` +
          (me ? `<span class="rp-host">You${comp.isHost ? ' · Host' : ''}</span>` : '') +
          '</div>'
        );
      })
      .join('');
  }
  $('roomHint')!.textContent = comp.isHost
    ? `⏳ ${n} joined — share the code, start when ready`
    : `⏳ Joined — waiting for host… (${n} players)`;
  const sb = $<HTMLButtonElement>('startBtn')!;
  sb.disabled = !(comp.isHost && n >= 2);
  sb.textContent = n < 2 ? '🚀 Start Competition (2+ players)' : '🚀 Start Competition';
}

function escapeHtml(s: unknown): string {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function renderRaceProgress(d: { doneCount?: number; total?: number; done?: RaceEntry[] }): void {
  const dn = $('raceDone');
  const tt = $('raceTotal');
  if (dn) dn.textContent = String(d.doneCount ?? comp.done ?? 0);
  if (tt) tt.textContent = String(d.total ?? comp.total ?? 0);
  const list = $('raceList');
  if (!list) return;
  const useDone = !!(d.done && d.done.length);
  const rows = useDone ? d.done! : [];
  if (!rows.length) {
    list.innerHTML = '<div class="race-empty">No submissions yet — be first!</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < rows.length && i < 10; i++) {
    const r = rows[i] || ({} as RaceEntry);
    const cls = (i === 0 ? 'r1' : '') + (r.name === comp.myName ? ' me' : '');
    html +=
      `<div class="race-row ${cls}"><span class="rr-rank">${i + 1}</span>` +
      `<span class="rr-name">${escapeHtml(r.name || '')}</span>` +
      `<span class="rr-time">${useDone ? (r.time != null ? fmtTime(r.time) : '✓') : ''}</span></div>`;
  }
  if (rows.length > 10) html += `<div class="race-more">+${rows.length - 10} more players…</div>`;
  list.innerHTML = html;
  list.scrollTop = 0;
}

function fmtTime(ms: number): string {
  const s = (Number(ms) || 0) / 1000;
  return s >= 60 ? Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60).toFixed(1) : s.toFixed(1) + 's';
}

function showRaceRoundResult(d: { round: number; ranking: RaceEntry[] }): void {
  const rk = d.ranking || [];
  let html = `<h2 class="win-c" style="font-size:20px">🏁 Round ${d.round} Result</h2>`;
  html += '<div class="final-list" style="max-height:34vh">';
  for (let i = 0; i < rk.length && i < 8; i++) {
    const r = rk[i] || ({} as RaceEntry);
    html +=
      `<div class="final-row${r.name === comp.myName ? ' me' : ''}${i < 1 ? ' r1' : ''}">` +
      `<span class="fr-rank">#${i + 1}</span><span class="fr-name">${escapeHtml(r.name || '')}</span>` +
      `<span class="fr-score">${r.ok ? fmtTime(r.time || 0) : '—'}</span></div>`;
  }
  html += '</div><p class="sub">Next round starting…</p>';
  const m = $('modal');
  if (m) m.innerHTML = html;
  $('overlay')?.classList.add('show');
  window.setTimeout(() => {
    if (comp.active) $('overlay')?.classList.remove('show');
  }, 2200);
}

/** Elo 结算块（设计稿 result badge）：服务端 game_over.elo 产出，平局/无 uuid 时可能为空 */
function eloBlockHtml(elo?: EloEntry[]): string {
  if (!elo || !elo.length) return '';
  const mine = elo.find((e) => e.name === comp.myName);
  const rows = elo
    .slice(0, 10)
    .map((e) => {
      const isMe = e.name === comp.myName;
      const cls = e.delta > 0 ? 'up' : e.delta < 0 ? 'down' : 'flat';
      const dtxt = (e.delta > 0 ? '+' : '') + e.delta;
      const avg = typeof e.elo === 'number' ? Math.round(e.elo - e.delta) : null;
      const eloTxt = avg != null ? `<span class="v">${avg} → ${e.elo}</span>` : `<span class="v">${e.elo}</span>`;
      return (
        `<div class="elo-row${isMe ? ' me' : ''}"><span class="md-av">${avatarIcon(e.avatar)}</span>` +
        `<span class="n">${escapeHtml(e.nickname || e.name)}</span>${eloTxt}` +
        `<span class="d ${cls}">${dtxt}</span></div>`
      );
    })
    .join('');
  let flash = '';
  if (mine) {
    const tc = mine.tierChange;
    let fromName = tc ? tc.from : null;
    let toName = tc ? tc.to : null;
    let promoted = tc ? !!tc.promoted : false;
    /* ⚠️ 服务端 duel(1v1) 路径有个顺序缺陷：applyUpdate() 先原地改写 ratings[i].elo，
       随后才 tierChange(ratings[i].elo, newElo) ⇒ 旧值==新值 ⇒ from/to 恒相同，
       升降段横幅在 1v1 永远不触发（>2 人竞赛路径先存了 oldElo，所以那条正常）。
       这里用 elo-delta 自行还原旧分兜底，让 1v1 也能正确播横幅。 */
    const oldElo = typeof mine.elo === 'number' && typeof mine.delta === 'number' ? mine.elo - mine.delta : null;
    if (oldElo != null && (!fromName || fromName === toName)) {
      const f = tierOf(oldElo).name;
      const t = tierOf(mine.elo).name;
      if (f !== t) {
        fromName = f;
        toName = t;
        promoted = TIERS.findIndex((x) => x.name === t) > TIERS.findIndex((x) => x.name === f);
      }
    }
    if (fromName && toName && fromName !== toName) {
      flash =
        `<div class="tier-flash${promoted ? '' : ' demoted'}">${promoted ? '🎉 Promoted to' : '⬇ Demoted to'} ` +
        `${tierEmoji(toName)} ${escapeHtml(toName)}</div>`;
    }
  }
  return `<p class="sub" style="margin:12px 0 6px">⚔️ Elo — rated match</p><div class="elo-grid">${rows}</div>${flash}`;
}

function showRaceGameOver(d: { ranking: RaceEntry[]; elo?: EloEntry[] }): void {
  comp.active = false;
  if (interval) {
    window.clearInterval(interval);
    interval = null;
  }
  const rk = d.ranking || [];
  let me: RaceEntry | null = null;
  for (const r of rk) if (r.name === comp.myName) me = r;
  const heading = me
    ? me.rank === 1
      ? '🏆 You won the competition!'
      : `🏁 You ranked #${me.rank}`
    : '🏁 Competition Over';
  let html = `<h2 class="${me && me.rank === 1 ? 'win-c' : me ? 'draw-c' : 'lose-c'}">${heading}</h2>`;
  html += `<p class="sub">${rk.length} players · cap ${comp.displayCap}</p>`;
  html += eloBlockHtml(d.elo);
  html += '<div class="final-list">';
  for (let i = 0; i < rk.length; i++) {
    const r = rk[i] || ({} as RaceEntry);
    const rank = r.rank || i + 1;
    html +=
      `<div class="final-row${r.name === comp.myName ? ' me' : ''}${i < 1 ? ' r1' : ''}">` +
      `<span class="fr-rank">#${rank}</span><span class="fr-name">${escapeHtml(r.name || '')}</span>` +
      `<span class="fr-score">${r.solved != null ? r.solved + ' solved' : ''}${r.ok ? ' · ' + fmtTime(r.time || 0) : ''}</span></div>`;
  }
  html +=
    '</div><div class="row"><button class="btn primary" id="goAgain">🔁 Play Again</button>' +
    '<button class="btn ghost" id="goShare">🔗 Share Results</button>' +
    '<button class="btn ghost" id="goHome">Back</button></div>';
  const m = $('modal');
  if (m) m.innerHTML = html;
  $('overlay')?.classList.add('show');
  $('goAgain')!.onclick = () => {
    $('overlay')?.classList.remove('show');
    openLobby();
  };
  $('goHome')!.onclick = () => {
    $('overlay')?.classList.remove('show');
    setMode('practice');
  };
  $('goShare')!.onclick = () => {
    openShareOverlay(
      {
        competition: true,
        key: 'Competition',
        session: genSession(),
        solved: me ? me.solved || 0 : 0,
        total: rk.length,
        rank: me ? me.rank : 0,
      },
      combo,
    );
  };
}

let raceStartTs = 0;

function compEnterGame(): void {
  comp.active = true;
  mode = 'battle';
  tabEls.forEach((t) => t.classList.toggle('active', t.dataset.mode === 'battle'));
  document.body.setAttribute('data-mode', 'battle');
  $('compHead')!.classList.remove('hidden');
  $('compCode')!.textContent = comp.room;
  $('diffPick')!.style.display = 'none';
  $('hintBtn')!.style.display = 'none';
  $('answerBtn')!.style.display = 'none';
  $('newBtn')!.classList.add('hidden');
  $('enterBtn')!.classList.add('hidden');
  // 观战者：服务端不接受其提交，前端一并锁住输入（CSS 层 pointer-events 兜底）
  document.body.classList.toggle('spectate', comp.spectator);
  renderSpecBar(comp.spectatorCount);
  const dock = $('chatDock');
  if (dock) {
    if (!dock.dataset.filled) {
      dock.innerHTML = chatDockHtml('arena');
      dock.dataset.filled = '1';
    }
    dock.classList.remove('hidden');
  }
  renderChatLog();
  $('modeBanner')!.innerHTML =
    `<div class="banner battle"><div><div class="b-title">🏆 Round ${comp.round} / ${comp.maxRounds}</div>` +
    '<div class="b-sub">Same cards · race to 24</div></div></div>';
  resultEl.textContent = `⚔️ Round ${comp.round} — make 24 first!`;
  resultEl.className = 'result';
  // 新一轮：清空上一轮的公式与选牌状态（竞赛不走 deal()，需手动重置）
  formula = '';
  historyStack = [];
  usedCardIndices.clear();
  raceStartTs = Date.now();
  comp.myTime = 0;
  timer = 0;
  if (interval) window.clearInterval(interval);
  interval = window.setInterval(() => {
    if (!comp.active) return;
    timer++;
    updateCompTimer(comp.timeLimit - Math.min(timer, comp.timeLimit));
  }, 1000);
  dealingAnim = true; // 竞赛每轮开局也播一次发牌动画
  render();
  renderSide();
}

function updateCompTimer(left: number): void {
  const secs = Math.max(0, Math.ceil(left));
  const frac = comp.timeLimit > 0 ? Math.max(0, Math.min(1, left / comp.timeLimit)) : 0;
  // 速度环（设计稿 Screen 2）：剩余时间比例 → SVG dashoffset
  const ringFill = $('speedRingFill');
  if (ringFill) ringFill.setAttribute('stroke-dashoffset', String(RING_C * (1 - frac)));
  const ring = $('speedRing');
  if (ring) ring.classList.toggle('low', frac < 0.3);
  const rt = $('speedRingTxt');
  if (rt) rt.textContent = secs + 's';
  // 细进度条（窄屏降级用，速度环是主视觉）
  const bar = $('compTimer');
  if (bar) {
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = Math.max(0, frac * 100) + '%';
    bar.classList.toggle('low', frac < 0.3);
  }
  const st = $('compStatus');
  if (st) st.textContent = comp.spectator ? '👀 Spectating this round' : `Round timer ${secs}s`;
}

function compLeave(silent: boolean): void {
  comp.leave(silent);
  // 不再主动清 chatDock / specBar：comp.active=false 后 renderSpecBar() 与
  // 下一局 compEnterGame() 会接管（chatDock 在新对局由 chatDockHtml() 重新填充，
  // specBar 在非 spectator 时自动 hidden）。这样观战条的状态切换由统一的 active 标志
  // 控制，race-list 由 renderSide() 在 setMode 时刷新——不再被清场误伤。
  document.body.classList.remove('spectate');
  $('chatDock')?.classList.add('hidden');
  $('specBar')?.classList.add('hidden');
  $('lobbyChat')?.remove();
  // silent=true 是 setMode 内部的清理路径（避免与玩家主动退房争抢
  // race-list 等 DOM）；silent=false 玩家主动退房 → 回到 practice
  if (!silent) setMode('practice');
  closeLobby();
}

comp.setDifficulty(difficulty);

/* 身份档案（头像 / 段位 / Elo）：与每日挑战共用同一 md_uuid 身份，无 cookie 时服务端自动建号 */
void loadProfile();

/* ===================== 侧栏 ===================== */
function statRow(k: string, v: string | number): string {
  return `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`;
}

function renderSide(): void {
  if (!sideEl) return;
  if (mode === 'battle' && comp.active) {
    sideEl.innerHTML =
      '<div class="panel"><h3>🏆 Live Leaderboard</h3>' +
      '<div class="race-hd"><span class="rh-title">Live Standings</span>' +
      `<span class="rh-count"><b id="raceDone">${comp.done}</b> / <b id="raceTotal">${comp.total}</b> solved</span></div>` +
      (comp.spectatorCount > 0 ? `<div class="race-empty">👀 ${comp.spectatorCount} watching</div>` : '') +
      '<div class="race-list" id="raceList"><div class="race-empty">No submissions yet — be first!</div></div></div>' +
      '<div class="panel"><h3>🎮 How to Play</h3>' +
      '<div class="hint-step"><b>1</b><span>Create or join a room, share the code with friends</span></div>' +
      '<div class="hint-step"><b>2</b><span>Same cards for everyone — race to make 24 first</span></div>' +
      '<div class="hint-step"><b>3</b><span>Ranked by solve time each round; accumulate over rounds</span></div></div>';
  } else if (mode === 'daily') {
    const myStats =
      '<div class="panel"><h3>📈 My Stats</h3>' +
      statRow('Solved', scores.solved) +
      statRow('Skipped', scores.skipped) +
      statRow('Streak', combo) +
      '<div class="hint-step" style="margin-top:10px"><b>·</b><span>Same puzzle worldwide — race the clock</span></div></div>';
    if (!daily.started) {
      sideEl.innerHTML =
        '<div class="panel"><h3>📅 每日挑战规则</h3>' +
        '<div class="hint-step"><b>1</b><span>每天同一套 5 题，全球同题</span></div>' +
        '<div class="hint-step"><b>2</b><span>难度递增：Easy → Medium → Hard</span></div>' +
        '<div class="hint-step"><b>3</b><span>每题限时 60 秒，超时自动揭晓答案</span></div>' +
        '<div class="hint-step"><b>4</b><span>5 题全在限时内解出 = 挑战成功</span></div>' +
        '<div class="hint-step"><b>5</b><span>服务端权威计时 · 排名按总用时</span></div></div>' +
        myStats;
    } else {
      sideEl.innerHTML =
        '<div class="panel"><h3>🏆 Today’s Global Board</h3>' +
        '<div class="race-hint">🥇 ≤30s · 🥈 ≤60s · 🥉 ≤120s</div>' +
        '<div class="race-list" id="dailyBoard"><div class="race-empty">加载中…</div></div></div>' +
        myStats;
      void loadDailyBoard();
    }
  } else if (mode === 'timed') {
    sideEl.innerHTML =
      '<div class="panel"><h3>⏱ Timed Practice</h3>' +
      '<div class="hint-step"><b>1</b><span>60 seconds per deal — solve it before the clock runs out</span></div>' +
      '<div class="hint-step"><b>2</b><span>Solved? The next deal starts straight away</span></div>' +
      '<div class="hint-step"><b>3</b><span>Time up reveals the answer, then deals again</span></div></div>' +
      '<div class="panel"><h3>📈 This Session</h3>' +
      statRow('Solved', timed.solved) +
      statRow('Best', timed.best ? timed.best.toFixed(1) + 's' : '—') +
      statRow('Skipped', scores.skipped) +
      statRow('Streak', combo) +
      '</div>';
  } else {
    sideEl.innerHTML =
      '<div class="panel"><h3>🎯 Quick Start</h3>' +
      '<div class="hint-step"><b>1</b><span><b>Deal</b>: 4 cards, values 1–13</span></div>' +
      '<div class="hint-step"><b>2</b><span><b>Make 24</b>: use + − × ÷ and ( ), each card once</span></div>' +
      '<div class="hint-step"><b>3</b><span><b>Score</b>: faster and correct = longer streak</span></div></div>' +
      '<div class="panel"><h3>📈 My Stats</h3>' +
      statRow('Solved', scores.solved) +
      statRow('Skipped', scores.skipped) +
      statRow('Streak', combo) +
      '</div>';
  }
}

/* ===================== 模式切换 ===================== */
const tabsEl = $('tabs');
const tabEls = tabsEl ? ([...tabsEl.querySelectorAll('.tab')] as HTMLElement[]) : [];
tabEls.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode!)));

function setMode(m: string): void {
  mode = m;
  document.body.setAttribute('data-mode', m);
  tabEls.forEach((t) => t.classList.toggle('active', t.dataset.mode === m));

  if (daily.active) {
    daily.active = false;
    if (daily._iv) window.clearInterval(daily._iv);
    daily._iv = null;
  }
  if (timed.active) {
    timed.active = false;
    stopTimedTimer();
  }
  $('compHead')!.classList.add('hidden');
  $('enterBtn')!.classList.add('hidden');
  $('diffPick')!.style.display = '';
  $('hintBtn')!.style.display = '';
  $('answerBtn')!.style.display = '';
  $('newBtn')!.classList.remove('hidden');
  $('modeBanner')!.innerHTML = '';
  // Practice 模式：本局用时可见；其它模式隐藏
  $('pracTimerWrap')!.hidden = m !== 'practice';

  if (comp.active) compLeave(true);

  if (m === 'practice') {
    deal();
  } else if (m === 'daily') {
    startDaily();
  } else if (m === 'timed') {
    startTimed();
  } else if (m === 'battle') {
    openLobby();
  }
  renderSide();
}

/* ===================== 事件绑定 ===================== */
cardsEl.addEventListener('click', (e) => {
  if (document.body.classList.contains('answer-revealed')) return;
  const c = (e.target as HTMLElement).closest<HTMLElement>('.card');
  if (!c || (comp.active && comp.waiting)) return;
  const i = +(c.dataset.i || 0);
  if (usedCardIndices.has(i)) return;
  flashLast(i);
  appendNumber(String(numbers[i]));
});
cardsEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (c) {
      e.preventDefault();
      if (document.body.classList.contains('answer-revealed')) return;
      const i = +(c.dataset.i || 0);
      if (!usedCardIndices.has(i)) {
        flashLast(i);
        appendNumber(String(numbers[i]));
      }
    }
  }
});

$('pad')!.addEventListener('click', (e) => {
  if (document.body.classList.contains('answer-revealed')) return;
  const b = (e.target as HTMLElement).closest<HTMLElement>('.op-btn');
  if (!b) return;
  if (b.dataset.act === 'undo') return undo();
  if (b.dataset.act === 'clear') return clearFormula();
  if (comp.active && comp.waiting) return;
  const v = b.dataset.v || '';
  if (v === '(') return appendOpenParen();
  if (v === ')') return appendCloseParen();
  if ('+-*/'.includes(v)) return appendOp(v);
  append(v);
});

/** 标记"刚点击的牌"高亮：600ms 后自动清除 */
function flashLast(i: number): void {
  lastClickIndex = i;
  if (lastClickTimeout != null) window.clearTimeout(lastClickTimeout);
  lastClickTimeout = window.setTimeout(() => {
    lastClickIndex = -1;
    lastClickTimeout = null;
    render();
  }, 600);
  render();
}

$('newBtn')!.onclick = () => {
  if (comp.active) return;
  deal();
};
$('hintBtn')!.onclick = giveHint;
$('answerBtn')!.onclick = () => {
  if (daily.active && daily.started) {
    void dailyTimeUp();
    return;
  }
  if (daily.active) return; // 开始前忽略
  showAnswer();
};
$('enterBtn')!.onclick = openLobby;
$('lobbyClose')!.onclick = closeLobby;
$('joinToggle')!.onclick = () => {
  $('joinRow')!.classList.toggle('hidden');
  $<HTMLInputElement>('joinInput')?.focus();
};
$('sizeRow')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.size-chip');
  if (!b) return;
  raceMax = parseInt(b.dataset.max || '99', 10) || 99;
  comp.setRoomSize(raceMax);
  [...$('sizeRow')!.children].forEach((c) => c.classList.toggle('on', c === b));
});
$('createBtn')!.onclick = () => {
  const name = ($<HTMLInputElement>('nameInput')?.value || '').trim();
  if (!name) {
    $('lobbyErr')!.textContent = 'Enter a name';
    return;
  }
  comp.myName = name;
  localStorage.setItem('twentyfour_name', name);
  comp.setRoomSize(raceMax);
  comp.setDifficulty(difficulty);
  $('lobbyErr')!.textContent = '';
  comp.createRoom(name);
};
$('joinBtn')!.onclick = () => {
  const name = ($<HTMLInputElement>('nameInput')?.value || '').trim();
  const code = ($<HTMLInputElement>('joinInput')?.value || '').trim().toUpperCase();
  if (!name) {
    $('lobbyErr')!.textContent = 'Enter a name';
    return;
  }
  if (!/^[A-Z0-9]{4,6}$/.test(code)) {
    $('lobbyErr')!.textContent = 'Invalid code (4–6 chars)';
    return;
  }
  comp.myName = name;
  localStorage.setItem('twentyfour_name', name);
  comp.setDifficulty(difficulty);
  $('lobbyErr')!.textContent = '';
  comp.joinRoom(code, name);
};
$('shareBtn')!.onclick = async () => {
  const url = roomInviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  } catch {
    toast(url);
  }
};
$('copyCode')!.onclick = async () => {
  try {
    await navigator.clipboard.writeText(comp.room);
    toast('Room code copied: ' + comp.room);
  } catch {
    toast(comp.room);
  }
};
$('leaveBtn')!.onclick = () => compLeave(false);
$('startBtn')!.onclick = () => comp.startRace();

document.querySelectorAll('#diffPick button').forEach((b) => {
  (b as HTMLElement).onclick = () => {
    if (comp.active) return;
    difficulty = (b as HTMLElement).dataset.d as Difficulty;
    localStorage.setItem('24_diff', difficulty);
    comp.setDifficulty(difficulty);
    deal();
  };
});

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (document.body.classList.contains('answer-revealed')) return;
  if (comp.active && comp.waiting) return;
  if (e.key >= '1' && e.key <= '4') {
    const i = +e.key - 1;
    if (i < numbers.length && !usedCardIndices.has(i)) {
      flashLast(i);
      appendNumber(String(numbers[i]));
    }
  } else if (e.key === '+') appendOp('+');
  else if (e.key === '-') appendOp('-');
  else if (e.key === '*') appendOp('*');
  else if (e.key === '/') appendOp('/');
  else if (e.key === '(') appendOpenParen();
  else if (e.key === ')') appendCloseParen();
  else if (e.key === 'Backspace') {
    e.preventDefault();
    undo();
  } else if (e.key === 'c' || e.key === 'C') clearFormula();
});

initShareBindings();

/* ===================== 初始化 ===================== */
loadScores();
loadCombo();
refreshTop();

(function init(): void {
  const params = new URLSearchParams(location.search);
  const rc = (params.get('room') || '').trim().toUpperCase();
  const startMode = params.get('mode');
  // 每日挑战题数与时长由服务端固定（5 × 60s），不再接受 ?count= / ?time= 覆盖

  // 模式选择页深链：?size=2（好友房）/ ?size=99（竞速）
  const size = parseInt(params.get('size') || '', 10);
  if ([2, 10, 25, 50, 99].includes(size)) {
    raceMax = size;
    comp.setRoomSize(size);
    const row = $('sizeRow');
    if (row) {
      [...row.children].forEach((ch) =>
        ch.classList.toggle('on', (ch as HTMLElement).dataset.max === String(size)),
      );
    }
  }

  deal();
  renderSide();

  if (startMode === 'daily') window.setTimeout(() => setMode('daily'), 0);
  else if (startMode === 'timed') window.setTimeout(() => setMode('timed'), 0);
  else if (startMode === 'battle') window.setTimeout(() => setMode('battle'), 0);

  if (rc) {
    window.setTimeout(() => {
      setMode('battle');
      const ji = $<HTMLInputElement>('joinInput');
      if (ji) ji.value = rc;
      $('joinRow')?.classList.remove('hidden');
    }, 0);
  }

  // 生产环境暴露竞赛入口（DEMO 也允许体验完整 99 人流程）
  $('enterBtn')?.classList.remove('hidden');
  if (!isProdEnv()) {
    const badge = $('modeBadge');
    if (badge) badge.style.display = 'inline-flex';
  }
})();
