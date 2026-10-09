/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F6F8FB',
        ink: '#172B4D',
        brand: { DEFAULT: '#315EFB', 50: '#EEF2FF', 100: '#E0E8FF', 600: '#2A50DB', 700: '#2342B8' },
        muted: '#5F6B7F',
        line: '#E2E8F0',
        ok: { DEFAULT: '#16805D', 50: '#E8F6F0' },
        warn: { DEFAULT: '#9A6416', 50: '#FDF5E6' },
        crit: { DEFAULT: '#B42318', 50: '#FDECEA' },
        soft: '#EEF3FA',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: { card: '0 1px 2px rgba(23,43,77,0.06), 0 1px 3px rgba(23,43,77,0.04)' },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-up': 'fadeUp .25s ease-out both' },
    },
  },
  plugins: [],
};
