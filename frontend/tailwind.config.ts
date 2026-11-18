import type { Config } from 'tailwindcss'

/*
 * Palette: two colours carry ~90% of the UI and one accent carries the rest.
 *   ink    – deep navy, for structure, text and data (sidebar, headings, map pins)
 *   paper  – warm ivory, for surfaces and backgrounds
 *   accent – construction amber, reserved for primary actions and "needs attention"
 * `danger` exists only for error messages.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#F2F5FA',
          100: '#E3E8F1',
          200: '#C9D2E2',
          300: '#A5B3CC',
          400: '#8FA3C4',
          500: '#6380AD',
          600: '#3F5C8C',
          700: '#263F6A',
          800: '#1A2C4D',
          900: '#13213C',
          950: '#0B1426',
        },
        paper: {
          DEFAULT: '#F7F5F0',
          50: '#FDFCFA',
          100: '#F7F5F0',
          200: '#EEEAE1',
          300: '#E2DCCF',
        },
        accent: {
          50: '#FFF8EB',
          100: '#FEEDC7',
          200: '#FDDA8A',
          300: '#FCC75A',
          400: '#FBB938',
          500: '#F5A524',
          600: '#D98B0B',
          700: '#B46C08',
        },
        danger: { 50: '#FDF1F0', 600: '#B42318', 700: '#912018' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(19,33,60,0.06), 0 1px 3px rgba(19,33,60,0.04)',
        lift: '0 8px 24px rgba(19,33,60,0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config
