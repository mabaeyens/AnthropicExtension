'use strict';

// Per-route body schema validation (P04 §4.2). The proxy now holds the key and the
// request body is attacker-adjacent input, so it is validated against an explicit
// shape before any upstream call. Unknown top-level keys are REJECTED (not stripped):
// a body the extension didn't intend to send is a bug or an attack, and silent
// stripping would mask it. The monorepo keeps this schema beside the client contract
// (E01/E02), so a new legitimate field is added here in the same commit.

const ALLOWED_KEYS = new Set(['model', 'messages', 'max_tokens', 'stream', 'system']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Returns a (possibly empty) array of human-readable error strings. Empty === valid.
// Messages are safe to log server-side; they never echo the offending values.
function validateChatBody(body, { maxTokensCap = 8192 } = {}) {
  const errors = [];

  if (!isPlainObject(body)) {
    return ['body must be a JSON object'];
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  }

  if (typeof body.model !== 'string' || body.model.trim() === '') {
    errors.push('model must be a non-empty string');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    errors.push('messages must be a non-empty array');
  } else {
    body.messages.forEach((m, i) => {
      if (!isPlainObject(m)) {
        errors.push(`messages[${i}] must be an object`);
        return;
      }
      if (typeof m.role !== 'string' || m.role.trim() === '') {
        errors.push(`messages[${i}].role must be a non-empty string`);
      }
      if (m.content === undefined || m.content === null) {
        errors.push(`messages[${i}].content is required`);
      }
    });
  }

  if (body.max_tokens !== undefined) {
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > maxTokensCap) {
      errors.push(`max_tokens must be an integer in [1, ${maxTokensCap}]`);
    }
  }

  if (body.stream !== undefined && typeof body.stream !== 'boolean') {
    errors.push('stream must be a boolean');
  }

  if (body.system !== undefined && typeof body.system !== 'string') {
    errors.push('system must be a string');
  }

  return errors;
}

module.exports = { validateChatBody, ALLOWED_KEYS };
