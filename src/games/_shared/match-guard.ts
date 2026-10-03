/**
 * match-guard.ts · 跨棋类共享：进对局统一入口 + 退出二次确认守卫
 * ------------------------------------------------------------------
 * 从 24-game 第 1/4/6 轮沉淀出来的范式抽象 —— 适用于 sudoku / sudoku-4x4 /
 * sudoku-6x6 / equation-pyramid / 后续新棋类。
 *
 * 设计要点（gomoku 第 1/4/6 轮踩过的坑）：
 *   · 进对局统一加 body.in-match（隐藏 sidebar/topbar/footer → 沉浸态）
 *   · pushState 占位条目 → popstate 拦截 → 弹 leaveCard → 玩家二选一
 *   · 统一出口 exitMatchToLobby()，占位条目必须经 popstate 消费，否则下次
 *     arm 误判已武装（gomoku 第 6 轮踩过）
 *   · 兜底 600ms setTimeout：若 history.back() 不触发 popstate，直接 replace 跳
 *
 * 用法（HTML 必须在主对局屏里留一个 #<id>-leavecard 节点）：
 *   import { bindLeaveCard, enterMatchMode, exitMatchToLobby } from '../_shared/match-guard';
 *
 *   // TS 顶层一次性绑定（点 leaveCard 三键 + popstate）
 *   bindLeaveCard({ leaveCardId: 'g24-leavecard', lobbyUrl: '/games/24-game/lobby/' });
 *
 *   // 进对局时（deal / startDaily / startTimed / battle 等所有开局入口）
 *   enterMatchMode();
 *
 *   // 认输 / 结算"回大厅"按钮 / Esc
 *   exitMatchToLobby();
 */

export interface MatchGuardOptions {
  /** leaveCard 节点 id（必须是 `<div hidden id="...">`，默认 hidden） */
  leaveCardId: string;
  /** 回大厅页 URL */
  lobbyUrl: string;
  /** 默认对局时锁定位移（默认 true） */
  immersive?: boolean;
}

const stateByGame = new Map<string, {
  backGuard: boolean;
  backLeaving: boolean;
  pendingLobbyNav: boolean;
  leaveCard: HTMLElement | null;
  options: MatchGuardOptions;
}>();

function getState(opts: MatchGuardOptions): NonNullable<ReturnType<typeof stateByGame.get>> {
  let s = stateByGame.get(opts.leaveCardId);
  if (!s) {
    s = {
      backGuard: false,
      backLeaving: false,
      pendingLobbyNav: false,
      leaveCard: document.getElementById(opts.leaveCardId),
      options: opts,
    };
    stateByGame.set(opts.leaveCardId, s);
  } else {
    s.leaveCard = document.getElementById(opts.leaveCardId);
    s.options = opts;
  }
  return s;
}

/**
 * 一次性绑定 leaveCard 三键 + popstate 监听。
 * 必须在对局页 TS 顶层（module 顶层、IIFE 外）调用，否则 Vite module 默认 defer 会导致
 * 监听器注册晚于首次 popstate 触发。
 */
export function bindLeaveCard(opts: MatchGuardOptions): void {
  const s = getState(opts);

  // 兜底 popstate 监听（只注册一次）
  if (!(window as unknown as { __matchGuardBound__?: string[] }).__matchGuardBound__) {
    (window as unknown as { __matchGuardBound__?: string[] }).__matchGuardBound__ = [];
  }
  const bound = (window as unknown as { __matchGuardBound__: string[] }).__matchGuardBound__;
  if (bound.includes(opts.leaveCardId)) return;
  bound.push(opts.leaveCardId);

  window.addEventListener('popstate', () => {
    const gameState = stateByGame.get(opts.leaveCardId);
    if (!gameState) return;
    if (gameState.backLeaving) {
      gameState.backLeaving = false;
      gameState.backGuard = false;
      return;
    }
    if (!gameState.backGuard) return;
    if (!document.body.classList.contains('in-match')) {
      gameState.backGuard = false;
      return;
    }
    // 用户侧滑 / 返回 → 立刻 pushState 补回条目（URL 不变、页面不退）+ 弹 leaveCard
    try { history.pushState({ [opts.leaveCardId]: 1 }, ''); } catch (e) { /* noop */ }
    if (gameState.leaveCard) gameState.leaveCard.hidden = false;
  });

  // 三键绑定（close / stay / yes）
  const close = document.getElementById(opts.leaveCardId + '-close');
  const stay = document.getElementById(opts.leaveCardId + '-stay');
  const yes = document.getElementById(opts.leaveCardId + '-yes');
  close?.addEventListener('click', () => { if (s.leaveCard) s.leaveCard.hidden = true; });
  stay?.addEventListener('click', () => { if (s.leaveCard) s.leaveCard.hidden = true; });
  yes?.addEventListener('click', () => exitMatchToLobby(opts));
}

/**
 * 进对局统一入口：加 body.in-match + armBackGuard（pushState 占位）。
 * 24-game 还在这里触发 playSfx('start')；其他棋类可在 deal() 末尾自己 playSfx。
 */
export function enterMatchMode(opts: MatchGuardOptions): void {
  const s = getState(opts);
  const immersive = opts.immersive !== false;
  if (immersive) document.body.classList.add('in-match');
  armBackGuard(opts);
}

/** pushState 压占位条目；只在对局中（body.in-match）武装 */
export function armBackGuard(opts: MatchGuardOptions): void {
  const s = getState(opts);
  if (!document.body.classList.contains('in-match')) return;
  try {
    history.pushState({ [opts.leaveCardId]: 1 }, '');
    s.backGuard = true;
  } catch (e) { /* history 不可用则放弃拦截 */ }
}

/**
 * 统一退出出口。流程：
 *   1. 隐藏 leaveCard
 *   2. 设 backLeaving=true（让下一次 popstate 消费掉占位条目）
 *   3. history.back() → 触发 popstate → backLeaving 重置 + 玩家跳走
 *   4. 兜底 600ms：若 back() 没触发 popstate，直接 location.replace 到 lobbyUrl
 */
export function exitMatchToLobby(opts: MatchGuardOptions): void {
  const s = getState(opts);
  if (s.leaveCard) s.leaveCard.hidden = true;
  s.backGuard = false;
  document.body.classList.remove('in-match');
  s.backLeaving = true;
  s.pendingLobbyNav = true;
  window.setTimeout(() => {
    if (s.pendingLobbyNav) {
      s.pendingLobbyNav = false;
      s.backLeaving = false;
      window.location.replace(opts.lobbyUrl);
    }
  }, 600);
  try { history.back(); } catch (e) {
    s.pendingLobbyNav = false;
    s.backLeaving = false;
    window.location.replace(opts.lobbyUrl);
  }
}
