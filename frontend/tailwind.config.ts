import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import shadcnCompat, { shadcnCompatTheme } from './tailwind.shadcn-compat';

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
        heading: [shadcnCompatTheme.fontFamily.heading],
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
        // We wire them via `oklch(from var(--x) l c h / calc(alpha * <alpha-value>))`
        // so the Tailwind v3 alpha shorthand (`bg-primary/80`) and plain
        // (`bg-primary`) both work — the `from` keyword expands the variable's
        // L/C/H/alpha into the outer oklch() and Tailwind substitutes
        // <alpha-value>. Multiplying by `alpha` keeps translucent tokens
        // translucent: dark `--input` is `oklch(1 0 0 / 15%)`, and without it
        // `bg-input/50` rendered as 50% white (light-grey inputs on dark).
        background: 'oklch(from var(--background) l c h / calc(alpha * <alpha-value>))',
        foreground: 'oklch(from var(--foreground) l c h / calc(alpha * <alpha-value>))',
        border: 'oklch(from var(--border) l c h / calc(alpha * <alpha-value>))',
        input: 'oklch(from var(--input) l c h / calc(alpha * <alpha-value>))',
        ring: 'oklch(from var(--ring) l c h / calc(alpha * <alpha-value>))',
        card: {
          DEFAULT: 'oklch(from var(--card) l c h / calc(alpha * <alpha-value>))',
          foreground: 'oklch(from var(--card-foreground) l c h / calc(alpha * <alpha-value>))',
        },
        popover: {
          DEFAULT: 'oklch(from var(--popover) l c h / calc(alpha * <alpha-value>))',
          foreground: 'oklch(from var(--popover-foreground) l c h / calc(alpha * <alpha-value>))',
        },
        primary: {
          DEFAULT: 'oklch(from var(--primary) l c h / calc(alpha * <alpha-value>))',
          foreground: 'oklch(from var(--primary-foreground) l c h / calc(alpha * <alpha-value>))',
        },
        secondary: {
          DEFAULT: 'oklch(from var(--secondary) l c h / calc(alpha * <alpha-value>))',
          foreground: 'oklch(from var(--secondary-foreground) l c h / calc(alpha * <alpha-value>))',
        },
        muted: {
          DEFAULT: 'oklch(from var(--muted) l c h / calc(alpha * <alpha-value>))',
          foreground: 'oklch(from var(--muted-foreground) l c h / calc(alpha * <alpha-value>))',
        },
        destructive: {
          DEFAULT: 'oklch(from var(--destructive) l c h / calc(alpha * <alpha-value>))',
          foreground: 'oklch(from var(--primary-foreground) l c h / calc(alpha * <alpha-value>))',
        },
        sidebar: {
          DEFAULT: 'oklch(from var(--sidebar) l c h / calc(alpha * <alpha-value>))',
          foreground: 'oklch(from var(--sidebar-foreground) l c h / calc(alpha * <alpha-value>))',
          primary: 'oklch(from var(--sidebar-primary) l c h / calc(alpha * <alpha-value>))',
          'primary-foreground':
            'oklch(from var(--sidebar-primary-foreground) l c h / calc(alpha * <alpha-value>))',
          accent: 'oklch(from var(--sidebar-accent) l c h / calc(alpha * <alpha-value>))',
          'accent-foreground':
            'oklch(from var(--sidebar-accent-foreground) l c h / calc(alpha * <alpha-value>))',
          border: 'oklch(from var(--sidebar-border) l c h / calc(alpha * <alpha-value>))',
          ring: 'oklch(from var(--sidebar-ring) l c h / calc(alpha * <alpha-value>))',
        },
        chart: {
          1: 'oklch(from var(--chart-1) l c h / calc(alpha * <alpha-value>))',
          2: 'oklch(from var(--chart-2) l c h / calc(alpha * <alpha-value>))',
          3: 'oklch(from var(--chart-3) l c h / calc(alpha * <alpha-value>))',
          4: 'oklch(from var(--chart-4) l c h / calc(alpha * <alpha-value>))',
          5: 'oklch(from var(--chart-5) l c h / calc(alpha * <alpha-value>))',
        },
        success: {
          DEFAULT: 'oklch(from var(--success) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--success-foreground) l c h / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'oklch(from var(--warning) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--warning-foreground) l c h / <alpha-value>)',
        },
        info: {
          DEFAULT: 'oklch(from var(--info) l c h / <alpha-value>)',
          foreground: 'oklch(from var(--info-foreground) l c h / <alpha-value>)',
        },
        // ---- Legacy names, re-pointed at the taupe tokens (R1) ------------
        // R2–R4 screens still use these classes; they now render taupe and
        // are replaced by the shadcn names as each batch refactors its area.
        fg: {
          strong: 'oklch(from var(--foreground) l c h / <alpha-value>)',
          DEFAULT: 'oklch(from var(--foreground) l c h / <alpha-value>)',
          default: 'oklch(from var(--foreground) l c h / <alpha-value>)',
          muted: 'oklch(from var(--muted-foreground) l c h / <alpha-value>)',
          subtle: 'oklch(from var(--muted-foreground) l c h / <alpha-value>)',
        },
        surface: {
          base: 'oklch(from var(--background) l c h / <alpha-value>)',
          raised: 'oklch(from var(--card) l c h / <alpha-value>)',
          elevated: 'oklch(from var(--muted) l c h / <alpha-value>)',
          overlay: 'oklch(from var(--popover) l c h / <alpha-value>)',
        },
        line: {
          soft: 'oklch(from var(--foreground) l c h / 0.06)',
          DEFAULT: 'oklch(from var(--foreground) l c h / 0.09)',
          strong: 'oklch(from var(--foreground) l c h / 0.14)',
        },
        ink: {
          50: 'oklch(from var(--foreground) l c h / <alpha-value>)',
          100: 'oklch(from var(--foreground) l c h / <alpha-value>)',
          200: 'oklch(from var(--foreground) l c h / <alpha-value>)',
          300: 'oklch(from var(--muted-foreground) l c h / <alpha-value>)',
          400: 'oklch(from var(--muted-foreground) l c h / <alpha-value>)',
          500: 'oklch(from var(--muted-foreground) l c h / <alpha-value>)',
          600: 'oklch(from var(--muted-foreground) l c h / <alpha-value>)',
          700: 'oklch(from var(--muted) l c h / <alpha-value>)',
          800: 'oklch(from var(--muted) l c h / <alpha-value>)',
          900: 'oklch(from var(--card) l c h / <alpha-value>)',
          950: 'oklch(from var(--background) l c h / <alpha-value>)',
        },
        // ---- Purple palettes → taupe (full-taupe decision, R1) ------------
        // e.g. LeverBadge's `bg-violet-500/10 text-violet-700` (R3-owned).
        ...Object.fromEntries(
          ['violet', 'purple', 'indigo', 'fuchsia'].map((name) => [
            name,
            Object.fromEntries(
              [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [
                n,
                `oklch(from var(--accent-${Math.min(n, 900)}) l c h / <alpha-value>)`,
              ])
            ),
          ])
        ),
        // ---- accent: shadcn's hover token + the legacy ramp (now taupe) ---
        // The numbered steps resolve through --accent-<n> in index.css.
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
          50: 'oklch(from var(--accent-50) l c h / <alpha-value>)',
          100: 'oklch(from var(--accent-100) l c h / <alpha-value>)',
          200: 'oklch(from var(--accent-200) l c h / <alpha-value>)',
          300: 'oklch(from var(--accent-300) l c h / <alpha-value>)',
          400: 'oklch(from var(--accent-400) l c h / <alpha-value>)',
          500: 'oklch(from var(--accent-500) l c h / <alpha-value>)',
          600: 'oklch(from var(--accent-600) l c h / <alpha-value>)',
          700: 'oklch(from var(--accent-700) l c h / <alpha-value>)',
          800: 'oklch(from var(--accent-800) l c h / <alpha-value>)',
          900: 'oklch(from var(--accent-900) l c h / <alpha-value>)',
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
      ringWidth: shadcnCompatTheme.ringWidth,
      spacing: shadcnCompatTheme.spacing,
      zIndex: shadcnCompatTheme.zIndex,
      textUnderlineOffset: shadcnCompatTheme.textUnderlineOffset,
      boxShadow: {
        ...shadcnCompatTheme.boxShadow,
        // Legacy names kept for R2–R4 users; neutral now (no purple glow).
        glow: '0 1px 2px 0 oklch(from var(--foreground) l c h / 0.08)',
        'card-hover': '0 8px 24px -8px oklch(from var(--foreground) l c h / 0.12)',
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
  plugins: [tailwindcssAnimate, shadcnCompat],
};

export default config;
