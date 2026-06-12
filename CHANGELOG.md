# Changelog

All notable changes to this extension are documented here.

> ⚠️ **Experimental / demo only.** This extension is for demonstration purposes. It is not
> hardened for production use. The API key is obfuscated (not strongly encrypted) in the browser,
> and in direct mode the key is sent from the browser to `api.anthropic.com`.

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

### Notes / known limitations
- **Enterprise (direct mode):** an administrator must add `api.anthropic.com` to the QMC Content
  Security Policy (`connect-src`) once. See `INSTALL.md`.
- Not tested on Qlik Cloud.
- The encryption passphrase is bundled in the extension, so key storage is obfuscation, not strong
  secrecy — appropriate for on-prem internal demos only.

[0.2.0]: https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.2.0
