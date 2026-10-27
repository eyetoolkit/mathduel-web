/**
 * 24 点游戏 · 多人竞赛（最多 99 人）
 * 严格复用真实后端契约：
 *   建房  POST /api/rooms  { gameType:'24', name, mode:'competition', maxPlayers, ... } → { code }
 *   连接  wss://numeriduel.com/ws?code=<CODE>&name=<NAME>
 * 非生产域名下自动降级为本地 DEMO（模拟 99 人），便于预览验收。
 *
 * 2026-09-22 补齐三项「后端已实现、前端零消费」的能力（零后端改动）：
 *   · Elo 结算展示 —— game_over 广播本就带 elo:[{elo,delta,tier,tierChange}]
 *   · 对局内聊天   —— 服务端 case 'chat' 广播同房（含观战者），200 字上限，不落库
 *   · 观战         —— duel 第 3+ 人进入 spectator 槽位，收到 spectator_joined + 只读局面
 */

import { generate24Puzzle, type Difficulty } from './engine';
import { isClassroom, ensureStudentCode, reportRound, opsFromExpression, skillsFromExpression } from '../_shared/teacher-track';
import { genRoomCode } from '../_shared/room-code';

export interface RaceEntry {
  name: string;
  time?: number;
  ok?: boolean;
  rank?: number;
  solved?: number;
}

/** game_over.elo[] 条目（服务端 settleElo 产出） */
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

/** 对局内聊天消息（服务端 {type:'chat',name,text,ts}） */
export interface ChatMsg {
  name: string;
  text: string;
  ts: number;
  self: boolean;
}

export interface CompCallbacks {
  onPlayersChanged: (players: Record<string, { score: number }>, isHost: boolean, room: string) => void;
  onRoomReady: (room: string) => void;
  onRoundStart: (payload: { cards: number[]; round: number; maxRounds: number; timeLimit: number; players: RaceEntry[] }) => void;
  onProgress: (payload: { doneCount: number; total: number; done: RaceEntry[] }) => void;
  onRoundResult: (payload: { round: number; ranking: RaceEntry[] }) => void;
  onGameOver: (payload: { ranking: RaceEntry[]; elo?: EloEntry[] }) => void;
  onTimer: (timeLeft: number) => void;
  onError: (msg: string) => void;
  /** 房间内聊天（含自己的回声 —— 服务端广播不排除发送者） */
  onChat: (msg: ChatMsg) => void;
  /** 观战人数变化（room_info / spectator_joined 都带） */
  onSpectator: (payload: { count: number }) => void;
  /** 自己成为观战者（duel 第 3+ 人） */
  onSelfSpectator: () => void;
  /**
   * 断线重连提示（可选）。show=false 表示已恢复、收起提示；
   * failed=true 表示已放弃重连（超过上限），由 UI 明确告知玩家自行退出。
   * 2026-10-26 P0：24 点走自己的 competition.ts，共享 mp-client 的
   * mp_reconnect_* 提示条覆盖不到本页，故在此把状态抛给 index.ts。
   */
  onReconnect?: (state: { show: boolean; failed: boolean; seconds: number }) => void;
}

/** 断线重连上限（与共享 mp-client 的 MP_RECONNECT_MAX 对齐）：退避 1→2→4→8s，共 5 次 */
const COMP_RECONNECT_MAX = 5;

/** 数学站生产环境 host（数学站改名路线图 2026-09-30：mathduel.games → numeriduel.com）
 *  保留 mathduel.games 12 个月过渡期（CF Bulk Redirects）— 教师邀请码不中断 */
const PROD_HOSTS = ['numeriduel.com', 'mathduel.games'] as const;

/** 是否处于真实后端环境（接受新主域与旧主域，过渡期 12 个月） */
export function isProdEnv(): boolean {
  const h = location.host.toLowerCase();
  return PROD_HOSTS.some((host) => h.indexOf(host) >= 0);
}

const BOT_NAMES = ['Nova','Pixel','Luna','Echo','Kai','Vega','Milo','Zero','Iris','Leo','Hugo','Rin','Aki','Yuki','Cleo','Finn','Theo','Nori','Zoe','Mira','Eden','Wren','Ozzy','Lux','Ben','Sol','Remy','Sage','Otto','Nyx','Vex','Cy','Jun','Tao','Rue','Pia','Bao','Nim','Ace','Sky','Rex','Max','Zara','Kira','Jett','Nico','Aria','Dex','Ivy','Ash','Blaze','Cole','Drew','Felix','Gia','Hale','Ike','Jade','Knox','Maya','Neo','Orin','Pax','Quinn','Rory','Soren','Toby','Uma','Vance','Wade','Xan','Yara','Zane'];

/** DEMO 模式下的对手台词（仅本地预览用，不参与真实对局） */
const DEMO_CHAT = ['Almost got it!', 'Hurry up 😂', '🔥', 'Nice one', 'Wait, that works?', 'gg'];

export class Competition {
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
  players: Record<string, { score: number; avatar?: string | null; nickname?: string | null }> = {};
  /** 观战者不参与作答，只读观看 */
  spectator = false;

  /** 统一解析服务端 players 数组（可能是裸名字串，也可能是 {name,score,avatar,nickname}）。
      服务端 getRoomInfo()/players() 都会带 avatar/nickname（P2 升级），这里保留下来供 UI 展示。 */
  private absorbPlayers(arr: any): Record<string, { score: number; avatar?: string | null; nickname?: string | null }> {
    const out: Record<string, { score: number; avatar?: string | null; nickname?: string | null }> = {};
    if (Array.isArray(arr)) {
      arr.forEach((p: any) => {
        const n = typeof p === 'string' ? p : p && p.name;
        if (!n) return;
        out[n] = { score: (p && p.score) || 0, avatar: (p && p.avatar) || null, nickname: (p && p.nickname) || null };
      });
    }
    return out;
  }
  spectatorCount = 0;

  private ws: WebSocket | null = null;
  private ping: number | null = null;
  /** 主动退房/离开：抑制自动重连，避免「退出后又被自动拉回房间」 */
  private manualClose = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  /** 重连握手期：抑制 onRoomReady()，防止把进行中的对局弹回「房间码 + 二维码」视图 */
  private reconnecting = false;
  private demoBots: number[] = [];
  private demoChatTimers: number[] = [];
  private doneList: RaceEntry[] = [];
  private mySubmitted = false;
  /** 本轮最后提交用到的运算符（老师端学情的 ops_used 来源，24 点专用） */
  private lastOps: string[] = [];
  private lastSkills: string[] = [];
  private cb: CompCallbacks;
  private diff: Difficulty = 'standard';
  private raceMax = 99;

  constructor(cb: CompCallbacks) {
    this.cb = cb;
  }

  get demo(): boolean {
    return !isProdEnv();
  }

  setDifficulty(d: Difficulty): void {
    this.diff = d;
  }
  setRoomSize(n: number): void {
    this.raceMax = n;
  }
  get roomSize(): number {
    return this.raceMax;
  }
  get displayCap(): number {
    return this.demo ? 99 : this.maxPlayers;
  }

  genRoomCode(): string {
    return genRoomCode();
  }

  /* ---------------- 建房 / 加入 ---------------- */
  createRoom(name: string): void {
    if (this.demo) {
      this.demoCreateRoom(name);
      return;
    }
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pool: this.diff === 'easy' ? 'easy' : 'standard',
        gameType: '24',
        name,
        difficulty: this.diff,
        rounds: this.maxRounds,
        timeLimit: this.timeLimit,
        mode: 'competition',
        maxPlayers: this.raceMax,
      }),
    })
      .then((r) => {
        if (!r.ok) {
          this.cb.onError(`Room failed (HTTP ${r.status})`);
          throw new Error('http_' + r.status);
        }
        return r.json();
      })
      .then((d) => {
        if (!d || !d.code) {
          this.cb.onError('Room failed (no code)');
          return;
        }
        this.isHost = true;
        this.connectWS(d.code);
      })
      .catch((e) => {
        if (String(e?.message || '').indexOf('http_') === 0) return;
        this.cb.onError('Connection failed, please retry');
      });
  }

  joinRoom(code: string, name: string): void {
    if (this.demo) {
      this.demoJoinRoom(code, name);
      return;
    }
    this.isHost = false;
    this.connectWS(code);
  }

  private connectWS(code?: string, isReconnect = false): void {
    if (code) this.room = code;
    // 主动建房/加入 → 允许后续自动重连（复位退房标志与握手态）
    if (!isReconnect) {
      this.manualClose = false;
      this.reconnecting = false;
    }
    // 数学站改名（2026-09-30）：用 location.host 派生 WS URL,支持 numeriduel.com 与 mathduel.games 双域并存
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProto}//${location.host}/ws?code=${encodeURIComponent(this.room)}&name=${encodeURIComponent(this.myName)}`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      if (isReconnect) this.scheduleReconnect();
      else this.cb.onError('Cannot reach server');
      return;
    }
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setReconnectUI(false);
      /* 兜底：若服务端因房已清等原因没回 room_info，reconnecting 会一直挂着，
         之后所有 onRoomReady() 都会被误抑制。5s 后无条件解除。 */
      if (isReconnect) window.setTimeout(() => { this.reconnecting = false; }, 5000);
      /* 重连时不走 onRoomReady()：它会再次 showRoomView()，把正在进行的对局
         弹回「房间码 + 二维码」视图。服务端在连接建立后本就会补发 room_info /
         round_resume（competition 模式带 mode:'competition'），客户端已有对应处理。 */
      if (!isReconnect) this.cb.onRoomReady(this.room);
      this.send({ type: 'get_info' });
      if (this.ping) window.clearInterval(this.ping);
      this.ping = window.setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    this.ws.onmessage = (ev) => {
      let d: any;
      try {
        d = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (d && d.type === 'pong') return;
      this.handleMsg(d);
    };
    this.ws.onclose = () => {
      if (this.ping) {
        window.clearInterval(this.ping);
        this.ping = null;
      }
      if (isReconnect) this.reconnectAttempts++; // 连上又断：下次退避更久
      if (!this.manualClose && this.room && !this.demo) this.scheduleReconnect();
    };
    // 不空吞：error 后浏览器必定再触发 close，重连统一在 onclose 里调度，这里只留取证线索
    this.ws.onerror = () => { console.warn('[24-comp] ws error, room=' + this.room); };
  }

  /** 断线重连调度：退避 1s→2s→4s→8s（上限 5 次）。demo 模式与主动离开不重连。 */
  private scheduleReconnect(): void {
    if (this.manualClose || !this.room || this.demo) return;
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= COMP_RECONNECT_MAX) {
      this.setReconnectUI(true, true); // 放弃重连：明确告知，让玩家自己决定退出
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

  /** 重连提示条状态抛给 UI（index.ts 写 #compStatus）。failed=true 表示已放弃。 */
  private setReconnectUI(show: boolean, failed = false, delayMs = 0): void {
    this.cb.onReconnect?.({
      show,
      failed,
      seconds: Math.max(1, Math.round(delayMs / 1000)),
    });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  /** 老师端学情回写：round_result.ranking 每行 = {name,time,ok}，取「我自己」那行上报。
      判定来自服务端（超时未交卷也以 ok:false 出现在榜尾），客户端无法虚报。 */
  private reportClassroomRound(d: any): void {
    if (!isClassroom() || !this.room) return;
    const self = (d.ranking || []).find((r: any) => r && r.name === this.myName);
    const ok = !!(self && self.ok);
    reportRound(this.room, {
      round: d.round || this.round || 1,
      solved: ok,
      duration_ms: Number.isFinite(self && self.time) ? Math.round(self.time) : 0,
      wrong: ok ? 0 : 1,
      ops: ok ? this.lastOps : [],
      skills: ok ? this.lastSkills : [],
    });
    this.lastOps = [];
    this.lastSkills = [];
  }

  /** 服务器消息分发（完整移植原协议，含 round_resume 断线续局） */
  private handleMsg(d: any): void {
    switch (d.type) {
      case 'room_created':
      case 'room_joined':
        this.room = d.code;
        this.players = {};
        if (d.players) d.players.forEach((n: string) => (this.players[n] = { score: 0 }));
        this.players[this.myName] = { score: 0 };
        /* 老师端课堂作业（链接带 tid=1）：入房后一次性绑定班级代号 */
        if (isClassroom()) ensureStudentCode(this.room).catch(() => { /* 跳过归因不影响游戏 */ });
        /* 重连握手期：服务端照常发 room_joined，但走 onRoomReady() → showRoomView()
           会把正在进行中的对局弹回「房间码 + 二维码」视图。重连只更新数据，
           界面交给随后的 round_resume 恢复。 */
        if (!this.reconnecting) this.cb.onRoomReady(this.room);
        this.cb.onPlayersChanged(this.players, this.isHost, this.room);
        break;
      case 'player_joined':
      case 'room_info':
      case 'race_lobby':
        if (d.maxPlayers) this.maxPlayers = d.maxPlayers;
        if (d.players) this.players = this.absorbPlayers(d.players);
        // P1-5: 观战人数由服务端下发（含非玩家连接）
        if (typeof d.spectatorCount === 'number') {
          this.spectatorCount = d.spectatorCount;
          this.cb.onSpectator({ count: this.spectatorCount });
        }
        this.isHost = this.isHost || d.hostName === this.myName;
        this.cb.onPlayersChanged(this.players, this.isHost, this.room);
        /* 同上：重连握手期不弹房间视图，并在此收尾复位（服务端连发
           room_joined → room_info，之后的 round_resume 才是恢复对局的信号）。 */
        if (this.reconnecting) this.reconnecting = false;
        break;
      case 'spectator_joined': {
        // 自己被分到观战槽位：只读观看，不做题
        this.spectator = true;
        if (d.room && d.room.players) this.players = this.absorbPlayers(d.room.players);
        if (typeof d.room?.spectatorCount === 'number') this.spectatorCount = d.room.spectatorCount;
        this.cb.onSpectator({ count: this.spectatorCount });
        this.cb.onSelfSpectator();
        break;
      }
      case 'new_round':
      case 'round_resume': {
        /* P0（2026-10-26）：真实（非 demo）模式下 waiting 只在 submit() 里置 true，
           此前没有任何地方复位 —— 玩家答完第 1 轮后，第 2 轮起所有点击都被
           submit() 首行 `if (… || this.waiting …) return` 静默吞掉，一局只能答一题。
           例外：断线重连回同一轮且本轮已交卷时，必须保持 waiting=true 禁止重复提交。 */
        const keepSubmitted = d.type === 'round_resume' && this.mySubmitted;
        this.active = true;
        this.started = true;
        this.round = d.round || 1;
        this.maxRounds = d.maxRounds || 5;
        this.timeLimit = d.timeLimit || 30;
        this.players = d.players ? this.absorbPlayers(d.players) : {};
        const cards: number[] = d.cards ? d.cards.slice() : generate24Puzzle(undefined, this.diff);
        if (!keepSubmitted) this.waiting = false;
        if (d.mode === 'competition') {
          this.total = (d.players && d.players.length) || this.total || 1;
          this.done = 0;
          this.doneList = [];
          this.mySubmitted = keepSubmitted;
        }
        this.cb.onRoundStart({ cards, round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: d.players || [] });
        if (d.mode === 'competition') this.cb.onProgress({ doneCount: 0, total: this.total, done: [] });
        break;
      }
      case 'round_progress':
        this.done = d.doneCount || 0;
        if (d.total) this.total = d.total;
        this.cb.onProgress({ doneCount: this.done, total: this.total, done: d.done || [] });
        break;
      case 'round_result':
        if (d.mode === 'competition') {
          this.done = (d.ranking || []).length;
          this.cb.onProgress({ doneCount: this.done, total: this.total, done: d.ranking || [] });
          this.cb.onRoundResult({ round: d.round || this.round, ranking: d.ranking || [] });
          this.reportClassroomRound(d);
        }
        break;
      case 'round_timeout':
        this.cb.onRoundResult({ round: d.round || this.round, ranking: d.ranking || [] });
        this.reportClassroomRound(d);
        break;
      case 'game_over':
      case 'race_over':
        this.active = false;
        this.cb.onGameOver({ ranking: d.ranking || [], elo: Array.isArray(d.elo) ? d.elo : undefined });
        break;
      case 'chat': {
        // H1: 服务端广播同房所有人（含发送者自己），故无需本地回声
        const text = typeof d.text === 'string' ? d.text : '';
        if (!text) break;
        this.cb.onChat({ name: d.name || 'Player', text, ts: d.ts || Date.now(), self: d.name === this.myName });
        break;
      }
      case 'player_left':
        this.total = Math.max(0, (this.total || 1) - 1);
        this.cb.onProgress({ doneCount: this.done, total: this.total, done: [] });
        break;
      case 'timer':
        this.cb.onTimer(d.timeLeft);
        break;
      case 'error':
        this.cb.onError(d.msg || 'Error');
        break;
    }
  }

  submit(correct: boolean, formula: string): void {
    if (!this.active || this.waiting || this.spectator) return;
    this.waiting = true;
    this.lastOps = correct ? opsFromExpression(formula) : [];
    this.lastSkills = correct ? skillsFromExpression(formula) : [];
    if (this.demo) this.demoSubmit(correct, formula);
    else this.send({ type: 'submit_answer', result: correct, formula: correct ? formula : undefined });
  }

  /** 发送房间聊天（服务端 200 字上限、trim 为空则丢弃） */
  sendChat(text: string): void {
    const t = String(text || '').slice(0, 200).trim();
    if (!t) return;
    if (this.demo) {
      this.cb.onChat({ name: this.myName || 'You', text: t, ts: Date.now(), self: true });
      return;
    }
    this.send({ type: 'chat', text: t });
  }

  /** 聊天可用条件：真实房间里任何时候都可以说（含大厅等待期） */
  get canChat(): boolean {
    return !!this.room;
  }

  startRace(): void {
    if (this.spectator) return;
    if (this.demo) this.demoStartRace();
    else this.send({ type: 'start_race' });
  }

  leave(silent = false): void {
    this.active = false;
    this.started = false;
    this.waiting = false;
    this.spectator = false;
    this.spectatorCount = 0;
    /* 主动离开：取消待执行的重连并复位计数，避免「退出后又被自动拉回房间」 */
    this.manualClose = true;
    this.reconnecting = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.setReconnectUI(false);
    if (this.ping) {
      window.clearInterval(this.ping);
      this.ping = null;
    }
    this.demoBots.forEach((id) => window.clearTimeout(id));
    this.demoBots = [];
    this.demoChatTimers.forEach((id) => window.clearTimeout(id));
    this.demoChatTimers = [];
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    if (!silent) this.room = '';
  }

  /* ---------------- DEMO（预览用，模拟 99 人实时榜） ---------------- */
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

  private demoCreateRoom(name: string): void {
    this.room = this.genRoomCode();
    this.isHost = true;
    this.demoFill(name);
    this.cb.onRoomReady(this.room);
    this.cb.onPlayersChanged(this.players, true, this.room);
  }

  private demoJoinRoom(code: string, name: string): void {
    this.room = code;
    this.isHost = false;
    this.demoFill(name);
    this.cb.onRoomReady(this.room);
    this.cb.onPlayersChanged(this.players, false, this.room);
  }

  private demoStartRace(): void {
    this.started = true;
    this.active = true;
    this.round = 1;
    this.maxRounds = 5;
    this.timeLimit = 30;
    this.doneList = [];
    this.done = 0;
    this.mySubmitted = false;
    const cards = generate24Puzzle(undefined, this.diff);
    this.cb.onRoundStart({ cards, round: 1, maxRounds: 5, timeLimit: 30, players: [] });
    this.cb.onProgress({ doneCount: 0, total: this.total, done: [] });
    this.scheduleBots();
    this.scheduleDemoChat();
  }

  /** DEMO：每隔几秒让随机对手说一句话，便于本地验收聊天 UI */
  private scheduleDemoChat(): void {
    this.demoChatTimers.forEach((id) => window.clearTimeout(id));
    this.demoChatTimers = [];
    const others = Object.keys(this.players).filter((n) => n !== this.myName);
    for (let i = 0; i < 3; i++) {
      const id = window.setTimeout(() => {
        if (!this.active) return;
        const who = others[Math.floor(Math.random() * others.length)];
        const line = DEMO_CHAT[Math.floor(Math.random() * DEMO_CHAT.length)];
        this.cb.onChat({ name: who || 'Rival', text: line, ts: Date.now(), self: false });
      }, 4000 + i * 5200 + Math.random() * 2500);
      this.demoChatTimers.push(id);
    }
  }

  private scheduleBots(): void {
    this.demoBots.forEach((id) => window.clearTimeout(id));
    this.demoBots = [];
    Object.keys(this.players)
      .filter((n) => n !== this.myName)
      .forEach((n) => {
        const t = 3000 + Math.random() * 20000;
        const id = window.setTimeout(() => {
          if (!this.active) return;
          this.done++;
          this.doneList.push({ name: n, time: Math.round(t) + Math.floor(Math.random() * 900), ok: true });
          this.doneList.sort((a, b) => (a.time || 0) - (b.time || 0));
          this.cb.onProgress({ doneCount: this.done, total: this.total, done: this.doneList.slice(0, 10) });
        }, t);
        this.demoBots.push(id);
      });
  }

  private demoSubmit(correct: boolean, _formula: string): void {
    this.mySubmitted = true;
    this.done++;
    this.doneList.push({ name: this.myName, time: Math.round(this.myTime * 1000), ok: correct });
    this.doneList.sort((a, b) => (a.time || 0) - (b.time || 0));
    this.cb.onProgress({ doneCount: this.done, total: this.total, done: this.doneList.slice(0, 10) });
    window.setTimeout(() => {
      if (!this.active) return;
      const ranking = this.buildRanking(false);
      this.cb.onRoundResult({ round: this.round, ranking });
      this.round++;
      if (this.round > this.maxRounds) {
        window.setTimeout(() => this.cb.onGameOver({ ranking: this.buildRanking(true), elo: this.demoElo(this.buildRanking(true)) }), 2300);
      } else {
        window.setTimeout(() => {
          if (!this.active) return;
          this.waiting = false;
          this.doneList = [];
          this.done = 0;
          this.mySubmitted = false;
          const cards = generate24Puzzle(undefined, this.diff);
          this.cb.onRoundStart({ cards, round: this.round, maxRounds: this.maxRounds, timeLimit: this.timeLimit, players: [] });
          this.cb.onProgress({ doneCount: 0, total: this.total, done: [] });
          this.scheduleBots();
        }, 2400);
      }
    }, 1600);
  }

  /** DEMO：虚构一份 Elo 结算，让本地预览也能验收 Elo UI（真实环境由服务端下发） */
  private demoElo(ranking: RaceEntry[]): EloEntry[] {
    const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master'];
    return ranking.slice(0, 8).map((r, i) => {
      const base = 1200;
      const mine = r.name === this.myName;
      const delta = i === 0 ? 18 : -(4 + i * 3);
      const elo = base + delta + (mine ? 220 : 0);
      const from = TIERS[2];
      const to = i === 0 && mine ? TIERS[3] : from;
      return {
        name: r.name,
        nickname: null,
        avatar: null,
        elo,
        delta,
        tier: to,
        tierChange: { from, to, promoted: to !== from, demoted: false },
      };
    });
  }

  private buildRanking(final: boolean): RaceEntry[] {
    const ranking: RaceEntry[] = this.doneList.map((r, i) => ({
      name: r.name,
      time: r.time,
      ok: r.ok,
      rank: i + 1,
      solved: r.ok ? 1 : 0,
    }));
    if (final) {
      const done = new Set(this.doneList.map((r) => r.name));
      Object.keys(this.players)
        .filter((n) => !done.has(n))
        .forEach((n) => {
          ranking.push({ name: n, time: this.timeLimit * 1000 + 999, ok: false, rank: ranking.length + 1, solved: 0 });
        });
    }
    return ranking;
  }

  get submitted(): boolean {
    return this.mySubmitted;
  }
}
