/**
 * 首页 · 每日挑战设置（题数 / 每题时间）
 * 沿用原站设计：题数 5 / 10 / 15，每题 60 / 90 / 120 秒。
 * 选择写入 localStorage，游戏页读取同一份配置，保证设置生效。
 */

const COUNTS = [5, 10, 15];
const TIMES = [60, 90, 120];
const KEY_COUNT = 'twentyfour_daily_count';
const KEY_TIME = 'twentyfour_daily_time';

function readInt(key: string, allow: number[], fallback: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) || '', 10);
    return allow.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function renderDailySettings(
  countHost: HTMLElement | null,
  timeHost: HTMLElement | null,
  startBtn: HTMLElement | null,
): void {
  if (!countHost || !timeHost) return;

  let count = readInt(KEY_COUNT, COUNTS, 5);
  let time = readInt(KEY_TIME, TIMES, 60);

  const paintCount = () => {
    countHost.innerHTML = COUNTS.map(
      (c) => `<button type="button" data-c="${c}" class="${c === count ? 'on' : ''}" aria-pressed="${c === count}">${c}</button>`,
    ).join('');
  };
  const paintTime = () => {
    timeHost.innerHTML = TIMES.map(
      (t) => `<button type="button" data-t="${t}" class="${t === time ? 'on' : ''}" aria-pressed="${t === time}">${t}s</button>`,
    ).join('');
  };

  const syncHref = () => {
    if (startBtn instanceof HTMLAnchorElement) {
      startBtn.href = `/games/24-game/?mode=daily&count=${count}&time=${time}`;
    }
  };

  countHost.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-c]');
    if (!btn) return;
    count = parseInt(btn.dataset.c || '5', 10);
    try { localStorage.setItem(KEY_COUNT, String(count)); } catch { /* ignore */ }
    paintCount();
    syncHref();
  });

  timeHost.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-t]');
    if (!btn) return;
    time = parseInt(btn.dataset.t || '60', 10);
    try { localStorage.setItem(KEY_TIME, String(time)); } catch { /* ignore */ }
    paintTime();
    syncHref();
  });

  paintCount();
  paintTime();
  syncHref();
}
