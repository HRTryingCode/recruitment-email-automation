import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

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
          '"Inter Variable"',
          '"Inter"',
          '"Geist"',
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
          '"Inter Variable"',
          '"Inter"',
          '"Geist"',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        // ---- shadcn/ui semantic tokens (luma preset, taupe baseColor) -----
        // The OKLCH CSS variables live in index.css under :root / .dark.
        // We wire them via `oklch(from var(--x) l c h / <alpha-value>)` so the
        // Tailwind v3 alpha shorthand (`bg-primary/80`) and plain (`bg-primary`)
        // both work — the `from` keyword expands the variable's L/C/H into
        // the outer oklch() and Tailwind substitutes <alpha-value>.
        background: 'oklch(from var(--background) l c h / <alpha-value>)',
        foreground: 'oklch(from var(--foreground) l c h / <alpha-value>)',
        border: 'oklch(from var(--border) l c h / <alpha-value>)',
        input: 'oklch(from var(--input) l c h / <alpha-value>)',
        ring: 'oklch(from var(--ring) l c h / <alpha-value>)',
        card: {
          DEFAULT: 'oklch(from var(--card) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--card-foreground) l c h / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'oklch(from var(--popover) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--popover-foreground) l c h / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'oklch(from var(--primary) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--primary-foreground) l c h / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'oklch(from var(--secondary) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--secondary-foreground) l c h / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'oklch(from var(--muted) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--muted-foreground) l c h / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'oklch(from var(--destructive) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--primary-foreground) l c h / <alpha-value>)',
        },
        sidebar: {
          DEFAULT: 'oklch(from var(--sidebar) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--sidebar-foreground) l c h / <alpha-value>)',
          primary: 'oklch(from var(--sidebar-primary) l c h / <alpha-value>)',
          'primary-foreground':
            'oklch(from var(--sidebar-primary-foreground) l c h / <alpha-value>)',
          accent: 'oklch(from var(--sidebar-accent) l c h / <alpha-value>)',
          'accent-foreground':
            'oklch(from var(--sidebar-accent-foreground) l c h / <alpha-value>)',
          border: 'oklch(from var(--sidebar-border) l c h / <alpha-value>)',
          ring: 'oklch(from var(--sidebar-ring) l c h / <alpha-value>)',
        },
        chart: {
          1: 'oklch(from var(--chart-1) l c h / <alpha-value>)',
          2: 'oklch(from var(--chart-2) l c h / <alpha-value>)',
          3: 'oklch(from var(--chart-3) l c h / <alpha-value>)',
          4: 'oklch(from var(--chart-4) l c h / <alpha-value>)',
          5: 'oklch(from var(--chart-5) l c h / <alpha-value>)',
        },
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
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
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
        // shadcn radius scale, wired off the --radius CSS variable.
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
        // The luma Button compiles to `rounded-4xl`; pill-like by design.
        '4xl': '2rem',
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
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
