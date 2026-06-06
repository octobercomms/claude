/**
 * October Marketing Intelligence — Tailwind config.
 *
 * Tailwind is a utility layer ON TOP of the existing class-based design
 * system in src/index.css. It reads the SAME CSS variables, so utilities,
 * the .btn/.card/.chip classes, and per-suite accent theming all share
 * one token source — and `bg-accent` automatically follows the nearest
 * .suite-* scope, exactly like the existing components.
 *
 * preflight (Tailwind's global reset) is DISABLED so this is purely
 * additive: it changes nothing until a component opts into utilities,
 * and it can't disturb existing pages or the Reports feature.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        // Brockmann everywhere — no other font.
        sans: ['Brockmann', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      colors: {
        page: 'var(--page-bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)',
        },
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        subtle: 'var(--text-subtle)',
        line: 'var(--border-neutral)',
        cardborder: 'var(--card-border)',
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
          on: 'var(--accent-on)',
        },
        positive: { DEFAULT: 'var(--positive)', soft: 'var(--positive-soft)' },
        negative: { DEFAULT: 'var(--negative)', soft: 'var(--negative-soft)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)' },
        sidebar: {
          bg: 'var(--sidebar-bg)',
          fg: 'var(--sidebar-fg)',
          muted: 'var(--sidebar-muted)',
          subtle: 'var(--sidebar-subtle)',
          border: 'var(--sidebar-border)',
        },
      },
      // 4pt spacing scale — mirrors --s1..--s10 (p-s4, gap-s3, mt-s6, …).
      spacing: {
        s1: 'var(--s1)', s2: 'var(--s2)', s3: 'var(--s3)', s4: 'var(--s4)',
        s5: 'var(--s5)', s6: 'var(--s6)', s7: 'var(--s7)', s8: 'var(--s8)',
        s9: 'var(--s9)', s10: 'var(--s10)',
      },
      borderRadius: {
        DEFAULT: 'var(--r-md)',
        sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)', pill: 'var(--r-pill)',
      },
      borderWidth: {
        // Thick borders are the house style.
        DEFAULT: 'var(--border-w)',
        thick: 'var(--border-w)',
      },
    },
  },
  plugins: [],
};
