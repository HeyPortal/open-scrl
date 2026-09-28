/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          // App backdrop and canvas workspace.
          DEFAULT: '#0f0f12',
          rail: '#141417',
          panel: '#18181c',
          inset: '#1f1f24',
          hover: '#27272d',
          overlay: '#1c1c21',
        },
        ink: {
          DEFAULT: '#ededf0',
          dim: '#a0a0ab',
          faint: '#6c6c78',
        },
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#8d72ff',
          soft: '#7c5cff29',
        },
        line: {
          DEFAULT: '#26262c',
          strong: '#34343c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0, 0, 0, 0.4)',
        lift: '0 0 0 1px rgba(255, 255, 255, 0.05), 0 16px 40px -12px rgba(0, 0, 0, 0.7)',
      },
    },
  },
  plugins: [],
};
