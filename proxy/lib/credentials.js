'use strict';

// Server-side credential custody (P01). The upstream API key lives ONLY here, sourced
// from the environment and validated at boot. Client-supplied auth headers are never
// read or forwarded — outbound headers are built fresh, so a client `x-api-key` or
// `authorization` is inherently stripped rather than passed through.

// Load and validate the Anthropic key. Throws (→ the caller fails the process fast) if
// it is absent, so the proxy never starts and then 500s on the first hosted call.
function loadAnthropicKey(env = process.env) {
  const key = (env.ANTHROPIC_API_KEY || '').trim();
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The proxy holds the upstream key server-side; ' +
      'set it in the environment (or proxy/.env) before starting.'
    );
  }
  return key;
}

// Build the outbound headers for a provider. The server-held key is injected here for
// providers that require it; NO inbound request header is copied, so a client-supplied
// key/authorization cannot reach the upstream (P01 §3, §4).
function buildUpstreamHeaders(provider, apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.requiresKey) {
    if (!apiKey) throw new Error(`Provider "${provider.name}" requires a key but none was loaded.`);
    headers['x-api-key'] = apiKey;
    if (provider.anthropicVersion) headers['anthropic-version'] = provider.anthropicVersion;
  }
  return headers;
}

module.exports = { loadAnthropicKey, buildUpstreamHeaders };
