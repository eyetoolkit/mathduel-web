/* ═══════════════════════════════════════════════════════════════
   老师端 · 学生端归因（只有课堂作业链接会带 tid=1 才生效）
   ────────────────────────────────────────────────────────────────
   为什么必须存在：原设计包的看板依赖 class_play_sessions 回写，但包里
   没有任何游戏端代码做这件事，且学生是纯匿名 —— 没有「输入班级代号」
   这一步，服务端拿到的作答无法归因到花名册，看板永远是空的。

   为什么只在 tid=1 时启用：老师分享的邀请链接带 tid=1，普通好友对战
   链接不带 —— 这样教室外的玩家不会被"请输入代号"打扰。

   合规：只传代号（S01），永不传真实姓名。
   ═══════════════════════════════════════════════════════════════ */

const LS_KEY = 'md_classroom_codes_v1';

type CodeMap = Record<string, string>;

function readMap(): CodeMap {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw as CodeMap : {};
  } catch {
    return {};
  }
}

function writeMap(m: CodeMap): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch { /* 隐私模式下忽略 */ }
}

/** 是否为老师端课堂邀请链接 */
export function isClassroom(): boolean {
  try {
    return new URLSearchParams(location.search).get('tid') === '1';
  } catch {
    return false;
  }
}

/** 当前页面 URL 上的房间码（老师邀请链接会把房间码放在 ?room=） */
export function urlRoomCode(): string | null {
  try {
    const p = new URLSearchParams(location.search);
    const rc = (p.get('room') || p.get('c') || '').trim().toUpperCase();
    return rc || null;
  } catch {
    return null;
  }
}

/** 本机已绑定的代号（换取家庭/同一台机器重复上课不必重输） */
export function studentCodeFor(room: string): string | null {
  if (!room) return null;
  return readMap()[room] || null;
}

function remember(room: string, code: string): void {
  const m = readMap();
  m[room] = code;
  writeMap(m);
}

export interface RoundPayload {
  round?: number;
  solved: boolean;
  duration_ms?: number;
  wrong?: number;
  ops?: string[];
}

/* ─── 代号输入弹窗 ─── */
let promptEl: HTMLDivElement | null = null;

function ensureStyles(): void {
  if (document.getElementById('mdClassroomCss')) return;
  const st = document.createElement('style');
  st.id = 'mdClassroomCss';
  st.textContent = `
  .mdcls-wrap{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(16,20,42,.55);backdrop-filter:blur(3px);font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
  .mdcls-box{background:#fff;border-radius:18px;padding:24px 22px;width:min(360px,92vw);box-shadow:0 20px 60px rgba(16,20,42,.3)}
  .mdcls-box h3{margin:0 0 6px;font-size:1.1rem;color:#10142A}
  .mdcls-box p{margin:0 0 14px;font-size:.8rem;color:#6B7290;line-height:1.5}
  .mdcls-box input{width:100%;border:1.5px solid #E3E7F0;border-radius:11px;padding:12px 13px;font-size:1.05rem;letter-spacing:.06em;text-transform:uppercase;font-family:system-ui,sans-serif}
  .mdcls-box input:focus{outline:none;border-color:#3730A3}
  .mdcls-box button{margin-top:13px;width:100%;background:#3730A3;color:#fff;border:0;border-radius:11px;font-weight:700;font-size:.92rem;padding:12px}
  .mdcls-box button:disabled{opacity:.5}
  .mdcls-err{color:#DC2626;font-size:.75rem;font-weight:700;margin-top:8px;min-height:1em}
  .mdcls-skip{background:transparent!important;color:#6B7290!important;font-size:.8rem!important;margin-top:6px!important;padding:6px!important}
  `;
  document.head.appendChild(st);
}

/**
 * 确保学生已绑定班级代号：已绑定直接返回；否则弹出一次性输入。
 * 「跳过」或关闭都返回 null —— 不强制归因，玩家仍可正常游戏，只是不计入学情看板。
 */
export function ensureStudentCode(room: string): Promise<string | null> {
  const prev = studentCodeFor(room);
  if (prev) return Promise.resolve(prev);
  ensureStyles();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'mdcls-wrap';
    wrap.innerHTML = `
      <div class="mdcls-box">
        <h3>Enter your class code</h3>
        <p>Your teacher gave you a code (like <b>S07</b>). It's how your work gets counted — no name needed.</p>
        <input id="mdclsInput" maxlength="12" autocomplete="off" placeholder="S07" />
        <div class="mdcls-err" id="mdclsErr"></div>
        <button id="mdclsOk">Start</button>
        <button class="mdcls-skip" id="mdclsSkip">Skip for now</button>
      </div>`;
    document.body.appendChild(wrap);
    promptEl = wrap as HTMLDivElement;

    const input = wrap.querySelector('#mdclsInput') as HTMLInputElement;
    const errEl = wrap.querySelector('#mdclsErr') as HTMLDivElement;
    const okBtn = wrap.querySelector('#mdclsOk') as HTMLButtonElement;
    const skipBtn = wrap.querySelector('#mdclsSkip') as HTMLButtonElement;

    const close = (code: string | null) => {
      if (promptEl === wrap) promptEl = null;
      wrap.remove();
      if (code) remember(room, code);
      resolve(code);
    };

    const submit = async () => {
      const code = input.value.trim().toUpperCase();
      if (!code) { errEl.textContent = 'Please enter your code.'; return; }
      okBtn.disabled = true;
      okBtn.textContent = 'Checking…';
      try {
        const res = await fetch('/api/teacher/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ roomCode: room, code }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          errEl.textContent = (j && j.error === 'room_not_found')
            ? 'This room has expired — ask your teacher for a new link.'
            : 'Could not join. Please check the code.';
          okBtn.disabled = false;
          okBtn.textContent = 'Start';
          return;
        }
        if (j && j.ok === false) {
          errEl.textContent = j.reason === 'not_on_roster'
            ? 'This code is not on the class list — check with your teacher.'
            : 'Not accepted. Check with your teacher.';
          okBtn.disabled = false;
          okBtn.textContent = 'Start';
          return;
        }
        close(code);
      } catch {
        errEl.textContent = 'Network error — try again.';
        okBtn.disabled = false;
        okBtn.textContent = 'Start';
      }
    };

    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    skipBtn.addEventListener('click', () => close(null));
    setTimeout(() => { try { input.focus(); } catch { /* ignore */ } }, 60);
  });
}

/** 单轮成绩回写（fire-and-forget：失败不影响游戏） */
export function reportRound(room: string | null, payload: RoundPayload): void {
  if (!room) return;
  const code = studentCodeFor(room);
  if (!code) return;                       // 没绑定 → 不计入看板（仍可正常玩）
  try {
    fetch('/api/teacher/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ roomCode: room, code, ...payload }),
      keepalive: true,
    }).catch(() => { /* 静默：回写失败不打扰玩家 */ });
  } catch { /* ignore */ }
}

/** 从表达式里抽取用到的运算符（24 点专用，其余游戏返回空数组） */
export function opsFromExpression(expr: string): string[] {
  const set = new Set<string>();
  for (const ch of String(expr || '')) {
    if (ch === '+') set.add('+');
    else if (ch === '-' || ch === '−') set.add('−');
    else if (ch === '*' || ch === '×' || ch === '·') set.add('×');
    else if (ch === '/' || ch === '÷') set.add('÷');
  }
  return [...set];
}
