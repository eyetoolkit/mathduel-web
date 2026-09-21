import type { Config } from 'tailwindcss';
import dsPreset from '@tri-sites/design-system/tailwind-preset';

export default {
  presets: [dsPreset as Config],
  content: [
    './index.html',
    './games/**/*.html',
    './src/**/*.{ts,js}',
    '../tri-design-system/src/**/*.{ts,js}',
  ],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
