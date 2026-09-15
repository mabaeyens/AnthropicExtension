# Changelog — cm-llm-proxy

All notable changes to the proxy are documented here. The proxy is versioned and tagged
**independently** of the extension: its tags are `proxy-vX.Y.Z` (the extension uses `vX.Y.Z`).
The two live in one monorepo but ship on their own cadence.

## [2.0.2] - 2026-09-15

### Fixed — TLS dev certificate now correctly constrained (security-relevant)

`scripts/setup.ps1 -DevCert` (and the manual `openssl` command in the README) previously generated a **self-signed leaf certificate with `basicConstraints: CA:TRUE`** and no `keyUsage`/`extendedKeyUsage` restriction — i.e. the certificate the proxy presents for TLS was, by its own X.509 extensions, itself a valid Certification Authority, capable in principle of signing further certificates, rather than a constrained end-entity certificate scoped to serving TLS for one hostname. Windows CryptoAPI and Chrome accept such a certificate for TLS without complaint; Firefox's strict path-building validator (`mozilla::pkix`) correctly refuses it (`MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY`), which is how this was caught.

**Fix:** certificate generation is now a proper two-tier setup —
1. A **dedicated local development CA** (`certs/ca/`, `CN=AnthropicExtension Proxy Dev CA`, `basicConstraints=critical,CA:TRUE,pathlen:0`, `keyUsage=critical,keyCertSign,cRLSign`, generated once per checkout) — separate from, and with no relationship to, any CA used elsewhere in the customer's Qlik or corporate PKI.
2. A **constrained end-entity leaf certificate** (`certs/localhost3000-cert.pem`) signed by that CA, with `basicConstraints=critical,CA:FALSE`, `keyUsage=critical,digitalSignature,keyEncipherment`, and `extendedKeyUsage=serverAuth` — i.e. usable only to serve TLS for the proxy's configured hostnames (`-CertHosts`), not to sign anything else.

`-TrustCert` now imports only the CA into the OS trust store, never the leaf, so certificate rotation or adding a hostname later never requires re-importing anything. Both the CA's and the leaf's private keys are generated locally, never leave the host, and are git-ignored (`certs/ca/` was added to `.gitignore`); the CA key is treated as more sensitive than the leaf's, since it alone can mint further certificates.

**Action for existing deployments:** regenerate the certificate. The previous `CA:TRUE` self-signed cert should be considered non-conformant to expected TLS end-entity constraints and replaced; it was never distributed outside the local `certs/` directory (git-ignored) so this is a local remediation, not a supply-chain concern.

### Fixed

- `setup.ps1 -CertHosts` is now a comma-separated **string**, not a PowerShell array — an array-typed parameter does not reliably survive a `pwsh -File` invocation from outside PowerShell (observed: silently collapsed into one malformed SAN value).

### Documented

- `npm ci` deletes `node-windows` (deliberately excluded from `package-lock.json` so it never reaches a production node's dependency tree), which crashes an already-installed Windows service with Error 1067 on its next restart. Documented in Setup, Operations, and the Troubleshooting table; fix is `npm install --no-save node-windows` then `Restart-Service <name>`.

## [2.0.1] - 2026-09-15

### Fixed

- **Default Anthropic model allowlist updated to the current Claude generation.**
  `ALLOWED_ANTHROPIC_MODELS` default (`lib/model-allowlist.js`, `.env.example`) changed
  from `claude-haiku-4-5,claude-sonnet-4-6,claude-opus-4-8` to
  `claude-haiku-4-5,claude-sonnet-5,claude-opus-5`, matching the extension's updated
  registry. A deployment with `ALLOWED_ANTHROPIC_MODELS` explicitly set in its own `.env`
  must update that value too, or the proxy will `403` the new IDs.

### Added

- **`SERVICE_NAME` env var** for `service/install-service.js` / `uninstall-service.js`,
  so an operator can register the Windows service under a site-specific name instead of
  the hardcoded `cm-llm-proxy`. Default behavior is unchanged when unset.

## [2.0.0] - 2026-07-26

Production-hardening release. Turns the demo-grade `cm-llm-proxy` into a hardened gateway that
holds the Anthropic key server-side and authenticates every caller by their Qlik session
(specs P01–P07). **Breaking**: the proxy now *requires* Qlik-session auth and env-based
credentials — a client can no longer just reach it and spend the key.

### ⚠️ Breaking

- **Caller authentication is now mandatory.** Every `/api/*` request must present a valid Qlik
  session; unauthenticated requests are rejected `401` before any upstream call. Requires
  `QLIK_SESSION_URL`, `QLIK_CERT`, `QLIK_KEY` (and CORS `QLIK_ORIGINS`) — the proxy fails fast at
  boot without them.
- **The Anthropic key must be server-side** (`ANTHROPIC_API_KEY` env); any client-supplied key
  header is stripped. There is no pass-through of a browser key anymore.

### Added

- **Credential custody (P01):** key from env, injected per request, client key headers stripped;
  bounded retry/backoff on transient upstream 429/5xx.
- **Caller authentication (P02):** validates the Qlik session against QPS over mutual-TLS and
  resolves the real user id. Session carrier is the same-site `X-Qlik-Session` cookie (a named
  virtual proxy uses `X-Qlik-Session-<prefix>` via `QLIK_SESSION_COOKIE`); the `x-qlik-session`
  header is an explicit ticket override. Positive-only TTL cache.
- **Concurrency & resilience (P03):** global + per-user in-flight ceilings, bounded FIFO queue
  (`503` + `Retry-After` on overflow/timeout), streaming backpressure, keep-alive upstream pools,
  graceful drain on shutdown.
- **Input validation & model allowlist (P04):** per-route body-schema validation, request-size
  caps, server-side model allowlist.
- **Transport & CORS hardening (P05):** strict origin allowlist, security headers, TLS floor,
  per-IP rate limiting.
- **Observability & service (P06):** structured JSON logs with level gating (`LOG_LEVEL`), a
  separate audit log (no bodies/secrets), `/health` · `/ready` · `/metrics`, boot-time config
  validation, and a Windows-service wrapper (auto-start/restart, log rotation). `setup.ps1`
  automates install.
- **Streaming** on both routes (`stream: true`), piped through untouched as `text/event-stream`.
- **Client-cancel propagation:** when the client disconnects (closed tab / the extension's Stop
  button), the upstream call is cancelled so the model stops generating — streaming destroys the
  piped stream, and the buffered path aborts the in-flight upstream call via an `AbortSignal`
  wired to the response `close`.
- **Tests & CI (P07):** 102 `node:test` cases (integration over the real `/api` surface, load,
  drain), ESLint, GitHub Actions.

### Fixed

- **QPS xrfkey (P02).** Verified end-to-end against a live QSEoW node: QPS rejects any API call
  without an XSRF key (`403 "XSRF prevention check failed"`), which was mapped to `AuthError` and
  would have rejected **every** session, valid or not. The session-validation call now sends a
  16-char xrfkey in both the query string and the `X-Qlik-Xrfkey` header. Note: `QLIK_SESSION_URL`'s
  host must match a SAN of the QPS certificate (QSEoW uses the short hostname, not the FQDN).

## [1.2.0] - prior

Standalone `cm-llm-proxy` (pre-monorepo): local HTTPS forwarder to Anthropic and Ollama with
streaming. See git history before the subtree merge for earlier detail.
