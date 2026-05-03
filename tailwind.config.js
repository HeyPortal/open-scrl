/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0b0f',
          rail: '#13131a',
          panel: '#16161e',
          inset: '#1d1d27',
          hover: '#23232f',
        },
        ink: {
          DEFAULT: '#e8e8ee',
          dim: '#9a9aa8',
          faint: '#5c5c6a',
        },
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#8e72ff',
        },
        line: '#26262f',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
