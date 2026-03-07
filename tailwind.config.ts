import type { Config } from 'tailwindcss';

function cssVar(name: string) {
  return `rgb(var(--color-${name}) / <alpha-value>)`;
}

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
      colors: {
        surface: {
          primary: cssVar('bg-primary'),
          secondary: cssVar('bg-secondary'),
          tertiary: cssVar('bg-tertiary'),
          elevated: cssVar('bg-elevated'),
          overlay: cssVar('bg-overlay'),
          terminal: cssVar('bg-terminal'),
        },
        chrome: {
          DEFAULT: cssVar('border-primary'),
          subtle: cssVar('border-secondary'),
          focus: cssVar('border-focus'),
        },
        content: {
          primary: cssVar('text-primary'),
          secondary: cssVar('text-secondary'),
          tertiary: cssVar('text-tertiary'),
          inverted: cssVar('text-inverted'),
        },
        selected: {
          bg: cssVar('selected-bg'),
          border: cssVar('selected-border'),
        },
        active: {
          indicator: cssVar('active-indicator'),
          ping: cssVar('active-indicator-ping'),
        },
        interactive: {
          link: cssVar('link'),
          'link-hover': cssVar('link-hover'),
        },
        'btn-primary': {
          DEFAULT: cssVar('btn-primary-bg'),
          hover: cssVar('btn-primary-hover'),
        },
        'btn-secondary': {
          DEFAULT: cssVar('btn-secondary-bg'),
          hover: cssVar('btn-secondary-hover'),
        },
        column: {
          planning: cssVar('column-planning'),
          development: cssVar('column-development'),
          done: cssVar('column-done'),
        },
        status: {
          running: cssVar('status-running'),
          waiting: cssVar('status-waiting'),
          'plan-ready': cssVar('status-plan-ready'),
          completed: cssVar('status-completed'),
          error: cssVar('status-error'),
        },
        semantic: {
          warning: cssVar('warning'),
          'warning-light': cssVar('warning-light'),
          success: cssVar('success'),
          'success-border': cssVar('success-border'),
          'success-bg': cssVar('success-bg'),
          error: cssVar('error'),
          'error-light': cssVar('error-light'),
          'error-bg': cssVar('error-bg'),
          'error-bg-dark': cssVar('error-bg-dark'),
          notification: cssVar('notification'),
        },
        focus: {
          ring: cssVar('focus-ring'),
        },
        tool: {
          icon: cssVar('tool-icon'),
          label: cssVar('tool-label'),
        },
        terminal: {
          text: cssVar('terminal-text'),
          'text-secondary': cssVar('terminal-text-secondary'),
          'text-muted': cssVar('terminal-text-muted'),
          'text-faint': cssVar('terminal-text-faint'),
          border: cssVar('terminal-border'),
          hover: cssVar('terminal-hover'),
          surface: cssVar('terminal-surface'),
        },
      },
    },
  },
  plugins: [],
};

export default config;
