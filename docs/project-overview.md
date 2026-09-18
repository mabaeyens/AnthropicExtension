# Project Overview

Complete reference for the AnthropicExtension codebase. Intended for developers maintaining or extending the project. Current as of **v0.5.5 (build 45)** — verify against `js/config.js` (`VERSION`/`BUILD`) if this drifts.

---

## What it does

AnthropicExtension is a Qlik Sense visualization extension. It adds a floating panel to a Qlik Sense sheet that lets users:

1. Click one or more charts already on the sheet to select them.
2. Type a natural-language question.
3. Receive a Claude- (or local-model-) generated analysis of those charts' data, optionally rendered back as a native Qlik chart.

**The extension never holds an API key.** Every request goes through a hardened Node.js proxy (`proxy/`, part of this same monorepo). The proxy holds the Anthropic key server-side and authenticates each caller by their Qlik session — there is nothing client-side to persist or encrypt. This is a security requirement (spec `E01`), not just a CORS workaround: browsers can't call `api.anthropic.com` directly from a Qlik Sense page anyway, but even if they could, the key must never reach the browser.

---

## Repository layout

```
AnthropicExtension/
├── AnthropicExtension.js     Entry point (RequireJS shim → js/main.js)
├── AnthropicExtension.qext   Qlik extension manifest (name, version, type)
├── css/
│   └── style.css             All styling for the extension panel
├── html/
│   └── template.html         Kept for reference only — NOT loaded at runtime (see below)
├── js/
│   ├── main.js               Extension definition + paint() lifecycle hook
│   ├── config.js             Central config object (proxy routes, model registry, limits, flags)
│   ├── config-validate.js    Validates config on every owner paint(); non-fatal
│   ├── anthropic-api.js      Transport + payload builder + streaming client
│   ├── data-collector.js     Extracts data from Qlik visualizations
│   ├── data-format.js        Formatting utilities (city-value extraction, tables)
│   ├── chart-builder.js      Builds native Qlik charts from AI responses
│   ├── formatting.js         Markdown rendering via bundled marked (gfm + breaks on)
│   ├── template.js           Floating widget markup, injected into document.body
│   ├── ui-controller.js      UI rendering, event wiring, request orchestration
│   ├── log.js                Level-gated console logging
│   └── lib/
│       ├── crypto-js.min.js  Bundled CryptoJS v4 — still bundled but unused (see below)
│       ├── marked.min.js     Bundled Markdown parser
│       └── dompurify.min.js  Bundled HTML sanitiser for rendered Markdown
├── proxy/                    Companion Node.js proxy (own package.json, own release cadence)
└── specs/                    Hardening specs (E01–E07 extension, P01–P07 proxy, X01–X02, M01) — gitignored, local only
```

`js/prompt-store.js` does **not** exist — an earlier, never-wired prompt-template feature was removed. If you see it referenced in an older doc or a stale local file, it's dead code; delete it.

---

## Module system

All JS files use **RequireJS AMD** (`define([deps], function(deps) {})`). This is Qlik Sense's built-in module loader. Do not use ES modules (`import`/`export`) or CommonJS (`require`/`module.exports`) — they will not work inside Qlik Sense's extension loader.

`html/template.html` is kept only for reference. The actual panel markup is inlined as a string inside the `js/template.js` AMD module and injected by `ui-controller.js` directly into `document.body` — once, so the floating widget survives Qlik's per-sheet `destroy`/repaint cycle (Qlik Sense is a SPA). There is no runtime fetch of the `.html` file.

---

## No build step

There is no npm, no bundler, no transpiler for the extension itself (the companion `proxy/` app has its own `package.json` and dependencies — see `proxy/README.md`). Deploy the extension by copying the entire folder into:

- **Desktop**: `%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\`
- **Enterprise**: QMC → Extensions → Import

To pick up changes, copy updated files and reload Qlik Sense.

---

## Module responsibilities

### `AnthropicExtension.js`
Re-exports `js/main.js` via RequireJS. Qlik Sense loads this file as the extension entry point (named in `.qext`); it exists only to satisfy the naming convention.

### `js/main.js`
Defines the extension to Qlik Sense: the property-panel schema (Default model, Proxy URL, Local model URL, Log level) and the `paint($element, layout)` lifecycle hook, called by Qlik on every layout update.

**Config ownership.** All objects of this extension in one app share a single `config` module instance, while properties are per-object. `paint()` elects exactly one "owner" object — the first one painted, or any object with a non-blank URL property while the incumbent has none, or a configured object taking over from an owner that's gone stale (no paint in 30s). This stops a second, never-configured object from silently overwriting the configured model/endpoints when a user navigates to a sheet that holds one. Only the owner's property block is applied to `config` each paint.

On every owner paint, `main.js`:
- Applies `props.model` to `config.API.MODEL_DEFAULT` (only on an actual change, which also clears `MODEL_PICK` — editing the property is how an operator overrules a chat-panel pick).
- Applies `props.proxyUrl`/`props.localUrl` to `config.API.PROXY_URL`/`config.API.LOCAL.URL`. These are authoritative even when blank — a blank URL means that backend is switched off, and its models are withheld from both pickers rather than offered and left to fail at request time.
- Calls `config.saveModelState()` (mirrors the user-set facts into `sessionStorage` so they survive a page reload) and re-renders the model picker and connection status.
- Runs `configValidate.validate(config)` and surfaces any errors in-panel (non-fatal — never throws inside `paint()`).

One-time UI/selection init (`uiController.initUI()`, `dataCollector.init()`/`setupSelectionTracking()`) happens once per module instance, guarded by `uiController.isInitialized()`, not by a DOM check — the widget element outlives sheet navigation, so a fresh module instance must rebuild it to actually be able to drive it.

There is deliberately **no Qlik `destroy` hook** wired to teardown: Qlik fires `destroy` on every sheet change, and tearing the floating widget down there made the panel disappear after the first sheet. The single-instance paint guard already prevents duplicate widgets/listeners.

### `js/config.js`
Single source of truth for runtime constants. Key groups: `API` (proxy URLs, model registry, timeouts, context windows), `DATA` (row/cell/payload limits), `CHAT` (history depth, streaming), `FEATURES` (flags), plus `validateData()` (clamps `DATA.*` to safe defaults — spec E05) and `saveModelState()`/`restoreModelState()` (mirrors only user-set facts — model default, pick, both URLs — into `sessionStorage`, versioned so an older build's stored shape is never misread). See the config table in the repo's `CLAUDE.md` for the current default values.

The model registry (`API.MODELS`) drives both the properties-panel dropdown and the in-panel picker. Entries with `local: true` route through Ollama via the proxy in OpenAI chat-completions format and need no API key; their `tag` is the Ollama model name.

### `js/config-validate.js`
Runs on every owner `paint()` (not just once — an error banner must be able to clear once the owner's URLs are actually applied). Checks: at least one of `PROXY_URL`/`LOCAL.URL` is set (or both, but not neither) and any set URL is well-formed; `MAX_TOKENS`/`CHAT.HISTORY_MAX` are positive integers; every `MODELS` entry has an `id`/`label` (and a `tag` if `local`); `MODEL_DEFAULT` matches a registry id; `LOG_LEVEL` is one of the known levels. Also triggers `config.validateData()`. Returns `{ ok, errors }` — never throws; `main.js` surfaces `errors` in-panel.

### `js/anthropic-api.js`
Owns model resolution, transport, and payload assembly.

- **`resolveActiveModel()`** — pure. The in-panel pick if its backend is reachable, else the object's "Default model" property if reachable, else the first available model. Never assigns or persists — an earlier version wrote a corrected model back into the stored choice, which let a stale correction permanently override a user's pick.
- **`availableModels()`** — the registry filtered to models whose backend is configured (local needs `LOCAL.URL`, hosted needs `PROXY_URL`); returns the full registry if nothing is configured, so a fresh install still shows choices.
- **`buildTransport()`** — there is exactly one transport (spec E01): an authenticated call to the proxy. Resolves to `{ url, headers, withCredentials: true }`, pointing at `PROXY_URL` (hosted) or `LOCAL.URL` (local). The browser never calls `api.anthropic.com` directly and carries no API key; the Qlik session rides along via the cookie (`withCredentials`/`credentials: 'include'`).
- **`prepareRequest(data, stream)`** — assembles the turn's message text (`buildMessageContent()`), shapes the payload for the target backend (Anthropic Messages format with a top-level `system` field for hosted models; OpenAI chat-completions format with `system` as the first message for local models, plus `LOCAL.SYSTEM_SUFFIX` appended to force brevity), and returns the transport + payload together so the buffered and streaming paths can never diverge.
- **`sendToAnthropic()`** / **`streamToAnthropic()`** — buffered and SSE-streaming request paths, both returning an `{ abort }` handle so `ui-controller` can cancel an in-flight request (new chat, model switch, teardown).
- **`buildMessageContent()`** / **`formatChartDataForLLM()`** / **`formatContextForLLM()`** — build the actual text sent to the model; see `docs/data-flow.md` for the exact structure.

### `js/data-collector.js`
Extracts data from Qlik visualizations, running inside the Qlik Sense browser context via the Client API.

**Selection**: `setupSelectionTracking()`/`startSelectionTracking()` attach a document-level (capture-phase) click handler. Clicks on `.qv-object-<id>` elements are intercepted and the object ID is extracted from the CSS class (`extractObjectId()`, with `collectCandidateIds()` as a fallback for nested/container objects).

**Data extraction**: `getObjectData(objectId)` tries `app.visualization.get()` first, then falls back to `app.getObject()`; either way it calls `getLayout()` and passes the result to `processVisualizationLayout()`.

**Hypercube processing**: dimensions/measures come from `qDimensionInfo`/`qMeasureInfo`; row data comes from `qDataPages` (bar/line/pie/KPI) or `qStackedDataPages`, flattened to `[dimension, measureName, value]` rows for stacked bar/combo charts. Tables without inline data pages are paged through `fetchTableData()` via `model.getHyperCubeData()`, up to `DATA.MAX_CELLS_PER_PAGE` (10,000) cells per request, with up to `DATA.FETCH_PAGE_CONCURRENCY` (4) pages in flight at once, capped overall by `DATA.MAX_FETCH_CELLS` (50,000).

**Maps**: no standard hypercube; the collector reads what it can from `qLayerData`/`qGeoData`/`qAreaData`. When no tabular data is extractable it sends only the chart title, dimension/measure names, and layer metadata, instructing Claude to ask the user to name specific regions.

**App context**: `getAppContext()`/`getAppContextCached()` collect the field list and master items once per session, capped at `DATA.MAX_FIELDS` (500), so the model has schema context without re-fetching it on every question.

**`optimizeDataForTokens(chartData, options)`**: applies row sampling (stratified: 40% first, 40% middle, 20% last) above `DATA.MAX_ROWS` (default 1,000), strips internal Qlik state fields, and reports `{ originalSize, optimizedSize, reduction, tokenEstimate }`.

### `js/data-format.js`
Formatting utilities: `formatForLLM()`/`formatAsTable()` for tab-separated table rendering, `createSizeReport()` for before/after size metrics, and `extractCityValues()`/`formatCityValuesTable()` for the (currently disabled — `FEATURES.EXTRACT_CITY_VALUES: false`, broken for maps) city-value extraction path.

### `js/chart-builder.js`
Parses a chart specification out of Claude's response text (`parseChartSpec()`, tolerant of near-JSON via `relaxJson()`/`salvageSpec()`) and renders a live preview (`renderPreview()`) that can be added to the current sheet (`addToSheet()`) or a new one (`createSheetWithChart()`) as a native Qlik object. The chart-type list only steers the prompt — parsing accepts unlisted types; rendering decides what's actually possible given the resolved dimensions/measures (`resolveDimension()`/`resolveMeasure()` against the app's master items via `setMasterItems()`).

### `js/formatting.js`
Renders the model's Markdown response to sanitised HTML (`formatResponseText()`, using the bundled `marked` + `dompurify`), plus `formatErrorMessage()`/`formatLoadingMessage()`/`formatWarningMessage()` for the panel's status lines.

### `js/template.js`
The floating widget's HTML, as a JS string, injected once into `document.body` by `ui-controller.initUI()`.

### `js/log.js`
Level-gated console logging (`ERROR < WARN < INFO < DEBUG`). Threshold comes from `config.LOG_LEVEL`, itself overridable per-instance from the "Log level" property and re-read on every paint, so verbosity changes take effect live without a reload.

### `js/ui-controller.js`
Owns all DOM interaction and orchestrates a request end to end. Key responsibilities: rendering the model picker and connection/config status, chart-chip selection UI, payload-size guarding before send (`guardPayload()`/`truncateToFit()`, warns/blocks based on `DATA.WARN_PAYLOAD_BYTES`/`MAX_PAYLOAD_BYTES`), assembling the request and calling `anthropicAPI.sendToAnthropic()`/`streamToAnthropic()` (`processAnthropicRequest()`), rendering the streamed/buffered response, and handing chart-spec text to `chart-builder` when the response contains one (`processChartSuggestion()`/`handleAddToSheet()`). Also owns abort/stop wiring (`abortActiveRequest()`, `stopActiveRequest()`) and bounded conversation history (`boundedHistory()`, capped at `config.CHAT.HISTORY_MAX` turns).

---

## Data flow summary

See `docs/data-flow.md` for the full breakdown.

Short version:

```
Qlik hypercube
  → data-collector (extract + optimise for token budget)
  → ui-controller (assembles request: prompt + chart data + context + history)
  → anthropic-api (buildTransport + prepareRequest → shaped payload)
  → proxy (Qlik session auth, model allowlist check, injects the real API key)
  → Anthropic API or local Ollama
  → response streamed/returned to the browser
  → ui-controller renders it (formatting.js) and offers "add chart to sheet" (chart-builder.js)
```

---

## Key design constraints

- **Proxy is mandatory, not optional.** There is no direct-to-Anthropic fallback and no browser-held API key (removed by spec E01). `PROXY_URL`/`LOCAL.URL` blank means that backend is off — its models are withheld from the picker rather than offered and failing at request time.
- **Shared config singleton, per-object properties.** See `main.js`'s owner-election logic above — always check for a stray, never-configured object on the sheet before assuming a config/caching bug.
- **`paint()` is re-entrant and can be called often.** One-time initialization is guarded by `uiController.isInitialized()`, not by presence in the DOM.
- **No ES modules.** AMD (`define([...], function(...) {})`) only, everywhere in `js/`.
- **The proxy has its own authoritative model allowlist** (`proxy/lib/model-allowlist.js`, `ALLOWED_ANTHROPIC_MODELS`/`ALLOWED_OLLAMA_MODELS`), independent of the client-side `API.MODELS` registry. Renaming a model id in `js/config.js` without updating the deployed proxy's allowlist gets a `403 Model not allowed` at request time even though the picker shows it — update both together.
- **Measure formulas are sent to the model.** `qDef` (e.g. `Sum([Sales Amount])`) is included in chart data sent for analysis, which exposes internal field names to the LLM.

---

## Adding a new feature

1. If it needs new UI elements, edit the markup string in `js/template.js` (not `html/template.html` — that file isn't loaded).
2. Wire event handlers in `ui-controller.js` inside `setupEventHandlers()`.
3. If it changes what's sent to the model, edit `anthropic-api.js`'s `buildMessageContent()`/`prepareRequest()`.
4. If it's a new config key, add it to `js/config.js` and its check to `js/config-validate.js`.
5. If it changes what model IDs exist, update `js/config.js` (`API.MODELS`) **and** the proxy's `ALLOWED_ANTHROPIC_MODELS`/`ALLOWED_OLLAMA_MODELS`.
6. Deploy by copying files; no build step.

---

## Known limitations

| Area | Limitation |
|---|---|
| Maps | Only metadata (title, layer names, dimension/measure names) is reliably extracted. No coordinate or choropleth data. |
| Containers | Charts nested inside a Qlik container object may need `collectCandidateIds()`'s fallback to resolve to the actual inner chart's object ID. |
| Measure formulas | `qDef` expressions are included in the model payload; there's currently no per-request toggle to suppress them. |
| Chart-builder parsing | `parseChartSpec()`'s tolerant JSON parsing accepts a wide range of near-valid specs, but `renderPreview()`/`addToSheet()` still depend on the model naming dimensions/measures that resolve against the app's actual master items. |
| Proxy dependency | The extension is unusable without a reachable, correctly configured proxy (`Proxy URL` and/or `Local model URL`) — there is no offline or direct-API fallback by design (E01). |
