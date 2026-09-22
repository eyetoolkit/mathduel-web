/**
 * 24 点游戏 · UI 编排
 * 保留原实现全部行为（练习 / 每日挑战 5题·60s / 多人竞赛 99 人 / 分享），
 * 仅重组为模块化结构：engine（纯函数） + competition（联机） + share（分享） + 本文件（DOM 与状态机）。
 */

import '@tri-sites/design-system/styles';
import '../24-game/styles.css';
import './arena.css';
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
import { Competition, isProdEnv, type RaceEntry } from './competition';
import { initShareBindings, openShareOverlay, renderQR } from './share';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader($('header')!, {
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
const saveScores = () => localStorage.setItem('twentyfour_scores', JSON.stringify(scores));
const loadCombo = () => (combo = parseInt(localStorage.getItem('twentyfour_combo') || '0', 10) || 0);
const saveCombo = () => localStorage.setItem('twentyfour_combo', String(combo));
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
  timer = 0;
  if (interval) window.clearInterval(interval);
  interval = window.setInterval(() => {
    if (comp.active) return;
    timer++;
  }, 1000);
  render();
  resultEl.className = 'result';
  resultEl.textContent = 'Use each card once — make 24';
}

const prettyFormula = (f: string) => f.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/-/g, ' − ');

function render(): void {
  cardsEl.innerHTML = numbers
    .map((n, i) => {
      const used = usedCardIndices.has(i);
      const red = i === 1 || i === 3;
      return (
        `<div class="card ${used ? 'used' : ''} ${red ? 'red' : ''} ${used ? '' : 'dealing'}" data-i="${i}" ` +
        `role="button" tabindex="0" aria-label="card ${n}" style="animation-delay:${i * 70}ms">` +
        `<div class="suit">${SUITS[i]}</div>` +
        `<div class="num">${n}</div>` +
        `<div class="suit br">${SUITS[i]}</div></div>`
      );
    })
    .join('');

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
  if (!isCompleteExpr(f)) return;
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
    dailySolve();
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
  const e = ans[1];
  const m = e.match(/\(?([^()]+)\)?/);
  const part = m ? m[1] : e;
  toast('Try: ' + part.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−'));
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
}

/* ===================== 每日挑战（规则 v2：5 题难度梯度 · 每题 60s · 点开始才揭牌 · 排名按完成数→总用时） ===================== */
const DAILY_COUNTS = [5, 10, 15];
const DAILY_TIMES = [60, 90, 120];
// 难度梯度（5 题递进：暖身 → 冲刺）；题数 >5 时循环复用
const DAILY_DIFFS: Difficulty[] = ['easy', 'standard', 'standard', 'hard', 'hard'];
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
  canSubmit: false,
  total: 5,
  idx: 0,
  limit: 60,
  timeLeft: 60,
  solved: 0,
  times: [] as (number | null)[],
  puzzles: [] as { idx: number; diff: Difficulty; cards: number[] }[],
  submits: [] as ({ solved: boolean; solution: string | null; time: number } | null)[],
  curDiff: 'standard' as Difficulty,
  key: '',
  dateKey: '',
  session: '',
  startTs: 0,
  _iv: null as number | null,
};

const loadDailyCount = () => {
  const v = parseInt(localStorage.getItem('twentyfour_daily_count') || '', 10);
  return DAILY_COUNTS.includes(v) ? v : 5;
};
const loadDailyTime = () => {
  const v = parseInt(localStorage.getItem('twentyfour_daily_time') || '', 10);
  return DAILY_TIMES.includes(v) ? v : 60;
};
const saveDailyCount = (c: number) => localStorage.setItem('twentyfour_daily_count', String(c));
const saveDailyTime = (t: number) => localStorage.setItem('twentyfour_daily_time', String(t));
const genSession = () => Math.random().toString(36).slice(2, 10);
const fmtClock = (s: number) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m + ':' + (ss < 10 ? '0' : '') + ss;
};

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
  localStorage.setItem('twentyfour_daily', JSON.stringify(o));
}

async function startDaily(): Promise<void> {
  daily.active = true;
  mode = 'daily';
  daily.total = loadDailyCount();
  daily.limit = loadDailyTime();
  daily.idx = 0;
  daily.solved = 0;
  daily.times = [];
  daily.submits = [];
  daily.session = genSession();
  daily.key = dailyKeyStr();
  daily.dateKey = shanghaiDateKey();
  dailySeedVal = seedFromDateKey(daily.dateKey);
  daily.started = false;
  daily.canSubmit = false;

  $('diffPick')!.style.display = 'none';
  $('hintBtn')!.style.display = 'none';
  $('answerBtn')!.style.display = '';
  $('enterBtn')!.classList.add('hidden');
  $('newBtn')!.classList.add('hidden');

  await loadDailyPuzzles();
  renderDailyPreStart();
  renderSide();
}

async function loadDailyPuzzles(): Promise<void> {
  // 优先从后端取今日 5 题（全球同题 + 可上榜）；失败则客户端确定性兜底（不参与全球榜）
  try {
    const res = await fetch(`/api/daily/24-game/challenge?d=${daily.dateKey}`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.puzzles) && data.puzzles.length === daily.total) {
        daily.puzzles = data.puzzles.map((p: any) => ({ idx: p.idx, diff: p.diff, cards: p.cards }));
        daily.canSubmit = true;
        return;
      }
    }
  } catch {
    /* 离线兜底 */
  }
  daily.puzzles = [];
  for (let i = 0; i < daily.total; i++) {
    const diff = diffForIndex(i);
    const rng = SeededRandom(dailySeedVal + i * 7919 + 1);
    let cards = generate24Puzzle(rng, diff);
    let guard = 0;
    while (!solve(cards.map((n) => ({ value: n, expr: String(n) }))) && guard++ < 80) cards = generate24Puzzle(rng, diff);
    daily.puzzles.push({ idx: i, diff, cards });
  }
  daily.canSubmit = false;
}

function renderDailyPreStart(): void {
  const diffChips = daily.puzzles
    .map((p) => `<span class="diff-chip d-${p.diff}">${diffLabel(p.diff)}</span>`)
    .join('');
  $('modeBanner')!.innerHTML =
    '<div class="banner daily">' +
    '<div class="daily-top"><div class="daily-meta">' +
    `<div class="b-title">📅 Daily Challenge ${daily.key}</div>` +
    '<div class="b-sub">5 道不同难度 · 全球同题 · 每题 60 秒</div>' +
    '</div></div>' +
    '<div class="db-diffs">' + diffChips + '</div>' +
    '<button class="btn primary db-start" id="dbStart">🂠 开始挑战</button>' +
    '<p class="db-hint">点击开始后将同时揭牌并启动计时；5 题全部在限时内解出即「挑战成功」</p>' +
    '</div>';
  cardsEl.innerHTML = daily.puzzles.map(() => '<div class="cb"><span class="cb-q">?</span></div>').join('');
  resultEl.className = 'result';
  resultEl.textContent = '准备开始每日挑战';
  const sb = $('dbStart');
  if (sb) sb.onclick = beginDaily;
}

function beginDaily(): void {
  if (!daily.active || daily.started) return;
  daily.started = true;
  daily.startTs = Date.now();
  renderSide();
  dealDailyPuzzle();
}

function renderDailyBanner(): void {
  const html =
    '<div class="banner daily">' +
    '<div class="daily-top"><div class="daily-meta">' +
    `<div class="b-title">📅 Daily Challenge ${daily.key}</div>` +
    `<div class="b-sub">Puzzle <b id="dbIdx">${daily.idx + 1}</b> / ${daily.total} · <b>${diffLabel(daily.curDiff)}</b> · Global same puzzle</div>` +
    '</div></div>' +
    '<div class="db-set">' +
    '<div class="db-set-row"><span class="db-lbl">Count</span><div class="seg" id="dbCount">' +
    DAILY_COUNTS.map((c) => `<button data-c="${c}"${c === daily.total ? ' class="on"' : ''}>${c}</button>`).join('') +
    '</div></div>' +
    '<div class="db-set-row"><span class="db-lbl">Time</span><div class="seg" id="dbTime">' +
    DAILY_TIMES.map((t) => `<button data-t="${t}"${t === daily.limit ? ' class="on"' : ''}>${t}s</button>`).join('') +
    '</div></div>' +
    '</div>' +
    '<div class="db-timer"><div class="db-timer-fill" id="dbTimerFill"></div></div>' +
    `<div class="db-clock" id="dbClock">${fmtClock(daily.timeLeft)}</div>`;
  $('modeBanner')!.innerHTML = html;
  $('dbCount')!.querySelectorAll('button').forEach((b) => {
    (b as HTMLElement).onclick = () => {
      saveDailyCount(+(b as HTMLElement).dataset.c!);
      startDaily();
    };
  });
  $('dbTime')!.querySelectorAll('button').forEach((b) => {
    (b as HTMLElement).onclick = () => {
      saveDailyTime(+(b as HTMLElement).dataset.t!);
      startDaily();
    };
  });
}

function dealDailyPuzzle(): void {
  const p = daily.puzzles[daily.idx];
  if (!p) return;
  daily.curDiff = p.diff;
  renderDailyBanner();
  deal(p.cards);
  startDailyTimer();
}

function startDailyTimer(): void {
  if (daily._iv) window.clearInterval(daily._iv);
  daily.timeLeft = daily.limit;
  updateDailyClock();
  daily._iv = window.setInterval(() => {
    if (!daily.active) return;
    daily.timeLeft--;
    updateDailyClock();
    if (daily.timeLeft <= 0) {
      if (daily._iv) window.clearInterval(daily._iv);
      daily._iv = null;
      dailyTimeUp();
    }
  }, 1000);
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

function dailySolve(): void {
  const t = daily.limit - daily.timeLeft;
  daily.times[daily.idx] = t;
  daily.submits[daily.idx] = { solved: true, solution: formula, time: t };
  daily.solved++;
  resultEl.className = 'result ok';
  resultEl.textContent = `🎉 Solved in ${t.toFixed(0)}s!`;
  if (daily._iv) {
    window.clearInterval(daily._iv);
    daily._iv = null;
  }
  combo++;
  saveCombo();
  refreshTop();
  formulaEl.classList.add('success');
  if (daily.idx >= daily.total - 1) window.setTimeout(finishDaily, 650);
  else
    window.setTimeout(() => {
      daily.idx++;
      dealDailyPuzzle();
    }, 800);
}

function dailyTimeUp(): void {
  daily.times[daily.idx] = null;
  daily.submits[daily.idx] = { solved: false, solution: null, time: daily.limit };
  resultEl.className = 'result bad';
  resultEl.textContent = '⏰ Time up — unsolved';
  const ans = solve(numbers.map((n) => ({ value: n, expr: String(n) })));
  if (ans) {
    let p = ans[1];
    if (p.startsWith('(') && p.endsWith(')')) p = p.slice(1, -1);
    toast('Answer: ' + p.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−'));
  }
  if (daily.idx >= daily.total - 1) window.setTimeout(finishDaily, 1500);
  else
    window.setTimeout(() => {
      daily.idx++;
      dealDailyPuzzle();
    }, 1700);
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
  if (daily.canSubmit) void submitDailyChallenge();
  setMode('practice');
}

async function submitDailyChallenge(): Promise<void> {
  const results = daily.submits.map((s, i) => ({
    idx: i,
    solved: !!(s && s.solved),
    solution: s && s.solution ? s.solution : null,
    time: s ? s.time : daily.limit,
  }));
  try {
    await fetch('/api/daily/24-game/challenge', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateKey: daily.dateKey, limit: daily.limit, results }),
    });
  } catch {
    /* 提交失败不影响本地体验 */
  }
}

async function loadDailyBoard(): Promise<void> {
  const el = $('dailyBoard');
  if (!el) return;
  if (!daily.canSubmit) {
    el.innerHTML = '<div class="race-empty">🌐 全球榜需要联网</div>';
    return;
  }
  try {
    const res = await fetch(`/api/daily/24-game/challenge/rank?d=${daily.dateKey}&limit=20`, { credentials: 'include' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const entries = data.entries || [];
    if (!entries.length) {
      el.innerHTML = '<div class="race-empty">还没有人完成今天的挑战，抢首杀！</div>';
      return;
    }
    el.innerHTML = entries
      .slice(0, 20)
      .map(
        (e: any, i: number) =>
          `<div class="race-row ${i === 0 ? 'r1' : ''}">` +
          `<span class="rr-rank">${i + 1}</span>` +
          `<span class="rr-name">${escapeHtml(e.name || '玩家')}</span>` +
          `<span class="rr-time">${e.solved}/${daily.total} · ${(e.totalTime ?? 0).toFixed(1)}s</span></div>`,
      )
      .join('');
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

/** 解出当前题：记时 → 刷新最快 → 0.7s 后自动换题 */
function timedSolve(): void {
  const t = Math.max(0, timed.limit - timed.timeLeft);
  stopTimedTimer();
  timed.solved++;
  if (!timed.best || t < timed.best) timed.best = t;
  resultEl.className = 'result ok';
  resultEl.textContent = `🎉 Solved in ${t.toFixed(1)}s — next deal…`;
  renderSide();
  window.setTimeout(() => {
    if (!timed.active) return;
    renderTimedBanner();
    deal();
    startTimedTimer();
  }, 700);
}

/** 本题超时：揭晓答案 → 1.3s 后自动换题（不中断整轮） */
function timedTimeUp(): void {
  resultEl.className = 'result bad';
  resultEl.textContent = '⏰ Time up — next deal…';
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
  }, 1300);
}

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
});

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
}

function renderRoomPlayers(): void {
  const names = Object.keys(comp.players);
  const n = names.length;
  const list = $('roomPlayers');
  if (list) {
    list.innerHTML = names
      .map((name) => {
        const me = name === comp.myName;
        return (
          `<div class="rp-item${me ? ' me' : ''}"><span class="rp-dot"></span><span>${escapeHtml(name)}</span>` +
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

function showRaceGameOver(d: { ranking: RaceEntry[] }): void {
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
  render();
  renderSide();
}

function updateCompTimer(left: number): void {
  const bar = $('compTimer');
  if (!bar) return;
  const fill = bar.firstElementChild as HTMLElement | null;
  const pct = Math.max(0, (left / comp.timeLimit) * 100);
  if (fill) fill.style.width = pct + '%';
  bar.classList.toggle('low', pct < 30);
  const st = $('compStatus');
  if (st) st.textContent = `Round timer ${Math.max(0, Math.ceil(left))}s`;
}

function compLeave(silent: boolean): void {
  comp.leave(silent);
  if (!silent) setMode('practice');
  closeLobby();
}

comp.setDifficulty(difficulty);

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
        '<div class="hint-step"><b>1</b><span>每天同一套 5 题，全球玩家同题</span></div>' +
        '<div class="hint-step"><b>2</b><span>难度递增：Easy → Medium → Hard</span></div>' +
        '<div class="hint-step"><b>3</b><span>每题限时 60 秒，超时自动揭晓答案</span></div>' +
        '<div class="hint-step"><b>4</b><span>5 题全在限时内解出 = 挑战成功</span></div>' +
        '<div class="hint-step"><b>5</b><span>排名按 完成题数 → 总用时</span></div></div>' +
        myStats;
    } else {
      sideEl.innerHTML =
        '<div class="panel"><h3>🏆 Today’s Global Board</h3>' +
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
  const c = (e.target as HTMLElement).closest<HTMLElement>('.card');
  if (!c || (comp.active && comp.waiting)) return;
  const i = +(c.dataset.i || 0);
  if (usedCardIndices.has(i)) return;
  append(String(numbers[i]));
});
cardsEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (c) {
      e.preventDefault();
      const i = +(c.dataset.i || 0);
      if (!usedCardIndices.has(i)) append(String(numbers[i]));
    }
  }
});

$('pad')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.op-btn');
  if (!b) return;
  if (b.dataset.act === 'undo') return undo();
  if (b.dataset.act === 'clear') return clearFormula();
  if (comp.active && comp.waiting) return;
  append(b.dataset.v!);
});

$('newBtn')!.onclick = () => {
  if (comp.active) return;
  deal();
};
$('hintBtn')!.onclick = giveHint;
$('answerBtn')!.onclick = () => {
  if (daily.active && daily.started) { dailyTimeUp(); return; }
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
  if (comp.active && comp.waiting) return;
  if (e.key >= '1' && e.key <= '4') {
    const i = +e.key - 1;
    if (i < numbers.length && !usedCardIndices.has(i)) append(String(numbers[i]));
  } else if (e.key === '+') append('+');
  else if (e.key === '-') append('-');
  else if (e.key === '*') append('*');
  else if (e.key === '/') append('/');
  else if (e.key === '(') append('(');
  else if (e.key === ')') append(')');
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
  // 首页每日挑战横幅可带 count / time 直达
  const c = parseInt(params.get('count') || '', 10);
  const t = parseInt(params.get('time') || '', 10);
  if (DAILY_COUNTS.includes(c)) saveDailyCount(c);
  if (DAILY_TIMES.includes(t)) saveDailyTime(t);

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
