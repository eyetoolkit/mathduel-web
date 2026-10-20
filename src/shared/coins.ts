/**
 * coins.ts — 金币经济 P0 共享 SDK
 * ─────────────────────────────────────────────────────────────
 * 纯接线层：封装三站统一后端（tri-sites worker `/api/*`）已有的 5 个端点，
 * 让前端（主页钱包面板 / My Journey 流水区）零硬编码地取数、签到、领任务。
 *
 * 红线（设计文档 §0）：
 *   - 服务端为单一真相源，本 SDK 只读 + 触发已有写端点，绝不在本地写余额
 *   - 不新增任何服务端点（P0 边界）
 *   - 所有文案由调用方走 i18n，本文件零 UI 字符串
 *
 * 端点契约来源：`worker/src/membership/index.js`
 *   GET  /api/coins/me                  → 余额 + 今日已赚 + 日上限 + ad_free
 *   POST /api/coins/checkin             → 每日签到 +10（连签 7 天 +50）
 *   GET  /api/membership/quests         → 每日任务列表 + 进度 + 可领奖励
 *   POST /api/membership/quests/claim   → 领取任务奖励（过统一日上限）
 *   GET  /api/coins/history             → 最近收支流水（最多 200 条）
 */

/* ─── 类型契约（与服务端响应逐字段对齐） ─── */

/** GET /api/coins/me 的响应（匿名时 authenticated:false，其余字段缺失） */
export interface CoinsMe {
  authenticated: boolean;
  uuid?: string;
  nickname?: string;
  coins?: number;
  coins_earned_total?: number;
  ad_free?: {
    active: boolean;
    expires_at: number;
    days_remaining: number;
    history: unknown[];
  };
  streaks?: {
    login_streak: number;
    last_checkin_date: string | null;
    longest_streak: number;
  };
  daily?: {
    last_game_date: string | null;
    games_today: number;
    won_today: number;
    hard_today: number;
    earned_today: number;
    daily_challenge_done: boolean;
  };
  daily_budget?: { cap: number; used: number; remaining: number };
  invite_claim?: { coins: number; milestone: string | null } | null;
}

/** POST /api/coins/checkin 的响应 */
export interface CheckinResult {
  ok: boolean;
  earned: number;
  streak_bonus: boolean;
  streak: number;
  streak_days: number;
  total_coins: number;
}

/** 单个每日任务（服务端 DAILY_QUESTS 派生） */
export interface Quest {
  id: string;
  /** 服务端中文 title（仅供调试，UI 文案走 i18n quest_<id> 键） */
  title: string;
  reward: number;
  completed: boolean;
  claimed: boolean;
  can_claim: boolean;
}

/** GET /api/membership/quests 的响应 */
export interface QuestsResult {
  date: string;
  quests: Quest[];
  total_claimed_today: number;
  available_to_claim: number;
  coins: number;
}

/** POST /api/membership/quests/claim 的响应 */
export interface ClaimResult {
  ok: boolean;
  claimed: string[];
  skipped: { id: string; reason: string }[];
  coins_earned: number;
  total_coins: number;
}

/** 单条收支流水（member.history 元素） */
export interface CoinHistoryItem {
  type: 'earn' | 'spend';
  amount: number;
  source: string;
  ts: number;
}

/** GET /api/coins/history 的响应 */
export interface HistoryResult {
  page: number;
  limit: number;
  total: number;
  history: CoinHistoryItem[];
}

/**
 * SDK 层统一错误。
 * code 取值：
 *   'not_authenticated' — 匿名（401 / authenticated:false）
 *   'already_checked_in' — 当日已签到（400 already_checked_in）
 *   'network'            — 网络/服务不可达（fetch 抛错或 5xx）
 *   'bad_response'       — 2xx 但 JSON 形状不符（防御性）
 *   'http_<status>'      — 其它 HTTP 错误（含 400 参数类）
 */
export class CoinsError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'CoinsError';
    this.code = code;
    this.status = status;
  }
}

/* ─── 内部：带 credentials 的 fetch + JSON 解析 + 统一错误归一 ─── */

async function apiFetch(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    // fetch 抛错（网络断开 / CORS / 离线）
    throw new CoinsError('network', 'coin service unreachable');
  }

  // 401 / 400 需读 body 才能区分「匿名」与「已签到」等业务错误
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // 非 JSON 响应（如 404 HTML）
    if (res.status === 404) throw new CoinsError('network', 'endpoint not found', 404);
  }

  if (!res.ok) {
    const err = String(data.error ?? '');
    if (res.status === 401 || err === 'not_logged_in') {
      throw new CoinsError('not_authenticated', err || 'not_logged_in', 401);
    }
    if (err === 'already_checked_in') {
      throw new CoinsError('already_checked_in', err, 400);
    }
    // 其它：透传 status，让调用方按需处理（P0 里主要是 network）
    throw new CoinsError(
      `http_${res.status}`,
      err || `http ${res.status}`,
      res.status,
    );
  }

  return data;
}

/* ─── 公共 API ─── */

/**
 * 查余额 + 今日状态。匿名返回 `{ authenticated:false }`（服务端 200，非 401），
 * 因此本函数**不抛 not_authenticated**，由调用方按 `authenticated` 分支渲染。
 */
export async function coinsMe(): Promise<CoinsMe> {
  const data = await apiFetch('/api/coins/me');
  const out = data as unknown as CoinsMe;
  if (out.authenticated === false) return { authenticated: false };
  // 服务端匿名 200 时只有 authenticated:false；登录态才有 coins 等字段
  if (typeof out.coins !== 'number') {
    // 防御：登录态却缺 coins（理论上不会发生）→ 按匿名降级，避免面板崩
    return { authenticated: false };
  }
  return out;
}

/**
 * 每日签到。返回签到结果（含本次所得 + 新余额 + 连签天数）。
 * 已签到 → 抛 CoinsError('already_checked_in')；匿名 → 抛 'not_authenticated'。
 */
export async function checkin(): Promise<CheckinResult> {
  const data = await apiFetch('/api/coins/checkin', { method: 'POST', body: {} });
  return data as unknown as CheckinResult;
}

/** 取每日任务列表 + 进度。匿名抛 'not_authenticated'。 */
export async function getQuests(): Promise<QuestsResult> {
  const data = await apiFetch('/api/membership/quests');
  return data as unknown as QuestsResult;
}

/**
 * 领取任务奖励。`questIds` 传全部「可领」任务 id 即批量领。
 * 部分成功时返回 claimed/skipped 明细，调用方按 coins_earned 提示。
 */
export async function claimQuests(questIds: string[]): Promise<ClaimResult> {
  if (!Array.isArray(questIds) || questIds.length === 0) {
    throw new CoinsError('bad_response', 'quest_ids_required');
  }
  const data = await apiFetch('/api/membership/quests/claim', {
    method: 'POST',
    body: { quest_ids: questIds },
  });
  return data as unknown as ClaimResult;
}

/** 取最近收支流水（服务端最多保留 200 条）。`limit` 默认 20。 */
export async function getHistory(limit = 20): Promise<HistoryResult> {
  const data = await apiFetch(`/api/coins/history?limit=${limit}&page=1`);
  return data as unknown as HistoryResult;
}

/* ─── 任务文案键映射（UI 层用） ───
 * 服务端 DAILY_QUESTS 的 id 是固定集合。每个 id 对应一个 i18n 键
 * `coins.quest_<id>`，六语字典已建好。调用方渲染任务标题时查这张表，
 * 不要直接显示服务端的中文 title（会破坏六语一致性 —— 红线 §0）。 */

export const QUEST_KEY_MAP: Record<string, string> = {
  play_3: 'coins.quest_play_3',
  win_1: 'coins.quest_win_1',
  daily_challenge: 'coins.quest_daily_challenge',
  streak_3: 'coins.quest_streak_3',
  checkin: 'coins.quest_checkin',
};
