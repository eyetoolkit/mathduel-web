/**
 * 跨游戏进度追踪（F-210 Day 1/Day 2/Day 7 进度感）
 * ----------------------------------------------------------------
 * 统一入口：localStorage key = `mathduel_progress_v1`
 * 数据结构：
 *   dailyDone: { [dateKey]: { [gameId]: true } }    // 哪天哪游戏完成 daily
 *   playedGames: { [gameId]: { firstSeen: ISO, modes: Set<...> } }
 * 导出：
 *   - markDailyDone(gameId, dateKey)        标记完成
 *   - markGamePlayed(gameId, mode)          记录首次游玩
 *   - getDailyStreak()                      连续多少天玩完 daily
 *   - getTodaysDones()                      今天完成哪几款 daily（用于首页面板）
 *   - getBadges()                            解锁的徽章列表
 *   - getGamesPlayedCount()                  玩过几款不同游戏
 *
 * 不上传服务端，纯本地（隐私优先），F-205 / F-206 同源
 */

export type GameId = '24-game' | 'sudoku-4x4' | 'sudoku' | 'sudoku-6x6'| 'equation-pyramid';
export type Mode = 'solo' | 'daily' | 'duel' | 'timed' | 'practice' | 'competition';

const KEY = 'mathduel_progress_v1';

interface Progress {
  dailyDone: Record<string, Partial<Record<GameId, true>>>; // dateKey → gameId
  playedGames: Partial<Record<GameId, { firstSeen: string; modes: string[] }>>;
}

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { dailyDone: {}, playedGames: {} };
    const p = JSON.parse(raw) as Partial<Progress>;
    return {
      dailyDone: p.dailyDone ?? {},
      playedGames: p.playedGames ?? {},
    };
  } catch {
    return { dailyDone: {}, playedGames: {} };
  }
}

function save(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode — silently no-op */
  }
}

/** Shanghai (UTC+8) 当天日期键，与各游戏的 daily 种子一致 */
export function todayKey(): string {
  const d = new Date();
  const utc8 = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60_000);
  const y = utc8.getFullYear();
  const m = String(utc8.getMonth() + 1).padStart(2, '0');
  const day = String(utc8.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** 标记某游戏今天完成了 daily 模式 */
export function markDailyDone(gameId: GameId): void {
  const p = load();
  const d = todayKey();
  if (!p.dailyDone[d]) p.dailyDone[d] = {};
  p.dailyDone[d][gameId] = true;
  save(p);
}

/** 记录某游戏首次进入某模式（用于跨游戏徽章） */
export function markGamePlayed(gameId: GameId, mode: Mode): void {
  const p = load();
  if (!p.playedGames[gameId]) {
    p.playedGames[gameId] = { firstSeen: new Date().toISOString(), modes: [] };
  }
  if (!p.playedGames[gameId].modes.includes(mode)) p.playedGames[gameId].modes.push(mode);
  save(p);
}

/** 今天完成哪几款 daily */
export function getTodaysDones(): GameId[] {
  const p = load();
  const d = todayKey();
  const dones = p.dailyDone[d] || {};
  return Object.keys(dones).filter((g) => dones[g as GameId]) as GameId[];
}

/** 7 款游戏中今天玩了几款 daily */
export function getTodaysDailyDoneCount(): number {
  return getTodaysDones().length;
}

/** 玩过几款不同游戏 */
export function getGamesPlayedCount(): number {
  return Object.keys(load().playedGames).length;
}

/** 累计完成 daily 次数（不去重日期） */
export function getTotalDailyDoneCount(): number {
  const p = load();
  let n = 0;
  for (const d of Object.keys(p.dailyDone)) {
    for (const g of Object.keys(p.dailyDone[d] || {})) if (p.dailyDone[d][g as GameId]) n++;
  }
  return n;
}

/** 连续多少天至少完成 1 款 daily（从今天往前数） */
export function getDailyStreak(): number {
  const p = load();
  let streak = 0;
  const d = new Date();
  // walk back day by day in UTC+8
  for (let i = 0; i < 365; i++) {
    const utc8 = new Date(d.getTime() - i * 86_400_000 + (d.getTimezoneOffset() + 480) * 60_000);
    const y = utc8.getFullYear();
    const m = String(utc8.getMonth() + 1).padStart(2, '0');
    const day = String(utc8.getDate()).padStart(2, '0');
    const k = `${y}${m}${day}`;
    const dones = p.dailyDone[k] || {};
    if (Object.keys(dones).length === 0) break;
    streak++;
  }
  return streak;
}

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  hint: string;
  unlocked: boolean;
}

/** 解锁徽章清单（F-210 Day 1 / 2 / 7 进度感） */
export function getBadges(): Badge[] {
  const dailyDone = getTotalDailyDoneCount();
  const gamesPlayed = getGamesPlayedCount();
  const streak = getDailyStreak();
  return [
    {
      id: 'first-daily',
      name: 'First Daily',
      emoji: '🌱',
      hint: 'Complete your first Daily Challenge.',
      unlocked: dailyDone >= 1,
    },
    {
      id: 'three-games',
      name: 'Math Veteran',
      emoji: '🎖️',
      hint: 'Try 3 different games.',
      unlocked: gamesPlayed >= 3,
    },
    {
      id: 'streak-5',
      name: '5-Day Streak',
      emoji: '🔥',
      hint: 'Complete any Daily for 5 days in a row.',
      unlocked: streak >= 5,
    },
    {
      id: 'daily-5',
      name: 'Math Duelist',
      emoji: '⚔️',
      hint: 'Complete 5 Daily Challenges in total.',
      unlocked: dailyDone >= 5,
    },
    {
      id: 'all-games',
      name: 'Site Explorer',
      emoji: '🗺️',
      hint: 'Try all 7 games at least once.',
      unlocked: gamesPlayed >= 7,
    },
  ];
}

/** 全部 7 款游戏的 id 顺序（用于首页 daily 面板遍历） */
export const ALL_GAMES: GameId[] = ['24-game', 'sudoku-4x4', 'sudoku', 'sudoku-6x6', 'equation-pyramid'];

const HINT_KEY = (gameId: GameId) => `md_hint_${gameId}_v1`;

/**
 * F-206: 首登引导条
 *  - 每个游戏首登 1 次展示 3 秒浮层，自动消失
 *  - 手动关闭后 30 天内不再显示
 *  - 隐私优先：纯 localStorage
 */
export function showFirstTimeHint(gameId: GameId, title: string, body: string): void {
  try {
    const raw = localStorage.getItem(HINT_KEY(gameId));
    let dismissUntil = 0;
    if (raw) {
      try {
        const t = parseInt(raw, 10);
        if (!Number.isNaN(t)) dismissUntil = t;
      } catch {
        /* keep 0 */
      }
    }
    if (Date.now() < dismissUntil) return;
  } catch {
    /* private mode — silently skip */
  }
  // Build a small overlay
  const host = document.body;
  const box = document.createElement('div');
  box.className = 'md-first-hint';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML =
    `<button class="md-hint-x" type="button" aria-label="Dismiss">×</button>` +
    `<div class="md-hint-t">${title}</div>` +
    `<div class="md-hint-b">${body}</div>`;
  host.appendChild(box);
  // Auto-dismiss after 5s or on click
  let dismissed = false;
  const close = () => {
    if (dismissed) return;
    dismissed = true;
    box.classList.add('md-hint-out');
    window.setTimeout(() => box.remove(), 280);
    try {
      localStorage.setItem(HINT_KEY(gameId), String(Date.now() + 30 * 86_400_000));
    } catch {
      /* private mode */
    }
  };
  box.querySelector('.md-hint-x')?.addEventListener('click', close);
  box.addEventListener('click', close);
  window.setTimeout(close, 5000);
}

/**
 * F-206 (b): 通用「复制成绩」helper
 *  - 将一段文本写入剪贴板（fallback: 选中文本提示用户 Cmd-C）
 *  - 给所有非 24-game 游戏的结算面板用（24-game 自己有 Canvas 成绩卡）
 */
export async function copyResultToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* fall through to legacy method */
  }
  // legacy fallback: use a hidden textarea + execCommand
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

/** F-206 (b): 格式化一段简洁的「成绩可分享文本」（≤200 字） */
export function formatShareText(gameId: GameId, summary: { mode: string; duration?: number; extra?: string }): string {
  const labels: Record<GameId, string> = {
    '24-game': '24 Game',
    'sudoku-4x4': 'Sudoku 4×4',
    'sudoku': 'Sudoku 9×9',
    'sudoku-6x6': 'Sudoku 6×6',
      'equation-pyramid': 'Equation Pyramid',
    };
  const gameName = labels[gameId] || gameId;
  const dur = summary.duration ? ` in ${summary.duration.toFixed(1)}s` : '';
  const extra = summary.extra ? ` — ${summary.extra}` : '';
  return `I just ${summary.mode} ${gameName}${dur}${extra} on MathDuel · mathduel.games`;
}