/**
 * 24 点游戏 · 成绩分享（链接 + 二维码）
 * 二维码由同源 qrcode.min.js 生成，Canvas 成绩卡自绘，可下载图片 / 调用系统分享。
 */

import { toast } from '@tri-sites/design-system';

export interface ShareData {
  daily?: boolean;
  competition?: boolean;
  key: string;
  session: string;
  solved: number;
  total: number;
  totalTime?: number;
  avg?: number;
  best?: number;
  rank?: number;
  success?: boolean;
}

declare const qrcode: (typeNumber: number, errorCorrectLevel: string) => {
  addData: (d: string) => void;
  make: () => void;
  createDataURL: (cellSize: number, margin: number) => string;
  getModuleCount: () => number;
  isDark: (r: number, c: number) => boolean;
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

export function buildShareUrl(d: ShareData): string {
  const base = location.origin + location.pathname;
  const p = new URLSearchParams();
  p.set('g', '24');
  if (d.daily) p.set('d', d.key.replace('#', ''));
  if (d.success) p.set('c', '1');
  if (d.competition) p.set('r', String(d.rank ?? 0));
  p.set('s', d.session);
  p.set('n', String(d.solved || 0));
  p.set('t', String(d.total || 0));
  if (d.totalTime) p.set('tt', String(Math.round(d.totalTime)));
  return base + '?' + p.toString();
}

export function renderQR(imgEl: HTMLImageElement, text: string): void {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    imgEl.src = qr.createDataURL(6, 10);
  } catch {
    imgEl.alt = 'QR code unavailable';
  }
}

function roundRect(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number): void {
  x.beginPath();
  x.moveTo(X + R, Y);
  x.arcTo(X + W, Y, X + W, Y + H, R);
  x.arcTo(X + W, Y + H, X, Y + H, R);
  x.arcTo(X, Y + H, X, Y, R);
  x.arcTo(X, Y, X + W, Y, R);
  x.closePath();
}

export function renderShareCard(canvas: HTMLCanvasElement, d: ShareData, streak: number): void {
  const W = 600;
  const H = 760;
  const x = canvas.getContext('2d');
  if (!x) return;

  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0f1b2e');
  g.addColorStop(1, '#08101d');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  const rg = x.createRadialGradient(W / 2, -60, 40, W / 2, 140, 560);
  rg.addColorStop(0, 'rgba(0,102,204,.45)');
  rg.addColorStop(1, 'rgba(0,102,204,0)');
  x.fillStyle = rg;
  x.fillRect(0, 0, W, H);

  x.strokeStyle = 'rgba(120,180,255,.45)';
  x.lineWidth = 3;
  x.strokeRect(18, 18, W - 36, H - 36);
  x.textAlign = 'center';

  const isComp = !!d.competition;
  const isDaily = !!d.daily;
  const big = isComp ? `#${d.rank || 0}` : `${d.solved} / ${d.total}`;
  const bigLabel = isComp ? 'My Rank' : 'Solved';

  x.fillStyle = '#BFDBFE';
  x.font = '700 38px "Space Grotesk", system-ui, sans-serif';
  x.fillText(isComp ? '🏆 Competition' : '📅 Daily Challenge', W / 2, 92);

  x.fillStyle = 'rgba(203,213,225,.72)';
  x.font = '500 20px "Sora", system-ui, sans-serif';
  x.fillText(isComp ? `Up to ${d.total} players` : d.key, W / 2, 126);

  x.fillStyle = '#4D97E6';
  x.font = '800 104px "Space Grotesk", system-ui, sans-serif';
  x.fillText(big, W / 2, 268);

  x.fillStyle = 'rgba(203,213,225,.85)';
  x.font = '600 22px "Sora", system-ui, sans-serif';
  x.fillText(bigLabel, W / 2, 304);

  if (isDaily && d.success) {
    x.fillStyle = '#34D399';
    x.font = '700 20px "Sora", system-ui, sans-serif';
    x.fillText('✓ CHALLENGE CLEARED', W / 2, 332);
  }

  const stats: [string, string][] = isComp
    ? [['Solved', String(d.solved || 0)], ['Players', String(d.total || 0)], ['Streak', String(streak)]]
    : [
        ['Total', `${d.totalTime ? d.totalTime.toFixed(1) : '0'}s`],
        ['Avg', `${d.avg ? d.avg.toFixed(1) : '0'}s`],
        ['Best', `${d.best ? d.best.toFixed(1) : '0'}s`],
      ];

  const bw = (W - 80) / 3;
  stats.forEach((s, i) => {
    const bx = 40 + i * bw;
    x.fillStyle = 'rgba(255,255,255,.06)';
    roundRect(x, bx, 360, bw - 16, 86, 16);
    x.fill();
    x.fillStyle = 'rgba(203,213,225,.7)';
    x.font = '600 16px "Sora", system-ui, sans-serif';
    x.fillText(s[0], bx + (bw - 16) / 2, 394);
    x.fillStyle = '#BFDBFE';
    x.font = '700 28px "Space Grotesk", system-ui, sans-serif';
    x.fillText(s[1], bx + (bw - 16) / 2, 430);
  });

  x.fillStyle = '#4D97E6';
  x.font = '700 20px "Space Grotesk", system-ui, sans-serif';
  x.fillText('MathDuel · Global Same Puzzle', W / 2, 545);
  x.fillStyle = 'rgba(203,213,225,.55)';
  x.font = '500 16px "Sora", system-ui, sans-serif';
  x.fillText("Scan to play today's 24 →", W / 2, 575);

  try {
    const qr = qrcode(0, 'M');
    qr.addData(buildShareUrl(d));
    qr.make();
    const mm = qr.getModuleCount();
    const cell = Math.floor(116 / mm);
    const offX = W - 44 - 116;
    const offY = H - 44 - 116;
    x.fillStyle = '#fff';
    x.fillRect(offX - 7, offY - 7, 130, 130);
    x.fillStyle = '#08101d';
    for (let r = 0; r < mm; r++) for (let c = 0; c < mm; c++) if (qr.isDark(r, c)) x.fillRect(offX + c * cell, offY + r * cell, cell, cell);
  } catch {
    /* 二维码失败不影响成绩卡其余部分 */
  }
}

let lastShare: ShareData | null = null;

export function openShareOverlay(d: ShareData, streak: number): void {
  lastShare = d;
  const ov = $('shareOverlay');
  if (!ov) return;

  const canvas = $<HTMLCanvasElement>('shareCanvas');
  const urlInput = $<HTMLInputElement>('shareUrl');
  const title = $('shareTitle');
  const qrImg = $<HTMLImageElement>('shareQr');

  if (canvas) renderShareCard(canvas, d, streak);
  const url = buildShareUrl(d);
  if (urlInput) urlInput.value = url;
  if (title) {
    title.textContent = d.competition
      ? '🏆 Competition Results'
      : d.daily
        ? d.success || d.solved === d.total
          ? '🎉 今日挑战成功!'
          : '📅 Daily Challenge Results'
        : '🏆 My 24 Score';
  }
  if (qrImg) renderQR(qrImg, url);
  ov.classList.add('show');
}

export function hideShareOverlay(): void {
  $('shareOverlay')?.classList.remove('show');
}

export function initShareBindings(): void {
  $('shareClose')?.addEventListener('click', hideShareOverlay);
  $('shareOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('shareOverlay')) hideShareOverlay();
  });

  $('shareCopy')?.addEventListener('click', async () => {
    const v = $<HTMLInputElement>('shareUrl')?.value || '';
    const btn = $('shareCopy');
    try {
      await navigator.clipboard.writeText(v);
    } catch {
      const i = $<HTMLInputElement>('shareUrl');
      i?.select();
      document.execCommand('copy');
    }
    toast('Share link copied');
    if (btn) {
      btn.textContent = '✅ Copied';
      window.setTimeout(() => (btn.textContent = '📋 Copy'), 1400);
    }
  });

  $('shareDownload')?.addEventListener('click', () => {
    const c = $<HTMLCanvasElement>('shareCanvas');
    if (!c) return;
    const a = document.createElement('a');
    a.download = `24-points-${lastShare?.key ? lastShare.key.replace('#', '') : Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    toast('Image saved');
  });

  $('shareWechat')?.addEventListener('click', () => {
    const v = $<HTMLInputElement>('shareUrl')?.value || '';
    const d = lastShare;
    const text = d
      ? d.daily
        ? `I solved ${d.solved} / ${d.total} in today's 24 Daily Challenge!`
        : d.competition
          ? `I ranked #${d.rank || 0} in the Math Competition!`
          : 'My 24 score'
      : 'Come play Make 24';
    if (navigator.share) {
      navigator.share({ title: '24 · Card Table', text, url: v }).catch(() => {});
    } else {
      toast('Tap ··· to share with friends');
    }
  });
}
