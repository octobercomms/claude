// ESLint with one job: the Rules of Hooks.
//
// eslint and eslint-plugin-react-hooks were already installed here but never
// wired up, so nothing checked hook order. A hook added below an early `return`
// in PressCampaignDetail ran on the second render but not the first, and React
// tore the Earned page down with "Rendered more hooks than during the previous
// render". `vite build` passes that happily; this does not.
//
// Deliberately narrow. Not a style gate, not a full lint setup: just the
// rules whose violation is always a runtime crash.
//
// no-undef joined on 29 Oct 2026 for the same reason. Trimming dead code out
// of ClientSalesTrafficPage left its data fetch referring to three variables
// that had just been deleted; lint and `vite build` both passed it, and the
// page would have thrown on load. Switching the rule on found that, plus two
// live ones: ConnectorRow called toast() without ever obtaining it, so a
// failed connector save threw ReferenceError out of its own catch and the AM
// saw nothing. Three violations in the whole codebase, two of them real.
//
//   npm run lint:hooks
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  // Injected by Vite's `define` at build time — real at runtime, invisible to
  // a static read of the source.
  globals: { __BUILD__: 'readonly' },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react-hooks'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'no-undef': 'error',
    // A correctness hint rather than a crash. Turning it on today would bury
    // the rule that matters under hundreds of warnings.
    'react-hooks/exhaustive-deps': 'off',
  },
};
