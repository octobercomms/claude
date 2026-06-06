/**
 * October Marketing Intelligence — Tailwind config (bold refresh).
 *
 * IMPORTANT: preflight (Tailwind's global CSS reset) is DISABLED on purpose.
 * The app is heavily inline-styled and the Reports feature must not change,
 * so Tailwind is additive only — utilities apply where we opt in, and no
 * global resets leak into existing pages. Tokens mirror src/styles/tokens.css.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        // Single-typeface system — Brockmann is already loaded in index.html.
        sans: ['Brockmann', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        ink: 'var(--ink)',
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        yellow: {
          DEFAULT: 'var(--yellow)',
          bright: 'var(--yellow-bright)',
          ink: 'var(--yellow-ink)',
        },
        line: 'var(--line)',
        gray: {
          100: 'var(--g-100)', 200: 'var(--g-200)', 300: 'var(--g-300)',
          400: 'var(--g-400)', 500: 'var(--g-500)', 700: 'var(--g-700)',
          900: 'var(--g-900)',
        },
        success: 'var(--success)',
        danger: 'var(--danger)',
        info: 'var(--info)',
        // Categorical data-viz ramp for Recharts.
        data: {
          1: 'var(--d1)', 2: 'var(--d2)', 3: 'var(--d3)',
          4: 'var(--d4)', 5: 'var(--d5)', 6: 'var(--d6)',
        },
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
      },
      letterSpacing: {
        tightest: '-0.03em',
        label: '0.14em',
      },
    },
  },
  plugins: [],
};
