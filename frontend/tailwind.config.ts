import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#f2f8f5',
          100: '#dfeee6',
          200: '#bedccb',
          300: '#91c2a8',
          400: '#5da17f',
          500: '#3b825f',
          600: '#2c684c',
          700: '#25533f',
          800: '#214334',
          900: '#12372a',
          950: '#0b211a',
        },
        sand: '#f5f1e8',
        amber: '#e7a83e',
      },
      boxShadow: {
        card: '0 18px 50px -28px rgba(18, 55, 42, 0.35)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
