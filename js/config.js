define([], function() {
  'use strict';

  /**
   * Configuration options for the Anthropic extension
   * 
   * For production use:
   * - Set DEBUG_MODE to false
   * - Point API.PROXY_URL / API.LOCAL.URL at your deployed hardened proxy
   * - Adjust the MODEL as needed for your use case
   */
  // Where the session-sticky model choice is mirrored (see saveModelState below).
  // Guarded because the module is also loaded in Node by the unit tests, where there
  // is no window, and because sessionStorage access throws outright in some privacy
  // modes rather than returning null.
  var MODEL_STATE_KEY = 'anthropicExtension.model';
  // Schema stamp for the stored choice. Bump it whenever the meaning of the stored fields
  // changes, so entries written by an older build are ignored rather than reinterpreted —
  // a stale locked pick from a previous build otherwise outlives the fix that addressed it
  // and keeps overriding the object's "Default model" property for the whole tab session.
  var MODEL_STATE_VERSION = 4;
  function hasSessionStorage() {
    try { return typeof window !== 'undefined' && !!window.sessionStorage; }
    catch (e) { return false; }
  }

  var config = {
    // Debug mode - set to false for production
    DEBUG_MODE: false,  // Change to true to enable verbose console logging

    // Console log verbosity (js/log.js): ERROR | WARN | INFO | DEBUG. Overridable
    // per-instance from the "Log level" property. Default DEBUG during test/demo so
    // the browser console shows everything; lower to WARN/ERROR to quieten it.
    LOG_LEVEL: 'DEBUG',

    // Extension version + build — single source of truth shown in the panel
    // footer and the settings panel. VERSION matches AnthropicExtension.qext;
    // bump BUILD by 1 on every package.
    VERSION: '0.5.4',
    BUILD: 44,
    // Author credit shown in the panel footer (also set in AnthropicExtension.qext).
    AUTHOR: 'mabaeyens',

    // API Configuration
    API: {
      // Proxy route for hosted (Anthropic) models. The proxy is MANDATORY (E01): the
      // browser never holds the API key and never calls api.anthropic.com directly —
      // the proxy holds the key server-side (P01) and authenticates the caller by their
      // Qlik session (P02). Overridden per-instance from the "Proxy URL" property.
      // Blank by default, and BLANK MEANS DISABLED: the models a backend serves are
      // withheld when its URL is empty. Both URLs are set per-instance from the object's
      // properties; shipping a localhost literal here only made an unconfigured object
      // look configured and fail at request time.
      PROXY_URL: '',
      // ── The active model is derived, never stored ────────────────────────────────
      // Exactly two facts are recorded, and both are set only by an explicit user action:
      //   MODEL_DEFAULT — the object's "Default model" property (the session default)
      //   MODEL_PICK    — the in-panel "Pick model" choice; null means "follow the property"
      // The model in effect is anthropicAPI.resolveActiveModel() = PICK || DEFAULT,
      // corrected at read time for a backend that is switched off. Nothing else writes
      // them, so an unreachable backend can never silently rewrite the user's choice —
      // which is precisely what a self-correcting, self-persisting active model did.
      MODEL_DEFAULT: 'claude-haiku-4-5',
      MODEL_PICK: null,
      // The shipped default, frozen. MODEL_DEFAULT is overwritten at runtime (property,
      // restored session state), so the properties-panel dropdown must not use it as its
      // defaultValue — a NEW object would then inherit whatever the last session left
      // behind instead of a stable, documented default.
      MODEL_SHIPPED_DEFAULT: 'claude-haiku-4-5',
      // The model registry — drives BOTH the properties-panel dropdown and the
      // in-panel picker. Entries with local:true are served by Ollama (OpenAI
      // chat-completions format, no API key); `tag` is the Ollama model name.
      MODELS: [
        { id: 'claude-haiku-4-5',   label: 'Haiku 4.5',        hint: 'fast, low cost' },
        { id: 'claude-sonnet-4-6',  label: 'Sonnet 4.6',       hint: 'balanced' },
        { id: 'claude-opus-4-8',    label: 'Opus 4.8',         hint: 'most capable' },
        { id: 'ministral-local',    label: 'Ministral 3 8B',   hint: 'local, via Ollama',
          local: true, tag: 'ministral-3-demo' },
        // Derived from ministral-3:3b with num_ctx 8192 — Ollama's 64k default
        // inflates the KV cache to ~10 GB and pushes the model almost entirely
        // onto the CPU. Half the footprint of the 8B at similar speed.
        { id: 'ministral-local-3b', label: 'Ministral 3 3B',   hint: 'local, lighter/faster',
          local: true, tag: 'ministral-3b-demo' }
      ],
      // Local-model backend (Ollama via the HTTPS proxy). Used when MODEL === 'ministral-local'.
      // Requests are sent in OpenAI chat-completions format; no API key is required.
      LOCAL: {
        // Proxy route that forwards to the local Ollama server, set per-instance from the
        // "Local model URL" property. Blank means the local models are unavailable. On
        // QSEoW (HTTPS) it must be an HTTPS endpoint — the browser cannot call
        // http://localhost:11434 directly.
        URL: '',
        // Fallback Ollama model name, used only if the selected entry has no `tag`.
        // 'ministral-3-demo' is a derived model with num_ctx baked to 8192 (see CHANGELOG
        // for the one-line Modelfile) — 8k keeps the 4 GB-GPU demo responsive (~6-7 tok/s)
        // while fitting trimmed chart payloads.
        MODEL_TAG: 'ministral-3-demo',
        LABEL: 'Ministral 3 8B (local)',
        // Client-side request timeout for local calls (ms). Much larger than the hosted
        // API's TIMEOUT: cold model load (~20s) plus generation at a few tok/s can run long.
        TIMEOUT: 300000,
        // Local models (Ministral/Mistral) are verbose by default and, at a few tok/s,
        // an over-long answer can generate for minutes. This is appended to the system
        // prompt on LOCAL calls only, to force brevity. Hosted models already follow the
        // base "Be concise" instruction well, so they don't get this. Set to '' to disable.
        SYSTEM_SUFFIX: 'IMPORTANT: Be extremely concise. Answer with at most 5 short bullet points or 3 short sentences. Do not restate the question, and add no preamble, disclaimers, or closing summary. Stop as soon as the question is answered.'
      },
      MAX_TOKENS: 4000,
      SYSTEM_PROMPT: 'You are a business analyst and expert Qlik Sense user. Be concise. Always aggregate the data and show absolute values and percentages. Focus on insights that would help business decision making. Present your analysis in a structured format with bullet points for key findings.',
      TIMEOUT: 60000,
      // Approximate context window (input+output tokens) used to warn before a
      // request would exceed the selected model's limit. Per-model with a fallback.
      CONTEXT_WINDOW: 200000,
      CONTEXT_WINDOWS: {
        'claude-haiku-4-5': 200000,
        'claude-sonnet-4-6': 200000,
        'claude-opus-4-8': 200000,
        // Local Ministral models — must match (or be ≤) the Ollama model's num_ctx so the
        // extension trims payloads before Ollama would silently truncate. The 8B demo model
        // has 8192 baked in; the 3B runs at Ollama's default, so keep the same guard.
        'ministral-local': 8192,
        'ministral-local-3b': 8192
      }
    },
    
    // Data Collection Settings
    DATA: {
      MAX_ROWS: 1000,
      // Hard ceiling on cells fetched from a single object's hypercube. Prevents
      // a wide/tall table from spawning thousands of concurrent engine requests
      // (which would freeze the tab). Data beyond this is truncated with a notice.
      MAX_FETCH_CELLS: 50000,
      // Cells fetched per getHyperCubeData page request (page height = this / width).
      MAX_CELLS_PER_PAGE: 10000,
      // Above this cell count the user is told the table was truncated.
      LARGE_TABLE_CELLS: 25000,
      // Max concurrent getHyperCubeData page requests.
      FETCH_PAGE_CONCURRENCY: 4,
      // Soft cap on the app-level field list sent as context (bounds token usage).
      MAX_FIELDS: 500,
      // Client-side egress-size thresholds (bytes). WARN prompts a confirm; MAX is a
      // hard client-side block reconciled with the proxy BODY_LIMIT (P04, default 1 MB)
      // so a request the server would 413 is caught here first with a friendlier message.
      WARN_PAYLOAD_BYTES: 66560,     // 65 * 1024
      MAX_PAYLOAD_BYTES: 1048576,    // 1 MB — matches the proxy BODY_LIMIT default
      DEFAULT_OPTIMIZATION: {
        maxRows: 1000,
        includeNumericValues: true,
        simplifyStructure: true,
        includeDimensions: true,
        includeMeasures: true
      }
    },
    
    // Conversation memory
    CHAT: {
      // Max number of prior messages (user+assistant) sent as history per request.
      // Bounds heap growth and per-request token cost over a long session.
      HISTORY_MAX: 12,
      // Render answers token-by-token as they arrive (SSE). Falls back to a
      // buffered request automatically when the browser or the proxy can't
      // stream. Set false to always wait for the complete response.
      STREAM: true
    },

    // Feature flags
    FEATURES: {
      EXTRACT_CITY_VALUES: false,  // Disable city-value extraction (not working with maps)
      SHOW_DEBUG_AREA: false       // Show debug area in UI when DEBUG_MODE is true
    },

    // Validate the data-collection bounds at init (E05 §4.2). Any invalid value falls
    // back to a documented safe default with a console warning — NEVER to unbounded
    // behaviour. Called once from main.js paint init; safe to call more than once.
    validateData: function() {
      var D = this.DATA || (this.DATA = {});
      var DEFAULTS = {
        MAX_ROWS: 1000, MAX_FETCH_CELLS: 50000, MAX_CELLS_PER_PAGE: 10000,
        LARGE_TABLE_CELLS: 25000, FETCH_PAGE_CONCURRENCY: 4, MAX_FIELDS: 500,
        WARN_PAYLOAD_BYTES: 66560, MAX_PAYLOAD_BYTES: 1048576
      };
      function posInt(v) { return typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v; }
      Object.keys(DEFAULTS).forEach(function(k) {
        if (!posInt(D[k])) {
          console.warn('[config] DATA.' + k + ' invalid (' + D[k] + '); using default ' + DEFAULTS[k]);
          D[k] = DEFAULTS[k];
        }
      });
      // Range + relational sanity so no path can fan out unbounded engine requests.
      if (D.FETCH_PAGE_CONCURRENCY > 16) {
        console.warn('[config] DATA.FETCH_PAGE_CONCURRENCY too high (' + D.FETCH_PAGE_CONCURRENCY + '); clamping to 16');
        D.FETCH_PAGE_CONCURRENCY = 16;
      }
      if (D.MAX_FETCH_CELLS < D.MAX_CELLS_PER_PAGE) {
        console.warn('[config] DATA.MAX_FETCH_CELLS < MAX_CELLS_PER_PAGE; raising to MAX_CELLS_PER_PAGE');
        D.MAX_FETCH_CELLS = D.MAX_CELLS_PER_PAGE;
      }
      return D;
    },

    // ── Session state ─────────────────────────────────────────────────────────
    // Only USER-SET FACTS are mirrored: the property default, the in-panel pick, and the
    // two endpoints. Never a derived value — an earlier version stored the corrected
    // active model, and one correction computed against a not-yet-applied endpoint then
    // outlived the tab, permanently overriding the property.
    //
    // The endpoints ride along because availability is judged against them: without them
    // a restore would evaluate "is this model reachable?" against the blank literals
    // above until the first paint(), i.e. against the wrong inputs.
    //
    // sessionStorage, not localStorage: the choice lasts for the browser tab, and a new
    // session starts from the object's "Default model" property again.
    saveModelState: function() {
      if (!hasSessionStorage()) return;
      try {
        window.sessionStorage.setItem(MODEL_STATE_KEY, JSON.stringify({
          v: MODEL_STATE_VERSION,
          modelDefault: this.API.MODEL_DEFAULT || null,
          modelPick: this.API.MODEL_PICK || null,
          proxyUrl: this.API.PROXY_URL || '',
          localUrl: (this.API.LOCAL && this.API.LOCAL.URL) || ''
        }));
      } catch (e) { /* private mode / quota — the in-memory values still apply */ }
    },

    // Restore the saved facts over the literals. Returns true when it applied. Ids no
    // longer in the registry (extension upgraded, model retired) are dropped, so a stale
    // entry can never pin the panel to a model this build does not ship.
    restoreModelState: function() {
      if (!hasSessionStorage()) return false;
      try {
        var raw = window.sessionStorage.getItem(MODEL_STATE_KEY);
        if (!raw) return false;
        var s = JSON.parse(raw);
        if (!s) return false;
        if (s.v !== MODEL_STATE_VERSION) {
          // Written by an older build with different field meanings — drop it.
          try { window.sessionStorage.removeItem(MODEL_STATE_KEY); } catch (e2) {}
          return false;
        }
        var known = function(id) {
          return !!id && this.API.MODELS.some(function(m) { return m.id === id; });
        }.bind(this);
        if (known(s.modelDefault)) this.API.MODEL_DEFAULT = s.modelDefault;
        this.API.MODEL_PICK = known(s.modelPick) ? s.modelPick : null;
        if (typeof s.proxyUrl === 'string') this.API.PROXY_URL = s.proxyUrl;
        if (typeof s.localUrl === 'string') this.API.LOCAL.URL = s.localUrl;
        return true;
      } catch (e) { return false; }
    }
  };

  // Apply any saved choice before the first render, so the panel never flashes — or
  // sticks on — the shipped default after a module re-instantiation.
  try { config.restoreModelState(); } catch (e) { /* never block module load */ }

  return config;
});