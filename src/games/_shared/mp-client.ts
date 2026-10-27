/**
 * 通用多人竞赛客户端（自包含、游戏无关外壳）
 * ─────────────────────────────────────────────────────────────────────────
 * 复用 24 点已验证的 WS 竞赛生命周期（建房 / 加入 / 大厅 / 房间视图 / 速度环 /
 * 聊天 / 观战 / 结算 / Elo / DEMO 降级），但把「题目渲染 + 答题动作」抽成
 * 每游戏一个 adapter，由本外壳在收到回合消息时转发给 adapter。
 *
 * 关键：后端竞赛是「按游戏类型、服务端权威」的（见 worker/.../durable/game-room.js）：
 *   · sudoku / sudoku-6x6 → sudoku_new_game + sudoku_place
 *   · equation-pyramid（服务端 gameType=eqpyr）→ eqpyr_new_game + eqpyr_solve
 *   · bulls → bulls_new_round / bulls_phase / bulls_set_secret / bulls_guess
 *   · 24 → new_round(cards) + submit_answer
 * 本外壳只负责通用部分；具体题目与动作由 adapter 处理。
 *
 * 非生产域名自动降级为本地 DEMO（模拟 99 人实时榜），便于预览验收。
 */

import { i18nT, onI18nChange } from './i18n-t';
import { isClassroom, ensureStudentCode, reportRound } from './teacher-track';
 import { genRoomCode, normalizeRoomCode, isValidRoomCode, ROOM_CODE_LEN } from './room-code';

/** 数学站生产环境 host（数学站改名路线图 2026-09-30：mathduel.games → numeriduel.com）
 *  保留 mathduel.games 12 个月过渡期（CF Bulk Redirects）— 教师邀请码不中断 */
const PROD_HOSTS = ['numeriduel.com', 'mathduel.games'] as const;

export function isProdEnv(): boolean {
  const h = location.host.toLowerCase();
  return PROD_HOSTS.some((host) => h.indexOf(host) >= 0);
}

/* ─── 玩家身份 ───
   名字的真相在服务端账号上，本机 localStorage 只是断网时的兜底。
   模块按需加载一次，之后 window.Identity 就是唯一入口。 */
let _idtPromise: Promise<any> | null = null;
function identity(): Promise<any> {
  if ((window as any).Identity) return Promise.resolve((window as any).Identity);
  if (_idtPromise) return _idtPromise;
  _idtPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/shared/identity.js';
    s.onload = () => resolve((window as any).Identity || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return _idtPromise;
}

/* ===================== 类型 ===================== */

export interface RaceEntry {
  name: string;
  time?: number;
  ok?: boolean;
  rank?: number;
  solved?: number;
  score?: number;
}

export interface EloEntry {
  name: string;
  uuid?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  elo: number;
  delta: number;
  tier?: string;
  tierChange?: { from: string; to: string; promoted?: boolean; demoted?: boolean };
}

export interface ChatMsg {
  name: string;
  text: string;
  ts: number;
  self: boolean;
}

/** 回合上下文：adapter 渲染题目时用 */
export interface RoundCtx {
  round: number;
  maxRounds: number;
  timeLimit: number;
  players: any[];
  isHost: boolean;
}

/**
 * 每游戏竞赛适配器。外壳在收到「题目/动作回显」类消息时调用 onMessage；
 * adapter 自行决定如何渲染与发送答题动作。
 */
export interface MpAdapter {
  /** 服务端 gameType（建房 POST /api/rooms 用） */
  gameType: string;
  /** 展示名（大厅/结算用） */
  label: string;
  /** 难度档（建房用；不传则后端用缺省） */
  difficulty?: string;
  /** 建房时每局回合数（不传后端按游戏类型缺省） */
  rounds?: number;
  /** 建房时每题时限秒（不传后端 30s） */
  timeLimit?: number;
  /** 建房时房间上限（2..99；不传默认 99） */
  raceMax?: number;
  /** 把题目渲染进 boardEl（real/demo 共用同一渲染入口） */
  renderRound(payload: any, ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell): void;
  /** 处理一条服务端回合/计分消息；返回 true 表示已消费 */
  onMessage(msg: any, shell: MpShell): boolean;
  /** 构造一个 DEMO 题目（本地预览用，不依赖服务端） */
  makeDemoPuzzle(round: number): any;
  /**
   * SV 竞速中继出题（可选）：
   * 走硅谷服务器时，服务端不持引擎，由房主用本地引擎生成题目 → set_puzzle 上报 →
   * 服务端原样广播给同房。不实现此方法的游戏无法走 SV 中继（只能继续用 CF DO）。
   * 注意：payload 不得包含答案（solution），否则对手可直接抄答案。
   */
  makeRacePuzzle?(round: number): any;
  /** DEMO 下一轮题目时由外壳调用（可选，默认复用 renderRound） */
  demoStart?(shell: MpShell): void;
  /** 清理（切走模式时调用，可选） */
  dispose?(): void;
}

export interface MpCallbacks {
  onPlayersChanged?: (players: Record<string, { score: number; avatar?: string | null; nickname?: string | null }>, isHost: boolean, room: string) => void;
  onRoomReady?: (room: string) => void;
  onRoundStart?: (ctx: RoundCtx) => void;
  onProgress?: (p: { doneCount: number; total: number; done: RaceEntry[]; self?: any }) => void;
  onRoundResult?: (p: { round: number; ranking: RaceEntry[] }) => void;
  onGameOver?: (p: { ranking: RaceEntry[]; elo?: EloEntry[] }) => void;
  onTimer?: (timeLeft: number) => void;
  onError?: (msg: string) => void;
  onChat?: (msg: ChatMsg) => void;
  onSpectator?: (p: { count: number }) => void;
  onSelfSpectator?: () => void;
  /** 外壳 UI 容器已准备好（lobby / room / head / board / sidebar / chat 均在其中） */
  onMount?: (root: HTMLElement) => void;
}

/** 断线自动重连次数上限（超过后停止重试并明确告知玩家，避免无限静默重试） */
const MP_RECONNECT_MAX = 5;

const BOT_NAMES = ['Nova','Pixel','Luna','Echo','Kai','Vega','Milo','Zero','Iris','Leo','Hugo','Rin','Aki','Yuki','Cleo','Finn','Theo','Nori','Zoe','Mira','Eden','Wren','Ozzy','Lux','Ben','Sol','Remy','Sage','Otto','Nyx','Vex','Cy','Jun','Tao','Rue','Pia','Bao','Nim','Ace','Sky','Rex','Max','Zara','Kira','Jett','Nico','Aria','Dex','Ivy','Ash','Blaze','Cole','Drew','Felix','Gia','Hale','Ike','Jade','Knox','Maya','Neo','Orin','Pax','Quinn','Rory','Soren','Toby','Uma','Vance','Wade','Xan','Yara','Zane'];
const DEMO_CHAT = ['Almost got it!', 'Hurry up 😂', '🔥', 'Nice one', 'Wait, that works?', 'gg'];

const SHELL_CSS = `
.mp-root{position:fixed;inset:0;z-index:60;display:none;background:#F4F5F9;color:#1A1B2E;font-family:inherit;overflow:auto}
.mp-root.show{display:block}
.mp-root *{box-sizing:border-box}
.mp-wrap{max-width:1080px;margin:0 auto;padding:18px 16px 60px}
.mp-top{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.mp-logo{font-weight:800;letter-spacing:.5px;font-size:18px;color:#1A1B2E}
.mp-logo b{color:#3730A3}
.mp-code{font-weight:700;letter-spacing:2px;background:#F3F4F6;border:1px solid #E5E7EB;padding:4px 10px;border-radius:8px}
.mp-leave{margin-left:auto;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;padding:7px 14px;border-radius:9px;cursor:pointer;font-weight:600}
.mp-leave:hover{background:#FEE2E2}
.mp-grid{display:grid;grid-template-columns:1fr 320px;gap:16px}
@media(max-width:860px){.mp-grid{grid-template-columns:1fr}}
.mp-card{background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;padding:16px}
.mp-card h3{margin:0 0 10px;font-size:14px;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.6px}
.mp-board{min-height:280px;display:flex;align-items:center;justify-content:center}
.mp-head{display:flex;align-items:center;gap:14px;margin-bottom:12px}
.mp-ring{width:54px;height:54px;flex:0 0 54px}
.mp-ring circle{fill:none;stroke-width:5;stroke-linecap:round}
.mp-ring .bg{stroke:#E5E7EB}
.mp-ring .fg{stroke:#F59E0B;transition:stroke-dashoffset .3s linear}
.mp-ring-txt{font-size:13px;font-weight:700;text-align:center}
.mp-banner{font-size:13px;color:#6B7280}
.mp-banner b{color:#1A1B2E}
.mp-recon{display:none;padding:8px 12px;font-size:13px;font-weight:600;text-align:center;background:#FEF3C7;color:#92400E;border-bottom:1px solid #FDE68A}
.mp-recon[data-show="1"]{display:block}
.mp-recon[data-fail="1"]{background:#FEE2E2;color:#991B1B;border-bottom-color:#FECACA}
.mp-status{display:inline-block;margin-top:4px;font-size:12px;color:#16A34A}
.mp-status[data-live="1"]::before{content:"● ";color:#16A34A}
.mp-race-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.mp-race-count{font-size:13px;color:#6B7280}
.mp-race-count b{color:#1A1B2E;font-size:16px}
.mp-list{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto}
.mp-row{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px}
.mp-row.r1{background:#FEF3C7;border-color:#F59E0B}
.mp-row.me{border-color:#3730A3}
.mp-rank{width:22px;text-align:center;font-weight:800;color:#B45309}
.mp-av{width:24px;height:24px;border-radius:50%;background:#F3F4F6;display:flex;align-items:center;justify-content:center;font-size:14px}
.mp-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-time{color:#6B7280;font-variant-numeric:tabular-nums}
.mp-empty{color:#9CA3AF;font-size:13px;padding:14px;text-align:center}
.mp-modal{position:fixed;inset:0;background:rgba(17,24,39,.5);display:none;align-items:center;justify-content:center;z-index:80;padding:20px}
.mp-modal.show{display:flex}
.mp-modal .box{background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;padding:24px;max-width:460px;width:100%;text-align:center}
.mp-modal h2{margin:0 0 10px;font-size:22px}
.mp-modal .sub{color:#6B7280;font-size:13px;margin-bottom:14px}
.mp-modal .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.mp-btn{padding:9px 16px;border-radius:10px;border:1px solid #E5E7EB;background:#F3F4F6;color:#1A1B2E;cursor:pointer;font-weight:600}
.mp-btn.primary{background:#F59E0B;color:#1a1305;border-color:#F59E0B}
.mp-btn.ghost{background:transparent}
.mp-elo-grid{display:flex;flex-direction:column;gap:5px;margin-top:8px;text-align:left}
.mp-elo-row{display:flex;align-items:center;gap:8px;font-size:13px}
.mp-elo-row.me{color:#3730A3;font-weight:700}
.mp-elo-row .v{margin-left:auto;font-variant-numeric:tabular-nums}
.mp-elo-row .d.up{color:#16A34A}.mp-elo-row .d.down{color:#DC2626}.mp-elo-row .d.flat{color:#6B7280}
.mp-tierflash{margin-top:10px;font-weight:700;color:#B45309}
.mp-tierflash.demoted{color:#4F46E5}
/* ---- Lobby modal ---- */
.mp-lobby{position:fixed;inset:0;background:rgba(17,24,39,.5);display:none;align-items:center;justify-content:center;z-index:85;padding:20px;overflow:auto}
.mp-lobby.show{display:flex}
.mp-lobby .box{background:#FFFFFF;border:1px solid #E5E7EB;border-radius:18px;padding:26px;max-width:440px;width:100%;position:relative}
.mp-lobby .mp-x{position:absolute;top:12px;right:14px;width:32px;height:32px;border:none;background:transparent;border-radius:8px;font-size:17px;color:#6B7280;cursor:pointer;line-height:1}
.mp-lobby .mp-x:hover{background:#F3F4F6;color:#1A1B2E}
.mp-lobby h2{margin:0 0 4px;font-size:22px}
.mp-lobby .hint{color:#6B7280;font-size:13px;margin-bottom:16px}
.mp-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.mp-field label{font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px}
.mp-input{background:#F9FAFB;border:1px solid #E5E7EB;color:#1A1B2E;border-radius:10px;padding:11px 13px;font-size:15px;outline:none}
.mp-input:focus{border-color:#F59E0B}
.mp-sizes{display:flex;gap:8px;margin-bottom:16px}
.mp-size{flex:1;text-align:center;padding:9px 0;border-radius:10px;background:#F9FAFB;border:1px solid #E5E7EB;cursor:pointer;font-weight:700;font-size:14px}
.mp-size.on{border-color:#3730A3;background:#EEF2FF;color:#3730A3}
.mp-actions{display:flex;gap:10px}
.mp-actions .mp-btn{flex:1}
.mp-err{color:#DC2626;font-size:13px;min-height:18px;margin-bottom:8px}
.mp-room{display:none}
.mp-room.show{display:block}
.mp-room .code-big{font-size:30px;font-weight:800;letter-spacing:4px;color:#3730A3;text-align:center;margin:6px 0}
.mp-qr{width:130px;height:130px;margin:10px auto;display:block;background:#fff;border-radius:10px}
.mp-pwrap{display:flex;gap:10px;margin:12px 0}
.mp-pwrap .mp-btn{flex:1}
.mp-players{display:flex;flex-direction:column;gap:6px;max-height:160px;overflow:auto;margin:12px 0}
.mp-rp{display:flex;align-items:center;gap:8px;font-size:14px;padding:6px 8px;background:#F9FAFB;border-radius:9px}
.mp-rp.me{color:#3730A3}
.mp-rp .host{margin-left:auto;font-size:11px;color:#6B7280}
.mp-specbar{display:none;background:#FEF3C7;border:1px solid #F59E0B;color:#B45309;padding:8px 12px;border-radius:10px;font-size:13px;margin-bottom:12px}
.mp-specbar.show{display:block}
/* ---- chat ---- */
.mp-chat{display:flex;flex-direction:column;gap:0;margin-top:14px}
.mp-chat .hd{font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:flex;justify-content:space-between}
.mp-chat .log{height:150px;overflow:auto;display:flex;flex-direction:column;gap:6px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:8px}
.mp-bub{padding:6px 9px;border-radius:9px;font-size:13px;max-width:85%}
.mp-bub.me{background:#EEF2FF;align-self:flex-end}
.mp-bub.opp{background:#F3F4F6;align-self:flex-start}
.mp-bub .who{font-size:11px;color:#9CA3AF;display:block;margin-bottom:1px}
.mp-rail{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.mp-rail button{background:#F3F4F6;border:1px solid #E5E7EB;border-radius:8px;cursor:pointer;font-size:15px;width:34px;height:30px}
.mp-chat .inrow{display:flex;gap:6px;margin-top:7px}
.mp-chat .inrow input{flex:1;background:#F9FAFB;border:1px solid #E5E7EB;color:#1A1B2E;border-radius:9px;padding:8px 10px;outline:none}
.mp-chat .inrow button{background:#F59E0B;color:#1a1305;border:none;border-radius:9px;padding:0 14px;font-weight:700;cursor:pointer}
`;

/* ===================== 外壳 ===================== */

export class MpShell {
  adapter: MpAdapter;
  cb: MpCallbacks;
  root!: HTMLElement;
  lobbyEl!: HTMLElement;
  modalEl!: HTMLElement;
  boardEl!: HTMLElement;
  private cbRound: RoundCtx | null = null;

  active = false;
  started = false;
  waiting = false;
  room = '';
  isHost = false;
  myName = '';
  maxPlayers = 99;
  total = 0;
  done = 0;
  round = 0;
  maxRounds = 5;
  timeLimit = 30;
  myTime = 0;
  spectator = false;
  spectatorCount = 0;
  /** SV 竞速中继模式：new_round{hasPuzzle:false} 时置位（房主出题上传 / 全员本地判定） */
  relay = false;
  /** 竞赛视图完全关闭（Leave / ✕）后的回调：用于恢复被隐藏的页面元素 */
  onClose?: () => void;
  /** 本回合是否已交卷（中继模式防重复提交） */
  private relayDone = false;

  private players: Record<string, { score: number; avatar?: string | null; nickname?: string | null }> = {};
  private ws: WebSocket | null = null;
  private ping: number | null = null;
  /* ── 断线重连（2026-10-25）──
     此前 ws.onclose 只清 ping 定时器、onerror 是空函数：手机切后台 / WiFi 闪断后
     WS 静默断开，界面毫无变化，玩家继续答题而 send() 在 readyState!==1 时静默丢弃
     ——所有动作石沉大海，对手端只看到对方"卡住"，直到有人退出才暴露。
     服务端其实早已支持重连（game-room.js handleConnect 按「同名 + 旧连接 readyState
     2/3」放行本人重连，连上后自动补发 room_info / round_resume），缺的只是客户端
     发起重连这一步。故本轮只改前端：断线后按退避重连 + 显式提示。 */
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  /** 用户主动离开（Leave / ✕）：不再重连 */
  private manualClose = false;
  /** 处于重连握手期：抑制 room_joined / room_info 的「弹回房间视图」 */
  private reconnecting = false;
  private raceMax = 99;
  private demoBots: number[] = [];
  private demoChatTimers: number[] = [];
  private doneList: RaceEntry[] = [];
  private mySubmitted = false;
  private chatMsgs: ChatMsg[] = [];

  constructor(adapter: MpAdapter, cb: MpCallbacks = {}) {
    this.adapter = adapter;
    this.cb = cb;
  }

  get demo(): boolean {
    return !isProdEnv();
  }

  get displayCap(): number {
    return this.demo ? 99 : this.maxPlayers;
  }

  setRoomSize(n: number): void { this.raceMax = n; this.adapter.raceMax = n; }
  setDifficulty(d: string): void { this.adapter.difficulty = d; }

  genRoomCode(): string {
    return genRoomCode();
  }

  /* ---- 注入 DOM ---- */
  mount(mountPoint?: HTMLElement): HTMLElement {
    if (this.root) return this.root;
    if (typeof document === 'undefined') throw new Error('mp-client requires DOM');
    const style = document.createElement('style');
    style.textContent = SHELL_CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'mp-root';
    root.innerHTML = `
      <div class="mp-wrap">
        <div class="mp-top">
          <span class="mp-logo">Numeri<b>Duel</b> · ${this.adapter.label}</span>
          <span class="mp-code" id="mpCode">—</span>
          <button class="mp-leave" id="mpLeave" data-i18n="mg.shared_leave">Leave</button>
        </div>
        <div class="mp-recon" id="mpRecon" data-show="0" data-fail="0"></div>
        <div class="mp-specbar" id="mpSpec">👀 Spectating</div>
        <div class="mp-grid">
          <div class="mp-card">
            <div class="mp-head">
              <svg class="mp-ring" viewBox="0 0 48 48"><circle class="bg" cx="24" cy="24" r="20"></circle><circle class="fg" id="mpRing" cx="24" cy="24" r="20"></circle></svg>
              <div>
                <div class="mp-banner" id="mpBanner"><b>Round 1</b> · get ready</div>
                <div class="mp-status" id="mpStatus" data-live="0">Waiting to start…</div>
              </div>
            </div>
            <div class="mp-board" id="mpBoard"></div>
          </div>
          <div>
            <div class="mp-card">
              <div class="mp-race-hd"><span>🏆 <span data-i18n="mg.g24_side_live_standings">Live Standings</span></span><span class="mp-race-count"><b id="mpDone">0</b>/<b id="mpTotal">0</b> <span data-i18n="mg.g24_side_solved_suffix">solved</span></span></div>
              <div class="mp-list" id="mpList"><div class="mp-empty" data-i18n="mg.mp_no_submissions">No submissions yet — be first!</div></div>
            </div>
            <div class="mp-chat" id="mpChat">
              <div class="hd"><b>💬 <span data-i18n="mg.shared_chat">Chat</span></b><span data-i18n="mg.mp_chat_only_here">only this room</span></div>
              <div class="log" id="mpChatLog"></div>
              <div class="rail">${['😂','🔥','😡','👍','💡','🎯'].map((e)=>`<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
              <div class="inrow"><input type="text" maxlength="200" data-i18n-placeholder="mg.sg_chat_placeholder" placeholder="${i18nT('mg.sg_chat_placeholder')}" id="mpChatInput"/><button type="button" id="mpChatSend" data-i18n="mg.shared_send">Send</button></div>
            </div>
          </div>
        </div>
      </div>`;
    (mountPoint || document.body).appendChild(root);
    this.root = root;

    this.lobbyEl = this.buildLobby();
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'mp-modal';
    this.modalEl.innerHTML = '<div class="box" id="mpModalBox"></div>';
    (mountPoint || document.body).appendChild(this.lobbyEl);
    (mountPoint || document.body).appendChild(this.modalEl);

    this.boardEl = root.querySelector('#mpBoard') as HTMLElement;

    root.querySelector('#mpLeave')!.addEventListener('click', () => this.close());
    this.wireChat();
    /* i18n 双保险：
       ① 立即主动扫一次 —— 字典若已就绪就当场替换，避开 i18n.js MutationObserver
          的 60ms 防抖窗口（否则玩家会看到一瞬裸 key）；
       ② 订阅 ready/change —— 覆盖「字典晚于 mount 到达」与「玩家中途切语言」。 */
    this.refreshI18n();
    onI18nChange(() => this.refreshI18n());
    this.cb.onMount?.(root);
    return root;
  }

  /**
   * 重放本地化文案。幂等，可反复调用（mount / 字典就绪 / 玩家切语言）。
   *
   * 分工：静态骨架（按钮、标题、placeholder）由 i18n.js 按 `data-i18n*`
   * 接管；本方法只负责它管不到的部分 —— 用 JS 写 `textContent` 的动态节点。
   * 若给这些节点也挂 `data-i18n`，每次 applyToDOM 都会把它们重置回静态文案
   * （例如计时进行中切语言，`#mpStatus` 会被冲回 "Waiting to start…"）。
   */
  private refreshI18n(): void {
    if (!this.root) return;
    try {
      (window as unknown as { i18n?: { applyToDOM?: (r?: ParentNode) => void } })
        .i18n?.applyToDOM?.(document);
    } catch { /* 旧版 i18n.js 没有该 API → 交给其 MutationObserver 兜底 */ }
    const st = this.root.querySelector('#mpStatus');
    if (st && st.getAttribute('data-live') !== '1') st.textContent = i18nT('mg.shared_waiting_to_start');
    this.renderSpecBar();
    this.renderProgress();
    const room = this.lobbyEl?.querySelector('#mpRoom');
    if (room && room.classList.contains('show')) this.renderRoomPlayers();
  }

  private buildLobby(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mp-lobby';
    /* 🔴 P1（2026-10-26）：这里原先全部用 i18nT() 拼 innerHTML。字典是 async fetch 的，
       而 mount() 常在 fetch 完成前就跑（?mode=battle 直接开弹窗），于是 i18nT() 一路
       fallback 到 key 本身 —— 玩家看到整屏 `mg.mp_create_room` / `MG.SHARED_YOUR_NAME`，
       且 innerHTML 已定型，i18n.js 之后只处理 data-i18n* 属性、不会回头修这些节点，
       于是永久残留。现在静态文案一律交给 data-i18n* 属性，由 i18n.js 在
       ready / change / MutationObserver 三条路径上统一替换，顺带支持中途切语言。 */
    const titleVars = escapeAttr(JSON.stringify({ label: this.adapter.label }));
    el.innerHTML = `
      <div class="box">
        <button class="mp-x" id="mpLobbyClose" type="button" data-i18n-aria-label="mg.shared_close" aria-label="${escapeHtml(i18nT('mg.shared_close'))}">✕</button>
        <h2 data-i18n="mg.mp_title_comp_html" data-i18n-vars='${titleVars}'>${escapeHtml(i18nT('mg.mp_title_comp_html', { label: this.adapter.label }))}</h2>
        <div class="hint" data-i18n="mg.mp_room_intro">${escapeHtml(i18nT('mg.mp_room_intro'))}</div>
        <div class="mp-field"><label data-i18n="mg.shared_your_name">${escapeHtml(i18nT('mg.shared_your_name'))}</label><input class="mp-input" id="mpName" maxlength="18" data-i18n-placeholder="mg.mp_ph_player" placeholder="${escapeHtml(i18nT('mg.mp_ph_player'))}"/></div>
        <div class="mp-sizes" id="mpSizes">
          <div class="mp-size" data-max="2">2</div>
          <div class="mp-size" data-max="10">10</div>
          <div class="mp-size" data-max="25">25</div>
          <div class="mp-size on" data-max="99">99</div>
        </div>
        <div class="mp-err" id="mpLobbyErr"></div>
        <div class="mp-form" id="mpForm">
          <div class="mp-actions">
            <button class="mp-btn primary" id="mpCreate" data-i18n="mg.mp_create_room">${escapeHtml(i18nT('mg.mp_create_room'))}</button>
            <button class="mp-btn" id="mpJoinToggle" data-i18n="mg.mp_join_with_code">${escapeHtml(i18nT('mg.mp_join_with_code'))}</button>
          </div>
          <div class="mp-field" id="mpJoinRow" style="display:none;margin-top:12px">
            <input class="mp-input" id="mpJoinCode" maxlength="${ROOM_CODE_LEN}" data-i18n-placeholder="mg.sg_room_code_label" placeholder="${i18nT('mg.sg_room_code_label')}"/>
            <button class="mp-btn primary" id="mpJoin" data-i18n="mg.shared_join_room">${escapeHtml(i18nT('mg.shared_join_room'))}</button>
          </div>
          <button class="mp-btn" id="mpRandom" style="width:100%;margin-top:12px" data-i18n="mg.sg_find_random">${i18nT('mg.sg_find_random')}</button>
        </div>
        <div class="mp-room" id="mpRoom">
          <div class="hint" data-i18n="mg.g24_room_share_lbl">Room ready — share this code:</div>
          <div class="code-big" id="mpRoomCode">—</div>
          <canvas class="mp-qr" id="mpQr" width="130" height="130"></canvas>
          <div class="mp-pwrap">
            <button class="mp-btn ghost" id="mpShare" data-i18n="mg.shared_copy_invite">🔗 Copy invite</button>
            <button class="mp-btn ghost" id="mpCopy" data-i18n="mg.mp_copy_code">⧉ Copy code</button>
          </div>
          <div class="mp-players" id="mpPlayers"></div>
          <button class="mp-btn primary" id="mpStart" disabled data-i18n="mg.mp_start_2plus">🚀 Start (2+ players)</button>
        </div>
      </div>`;
    const sizes = el.querySelector('#mpSizes')!;
    sizes.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('.mp-size');
      if (!b) return;
      sizes.querySelectorAll('.mp-size').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      this.setRoomSize(parseInt((b as HTMLElement).dataset.max || '99', 10));
    });
    el.querySelector('#mpCreate')!.addEventListener('click', () => {
      const name = (el.querySelector('#mpName') as HTMLInputElement).value.trim();
      if (!name) { this.lobbyErr('Enter a name'); return; }
      this.rememberName(name);
      this.lobbyErr('');
      this.createRoom(name);
    });
    el.querySelector('#mpJoinToggle')!.addEventListener('click', () => {
      const r = el.querySelector('#mpJoinRow') as HTMLElement;
      r.style.display = r.style.display === 'none' ? 'block' : 'none';
    });
    el.querySelector('#mpJoin')!.addEventListener('click', () => {
      const name = (el.querySelector('#mpName') as HTMLInputElement).value.trim();
      const code = normalizeRoomCode((el.querySelector('#mpJoinCode') as HTMLInputElement).value);
      if (!name) { this.lobbyErr('Enter a name'); return; }
      if (!isValidRoomCode(code)) { this.lobbyErr(`Invalid code (${ROOM_CODE_LEN} chars, no I/L/O/0/1)`); return; }
      this.rememberName(name);
      this.lobbyErr('');
      this.joinRoom(code, name);
    });
    el.querySelector('#mpRandom')!.addEventListener('click', () => this.startRandomMatch());
    el.querySelector('#mpStart')!.addEventListener('click', () => this.startRace());
    el.querySelector('#mpShare')!.addEventListener('click', () => this.copyInvite());
    el.querySelector('#mpCopy')!.addEventListener('click', () => this.copyCode());
    el.querySelector('#mpLobbyClose')!.addEventListener('click', () => this.close());
    return el;
  }

  private lobbyErr(m: string): void {
    const e = this.lobbyEl.querySelector('#mpLobbyErr');
    if (e) e.textContent = m;
    if (m) this.cb.onError?.(m);
  }

  private wireChat(): void {
    const root = this.root;
    root.querySelector('#mpChatSend')!.addEventListener('click', () => this.submitChatFromInput());
    root.querySelector('#mpChatInput')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); this.submitChatFromInput(); }
    });
    root.querySelectorAll('[data-emoji]').forEach((b) => {
      b.addEventListener('click', () => this.sendChat((b as HTMLElement).dataset.emoji || ''));
    });
  }

  private submitChatFromInput(): void {
    const i = this.root.querySelector('#mpChatInput') as HTMLInputElement;
    const t = i.value.trim();
    if (!t) return;
    this.sendChat(t);
    i.value = '';
  }

  /* ---- 公开：进入/退出竞赛视图 ---- */
  open(): void {
    this.mount();
    this.active = true;
    this.root.classList.add('show');
    this.openLobby();
  }

  close(): void {
    this.leave(true);
    this.lobbyEl.classList.remove('show');
    this.root.classList.remove('show');
    this.onClose?.();
  }

  openLobby(): void {
    this.lobbyEl.classList.add('show');
    // 视图状态复位：有进行中的房间 → 房间视图；否则回到「建/加入」表单
    const form = this.lobbyEl.querySelector('#mpForm') as HTMLElement | null;
    const room = this.lobbyEl.querySelector('#mpRoom') as HTMLElement | null;
    if (form && room) {
      if (this.room && this.active) { form.style.display = 'none'; room.classList.add('show'); }
      else { form.style.display = ''; room.classList.remove('show'); }
    }
    const ni = this.lobbyEl.querySelector('#mpName') as HTMLInputElement;
    if (this.myName) ni.value = this.myName;
    else {
      const s = localStorage.getItem('mp_name');
      if (s) ni.value = s;
      // 本机没存过（换设备、清了缓存）→ 去服务端账号要回来
      else void identity().then((I) => { if (I) I.fill(ni); });
    }
  }

  /** 记住这个名字：本机立刻能用到，服务端那边异步落盘。
      以前只有「随机匹配」这条路径记得住，建房和输房间码的人都得每次重填。 */
  private rememberName(name: string): void {
    this.myName = name;
    try { localStorage.setItem('mp_name', name); } catch { /* 隐私模式 */ }
    void identity().then((I) => { if (I) I.save(name); });
  }

  /* ===================== 随机匹配 ===================== */
  private matchId = '';
  private matchPoll: number | null = null;

  async startRandomMatch(): Promise<void> {
    if (this.demo) { this.lobbyErr('Random match needs the live site'); return; }
    const name = (this.lobbyEl.querySelector('#mpName') as HTMLInputElement).value.trim();
    if (!name) { this.lobbyErr('Enter a name'); return; }
    this.rememberName(name);
    this.lobbyErr('');
    const btn = this.lobbyEl.querySelector('#mpRandom') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = i18nT('mg.sg_finding'); }
    try {
      const r = await fetch('/api/match/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: this.adapter.gameType, name }),
      });
      const d = await r.json().catch(() => ({}));
      if (d && d.status === 'matched' && d.code) {
        this.isHost = false;
        this.connectWS(d.code);
        this.resetRandomBtn();
        return;
      }
      if (d && d.status === 'waiting' && d.matchId) {
        this.matchId = d.matchId;
        this.lobbyErr('🎲 Searching — this stays open for 30s…');
        this.pollRandomMatch();
        return;
      }
      this.lobbyErr('Match unavailable, try Create Room');
    } catch {
      this.lobbyErr('Connection failed, please retry');
    }
    this.resetRandomBtn();
  }

  private pollRandomMatch(): void {
    if (this.matchPoll) window.clearInterval(this.matchPoll);
    const startedAt = Date.now();
    this.matchPoll = window.setInterval(async () => {
      if (!this.matchId) { this.stopRandomMatch(false); return; }
      try {
        const r = await fetch('/api/match/poll?matchId=' + encodeURIComponent(this.matchId) + '&game=' + encodeURIComponent(this.adapter.gameType));
        const d = await r.json().catch(() => ({}));
        if (d && d.status === 'matched' && d.code) {
          this.stopRandomMatch(false);
          // 清除「Searching — this stays open for 30s…」残留：进房后该文案
          // 仍挂在 #mpLobbyErr 上，切回 lobby 视图时玩家会看到自相矛盾的提示
          // （2026-10-25 实测复现；超时分支本就覆盖文案，唯独成功分支漏了）。
          this.lobbyErr('');
          this.isHost = false;
          this.connectWS(d.code);
          return;
        }
      } catch { /* 网络抖动继续轮询 */ }
      if (Date.now() - startedAt > 30000) {
        this.stopRandomMatch(true);
        this.lobbyErr('No opponent right now — try Create Room');
        this.resetRandomBtn();
      }
    }, 2500);
  }

  private stopRandomMatch(cancel: boolean): void {
    if (this.matchPoll) { window.clearInterval(this.matchPoll); this.matchPoll = null; }
    if (cancel && this.matchId) {
      const id = this.matchId; const game = this.adapter.gameType;
      try { fetch('/api/match/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId: id, gameType: game }) }); } catch { /* ignore */ }
    }
    this.matchId = '';
  }

  private resetRandomBtn(): void {
    const btn = this.lobbyEl.querySelector('#mpRandom') as HTMLButtonElement | null;
    if (btn) { btn.disabled = false; btn.textContent = i18nT('mg.sg_find_random'); }
  }

  /* ===================== 建房 / 加入 ===================== */
  createRoom(name: string): void {
    if (this.demo) { this.demoCreateRoom(name); return; }
    const body: any = {
      gameType: this.adapter.gameType,
      name,
      mode: 'competition',
      maxPlayers: this.raceMax,
    };
    if (this.adapter.difficulty) body.difficulty = this.adapter.difficulty;
    if (this.adapter.rounds) body.rounds = this.adapter.rounds;
    if (this.adapter.timeLimit) body.timeLimit = this.adapter.timeLimit;
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => {
        if (!r.ok) { this.lobbyErr(`Room failed (HTTP ${r.status})`); throw new Error('http_' + r.status); }
        return r.json();
      })
      .then((d) => {
        if (!d || !d.code) { this.lobbyErr('Room failed (no code)'); return; }
        this.isHost = true;
        this.connectWS(d.code);
      })
      .catch((e) => { if (String(e?.message || '').indexOf('http_') !== 0) this.lobbyErr('Connection failed, please retry'); });
  }

  joinRoom(code: string, name: string): void {
    if (this.demo) { this.demoJoinRoom(code, name); return; }
    this.isHost = false;
    this.connectWS(code);
  }

  private connectWS(code?: string, isReconnect = false): void {
    if (code) this.room = code;
    if (!isReconnect) { this.manualClose = false; this.reconnecting = false; }   // 主动建房/加入 → 允许后续自动重连
    // 数学站改名（2026-09-30）：用 location.host 派生 WS URL,支持 numeriduel.com 与 mathduel.games 双域并存
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProto}//${location.host}/ws?code=${encodeURIComponent(this.room)}&name=${encodeURIComponent(this.myName)}`;
    try { this.ws = new WebSocket(url); }
    catch {
      if (isReconnect) this.scheduleReconnect();
      else this.lobbyErr('Cannot reach server');
      return;
    }
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setReconnectUI(false);
      /* 兜底：若服务端因房已清等原因没回 room_info，reconnecting 会一直挂着，
         之后所有 showRoomView() 都会被误抑制。5s 后无条件解除。 */
      if (isReconnect) window.setTimeout(() => { this.reconnecting = false; }, 5000);
      /* 重连时不走 onRoomReady()：它会再次 showRoomView()，把正在进行的对局
         弹回「房间码 + 二维码」视图。服务端在连接建立后本就会补发 room_info /
         round_resume，客户端已有对应处理，无需前端再动。 */
      if (!isReconnect) this.onRoomReady(this.room);
      this.send({ type: 'get_info' });
      if (this.ping) window.clearInterval(this.ping);
      this.ping = window.setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    this.ws.onmessage = (ev) => {
      let d: any; try { d = JSON.parse(ev.data as string); } catch { return; }
      if (d && d.type === 'pong') return;
      this.handleMsg(d);
    };
    this.ws.onclose = () => {
      if (this.ping) { window.clearInterval(this.ping); this.ping = null; }
      if (isReconnect) this.reconnectAttempts++;   // 连上又断：下次退避更久
      if (!this.manualClose && this.room && !this.demo) this.scheduleReconnect();
    };
    // 不空吞：error 后浏览器必定再触发 close，重连统一在 onclose 里调度，这里只留取证线索
    this.ws.onerror = () => { console.warn('[mp] ws error, room=' + this.room); };
  }

  /** 断线重连调度：退避 1s→2s→4s→8s（上限 5 次）。demo 模式与主动离开不重连。 */
  private scheduleReconnect(): void {
    if (this.manualClose || !this.room || this.demo) return;
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MP_RECONNECT_MAX) {
      this.setReconnectUI(true, true);   // 放弃重连：明确告知，让玩家自己决定退出
      return;
    }
    const delay = 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 3));
    this.reconnecting = true;
    this.setReconnectUI(true, false, delay);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWS(this.room, true);
    }, delay);
  }

  /** 重连提示条。failed=true 表示已放弃，提示玩家自行退出。 */
  private setReconnectUI(show: boolean, failed = false, delayMs = 0): void {
    const el = this.root && this.root.querySelector('#mpRecon') as HTMLElement | null;
    if (!el) return;
    if (!show) {
      el.dataset.show = '0';
      el.dataset.fail = '0';
      el.textContent = '';
      return;
    }
    el.dataset.show = '1';
    el.dataset.fail = failed ? '1' : '0';
    el.textContent = failed
      ? i18nT('mg.mp_reconnect_failed')
      : i18nT('mg.mp_reconnecting', { n: Math.max(1, Math.round(delayMs / 1000)) });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  /** adapter 用来发送任意答题动作 */
  sendAction(obj: unknown): void { this.send(obj); }

  private absorbPlayers(arr: any): Record<string, { score: number; avatar?: string | null; nickname?: string | null }> {
    const out: Record<string, { score: number; avatar?: string | null; nickname?: string | null }> = {};
    if (Array.isArray(arr)) arr.forEach((p: any) => {
      const n = typeof p === 'string' ? p : p && p.name;
      if (!n) return;
      out[n] = { score: (p && p.score) || 0, avatar: (p && p.avatar) || null, nickname: (p && p.nickname) || null };
    });
    return out;
  }

  private onRoomReady(code: string): void {
    this.room = code;
    /* 老师端课堂作业（链接带 tid=1）：入房后一次性绑定班级代号。
       不在课堂上（普通好友对战）不会触发，保证教室外零打扰。 */
    if (isClassroom()) ensureStudentCode(code).catch(() => { /* 跳过归因不影响游戏 */ });
    // 保持 lobby 弹窗打开：showRoomView() 会在弹窗内部把表单换成「房间码 + 二维码」视图
    // （此前在这里 remove('show') 会把整层弹窗关掉，用户永远看不到房间码 —— P0 修复）
    this.cb.onRoomReady?.(code);
    this.showRoomView();
  }

  /* ===================== 消息分发 ===================== */
  private handleMsg(d: any): void {
    switch (d.type) {
      case 'room_created':
      case 'room_joined':
        this.room = d.code;
        this.players = {};
        /* P0（2026-10-06）：进房是唯一对所有游戏类型都必经的信号 ——
           relay 只在收到 new_round{hasPuzzle:false} / puzzle 时置 true，而 sudoku/eqpyr
           的 DO 房从不开 new_round。故在这里复位，保证换房后一定是 DO 模式。
           （leave() 里也复位了一处，覆盖不开新房的「离开」路径。） */
        this.relay = false;
        this.relayDone = false;
        if (d.players) d.players.forEach((n: string) => (this.players[n] = { score: 0 }));
        this.players[this.myName] = { score: 0 };
        /* 重连握手期：服务端照常发 room_joined，但走 onRoomReady() → showRoomView()
           会把正在进行中的对局弹回「房间码 + 二维码」视图。重连只更新数据，
           界面交给随后的 round_resume 恢复。 */
        if (!this.reconnecting) this.onRoomReady(this.room);
        this.cb.onPlayersChanged?.(this.players, this.isHost, this.room);
        break;
      case 'player_joined':
      case 'room_info':
      case 'race_lobby':
        if (d.maxPlayers) this.maxPlayers = d.maxPlayers;
        if (d.players) this.players = this.absorbPlayers(d.players);
        if (typeof d.spectatorCount === 'number') { this.spectatorCount = d.spectatorCount; this.cb.onSpectator?.({ count: this.spectatorCount }); }
        this.isHost = this.isHost || d.hostName === this.myName;
        this.cb.onPlayersChanged?.(this.players, this.isHost, this.room);
        /* 同上：重连握手期不弹房间视图，并在此收尾复位（服务端连发
           room_joined → room_info，之后的 round_resume 才是恢复对局的信号）。 */
        if (this.reconnecting) this.reconnecting = false;
        else this.showRoomView();
        break;
      case 'spectator_joined':
        this.spectator = true;
        if (d.room && d.room.players) this.players = this.absorbPlayers(d.room.players);
        if (typeof d.room?.spectatorCount === 'number') this.spectatorCount = d.room.spectatorCount;
        this.cb.onSpectator?.({ count: this.spectatorCount });
        this.cb.onSelfSpectator?.();
        this.renderSpecBar();
        break;
      case 'round_progress':
        this.done = d.doneCount || 0;
        if (d.total) this.total = d.total;
        this.cb.onProgress?.({ doneCount: this.done, total: this.total, done: d.done || [], self: d.self });
        this.renderProgress();
        break;
      case 'round_result':
        this.done = (d.ranking || []).length;
        this.cb.onProgress?.({ doneCount: this.done, total: this.total, done: d.ranking || [] });
        this.cb.onRoundResult?.({ round: d.round || this.round, ranking: d.ranking || [] });
        this.showRoundResult(d);
        this.reportClassroomRound(d);
        break;
      case 'round_timeout':
        this.cb.onRoundResult?.({ round: d.round || this.round, ranking: d.ranking || [] });
        this.showRoundResult(d);
        this.reportClassroomRound(d);
        break;
      case 'game_over':
      case 'race_over':
        this.active = false;
        this.cb.onGameOver?.({ ranking: d.ranking || [], elo: Array.isArray(d.elo) ? d.elo : undefined });
        this.showGameOver(d);
        break;
      case 'chat': {
        const text = typeof d.text === 'string' ? d.text : '';
        if (!text) break;
        const m: ChatMsg = { name: d.name || 'Player', text, ts: d.ts || Date.now(), self: d.name === this.myName };
        this.pushChat(m);
        break;
      }
      case 'player_left':
        this.total = Math.max(0, (this.total || 1) - 1);
        this.cb.onProgress?.({ doneCount: this.done, total: this.total, done: [] });
        break;
      case 'timer':
        this.cb.onTimer?.(d.timeLeft);
        this.updateTimer(d.timeLeft);
        break;
      case 'error':
        this.lobbyErr(d.msg || 'Error');
        break;
      default:
        // 回合/计分类消息交给 adapter
        if (this.adapter.onMessage(d, this)) return;
        // adapter 没消费：当作题目开始类（new_round / round_resume / sudoku_new_game / eqpyr_new_game / bulls_*）
        this.handleRoundMsg(d);
    }
  }

  /** 老师端学情回写：competition 的 round_result.ranking 每行 = 一个玩家的 {name,time,ok}，
      服务端权威判定已在其中（超时未交卷也会以 ok:false 出现在榜尾），直接取「我自己」那行上报，
      不必再依赖引擎侧数据，也不会出现客户端虚报成绩。 */
  private reportClassroomRound(d: any): void {
    if (!isClassroom() || !this.room) return;
    const self = (d.ranking || []).find((r: any) => r && r.name === this.myName);
    reportRound(this.room, {
      round: d.round || this.round || 1,
      solved: !!(self && self.ok),
      duration_ms: Number.isFinite(self && self.time) ? Math.round(self.time) : 0,
      wrong: self && self.ok === false ? 1 : 0,
      ops: [],
    });
  }

  /** 通用回合开始处理（adapter 未显式消费时兜底） */
  private handleRoundMsg(d: any): void {
    const isRoundStart = ['new_round', 'round_resume', 'sudoku_new_game', 'eqpyr_new_game', 'bulls_new_round', 'np_new_game'].includes(d.type);
    if (!isRoundStart) return;
    // 回合开始 → 收起 lobby 弹窗，露出牌桌
    this.lobbyEl.classList.remove('show');
    this.active = true;
    this.started = true;
    this.round = d.round || 1;
    this.maxRounds = d.maxRounds || 5;
    this.timeLimit = d.timeLimit || 30;
    if (d.players) this.players = this.absorbPlayers(d.players);
    /* SV 中继模式：new_round{hasPuzzle:false} 等房主出题；puzzle{...} 由服务端广播已出的题目
       两路必须分别处理：① 房主出题 → set_puzzle 上报；② 全员收到 puzzle → renderRound */
    if (d.type === 'new_round' && d.hasPuzzle === false) {
      this.relay = true;
      this.relayDone = false;
      const ctx: RoundCtx = { round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: d.players || [], isHost: this.isHost };
      this.cbRound = ctx;
      this.cb.onRoundStart?.(ctx);
      // 房主出题 → 上报服务端；非房主 → 占位等 puzzle 消息
      if (this.isHost) this.sendHostPuzzle();
      else this.adapter.renderRound({ waiting: true } as any, ctx, this.boardEl, this);
      this.renderProgress();
      this.renderSpecBar();
      return;
    }
    if (d.type === 'new_round') {
      // DO 服务端推的题（如 24 点 cards 自带、bulls 自带）—— 走原逻辑
      this.relay = false;
    }
    if (d.type === 'puzzle') {
      this.relay = true;
      const ctx: RoundCtx = { round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: d.players || [], isHost: this.isHost };
      this.cbRound = ctx;
      this.cb.onRoundStart?.(ctx);
      this.adapter.renderRound(this.extractPayload(d), ctx, this.boardEl, this);
      this.renderProgress();
      this.renderSpecBar();
      return;
    }
    const ctx: RoundCtx = { round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: d.players || [], isHost: this.isHost };
    this.cbRound = ctx;
    this.cb.onRoundStart?.(ctx);
    this.adapter.renderRound(this.extractPayload(d), ctx, this.boardEl, this);
    this.renderProgress();
    this.renderSpecBar();
  }

  /** 房主本地出题 → 上报 set_puzzle（仅 relay 模式）
   * 重要：上报前剥除 _solution（仅房主本地保留）；服务端收到的 payload 不会泄漏答案 */
  private sendHostPuzzle(): void {
    const fn = this.adapter.makeRacePuzzle;
    if (!fn) {
      this.lobbyErr('该游戏暂未实现 SV 出题（缺少 makeRacePuzzle）');
      return;
    }
    try {
      const full = fn(this.round);
      const safe = (full && typeof full === 'object') ? { ...full } : full;
      // 房主自己持有的答案字段：
      if (safe && typeof safe === 'object') delete safe._solution;
      // 但房主本地仍要拿 solution 渲染校验：发完再渲染自己
      this.send({ type: 'set_puzzle', payload: safe });
      // 房主：自行渲染（含 solution）
      if (full && typeof full === 'object') {
        const ctx: RoundCtx = { round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: this.getPlayerList(), isHost: true };
        this.cbRound = ctx;
        this.cb.onRoundStart?.(ctx);
        this.adapter.renderRound(full, ctx, this.boardEl, this);
      }
    } catch (e: any) {
      this.lobbyErr('出题失败: ' + (e?.message || 'unknown'));
    }
  }

  private getPlayerList(): any[] {
    return Object.keys(this.players).map((n) => ({ name: n, score: this.players[n].score }));
  }

  /** relay 模式本地完成判定（adapter 调用）→ 立即 send submit_answer */
  relaySubmit(): void {
    if (!this.relay || this.relayDone) return;
    this.relayDone = true;
    this.send({ type: 'submit_answer', result: true });
  }

  /** 从回合消息抽出给 adapter 的 payload（不同游戏字段不同，整包交给 adapter 即可） */
  extractPayload(d: any): any { return d; }

  /* ===================== 进度 / 计时 ===================== */
  renderProgress(): void {
    const dn = this.root.querySelector('#mpDone'); const tt = this.root.querySelector('#mpTotal');
    if (dn) dn.textContent = String(this.done);
    if (tt) tt.textContent = String(this.total);
    const list = this.root.querySelector('#mpList'); if (!list) return;
    const rows = (this.cbRound ? [] : []);
    void rows;
    if (!this.doneList.length) { list.innerHTML = `<div class="mp-empty" data-i18n="mg.mp_no_submissions">${escapeHtml(i18nT('mg.mp_no_submissions'))}</div>`; return; }
    list.innerHTML = this.doneList.slice(0, 10).map((r, i) => {
      const cls = (i === 0 ? 'r1' : '') + (r.name === this.myName ? ' me' : '');
      return `<div class="mp-row ${cls}"><span class="mp-rank">${i + 1}</span><span class="mp-av">🙂</span><span class="mp-name">${escapeHtml(r.name || '')}</span><span class="mp-time">${r.time != null ? fmtTime(r.time) : '✓'}</span></div>`;
    }).join('');
  }

  private updateTimer(left: number): void {
    const secs = Math.max(0, Math.ceil(left));
    const frac = this.timeLimit > 0 ? Math.max(0, Math.min(1, left / this.timeLimit)) : 0;
    const ring = this.root.querySelector('#mpRing') as SVGCircleElement | null;
    if (ring) {
      const C = 2 * Math.PI * 20;
      ring.setAttribute('stroke-dasharray', String(C));
      ring.setAttribute('stroke-dashoffset', String(C * (1 - frac)));
    }
    const st = this.root.querySelector('#mpStatus');
    if (st) {
      st.textContent = this.spectator
        ? i18nT('mg.mp_spectating_now')
        : i18nT('mg.mp_round_timer', { n: secs });
      st.setAttribute('data-live', '1');
    }
  }

  renderSpecBar(): void {
    const el = this.root.querySelector('#mpSpec');
    if (!el) return;
    el.classList.toggle('show', this.spectator);
    el.innerHTML = this.spectator
      ? i18nT('mg.mp_spectating_bar_html')
        + (this.spectatorCount > 1 ? i18nT('mg.mp_watchers', { n: this.spectatorCount }) : '')
      : '';
  }

  /* ===================== 房间视图 ===================== */
  private showRoomView(): void {
    const room = this.lobbyEl.querySelector('#mpRoom') as HTMLElement;
    const form = this.lobbyEl.querySelector('#mpForm') as HTMLElement;
    form.style.display = 'none';
    room.classList.add('show');
    (this.lobbyEl.querySelector('#mpRoomCode') as HTMLElement).textContent = this.room;
    /* P2（2026-10-26）：对局视图左上角的 #mpCode 此前**从未被赋值**，玩家进了对局
       就再也看不到房码（想再拉一个人只能退出重来）。这里随房间视图一起写入，
       建房 / 加入 / 邀请链接 / demo 路径都会经过本方法。 */
    const badge = this.root.querySelector('#mpCode');
    if (badge && this.room) badge.textContent = this.room;
    this.renderRoomPlayers();
    this.renderQR();
  }

  private renderRoomPlayers(): void {
    const list = this.lobbyEl.querySelector('#mpPlayers') as HTMLElement;
    if (!list) return;
    const names = Object.keys(this.players);
    list.innerHTML = names.map((name) => {
      const me = name === this.myName;
      return `<div class="mp-rp${me ? ' me' : ''}"><span class="mp-av">🙂</span><span>${escapeHtml(name)}</span>${this.isHost && me ? `<span class="host">${escapeHtml(i18nT('mg.mp_you_host'))}</span>` : ''}</div>`;
    }).join('');
    const sb = this.lobbyEl.querySelector('#mpStart') as HTMLButtonElement;
    const n = names.length;
    sb.disabled = !(this.isHost && n >= 2);
    sb.textContent = i18nT(n < 2 ? 'mg.mp_start_2plus' : 'mg.shared_start_competition');
  }

  private renderQR(): void {
    const cv = this.lobbyEl.querySelector('#mpQr') as HTMLCanvasElement;
    if (!cv) return;
    try {
      const url = this.inviteUrl();
      const g = window as any;
      if (typeof g.qrcode === 'function') {
        // 真·可扫描二维码（与 24 点同款 qrcode.min.js）
        const qr = g.qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        const mm = qr.getModuleCount();
        const ctx = cv.getContext('2d');
        if (ctx) {
          const cell = Math.max(2, Math.floor(cv.width / mm));
          const off = Math.floor((cv.width - cell * mm) / 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.fillStyle = '#111827';
          for (let r = 0; r < mm; r++) {
            for (let c = 0; c < mm; c++) {
              if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
            }
          }
          return;
        }
      }
      drawQrFallback(cv, url);
    } catch { /* 二维码失败不影响主流程 */ }
  }

  inviteUrl(): string { return location.origin + location.pathname + '?room=' + encodeURIComponent(this.room || ''); }

  private copyInvite(): void {
    const url = this.inviteUrl();
    try { navigator.clipboard.writeText(url); this.toast(i18nT('mg.sg_invite_copied')); } catch { this.toast(url); }
  }
  private copyCode(): void {
    try { navigator.clipboard.writeText(this.room); this.toast(i18nT('mg.sg_room_copied') + ' ' + this.room); } catch { this.toast(this.room); }
  }

  toast(m: string): void { this.cb.onError?.('ℹ️ ' + m); }

  /* ===================== 答题 / 提交 ===================== */
  /** adapter 在本地玩家完成一轮时调用（DEMO 用；真实环境由服务端结算） */
  markSolved(detail?: any): void {
    if (this.demo) this.demoSubmit(detail);
    // 真实环境：adapter 直接 sendAction 给服务端，无需此处处理
  }

  startRace(): void {
    if (this.spectator) return;
    if (this.demo) this.demoStartRace();
    else this.send({ type: 'start_race' });
  }

  sendChat(text: string): void {
    const t = String(text || '').slice(0, 200).trim();
    if (!t) return;
    if (this.demo) { this.pushChat({ name: this.myName || 'You', text: t, ts: Date.now(), self: true }); return; }
    this.send({ type: 'chat', text: t });
  }

  get canChat(): boolean { return !!this.room; }

  private pushChat(m: ChatMsg): void {
    this.chatMsgs.push(m);
    if (this.chatMsgs.length > 60) this.chatMsgs = this.chatMsgs.slice(-60);
    const log = this.root.querySelector('#mpChatLog');
    if (log) {
      const b = document.createElement('div');
      b.className = 'mp-bub ' + (m.self ? 'me' : 'opp');
      b.innerHTML = `<span class="who">${escapeHtml(m.self ? 'You' : m.name)}</span>${escapeHtml(m.text)}`;
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
    }
  }

  leave(silent = false): void {
    this.active = false; this.started = false; this.waiting = false; this.spectator = false; this.spectatorCount = 0;
    /* P0（2026-10-06）：relay / relayDone 此前**只在**收到 new_round 时复位，
       而 DO 的 sudoku/eqpyr 用 sudoku_new_game / eqpyr_new_game 开局，从不发 new_round。
       于是玩完一局 relay 后 relay=true、relayDone=true 会一直粘着：再进任何 CF DO
       的 sudoku/eqpyr 房，适配器走 shell.relay 分支、**永远不发 sudoku_place**，
       且 relaySubmit() 因 relayDone 直接 early-return —— 棋盘完全死掉且无任何报错。
       这是一次房间切换就让游戏彻底不可玩，故与其它状态一起在此复位。 */
    this.relay = false;
    this.relayDone = false;
    this.stopRandomMatch(true);
    this.resetRandomBtn();
    if (this.ping) { window.clearInterval(this.ping); this.ping = null; }
    /* 主动离开：取消待执行的重连并复位计数，避免"退出后又被自动拉回房间" */
    this.manualClose = true;
    this.reconnecting = false;
    if (this.reconnectTimer) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.reconnectAttempts = 0;
    this.setReconnectUI(false);
    this.demoBots.forEach((id) => window.clearTimeout(id)); this.demoBots = [];
    this.demoChatTimers.forEach((id) => window.clearTimeout(id)); this.demoChatTimers = [];
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.modalEl.classList.remove('show');
    if (!silent) this.room = '';
  }

  /* ===================== DEMO ===================== */
  private demoNames(total: number): string[] {
    const names: string[] = [];
    for (let i = 1; i < total; i++) {
      const base = BOT_NAMES[(i - 1) % BOT_NAMES.length];
      names.push(i >= BOT_NAMES.length ? `${base}·${Math.floor(i / BOT_NAMES.length) + 1}` : base);
    }
    return names;
  }
  private demoFill(name: string): void {
    this.myName = name;
    this.players = { [name]: { score: 0 } };
    const total = Math.min(this.raceMax, 99);
    this.total = total;
    for (const n of this.demoNames(total)) this.players[n] = { score: 0 };
  }
  private demoCreateRoom(name: string): void { this.room = this.genRoomCode(); this.isHost = true; this.demoFill(name); this.onRoomReady(this.room); this.cb.onPlayersChanged?.(this.players, true, this.room); }
  private demoJoinRoom(code: string, name: string): void { this.room = code; this.isHost = false; this.demoFill(name); this.onRoomReady(this.room); this.cb.onPlayersChanged?.(this.players, false, this.room); }

  private demoStartRace(): void {
    this.lobbyEl.classList.remove('show');
    this.started = true; this.active = true; this.round = 1; this.maxRounds = 5; this.timeLimit = 30;
    this.doneList = []; this.done = 0; this.mySubmitted = false;
    const ctx: RoundCtx = { round: 1, maxRounds: 5, timeLimit: 30, players: [], isHost: this.isHost };
    this.cbRound = ctx;
    this.cb.onRoundStart?.(ctx);
    this.adapter.renderRound(this.adapter.makeDemoPuzzle(1), ctx, this.boardEl, this);
    this.renderProgress();
    this.scheduleBots();
    this.scheduleDemoChat();
  }

  private scheduleDemoChat(): void {
    this.demoChatTimers.forEach((id) => window.clearTimeout(id)); this.demoChatTimers = [];
    const others = Object.keys(this.players).filter((n) => n !== this.myName);
    for (let i = 0; i < 3; i++) {
      const id = window.setTimeout(() => {
        if (!this.active) return;
        const who = others[Math.floor(Math.random() * others.length)];
        const line = DEMO_CHAT[Math.floor(Math.random() * DEMO_CHAT.length)];
        this.pushChat({ name: who || 'Rival', text: line, ts: Date.now(), self: false });
      }, 4000 + i * 5200 + Math.random() * 2500);
      this.demoChatTimers.push(id);
    }
  }

  private scheduleBots(): void {
    this.demoBots.forEach((id) => window.clearTimeout(id)); this.demoBots = [];
    Object.keys(this.players).filter((n) => n !== this.myName).forEach((n) => {
      const t = 3000 + Math.random() * 20000;
      const id = window.setTimeout(() => {
        if (!this.active) return;
        this.done++;
        this.doneList.push({ name: n, time: Math.round(t) + Math.floor(Math.random() * 900), ok: true });
        this.doneList.sort((a, b) => (a.time || 0) - (b.time || 0));
        this.renderProgress();
      }, t);
      this.demoBots.push(id);
    });
  }

  private demoSubmit(_detail?: any): void {
    if (this.mySubmitted) return;
    this.mySubmitted = true;
    this.done++;
    this.doneList.push({ name: this.myName, time: Math.round(this.myTime * 1000), ok: true });
    this.doneList.sort((a, b) => (a.time || 0) - (b.time || 0));
    this.renderProgress();
    window.setTimeout(() => {
      if (!this.active) return;
      const ranking = this.buildRanking(false);
      this.cb.onRoundResult?.({ round: this.round, ranking });
      this.round++;
      if (this.round > this.maxRounds) {
        window.setTimeout(() => this.cb.onGameOver?.({ ranking: this.buildRanking(true) }), 2300);
      } else {
        window.setTimeout(() => {
          if (!this.active) return;
          this.waiting = false; this.doneList = []; this.done = 0; this.mySubmitted = false;
          const ctx: RoundCtx = { round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: [], isHost: this.isHost };
          this.cbRound = ctx;
          this.cb.onRoundStart?.(ctx);
          this.adapter.renderRound(this.adapter.makeDemoPuzzle(this.round), ctx, this.boardEl, this);
          this.renderProgress();
          this.scheduleBots();
        }, 2400);
      }
    }, 1600);
  }

  private buildRanking(final: boolean): RaceEntry[] {
    const ranking: RaceEntry[] = this.doneList.map((r, i) => ({ name: r.name, time: r.time, ok: r.ok, rank: i + 1, solved: r.ok ? 1 : 0 }));
    if (final) {
      const done = new Set(this.doneList.map((r) => r.name));
      Object.keys(this.players).filter((n) => !done.has(n)).forEach((n) => ranking.push({ name: n, time: this.timeLimit * 1000 + 999, ok: false, rank: ranking.length + 1, solved: 0 }));
    }
    return ranking;
  }

  /* ===================== 结算弹窗 ===================== */
  private showRoundResult(d: any): void {
    const rk: RaceEntry[] = d.ranking || [];
    let html = `<h2 style="font-size:20px">🏁 Round ${d.round || this.round} Result</h2>`;
    html += '<div class="mp-list" style="max-height:34vh">';
    for (let i = 0; i < rk.length && i < 8; i++) {
      const r = rk[i] || {};
      html += `<div class="mp-row${(i === 0 ? ' r1' : '') + (r.name === this.myName ? ' me' : '')}"><span class="mp-rank">${i + 1}</span><span class="mp-av">🙂</span><span class="mp-name">${escapeHtml(r.name || '')}</span><span class="mp-time">${r.ok ? fmtTime(r.time || 0) : '—'}</span></div>`;
    }
    html += '</div><p class="sub">Next round starting…</p>';
    const box = this.modalEl.querySelector('#mpModalBox') as HTMLElement;
    box.innerHTML = html;
    this.modalEl.classList.add('show');
    window.setTimeout(() => { if (this.active) this.modalEl.classList.remove('show'); }, 2200);
  }

  private showGameOver(d: any): void {
    this.active = false;
    const rk: RaceEntry[] = d.ranking || [];
    let me: RaceEntry | null = null;
    for (const r of rk) if (r.name === this.myName) me = r;
    const heading = me
      ? me.rank === 1
        ? i18nT('mg.mp_you_won_short')
        : i18nT('mg.g24_rank_you', { rank: me.rank ?? 0 })
      : i18nT('mg.g24_comp_over');
    let html = `<h2 class="${me && me.rank === 1 ? '' : me ? 'draw-c' : 'lose-c'}">${escapeHtml(heading)}</h2>`;
    html += `<p class="sub">${escapeHtml(
      i18nT('mg.g24_cap_players', { n: rk.length, cap: this.displayCap }),
    )}</p>`;
    if (Array.isArray(d.elo) && d.elo.length) html += this.eloBlockHtml(d.elo);
    html += '<div class="mp-list">';
    for (let i = 0; i < rk.length; i++) {
      const r = rk[i] || {};
      const rank = r.rank || i + 1;
      html += `<div class="mp-row${(i === 0 ? ' r1' : '') + (r.name === this.myName ? ' me' : '')}"><span class="mp-rank">#${rank}</span><span class="mp-av">🙂</span><span class="mp-name">${escapeHtml(r.name || '')}</span><span class="mp-time">${r.solved != null ? r.solved + ' solved' : ''}</span></div>`;
    }
    html += '</div>';
    html += '<div class="row"><button class="mp-btn primary" id="mpAgain">🔁 Play Again</button><button class="mp-btn ghost" id="mpHome">Back</button></div>';
    const box = this.modalEl.querySelector('#mpModalBox') as HTMLElement;
    box.innerHTML = html;
    this.modalEl.classList.add('show');
    box.querySelector('#mpAgain')!.addEventListener('click', () => { this.modalEl.classList.remove('show'); this.openLobby(); });
    box.querySelector('#mpHome')!.addEventListener('click', () => { this.modalEl.classList.remove('show'); this.close(); });
  }

  private eloBlockHtml(elo: EloEntry[]): string {
    if (!elo || !elo.length) return '';
    // 无有效评级（未登录 uuid / AI / skipped）的条目会渲染成 "null 0"——整块隐藏
    const rated = elo.filter((e) => typeof e.elo === 'number');
    if (!rated.length) return '';
    const rows = rated.slice(0, 10).map((e) => {
      const cls = e.delta > 0 ? 'up' : e.delta < 0 ? 'down' : 'flat';
      const dtxt = (e.delta > 0 ? '+' : '') + e.delta;
      const avg = typeof e.elo === 'number' ? Math.round(e.elo - e.delta) : null;
      const eloTxt = avg != null ? `<span class="v">${avg} → ${e.elo}</span>` : `<span class="v">${e.elo}</span>`;
      return `<div class="mp-elo-row${e.name === this.myName ? ' me' : ''}"><span class="mp-av">🙂</span><span>${escapeHtml(e.nickname || e.name)}</span>${eloTxt}<span class="d ${cls}">${dtxt}</span></div>`;
    }).join('');
    return `<p class="sub" style="margin:12px 0 6px">⚔️ Elo — rated match</p><div class="mp-elo-grid">${rows}</div>`;
  }
}

/* ===================== 工具 ===================== */
export function escapeHtml(s: unknown): string {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/**
 * 属性值转义 —— escapeHtml() 走 textContent→innerHTML，**不转义单引号**
 * （不在属性上下文时需要），而 `data-i18n-vars='{"label":"…"}'` 是用单引号
 * 包裹整段 JSON 的属性，label 里一旦出现 `'`（如某个游戏名带撇号）就会
 * 提前截断属性。这里统一把 5 个字符都转掉；浏览器 getAttribute 会自动解码回来，
 * JSON.parse 拿到的仍是原始字符串。
 */
function escapeAttr(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

function fmtTime(ms: number): string {
  const s = (Number(ms) || 0) / 1000;
  return s >= 60 ? Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60).toFixed(1) : s.toFixed(1) + 's';
}

/** 极简二维码回退（不依赖外部库）：把 URL 画成可扫的二维码需要真正编码，
 *  这里用确定性点阵占位，仅作视觉提示；真实部署建议替换为 qrcode 库。 */
function drawQrFallback(cv: HTMLCanvasElement, _url: string): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const N = 25, cell = cv.width / N;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#0a0e14';
  let seed = 0; for (let i = 0; i < _url.length; i++) seed = (seed * 31 + _url.charCodeAt(i)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (rnd() > 0.55) ctx.fillRect(x * cell, y * cell, cell, cell);
  }
  // 三个定位角
  const eye = (ex: number, ey: number) => { ctx.fillStyle = '#0a0e14'; ctx.fillRect(ex * cell, ey * cell, 7 * cell, 7 * cell); ctx.fillStyle = '#fff'; ctx.fillRect((ex + 1) * cell, (ey + 1) * cell, 5 * cell, 5 * cell); ctx.fillStyle = '#0a0e14'; ctx.fillRect((ex + 2) * cell, (ey + 2) * cell, 3 * cell, 3 * cell); };
  eye(0, 0); eye(N - 7, 0); eye(0, N - 7);
}

/**
 * 把竞赛接入某个游戏页：注入「Competition」标签、深链 ?mode=battle（&room=）、
 * 并提供 open()/close()。在 index.ts 中调用。
 */
export interface MountConfig {
  adapter: MpAdapter;
  tabsEl?: HTMLElement | null;
  tabLabel?: string;
  /** 🔴 i18n（2026-10-27）：tab 文案的 i18n 键。优先于 tabLabel；
   *  字典就绪/切语言时自动重设（tab.textContent 是一次写入，
   *  顶层传 i18nT(tabLabel) 会在字典未就绪时固化裸 key，永不修复）。 */
  tabLabelKey?: string;
  mountPoint?: HTMLElement;
  callbacks?: MpCallbacks;
  /** 进入竞赛视图时要隐藏的页面元素（如游戏自带 playView），传选择器数组 */
  hideOnOpen?: string[];
}
export function mountCompetition(cfg: MountConfig): MpShell {
  const shell = new MpShell(cfg.adapter, cfg.callbacks || {});
  shell.mount(cfg.mountPoint);

  // 记录被隐藏的页面元素，关闭竞赛视图时恢复原样
  const hiddenEls: HTMLElement[] = [];
  const hidePage = () => {
    cfg.hideOnOpen?.forEach((sel) => document.querySelectorAll(sel).forEach((e) => {
      const el = e as HTMLElement;
      if (!hiddenEls.includes(el)) {
        (el as any).__mpPrevDisplay = el.style.display;
        el.style.display = 'none';
        hiddenEls.push(el);
      }
    }));
  };
  const restorePage = () => {
    hiddenEls.forEach((el) => { el.style.display = (el as any).__mpPrevDisplay ?? ''; });
    hiddenEls.length = 0;
  };
  shell.onClose = restorePage;

  const tabLabel = cfg.tabLabel || 'Competition';
  const tabMode = 'battle';
  if (cfg.tabsEl) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.mode = tabMode;
    const applyTabLabel = (): void => { tab.textContent = cfg.tabLabelKey ? i18nT(cfg.tabLabelKey) : tabLabel; };
    applyTabLabel();
    if (cfg.tabLabelKey) onI18nChange(applyTabLabel);
    tab.addEventListener('click', () => {
      hidePage();
      shell.open();
    });
    cfg.tabsEl.appendChild(tab);
  }

  // 深链 ?mode=battle / ?room=
  const params = new URLSearchParams(location.search);
  const rc = (params.get('room') || '').trim().toUpperCase();
  const startMode = params.get('mode');
  if (startMode === tabMode || startMode === 'random' || rc) {
    window.setTimeout(() => {
      hidePage();
      shell.open();
      if (rc) {
        const ji = shell.lobbyEl.querySelector('#mpJoinCode') as HTMLInputElement | null;
        if (ji) ji.value = rc;
        shell.lobbyEl.querySelector('#mpJoinRow')!.setAttribute('style', 'display:block;margin-top:12px');
      }
    }, 0);
  }
  return shell;
}
