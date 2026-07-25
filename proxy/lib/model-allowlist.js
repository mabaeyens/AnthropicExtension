'use strict';

// Server-side model allowlist (P04 §1). Authoritative: the extension's client-side model
// registry is advisory, but the proxy will only call an upstream model that appears here.
// Per route (Anthropic models for /api/anthropic, Ollama tags for /api/ollama), overridable
// from the environment.
function modelAllowlist(env = process.env) {
  const parse = (v, fallback) => new Set(
    String(v || fallback).split(',').map((s) => s.trim()).filter(Boolean),
  );
  return {
    anthropic: parse(env.ALLOWED_ANTHROPIC_MODELS,
      'claude-haiku-4-5,claude-sonnet-4-6,claude-opus-4-8'),
    ollama: parse(env.ALLOWED_OLLAMA_MODELS,
      'ministral-3-demo,ministral-3b-demo'),
  };
}

module.exports = { modelAllowlist };
