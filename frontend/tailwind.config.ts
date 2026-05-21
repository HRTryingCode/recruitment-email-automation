import type { Config } from 'tailwindcss';

const config: Config = {
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
        // Deep neutral canvas — slightly cooler than zinc default
        ink: {
          50: '#f4f4f5',
          100: '#e4e4e7',
          200: '#c8c8cf',
          300: '#9a9aa3',
          400: '#6b6b76',
          500: '#4a4a55',
          600: '#2f2f38',
          700: '#1f1f27',
          800: '#15151c',
          900: '#0d0d13',
          950: '#070709',
        },
        // Brand accent — a refined violet with warmth
        accent: {
          50: '#f4f1ff',
          100: '#ebe5ff',
          200: '#d7cbff',
          300: '#b9a3ff',
          400: '#9b7dff',
          500: '#7c5cf5',
          600: '#6243dc',
          700: '#4d35b0',
          800: '#3a2884',
          900: '#251954',
        },
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(155, 125, 255, 0.18), 0 8px 32px -8px rgba(155, 125, 255, 0.25)',
        'card-hover': '0 8px 24px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(155, 125, 255, 0.08)',
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
