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
      name: 'Numeri Duelist',
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
  return `I just ${summary.mode} ${gameName}${dur}${extra} on NumeriDuel · numeriduel.com`;
}

/* ═══ F1.3 挑战卡 + F1.2 修复：统一每日完赛记录 ═══
   背景：markDailyDone 在此之前没有任何游戏调用（各游戏只写自己的键），
   /daily/ 中心的 streak 与进度环永远不动 —— 本节把「完赛时刻」收口到
   一个入口：recordDaily() = 记进度 + 弹挑战卡（每天每游戏只弹一次）。
   挑战卡是纯前端传播入口：每日题全球同种子，朋友点链接做的是同一套题。 */

const CARD_CSS_ID = 'mdChallengeCss';

function ensureCardStyles(): void {
  if (document.getElementById(CARD_CSS_ID)) return;
  const st = document.createElement('style');
  st.id = CARD_CSS_ID;
  st.textContent = `
  .mdcc-wrap{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;background:rgba(16,20,42,.55);backdrop-filter:blur(3px);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:18px}
  .mdcc-box{background:#fff;border-radius:20px;padding:26px 24px;width:min(400px,94vw);box-shadow:0 24px 70px rgba(16,20,42,.35);text-align:center;animation:mdccIn .25s ease}
  @keyframes mdccIn{from{transform:translateY(14px) scale(.97);opacity:0}to{transform:none;opacity:1}}
  .mdcc-emoji{font-size:2.6rem;line-height:1}
  .mdcc-t{margin:10px 0 2px;font-size:1.25rem;font-weight:800;color:#10142A}
  .mdcc-s{margin:0 0 14px;font-size:.8rem;color:#6B7290}
  .mdcc-card{background:linear-gradient(160deg,#EEF0FB,#F6F3FF);border:1.5px solid #D9DCF5;border-radius:14px;padding:14px 15px;font-size:.92rem;font-weight:700;color:#3730A3;line-height:1.55;word-break:break-word;text-align:left}
  .mdcc-acts{display:flex;gap:9px;margin-top:16px}
  .mdcc-btn{flex:1;border:0;border-radius:12px;padding:12px;font-weight:800;font-size:.9rem;cursor:pointer;background:#3730A3;color:#fff}
  .mdcc-btn:disabled{opacity:.55}
  .mdcc-ghost{flex:0 0 auto;background:transparent;color:#6B7290;border:1.5px solid #E3E7F0}
  .mdcc-ghost:hover{border-color:#3730A3;color:#3730A3}
  .mdcc-note{margin-top:10px;font-size:.72rem;color:#9AA1B9}
  `;
  document.head.appendChild(st);
}

/** 每日挑战的分享深链（同一种子 = 同一套题） */
export function challengeLink(gameId: GameId): string {
  return `https://numeriduel.com/games/${gameId}/?mode=daily`;
}

export interface DailyResult {
  durationSec?: number;
  solved?: number;
  total?: number;
}

export function challengeText(gameId: GameId, result: DailyResult = {}): string {
  const labels: Record<GameId, string> = {
    '24-game': '24 Game',
    'sudoku-4x4': 'Sudoku 4×4',
    'sudoku': 'Sudoku 9×9',
    'sudoku-6x6': 'Sudoku 6×6',
    'equation-pyramid': 'Equation Pyramid',
  };
  const name = labels[gameId] || gameId;
  const dur = result.durationSec ? ` in ${result.durationSec.toFixed(1)}s` : '';
  const score = result.total ? ` (${result.solved ?? result.total}/${result.total})` : '';
  return `⚔️ I solved today's ${name} Daily${dur}${score} on NumeriDuel — can you beat me? ${challengeLink(gameId)}`;
}

/** 记录每日完赛（幂等）：更新 streak/进度数据；当天首次完成时弹挑战卡 */
export function recordDaily(gameId: GameId, result: DailyResult = {}): void {
  const first = !getTodaysDones().includes(gameId);
  markDailyDone(gameId);
  markGamePlayed(gameId, 'daily');
  if (first) showChallengeCard(gameId, result);
}

/** 挑战卡浮层：分享文案 + 一键复制（复制内容含每日深链） */
export function showChallengeCard(gameId: GameId, result: DailyResult = {}): void {
  ensureCardStyles();
  const text = challengeText(gameId, result);
  const wrap = document.createElement('div');
  wrap.className = 'mdcc-wrap';
  wrap.innerHTML = `
    <div class="mdcc-box">
      <div class="mdcc-emoji">⚔️</div>
      <div class="mdcc-t">Challenge card</div>
      <div class="mdcc-s">Today's puzzle is the same for everyone — send it to a friend.</div>
      <div class="mdcc-card">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
      <div class="mdcc-acts">
        <button class="mdcc-btn" id="mdccCopy">📋 Copy challenge</button>
        <button class="mdcc-btn mdcc-ghost" id="mdccClose">✕</button>
      </div>
      <div class="mdcc-note">No account needed — challenge links are just puzzle seeds.</div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#mdccClose')?.addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const btn = wrap.querySelector('#mdccCopy') as HTMLButtonElement | null;
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    const okFlag = await copyResultToClipboard(text);
    btn.textContent = okFlag ? '✅ Copied — paste it anywhere!' : 'Copy failed — long-press the card';
    btn.disabled = false;
    window.setTimeout(() => { btn.textContent = '📋 Copy challenge'; }, 2600);
  });
}