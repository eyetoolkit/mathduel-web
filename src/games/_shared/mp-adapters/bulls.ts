/**
 * Bulls & Cows 竞赛适配器（服务端 gameType='bulls'，mode='duel'，maxPlayers=2）
 * 协议（worker/.../durable/game-room.js：805-975）：
 *   - 服务端推送 bulls_new_round{round,maxRounds,phase:'set_secret',deadline,players}
 *   - 服务端推送 bulls_phase{phase,turn,deadline,ready}
 *   - 客户端发送 {type:'bulls_set_secret', secret:'1234'}（4 位不重复 1-9）
 *   - 双方就绪 → bulls_phase{phase:'guess',turn:firstName,deadline}
 *   - 客户端发送 {type:'bulls_guess', guess:'1234'}（仅 turn===name 接受）
 *   - 服务端推送 bulls_result{guesser,guess,a,b,history,winner}（a===4 触发 round 结束）
 *   - 服务端推送 bulls_round_over{round,winner,reason,secrets,scores}
 *   - 终局 game_over{ranking,elo}
 */
import type { MpAdapter, RoundCtx, MpShell } from '../mp-client';
import { isValidSecret, randomSecret } from '../../bulls/engine';

export interface BullsAdapterOpts {
  label: string;
  difficulty?: 'easy' | 'normal' | 'hard';
  rounds?: number;
  raceMax?: number;
}

interface HistoryEntry { guess: string; a: number; b: number; guesser: string }

export function createBullsAdapter(opts: BullsAdapterOpts): MpAdapter {
  let currentPhase: 'set_secret' | 'guess' | 'round_over' = 'set_secret';
  let turnName = '';
  let readySet: string[] = [];
  let mySecret = '';
  let oppSecret = '';  // round_over 后揭晓
  let lastSecrets: Record<string, string> = {};
  let history: HistoryEntry[] = [];
  let scores: Record<string, number> = {};
  let lastRoundWinner = '';
  let lastRoundReason = '';
  let myName = '';
  let myGuess = '';
  let lastGuessErr = '';

  const myStoredName = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('mp_name') || '' : '');

  const render = (boardEl: HTMLElement, shell: MpShell) => {
    boardEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;width:min(420px,86vw)';

    if (currentPhase === 'set_secret') {
      const title = document.createElement('div');
      title.style.cssText = 'font-size:14px;color:#6B7280';
      title.innerHTML = readySet.length ? `<b style="color:#B45309">Waiting…</b> ${readySet.length}/2 ready` : '<b style="color:#B45309">Set your 4-digit secret</b> (1-9, no repeats)';
      wrap.appendChild(title);

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.maxLength = 4;
      input.value = mySecret;
      input.style.cssText = 'width:160px;height:48px;background:#F9FAFB;border:2px solid #F59E0B;border-radius:10px;color:#B45309;font-size:28px;font-weight:800;letter-spacing:14px;text-align:center;font-family:inherit';
      input.addEventListener('input', () => {
        mySecret = (input.value || '').replace(/\D/g, '').slice(0, 4);
        input.value = mySecret;
        lockBtn.disabled = !isValidSecret(mySecret);
        lockBtn.style.opacity = lockBtn.disabled ? '.5' : '1';
        lockBtn.style.pointerEvents = lockBtn.disabled ? 'none' : 'auto';
        errEl.textContent = '';
      });
      wrap.appendChild(input);

      const errEl = document.createElement('div');
      errEl.style.cssText = 'min-height:18px;font-size:12px;color:#DC2626';
      wrap.appendChild(errEl);

      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.textContent = mySecret && readySet.includes(myName) ? '🔒 Submitted · waiting' : '🔒 Lock Secret';
      lockBtn.disabled = true;
      lockBtn.style.cssText = 'background:#F59E0B;color:#1a1305;border:none;border-radius:10px;padding:10px 22px;font-weight:700;cursor:pointer;font-size:14px;opacity:.5;pointer-events:none';
      lockBtn.addEventListener('click', () => {
        if (!isValidSecret(mySecret)) { errEl.textContent = 'Need 4 unique digits 1-9'; return; }
        shell.sendAction({ type: 'bulls_set_secret', secret: mySecret });
        lockBtn.disabled = true;
        lockBtn.textContent = '🔒 Submitted · waiting';
      });
      wrap.appendChild(lockBtn);

      const tip = document.createElement('p');
      tip.style.cssText = 'color:#9CA3AF;font-size:12px;margin:4px 0 0';
      tip.innerHTML = `Both players lock in to start guessing. You have ${Math.round((shell as any).timeLimit || 30)}s.`;
      wrap.appendChild(tip);
    } else if (currentPhase === 'guess') {
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;width:100%;font-size:13px;color:#6B7280';
      const mine = myName && turnName === myName ? '<b style="color:#B45309">Your turn</b>' : `Waiting · ${turnName || '—'} guessing`;
      header.innerHTML = `<span>${mine}</span><span>Score: ${Object.entries(scores).map(([n, s]) => `${n} ${s}`).join(' · ') || '—'}</span>`;
      wrap.appendChild(header);

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.maxLength = 4;
      input.value = myGuess;
      input.disabled = !myName || turnName !== myName;
      input.style.cssText = 'width:160px;height:48px;background:#F9FAFB;border:2px solid ' + (turnName === myName ? '#F59E0B' : '#E5E7EB') + ';border-radius:10px;color:#B45309;font-size:28px;font-weight:800;letter-spacing:14px;text-align:center;font-family:inherit';
      input.addEventListener('input', () => {
        myGuess = (input.value || '').replace(/\D/g, '').slice(0, 4);
        input.value = myGuess;
        guessBtn.disabled = myGuess.length !== 4 || turnName !== myName;
        guessBtn.style.opacity = guessBtn.disabled ? '.5' : '1';
        errEl.textContent = '';
      });
      input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') guessBtn.click(); });
      wrap.appendChild(input);

      const errEl = document.createElement('div');
      errEl.style.cssText = 'min-height:18px;font-size:12px;color:#DC2626';
      if (lastGuessErr) errEl.textContent = lastGuessErr;
      wrap.appendChild(errEl);

      const guessBtn = document.createElement('button');
      guessBtn.type = 'button';
      guessBtn.textContent = '🎯 Guess';
      guessBtn.disabled = true;
      guessBtn.style.cssText = 'background:#F59E0B;color:#1a1305;border:none;border-radius:10px;padding:10px 22px;font-weight:700;cursor:pointer;font-size:14px;opacity:.5;pointer-events:none';
      guessBtn.addEventListener('click', () => {
        if (myGuess.length !== 4) return;
        if (!myName || turnName !== myName) return;
        shell.sendAction({ type: 'bulls_guess', guess: myGuess });
        lastGuessErr = '';
        myGuess = '';
        guessBtn.disabled = true;
      });
      wrap.appendChild(guessBtn);

      // 历史（自己 + 对手）
      if (history.length) {
        const hist = document.createElement('div');
        hist.style.cssText = 'width:100%;margin-top:6px;display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto';
        for (const h of history.slice(-8).reverse()) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:6px 10px;font-size:13px';
          const color = h.guesser === myName ? '#F59E0B' : '#6B7280';
          row.innerHTML = `<span style="color:${color}">${escapeHtml(h.guesser)} <b style="letter-spacing:4px">${escapeHtml(h.guess)}</b></span><span><b style="color:#16A34A">${h.a}A</b> <span style="color:#6B7280">${h.b}B</span></span>`;
          hist.appendChild(row);
        }
        wrap.appendChild(hist);
      }
    } else {
      // round_over
      const head = document.createElement('div');
      head.style.cssText = 'font-size:14px;color:#6B7280;text-align:center';
      head.innerHTML = lastRoundWinner === myName ? '<b style="color:#16A34A">🏆 You cracked it!</b>' : (lastRoundWinner ? `<b>${escapeHtml(lastRoundWinner)}</b> cracked it` : '<b>Round over</b>');
      wrap.appendChild(head);
      const reason = document.createElement('div');
      reason.style.cssText = 'font-size:12px;color:#9CA3AF';
      reason.textContent = lastRoundReason === 'cracked' ? 'Code broken — next round in 3s' : 'Time up — next round in 3s';
      wrap.appendChild(reason);

      if (oppSecret || mySecret) {
        const reveal = document.createElement('div');
        reveal.style.cssText = 'display:flex;gap:14px;margin-top:6px;font-size:13px';
        reveal.innerHTML = `<span>Your code: <b style="color:#B45309;letter-spacing:4px">${escapeHtml(mySecret || '—')}</b></span><span>Opponent: <b style="color:#6B7280;letter-spacing:4px">${escapeHtml(oppSecret || '—')}</b></span>`;
        wrap.appendChild(reveal);
      }
    }

    boardEl.appendChild(wrap);
  };

  return {
    gameType: 'bulls',
    label: opts.label,
    difficulty: opts.difficulty,
    rounds: opts.rounds,
    raceMax: opts.raceMax,
    // 服务端固定 maxPlayers=2；adapter 暴露让 createRoom 调用时强制 2
    makeDemoPuzzle(_round: number) {
      mySecret = randomSecret();
      return { phase: 'set_secret', mySecret };
    },
    renderRound(payload: any, _ctx: RoundCtx, boardEl: HTMLElement, shell: MpShell) {
      currentPhase = (payload.phase as any) || 'set_secret';
      mySecret = '';
      myGuess = '';
      lastGuessErr = '';
      history = [];
      lastRoundWinner = '';
      lastRoundReason = '';
      oppSecret = '';
      scores = {};
      render(boardEl, shell);
    },
    onMessage(msg: any, shell: MpShell): boolean {
      if (msg.type === 'bulls_phase') {
        currentPhase = (msg.phase as any) || currentPhase;
        turnName = msg.turn || '';
        readySet = Array.isArray(msg.ready) ? msg.ready : [];
        if (currentPhase === 'guess' && turnName === myName) {
          // 我的回合
        }
        render(shell['boardEl'] || (shell as any).boardEl, shell);
        return true;
      }
      if (msg.type === 'bulls_result') {
        const a = Number(msg.a || 0), b = Number(msg.b || 0);
        history.push({ guess: String(msg.guess || ''), a, b, guesser: String(msg.guesser || '') });
        if (msg.guesser === myName) { myGuess = ''; shell.markSolved(); }
        lastGuessErr = msg.error || '';
        render((shell as any).boardEl, shell);
        return true;
      }
      if (msg.type === 'bulls_round_over') {
        currentPhase = 'round_over';
        lastRoundWinner = String(msg.winner || '');
        lastRoundReason = String(msg.reason || '');
        lastSecrets = msg.secrets || {};
        scores = msg.scores || scores;
        oppSecret = lastSecrets[Object.keys(lastSecrets).find((n) => n !== myName) || ''] || '';
        render((shell as any).boardEl, shell);
        return true;
      }
      // 记下自己的名字（首次拿到回合时同步）
      if (msg.players && Array.isArray(msg.players)) {
        for (const p of msg.players) {
          if (typeof p === 'string') {
            if (p === myStoredName()) myName = p;
          } else if (p && p.name && p.name === myStoredName()) myName = p.name;
        }
      }
      return false;
    },
  };
}

function escapeHtml(s: string): string {
  const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
}