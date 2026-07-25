'use strict';

// Minimal AMD loader for tests (E06). The shipped runtime is plain `define([...], factory)`
// loaded by Qlik's RequireJS — there is NO build step and we must not add one. To unit-test
// the pure logic modules in Node without a bundler, this evaluates a module file in a vm
// sandbox that provides a `define` capturing (deps, factory), resolves each dependency from
// a caller-supplied stub map, and returns the factory's exports. Generalises the throwaway
// scratch `parse-test.js` harness. No network, no DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load an AMD module by repo-relative path (e.g. 'js/chart-builder.js'), injecting `stubs`
// keyed by the EXACT dependency string in the module's define([...]) list (e.g. './config').
// A dependency with no stub throws, so a test can never silently pull in an unmocked module.
function loadAmd(relPath, stubs = {}, sandboxExtras = {}) {
  const abs = path.resolve(__dirname, '..', relPath);
  const code = fs.readFileSync(abs, 'utf8');
  let captured;

  function define(deps, factory) {
    if (typeof deps === 'function') { factory = deps; deps = []; }
    const resolved = deps.map((d) => {
      if (Object.prototype.hasOwnProperty.call(stubs, d)) return stubs[d];
      throw new Error(`Unstubbed AMD dependency "${d}" required by ${relPath}`);
    });
    captured = factory.apply(null, resolved);
  }
  define.amd = true;

  const sandbox = Object.assign({
    define,
    console,
    setTimeout,
    clearTimeout,
    Math,
    JSON,
    Date,
    URL,
  }, sandboxExtras);
  // NB: `window` is intentionally left undefined unless a test provides it, so modules that
  // guard on `typeof window !== 'undefined'` take their no-DOM branch (e.g. formatting.js
  // fail-closed sanitize).

  vm.runInNewContext(code, sandbox, { filename: abs });
  if (captured === undefined) throw new Error(`Module ${relPath} did not call define()`);
  return captured;
}

module.exports = { loadAmd };
