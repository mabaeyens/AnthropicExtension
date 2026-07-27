'use strict';

// Flat config (ESLint 9+). Replaces .eslintrc.json, which the old config system read.
// The upgrade off ESLint 8 was driven by security: every high-severity advisory in
// `npm audit` came from ESLint 8's dependency chain (minimatch -> brace-expansion), and
// the only patched brace-expansion is on a major line that minimatch 3 cannot use.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'certs/**', 'logs/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-await-in-loop': 'off',
      'no-plusplus': 'off',
      // Deliberate no-op catches are used throughout for best-effort cleanup.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // ESLint 9 began checking catch parameters by default; this restores the ESLint 8
      // behaviour, so `catch (e) { /* ignore */ }` stays legal.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      // New in ESLint 9's recommended set. It flags two pre-existing dead assignments
      // (lib/auth-qlik.js, test/load-test.js). Off here so this upgrade changes tooling
      // only; worth turning back on when those two are cleaned up.
      'no-useless-assignment': 'off',
    },
  },
];
