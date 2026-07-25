define(['./config'], function (config) {
  'use strict';

  // Level-gated console logging for the extension. Verbosity is controlled by
  // config.LOG_LEVEL (ERROR < WARN < INFO < DEBUG) — set once in config.js and
  // overridable per-instance from the "Log level" property (main.js reads it into
  // config on every paint, so a change takes effect live). A message is written only
  // when its level is at or below the configured threshold: LOG_LEVEL=ERROR shows only
  // errors; DEBUG spits out everything. The threshold is read on each call, so the
  // property can raise/lower verbosity mid-session.
  var LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

  function threshold() {
    var lvl = String(config.LOG_LEVEL || 'INFO').toUpperCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, lvl) ? LEVELS[lvl] : LEVELS.INFO;
  }

  function emit(levelName, sink, args) {
    if (LEVELS[levelName] > threshold()) return;
    try { sink.apply(console, args); } catch (e) { /* console unavailable — ignore */ }
  }

  return {
    LEVELS: LEVELS,
    error: function () { emit('ERROR', console.error, arguments); },
    warn: function () { emit('WARN', console.warn, arguments); },
    info: function () { emit('INFO', console.info || console.log, arguments); },
    debug: function () { emit('DEBUG', console.debug || console.log, arguments); }
  };
});
