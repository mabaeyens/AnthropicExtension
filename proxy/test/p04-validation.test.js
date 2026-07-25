'use strict';

// P04 — input validation & limits. Deterministic unit tests of the body schema, the
// model allowlist, and the validate middleware. No network, no express server.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateChatBody } = require('../lib/schemas');
const { modelAllowlist } = require('../lib/model-allowlist');
const { validateBody } = require('../middleware/validate');

const validBody = {
  model: 'claude-haiku-4-5',
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 1024,
  stream: false,
};

// ── schema: validateChatBody ────────────────────────────────────────────────
test('a well-formed body passes with no errors', () => {
  assert.deepEqual(validateChatBody(validBody), []);
});

test('a non-object body is rejected', () => {
  assert.ok(validateChatBody(null).length > 0);
  assert.ok(validateChatBody('nope').length > 0);
  assert.ok(validateChatBody([]).length > 0);
});

test('unknown top-level keys are rejected', () => {
  const errs = validateChatBody({ ...validBody, evil: 1 });
  assert.ok(errs.some((e) => e.includes('unknown field: evil')));
});

test('missing / empty messages is rejected', () => {
  assert.ok(validateChatBody({ model: 'claude-haiku-4-5' }).some((e) => e.includes('messages')));
  assert.ok(validateChatBody({ model: 'claude-haiku-4-5', messages: [] }).some((e) => e.includes('messages')));
});

test('a message missing role / content is rejected', () => {
  const noRole = validateChatBody({ model: 'm', messages: [{ content: 'x' }] });
  assert.ok(noRole.some((e) => e.includes('role')));
  const noContent = validateChatBody({ model: 'm', messages: [{ role: 'user' }] });
  assert.ok(noContent.some((e) => e.includes('content')));
});

test('model must be a non-empty string', () => {
  assert.ok(validateChatBody({ ...validBody, model: '' }).some((e) => e.includes('model')));
  assert.ok(validateChatBody({ ...validBody, model: 5 }).some((e) => e.includes('model')));
});

test('max_tokens out of [1, cap] is rejected', () => {
  assert.ok(validateChatBody({ ...validBody, max_tokens: 0 }).some((e) => e.includes('max_tokens')));
  assert.ok(validateChatBody({ ...validBody, max_tokens: 1.5 }).some((e) => e.includes('max_tokens')));
  assert.ok(validateChatBody({ ...validBody, max_tokens: 99999 }, { maxTokensCap: 8192 })
    .some((e) => e.includes('max_tokens')));
  assert.deepEqual(validateChatBody({ ...validBody, max_tokens: 8192 }, { maxTokensCap: 8192 }), []);
});

test('stream must be boolean; system must be string', () => {
  assert.ok(validateChatBody({ ...validBody, stream: 'yes' }).some((e) => e.includes('stream')));
  assert.ok(validateChatBody({ ...validBody, system: 5 }).some((e) => e.includes('system')));
});

// ── allowlist ───────────────────────────────────────────────────────────────
test('default allowlist contains the shipped models, env overrides it', () => {
  const def = modelAllowlist({});
  assert.ok(def.anthropic.has('claude-haiku-4-5'));
  assert.ok(def.ollama.has('ministral-3b-demo'));
  const over = modelAllowlist({ ALLOWED_ANTHROPIC_MODELS: 'only-this' });
  assert.ok(over.anthropic.has('only-this'));
  assert.ok(!over.anthropic.has('claude-haiku-4-5'));
});

// ── validate middleware ───────────────────────────────────────────────────────
function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const allowlist = modelAllowlist({});

test('valid + allowed model calls next(), no response written', () => {
  const mw = validateBody('anthropic', { allowlist, maxTokensCap: 8192 });
  const res = fakeRes();
  let nexted = false;
  mw({ body: { ...validBody } }, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, null);
});

test('schema violation → 400, no next, body not echoed', () => {
  const mw = validateBody('anthropic', { allowlist, maxTokensCap: 8192 });
  const res = fakeRes();
  let nexted = false;
  mw({ body: { model: 'claude-haiku-4-5', messages: [], secret: 'leak' } }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.requestId);
  assert.equal(JSON.stringify(res.body).includes('leak'), false);
});

test('disallowed model → 403, no next', () => {
  const mw = validateBody('anthropic', { allowlist, maxTokensCap: 8192 });
  const res = fakeRes();
  let nexted = false;
  mw({ body: { ...validBody, model: 'gpt-4' } }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
  assert.ok(res.body.requestId);
});

test('a valid ollama body is checked against the ollama list, not anthropic', () => {
  const mw = validateBody('ollama', { allowlist, maxTokensCap: 8192 });
  const res = fakeRes();
  let nexted = false;
  mw({ body: { model: 'ministral-3b-demo', messages: [{ role: 'user', content: 'x' }] } },
    res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, null);
});
