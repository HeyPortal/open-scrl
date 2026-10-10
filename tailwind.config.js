/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--c-bg) / <alpha-value>)',
          rail: 'rgb(var(--c-bg-rail) / <alpha-value>)',
          panel: 'rgb(var(--c-bg-panel) / calc(var(--c-bg-panel-alpha) * <alpha-value>))',
          inset: 'rgb(var(--c-bg-inset) / <alpha-value>)',
          hover: 'rgb(var(--c-bg-hover) / <alpha-value>)',
          overlay: 'rgb(var(--c-bg-overlay) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          dim: 'rgb(var(--c-ink-dim) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--c-accent-soft) / calc(var(--c-accent-soft-alpha) * <alpha-value>))',
        },
        line: {
          DEFAULT: 'rgb(var(--c-line) / calc(var(--c-line-alpha) * <alpha-value>))',
          strong: 'rgb(var(--c-line-strong) / calc(var(--c-line-strong-alpha) * <alpha-value>))',
        },
        'accent-start': 'rgb(var(--c-accent-start) / <alpha-value>)',
        'accent-end': 'rgb(var(--c-accent-end) / <alpha-value>)',
        'danger': 'rgb(var(--c-danger) / <alpha-value>)',
        'danger-icon': 'rgb(var(--c-danger-icon) / <alpha-value>)',
        'warning': 'rgb(var(--c-warning) / <alpha-value>)',
        'success': 'rgb(var(--c-success) / <alpha-value>)',
        'surface-ring': 'rgb(var(--c-surface-ring) / <alpha-value>)',
        'accent-ink': 'rgb(var(--c-accent-ink) / <alpha-value>)',
        'canvas-bg': 'rgb(var(--c-canvas-bg) / <alpha-value>)',
        'canvas-dot': 'rgb(var(--c-canvas-dot) / calc(var(--c-canvas-dot-alpha) * <alpha-value>))',
        'template': 'rgb(var(--c-template) / <alpha-value>)',
        'danger-bg': 'rgb(var(--c-danger-bg) / <alpha-value>)',
        'warning-bg': 'rgb(var(--c-warning-bg) / <alpha-value>)',
        'danger-ink': 'rgb(var(--c-danger-ink) / <alpha-value>)',
        'warning-ink': 'rgb(var(--c-warning-ink) / <alpha-value>)',
        'preview-backdrop': 'rgb(var(--c-preview-backdrop) / <alpha-value>)',
        'preview-bezel': 'rgb(var(--c-preview-bezel) / <alpha-value>)',
      },
      borderRadius: { panel: 'var(--radius-panel)', control: 'var(--radius-control)' },
      fontFamily: {
        // Fontsource registers the self-hosted Inter as 'Inter Variable'. Plain 'Inter' is deliberately
        // not registered: resolveFontFamily maps that portable document name to the bundled face.
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Serif for titles and headings only (see .heading-* in index.css). The fallbacks are ordinary
        // text serifs, which run wider than the condensed Instrument Serif.
        display: ['"Instrument Serif"', 'ui-serif', 'Georgia', '"Times New Roman"', 'serif'],
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        sheet: 'var(--shadow-sheet)',
        'mobile-menu': 'var(--shadow-mobile-menu)',
        preview: 'var(--shadow-preview)',
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
      },
    },
  },
  plugins: [],
};
