/**
 * 等式金字塔 · Lobby 模式选择页
 * 与 24 点 / 6×6 / 9×9 / killer / number-pyramid 同构（arb-* 骨架 + --a-* 皮肤）。
 */

import '@tri-sites/design-system/styles';
import '../24-game/arena.css';            // --a-* 皮肤 token（skin-paper 浅色）
import '../../styles/home-redesign.css';  // papergames 骨架：sidebar / topbar / footer / how / ladder
import '../24-game/lobby.css';
import './lobby.css';
import { wireLobbyChrome } from '../../pages/lobby-chrome';
import { shanghaiDateKey } from '../sudoku/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

const LS_DAILY = 'ep_daily_v1';
const LS_BEST = 'ep_best_v1';
const LS_TIER = 'ep_tier_v1';

const readJSON = <T>(k: string, fb: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};
const fmt = (sec: number): string => `${sec.toFixed(1)}s`;
const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/* ===================== Hero：9-cell 装饰 =====================
   演示 pick order：选 p1=9、p2=4、p3=4 → 9 - 4 × 4 = -7（target） */
function renderHero(): void {
  const el = $('heroDeco');
  if (!el) return;
  el.innerHTML = el.innerHTML; // HTML 已经画好
}

/* ===================== 今日完成标记 ===================== */
function markDailyDone(): void {
  const done = readJSON<Record<string, number>>(LS_DAILY, {});
  const tag = $('dailyTag');
  if (tag && typeof done[shanghaiDateKey()] === 'number') tag.hidden = false;
}

/* ===================== 榜 ===================== */
function rowHtml(rankLabel: string, name: string, score: string, cls = ''): string {
  return (
    `<div class="arb-row ${cls}">` +
    `<span class="arb-rank">${esc(rankLabel)}</span>` +
    `<span class="arb-name">${esc(name)}</span>` +
    `<span class="arb-score num">${esc(score)}</span>` +
    '</div>'
  );
}

function renderBoard(): void {
  const host = $('boardRows');
  if (!host) return;

  const done = readJSON<Record<string, number>>(LS_DAILY, {});
  const best = readJSON<Record<string, number>>(LS_BEST, {});
  const dk = shanghaiDateKey();
  const today = done[dk];

  let html = '';
  if (today != null) {
    html += rowHtml('✓', 'Today · you', fmt(today), 'me');
  } else {
    html += rowHtml('–', 'Today', 'unsolved');
  }

  const past = Object.keys(done).filter((k) => k !== dk).sort().reverse().slice(0, 2);
  past.forEach((k) => {
    html += rowHtml(`${k.slice(4, 6)}/${k.slice(6)}`, 'Daily hunt', fmt(done[k] as number));
  });

  const bestLine = ['warmup', 'standard', 'tricky']
    .filter((d) => best[d] != null)
    .map((d) => `${d[0].toUpperCase()}${d.slice(1)} ${fmt(best[d] as number)}`)
    .join(' · ');
  html += `<div class="arb-note board-note">${
    bestLine ? `Solo bests · ${esc(bestLine)}<br />` : ''
  }Local runs only — the global board lands with the live API.</div>`;

  host.innerHTML = html;
}

/* ===================== 难度行 ===================== */
const TIERS = ['warmup', 'standard', 'tricky'] as const;
type Tier = (typeof TIERS)[number];
const isT = (x: string): x is Tier => (TIERS as readonly string[]).includes(x);

function currentT(): Tier {
  try {
    const v = localStorage.getItem(LS_TIER) ?? '';
    return isT(v) ? v : 'standard';
  } catch {
    return 'standard';
  }
}

function wireDifficulty(): void {
  const host = $('lobbyDiff');
  if (!host) return;
  const btns = Array.from(host.querySelectorAll<HTMLButtonElement>('.arb-dbtn'));

  const apply = (t: Tier): void => {
    btns.forEach((b) => {
      const on = b.dataset.t === t;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    try {
      localStorage.setItem(LS_TIER, t);
    } catch {
      /* ignore */
    }
    document.querySelectorAll<HTMLAnchorElement>('a.arb-mode[data-mode]').forEach((a) => {
      const m = a.dataset.mode;
      if (!m || m === 'daily') return;
      a.href = `/games/equation-pyramid/?mode=${m}&t=${t}`;
    });
  };

  btns.forEach((b) =>
    b.addEventListener('click', () => {
      const t = b.dataset.t;
      if (t && isT(t)) apply(t);
    }),
  );

  apply(currentT());
}

function boot(): void {
  wireLobbyChrome();
  renderHero();
  markDailyDone();
  renderBoard();
  wireDifficulty();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();