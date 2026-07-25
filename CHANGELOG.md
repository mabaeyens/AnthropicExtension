# Changelog

All notable changes to this extension are documented here.

> ℹ️ **As of 0.5.0 the extension is proxy-only.** The browser no longer holds an API key and never
> calls `api.anthropic.com` directly — every request goes through the hardened proxy (under
> [`proxy/`](./proxy)), which holds the Anthropic key server-side and authenticates the caller by
> their Qlik session. The extension therefore **requires the proxy to be deployed** (with TLS +
> Qlik-session validation configured). Chart data is still sent to the configured LLM endpoint —
> review what leaves your environment before use. Selecting a **local model** (Ministral via
> Ollama) keeps inference on-machine.

## [0.5.0] - 2026-07-25

Production-hardening release. Turns the demo-grade extension + `cm-llm-proxy` into a hardened,
monorepo pair (proxy specs P01–P07, extension specs E01–E07). Fully unit-tested (26 extension +
86 proxy `node:test` cases) with CI on both artefacts.

### ⚠️ Breaking

- **Proxy is now mandatory; direct-from-browser mode is removed.** The extension no longer stores
  or sends an Anthropic API key. Set a **Proxy URL** (and, for local models, a **Local model URL**)
  pointing at your deployed proxy. Existing instances that relied on the browser key / direct mode
  must switch to the proxy, which must be deployed with TLS and Qlik-session validation.
- The **API key** property has been removed from the extension settings; the key lives only on the
  proxy.

### Security

- **Credential custody (P01):** the proxy holds the Anthropic key server-side (from env), strips any
  client-supplied key header, and injects the key itself. `js/security.js` and the bundled CryptoJS
  are deleted from the extension.
- **Caller authentication (P02):** the proxy validates the forwarded Qlik session (mutual-TLS to the
  Qlik Proxy/Repository API) before any upstream call; the extension forwards the session credential.
- **Input validation & model allowlist (P04):** per-route body-schema validation, request-size caps,
  and a server-side model allowlist — invalid/oversize/disallowed requests are rejected before the
  upstream call.
- **Transport hardening (P05):** strict CORS origin allowlist, security response headers, a modern
  TLS floor, and per-IP rate limiting.
- **Output sanitization (E04):** audited every DOM sink; model output goes through DOMPurify
  (fail-closed) and all dynamic strings through escaping; streaming uses `textContent`.

### Added

- **Concurrency & resilience (P03):** admission control with global + per-user in-flight ceilings, a
  bounded FIFO queue (`503` + `Retry-After` on overflow/timeout), streaming backpressure, upstream
  keep-alive pooling, and graceful drain on shutdown.
- **Observability & service (P06):** structured JSON request logs, a separate audit log
  (who-asked-what-when, no bodies/secrets), `/health` · `/ready` · `/metrics`, boot-time config
  validation, and a Windows-service wrapper (auto-start/restart, log rotation).
- **Client request lifecycle (E02):** at most one in-flight request per widget — Submit/Suggest are
  disabled while busy, a unified abort handle covers both buffered and streamed paths, the app-context
  cache is race-safe, and a proxy `503` surfaces as a friendly "busy, try again" message.
- **Extension teardown (E03):** a real teardown on Qlik `destroy` releases global listeners, preview
  vizzes, engine session objects, and any in-flight request — no leaks across sheet navigation.
- **Dev tooling & tests (E06/P07):** dev-only `package.json` + ESLint + `node:test` suites (an AMD
  test harness for the pure modules; integration + load/drain harness for the proxy) and GitHub
  Actions CI, path-filtered per artefact. The shipped runtime stays plain AMD (no build step).
- **Config & release hardening (E05/E07):** all data-collection bounds centralised in `config.DATA`
  and validated at init; config validation surfaces problems in the panel; `package.ps1` fails on a
  `config.js`/`.qext` version mismatch; a `RELEASING.md` checklist and `scripts/pre-release-check.ps1`
  guard the immutable-release rules (new tag only, matching versions, CHANGELOG entry).

### Changed

- **Monorepo (M01):** the proxy now lives in-tree under `proxy/` (history preserved), versioned
  independently from the extension.
- Data-collection caps (`MAX_FETCH_CELLS`, `MAX_CELLS_PER_PAGE`, `FETCH_PAGE_CONCURRENCY`,
  `MAX_FIELDS`, payload thresholds) are consolidated in `config.DATA` and reconciled with the proxy
  body-size limit, so an oversize payload is caught client-side with a friendly message.

### Removed

- `js/security.js` and `js/lib/crypto-js.min.js` (no browser-side key), the direct-browser transport
  and its `x-api-key` / `anthropic-dangerous-direct-browser-access` headers, and the API-key setting.

## [0.4.0] - 2026-07-24

### Added
- **In-panel model picker.** A **Pick model** button sits to the right of *Submit* and
  *Suggest a chart*. It opens a drop-up listing every model in the registry, with the active one
  ticked. Choosing a different model asks *"This will clear your current conversation! Change
  model?"* with a **Change model** / **Cancel** pair — conversation history can't meaningfully
  cross models, so the thread is reset on switch. (With an empty thread the prompt is just
  *"Switch to …?"*.)
- **Active model is always visible.** A *"Talking to \<model\>"* line sits under the submit row,
  and every answer's footer shows *"You are talking to \<model\>"* next to **LLM Token Usage**.
  The footer credits the model that was active **when the request was sent**, not when it
  returned, so switching mid-flight can't mislabel an answer.
- **Streamed answers.** Responses render token-by-token as they are generated, with a blinking
  caret, instead of appearing all at once after a wait. Toggle it under **Advanced Options →
  "Stream the answer as it is generated"**; it falls back to a buffered request automatically when
  the browser lacks `fetch`/`ReadableStream`/`AbortController`, or when the backend answers with
  plain JSON because it ignored `stream`.
  - Streaming chunks are inserted as **plain text** (`textContent`), and the markdown is rendered
    and sanitized **once, at the end**. Re-parsing markdown per token is what makes streamed chat
    UIs flicker and crawl, and half-written markdown renders as visible noise. It also means no
    HTML is ever built from partial model output.
  - An in-flight stream is aborted (`AbortController`) when you start a new chat or switch model,
    so a dead stream can't keep writing into discarded DOM — and the proxy destroys the upstream
    request when the browser disconnects, so Ollama stops generating for nobody.
  - **Requires a proxy update**: `cm-llm-proxy` buffered every response, which defeats streaming.
    Both `/api/ollama` and `/api/anthropic` now pipe the upstream body through untouched when
    `stream: true` is requested. Verified end-to-end: 178 SSE frames, first at 577 ms of a 9.9 s
    total.
- **Ministral 3 3B** as a second local model — roughly half the memory of the 8B at comparable
  speed. Uses the derived tag `ministral-3b-demo` (`FROM ministral-3:3b` + `PARAMETER num_ctx
  8192`); Ollama's 64k default context inflates the KV cache to ~10 GB and pushes the model almost
  entirely onto the CPU.

### Changed
- `API.MODELS` is now a **registry** of `{ id, label, hint, local, tag }` objects rather than bare
  id strings. It drives both the properties-panel dropdown and the in-panel picker, so the two can
  no longer drift apart, and each local model carries its own Ollama tag.
- The properties-panel **Model** dropdown is now the *default* model only. Once the picker is used,
  `API.MODEL_LOCKED` stops `paint()` from re-applying the property — `paint()` runs on every
  selection event and would otherwise silently revert the model mid-conversation.
- `isLocalModel()` resolves via the registry's `local` flag instead of comparing against a single
  hard-coded id, and the Ollama model name comes from the selected entry's `tag`.
- **"Suggest a chart" now tolerates off-schema JSON from smaller models.** Ministral 3 3B returns
  blocks with `//` comments, backtick-quoted fields, bare `Sum([Field])` values, extra keys, and
  measures as `{ name, expression, … }` objects — none of which is valid JSON, so a strict
  `JSON.parse` discarded an otherwise usable suggestion with "Could not parse a chart
  specification from the response." Parsing is now three escalating passes: strict parse → repair
  (strip comments/trailing commas/backticks) → regex salvage of type/title/dimensions/measures.
  Dimension and measure entries are coerced to strings, preferring an `expression` field over a
  `name`. The prompt also now states the output rules explicitly (plain strings, four keys only,
  no comments).
- **Properties panel labels no longer truncate.** The sidebar is narrow and clips labels with an
  ellipsis rather than wrapping them, so every label is now short ("API key", "Default model",
  "Proxy URL", "Local model URL") and the explanation moved to a wrapping help line under each
  field.
- The **"No API key stored"** notice is hidden while a local model is selected — those need no key,
  so the warning was pure noise. Switching back to a Claude model in the picker brings it straight
  back if no key is stored.

## [0.3.5] - 2026-07-24

### Fixed
- **"Suggest a chart" failed to render** with `Could not render chart:
  Devhub.Cols.QdefOrQlibraryid, Devhub.Cols.QdefOrQlibraryid`. Columns were passed to
  `visualization.create()` as bare strings, which Qlik's client-side column mapper rejects when it
  cannot match the token to a field or master-item id — one error per rejected column. Each column
  is now wrapped in an explicit definition object (`{ qDef: { qFieldDefs: […] } }` for dimensions,
  `{ qDef: { qDef: '=…' } }` for measures), which always satisfies the validator. Master-item
  resolution to the underlying field/expression is unchanged.
- A chart render failure now logs the spec **and** the resolved columns to the browser console, so
  a bad token can be identified without guesswork.
- `package.ps1` stamped the `.qext` description twice (`v0.3.4 build 25 — v0.3.4 build 25 — …`).
  The strip-pattern's literal em dash was mis-decoded under Windows PowerShell 5.1, so the existing
  prefix never matched; both sides of the replace now build the dash from its code point.

## [0.3.4] - 2026-07-17

### Added
- **Local model backend (Ministral 3 8B via Ollama).** The **Model** dropdown now offers
  *"Ministral 3 8B (local, via Ollama)"* alongside the Claude models. Selecting it routes the
  request to a local model instead of Anthropic — **no API key required**. The extension speaks
  the OpenAI chat-completions format for this path and parses `choices[0].message.content`.
- **"Local model URL"** property (Settings) to point at the Ollama endpoint. On QSEoW (HTTPS) this
  must be an HTTPS endpoint — the browser cannot call `http://localhost:11434` directly
  (mixed content), so requests go through the `cm-llm-proxy` `/api/ollama` route
  (default `https://localhost:3000/api/ollama`).
- Per-backend request timeout: local calls use a 5-minute client timeout (`API.LOCAL.TIMEOUT`)
  since local inference is much slower than the hosted API.

### Notes / setup
- Requires a local [Ollama](https://ollama.com) server and the model. Recommended setup on a
  small (4 GB) GPU — bake an 8k context for responsiveness:
  ```
  ollama pull ministral-3:8b
  printf 'FROM ministral-3:8b\nPARAMETER num_ctx 8192\n' > Modelfile
  ollama create ministral-3-demo -f Modelfile
  ```
  `API.LOCAL.MODEL_TAG` defaults to `ministral-3-demo`; `CONTEXT_WINDOWS['ministral-local']`
  is `8192` to match. Plain `ministral-3:8b` also works at Ollama's default context.
- The companion `cm-llm-proxy` gains a `POST /api/ollama` pass-through route and an `OLLAMA_URL`
  setting (released separately).
- Model license: Ministral 3 (Ollama library) is **Apache 2.0**.
- Demo-grade: on an NVIDIA T1200 (4 GB) the 8.9B Q4 model runs partly on CPU at ~6–7 tok/s.

## [0.3.3] - 2026-06-14

### Fixed
- **Suggested charts now render with data.** Master items were passed to
  `visualization.create` as `{ qLibraryId }` column objects, which this engine rejected with
  a `QdefOrQlibraryid` error. Each spec token is now resolved to its **underlying field /
  expression as a plain string** (master dimension → its field; master measure `[€ Sales]` →
  its expression `=Sum(Sales)`; otherwise a field name or `=expression`). Charts draw real
  data instead of erroring or coming up empty.

### Changed
- Moved **"Include app context"** into **Advanced Options → Data Settings** and relabelled it
  "Include app context (data model) on first message" to clarify its once-per-chat behaviour.

## [0.3.2] - 2026-06-14

Chart-creation fixes and a model context-window guard.

### Fixed
- **Suggested charts were empty.** Chart specs referenced master-item display names
  (e.g. `Category`, `[€ Sales]`), which the engine can't resolve as fields. Each spec token
  is now resolved to a real **master dimension/measure by library id** when one exists
  (preferred, even if a field shares the name); otherwise it falls back to a **field name**
  for dimensions or an **aggregation expression** (e.g. `=Sum(Sales)`) for measures. Master
  measures are referenced by their bracketed label (`[€ Sales]`), never wrapped in another
  aggregation. Applies to both the live preview and "Add to sheet".

### Added
- **Context-window guard.** Before sending, the request size is estimated against the
  selected model's context window (Haiku 4.5 = 200k tokens). If it won't fit, you're warned
  and can **truncate the data to fit and send**, or **cancel to refine selections**. The
  existing ~65 KB egress heads-up still applies below the limit.

### Changed
- App context now collects master-item **ids** so specs can resolve to real master items;
  the chart prompt steers the model to prefer master items.

## [0.3.1] - 2026-06-14

Security & robustness hardening from a deep audit of the 0.3.0 code. No new features.

### Security
- **Output sanitization (XSS fix):** the LLM response is rendered to HTML via the bundled
  `marked` parser, which does **not** sanitize. A malicious or tampered reply containing raw
  HTML (`<img onerror=…>`, `<script>`, …) could execute in the Qlik session. Now the parsed
  HTML is run through **DOMPurify** (newly bundled) before injection, and the renderer **fails
  closed** (escapes) if DOMPurify is unavailable. Error/loading/warning messages now escape all
  interpolated values.

### Fixed
- **Browser hang on large tables:** full-hypercube retrieval previously fired *all* pages at
  once with no pre-fetch bound, which could spawn hundreds–thousands of concurrent engine
  requests and freeze the tab. Fetching is now **hard-capped** (`DATA.MAX_FETCH_CELLS`) and
  **batched** (limited concurrency); oversized tables are **truncated with a notice** ("only the
  first N of M rows will be analyzed").
- **Memory leaks:** current-selections now uses a one-shot session object instead of a
  never-released `getList` subscription; chart **preview visualizations are closed** when the
  conversation is cleared; the conversation **history sent per request is bounded**
  (`CHAT.HISTORY_MAX`); panel drag listeners are attached only while dragging.

### Documentation
- Fixed a Mermaid render error in `diagrams.md` (sequence diagram). Repo no longer tracks
  `CLAUDE.md` / `.claude/` (kept locally).

## [0.3.0] - 2026-06-14

Conversation, charting, and data-fidelity release. The assistant becomes a persistent,
movable chat that renders Markdown, can **suggest and create Qlik charts**, and now sends
the **real data model** and **complete table data** to Claude.

### Added
- **Conversation thread with memory:** the panel is a chat thread that persists across
  sheet navigation and chart re-selection; follow-up questions retain context. Includes a
  **New chat** reset. The most recent exchange shows at the **top**, history below.
- **Markdown rendering** of responses (bundled `marked.js`) — headings, lists, tables, code.
- **Copy button** on every response (copies the raw Markdown).
- **Suggest a chart:** Claude proposes a chart spec (type + dimensions + measure
  expressions) and the extension renders a **live preview** in the panel via the in-session
  Qlik visualization API — as the logged-in user, no proxy/MCP. The suggestion builds on the
  previous response plus your prompt.
- **Add to sheet (Edit mode):** place a suggested chart on the current sheet below existing
  objects; if the sheet is **full**, existing charts are left untouched and you're offered a
  **new sheet** instead.
- **Movable panel:** drag the floating panel by its header so it no longer covers charts
  during selection. Panel is **twice as wide**.
- **Large-data warning:** if the selected chart data exceeds ~65 KB, you're warned about the
  token cost before it is sent.

### Changed
- **Full hypercube retrieval:** large tables now page through the **entire** result set
  instead of sending only the engine's initial page.
- **Richer app context:** the data model is collected via `getTablesAndKeys` plus a
  field/dimension/measure session object — real table names, the full field list, and
  **master dimensions/measures (with expressions)** — and serialized in full to the LLM.
- **Robust chart selection:** native charts (bar/line/combo/box/etc.) and older short
  engine-ids resolve via engine-validated candidate matching.
- `version` set to `0.3.0`.

### Fixed
- App context previously sent only a placeholder "Data Model" table with few/no fields
  (fragile `FieldList()` scrape + discarded master items) — Claude now receives the real
  tables, fields, and master items.
- Chart-suggestion parsing rejected valid specs (e.g. `histogram`) — parsing is now
  structural and rendering decides supported types (maps excluded); histogram handled.
- Collapsed panel no longer traps clicks on the native Qlik UI / Edit-sheet button.

### Documentation
- Refreshed `README.md`, `INSTALL.md`, and `diagrams.md` for the v0.3.0 flows, emphasising that
  **Qlik data leaves the on-prem environment** to an external LLM, and adding a **demo-only /
  no-liability** notice (neither Qlik nor the author accept liability).
- Scoped to **client-managed Qlik Sense on Windows (QSEoW)**; removed the QMC Content Security Policy
  step (not applicable to QSEoW) and dropped Qlik Cloud support (Cloud already has native AI
  assistants).
- Author credited as **mabaeyens** (`.qext`, panel footer, README).

### Notes / known limitations
- **Map visualizations** are not yet supported for selection or chart creation.
- **Add to sheet** writes to the live app and therefore requires the sheet to be in **Edit
  mode**.
- Experimental/demo only — see the warning above and `INSTALL.md`.

## [0.2.0] - 2026-06-12

First public demo build. The previous internal build required a separate local Node.js proxy and
pinned a now-retired model, so it no longer worked out of the box. This release makes the extension
runnable with **only an API key**.

### Added
- **Direct browser mode (default):** calls `https://api.anthropic.com/v1/messages` directly using
  the `anthropic-version` and `anthropic-dangerous-direct-browser-access` headers — **no proxy
  required**.
- **Data-model context on first use:** the app's field names and master items are collected once per
  session and sent with the request so Claude can interpret the selected chart in context.
- **Properties-panel controls:** API Key, **Model** dropdown (Haiku 4.5 / Sonnet 4.6 / Opus 4.8),
  and an optional **Proxy URL**.
- **Real API-key encryption:** the key is encrypted with CryptoJS AES before being written to
  `localStorage` and is shared across all Qlik apps (enter once).
- Inlined panel template (`js/template.js`) — no more fragile hard-coded template fetch.

### Changed
- **Default model is now `claude-haiku-4-5`** (the old `claude-3-haiku-20240307` was retired and
  caused requests to fail).
- The local proxy is now **optional** — set a Proxy URL in the properties to use it.
- `paint()` now initializes the UI **once per instance** instead of on every Qlik render cycle,
  preventing panel-state loss and duplicate event handlers.
- `DEBUG_MODE` and the in-panel debug area now default to **off**.
- Bundled **CryptoJS updated to 4.2.0**.
- README rewritten; `version` set to `0.2.0`.

### Fixed
- API key was previously stored in **plaintext** despite docs claiming encryption — now actually
  encrypted.
- Requests omitted the `anthropic-version` header (worked only via the proxy) — now sent in direct
  mode.

### Documentation
- Added `diagrams.md` with Mermaid data-flow, sequence, transport-decision, and key-storage diagrams
  (User → Qlik Sense → Anthropic → back).
- Added `INSTALL.md` (Desktop + Enterprise deployment, CSP step, end-user config, optional proxy,
  troubleshooting) and this `CHANGELOG.md`.
- Rewrote `README.md` and `CLAUDE.md` for the direct/proxy flows, first-use app context, encrypted
  shared-key storage, and the inlined panel template.

### Notes / known limitations
- **Enterprise (direct mode):** an administrator must add `api.anthropic.com` to the QMC Content
  Security Policy (`connect-src`) once. See `INSTALL.md`.
- Not tested on Qlik Cloud.
- The encryption passphrase is bundled in the extension, so key storage is obfuscation, not strong
  secrecy — appropriate for on-prem internal demos only.

[0.3.3]: https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.3.3
[0.3.2]: https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.3.2
[0.3.1]: https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.3.1
[0.3.0]: https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.3.0
[0.2.0]: https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.2.0
