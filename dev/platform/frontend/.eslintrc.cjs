// ESLint with one job: the Rules of Hooks.
//
// eslint and eslint-plugin-react-hooks were already installed here but never
// wired up, so nothing checked hook order. A hook added below an early `return`
// in PressCampaignDetail ran on the second render but not the first, and React
// tore the Earned page down with "Rendered more hooks than during the previous
// render". `vite build` passes that happily; this does not.
//
// Deliberately narrow. Not a style gate, not a full lint setup: just the one
// rule whose violation is always a runtime crash.
//
//   npm run lint:hooks
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react-hooks'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    // A correctness hint rather than a crash. Turning it on today would bury
    // the rule that matters under hundreds of warnings.
    'react-hooks/exhaustive-deps': 'off',
  },
};
