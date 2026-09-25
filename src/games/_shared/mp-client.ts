/**
 * 通用多人竞赛客户端（自包含、游戏无关外壳）
 * ─────────────────────────────────────────────────────────────────────────
 * 复用 24 点已验证的 WS 竞赛生命周期（建房 / 加入 / 大厅 / 房间视图 / 速度环 /
 * 聊天 / 观战 / 结算 / Elo / DEMO 降级），但把「题目渲染 + 答题动作」抽成
 * 每游戏一个 adapter，由本外壳在收到回合消息时转发给 adapter。
 *
 * 关键：后端竞赛是「按游戏类型、服务端权威」的（见 worker/.../durable/game-room.js）：
 *   · sudoku / sudoku-6x6 / killer-sudoku → sudoku_new_game + sudoku_place
 *   · equation-pyramid（服务端 gameType=eqpyr）→ eqpyr_new_game + eqpyr_solve
 *   · bulls → bulls_new_round / bulls_phase / bulls_set_secret / bulls_guess
 *   · 24 → new_round(cards) + submit_answer
 * 本外壳只负责通用部分；具体题目与动作由 adapter 处理。
 *
 * 非生产域名自动降级为本地 DEMO（模拟 99 人实时榜），便于预览验收。
 */

const PROD_HOST = 'mathduel.games';

export function isProdEnv(): boolean {
  return location.host.indexOf(PROD_HOST) >= 0;
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

const BOT_NAMES = ['Nova','Pixel','Luna','Echo','Kai','Vega','Milo','Zero','Iris','Leo','Hugo','Rin','Aki','Yuki','Cleo','Finn','Theo','Nori','Zoe','Mira','Eden','Wren','Ozzy','Lux','Ben','Sol','Remy','Sage','Otto','Nyx','Vex','Cy','Jun','Tao','Rue','Pia','Bao','Nim','Ace','Sky','Rex','Max','Zara','Kira','Jett','Nico','Aria','Dex','Ivy','Ash','Blaze','Cole','Drew','Felix','Gia','Hale','Ike','Jade','Knox','Maya','Neo','Orin','Pax','Quinn','Rory','Soren','Toby','Uma','Vance','Wade','Xan','Yara','Zane'];
const DEMO_CHAT = ['Almost got it!', 'Hurry up 😂', '🔥', 'Nice one', 'Wait, that works?', 'gg'];

const SHELL_CSS = `
.mp-root{position:fixed;inset:0;z-index:60;display:none;background:linear-gradient(180deg,#0c1118,#0a0e14);color:#e8edf4;font-family:inherit;overflow:auto}
.mp-root.show{display:block}
.mp-root *{box-sizing:border-box}
.mp-wrap{max-width:1080px;margin:0 auto;padding:18px 16px 60px}
.mp-top{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.mp-logo{font-weight:800;letter-spacing:.5px;font-size:18px}
.mp-logo b{color:#F59E0B}
.mp-code{font-weight:700;letter-spacing:2px;background:#1b2330;border:1px solid #2a3342;padding:4px 10px;border-radius:8px}
.mp-leave{margin-left:auto;background:#2a1f24;color:#ffb4b4;border:1px solid #5a2a2f;padding:7px 14px;border-radius:9px;cursor:pointer;font-weight:600}
.mp-leave:hover{background:#3a2630}
.mp-grid{display:grid;grid-template-columns:1fr 320px;gap:16px}
@media(max-width:860px){.mp-grid{grid-template-columns:1fr}}
.mp-card{background:#10161f;border:1px solid #1e2733;border-radius:14px;padding:16px}
.mp-card h3{margin:0 0 10px;font-size:14px;color:#9fb1c6;font-weight:700;text-transform:uppercase;letter-spacing:.6px}
.mp-board{min-height:280px;display:flex;align-items:center;justify-content:center}
.mp-head{display:flex;align-items:center;gap:14px;margin-bottom:12px}
.mp-ring{width:54px;height:54px;flex:0 0 54px}
.mp-ring circle{fill:none;stroke-width:5;stroke-linecap:round}
.mp-ring .bg{stroke:#26303d}
.mp-ring .fg{stroke:#F59E0B;transition:stroke-dashoffset .3s linear}
.mp-ring-txt{font-size:13px;font-weight:700;text-align:center}
.mp-banner{font-size:13px;color:#9fb1c6}
.mp-banner b{color:#fff}
.mp-status{display:inline-block;margin-top:4px;font-size:12px;color:#7fe0a0}
.mp-status[data-live="1"]::before{content:"● ";color:#7fe0a0}
.mp-race-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.mp-race-count{font-size:13px;color:#9fb1c6}
.mp-race-count b{color:#fff;font-size:16px}
.mp-list{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto}
.mp-row{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;background:#0d131c;border:1px solid #1a2230;font-size:13px}
.mp-row.r1{background:linear-gradient(90deg,#3a2f12,#1a1610);border-color:#6a531f}
.mp-row.me{border-color:#2f6aa8}
.mp-rank{width:22px;text-align:center;font-weight:800;color:#F59E0B}
.mp-av{width:24px;height:24px;border-radius:50%;background:#1b2330;display:flex;align-items:center;justify-content:center;font-size:14px}
.mp-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-time{color:#9fb1c6;font-variant-numeric:tabular-nums}
.mp-empty{color:#6b7888;font-size:13px;padding:14px;text-align:center}
.mp-modal{position:fixed;inset:0;background:rgba(5,8,12,.78);display:none;align-items:center;justify-content:center;z-index:80;padding:20px}
.mp-modal.show{display:flex}
.mp-modal .box{background:#10161f;border:1px solid #2a3342;border-radius:16px;padding:24px;max-width:460px;width:100%;text-align:center}
.mp-modal h2{margin:0 0 10px;font-size:22px}
.mp-modal .sub{color:#9fb1c6;font-size:13px;margin-bottom:14px}
.mp-modal .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.mp-btn{padding:9px 16px;border-radius:10px;border:1px solid #2a3342;background:#1b2330;color:#e8edf4;cursor:pointer;font-weight:600}
.mp-btn.primary{background:#F59E0B;color:#1a1305;border-color:#F59E0B}
.mp-btn.ghost{background:transparent}
.mp-elo-grid{display:flex;flex-direction:column;gap:5px;margin-top:8px;text-align:left}
.mp-elo-row{display:flex;align-items:center;gap:8px;font-size:13px}
.mp-elo-row.me{color:#F59E0B;font-weight:700}
.mp-elo-row .v{margin-left:auto;font-variant-numeric:tabular-nums}
.mp-elo-row .d.up{color:#7fe0a0}.mp-elo-row .d.down{color:#ff9b9b}.mp-elo-row .d.flat{color:#9fb1c6}
.mp-tierflash{margin-top:10px;font-weight:700;color:#F59E0B}
.mp-tierflash.demoted{color:#9bb0ff}
/* ---- Lobby modal ---- */
.mp-lobby{position:fixed;inset:0;background:rgba(5,8,12,.82);display:none;align-items:center;justify-content:center;z-index:85;padding:20px}
.mp-lobby.show{display:flex}
.mp-lobby .box{background:#10161f;border:1px solid #2a3342;border-radius:18px;padding:26px;max-width:440px;width:100%}
.mp-lobby h2{margin:0 0 4px;font-size:22px}
.mp-lobby .hint{color:#9fb1c6;font-size:13px;margin-bottom:16px}
.mp-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.mp-field label{font-size:12px;color:#9fb1c6;text-transform:uppercase;letter-spacing:.5px}
.mp-input{background:#0c121a;border:1px solid #2a3342;color:#e8edf4;border-radius:10px;padding:11px 13px;font-size:15px;outline:none}
.mp-input:focus{border-color:#F59E0B}
.mp-sizes{display:flex;gap:8px;margin-bottom:16px}
.mp-size{flex:1;text-align:center;padding:9px 0;border-radius:10px;background:#0d131c;border:1px solid #1a2230;cursor:pointer;font-weight:700;font-size:14px}
.mp-size.on{border-color:#F59E0B;background:#1c160c;color:#F59E0B}
.mp-actions{display:flex;gap:10px}
.mp-actions .mp-btn{flex:1}
.mp-err{color:#ff9b9b;font-size:13px;min-height:18px;margin-bottom:8px}
.mp-room{display:none}
.mp-room.show{display:block}
.mp-room .code-big{font-size:30px;font-weight:800;letter-spacing:4px;color:#F59E0B;text-align:center;margin:6px 0}
.mp-qr{width:130px;height:130px;margin:10px auto;display:block;background:#fff;border-radius:10px}
.mp-pwrap{display:flex;gap:10px;margin:12px 0}
.mp-pwrap .mp-btn{flex:1}
.mp-players{display:flex;flex-direction:column;gap:6px;max-height:160px;overflow:auto;margin:12px 0}
.mp-rp{display:flex;align-items:center;gap:8px;font-size:14px;padding:6px 8px;background:#0d131c;border-radius:9px}
.mp-rp.me{color:#F59E0B}
.mp-rp .host{margin-left:auto;font-size:11px;color:#9fb1c6}
.mp-specbar{display:none;background:#1c160c;border:1px solid #6a531f;color:#F59E0B;padding:8px 12px;border-radius:10px;font-size:13px;margin-bottom:12px}
.mp-specbar.show{display:block}
/* ---- chat ---- */
.mp-chat{display:flex;flex-direction:column;gap:0;margin-top:14px}
.mp-chat .hd{font-size:12px;color:#9fb1c6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:flex;justify-content:space-between}
.mp-chat .log{height:150px;overflow:auto;display:flex;flex-direction:column;gap:6px;background:#0c121a;border:1px solid #1a2230;border-radius:10px;padding:8px}
.mp-bub{padding:6px 9px;border-radius:9px;font-size:13px;max-width:85%}
.mp-bub.me{background:#1b2b40;align-self:flex-end}
.mp-bub.opp{background:#161d27;align-self:flex-start}
.mp-bub .who{font-size:11px;color:#7f93a8;display:block;margin-bottom:1px}
.mp-rail{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.mp-rail button{background:#1b2330;border:1px solid #2a3342;border-radius:8px;cursor:pointer;font-size:15px;width:34px;height:30px}
.mp-chat .inrow{display:flex;gap:6px;margin-top:7px}
.mp-chat .inrow input{flex:1;background:#0c121a;border:1px solid #2a3342;color:#e8edf4;border-radius:9px;padding:8px 10px;outline:none}
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

  private players: Record<string, { score: number; avatar?: string | null; nickname?: string | null }> = {};
  private ws: WebSocket | null = null;
  private ping: number | null = null;
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
    const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
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
          <span class="mp-logo">Math<b>Duel</b> · ${this.adapter.label}</span>
          <span class="mp-code" id="mpCode">—</span>
          <button class="mp-leave" id="mpLeave">Leave</button>
        </div>
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
              <div class="mp-race-hd"><span>🏆 Live Standings</span><span class="mp-race-count"><b id="mpDone">0</b>/<b id="mpTotal">0</b> solved</span></div>
              <div class="mp-list" id="mpList"><div class="mp-empty">No submissions yet — be first!</div></div>
            </div>
            <div class="mp-chat" id="mpChat">
              <div class="hd"><b>💬 Room chat</b><span>only this room</span></div>
              <div class="log" id="mpChatLog"></div>
              <div class="rail">${['😂','🔥','😡','👍','💡','🎯'].map((e)=>`<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
              <div class="inrow"><input type="text" maxlength="200" placeholder="Say something…" id="mpChatInput"/><button type="button" id="mpChatSend">Send</button></div>
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

    root.querySelector('#mpLeave')!.addEventListener('click', () => this.leave(false));
    this.wireChat();
    this.cb.onMount?.(root);
    return root;
  }

  private buildLobby(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mp-lobby';
    el.innerHTML = `
      <div class="box">
        <h2>🏆 ${this.adapter.label} — Competition</h2>
        <div class="hint">Create a room, share the code, race friends or the world.</div>
        <div class="mp-field"><label>Your name</label><input class="mp-input" id="mpName" maxlength="18" placeholder="Player"/></div>
        <div class="mp-sizes" id="mpSizes">
          <div class="mp-size" data-max="2">2</div>
          <div class="mp-size" data-max="10">10</div>
          <div class="mp-size" data-max="25">25</div>
          <div class="mp-size on" data-max="99">99</div>
        </div>
        <div class="mp-err" id="mpLobbyErr"></div>
        <div class="mp-form" id="mpForm">
          <div class="mp-actions">
            <button class="mp-btn primary" id="mpCreate">🚀 Create Room</button>
            <button class="mp-btn" id="mpJoinToggle">Join with code</button>
          </div>
          <div class="mp-field" id="mpJoinRow" style="display:none;margin-top:12px">
            <input class="mp-input" id="mpJoinCode" maxlength="6" placeholder="ROOM CODE"/>
            <button class="mp-btn primary" id="mpJoin">Join</button>
          </div>
        </div>
        <div class="mp-room" id="mpRoom">
          <div class="hint">Room ready — share this code:</div>
          <div class="code-big" id="mpRoomCode">—</div>
          <canvas class="mp-qr" id="mpQr" width="130" height="130"></canvas>
          <div class="mp-pwrap">
            <button class="mp-btn ghost" id="mpShare">🔗 Copy invite</button>
            <button class="mp-btn ghost" id="mpCopy">⧉ Copy code</button>
          </div>
          <div class="mp-players" id="mpPlayers"></div>
          <button class="mp-btn primary" id="mpStart" disabled>🚀 Start (2+ players)</button>
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
      this.myName = name;
      this.lobbyErr('');
      this.createRoom(name);
    });
    el.querySelector('#mpJoinToggle')!.addEventListener('click', () => {
      const r = el.querySelector('#mpJoinRow') as HTMLElement;
      r.style.display = r.style.display === 'none' ? 'block' : 'none';
    });
    el.querySelector('#mpJoin')!.addEventListener('click', () => {
      const name = (el.querySelector('#mpName') as HTMLInputElement).value.trim();
      const code = (el.querySelector('#mpJoinCode') as HTMLInputElement).value.trim().toUpperCase();
      if (!name) { this.lobbyErr('Enter a name'); return; }
      if (!/^[A-Z0-9]{4,6}$/.test(code)) { this.lobbyErr('Invalid code (4–6 chars)'); return; }
      this.myName = name;
      this.lobbyErr('');
      this.joinRoom(code, name);
    });
    el.querySelector('#mpStart')!.addEventListener('click', () => this.startRace());
    el.querySelector('#mpShare')!.addEventListener('click', () => this.copyInvite());
    el.querySelector('#mpCopy')!.addEventListener('click', () => this.copyCode());
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
    this.root.classList.remove('show');
  }

  openLobby(): void {
    this.lobbyEl.classList.add('show');
    const ni = this.lobbyEl.querySelector('#mpName') as HTMLInputElement;
    if (this.myName) ni.value = this.myName;
    else {
      const s = localStorage.getItem('mp_name');
      if (s) ni.value = s;
    }
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

  private connectWS(code?: string): void {
    if (code) this.room = code;
    const url = `wss://${PROD_HOST}/ws?code=${encodeURIComponent(this.room)}&name=${encodeURIComponent(this.myName)}`;
    try { this.ws = new WebSocket(url); }
    catch { this.lobbyErr('Cannot reach server'); return; }
    this.ws.onopen = () => {
      this.onRoomReady(this.room);
      this.send({ type: 'get_info' });
      if (this.ping) window.clearInterval(this.ping);
      this.ping = window.setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    this.ws.onmessage = (ev) => {
      let d: any; try { d = JSON.parse(ev.data as string); } catch { return; }
      if (d && d.type === 'pong') return;
      this.handleMsg(d);
    };
    this.ws.onclose = () => { if (this.ping) { window.clearInterval(this.ping); this.ping = null; } };
    this.ws.onerror = () => {};
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
    this.lobbyEl.classList.remove('show');
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
        if (d.players) d.players.forEach((n: string) => (this.players[n] = { score: 0 }));
        this.players[this.myName] = { score: 0 };
        this.onRoomReady(this.room);
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
        this.showRoomView();
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
        break;
      case 'round_timeout':
        this.cb.onRoundResult?.({ round: d.round || this.round, ranking: d.ranking || [] });
        this.showRoundResult(d);
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

  /** 通用回合开始处理（adapter 未显式消费时兜底） */
  private handleRoundMsg(d: any): void {
    const isRoundStart = ['new_round', 'round_resume', 'sudoku_new_game', 'eqpyr_new_game', 'bulls_new_round'].includes(d.type);
    if (!isRoundStart) return;
    this.active = true;
    this.started = true;
    this.round = d.round || 1;
    this.maxRounds = d.maxRounds || 5;
    this.timeLimit = d.timeLimit || 30;
    if (d.players) this.players = this.absorbPlayers(d.players);
    const ctx: RoundCtx = { round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: d.players || [], isHost: this.isHost };
    this.cbRound = ctx;
    this.cb.onRoundStart?.(ctx);
    this.adapter.renderRound(this.extractPayload(d), ctx, this.boardEl, this);
    this.renderProgress();
    this.renderSpecBar();
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
    if (!this.doneList.length) { list.innerHTML = '<div class="mp-empty">No submissions yet — be first!</div>'; return; }
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
    if (st) { st.textContent = this.spectator ? '👀 Spectating this round' : `Round timer ${secs}s`; st.setAttribute('data-live', '1'); }
  }

  renderSpecBar(): void {
    const el = this.root.querySelector('#mpSpec');
    if (!el) return;
    el.classList.toggle('show', this.spectator);
    el.innerHTML = this.spectator ? `👀 <b>Spectating</b> — read-only view${this.spectatorCount > 1 ? ` · ${this.spectatorCount} watchers` : ''}` : '';
  }

  /* ===================== 房间视图 ===================== */
  private showRoomView(): void {
    const room = this.lobbyEl.querySelector('#mpRoom') as HTMLElement;
    const form = this.lobbyEl.querySelector('#mpForm') as HTMLElement;
    form.style.display = 'none';
    room.classList.add('show');
    (this.lobbyEl.querySelector('#mpRoomCode') as HTMLElement).textContent = this.room;
    this.renderRoomPlayers();
    this.renderQR();
  }

  private renderRoomPlayers(): void {
    const list = this.lobbyEl.querySelector('#mpPlayers') as HTMLElement;
    if (!list) return;
    const names = Object.keys(this.players);
    list.innerHTML = names.map((name) => {
      const me = name === this.myName;
      return `<div class="mp-rp${me ? ' me' : ''}"><span class="mp-av">🙂</span><span>${escapeHtml(name)}</span>${this.isHost && me ? '<span class="host">You · Host</span>' : ''}</div>`;
    }).join('');
    const sb = this.lobbyEl.querySelector('#mpStart') as HTMLButtonElement;
    const n = names.length;
    sb.disabled = !(this.isHost && n >= 2);
    sb.textContent = n < 2 ? '🚀 Start (2+ players)' : '🚀 Start Competition';
  }

  private renderQR(): void {
    const cv = this.lobbyEl.querySelector('#mpQr') as HTMLCanvasElement;
    if (!cv) return;
    try {
      const url = this.inviteUrl();
      drawQrFallback(cv, url);
    } catch { /* 二维码失败不影响主流程 */ }
  }

  inviteUrl(): string { return location.origin + location.pathname + '?room=' + encodeURIComponent(this.room || ''); }

  private copyInvite(): void {
    const url = this.inviteUrl();
    try { navigator.clipboard.writeText(url); this.toast('Invite link copied'); } catch { this.toast(url); }
  }
  private copyCode(): void {
    try { navigator.clipboard.writeText(this.room); this.toast('Room code copied: ' + this.room); } catch { this.toast(this.room); }
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
    if (this.ping) { window.clearInterval(this.ping); this.ping = null; }
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
    const heading = me ? (me.rank === 1 ? '🏆 You won!' : `🏁 You ranked #${me.rank}`) : '🏁 Competition Over';
    let html = `<h2 class="${me && me.rank === 1 ? '' : me ? 'draw-c' : 'lose-c'}">${heading}</h2>`;
    html += `<p class="sub">${rk.length} players · cap ${this.displayCap}</p>`;
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
    const rows = elo.slice(0, 10).map((e) => {
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
  mountPoint?: HTMLElement;
  callbacks?: MpCallbacks;
  /** 进入竞赛视图时要隐藏的页面元素（如游戏自带 playView），传选择器数组 */
  hideOnOpen?: string[];
}
export function mountCompetition(cfg: MountConfig): MpShell {
  const shell = new MpShell(cfg.adapter, cfg.callbacks || {});
  shell.mount(cfg.mountPoint);

  const tabLabel = cfg.tabLabel || 'Competition';
  const tabMode = 'battle';
  if (cfg.tabsEl) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.mode = tabMode;
    tab.textContent = tabLabel;
    tab.addEventListener('click', () => {
      cfg.hideOnOpen?.forEach((sel) => document.querySelectorAll(sel).forEach((e) => (e as HTMLElement).style.display = 'none'));
      shell.open();
    });
    cfg.tabsEl.appendChild(tab);
  }

  // 深链 ?mode=battle / ?room=
  const params = new URLSearchParams(location.search);
  const rc = (params.get('room') || '').trim().toUpperCase();
  const startMode = params.get('mode');
  if (startMode === tabMode || rc) {
    window.setTimeout(() => {
      cfg.hideOnOpen?.forEach((sel) => document.querySelectorAll(sel).forEach((e) => (e as HTMLElement).style.display = 'none'));
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
