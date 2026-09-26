'use strict';
/* ═══════════════════════════════════════════════════════════════
   MathDuel · Teacher dashboard — logic (Worker API edition)
   ────────────────────────────────────────────────────────────────
   与设计包原实现的两处决定性差异：
     1. 认证：复用站点已有的邮箱+密码 auth（POST /api/auth/login），
        不再引入 Supabase magic-link —— 老师账号与游戏账号是同一套，
        且不需要第二套后端。
     2. 数据：全部走 Worker 服务端通道 /api/teacher/*。房间码由服务端
        注册后下发（原设计的本地随机码会让扫码的学生必然 404），
        作答回写也经服务端，任何写库密钥都不会出现在浏览器里。
   合规：FERPA-light —— 学生侧只有代号，界面与存储都不接触真实姓名。
   ═══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const API = '/api';
const TS_SITEKEY = '0x4AAAAAAE9UnLMYQbPPsK5Q';   // 与主站 auth-modal 同 key

let classes = [];
let current = null;
let roster = [];
let assignment = null;
let report = null;
let games = [];
let liveTimer = null;

/* ─── API ─── */
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { showAuth(); throw new Error('auth_required'); }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || res.statusText || 'request_failed');
  return data;
}

/* ─── auth（复用站点现有账号体系） ─── */
let tsToken = 'skip';
function renderTurnstile() {
  try {
    if (!window.turnstile) return false;
    window.turnstile.render('#turnstile-container', {
      sitekey: TS_SITEKEY,
      theme: 'light',
      callback: (t) => { tsToken = t; },
      'error-callback': () => { tsToken = 'error'; },
      'expired-callback': () => { tsToken = 'expired'; },
    });
    return true;
  } catch (e) { return false; }
}
function waitTurnstile() {
  if (renderTurnstile()) return;
  let n = 0;
  const iv = setInterval(() => {
    n++;
    if (renderTurnstile() || n > 40) clearInterval(iv);
  }, 200);
}

function showAuth(msg) {
  $('auth').classList.add('on');
  if (msg) $('authErr').textContent = msg;
}
function hideAuth() { $('auth').classList.remove('on'); $('authErr').textContent = ''; }

$('authSend').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const password = $('authPass').value;
  if (!email || !password) { showAuth('Email and password are required.'); return; }
  $('authSend').disabled = true;
  $('authErr').textContent = '';
  try {
    const res = await fetch(API + '/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, turnstile_token: tsToken }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const map = {
        turnstile_failed: 'Human check failed — please refresh and retry.',
        invalid_credentials: 'Wrong email or password.',
        email_not_verified: 'Please verify your email first (check your inbox).',
      };
      showAuth(map[j.error] || (j.error || 'Login failed'));
      waitTurnstile();
      return;
    }
    hideAuth();
    await boot();
  } catch (e) {
    showAuth('Network error — please retry.');
  } finally {
    $('authSend').disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await fetch(API + '/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* ignore */ }
  classes = []; current = null; assignment = null; report = null; roster = [];
  showAuth('Signed out.');
});

/* ─── boot ─── */
async function boot() {
  try {
    const me = await api('/teacher/me');
    if (me && me.teacher && me.teacher.name) $('who').textContent = '👋 ' + me.teacher.name;
    games = (await api('/teacher/games')).games || [];
    fillGames();
    classes = (await api('/teacher/classes')).classes || [];
    if (!current && classes.length) current = classes[0].id;
    renderRail();
    if (current) await loadClass(current);
    else {
      emptyState();
      toast('Create your first class to start');
    }
  } catch (e) {
    if (e.message !== 'auth_required') toast('⚠ ' + e.message);
  }
}

function fillGames() {
  const sel = $('fGame');
  sel.innerHTML = '';
  for (const g of games) {
    const o = document.createElement('option');
    o.value = g.slug;
    o.textContent = g.label + (g.note ? ' · ' + g.note : '');
    sel.appendChild(o);
  }
}

async function loadClass(id) {
  current = id;
  renderRail();
  try {
    roster = (await api('/teacher/classes/' + id + '/roster')).roster || [];
    const list = (await api('/teacher/assignments?classId=' + id)).assignments || [];
    assignment = list.length ? await api('/teacher/assignments/' + list[list.length - 1].id) : { assignment: null, report: null };
    report = assignment.report;
    assignment = assignment.assignment;
  } catch (e) { toast('⚠ ' + e.message); return; }
  renderOverview();
  renderBoard();
}

/* ─── render ─── */
function renderRail() {
  const rail = document.querySelector('.rail');
  [...rail.querySelectorAll('.cls')].forEach((n) => n.remove());
  const add = $('addc');
  classes.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'cls' + (c.id === current ? ' on' : '');
    const words = String(c.name || '??').trim().split(/\s+/);
    const code = (words[words.length - 1] || '??').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || '??';
    b.innerHTML = `<span class="ci">${esc(code)}</span><span><span class="cn">${esc(c.name)}</span><br><span class="cs">${esc(c.grade || 'class')}</span></span>`;
    b.addEventListener('click', () => loadClass(c.id));
    rail.insertBefore(b, add);
  });
}

function fmtMs(ms) {
  if (!ms) return '—';
  const s = ms / 1000;
  return s >= 60 ? Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's' : s.toFixed(1) + 's';
}

function renderOverview() {
  if (!report || !assignment) { emptyState(); return; }
  const rows = report.rows || [];
  const sm = report.summary || {};
  $('aGame').textContent = assignment.gameLabel || assignment.game;
  $('aMode').textContent = assignment.mode === 'battle' ? '🏅 Competition (rated)' : '📝 Practice (no rating)';
  $('aDone').textContent = sm.completed || 0;
  $('aTotal').textContent = sm.students || 0;
  $('aPend').textContent = Math.max(0, (sm.students || 0) - (sm.started || 0));
  const due = assignment.dueAt ? new Date(assignment.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  $('aDue').textContent = due ? '📅 due ' + due : '📅 no due';

  // 班级运算薄弱点（服务端算好的百分比）
  $('weakTtl').textContent = 'Class weak spot · ' + (assignment.gameLabel || assignment.game);
  const w = $('weak');
  w.innerHTML = '';
  if (!(report.ops || []).length) {
    w.innerHTML = '<div class="mini" style="padding:10px 0">No attempts yet — students need to finish a round first.</div>';
  }
  (report.ops || []).forEach(({ op, sym, v }) => {
    if (op !== 'divide' && op !== 'multiply' && op !== 'add' && op !== 'subtract') return;
    const cls = v < 60 ? 'low' : v < 85 ? 'mid' : 'hi';
    const el = document.createElement('div');
    el.className = 'oprow ' + cls;
    // 冗余编码：条 + 百分比数字 + 高低标识，不单靠红绿区分（色盲友好）
    const mark = v < 60 ? '⚠ ' : v < 85 ? '· ' : '✓ ';
    el.innerHTML = `<span class="op">${esc(sym)}</span><span class="bar"><i style="width:0%"></i></span><span class="pc">${mark}${v}%</span>`;
    w.appendChild(el);
    requestAnimationFrame(() => { el.querySelector('i').style.width = Math.max(0, Math.min(100, v)) + '%'; });
  });

  const g = $('glance');
  g.innerHTML = '';
  [['✅ Completion', (sm.completion || 0) + '%'],
   ['🎯 Avg accuracy', (sm.avgAcc || 0) + '%'],
   ['⏱ Avg solve time', fmtMs(sm.avgMs || 0)],
   ['👥 Started', `${sm.started || 0}/${sm.students || 0}`]].forEach(([k, v]) => {
    const el = document.createElement('div');
    el.className = 'oprow hi';
    el.innerHTML = `<span class="op" style="width:auto">${k}</span><span class="mini" style="margin-left:auto;font-family:var(--disp);font-weight:700;color:var(--ink)">${esc(String(v))}</span>`;
    g.appendChild(el);
  });
  const gaps = (report.ops || []).slice().filter(o => ['divide', 'multiply', 'add', 'subtract'].includes(o.op)).sort((a, b) => a.v - b.v);
  const biggest = gaps[0];
  $('glanceNote').textContent = biggest && biggest.v < 70
    ? `${biggest.sym} combinations are the class's biggest gap — worth a reteach.`
    : (rows.length ? 'No major gaps — the class is on track.' : 'Waiting for student attempts.');

  const tb = $('stuBody');
  tb.innerHTML = '';
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="5" class="mini" style="padding:14px">No student codes yet. Add a roster, or let students join with the room code.</td></tr>';
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    const doneOk = assignment.rounds ? r.solved >= assignment.rounds : r.solved > 0;
    const ak = r.acc >= 85;
    const weak = r.weak ? `<span class="tagv weak">${esc(r.weak)}</span>` : '<span class="mini">—</span>';
    tr.innerHTML = `<td><div class="stu"><span class="av">${esc(r.code)}</span></div></td>
      <td><span class="tagv ${doneOk ? 'ok' : 'no'}">${r.solved} / ${r.attempted || '—'}</span></td>
      <td><span class="tagv ${ak ? 'ok' : 'no'}">${r.rounds ? r.acc + '%' : '—'}</span></td>
      <td class="mini">${fmtMs(r.avgMs)}</td>
      <td>${weak}</td>`;
    tb.appendChild(tr);
  });
}

function renderBoard() {
  if (!assignment) return;
  const c = classes.find((x) => x.id === current);
  $('bClass').textContent = `${c ? c.name : 'Class'} · ${assignment.gameLabel || assignment.game}`;
  $('bTitle').textContent = assignment.title || '—';
  $('bCode').textContent = assignment.roomCode || '—';
  $('bTime').textContent = `⏱ ${assignment.timeLimit || '—'}s · ${assignment.rounds || '—'} rounds`;
  $('bDone').textContent = `✅ ${(report && report.summary && report.summary.started) || 0}/${(report && report.summary && report.summary.students) || 0}`;
}

function emptyState() {
  ['aDone', 'aTotal', 'aPend'].forEach((id) => $(id).textContent = '0');
  $('aGame').textContent = '—';
  $('aMode').textContent = '—';
  ['weak', 'glance', 'stuBody'].forEach((s) => $(s).innerHTML = '');
  $('weak').innerHTML = '<div class="mini" style="padding:10px 0">Assign your first practice to see class data.</div>';
}

/* ─── tabs ─── */
function switchTab(v) {
  const map = { over: 'viewOver', assign: 'viewAssign', board: 'viewBoard' };
  ['over', 'assign', 'board'].forEach((k) => {
    const on = k === v;
    $('tab' + k.charAt(0).toUpperCase() + k.slice(1)).classList.toggle('on', on);
    $(map[k]).style.display = on ? '' : 'none';
  });
  if (v === 'board') { pollLive(); startLive(); }
  else stopLive();
}
$('tabOver').addEventListener('click', () => switchTab('over'));
$('tabAssign').addEventListener('click', () => switchTab('assign'));
$('tabBoard').addEventListener('click', () => switchTab('board'));
$('boardBtn').addEventListener('click', () => switchTab('board'));

/* ─── live standings (Board) ─── */
function startLive() { stopLive(); liveTimer = setInterval(pollLive, 5000); }
function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }

async function pollLive() {
  if (!assignment) return;
  try {
    const d = await api('/teacher/assignments/' + assignment.id + '/live');
    const tb = $('boardBody');
    tb.innerHTML = '';
    const lb = d.leaderboard || [];
    if (!lb.length) {
      tb.innerHTML = '<tr><td colspan="5" class="mini" style="padding:14px">Waiting for students to join…</td></tr>';
    }
    lb.slice(0, 20).forEach((r) => {
      const tr = document.createElement('tr');
      if (r.active) tr.className = 'live';
      tr.innerHTML = `<td class="rk">${r.rank}</td><td><b>${esc(r.code)}</b></td><td>${r.solved}</td><td>${r.rounds ? r.acc + '%' : '—'}</td><td class="mini">${fmtMs(r.avgMs)}</td>`;
      tb.appendChild(tr);
    });
    $('bDone').textContent = `✅ ${d.summary.started}/${d.summary.students}`;
    $('bLive').textContent = '● live · updated ' + new Date().toLocaleTimeString();
    $('bLive').className = 'pg on';
  } catch (e) { /* 轮询失败静默，下次再试 */ }
}

/* ─── classes ─── */
$('newc').addEventListener('click', async () => {
  if (!await ensureAuth()) return;
  const name = prompt('Class name (e.g. Class 4B)');
  if (!name) return;
  const grade = prompt('Grade (e.g. Grade 4 / Year 3)', 'Grade 4');
  try {
    const d = await api('/teacher/classes', { method: 'POST', body: JSON.stringify({ name, grade }) });
    classes.push(d.class);
    await loadClass(d.class.id);
    toast('Created ' + name);
  } catch (e) { toast('⚠ ' + e.message); }
});
$('addc').addEventListener('click', () => $('newc').click());

/* ─── roster ─── */
$('rosterBtn').addEventListener('click', () => {
  const box = $('rosterBox');
  const on = box.style.display !== 'none';
  box.style.display = on ? 'none' : '';
  if (!on) $('rosterTA').value = roster.join('\n');
});
$('rosterSave').addEventListener('click', async () => {
  try {
    const d = await api('/teacher/classes/' + current + '/roster', {
      method: 'PUT',
      body: JSON.stringify({ codes: $('rosterTA').value.split(/[\s,;]+/).filter(Boolean) }),
    });
    roster = d.roster || [];
    $('rosterBox').style.display = 'none';
    toast('👥 Roster saved — ' + roster.length + ' codes');
    await loadClass(current);
  } catch (e) { toast('⚠ ' + e.message); }
});

/* ─── assignment generation：房间码来自服务端 ─── */
$('genBtn').addEventListener('click', async () => {
  if (!current) { toast('Pick or create a class first'); return; }
  const dueRaw = $('fDue').value;
  try {
    const d = await api('/teacher/assignments', {
      method: 'POST',
      body: JSON.stringify({
        classId: current,
        game: $('fGame').value,
        mode: $('fMode').value,
        difficulty: $('fDiff').value,
        rounds: parseInt($('fRounds').value, 10) || 5,
        timeLimit: parseInt($('fTime').value, 10) || 60,
        maxPlayers: parseInt($('fCap').value, 10) || 30,
        dueAt: dueRaw ? new Date(dueRaw + 'T23:59:00').toISOString() : null,
      }),
    });
    assignment = d.assignment;
    $('roomCode').textContent = d.roomCode;
    $('roomUrl').textContent = d.inviteUrl;
    $('roomBox').style.display = 'flex';
    $('qrBox').style.display = 'none';
    await loadClass(current);
    toast('🚀 Room ' + d.roomCode + ' ready — share with the class');
  } catch (e) { toast('⚠ ' + e.message); }
});

$('copyBtn').addEventListener('click', async () => {
  const txt = $('roomUrl').textContent;
  try { await navigator.clipboard.writeText(txt); toast('🔗 Invite copied to clipboard'); }
  catch (e) { toast('🔗 ' + txt); }
});

/* QR：用站点自托管库（与游戏内对联 dello stesso），不可扫 = 学生加不进来 */
$('qrBtn').addEventListener('click', () => {
  const box = $('qrBox');
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  box.style.display = '';
  drawQR($('qrCanvas'), $('roomUrl').textContent);
});

function drawQR(cv, text) {
  try {
    const g = window;
    if (typeof g.qrcode !== 'function') throw new Error('no_lib');
    const size = 200;
    cv.width = size; cv.height = size;
    const qr = g.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const mm = qr.getModuleCount();
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('no_ctx');
    const cell = Math.floor(size / mm);
    const off = Math.floor((size - cell * mm) / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#10142A';
    for (let r = 0; r < mm; r++) {
      for (let c = 0; c < mm; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
      }
    }
  } catch (e) {
    const ctx = cv.getContext('2d');
    if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
    toast('▦ QR unavailable — use the invite link instead');
  }
}

/* ─── CSV export ─── */
$('expBtn').addEventListener('click', () => {
  if (!report || !assignment) { toast('Nothing to export yet'); return; }
  const c = classes.find((x) => x.id === current);
  const rows = [['student_code', 'rounds_solved', 'rounds_attempted', 'accuracy_pct', 'avg_time_s', 'weak_op']];
  (report.rows || []).forEach((r) => rows.push([r.code, r.solved, r.attempted || 0, r.rounds ? r.acc : '', r.avgMs ? (r.avgMs / 1000).toFixed(1) : '', r.weak || '']));
  const csv = rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c ? c.name : 'class')}-${assignment.roomCode || 'report'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('📊 CSV exported');
});

/* ─── misc ─── */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
let toastId = null;
function toast(m) { const t = $('toast'); t.textContent = m; t.className = 'toast show'; clearTimeout(toastId); toastId = setTimeout(() => t.classList.remove('show'), 2600); }
async function ensureAuth() {
  try { await api('/teacher/me'); return true; } catch (e) { return false; }
}

/* screenshot hook: ?view=assign | ?view=board pre-switches tabs */
const v = new URLSearchParams(location.search).get('view');
if (v === 'assign' || v === 'board') switchTab(v);

/* ─── start ─── */
waitTurnstile();
(async () => { await ensureAuth().then((authed) => { if (!authed) showAuth(); else boot(); }); })();
