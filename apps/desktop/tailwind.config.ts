import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ghost: {
          bg: '#0A0412',
          surface: 'rgba(12, 8, 24, 0.65)',
          'surface-light': '#0F0A1A',
          'surface-hover': 'rgba(255, 255, 255, 0.06)',
          border: 'rgba(255, 255, 255, 0.07)',
          green: '#00FFC8',
          cyan: '#00B4D8',
          purple: '#7C3AED',
          'online-green': '#23A559',
          'warning-amber': '#F0B232',
          'error-red': '#ED4245',
          'host-gold': '#F0B232',
          'text-primary': '#F2F3F5',
          'text-secondary': '#B5BAC1',
          'text-muted': '#6D6F78',
          'audio-track': '#7C3AED',
          'midi-track': '#7C3AED',
          'drum-track': '#ED4245',
          'loop-track': '#23A559',
          'waveform-bg': '#0A0412',
          'sidebar': 'rgba(12, 8, 24, 0.7)',
          'sidebar-dark': 'rgba(8, 4, 18, 0.8)',
        },
      },
      boxShadow: {
        'popup': '0 0 0 1px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.5), 0 0 60px rgba(120,40,200,0.06)',
        'glow-green': '0 0 24px rgba(0, 255, 200, 0.12)',
        'glow-purple': '0 0 24px rgba(124, 58, 237, 0.12)',
      },
      fontFamily: {
        sans: ['gg sans', 'Noto Sans', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['Consolas', 'Andale Mono WT', 'Andale Mono', 'monospace'],
      },
      borderRadius: {
        'lg': '8px',
        'xl': '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
} satisfies Config;
