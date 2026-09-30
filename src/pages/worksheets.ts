/* ═══════════════════════════════════════════════════════════════
   NumeriDuel Worksheets — 可打印练习纸生成器
   ────────────────────────────────────────────────────────────────
   复用各游戏的真实引擎（24 点 / 数独 4x4·6x6·9x9 / 等式金字塔），
   屏幕预览 + @media print 一键打印。纯前端、零后端、零账号。
   打印哲学：黑白、少墨、题卡不跨页（break-inside: avoid）、
   答案页独立成页（break-before: page）。
   ═══════════════════════════════════════════════════════════════ */
import './worksheets.css';
import {
  mulberry32, N as N9,
  generatePuzzle as genS9,
  type Difficulty as D9,
} from '../games/sudoku/engine';
import {
  N as N6,
  generatePuzzle as genS6,
  type Difficulty as D6,
} from '../games/sudoku-6x6/engine';
import {
  N as N4,
  generatePuzzle as genS4,
} from '../games/sudoku-4x4/engine';
import {
  generate24Puzzle, solve,
  type Difficulty as D24,
} from '../games/24-game/engine';
import {
  generateBoard, tripleToParts,
  type Board, type Tier,
} from '../games/equation-pyramid/engine';

type GameKey = 's24' | 'eqpyr' | 's4' | 's6' | 's9';
type SPuzzle = { puzzle: number[]; solution: number[] };

interface GameDef {
  key: GameKey;
  label: string;
  blurb: string;
  diffs: Array<[string, string]>;   // [value, label]
  counts: number[];                 // 可选题量
  defDiff: string;
  defCount: number;
}

const GAMES: GameDef[] = [
  {
    key: 's24', label: '24 Point', blurb: 'Make 24 using all four numbers — each exactly once.',
    diffs: [['easy', 'Easy'], ['standard', 'Standard'], ['hard', 'Hard']],
    counts: [4, 6, 8, 12], defDiff: 'standard', defCount: 6,
  },
  {
    key: 'eqpyr', label: 'Equation Pyramid', blurb: 'Pick three cells in order to hit the target.',
    diffs: [['warmup', 'Warm-up'], ['standard', 'Standard'], ['tricky', 'Tricky']],
    counts: [3, 4, 6], defDiff: 'standard', defCount: 4,
  },
  {
    key: 's4', label: 'Sudoku 4×4', blurb: 'Fill 1–4 so every row, column and 2×2 box has each digit once.',
    diffs: [['fixed', '—']], counts: [2, 4, 6], defDiff: 'fixed', defCount: 4,
  },
  {
    key: 's6', label: 'Sudoku 6×6', blurb: 'Fill 1–6 so every row, column and box has each digit once.',
    diffs: [['easy', 'Easy'], ['standard', 'Standard'], ['hard', 'Hard']],
    counts: [1, 2, 3], defDiff: 'easy', defCount: 2,
  },
  {
    key: 's9', label: 'Sudoku 9×9', blurb: 'The classic grid — rows, columns and 3×3 boxes.',
    diffs: [['easy', 'Easy'], ['standard', 'Standard'], ['hard', 'Hard']],
    counts: [1, 2], defDiff: 'easy', defCount: 1,
  },
];

/* ─── DOM ─── */
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const tabsEl = byId('gameTabs');
const diffSel = byId('optDiff') as HTMLSelectElement;
const diffLbl = byId('lblDiff');
const countSel = byId('optCount') as HTMLSelectElement;
const ansChk = byId('optAnswers') as HTMLInputElement;
const sheet = byId('sheet');
const emptyBox = byId('empty');

let cur: GameDef = GAMES[0];
let hasSet = false;
let setNo = '';
let pieceCounter = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ══════════════ 各游戏生成（返回 {card, answer}） ══════════════ */

interface Piece { card: HTMLElement; answer: HTMLElement; }

function make24(rng: () => number, diff: string): Piece {
  const nums = generate24Puzzle(rng, diff as D24);
  const sol = solve(nums.map((n) => ({ value: n, expr: String(n) })));

  const card = el('div', 'pcard pc24');
  card.appendChild(el('div', 'pno', String(pieceCounter)));
  const row = el('div', 'c24-row');
  const chipRow = el('div', 'c24-nums');
  for (const n of nums) chipRow.appendChild(el('span', 'c24-chip', String(n)));
  row.appendChild(chipRow);
  row.appendChild(el('div', 'c24-t', '= 24'));
  card.appendChild(row);

  const answer = el('div', 'ans-line');
  answer.appendChild(el('b', undefined, String(pieceCounter) + '.'));
  // * 和 / 换成 × ÷，答案页更像算式而不是代码（ts lib es2020 无 replaceAll）
  const pretty = sol
    ? sol[1].split('*').join('\u00d7').split('/').join('\u00f7') + ' = 24'
    : '(skip \u2014 no solution)';
  answer.appendChild(el('span', undefined, pretty));
  return { card, answer };
}

function makeEqpyr(rng: () => number, tier: string): Piece {
  const board: Board = generateBoard(tier as Tier, rng);
  const parts = board.solutions.length ? tripleToParts(board.solutions[0], board) : null;

  const card = el('div', 'pcard pceq');
  card.appendChild(el('div', 'pno', String(pieceCounter)));
  const meta = el('div', 'eq-meta');
  meta.appendChild(el('span', 'eq-target', 'Target: ' + board.target));
  card.appendChild(meta);
  const grid = el('div', 'eq-grid');
  board.cells.forEach((c, i) => {
    const cell = el('div', 'eq-cell');
    cell.appendChild(el('span', 'eq-op', i === 0 ? '' : c.op));  // 首格 anchor，op 不参与运算
    cell.appendChild(el('span', 'eq-num', String(c.num)));
    grid.appendChild(cell);
  });
  card.appendChild(grid);
  card.appendChild(el('div', 'eq-hint',
    'Choose three cells in order: number · operator · number · operator · number.'));

  const answer = el('div', 'ans-line');
  answer.appendChild(el('b', undefined, String(pieceCounter) + '.'));
  answer.appendChild(el('span', undefined,
    parts ? `${parts.a} ${parts.op1} ${parts.b} ${parts.op2} ${parts.c} = ${board.target}` : '(none)'));
  const extra = board.solutions.length - 1;
  if (extra > 0) answer.appendChild(el('i', 'ans-more', ` (+${extra} more solution${extra > 1 ? 's' : ''} exist)`));
  return { card, answer };
}

function buildSudokuTable(p: SPuzzle, n: number, kind: 's4' | 's6' | 's9', isAnswer: boolean): HTMLElement {
  const tbl = el('table', 'sg sg-' + kind);
  const thickR = kind === 's4' ? [2] : kind === 's6' ? [2, 4] : [3, 6];
  const thickC = kind === 's4' ? [2] : kind === 's6' ? [3] : [3, 6];
  for (let r = 0; r < n; r++) {
    const tr = el('tr');
    if (thickR.includes(r)) tr.classList.add('thick-top');
    for (let c = 0; c < n; c++) {
      const td = el('td');
      if (thickC.includes(c)) td.classList.add('thick-left');
      const i = r * n + c;
      const g = p.puzzle[i];
      if (g) {
        td.textContent = String(g);
        td.classList.add('given');
      } else if (isAnswer) {
        td.textContent = String(p.solution[i]);
        td.classList.add('filled');
      }
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  return tbl;
}

function makeSudoku(kind: 's4' | 's6' | 's9', diff: string, rng: () => number): Piece {
  let p: SPuzzle;
  if (kind === 's4') p = genS4(rng);
  else if (kind === 's6') p = genS6(diff as D6, rng);
  else p = genS9(diff as D9, rng);
  const n = kind === 's4' ? N4 : kind === 's6' ? N6 : N9;

  const card = el('div', 'pcard pcs' + kind.slice(1));
  card.appendChild(el('div', 'pno', String(pieceCounter)));
  card.appendChild(buildSudokuTable(p, n, kind, false));

  const answer = el('div', 'ans-sudoku');
  answer.appendChild(el('b', undefined, String(pieceCounter) + '.'));
  answer.appendChild(buildSudokuTable(p, n, kind, true));
  return { card, answer };
}

/* ══════════════ 集合渲染 ══════════════ */

function renderSet(): void {
  pieceCounter = 1;
  const rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
  setNo = Math.random().toString(36).slice(2, 6).toUpperCase();
  const def = cur;
  const diff = diffSel.value;
  const count = parseInt(countSel.value, 10) || def.defCount;

  sheet.textContent = '';
  const pieces: Piece[] = [];
  for (let k = 0; k < count; k++) {
    if (def.key === 's24') pieces.push(make24(rng, diff));
    else if (def.key === 'eqpyr') pieces.push(makeEqpyr(rng, diff));
    else if (def.key === 's4') pieces.push(makeSudoku('s4', diff, rng));
    else if (def.key === 's6') pieces.push(makeSudoku('s6', diff, rng));
    else pieces.push(makeSudoku('s9', diff, rng));
    pieceCounter++;
  }

  /* 页眉：标题 + 元信息 + 姓名栏（老师发纸必备） */
  const head = el('div', 'ws-head');
  const t = el('div', 'ws-title');
  t.appendChild(el('b', undefined, 'NumeriDuel · ' + def.label));
  const diffText = diff === 'fixed' ? '' : ' · ' + (diffSel.selectedOptions[0]?.textContent || diff);
  t.appendChild(el('span', 'ws-diff', diffText));
  head.appendChild(t);
  const meta = el('div', 'ws-meta');
  meta.appendChild(el('span', undefined, 'Set #' + setNo));
  meta.appendChild(el('span', undefined,
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })));
  meta.appendChild(el('span', 'ws-name', 'Name ________________'));
  head.appendChild(meta);
  head.appendChild(el('div', 'ws-blurb', def.blurb));
  sheet.appendChild(head);

  const grid = el('div', 'ws-grid');
  for (const p of pieces) grid.appendChild(p.card);
  sheet.appendChild(grid);

  if (ansChk.checked) {
    const ansSec = el('section', 'ws-answers');
    ansSec.appendChild(el('h2', undefined, 'Answer Key — Set #' + setNo));
    for (const p of pieces) ansSec.appendChild(p.answer);
    sheet.appendChild(ansSec);
  }

  emptyBox.style.display = 'none';
  hasSet = true;
}

/* ══════════════ 控件 ══════════════ */

function fillOptions(): void {
  diffSel.textContent = '';
  for (const [v, label] of cur.diffs) {
    const o = el('option', undefined, label) as HTMLOptionElement;
    o.value = v;
    if (v === cur.defDiff) o.selected = true;
    diffSel.appendChild(o);
  }
  diffSel.disabled = cur.diffs.length <= 1;
  diffLbl.textContent = cur.key === 'eqpyr' ? 'Tier' : 'Difficulty';

  countSel.textContent = '';
  for (const c of cur.counts) {
    const o = el('option', undefined, String(c)) as HTMLOptionElement;
    o.value = String(c);
    if (c === cur.defCount) o.selected = true;
    countSel.appendChild(o);
  }
}

function buildTabs(): void {
  for (const g of GAMES) {
    const b = el('button', 'ws-tab' + (g === cur ? ' on' : ''), g.label) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      cur = g;
      for (const n of Array.from(tabsEl.children)) n.classList.toggle('on', n === b);
      fillOptions();
      if (hasSet) renderSet();
    });
    tabsEl.appendChild(b);
  }
}

byId('genBtn').addEventListener('click', renderSet);
byId('printBtn').addEventListener('click', () => {
  if (!hasSet) renderSet();
  window.print();
});
ansChk.addEventListener('change', () => { if (hasSet) renderSet(); });

buildTabs();
fillOptions();
renderSet();
