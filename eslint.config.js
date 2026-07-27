'use strict';

// Flat config (ESLint 9+). Replaces .eslintrc.json. The upgrade off ESLint 8 was driven by
// security: every high-severity advisory in `npm audit` came from ESLint 8's dependency
// chain (minimatch -> brace-expansion), and the only patched brace-expansion is on a major
// line that minimatch 3 cannot use. Dev tooling only; nothing here ships in the extension.
const js = require('@eslint/js');
const globals = require('globals');

const sharedRules = {
  'no-console': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
  // ESLint 9 began checking catch parameters by default; this keeps the ESLint 8 behaviour.
  'no-unused-vars': ['warn', { args: 'none', vars: 'all', caughtErrors: 'none' }],
  'no-prototype-builtins': 'off',
  // New in ESLint 9's recommended set. It flags the defensive
  // `var bytes = 0; try { bytes = ... } catch (e) {}` pattern used in several places,
  // where the initialiser IS the fallback. Off, so this upgrade changes tooling only.
  'no-useless-assignment': 'off',
};

module.exports = [
  { ignores: ['js/lib/**', 'node_modules/**', '_ul/**', 'proxy/**'] },
  js.configs.recommended,
  {
    // The shipped runtime: plain AMD loaded by Qlik's RequireJS, no build step.
    files: ['js/**/*.js', 'AnthropicExtension.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.amd,
        define: 'readonly',
        require: 'readonly',
        requirejs: 'readonly',
      },
    },
    rules: sharedRules,
  },
  {
    // Tests run in Node (node:test + test/amd-loader.js), never in the browser.
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: sharedRules,
  },
];
