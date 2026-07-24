'use strict';

// Upstream provider/target configuration (P01 §5). Centralises URLs, versions,
// timeouts, and which providers require the server-held credential, so route
// handlers never inline them. `OLLAMA_URL` and the timeouts are read from the
// environment with sensible defaults.
//
// Exposed as a factory so tests (and a future config reload) can build it against
// an explicit env instead of the ambient process.env.
function providers(env = process.env) {
  return {
    anthropic: {
      name: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      anthropicVersion: '2023-06-01',
      requiresKey: true,
      timeoutMs: Number(env.ANTHROPIC_TIMEOUT_MS) || 60000,
    },
    ollama: {
      name: 'ollama',
      url: env.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions',
      requiresKey: false,
      timeoutMs: Number(env.OLLAMA_TIMEOUT_MS) || 300000,
    },
  };
}

module.exports = { providers };
