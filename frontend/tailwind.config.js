/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        red: { DEFAULT: '#C8102E', hover: '#A80D24', light: '#FEF2F4', mid: '#F0C0C8' },
        surface: '#F6F6F6',
        wash: '#EBEBEB',
        border: { DEFAULT: '#DCDCDC', strong: '#C4C4C4' },
        txt: { DEFAULT: '#1C1C1C', dim: '#5A5A5A', muted: '#9A9A9A' },
        green: { DEFAULT: '#1A6E34', bg: '#EBF5EE', bd: '#86EFAC' },
        yellow: { DEFAULT: '#7A5C00', bg: '#FFFBEB', bd: '#FCD34D' },
        blue: { DEFAULT: '#1E4D8C', bg: '#EFF6FF', bd: '#BFDBFE' },
        orange: { DEFAULT: '#92400E', bg: '#FFF7ED', bd: '#FED7AA' },
        emerg: { text: '#991B1B', bg: '#FEE2E2', bd: '#FCA5A5' },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        serif: ['Georgia', '"Times New Roman"', 'serif'],
        mono: ['"Fira Code"', 'monospace'],
      },
      borderRadius: { cooley: '6px' },
      boxShadow: {
        sm: '0 2px 8px rgba(0,0,0,0.07)',
        md: '0 4px 16px rgba(0,0,0,0.09)',
        lg: '0 8px 32px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
};
