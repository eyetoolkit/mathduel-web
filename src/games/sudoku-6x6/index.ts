/* === 通用竞赛外壳（1v1+多人+随机匹配） === */
import { mountCompetition } from "../_shared/mp-client";
import { recordDaily } from '../cross-game';
import { createSudokuAdapter } from "../_shared/mp-adapters/sudoku";
/**
 * 6×6 数独 · UI 编排（beta 版：全部本地，无 API 依赖）
 * 模式：solo（3 难度）/ daily（seeded 每日一题）/ timed（45s 连解）
 * 🔴 2026-10-27 用户拍板：Duel Bot（本地机器人对战）已整体删除（scheduleBot/finishDuel/
 *    bot 聊天/owner 分格/速度环等）。对战需求由 ?mode=battle 在线竞赛（mp-client）承接。
 * 视觉：24 ARENA 同款 token（body.arena remap），ember=你、teal=冲突、paper=固定线索
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
import '../24-game/styles.css';
import '../24-game/arena.css';
import './s6.css';
import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import {
  candidates,
  colOf,
  dailyPuzzle,
  findConflicts,
  generatePuzzle,
  boxOf,
  rowOf,
  shanghaiDateKey,
  mulberry32,
  type Difficulty,
  type Grid,
  type Puzzle,
} from './engine';
import { playSfx } from '../../shared/sfx';
import { bindLeaveCard, enterMatchMode, exitMatchToLobby } from '../_shared/match-guard';
import { bindSoundButton, keepAudioAlive } from '../_shared/match-sound';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

import { i18nT, escHtml, onI18nChange } from '../_shared/i18n-t';
initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'NumeriDuel',
  brandSub: 'Sudoku 6×6',
  brandSubKey: 'math_home.g_s6',
  mark: '▦',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/#games' },
    ],
});

type Mode = 'solo' | 'daily' | 'timed';

const TIMED_LIMIT = 45;
// 🔴 修复 (2026-10-28 审计 P1)：6×6 原本既无此常量也无失败结算，st.mistakes 只是
// 一个没有后果的装饰数字；9×9 / 4×4 都是「累计 3 次错误即负」。补齐以对齐口径。
const MAX_MISTAKES = 3;

// 🔴 难度名走字典：原来硬编码英文，切 de/es/fr 时最佳成绩面板与每日横幅会漏英文
const diffLabel = (d: Difficulty): string => i18nT(`difficulty.${d}`);

/* ─── 状态 ─── */
const st = {
  view: 'lobby' as 'lobby' | 'play',
  mode: 'solo' as Mode,
  diff: 'standard' as Difficulty,
  puzzle: null as Puzzle | null,
  grid: new Array(36).fill(0) as Grid, // 当前值
  filledBy: new Array(36).fill(0) as number[], // 1 玩家填（撤销恢复用）
  sel: -1,
  running: false,
  startTs: 0,
  elapsed: 0,
  timer: null as number | null,
  // timed
  timedSolved: 0,
  timedDealt: 0, // 本轮共发过几盘（solved 与 dealt 之差 = unsolved）
  timedStreak: 0,
  timedStartTs: 0,
  // solo/timed 错误计数
  mistakes: 0,
  // pencil marks (notes mode)
  marks: Array.from({ length: 36 }, () => new Set<number>()),
  notes: false,
  undoStack: [] as UndoEntry[],
};

let conflictCache: Set<number> = new Set();
/** 「选格」初始文案跟踪（P2-5）：resetBoard 写入，renderMatchChrome 判定是否重写 */
let pickFirstText = '';

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

/* ═══ 模式选择页（独立 MPA 入口，与 24 点 lobby 同构）═══ */
const LOBBY_URL = '/games/sudoku-6x6/lobby/';
const goLobby = (): void => {
  location.href = LOBBY_URL;
};

/* ═══ 退出守卫 + 沉浸态（24-game 第 1/4/6 轮范式 · 2026-10-03 接入）═══ */
const MATCH_GUARD_OPTS = { leaveCardId: 's6-leavecard', lobbyUrl: LOBBY_URL };
bindLeaveCard(MATCH_GUARD_OPTS);
bindSoundButton('s6-sound');
keepAudioAlive();

function enterMode(m: Mode): void {
  stopAll();
  st.view = 'play';
  st.mode = m;
  document.querySelectorAll<HTMLButtonElement>('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  $('diffPick')!.style.display = m === 'daily' ? 'none' : '';
  $('padTools')!.classList.toggle('hidden', m === 'daily');
  $('hintBtn')!.style.display = '';
  startRound();
  // 进对局统一入口
  enterMatchMode(MATCH_GUARD_OPTS);
  playSfx('start');
}

function stopAll(): void {
  if (st.timer) window.clearInterval(st.timer);
  st.timer = null;
  st.running = false;
}

/* ═══ 开局 ═══ */
/* 🔴 横幅必须独立成函数：enterMode() 发生在 dict 异步就绪之前，
   直接把 i18nT() 的结果写进 DOM 会把裸 key 固化下来（RULES-FE-D.md #88/#133 同类）。
   ⚠️ timed 的「已解/连对」由 tick() 每秒写入 #tmSolved/#tmStreak，
      标签与数值必须分开成节点，不能把整句拍平成字符串。 */
function renderModeBanner(): void {
  const m = st.mode;
  const wrap = (inner: string, cls = 'banner daily'): void => {
    banner(`<div class="${cls}"><div class="daily-top"><div class="daily-meta">${inner}</div></div></div>`);
  };
  if (m === 'daily') {
    wrap(
      `<div class="b-title">🌐 ${escHtml(i18nT('ml.mt_s6_daily'))} #${escHtml(shanghaiDateKey())}</div>`
      + `<div class="b-sub">${escHtml(i18nT('mg.sd_banner_daily_world'))}</div>`,
    );
    return;
  }
  if (m === 'timed') {
    wrap(
      `<div class="b-title">${escHtml(i18nT('mg.sd_banner_timed', { limit: TIMED_LIMIT }))}</div>`
      + `<div class="b-sub">${escHtml(i18nT('mg.pyr_lbl_solved'))} <b id="tmSolved">${st.timedSolved}</b> · `
      + `${escHtml(i18nT('mg.pyr_lbl_streak'))} <b id="tmStreak">${st.timedStreak}</b> · `
      +       `${escHtml(i18nT('mg.sd_mistakes_end', { max: MAX_MISTAKES }))}</div>`,
      'banner daily timed',
    );
    return;
  }
  wrap(
    `<div class="b-title">${escHtml(i18nT('mg.sd_banner_solo_diff', { diff: diffLabel(st.diff) }))}</div>`
    + `<div class="b-sub">${escHtml(i18nT('mg.sd_banner_solo_sub'))}</div>`,
  );
}

function startRound(): void {
  stopAll();
  st.undoStack.length = 0;
  if (st.mode === 'timed') {
    st.timedStartTs = Date.now();
    st.timedDealt = 1; // 首盘已发出
  }
  if (st.mode === 'daily') {
    st.puzzle = dailyPuzzle(shanghaiDateKey());
  } else {
    st.puzzle = newRoundPuzzle();
  }
  renderModeBanner();
  resetBoard();
  renderBoard();
  renderSide();
  beginTimer();
}

/* 🔴 字典就绪前 startRound() 已经把裸 key 写进 #modeBanner 了，这里补一次重画。 */
onI18nChange(() => {
  renderModeBanner();
  renderSide();
  renderMatchChrome();
});

let roundNonce = 0;
function newRoundPuzzle(): Puzzle {
  // 轻量熵：时间 XOR 递增计数，避免「New Grid」连点重复
  roundNonce = (roundNonce + 1) | 0;
  return generatePuzzle(st.diff, mulberry32((Date.now() ^ (roundNonce * 0x9e3779b9)) >>> 0));
}

function resetBoard(keepClock = false): void {
  const p = st.puzzle!;
  st.grid = p.puzzle.slice();
  st.filledBy = new Array(36).fill(0);
  st.marks = Array.from({ length: 36 }, () => new Set<number>());
  st.notes = false;
  $('notesBtn')?.classList.remove('on');
  st.sel = -1;
  // 错误计数必须无条件复位：限时连盘走 resetBoard(true)，
  // 若跟着 keepClock 一起跳过，errors 会跨盘累加（4x4/9x9 早已放在 if 外面）。
  st.mistakes = 0;
  if (!keepClock) {
    st.elapsed = 0;
    st.startTs = Date.now();
  }
  st.running = true;
  conflictCache = findConflicts(st.grid);
  pickFirstText = i18nT('mg.sg_pick_first');
  $('result')!.textContent = pickFirstText;
}

/* 对局 chrome 的字典文案集中在此：字典就绪前 startRound() 会写入裸 key，
   由 onI18nChange 整块重画（9×9 同款修复，2026-10-16）。
   🔴 P2-5（2026-10-27 审计）：仅在 result 还空、还是裸 key、或仍显示「选格」初始文案时才重写 ——
   字典就绪晚于玩家操作 / 切语言时，不得把 hint 输出、落子提示冲回初始文案。 */
function renderMatchChrome(): void {
  const cur = $('result')!.textContent ?? '';
  if (cur && !/^(mg|ml)\./.test(cur) && cur !== pickFirstText) return;
  pickFirstText = i18nT('mg.sg_pick_first');
  $('result')!.textContent = pickFirstText;
}

/* ═══ 计时 ═══ */
function beginTimer(): void {
  if (st.timer) window.clearInterval(st.timer);
  st.timer = window.setInterval(tick, 100);
  tick();
}

function effElapsed(): number {
  return (Date.now() - st.startTs) / 1000;
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
  else if (st.grid[i]) cls.push('entry');
  if (st.sel === i) cls.push('sel');
  if (conflictCache.has(i)) cls.push('conflict');
  if (!st.grid[i] && st.marks[i].size) cls.push('marks');
  if (st.sel >= 0 && st.grid[st.sel]) {
    if (i !== st.sel && (rowOf(i) === rowOf(st.sel) || colOf(i) === colOf(st.sel) || boxOf(i) === boxOf(st.sel))) cls.push('peer');
    if (i !== st.sel && st.grid[i] && st.grid[i] === st.grid[st.sel]) cls.push('same');
  }
  return cls.join(' ');
}

function renderBoard(): void {
  const el = $('s6board')!;
  if (!el.dataset.built) {
    let html = '';
    for (let r = 0; r < 6; r++) {
      html += `<div class="s6-row" role="row" aria-rowindex="${r + 1}">`;
      for (let c = 0; c < 6; c++) {
        const i = r * 6 + c;
        html += `<div class="c6cell" data-i="${i}" role="gridcell" tabindex="-1" aria-colindex="${c + 1}"></div>`;
      }
      html += `</div>`;
    }
    el.innerHTML = html;
    el.dataset.built = '1';
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (t) selectCell(Number(t.dataset.i));
    });
    // 首次构建棋盘后注入 SVG 网格线覆盖层（粗 2×3 宫 + 细线），并监听尺寸/DPR 变化
    buildGridLines(el);
  }
  conflictCache = findConflicts(st.grid);
  el.querySelectorAll<HTMLElement>('.c6cell').forEach((c) => {
    const i = Number(c.dataset.i);
    const cls = cellClass(i);
    if (c.className !== cls) c.className = cls;
    let html: string;
    if (st.grid[i]) {
      html = `<span>${st.grid[i]}</span>`;
    } else if (st.marks[i].size) {
      let cells = '';
      for (let n = 1; n <= 6; n++) cells += `<i class="${st.marks[i].has(n) ? 'on' : ''}">${n}</i>`;
      html = `<div class="n6">${cells}</div>`;
    } else {
      html = '';
    }
    if (c.innerHTML !== html) c.innerHTML = html;
    // 读屏可用 —— 数值/空态同步到 aria-label（纯格式，不新增词典键）
    const aria = st.grid[i] ? `R${rowOf(i) + 1}C${colOf(i) + 1}=${st.grid[i]}` : `R${rowOf(i) + 1}C${colOf(i) + 1}`;
    if (c.getAttribute('aria-label') !== aria) c.setAttribute('aria-label', aria);
    if (c.tabIndex !== (i === st.sel ? 0 : -1)) c.tabIndex = i === st.sel ? 0 : -1;
  });
  updateGridStats();
}

/* ════════ 2026-09-26 修复：SVG 网格线覆盖层 ════════
   根因：① 1px border 在小数 DPR 下细线深浅不一/消失；② 暗色主题下细线/粗线同色同宽感
         → 宫结构不可见（用户反馈「棋盘显示异常」）
   方案：JS 按当前 DPR 生成 SVG rect 网格线（shape-rendering: crispEdges 逐线吸附整数设备像素）。
         细线 = 1 物理px，2×3 宫粗线 = 2 物理px 且用更亮的 --sd-grid-line-strong。
         ResizeObserver 监听尺寸变化 + matchMedia('resolution') 监听缩放/DPR 变化 → 重建。 */
function buildGridLines(board: HTMLElement): void {
  const build = (): void => {
    const old = board.querySelector('.grid-lines');
    if (old) old.remove();
    const dpr = window.devicePixelRatio || 1;
    const W = board.clientWidth; // padding-box 宽（含 2px border）
    if (!W) return;
    // 因棋盘 border: 2px，content 区 = W - 4px；用 clientWidth 整体绘制，border 由 cell 自身外侧负责
    const cell = W / 6;
    const thin = 1 / dpr, thick = 2 / dpr;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'grid-lines');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + W);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-hidden', 'true');
    const rect = (x: number, y: number, w: number, h: number, strong: boolean): void => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(w));
      r.setAttribute('height', String(h));
      // 读取棋盘当前主题 token，颜色随主题切换
      const cs = getComputedStyle(board);
      const colorVar = strong ? '--sd-grid-line-strong' : '--sd-grid-line';
      const color = cs.getPropertyValue(colorVar).trim() || (strong ? '#1e1b39' : '#64748b');
      r.style.fill = color;
      svg.appendChild(r);
    };
    for (let i = 1; i <= 5; i++) {
      // 竖线：第 3 列后 = 粗线（0-based col 2 → i=3）
      const vt = i === 3 ? thick : thin;
      rect(i * cell - vt / 2, 0, vt, W, i === 3);
      // 横线：第 2、4 行后 = 粗线（每 2 行一条粗线）
      const ht = i === 2 || i === 4 ? thick : thin;
      rect(0, i * cell - ht / 2, W, ht, i === 2 || i === 4);
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

/* ═══ 侧栏 Grid status 实时刷新 + 数字键盘剩余计数 ═══ */
function updateGridStats(): void {
  const filled = $('statFilled');
  if (filled) filled.textContent = `${st.grid.filter((v) => v).length}/36`;
  // 🔴 修复 (2026-10-28 审计 P1)：生命值点阵（与 9×9 / 4×4 同款）。
  // 原来只把 mistakes 当数字印出来，玩家看不出「还剩几条命」。
  const lives = $('sideLives');
  if (lives) {
    [...lives.children].forEach((dot, k) => {
      dot.className = st.mistakes > k ? 'off' : '';
    });
  }
  updatePad();
}

function updatePad(): void {
  const pad = $('s6pad');
  if (!pad) return;
  pad.querySelectorAll<HTMLButtonElement>('.pk[data-v]').forEach((b) => {
    const v = Number(b.dataset.v);
    const left = 6 - st.grid.filter((x) => x === v).length;
    const badge = b.querySelector('.pk-left');
    if (badge) badge.textContent = left > 0 ? String(left) : '';
    b.classList.toggle('done', left <= 0);
    // 置灰必须真禁用：此前只加 .done 样式，click handler 仍会 place() → 白扣一命
    b.disabled = left <= 0;
  });
}

function selectCell(i: number): void {
  if (!st.running) return;
  if (st.puzzle!.puzzle[i]) {
    st.sel = i; // given 也允许选中做 peer/same 高亮
    renderBoard();
    return;
  }
  st.sel = i;
  renderBoard();
}

/* ═══ 填数 ═══ */
let padNudgeAt = 0;
function nudgePick(): void {
  const now = Date.now();
  if (now - padNudgeAt < 2000) return; // 2s 节流，避免连点刷屏
  padNudgeAt = now;
  toast(i18nT('mg.sg_pick_cell'));
}

/** 落子/冲突的一次性动效（直接挂 class，下一次 renderBoard 自然移除） */
function flashCell(i: number, cls: string, ms: number): void {
  const el = $('s6board')!.querySelector<HTMLElement>(`.c6cell[data-i="${i}"]`);
  if (!el) return;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

/** 从 from 之后（环绕）找下一个可填空格；无则 -1 */
function nextClaimable(from: number): number {
  for (let k = 1; k <= 36; k++) {
    const i = (from + k) % 36;
    if (st.grid[i] || st.puzzle!.puzzle[i]) continue;
    return i;
  }
  return -1;
}

/* ─── Undo：经典数独的高频功能，撤销当前格上一步 ─── */
interface UndoEntry { i: number; grid: number; filledBy: number; marks: number[]; }

function pushUndo(i: number): void {
  st.undoStack.push({ i, grid: st.grid[i], filledBy: st.filledBy[i], marks: [...st.marks[i]] });
  if (st.undoStack.length > 200) st.undoStack.shift(); // 防御性上限
}

function undo(): void {
  if (!st.running) return;
  const e = st.undoStack.pop();
  if (!e) {
    toast(i18nT('mg.sg_nothing_undo'));
    return;
  }
  st.grid[e.i] = e.grid;
  st.filledBy[e.i] = e.filledBy;
  st.marks[e.i] = new Set(e.marks);
  renderBoard();
  checkWin();
}

/* ─── 自动候选：一键为所有空格填入铅笔标记 ─── */
function autoMarks(): void {
  if (!st.running || !st.puzzle) return;
  let n = 0;
  for (let i = 0; i < st.grid.length; i++) {
    if (st.grid[i] || st.puzzle.puzzle[i]) continue;
    pushUndo(i);
    st.marks[i] = new Set(candidates(st.grid, i));
    n++;
  }
  renderBoard();
  toast(n ? i18nT('mg.sd_toast_candidates', { n }) : i18nT('mg.sd_toast_committed'));
}

function place(v: number): void {
  if (!st.running) return;
  if (st.sel < 0) {
    nudgePick();
    return;
  }
  const i = st.sel;
  if (st.puzzle!.puzzle[i]) {
    toast(i18nT('mg.sg_clue_fixed'));
    return;
  }
  // notes 模式：仅 toggle 候选数字（不写入真实数字）
  if (st.notes && !st.grid[i]) {
    pushUndo(i);
    if (st.marks[i].has(v)) st.marks[i].delete(v);
    else st.marks[i].add(v);
    renderBoard();
    return;
  }
  // 🔴 修复 (2026-10-28 审计 P1)：原来只查「与当前盘的冲突」、从不与 solution 比对，
  // 于是「不与当前盘冲突但 ≠ 解」的数字会被永久写在盘上（6×6 是唯一解谜题），
  // 后续必然矛盾，而 checkWin 要求 grid 全等 solution → 玩家填满也不算赢的死局，
  // 且因为不冲突，全程零反馈（不标红、无提示）。9×9/4×4 早已是 solution 比对口径。
  // 现与另两款对齐：先判对错，再按对错分支处理。
  const correct = v === st.puzzle!.solution[i];
  pushUndo(i);
  st.grid[i] = v;
  st.filledBy[i] = 1;
  if (!correct) {
    st.mistakes++;
    st.sel = i;
    renderBoard();
    flashCell(i, 'shake', 400);
    if (st.mistakes >= MAX_MISTAKES) {
      window.setTimeout(() => endMistakes(), 500);
    }
    window.setTimeout(() => {
      if (st.grid[i] === v) {
        st.grid[i] = 0;
        st.filledBy[i] = 0;
        renderBoard();
      }
    }, 650);
    return;
  }
  // 正确落子才清 marks：错值分支不清，避免玩家辛苦记的笔记被一次误触吞掉
  // （9×9 / 4×4 同款；原实现在分支前无条件 clear）。
  st.marks[i].clear();
  const nx = nextClaimable(i);
  st.sel = nx >= 0 ? nx : i; // 填对后自动跳到下一空格，连解提速
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
  // 数字 + marks 全清；notes 模式下清空更彻底（玩家可能 toggle 错）
  pushUndo(i);
  st.grid[i] = 0;
  st.filledBy[i] = 0;
  st.marks[i].clear();
  renderBoard();
}

/* ═══ 胜负 ═══ */
function checkWin(): void {
  if (!st.puzzle) return;
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
      recordDaily('sudoku-6x6', { durationSec: t });
      extra = `<div class="s6-newbest">${escHtml(i18nT('mg.sd_daily_logged'))}</div>`;
    } else {
      extra = `<div class="s6-newbest">${escHtml(i18nT('mg.sd_daily_already'))}</div>`;
    }
  } else {
    const b = readJSON<Record<string, number>>(LS_BEST, {});
    const k = st.diff;
    if (!b[k] || t < b[k]) {
      b[k] = Math.round(t * 10) / 10;
      writeJSON(LS_BEST, b);
      extra = `<div class="s6-newbest">${escHtml(i18nT('mg.sd_newbest'))}</div>`;
    }
  }
  $('result')!.innerHTML = `${i18nT('mg.sd_solved_in_html', { time: escHtml(fmt(t)) })}${extra}`;
  showModal(
    `<div class="s6-verdict">${escHtml(i18nT('mg.sd_verdict_complete'))}</div>` +
      `<div class="s6-scores"><div class="me num">${fmt(t)}<small>${escHtml(i18nT('mg.sd_lbl_your_time'))}</small></div></div>` +
      extra +
      `<div class="s6-acts"><button class="btn primary" id="mAgain">${escHtml(i18nT('mg.shared_new_grid'))}</button>`
      + `<button class="btn ghost" id="mLobby">${escHtml(i18nT('mg.shared_lobby'))}</button></div>`,
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

/* 🔴 修复 (2026-10-28 审计 P1)：三次错负结算。原本 6×6 只有「错数 +1」没有失败出口，
   mistakes 累积到多少都不结束；9×9（endMistakes）与 4×4 同款已有。 */
function endMistakes(): void {
  if (!st.running) return;
  stopAll();
  $('stMain')!.innerHTML = i18nT('mg.sg_too_many_mistakes');
  showModal(
    `<div class="s6-verdict">${escHtml(i18nT('mg.sd_verdict_out_of_lives'))}</div>` +
      `<div class="s6-scores"><div class="op num">${MAX_MISTAKES}<small>${escHtml(i18nT('mg.sd_lbl_mistakes'))}</small></div></div>` +
      `<div class="s6-acts"><button class="btn primary" id="mAgain">${escHtml(i18nT('mg.sd_btn_try_again'))}</button>`
      + `<button class="btn ghost" id="mLobby">${escHtml(i18nT('mg.shared_lobby'))}</button></div>`,
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
    // 45s 整场窗口过后不再续盘
    if (st.mode === 'timed' && (Date.now() - st.timedStartTs) / 1000 < TIMED_LIMIT && st.puzzle) {
      st.puzzle = newRoundPuzzle();
      st.timedDealt++; // 续盘也算发出
      resetBoard(true);
      renderBoard();
      beginTimer(); // checkWin 胜利时清了计时器，续盘需重建
      $('result')!.innerHTML = escHtml(i18nT('mg.sd_timed_next_streak', { n: st.timedSolved, streak: st.timedStreak }));
    }
  }, 1500); // 与 24 点 Timed 对齐：留足时间看清完成盘面
  $('result')!.innerHTML = i18nT('mg.sd_timed_next_incoming_html', {
    n: st.timedSolved,
    time: escHtml(fmt(st.elapsed)),
  });
}

function endTimed(): void {
  stopAll();
  $('stMain')!.innerHTML = i18nT('mg.sg_timeout');
  const unsolved = Math.max(0, st.timedDealt - st.timedSolved); // 发出 − 解出 = 没解完的
  showModal(
    `<div class="s6-verdict">${escHtml(i18nT('mg.sd_verdict_timeup'))}</div>` +
      `<div class="s6-scores"><div class="me num">${st.timedSolved}<small>${escHtml(i18nT('mg.sd_lbl_solved'))}</small></div>` +
      `<div class="op num">${st.timedStreak}<small>${escHtml(i18nT('mg.sd_lbl_best_streak'))}</small></div>` +
      `<div class="op num">${unsolved}<small>${escHtml(i18nT('mg.sd_lbl_unsolved'))}</small></div></div>` +
      `<div class="s6-acts"><button class="btn primary" id="mAgain">${escHtml(i18nT('mg.sd_btn_run_again'))}</button>`
      + `<button class="btn ghost" id="mLobby">${escHtml(i18nT('mg.shared_lobby'))}</button></div>`,
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
      `<div class="panel"><h3>${escHtml(i18nT('mg.sd_panel_best_times'))}</h3>` +
      (['easy', 'standard', 'hard'] as Difficulty[])
        .map((d) => `<div class="stat-row"><span>${escHtml(diffLabel(d))}</span><b>${b[d] ? escHtml(fmt(b[d])) : '—'}</b></div>`)
        .join('') +
      '</div>';
  } else if (st.mode === 'daily') {
    bestRow = `<div class="panel"><h3>${escHtml(i18nT('mg.sd_panel_daily'))}</h3>`
      + `<div class="hint-step"><b>·</b><span>${escHtml(i18nT('mg.sd_daily_note'))}</span></div></div>`;
  }
  el.innerHTML =
    `<div class="panel"><h3>${escHtml(i18nT('mg.sd_panel_grid_status'))}</h3>` +
    `<div class="stat-row"><span>${escHtml(i18nT('mg.sd_lbl_cells_filled'))}</span><b id="statFilled">${filled}/36</b></div>` +
    `<div class="stat-row"><span>${escHtml(i18nT('mg.sd_lbl_mistakes'))}</span><span class="lives" id="sideLives"><i class="${st.mistakes < 1 ? '' : 'off'}"></i><i class="${st.mistakes < 2 ? '' : 'off'}"></i><i class="${st.mistakes < 3 ? '' : 'off'}"></i></span></div>` +
    `<div class="stat-row"><span>${escHtml(i18nT('mg.sd_lbl_empty'))}</span><b>${holes}</b></div>` +
    `<div class="stat-row"><span>${escHtml(i18nT('mg.shared_lbl_difficulty'))}</span><b>${escHtml(st.mode === 'daily' ? i18nT('mg.shared_daily_fixed') : diffLabel(st.diff))}</b></div>` +
    `<div class="hint-step"><b>·</b><span>${escHtml(i18nT('mg.sd_hint_click6'))}</span></div></div>` +
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
    if (st.mode === 'solo') startRound();
  });
});

$('s6pad')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.act === 'undo') undo();
  else if (b.dataset.act === 'erase') erase();
  else if (b.dataset.act === 'notes') toggleNotes();
  else if (b.dataset.v) place(Number(b.dataset.v));
});

/** 切换笔记模式（键盘 N / 笔记按钮共用，对齐 9×9 / 4×4） */
function toggleNotes(): void {
  st.notes = !st.notes;
  $('notesBtn')!.classList.toggle('on', st.notes);
}

/** 方向键在棋盘上移动选格（环绕） */
function moveSel(dr: number, dc: number): void {
  let r = st.sel >= 0 ? rowOf(st.sel) : 0;
  let c = st.sel >= 0 ? colOf(st.sel) : 0;
  for (let step = 0; step < 36; step++) {
    r = (r + dr + 6) % 6;
    c = (c + dc + 6) % 6;
    const i = r * 6 + c;
    st.sel = i;
    renderBoard();
    return;
  }
}

window.addEventListener('keydown', (e) => {
  if (st.view !== 'play') return;
  if (e.key >= '1' && e.key <= '6') place(Number(e.key));
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

$('backLobby')!.addEventListener('click', () => exitMatchToLobby(MATCH_GUARD_OPTS));
$('newBtn')!.addEventListener('click', () => startRound());
$('autoBtn')!.addEventListener('click', autoMarks);
$('hintBtn')!.addEventListener('click', giveHint);
/* ═══ Hint（naked-single 逻辑提示，不直接泄答案位次序）═══ */
/** 当前盘面下 i 格的候选数字（按可见盘面算，冲突格 650ms 内自清所以一般 ≥1） */
function candidatesOf(i: number): number[] {
  const used = new Set<number>();
  for (let j = 0; j < 36; j++) {
    if (j === i || !st.grid[j]) continue;
    if (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i)) used.add(st.grid[j]);
  }
  return [1, 2, 3, 4, 5, 6].filter((v) => !used.has(v));
}

/** 解释「为什么必须是 n」：n 是该行/列/宫唯一缺席的数字 */
function nakedReason(i: number, n: number): string {
  const unitVals = (pred: (j: number) => boolean): Set<number> =>
    new Set(
      [...Array(36).keys()].filter((j) => j !== i && pred(j) && st.grid[j]).map((j) => st.grid[j]),
    );
  const onlyMissing = (s: Set<number>): boolean => {
    for (let v = 1; v <= 6; v++) {
      if (v === n) { if (s.has(v)) return false; }
      else if (!s.has(v)) return false;
    }
    return true;
  };
  if (onlyMissing(unitVals((j) => rowOf(j) === rowOf(i)))) return i18nT('mg.sd_reason_row', { n: rowOf(i) + 1 });
  if (onlyMissing(unitVals((j) => colOf(j) === colOf(i)))) return i18nT('mg.sd_reason_col', { n: colOf(i) + 1 });
  if (onlyMissing(unitVals((j) => boxOf(j) === boxOf(i)))) return i18nT('mg.sd_reason_box2');
  return i18nT('mg.sd_reason_nearby');
}

function giveHint(): void {
  if (!st.running || !st.puzzle) return;
  const empties = [...Array(36).keys()].filter(
    (i) => !st.grid[i] && !st.puzzle!.puzzle[i],
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
    let min = 7;
    for (const i of empties) {
      const c = candidatesOf(i);
      if (c.length && c.length < min) {
        min = c.length;
        best = i;
        cands = c;
      }
    }
  }
  // 诚实护栏（2026-10-28 审计 P2）：候选首值不等于唯一解（玩家错格污染候选，
  // 极少见）时，优先改找一个「单候选且等于解」的真格；找不到则交给下方兜底
  // 直接给解（解恒正确，绝不指向错误数字）。6×6 此前缺此护栏，可能在污染
  // 局面下 hint 出错误数字。4×4 已于 10-27 先行补齐，此处对齐三款。
  if (best >= 0 && cands.length && cands[0] !== st.puzzle.solution[best]) {
    const honest = empties.find((i) => {
      const c = candidatesOf(i);
      return c.length === 1 && c[0] === st.puzzle!.solution[i];
    });
    if (honest !== undefined) {
      best = honest;
      cands = [st.puzzle.solution[best]];
    }
  }
  // 3) 兜底：玩家错格污染候选（极少见）→ 直接给解（解恒正确）
  if (best < 0) {
    best = empties[Math.floor(Math.random() * empties.length)];
    cands = [st.puzzle.solution[best]];
  }
  st.sel = best;
  renderBoard();
  if (cands.length === 1) {
    toast(i18nT('mg.sd_hint_must_be', {
      row: rowOf(best) + 1,
      col: colOf(best) + 1,
      value: cands[0],
      reason: nakedReason(best, cands[0]),
    }));
  } else {
    toast(i18nT('mg.sd_hint_only_fit', {
      row: rowOf(best) + 1,
      col: colOf(best) + 1,
      cands: cands.join(' / '),
    }));
  }
}

$('overlay')!.addEventListener('click', (e) => {
  if (e.target === $('overlay')!) hideModal();
});

/* ═══ init ═══ */
// 深链契约：?mode=solo|daily|timed —— 由模式选择页的模式卡链接进来。
// 不带 mode 直达牌桌时回落到模式选择页，与 24 点「lobby → card table」的两段式保持一致。
const isMode = (m: string): m is Mode => m === 'solo' || m === 'daily' || m === 'timed';
const qs = new URLSearchParams(location.search);
const modeFromUrl = qs.get('mode') || '';

// 🔴 修复 (2026-10-28 审计 P1)：6×6 的 lobby 会把 ?mode=solo&d=hard 写进模式卡 href，
// 但牌桌端从不读 `d` → 从 lobby 选的难度按钮**完全无效**（永远发默认 standard 盘）。
// 9×9 早已支持；照抄同一口径（必须早于 enterMode，否则先发牌再被覆盖）。
const isDiff = (x: string): x is Difficulty => x === 'easy' || x === 'standard' || x === 'hard';
const dFromUrl = qs.get('d') || '';
if (isDiff(dFromUrl)) {
  st.diff = dFromUrl;
  document.querySelectorAll<HTMLButtonElement>('#diffPick button').forEach((b) => {
    b.classList.toggle('active', b.dataset.d === dFromUrl);
  });
}

if (modeFromUrl === "battle" || modeFromUrl === "random" || (qs.get('room') || '').trim()) {
  mountCompetition({
    adapter: createSudokuAdapter({ gameType: 'sudoku-6x6', label: 'Sudoku 6x6', size: 6, difficulty: st.diff, rounds: 3, timeLimit: 240 }),
    tabsEl: document.querySelector("#tabs") as HTMLElement | null,
    tabLabelKey: 'mg.shared_tab_competition',
    hideOnOpen: ['#playView'],
  });
} else if (isMode(modeFromUrl)) {
  enterMode(modeFromUrl);
} else {
  location.replace(LOBBY_URL);
}

renderSide();
