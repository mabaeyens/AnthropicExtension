define([], function() {
  'use strict';

  /**
   * Configuration options for the Anthropic extension
   * 
   * For production use:
   * - Set DEBUG_MODE to false
   * - Update the API.URL to point to your production endpoint
   * - Adjust the MODEL as needed for your use case
   */
  return {
    // Debug mode - set to false for production
    DEBUG_MODE: false,  // Change to true to enable verbose console logging

    // Extension version + build — single source of truth shown in the panel
    // footer and the settings panel. VERSION matches AnthropicExtension.qext;
    // bump BUILD by 1 on every package.
    VERSION: '0.3.5',
    BUILD: 26,
    // Author credit shown in the panel footer (also set in AnthropicExtension.qext).
    AUTHOR: 'mabaeyens',

    // API Configuration
    API: {
      // Direct Anthropic endpoint, called from the browser. Used when PROXY_URL is empty.
      URL: 'https://api.anthropic.com/v1/messages',
      // Optional local proxy URL. When non-empty, requests are routed here instead
      // of calling api.anthropic.com directly (and the direct-browser headers are omitted).
      // Overridden per-instance from the extension's "Proxy URL" property.
      PROXY_URL: '',
      // Anthropic API version header, required for direct browser calls.
      VERSION: '2023-06-01',
      // Default model. Overridden per-instance from the extension's "Model" property.
      MODEL: 'claude-haiku-4-5',
      // Models offered in the properties-panel dropdown. 'ministral-local' is a
      // synthetic id selecting the local (Ollama) backend rather than an Anthropic model.
      MODELS: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8', 'ministral-local'],
      // Local-model backend (Ollama via the HTTPS proxy). Used when MODEL === 'ministral-local'.
      // Requests are sent in OpenAI chat-completions format; no API key is required.
      LOCAL: {
        // Proxy route that forwards to the local Ollama server. Overridden per-instance
        // from the extension's "Local model URL" property. On QSEoW (HTTPS) this must be an
        // HTTPS endpoint — the browser cannot call http://localhost:11434 directly.
        URL: 'https://localhost:3000/api/ollama',
        // Ollama model name sent in the payload's `model` field. This is a derived model
        // with num_ctx baked to 8192 (see CHANGELOG for the one-line Modelfile). 8k keeps
        // the 4 GB-GPU demo responsive (~6-7 tok/s) while fitting trimmed chart payloads.
        // Plain 'ministral-3:8b' also works but runs at Ollama's default context length.
        MODEL_TAG: 'ministral-3-demo',
        LABEL: 'Ministral 3 8B (local)',
        // Client-side request timeout for local calls (ms). Much larger than the hosted
        // API's TIMEOUT: cold model load (~20s) plus generation at a few tok/s can run long.
        TIMEOUT: 300000
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
        // Local Ministral 3 8B — must match (or be ≤) the Ollama model's baked num_ctx so the
        // extension trims payloads before Ollama would silently truncate. Demo model = 8192.
        'ministral-local': 8192
      }
    },
    
    // Data Collection Settings
    DATA: {
      MAX_ROWS: 1000,
      // Hard ceiling on cells fetched from a single object's hypercube. Prevents
      // a wide/tall table from spawning thousands of concurrent engine requests
      // (which would freeze the tab). Data beyond this is truncated with a notice.
      MAX_FETCH_CELLS: 50000,
      // Above this cell count the user is told the table was truncated.
      LARGE_TABLE_CELLS: 25000,
      // Max concurrent getHyperCubeData page requests.
      FETCH_PAGE_CONCURRENCY: 4,
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
      HISTORY_MAX: 12
    },

    // Feature flags
    FEATURES: {
      EXTRACT_CITY_VALUES: false,  // Disable city-value extraction (not working with maps)
      SHOW_DEBUG_AREA: false       // Show debug area in UI when DEBUG_MODE is true
    }
  };
});