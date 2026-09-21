/**
 * Tri-Sites Design System · Tailwind Preset
 * 让 Tailwind 使用设计系统的 CSS 变量，杜绝"设计系统一套、页面另一套"的分叉。
 */
import type { Config } from 'tailwindcss';

const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          200: 'var(--brand-200)',
          400: 'var(--brand-400)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
          900: 'var(--brand-900)',
          DEFAULT: 'var(--brand)',
        },
        bg: 'var(--bg)',
        'bg-subtle': 'var(--bg-subtle)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        strong: 'var(--text-strong)',
        content: 'var(--text)',
        muted: 'var(--text-muted)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        DEFAULT: 'var(--r)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        '2xl': 'var(--r-2xl)',
        full: 'var(--r-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
      spacing: {
        s1: 'var(--s-1)', s2: 'var(--s-2)', s3: 'var(--s-3)', s4: 'var(--s-4)',
        s5: 'var(--s-5)', s6: 'var(--s-6)', s8: 'var(--s-8)', s10: 'var(--s-10)',
        s12: 'var(--s-12)', s16: 'var(--s-16)', s20: 'var(--s-20)', s24: 'var(--s-24)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        spring: 'var(--ease-spring)',
      },
      maxWidth: { container: 'var(--container)' },
      minHeight: { tap: 'var(--tap)' },
    },
  },
};

export default preset;
