import type { Config } from 'tailwindcss';

/** Tokens « NOC Console » : voir la maquette System (design system). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#080C15',
        chrome: '#0C1320',
        surface: '#101827',
        raised: '#162033',
        line: '#1E2B42',
        line2: '#2B3B57',
        well: '#0B111D',
        text: '#E7EDF6',
        text2: '#B9C5D8',
        muted: '#93A1B8',
        dim: '#66748C',
        accent: { DEFAULT: '#2DD4E8', ink: '#04212A', soft: '#7FE6F2' },
        ok: '#3DDC97',
        warn: '#F5B544',
        crit: '#FF6B5E',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: 'inset 0 1px 0 rgba(255,255,255,.05)',
        hero: 'inset 0 1px 0 rgba(255,255,255,.06), 0 24px 50px -24px rgba(0,0,0,.8)',
        glow: '0 0 0 1px rgba(45,212,232,.5), 0 8px 26px -6px rgba(45,212,232,.6)',
      },
      borderRadius: { panel: '14px' },
    },
  },
  plugins: [],
} satisfies Config;
