# cm-llm-proxy — v2.0.0

> ℹ️ **This proxy now lives in the [AnthropicExtension](../README.md) monorepo**, under `proxy/`.
> It was previously the standalone `mabaeyens/cm-llm-proxy` repository (now archived); its history
> was preserved when it was merged here. File issues and PRs against the AnthropicExtension repo.
>
> The proxy is versioned and tagged **independently** of the extension: `proxy-vX.Y.Z` here,
> `vX.Y.Z` for the extension. **Proxy v2.0.0 pairs with extension v0.5.1.** Release notes:
> [`CHANGELOG.md`](./CHANGELOG.md).

HTTPS gateway that sits between the Qlik Sense [AnthropicExtension](../README.md) and the Anthropic
API **or a local Ollama model**. It holds the Anthropic key server-side and authenticates every
caller by their Qlik session.

> ## ⚠️ Breaking changes in v2.0.0
>
> v2.0.0 turns the demo-grade forwarder into a hardened gateway. If you are upgrading from 1.x:
>
> - **Caller authentication is mandatory.** Every `/api/*` request must present a valid Qlik session;
>   unauthenticated requests are rejected `401` before any upstream call. This requires
>   `QLIK_SESSION_URL`, `QLIK_CERT`, `QLIK_KEY` and `QLIK_ORIGINS` — the proxy **fails fast at boot**
>   without them.
> - **The Anthropic key must be server-side** (`ANTHROPIC_API_KEY` in the environment). Any
>   client-supplied key header is stripped; there is no pass-through of a browser key.
>
> A 1.x proxy will not work with extension v0.5.1: it can't authenticate the caller, and it doesn't
> propagate client cancellation, so the extension's **Stop** button won't halt inference.

## Why is this needed?

Three reasons, in order of importance:

1. **Credential custody & access control.** The Anthropic key never reaches the browser — the proxy
   injects it per request and only after validating the caller's Qlik session, so a client can't
   simply reach the endpoint and spend the key.
2. **CORS / same-origin.** Qlik Sense Server does not allow direct calls to external APIs from the
   browser. The proxy runs on the Qlik node (or locally) and acts as the intermediary.
3. **Mixed content.** An HTTPS Qlik page cannot call a plain-HTTP local Ollama server directly, so
   `/api/ollama` bridges it over HTTPS.

```
Qlik Sense (browser) → https://localhost:3000/api/anthropic → api.anthropic.com
Qlik Sense (browser) → https://localhost:3000/api/ollama    → http://localhost:11434 (Ollama)
```

## Requirements

- Node.js >= 18
- SSL certificates for the proxy hostname (see Certificates section)
- **Qlik session validation:** reachable QPS endpoint (`QLIK_SESSION_URL`) plus Qlik client
  certificate/key (`QLIK_CERT` / `QLIK_KEY`) for mutual TLS, and the hub origin(s) in `QLIK_ORIGINS`
- An **Anthropic API key** in `ANTHROPIC_API_KEY` (not needed for the `/api/ollama` route only)

## Setup

### Automated (Windows / PowerShell) — recommended

`scripts/setup.ps1` does the mechanical steps for you (idempotent): checks Node, runs
`npm ci`, optionally generates a dedicated local dev CA + a proper leaf cert signed by it
(and trusts the CA), scaffolds `.env` from the template with the values you pass, and
optionally registers the Windows service. You still supply the site secrets (API key,
Qlik auth) — the script never invents them.

```powershell
# Local dev: deps + a CA-signed dev cert (SAN: localhost, 127.0.0.1, and your real
# hostname) trusted in the current user's store + starter .env, then `npm start`.
pwsh scripts/setup.ps1 -DevCert -TrustCert -CertHosts 'your-qlik,your-qlik.example.com' `
  -ApiKey 'sk-ant-...' -QlikSessionUrl 'https://your-qlik:4243/qps/session' `
  -QlikCert './certs/client.pem' -QlikKey './certs/client_key.pem' `
  -Origins 'https://your-qlik' -LogLevel DEBUG

# Production node: deps + .env + register the auto-start Windows service
# (use a CA-signed cert: set TLS_CERT/TLS_KEY in .env — see "Production certificate").
pwsh scripts/setup.ps1 -ApiKey 'sk-ant-...' -QlikSessionUrl '...' `
  -QlikCert '...' -QlikKey '...' -Origins 'https://your-qlik' -LogLevel INFO -InstallService
```

`-CertHosts` is a **comma-separated string** (`'host1,host2'`), not a PowerShell array —
array-typed parameters don't reliably survive a `pwsh -File` invocation from outside
PowerShell, so this avoids that trap entirely. Run `Get-Help scripts/setup.ps1 -Full` for
every parameter.

> **If the service is already installed, re-running this script (or any bare `npm ci`)
> will break it.** `npm ci --omit=dev` deletes anything not in `package-lock.json` —
> which includes `node-windows`, deliberately kept out of the lockfile so it never lands
> on a production node's dependency tree. The service then fails to start (Windows
> **Error 1067**, "the process terminated unexpectedly"; the wrapper log under
> `daemon/*.err.log` shows `Cannot find module '...\node-windows\lib\wrapper.js'`). Fix:
> `npm install --no-save node-windows`, then `Restart-Service <name>` — no need to
> re-register the service, just restore the missing package.

### Manual

```bash
# 1. Copy and edit the environment file
cp .env.example .env
# Edit .env: set the required vars (ANTHROPIC_API_KEY, QLIK_SESSION_URL, QLIK_CERT,
# QLIK_KEY, QLIK_ORIGINS) and optionally LOG_LEVEL

# 2. Install RUNTIME dependencies (omit dev tooling like ESLint on a production node —
#    that dev tree is where npm-audit "high severity" findings come from and it never runs
#    on the node). Use plain `npm ci` locally when you also want to lint/test.
npm ci --omit=dev
```

## Configuration

All settings are configured via `.env` (copied from `.env.example`):

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Required.** Anthropic key, injected server-side per request | _(none — boot fails)_ |
| `QLIK_SESSION_URL` | **Required.** QPS session endpoint used to validate the caller, e.g. `https://<qlik-host>:4243/qps/session`. The host **must match a SAN of the QPS certificate** — QSEoW uses the **short hostname**, not the FQDN | _(none — boot fails)_ |
| `QLIK_CERT` / `QLIK_KEY` | **Required.** Qlik client certificate/key for mutual TLS to QPS | _(none — boot fails)_ |
| `QLIK_SESSION_COOKIE` | Cookie carrying the session; set to `X-Qlik-Session-<prefix>` for a named virtual proxy | `X-Qlik-Session` |
| `QLIK_ORIGINS` | Comma-separated CORS origin allowlist (exact match); `QLIK_ORIGIN` still accepted as a legacy fallback | `https://your-qlik-server` |
| `PORT` | Proxy server port | `3000` |
| `OLLAMA_URL` | Local Ollama OpenAI-compatible endpoint (for `/api/ollama`) | `http://localhost:11434/v1/chat/completions` |
| `TLS_CERT` / `TLS_KEY` | TLS cert/key paths (production = CA-signed) | `./certs/localhost3000-*.pem` |
| `TLS_MIN_VERSION` | Minimum negotiated TLS version | `TLSv1.2` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Per-IP rate-limit window and cap | `60000` / `120` |

See `.env.example` for the full annotated list (credentials, auth, concurrency, validation).

## Certificates

Certificates are **not in the repo** — `certs/*.pem` is git-ignored, since a private key
doesn't belong in version control and a `localhost` certificate is useless to anyone else.
The server won't start until you generate your own.

**On Windows, `scripts/setup.ps1 -DevCert -TrustCert` (see Setup above) is the
recommended way to do this** — it generates a dedicated local CA plus a leaf cert signed
by it, and trusts only the CA, so rotating the leaf or adding a hostname later never
needs re-trusting. The manual single-command version below produces one self-signed
leaf trusted directly instead — simpler for a quick one-off, but every rotation needs a
fresh `certutil` import:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/localhost3000-key.pem \
  -out certs/localhost3000-cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"
```

> The `subjectAltName` is required — browsers reject certificates that only carry a CN.
> The three `basicConstraints`/`keyUsage`/`extendedKeyUsage` extensions are **required
> too, not cosmetic**: without an explicit `basicConstraints=CA:FALSE`, some OpenSSL
> versions default a self-signed `-x509` cert to `CA:TRUE`. Chrome/Windows CryptoAPI
> tolerate that, but Firefox's strict validator (`mozilla::pkix`) flatly refuses to use a
> CA-flagged certificate as a TLS end-entity/leaf, failing closed with
> `MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY` and no way to click through it. Verify
> with `openssl x509 -in certs/localhost3000-cert.pem -noout -text | grep -A2 "Basic Constraints"`
> — it must read `CA:FALSE`.

The certificate must then be trusted, or the browser will silently block the extension's
request (an XHR failure with no status, not a warning you can click through). On Windows,
Chrome and Edge read the OS store:

```powershell
certutil -user -addstore Root certs\localhost3000-cert.pem
```

Restart the browser afterwards — close every window, not just the tab; the cert/HSTS state
is cached at the process level. To remove it later, use
`certutil -user -delstore Root <thumbprint>`.

> **Firefox does not read the Windows certificate store by default** — it keeps its own
> (NSS-based) trust store, so importing into `Cert:\CurrentUser\Root` above has no effect
> on it. Either import the cert directly into Firefox (**Settings → Privacy & Security →
> Certificates → View Certificates → Authorities → Import**, then check "Trust this CA to
> identify websites"), or, better for a cert that will get rotated later, flip
> `security.enterprise_roots.enabled` to `true` in `about:config` and restart Firefox —
> that makes it read the Windows store the same way Chrome/Edge already do, so a future
> rotation needs no separate Firefox step.

> **If the proxy shares a hostname with the Qlik hub** (e.g. both are reached as
> `spmad-mby1`, just on different ports), an untrusted proxy cert shows up as an **HSTS**
> error instead of the usual "Your connection isn't private → Proceed anyway": *"You
> cannot visit `<host>` right now because the website uses HSTS."*, with no click-through
> link at all. This happens because the Qlik hub (port 443) already sent a
> `Strict-Transport-Security` header for that bare hostname, and the browser then refuses
> *any* untrusted cert on *any* port of that same host, HSTS-pinned host regardless of
> which service actually issued the header. The fix is the same — trust the cert above —
> but there's no way to bypass it temporarily to check; it's trust-it-or-nothing.

### Production certificate (issuance & rotation)

The self-signed pair above is for **local dev only**. In production the proxy runs on the
Qlik node and must present a **CA-signed certificate for the proxy's own hostname** (the
name the extension's Proxy URL points at), issued by your internal/enterprise CA so the
Qlik page trusts it without a manual store import:

- Issue the cert against the FQDN clients use; set `TLS_CERT` / `TLS_KEY` to its paths
  (keep them off the repo — `certs/*.pem` stays git-ignored). `TLS_MIN_VERSION` defaults
  to `TLSv1.2`; set `TLSv1.3` where the client fleet supports it.
- **Reusing Qlik's own internal CA (the one behind `QLIK_CERT`/`root.pem`), instead of
  the self-signed pair above, is worth doing if that CA is already trusted on the
  machines that will open the extension** — check first: `Get-ChildItem
  Cert:\LocalMachine\Root | Where-Object Subject -like '*<your CA CN>*'` on a client
  machine, or ask whoever manages the Qlik deployment whether it's pushed via GPO/SCCM.
  If it is, a leaf cert chained to it is trusted automatically, no manual `certutil`
  import anywhere.
  - **Never reuse `client.pem` (the QlikClient cert) itself as the proxy's TLS
    certificate.** It's a *client*-authentication credential the proxy presents *to*
    QPS, with `CN=QlikClient` — it doesn't carry the proxy's own hostname, so browsers
    will reject it on a Subject/SAN mismatch even if the chain is trusted, and reusing
    one credential for two different trust purposes is bad practice regardless.
  - Instead, request a **new leaf certificate from that same CA**, with `Server
    Authentication` EKU and the proxy's actual hostname(s) as SANs. On QSEoW, Qlik
    itself is usually the one holding that CA's signing key (as part of its own internal
    PKI) — check with your Qlik admin how new server certs get issued from it (e.g. via
    QMC's certificate export, or however your org already mints QSEoW node-to-node
    certs); this isn't something to do by hand with a discovered private key.
  - **This doesn't require the proxy to run on an actual Qlik Sense node.** Any machine
    can hold a leaf cert issued by that CA. What matters is (a) the cert's SAN matches
    whatever hostname clients will actually use to reach the proxy, wherever it runs, and
    (b) that CA is trusted on those clients' machines — which, unlike the self-signed
    path, only needs solving once per CA rather than once per proxy hostname.
- **Rotation:** re-issue before expiry, drop the new pair in place, and restart the
  Windows service (P06) — clients reconnect automatically. Overlap validity windows so a
  renewal never leaves a gap. Rotation is a config/file change, not a code change.

## Usage

```bash
npm start
```

The server starts at `https://localhost:3000`. Available endpoints:

- `GET  /health` — liveness (process is up); the service manager uses this to restart
- `GET  /ready` — readiness (boot validation passed, accepting requests); flips to `503` during graceful drain
- `GET  /metrics` — concurrency gauges (in-flight, queue depth) + counters (requests, 4xx/5xx, retries)
- `POST /api/anthropic` — Forwards the request to `api.anthropic.com/v1/messages`
- `POST /api/ollama` — Forwards an OpenAI-compatible chat body to the local Ollama server (`OLLAMA_URL`)

The Anthropic API key is held **server-side** (`ANTHROPIC_API_KEY`, never sent by the browser) and
injected per request; any client-supplied key header is stripped. Callers are authenticated by their
Qlik session, which the proxy validates against QPS. In the **same-site deployment** the browser
sends the Qlik session **cookie** automatically (the extension calls with `credentials: 'include'`);
the proxy reads it from the `X-Qlik-Session` cookie — for a **named virtual proxy** set
`QLIK_SESSION_COOKIE=X-Qlik-Session-<prefix>`. The `x-qlik-session` **header** remains an explicit
override for deployments that mint a session ticket the extension can read.

> ⚠️ **QPS gotchas (verified against a live QSEoW node).** QPS rejects any API call without an XSRF
> key — v2.0.0 sends a 16-char `xrfkey` in both the query string and the `X-Qlik-Xrfkey` header.
> Before that fix QPS answered `403 "XSRF prevention check failed"`, which the proxy mapped to an
> auth error and so rejected **every** session, valid or not. Equally, `QLIK_SESSION_URL`'s host must
> match a SAN of the QPS certificate: QSEoW issues for the **short hostname**, so using the FQDN
> fails validation for everyone.

The `/api/ollama` route needs **no** API key; it requires a running local [Ollama](https://ollama.com)
server (e.g. `ollama pull ministral-3:8b`). Local inference is slower than the hosted API, so this
route uses a 5-minute timeout.

### Streaming & cancellation

Both POST routes stream when the request body sets `"stream": true`. The upstream response is piped
through **untouched** as `text/event-stream`, so the client renders tokens as they arrive instead of
waiting for the whole answer — which matters most on the slow local path. (Streaming landed in
v1.2.0; before that every response was buffered, so a client asking to stream still received the
answer in one lump.)

**Client-cancel propagation (v2.0.0).** If the client disconnects (closed tab, cancelled chat, or the
extension's **Stop** button, added in extension v0.5.1), the
upstream request is cancelled rather than left generating for nobody — the model actually stops. This
holds for **both** paths: streaming destroys the piped upstream stream on disconnect, and the buffered
path aborts the in-flight upstream call (via an `AbortSignal` wired to the response's `close`). This
matters most on the slow local path, where an unwanted answer could otherwise run for minutes.

> Headers sent on streamed responses: `Cache-Control: no-cache, no-transform` and
> `X-Accel-Buffering: no`, so anything sitting in front of the proxy doesn't re-buffer the stream.

## Operations (Windows service)

For production the proxy runs as an auto-start / auto-restart Windows service on the Qlik node
rather than a hand-started `node server.js` (a reboot would otherwise leave it down). The service
wrapper uses [`node-windows`](https://github.com/coreybutler/node-windows), installed separately so
the runtime stays lean:

```powershell
npm install --no-save node-windows
node service/install-service.js     # run as Administrator; registers + starts "cm-llm-proxy"
node service/uninstall-service.js   # remove the service (standalone `node server.js` still works)
```

Set `$env:SERVICE_NAME` before either command to register/remove it under a
site-specific name instead of the default `cm-llm-proxy` — both scripts read the same
variable, so use the same value for install and uninstall.

Run the service under a **least-privilege account** that can read the TLS and Qlik certificates.
`Stop-Service <name>` triggers the graceful drain (in-flight requests finish within
`DRAIN_TIMEOUT_MS`); `Start-Service` comes back ready once boot validation passes.

> **`npm install --no-save node-windows` is not durable.** It's deliberately kept out of
> `package-lock.json` so it never lands on a production node's runtime dependency tree —
> but that also means a later `npm ci` (a redeploy, re-running `setup.ps1`, anything that
> reinstalls from the lockfile) **deletes it**, and the running service then fails with
> Windows **Error 1067** on its next restart. If that happens: `npm install --no-save
> node-windows` again, then `Restart-Service <name>` — the service registration itself is
> untouched, only the wrapper's dependency needs restoring.

**Logs.** With `LOG_DIR` set, the app log (`app.log`) and a separate audit log (`audit.log`) are
written there as JSON lines with size-based rotation (`LOG_MAX_BYTES` × `LOG_MAX_FILES`); otherwise
both go to stdout for a log shipper. Neither log ever contains secrets or request/response bodies —
the app log carries request-id, user, route, status and latency; the audit log carries who-called-
what-when (user, route, model, status). Boot fails fast with a precise message if any required
variable is missing or a cert path is unreadable.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Proxy exits at startup with a config message | A required variable is missing or a cert path is unreadable — boot validation fails fast by design (`ANTHROPIC_API_KEY`, `QLIK_SESSION_URL`, `QLIK_CERT`, `QLIK_KEY`, `QLIK_ORIGINS`) |
| **Every** request returns `401` | Session validation is failing for all callers: check `QLIK_SESSION_URL`'s host against the QPS certificate SANs (short hostname on QSEoW), the client cert/key, and that you're on v2.0.0+ (earlier builds omitted the QPS `xrfkey`) |
| A single user gets `401` | Their Qlik session cookie isn't reaching the proxy — confirm same-site access and, for a named virtual proxy, `QLIK_SESSION_COOKIE=X-Qlik-Session-<prefix>` |
| `403 Model not allowed` | The requested model isn't on the server-side allowlist (`ALLOWED_*_MODELS`) |
| `413` / validation rejection | Body exceeds the size cap or fails the route's schema |
| `503` with `Retry-After` | The concurrency queue is full or the request timed out waiting; also returned by `/ready` during graceful drain |
| Browser shows a status-less XHR failure | The proxy's TLS certificate isn't trusted — see Certificates |
| Browser refuses to load with an **HSTS** error and no click-through option | The proxy shares a hostname with something that already sent `Strict-Transport-Security` (typically the Qlik hub itself, on 443) — trust the cert (see Certificates); there's no bypass |
| **Firefox only**: `MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY` | The cert's `basicConstraints` is `CA:TRUE` — regenerate it with the `basicConstraints=critical,CA:FALSE` extension (see Certificates); Chrome/Windows tolerate a CA-flagged leaf cert, Firefox's strict validator does not |
| **Firefox only**: cert trusted in Windows but Firefox still rejects it | Firefox has its own certificate store, separate from Windows — import the cert into Firefox directly, or enable `security.enterprise_roots.enabled` in `about:config` (see Certificates) |
| CORS rejection | `QLIK_ORIGINS` is compared **exactly**; `https://localhost` will not match a hub served from `https://myserver` |
| Model keeps generating after the client stops | You're on a pre-2.0.0 proxy — cancel propagation was added in v2.0.0 |
| Windows service won't (re)start, **Error 1067** | `npm ci` deleted `node-windows` (it's deliberately out of `package-lock.json`) — `npm install --no-save node-windows`, then `Restart-Service <name>`; see Operations |

## Related repositories

- [AnthropicExtension](https://github.com/mabaeyens/AnthropicExtension): Qlik Sense extension that consumes this proxy
- [RAG](https://github.com/mabaeyens/RAG): RAG pipeline with ChromaDB and local embeddings

## 🛠️ Development Workflow: Human-AI Collaboration

This project is the result of a strategic collaboration between human design and AI-assisted code generation.

- **Architecture & Logic:** Fully defined by the author. This includes system structure, business rules, data flow, and implementation strategy.
- **Code Generation:** The syntactic implementation and line-by-line code writing was performed by **Claude Code**, following precise and iterative instructions provided by the author.
- **Supervision & Refinement:** All code was manually reviewed, tested, and adjusted to ensure quality, consistency, and compliance with project standards.

This approach demonstrates the ability to direct advanced AI tools to accelerate development without sacrificing creative control or technical quality.

## 📄 License

This project is licensed under the **MIT License**. You can find the full text in the [`LICENSE`](./LICENSE) file.

> **Note on authorship:** Although much of the source code was generated by an AI, the creative direction, architecture, and final integration are human work. Usage rights are granted under the terms of the MIT License.

## 🚀 Contributing

Feel free to fork this project!
- If you find a bug, open an issue.
- If you have an improvement, submit a Pull Request.
- Feel free to use this code in your own projects!
