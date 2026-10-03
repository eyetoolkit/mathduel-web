/**
 * match-sound.ts · 跨棋类共享：音效键绑定 + 音频保活监听
 * ------------------------------------------------------------------
 * 从 24-game 第 2/7 轮沉淀出来的范式抽象。
 *
 * 设计要点（gomoku 第 7-9 轮踩过的坑）：
 *   · 解锁监听必须 pointerdown + touchstart + mousedown + visibilitychange 常驻，
 *     不能 once —— iOS 中断后 AudioContext 会重新挂起，once 之后就永久静音
 *   · aria-pressed 反映 sfxOn() 状态；title / aria-label 同步切 "Sound on/off"
 *   · keepAudioAlive() 是幂等的，开销极小，常驻监听无压力
 *
 * 用法：
 *   import { bindSoundButton, keepAudioAlive, playSfx, setSfx, sfxOn, unlockSfx } from
 *     '../../shared/sfx';
 *   import { bindSoundButton, keepAudioAlive } from '../_shared/match-sound';
 *
 *   // 一次性绑定（在 TS 顶层）
 *   bindSoundButton('g24-sound');
 *   keepAudioAlive();
 *
 *   // 落子时
 *   playSfx('place');
 */

import { playSfx, sfxOn, setSfx, unlockSfx } from '../../shared/sfx';

let aliveBound = false;

/**
 * 在所有真实手势里保活 AudioContext —— pointerdown + touchstart + mousedown
 * （老 WebView 不派发 pointer）+ visibilitychange（后台切回前台拉一把）。
 * 幂等，多次调用安全。
 */
export function keepAudioAlive(): void {
  if (aliveBound) return;
  aliveBound = true;
  const handler = (): void => unlockSfx();
  document.addEventListener('pointerdown', handler, { passive: true });
  document.addEventListener('touchstart', handler, { passive: true });
  document.addEventListener('mousedown', handler, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) handler();
  });
}

/**
 * 一键绑定 sound 按钮：点击 → setSfx(!on) + aria-pressed 同步 + 手动开声时立即解锁。
 *
 * HTML 节点要求：
 *   <button id="<btnId>" class="sound-btn" aria-pressed="true" aria-label="Sound on" title="Sound">
 *     <svg class="ico-on" ...></svg>
 *     <svg class="ico-off" ...></svg>
 *   </button>
 * CSS 类 .ico-on / .ico-off 由 arena.css 提供（gomoku 第 7 轮已就位）。
 */
export function bindSoundButton(btnId: string): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null;
  if (!btn) return;
  // 初始态：按 localStorage 设置 aria-pressed
  btn.setAttribute('aria-pressed', String(sfxOn()));
  btn.addEventListener('click', () => {
    const next = !sfxOn();
    setSfx(next);
    btn.setAttribute('aria-pressed', String(next));
    btn.setAttribute('aria-label', next ? 'Sound on' : 'Sound off');
    btn.setAttribute('title', next ? 'Sound' : 'Sound off');
    if (next) {
      unlockSfx();
      playSfx('place');   // 手动开声时立刻播一个证明解锁生效
    }
  });
}
