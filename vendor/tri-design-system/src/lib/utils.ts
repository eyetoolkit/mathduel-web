/**
 * Tri-Sites Design System · 工具函数
 * cn / escapeHtml / toast / 数字格式化
 */

/** 拼接 class 名（剔除假值），避免引入 clsx 依赖 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** HTML 转义（所有插入用户名的位置必须先过这里） */
export function escapeHtml(s: unknown): string {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

let toastTimer: number | undefined;

/** 全局轻提示 */
export function toast(msg: string, ms = 2200): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

/** 秒数 → m:ss */
export function fmtClock(s: number): string {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m + ':' + (ss < 10 ? '0' : '') + ss;
}

/** 毫秒 → 12.3s / 1:05.4 */
export function fmtTime(ms: number): string {
  const s = (Number(ms) || 0) / 1000;
  return s >= 60 ? Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60).toFixed(1) : s.toFixed(1) + 's';
}

/** 复制文本，带降级 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 降级到 execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
