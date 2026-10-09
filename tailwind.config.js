/** @type {import('tailwindcss').Config} */
// Colours resolve to CSS variables defined in src/index.css (the single source of design tokens).
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: v('app-bg'),
        surface: v('surface'),
        subtle: v('surface-subtle'),
        hover: v('surface-hover'),
        ink: v('text-primary'),
        muted: v('text-secondary'),
        faint: v('text-muted'),
        line: v('border'),
        'line-strong': v('border-strong'),
        soft: v('surface-subtle'),
        brand: { DEFAULT: v('brand'), 50: v('brand-subtle'), 100: v('brand-100'), 600: v('brand-hover'), 700: v('brand-strong') },
        ok: { DEFAULT: v('success'), 50: v('success-subtle') },
        warn: { DEFAULT: v('warning'), 50: v('warning-subtle') },
        crit: { DEFAULT: v('danger'), 50: v('danger-subtle') },
        info: { DEFAULT: v('info'), 50: v('info-subtle') },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', '16px'],
      },
      borderRadius: { card: '12px', panel: '14px' },
      boxShadow: {
        card: '0 1px 2px rgb(21 37 54 / 0.05)',
        raised: '0 4px 12px -2px rgb(21 37 54 / 0.08), 0 2px 4px -2px rgb(21 37 54 / 0.05)',
        overlay: '0 24px 48px -12px rgb(21 37 54 / 0.25)',
      },
      transitionDuration: { fast: '150ms', base: '200ms', slow: '260ms' },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'none' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideIn: { '0%': { transform: 'translateX(24px)', opacity: '0' }, '100%': { transform: 'none', opacity: '1' } },
        pop: { '0%': { transform: 'scale(.98)', opacity: '0' }, '100%': { transform: 'none', opacity: '1' } },
      },
      animation: {
        'fade-up': 'fadeUp .2s ease-out both',
        'fade-in': 'fadeIn .18s ease-out both',
        'slide-in': 'slideIn .24s cubic-bezier(.2,.8,.2,1) both',
        pop: 'pop .18s ease-out both',
      },
    },
  },
  plugins: [],
};
