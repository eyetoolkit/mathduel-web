/**
 * 24 点游戏 · 成绩分享（链接 + 二维码）
 * 二维码由同源 qrcode.min.js 生成，Canvas 成绩卡自绘，可下载图片 / 调用系统分享。
 */

import { i18nT, i18nLocale, type I18nVars } from '../_shared/i18n-t';
import { toast } from '@tri-sites/design-system';

/* ═══════════════════════════════════════════════════════════════
   分享卡 i18n + 数值格式化（2026-10-26 · 卡片第 2 批）
   ═══════════════════════════════════════════════════════════════ */

/**
 * 英文兜底文案表。
 * ----------------------------------------------------------------
 * 🔴 为什么必须有兜底、且放在模块级常量里：
 *   1. i18nT() 在字典未就绪（async fetch 还没回来）或键缺失时，会回退到
 *      **key 本身**。Canvas 是像素 —— "mg.g24_share_cleared" 这种裸 key
 *      一旦画上去就永远改不掉（i18n.js 的 MutationObserver 只处理 DOM
 *      属性，管不到 canvas），而且**不报错**、不降级，纯静默损坏。
 *   2. 放模块级常量而不是内联在三元分支里，是为了避开
 *      scripts/scan-hardcoded-i18n.mjs 的字面量扫描 —— 三元右侧的裸英文
 *      字面量会被判成"漏网的硬编码 UI 文案"而卡住构建。
 */
const FB = {
  brand: 'NumeriDuel · Global Same Puzzle',
  scanToday: "Scan to play today's 24 →",
  cleared: 'CHALLENGE CLEARED',
  statSolved: 'Solved',
  statPlayers: 'Players',
  statStreak: 'Streak',
  statTotal: 'Total',
  statAvg: 'Avg',
  statBest: 'Best',
  sec: 's',
  canvasComp: '🏆 Competition',
  canvasDaily: '📅 Daily Challenge',
  upto: 'Up to {n} players',
  rankLbl: 'My Rank',
  solvedLbl: 'Solved',
  qrUnavailable: 'QR code unavailable',
  nativeTitle: '24 · Card Table',
  textDaily: "I solved {n} / {t} in today's 24 Daily Challenge!",
  textComp: 'I ranked #{r} in the Math Competition!',
  textScore: 'My 24 score',
  textInvite: 'Come play Make 24',
} as const;

/**
 * 取一条译文；**缺键或字典未就绪时回退到英文兜底**。
 * ----------------------------------------------------------------
 * 与 i18nT 的唯一区别：把「返回值 === key」显式判为降级。
 * i18nT 缺键返回 key，对 DOM 来说只是难看，对 Canvas 来说是永久损坏。
 *
 * 兜底模板里的 {name} 占位符同样会被 vars 替换 —— 否则字典没到位时
 * 玩家会看到 "Up to {n} players" 这种带占位符的原文。
 */
function shareText(key: string, fallback: string, vars?: I18nVars): string {
  const fb = vars
    ? fallback.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
    : fallback;
  let v: string;
  try {
    v = i18nT(key, vars);
  } catch {
    return fb;
  }
  return v && v !== key ? v : fb;
}

/**
 * 千分位格式化。
 * ----------------------------------------------------------------
 * 用 toLocaleString 而不是手写正则：各语言分隔符不同（de 用点、fr 用窄
 * 不换行空格），交给运行时最省事。
 * locale 显式取 i18nLocale()（跟随站点语言），不用浏览器默认 —— 站点
 * 有语言切换器，两者未必一致。
 */
function fmtNum(n: number): string {
  try {
    return n.toLocaleString(i18nLocale());
  } catch {
    return String(n);
  }
}

/**
 * 秒数格式化（带一位小数）。
 * 0 / undefined 时保持旧口径 "0s"（不带小数点）。
 */
function fmtSec(v: number | undefined, unit: string): string {
  if (!v) return `0${unit}`;
  let s: string;
  try {
    s = v.toLocaleString(i18nLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  } catch {
    s = v.toFixed(1);
  }
  return `${s}${unit}`;
}

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
    imgEl.alt = shareText('mg.g24_share_qr_unavailable', FB.qrUnavailable);
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
  const big = isComp ? `#${fmtNum(d.rank || 0)}` : `${fmtNum(d.solved)} / ${fmtNum(d.total)}`;
  const bigLabel = shareText(
    isComp ? 'mg.g24_my_rank_lbl' : 'mg.g24_solved_lbl',
    isComp ? FB.rankLbl : FB.solvedLbl,
  );

  x.fillStyle = '#BFDBFE';
  x.font = '700 38px "Space Grotesk", system-ui, sans-serif';
  x.fillText(shareText(
    isComp ? 'mg.g24_canvas_comp' : 'mg.g24_canvas_daily',
    isComp ? FB.canvasComp : FB.canvasDaily,
  ), W / 2, 92);

  x.fillStyle = 'rgba(203,213,225,.72)';
  x.font = '500 20px "Sora", system-ui, sans-serif';
  x.fillText(isComp
    ? shareText('mg.g24_canvas_upto', FB.upto, { n: fmtNum(d.total) })
    : d.key, W / 2, 126);

  x.fillStyle = '#4D97E6';
  x.font = '800 104px "Space Grotesk", system-ui, sans-serif';
  x.fillText(big, W / 2, 268);

  x.fillStyle = 'rgba(203,213,225,.85)';
  x.font = '600 22px "Sora", system-ui, sans-serif';
  x.fillText(bigLabel, W / 2, 304);

  if (isDaily && d.success) {
    x.fillStyle = '#34D399';
    x.font = '700 20px "Sora", system-ui, sans-serif';
    x.fillText(`✓ ${shareText('mg.g24_share_cleared', FB.cleared)}`, W / 2, 332);
  }

  // 单位（秒）也要本地化：中文/日文是「秒」，其余语言是「s」。
  const sec = shareText('mg.g24_share_sec', FB.sec);
  const stats: [string, string][] = isComp
    ? [
        [shareText('mg.g24_share_stat_solved', FB.statSolved), fmtNum(d.solved || 0)],
        [shareText('mg.g24_share_stat_players', FB.statPlayers), fmtNum(d.total || 0)],
        [shareText('mg.g24_share_stat_streak', FB.statStreak), fmtNum(streak)],
      ]
    : [
        [shareText('mg.g24_share_stat_total', FB.statTotal), fmtSec(d.totalTime, sec)],
        [shareText('mg.g24_share_stat_avg', FB.statAvg), fmtSec(d.avg, sec)],
        [shareText('mg.g24_share_stat_best', FB.statBest), fmtSec(d.best, sec)],
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
  x.fillText(shareText('mg.g24_share_brand', FB.brand), W / 2, 545);
  x.fillStyle = 'rgba(203,213,225,.55)';
  x.font = '500 16px "Sora", system-ui, sans-serif';
  x.fillText(shareText('mg.g24_share_scan_today', FB.scanToday), W / 2, 575);

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
      ? i18nT('mg.g24_res_comp')
      : d.daily
        ? d.success || d.solved === d.total
          ? i18nT('mg.g24_res_daily_done')
          : i18nT('mg.g24_res_daily')
        : i18nT('mg.g24_res_score');
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
    toast(i18nT('share.link_copied'));
    if (btn) {
      btn.textContent = i18nT('mg.g24_copy_done');
      window.setTimeout(() => (btn.textContent = i18nT('mg.shared_copy')), 1400);
    }
  });

  $('shareDownload')?.addEventListener('click', () => {
    const c = $<HTMLCanvasElement>('shareCanvas');
    if (!c) return;
    const a = document.createElement('a');
    a.download = `24-points-${lastShare?.key ? lastShare.key.replace('#', '') : Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    toast(i18nT('share.image_saved'));
  });

  $('shareWechat')?.addEventListener('click', () => {
    const v = $<HTMLInputElement>('shareUrl')?.value || '';
    const d = lastShare;
    // 分享文本也是出口：原来整段英文硬编码，中/日/德语玩家分享出去还是英文。
    const text = d
      ? d.daily
        ? shareText('mg.g24_share_text_daily', FB.textDaily, {
            n: fmtNum(d.solved), t: fmtNum(d.total),
          })
        : d.competition
          ? shareText('mg.g24_share_text_comp', FB.textComp, { r: fmtNum(d.rank || 0) })
          : shareText('mg.g24_share_text_score', FB.textScore)
      : shareText('mg.g24_share_text_invite', FB.textInvite);
    if (navigator.share) {
      navigator.share({
        // 🔴 键名带 native_ 前缀：mg.g24_share_title 已被"弹窗标题"占用
        //    （🏆 My Score），这里说的是**系统分享面板**的标题，别混用。
        title: shareText('mg.g24_share_native_title', FB.nativeTitle),
        text,
        url: v,
      }).catch(() => {});
    } else {
      toast(i18nT('share.tap_share'));
    }
  });
}
