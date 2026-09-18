# Data Flow

What data moves where, and what leaves the machine, at each stage of a single question. Current as of **v0.5.5 (build 45)**. For the security rationale behind each boundary, see `docs/security-model.md` and specs `E01`/`P01`/`P02` under `specs/` (gitignored, local only).

---

## Overview

```
┌────────────────────────────────────────────────────────────┐
│  Qlik Sense (browser)                                       │
│                                                               │
│  Qlik hypercube ──► data-collector ──► ui-controller         │
│                          │                    │               │
│               optimizeDataForTokens()         │               │
│                          │                    │               │
│                     selectedCharts[]          │               │
│                          └──────────► anthropic-api           │
│                                          │  buildTransport()   │
│                                          │  prepareRequest()   │
│  No API key is held or read here ───────┘                     │
│  (credentials: include → Qlik session cookie auto-sent)       │
└──────────────────────────────────────────┼───────────────────┘
                                           │ HTTPS + Qlik session cookie
                                           ▼
                              ┌──────────────────────────┐
                              │  proxy (this monorepo)    │
                              │  proxy/server.js          │
                              │                            │
                              │  1. CORS allowlist check   │
                              │  2. IP rate limit          │
                              │  3. Qlik session auth (P02)│
                              │  4. Model allowlist (P04)  │
                              │  5. Inject real API key    │
                              │     (server-side only, P01)│
                              └────────────┬──────────────┘
                                           │ HTTPS
                                           ▼
                         ┌─────────────────────────────────┐
                         │ api.anthropic.com  (hosted models)│
                         │        — or —                     │
                         │ local Ollama (local models)       │
                         └─────────────────────────────────┘
```

Everything stays on the local machine except the request the proxy forwards upstream (Anthropic or the local Ollama server). No client-side component ever holds, reads, or sends an API key — there is nothing to encrypt or store in the browser, which is the point of the proxy-only architecture (spec E01).

---

## Stage 1 — Data extraction (Qlik → data-collector)

When the user clicks a chart, `data-collector.getObjectData(objectId)` fetches the chart's layout from the Qlik engine via the Client API (local WebSocket). This never leaves the machine.

**What is extracted:**

| Field | Source | Example |
|---|---|---|
| Chart title | `layout.title` | `"Sales by Region Q3"` |
| Chart type | `layout.visualization` | `"barchart"` |
| Dimension names | `qHyperCube.qDimensionInfo[].qFallbackTitle` | `"Region"` |
| Dimension field expressions | `qDimensionInfo[].qGroupFieldDefs` | `["[Region]"]` |
| Measure names | `qHyperCube.qMeasureInfo[].qFallbackTitle` | `"Sum of Sales"` |
| Measure formulas | `qMeasureInfo[].qDef` | `"Sum([Sales Amount])"` |
| Data rows | `qDataPages[].qMatrix` or `qStackedDataPages` | `[["North", "142,000"], ...]` |
| Current selections | `app.getList("CurrentSelections")` | `{field: "Year", values: "2024"}` |

For **tables**: data is paged through `fetchTableData()` via `model.getHyperCubeData()`, up to `DATA.MAX_CELLS_PER_PAGE` (10,000) cells per request, up to `DATA.FETCH_PAGE_CONCURRENCY` (4) pages concurrently, capped overall at `DATA.MAX_FETCH_CELLS` (50,000) — beyond that the table is truncated with a notice.

For **maps**: only title, layer names, and dimension/measure names are reliably available (`qLayerData`/`qGeoData`/`qAreaData` are read best-effort). No coordinate or choropleth data is extracted.

**App context** (field list + master items) is collected once per session via `getAppContextCached()`, capped at `DATA.MAX_FIELDS` (500 fields), rather than re-fetched on every question.

---

## Stage 2 — Optimisation (data-collector.optimizeDataForTokens)

Before a chart's data is held in `ui-controller`'s selection state, it passes through `optimizeDataForTokens()`.

**What this does:**

- Strips internal Qlik state fields.
- Applies a row limit (`config.DATA.MAX_ROWS`, default 1,000). Above the limit, a stratified sample is taken: 40% from the start, 40% from the middle, 20% from the end.
- Records `dataSampled: true` when rows were dropped.
- Adds a `metrics` object: `{originalSize, optimizedSize, reduction, tokenEstimate}`.

**Token estimation**: `Math.ceil(optimizedSize / 4)` — a rough approximation (4 chars ≈ 1 token); actual usage depends on the model's own tokeniser.

Selected chart data is held in memory only, for the life of the browser tab. It is not written to disk or to any browser storage.

---

## Stage 3 — Payload assembly (anthropic-api)

On submit, `anthropicAPI.prepareRequest(data, stream)` calls `buildMessageContent()` to assemble a single text string, then shapes the request for the resolved backend.

**Message text structure** (`buildMessageContent`, in order):

```
[If app context is available]
Context about the Qlik Sense environment:
<formatted field list / master items>

[If chart data is available — one block per selected chart]
=== Chart N: <title> ===
<formatted dimensions, measures, and tab-separated data rows
 (or, for maps, title/layer metadata only)>

User question: <the user's typed text>
```

**Request shape depends on the target backend** (`prepareRequest`):

- **Hosted (Anthropic) models** — Messages API shape, `system` as a top-level field:
  ```json
  {
    "model": "claude-haiku-4-5",
    "max_tokens": 4000,
    "system": "<system prompt>",
    "messages": [ ...history, { "role": "user", "content": "<assembled text>" } ]
  }
  ```
- **Local (Ollama) models** — OpenAI chat-completions shape, `system` as the first message, with `config.API.LOCAL.SYSTEM_SUFFIX` appended to force brevity (local generation is slow, so a verbose answer costs minutes):
  ```json
  {
    "model": "ministral-3-demo",
    "max_tokens": 4000,
    "stream": true,
    "messages": [
      { "role": "system", "content": "<system prompt>\n\n<brevity suffix>" },
      ...history,
      { "role": "user", "content": "<assembled text>" }
    ]
  }
  ```

Prior turns (`data.history`, capped at `config.CHAT.HISTORY_MAX` = 12 by `ui-controller.boundedHistory()`) are included both ways, so multi-turn conversations stay within a bounded token budget.

A warning is logged (the request still proceeds; `ui-controller.guardPayload()` is what actually blocks/confirms an oversized send — see Stage 4) if the JSON payload exceeds 1,000,000 bytes.

---

## Stage 4 — Client-side payload guard (ui-controller)

Before sending, `ui-controller.guardPayload()` checks the assembled payload against `config.DATA.WARN_PAYLOAD_BYTES` (65 KB) and `config.DATA.MAX_PAYLOAD_BYTES` (1 MB, matching the proxy's own body-size limit, spec P04). Above the warn threshold the user is asked to confirm; above the max threshold the request is blocked client-side with a friendlier message than the proxy's `413`, and `truncateToFit()` can trim the payload to the active model's context window (`config.API.CONTEXT_WINDOWS`).

---

## Stage 5 — HTTP request (browser → proxy)

`anthropicAPI.buildTransport()` resolves the target URL — there is exactly **one** transport (spec E01): an authenticated call to this repo's own proxy. No other destination is ever contacted from the browser.

```
POST <config.API.PROXY_URL or config.API.LOCAL.URL>
Content-Type: application/json
(Qlik session cookie sent automatically — credentials: 'include' / withCredentials: true)

<payload from Stage 3>
```

**What leaves the local machine (to the proxy, then upstream):**

| Data | Leaves machine? | Notes |
|---|---|---|
| User's typed prompt | **Yes** | Forwarded to Anthropic/Ollama |
| Chart title, type | **Yes** | Forwarded |
| Dimension/measure names | **Yes** | Forwarded |
| Measure formulas (`qDef`) | **Yes** | Exposes internal Qlik expressions — no per-request toggle currently |
| Data row values | **Yes** | Up to `DATA.MAX_ROWS` rows per chart, after Stage 2 sampling |
| App name and field names | **Yes** | Only when app context is included in the request |
| Prior conversation turns | **Yes** | Up to `CHAT.HISTORY_MAX` turns |
| **Anthropic API key** | **No — never** | Held only in the proxy's environment (P01); the browser never has it, reads it, or sends it |
| Qlik `.qvf` file contents | **No** | Only the selected chart's rendered/sampled data |
| Raw hypercube JSON | **No** | Formatted and sampled before assembly |

**Transport security:** TLS between the browser and the proxy, and TLS between the proxy and Anthropic/Ollama. What authenticates the *caller* is the Qlik session cookie (`P02`), not a shared secret the extension carries — see below.

---

## Stage 6 — Proxy (`proxy/`)

The proxy is a small Express app in this same monorepo (`proxy/server.js` + `proxy/lib/*`), independently versioned (`proxy-vX.Y.Z` tags). Per request, in order:

1. **CORS allowlist** (`proxy/lib/cors.js`, spec P05) — only origins in `QLIK_ORIGINS` get CORS headers; everything else's preflight is denied.
2. **IP rate limit** (`proxy/lib/rate-limit.js`, spec P05) — a coarse fixed-window per-IP cap, applied *before* authentication so an unauthenticated flood is shed cheaply.
3. **Qlik session authentication** (`proxy/lib/auth-qlik.js`, spec P02) — the proxy independently validates the session against Qlik (QPS), resolving `UserDirectory\UserId`; it never trusts a client-asserted identity. Valid sessions are cached with a short positive-only TTL (never caches a negative result, so a revoked session isn't accepted for the cache window).
4. **Model allowlist** (`proxy/lib/model-allowlist.js`, spec P04) — the requested model id must appear in `ALLOWED_ANTHROPIC_MODELS`/`ALLOWED_OLLAMA_MODELS`; this is authoritative and independent of the extension's own `js/config.js` registry.
5. **Credential injection** (`proxy/lib/credentials.js`, spec P01) — the real `ANTHROPIC_API_KEY`, loaded from the proxy's environment at boot, is injected into the outbound `x-api-key` header. Any client-supplied `x-api-key`/`authorization` header is discarded, never forwarded — outbound headers are built fresh.
6. Forwards to the resolved provider (`proxy/lib/providers.js`): `https://api.anthropic.com/v1/messages` for hosted models, or the configured Ollama URL for local models.
7. Streams or buffers the response back to the browser.

---

## Storage — what is persisted locally

| Item | Storage | Notes |
|---|---|---|
| Model default / pick, proxy URLs | `sessionStorage` (`anthropicExtension.model`) | Mirrors only user-set *facts* (never a derived/corrected value); versioned so an older build's stored shape is ignored; cleared with the tab. See `js/config.js` `saveModelState()`/`restoreModelState()`. |
| Log level | Object property (Qlik-managed) | Not browser storage — part of the extension's saved properties. |
| Selected charts / chart data (in-session) | Memory only (`ui-controller` state) | Cleared on page reload. Never written to disk or any browser storage. |
| Anthropic API key | **Nowhere in the browser** | Lives only in the proxy's process environment (`ANTHROPIC_API_KEY`), per spec P01. |

There is no client-side credential of any kind to encrypt. `js/lib/crypto-js.min.js` is still bundled in the repo but is not wired to anything — it predates the proxy-only architecture and has no remaining call site.

---

## Threat model summary

| Threat | Mitigated? | Notes |
|---|---|---|
| Browser holding/leaking the API key | **Not applicable** | The key never reaches the browser at all (P01) — there is nothing to leak from that side. |
| A caller without a valid Qlik session reaching the proxy | Yes | Proxy independently validates the session against Qlik; never trusts client-asserted identity (P02). |
| An unlisted/renamed model being requested | Yes | Proxy-side allowlist is authoritative regardless of what the client sends (P04). |
| Cross-origin abuse of the proxy | Yes | Exact-match CORS origin allowlist (P05). |
| Unauthenticated request flooding | Partially | Coarse per-IP rate limit ahead of auth; tuned high to tolerate shared-NAT offices, not a full DoS defense. |
| Business data (chart values, formulas, field names) sent to the model | By design | Core feature. `qDef` measure formulas are included by default with no current per-request opt-out. |
| Anthropic/Ollama training on submitted data | See provider terms | Hosted-API data is not used for training by default per Anthropic's API terms; a local Ollama model never leaves the machine at all. |
| Oversized requests wedging the browser or hitting the proxy's body-size limit | Yes | Client-side guard (`ui-controller.guardPayload`) warns/blocks/truncates before send, matched to the proxy's own limit (P04). |
