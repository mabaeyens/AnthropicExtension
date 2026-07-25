# cm-llm-proxy

> ℹ️ **This proxy now lives in the [AnthropicExtension](../README.md) monorepo**, under `proxy/`.
> It was previously the standalone `mabaeyens/cm-llm-proxy` repository (now archived); its history
> was preserved when it was merged here. File issues and PRs against the AnthropicExtension repo.

Local HTTPS proxy that forwards requests from the Qlik Sense [AnthropicExtension](../README.md) to the Anthropic API **or to a local Ollama model**.

## Why is this needed?

Qlik Sense Server enforces CORS restrictions and does not allow direct calls to external APIs from the browser. This proxy runs on the Qlik server (or locally) and acts as a secure intermediary.

```
Qlik Sense (browser) → https://localhost:3000/api/anthropic → api.anthropic.com
Qlik Sense (browser) → https://localhost:3000/api/ollama    → http://localhost:11434 (Ollama)
```

The `/api/ollama` route additionally bypasses **mixed-content** blocking: an HTTPS Qlik page cannot
call a plain-HTTP local Ollama server directly, so it goes through this HTTPS proxy instead.

## Requirements

- Node.js >= 18
- SSL certificates for `localhost:3000` (see Certificates section)

## Setup

### Automated (Windows / PowerShell) — recommended

`scripts/setup.ps1` does the mechanical steps for you (idempotent): checks Node, runs
`npm ci`, optionally generates + trusts a dev TLS cert, scaffolds `.env` from the template
with the values you pass, and optionally registers the Windows service. You still supply
the site secrets (API key, Qlik auth) — the script never invents them.

```powershell
# Local dev: deps + trusted self-signed cert + starter .env, then `npm start`.
pwsh scripts/setup.ps1 -DevCert -TrustCert -ApiKey 'sk-ant-...' `
  -QlikSessionUrl 'https://your-qlik:4243/qps/session' `
  -QlikCert './certs/client.pem' -QlikKey './certs/client_key.pem' `
  -Origins 'https://your-qlik' -LogLevel DEBUG

# Production node: deps + .env + register the auto-start Windows service
# (use a CA-signed cert: set TLS_CERT/TLS_KEY in .env — see "Production certificate").
pwsh scripts/setup.ps1 -ApiKey 'sk-ant-...' -QlikSessionUrl '...' `
  -QlikCert '...' -QlikKey '...' -Origins 'https://your-qlik' -LogLevel INFO -InstallService
```

Run `Get-Help scripts/setup.ps1 -Full` for every parameter.

### Manual

```bash
# 1. Copy and edit the environment file
cp .env.example .env
# Edit .env: set the required vars (ANTHROPIC_API_KEY, QLIK_SESSION_URL, QLIK_CERT,
# QLIK_KEY, QLIK_ORIGINS) and optionally LOG_LEVEL

# 2. Install dependencies
npm ci
```

## Configuration

All settings are configured via `.env` (copied from `.env.example`):

| Variable | Description | Default |
|---|---|---|
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
The server won't start until you generate your own:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/localhost3000-key.pem \
  -out certs/localhost3000-cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

> The `subjectAltName` is required — browsers reject certificates that only carry a CN.

The certificate must then be trusted, or the browser will silently block the extension's
request (an XHR failure with no status, not a warning you can click through). On Windows,
Chrome and Edge read the OS store:

```powershell
certutil -user -addstore Root certs\localhost3000-cert.pem
```

Restart the browser afterwards. To remove it later, use `certutil -user -delstore Root <thumbprint>`.

### Production certificate (issuance & rotation)

The self-signed pair above is for **local dev only**. In production the proxy runs on the
Qlik node and must present a **CA-signed certificate for the proxy's own hostname** (the
name the extension's Proxy URL points at), issued by your internal/enterprise CA so the
Qlik page trusts it without a manual store import:

- Issue the cert against the FQDN clients use; set `TLS_CERT` / `TLS_KEY` to its paths
  (keep them off the repo — `certs/*.pem` stays git-ignored). `TLS_MIN_VERSION` defaults
  to `TLSv1.2`; set `TLSv1.3` where the client fleet supports it.
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
forwarded Qlik session (`x-qlik-session`).
The `/api/ollama` route needs **no** API key; it requires a running local [Ollama](https://ollama.com)
server (e.g. `ollama pull ministral-3:8b`). Local inference is slower than the hosted API, so this
route uses a 5-minute timeout.

### Streaming (v1.2.0+)

Both POST routes stream when the request body sets `"stream": true`. The upstream response is piped
through **untouched** as `text/event-stream`, so the client renders tokens as they arrive instead of
waiting for the whole answer — which matters most on the slow local path. Earlier versions buffered
every response, so a client asking to stream still received the answer in one lump.

If the client disconnects (closed tab, cancelled chat), the upstream request is destroyed rather than
left generating for nobody. Non-streaming requests are unaffected.

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

Run the service under a **least-privilege account** that can read the TLS and Qlik certificates.
`Stop-Service cm-llm-proxy` triggers the graceful drain (in-flight requests finish within
`DRAIN_TIMEOUT_MS`); `Start-Service` comes back ready once boot validation passes.

**Logs.** With `LOG_DIR` set, the app log (`app.log`) and a separate audit log (`audit.log`) are
written there as JSON lines with size-based rotation (`LOG_MAX_BYTES` × `LOG_MAX_FILES`); otherwise
both go to stdout for a log shipper. Neither log ever contains secrets or request/response bodies —
the app log carries request-id, user, route, status and latency; the audit log carries who-called-
what-when (user, route, model, status). Boot fails fast with a precise message if any required
variable is missing or a cert path is unreadable.

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
