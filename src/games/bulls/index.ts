/**
 * 猜数字 1A2B · UI 编排
 *
 * 结构对齐 24 点：engine.ts（纯逻辑） + 本文件（DOM 与状态机）。
 * 玩法：玩家设密 → 电脑设密 → 轮流猜，先到 4A 者胜。
 * 电脑用候选集消除，界面右上角实时显示它剩余的可能数。
 */

import '@tri-sites/design-system/styles';
import '../../styles/game-shell.css';
import './styles.css';
import { initI18n, mountHeader, toast } from '@tri-sites/design-system';
import {
  aiNextGuess,
  allSecrets,
  applyGuess,
  filterByFeedback,
  isValidSecret,
  newGame,
  randomSecret,
  setSecret,
  type BullsGame,
  type Difficulty,
} from './engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

initI18n();
mountHeader(($('header') as HTMLElement | null) ?? document.createElement('div'), {
  brandName: 'MathDuel',
  brandSub: 'Guess the Number',
  mark: '◎',
  nav: [
    { labelKey: 'nav.home', href: '/' },
    { labelKey: 'nav.games', href: '/games/bulls/' },
    ],
});

/* ───────────── 状态 ───────────── */

let game: BullsGame = newGame();
let aiCands: readonly string[] = allSecrets();
let difficulty: Difficulty = 'normal';
let aiTimer: number | null = null;

/* ───────────── DOM ───────────── */

const setupBox = $('setupBox')!;
const playBox = $('playBox')!;
const resultBox = $('resultBox')!;
const secretInput = $<HTMLInputElement>('secretInput')!;
const guessInput = $<HTMLInputElement>('guessInput')!;
const hisBody = $('hisBody')!;
const stMoves = $('stMoves')!;
const stLeft = $('stLeft')!;
const phaseTag = $('phaseTag')!;
const setupMsg = $('setupMsg')!;
const playMsg = $('playMsg')!;

/* ───────────── 渲染 ───────────── */

function render(): void {
  stMoves.textContent = String(game.moveCount);
  stLeft.textContent = String(aiCands.length);

  hisBody.innerHTML = game.history
    .map(
      (h, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${h.by === 0 ? 'You' : 'Computer'}</td>
        <td class="num">${h.guess}</td>
        <td><span class="gb-ab">${h.a}A${h.b}B</span></td>
      </tr>`,
    )
    .join('');

  if (game.status === 'playing') {
    phaseTag.textContent = game.turn === 0 ? 'Your turn' : 'Computer thinking…';
  }
}

function showResult(playerWon: boolean): void {
  playBox.hidden = true;
  resultBox.hidden = false;
  const title = $('resultTitle')!;
  const sub = $('resultSub')!;
  const myGuessCount = game.history.filter((h) => h.by === 0).length;
  title.textContent = playerWon ? 'You win' : 'Computer wins';
  sub.textContent = playerWon
    ? `Cracked it in ${myGuessCount} guesses.`
    : `The answer was ${game.secrets[0]}. Try a harder level?`;
  // F-205 / F-207: 记录战绩到 localStorage 并刷新右栏
  recordResult(playerWon, myGuessCount);
  renderRecord();
}

/* ───────────── 本地战绩（F-205 留存钩子） ───────────── */
const REC_KEY = 'bulls_record_v1';
interface Rec {
  wins: number;
  losses: number;
  best: number; // 最少猜测次数（数字越小越 NB；0 表示没赢过）
  streak: number;
}
function loadRec(): Rec {
  try {
    const s = localStorage.getItem(REC_KEY);
    if (!s) return { wins: 0, losses: 0, best: 0, streak: 0 };
    const o = JSON.parse(s) as Partial<Rec>;
    return { wins: o.wins ?? 0, losses: o.losses ?? 0, best: o.best ?? 0, streak: o.streak ?? 0 };
  } catch {
    return { wins: 0, losses: 0, best: 0, streak: 0 };
  }
}
function saveRec(r: Rec): void {
  try {
    localStorage.setItem(REC_KEY, JSON.stringify(r));
  } catch {
    /* private mode — silently no-op */
  }
}
function recordResult(playerWon: boolean, myGuessCount: number): void {
  const r = loadRec();
  if (playerWon) {
    r.wins += 1;
    r.streak += 1;
    if (myGuessCount > 0 && (r.best === 0 || myGuessCount < r.best)) r.best = myGuessCount;
  } else {
    r.losses += 1;
    r.streak = 0;
  }
  saveRec(r);
}
function renderRecord(): void {
  const r = loadRec();
  const set = (id: string, v: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('stat-wins', String(r.wins));
  set('stat-losses', String(r.losses));
  set('stat-best', r.best > 0 ? String(r.best) : '—');
  set('stat-streak', String(r.streak));
}

/* ───────────── 交互 ───────────── */

function startGame(secret: string): void {
  const res = setSecret(game, 0, secret);
  if (!res.ok) {
    setupMsg.textContent = res.error ?? 'Invalid number';
    return;
  }
  setSecret(game, 1, randomSecret());
  aiCands = allSecrets();
  setupBox.hidden = true;
  playBox.hidden = false;
  setupMsg.textContent = '';
  guessInput.focus();
  render();
}

function playerGuess(): void {
  const v = guessInput.value.trim();
  if (!isValidSecret(v)) {
    toast('Enter 4 unique digits from 1-9');
    return;
  }
  const res = applyGuess(game, 0, v);
  if (!res.ok) {
    playMsg.textContent = res.error ?? '';
    return;
  }
  guessInput.value = '';
  playMsg.textContent = '';
  render();

  if (res.win) {
    showResult(true);
    return;
  }
  // 电脑回合（延后一拍，读起来像在思考）
  aiTimer = window.setTimeout(aiTurn, 550);
}

function aiTurn(): void {
  if (game.status !== 'playing') return;
  const guess = aiNextGuess(aiCands, difficulty);
  const res = applyGuess(game, 1, guess);
  if (!res.ok || res.a === undefined || res.b === undefined) return;

  // 电脑是根据对自己猜测的反馈来收敛候选的
  aiCands = filterByFeedback(aiCands, guess, res.a, res.b);
  render();

  if (res.win) {
    showResult(false);
  }
}

function restart(): void {
  if (aiTimer) window.clearTimeout(aiTimer);
  aiTimer = null;
  game = newGame();
  aiCands = allSecrets();
  setupBox.hidden = false;
  playBox.hidden = true;
  resultBox.hidden = true;
  secretInput.value = '';
  guessInput.value = '';
  playMsg.textContent = '';
  render();
}

/* ───────────── 绑定 ───────────── */

$<HTMLButtonElement>('secretBtn')!.addEventListener('click', () => startGame(secretInput.value.trim()));
$<HTMLButtonElement>('randomBtn')!.addEventListener('click', () => {
  secretInput.value = randomSecret();
});
$<HTMLButtonElement>('guessBtn')!.addEventListener('click', playerGuess);
$<HTMLButtonElement>('restartBtn')!.addEventListener('click', restart);
$<HTMLSelectElement>('aiDiff')!.addEventListener('change', (e) => {
  difficulty = (e.target as HTMLSelectElement).value as Difficulty;
});

guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') playerGuess();
});
secretInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame(secretInput.value.trim());
});

render();
renderRecord();
