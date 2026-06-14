# Changelog

All notable changes to this extension are documented here.

> ⚠️ **Experimental / demo only.** This extension is for demonstration purposes. It is not
> hardened for production use. The API key is obfuscated (not strongly encrypted) in the browser,
> and in direct mode the key is sent from the browser to `api.anthropic.com`.

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
