/**
 * 24 点游戏 · 多人竞赛（最多 99 人）
 * 严格复用真实后端契约：
 *   建房  POST /api/rooms  { gameType:'24', name, mode:'competition', maxPlayers, ... } → { code }
 *   连接  wss://mathduel.games/ws?code=<CODE>&name=<NAME>
 * 非生产域名下自动降级为本地 DEMO（模拟 99 人），便于预览验收。
 */

import { generate24Puzzle, type Difficulty } from './engine';

export interface RaceEntry {
  name: string;
  time?: number;
  ok?: boolean;
  rank?: number;
  solved?: number;
}

export interface CompCallbacks {
  onPlayersChanged: (players: Record<string, { score: number }>, isHost: boolean, room: string) => void;
  onRoomReady: (room: string) => void;
  onRoundStart: (payload: { cards: number[]; round: number; maxRounds: number; timeLimit: number; players: RaceEntry[] }) => void;
  onProgress: (payload: { doneCount: number; total: number; done: RaceEntry[] }) => void;
  onRoundResult: (payload: { round: number; ranking: RaceEntry[] }) => void;
  onGameOver: (payload: { ranking: RaceEntry[] }) => void;
  onTimer: (timeLeft: number) => void;
  onError: (msg: string) => void;
}

const PROD_HOST = 'mathduel.games';

/** 是否处于真实后端环境 */
export function isProdEnv(): boolean {
  return location.host.indexOf(PROD_HOST) >= 0;
}

const BOT_NAMES = ['Nova','Pixel','Luna','Echo','Kai','Vega','Milo','Zero','Iris','Leo','Hugo','Rin','Aki','Yuki','Cleo','Finn','Theo','Nori','Zoe','Mira','Eden','Wren','Ozzy','Lux','Ben','Sol','Remy','Sage','Otto','Nyx','Vex','Cy','Jun','Tao','Rue','Pia','Bao','Nim','Ace','Sky','Rex','Max','Zara','Kira','Jett','Nico','Aria','Dex','Ivy','Ash','Blaze','Cole','Drew','Felix','Gia','Hale','Ike','Jade','Knox','Maya','Neo','Orin','Pax','Quinn','Rory','Soren','Toby','Uma','Vance','Wade','Xan','Yara','Zane'];

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
  players: Record<string, { score: number }> = {};

  private ws: WebSocket | null = null;
  private ping: number | null = null;
  private demoBots: number[] = [];
  private doneList: RaceEntry[] = [];
  private mySubmitted = false;
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
    const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
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

  private connectWS(code?: string): void {
    if (code) this.room = code;
    const url = `wss://${PROD_HOST}/ws?code=${encodeURIComponent(this.room)}&name=${encodeURIComponent(this.myName)}`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.cb.onError('Cannot reach server');
      return;
    }
    this.ws.onopen = () => {
      this.cb.onRoomReady(this.room);
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
    };
    this.ws.onerror = () => {};
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
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
        this.cb.onRoomReady(this.room);
        this.cb.onPlayersChanged(this.players, this.isHost, this.room);
        break;
      case 'player_joined':
      case 'room_info':
      case 'race_lobby':
        if (d.maxPlayers) this.maxPlayers = d.maxPlayers;
        if (d.players) {
          this.players = {};
          d.players.forEach((p: any) => {
            const n = typeof p === 'string' ? p : p.name;
            this.players[n] = { score: p.score || 0 };
          });
        }
        this.isHost = this.isHost || d.hostName === this.myName;
        this.cb.onPlayersChanged(this.players, this.isHost, this.room);
        break;
      case 'new_round':
      case 'round_resume': {
        this.active = true;
        this.started = true;
        this.round = d.round || 1;
        this.maxRounds = d.maxRounds || 5;
        this.timeLimit = d.timeLimit || 30;
        this.players = {};
        if (d.players)
          d.players.forEach((p: any) => {
            const n = typeof p === 'string' ? p : p.name;
            this.players[n] = { score: p.score || 0 };
          });
        const cards: number[] = d.cards ? d.cards.slice() : generate24Puzzle(undefined, this.diff);
        if (d.mode === 'competition') {
          this.total = (d.players && d.players.length) || this.total || 1;
          this.done = 0;
          this.doneList = [];
          this.mySubmitted = false;
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
        }
        break;
      case 'round_timeout':
        this.cb.onRoundResult({ round: d.round || this.round, ranking: d.ranking || [] });
        break;
      case 'game_over':
      case 'race_over':
        this.active = false;
        this.cb.onGameOver({ ranking: d.ranking || [] });
        break;
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
    if (!this.active || this.waiting) return;
    this.waiting = true;
    if (this.demo) this.demoSubmit(correct, formula);
    else this.send({ type: 'submit_answer', result: correct, formula: correct ? formula : undefined });
  }

  startRace(): void {
    if (this.demo) this.demoStartRace();
    else this.send({ type: 'start_race' });
  }

  leave(silent = false): void {
    this.active = false;
    this.started = false;
    this.waiting = false;
    if (this.ping) {
      window.clearInterval(this.ping);
      this.ping = null;
    }
    this.demoBots.forEach((id) => window.clearTimeout(id));
    this.demoBots = [];
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
        window.setTimeout(() => this.cb.onGameOver({ ranking: this.buildRanking(true) }), 2300);
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
