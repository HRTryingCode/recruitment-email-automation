import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Geist"',
          '"Inter"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: [
          '"Geist Mono"',
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
        display: [
          '"Geist"',
          '"Inter"',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        // ---- Semantic foreground tokens ----------------------------------
        // Flip light/dark via CSS variables in index.css. The single RGB
        // triplet lets Tailwind compose alpha with `/<N>` for borders.
        fg: {
          strong: 'rgb(var(--fg-strong) / <alpha-value>)',
          DEFAULT: 'rgb(var(--fg-default) / <alpha-value>)',
          default: 'rgb(var(--fg-default) / <alpha-value>)',
          muted: 'rgb(var(--fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--fg-subtle) / <alpha-value>)',
        },
        // ---- Semantic background tokens ----------------------------------
        surface: {
          base: 'rgb(var(--bg-base) / <alpha-value>)',
          raised: 'rgb(var(--bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
          overlay: 'rgb(var(--bg-overlay) / <alpha-value>)',
        },
        // ---- Border (low-alpha hairline; same RGB as fg-strong) -----------
        line: {
          soft: 'rgb(var(--border-base) / 0.06)',
          DEFAULT: 'rgb(var(--border-base) / 0.09)',
          strong: 'rgb(var(--border-base) / 0.14)',
        },
        // ---- Legacy `ink-*` ramp — same names, theme-driven values --------
        // Existing components keep their visual intent across themes.
        ink: {
          50: 'rgb(var(--fg-strong) / <alpha-value>)',
          100: 'rgb(var(--fg-strong) / <alpha-value>)',
          200: 'rgb(var(--fg-default) / <alpha-value>)',
          300: 'rgb(var(--fg-muted) / <alpha-value>)',
          400: 'rgb(var(--fg-muted) / <alpha-value>)',
          500: 'rgb(var(--fg-subtle) / <alpha-value>)',
          600: 'rgb(var(--fg-subtle) / <alpha-value>)',
          700: 'rgb(var(--bg-elevated) / <alpha-value>)',
          800: 'rgb(var(--bg-elevated) / <alpha-value>)',
          900: 'rgb(var(--bg-surface) / <alpha-value>)',
          950: 'rgb(var(--bg-base) / <alpha-value>)',
        },
        // ---- Accent (purple) ---------------------------------------------
        accent: {
          50: '#f4f1ff',
          100: '#ebe5ff',
          200: '#d7cbff',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-500) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-700) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
          800: '#3a2884',
          900: '#251954',
        },
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent-500) / 0.18), 0 8px 32px -8px rgb(var(--accent-500) / 0.25)',
        'card-hover':
          '0 8px 24px -8px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(var(--accent-500) / 0.08)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        'fade-in': 'fade-in 0.3s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
