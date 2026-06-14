# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ⚠️ Experimental / demo extension (v0.2.0). Not hardened for production.

## What This Is

A Qlik Sense visualization extension that adds an AI assistant panel to dashboards. Users select a chart object, type a natural language question, and receive Claude-generated analysis. On the first request it also sends the app's data-model structure (field names + master items) so Claude can interpret the chart in context.

By default the extension calls the Anthropic API **directly from the browser** (`https://api.anthropic.com/v1/messages`) using the `anthropic-version` and `anthropic-dangerous-direct-browser-access` headers — **no proxy required**. Targets **client-managed Qlik Sense on Windows (QSEoW)**, where the direct call normally works as-is; if the environment blocks it, set a Proxy URL. (Qlik Cloud is out of scope — it has native AI assistants.) A **local Node.js proxy is optional**: set a Proxy URL in the extension properties to route requests through it instead (e.g. [cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy) at `https://localhost:3000/api/anthropic`).

See `diagrams.md` for sequence and data-flow diagrams.

## No Build Step

This is plain vanilla JavaScript loaded via Qlik's RequireJS system. There is no npm, no compile step, and no test framework. Changes take effect immediately after refreshing the Qlik Sense app.

To deploy: copy the entire repository folder into the Qlik Sense Extensions directory:
- Desktop: `C:\Users\<user>\Documents\Qlik\Sense\Extensions\AnthropicExtension`
- Enterprise: upload as a zip via the QMC

## Architecture

**Entry point:** `AnthropicExtension.js` → `js/main.js`

All modules use the RequireJS `define(dependencies, factory)` pattern. `main.js` wires them together and exposes the `paint(element, layout)` method that Qlik calls on every render cycle. `paint()` applies the Model/Proxy-URL properties to `config` on every call but performs UI/selection initialization **once per instance** (guarded via `$element.data('anthropicInitialized')`).

**Request flow:**
1. `data-collector.js` — tracks the currently selected Qlik visualization object (DOM click → `qv-object-<id>` class) and extracts its hypercube (rows/columns, dimensions, measures). Also collects the app context (field list + master items) once per session via `getAppContextCached()`.
2. `data-format.js` — compresses and formats that data for LLM consumption; estimates token count and trims rows to stay under budget.
3. `ui-controller.js` — manages all DOM interactions (API key input, chart selection, submit, response display) and assembles the request `{ userPrompt, chartData, context, systemPrompt }`.
4. `anthropic-api.js` — builds the message, picks the transport via `buildTransport()` (direct vs proxy based on `config.API.PROXY_URL`), and POSTs with the API key in the `x-api-key` header. Direct calls also send `anthropic-version` and `anthropic-dangerous-direct-browser-access: true`.
5. `security.js` — encrypts/decrypts the API key in `localStorage` using bundled CryptoJS AES, under a **single shared key** (`anthropic_api_key`, not per app).
6. `js/config.js` — single source of truth for model ID (`claude-haiku-4-5`), `MODELS` list, max tokens (4000), direct endpoint `URL`, `VERSION`, optional `PROXY_URL`, system prompt, and data optimization flags.

**UI template:** the panel markup is inlined in `js/template.js` (a RequireJS module) and injected by `ui-controller.js` — there is no runtime fetch of `html/template.html` (that file is kept only for reference). Styling is in `css/style.css` using Qlik's `lui-*` CSS class conventions.

## Key Constraints

- **Proxy is optional.** Direct browser calls work via the `anthropic-dangerous-direct-browser-access` header and normally function on QSEoW without extra config; if the environment blocks the outbound call, set a Proxy URL to route through a proxy instead (which must forward to `https://api.anthropic.com/v1/messages` and return the body unchanged). (Note: QSEoW has no QMC Content Security Policy page — that's a Qlik Cloud/QSEoK concept; do not document a QMC CSP step for QSEoW.)
- **Qlik paint cycle.** `main.js:paint()` is called by Qlik on every property change or selection event — UI init is behind a first-run guard; keep it that way.
- **No ES modules.** All files must use `define([...], function(...) {})` syntax. No `import`/`export`.
- **CryptoJS is bundled.** `js/lib/crypto-js.min.js` (v4.2.0) is included directly and required as `./lib/crypto-js.min`; do not reference it from a CDN.
- **Key storage is obfuscation, not strong secrecy.** The AES passphrase is bundled in the extension — adequate for on-prem internal demos only.

## Model Configuration

End users pick the model in the extension properties panel (Haiku 4.5 / Sonnet 4.6 / Opus 4.8). To change defaults or tune behavior, edit `js/config.js`:
- `API.MODEL` — default model ID string (`claude-haiku-4-5`)
- `API.MODELS` — models offered in the properties dropdown
- `API.MAX_TOKENS` — response token cap
- `API.SYSTEM_PROMPT` — base instruction sent with every request
- `API.PROXY_URL` — default proxy URL (usually left blank; overridden per-instance by the property)
- `DATA.DEFAULT_OPTIMIZATION` flags — control what data is included in the payload to reduce token usage
