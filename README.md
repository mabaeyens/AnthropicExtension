# AnthropicExtension

Qlik Sense visualization extension that analyses chart data using the Anthropic API (Claude).

## Description

Adds an AI panel to any Qlik Sense dashboard. The user selects a visualization, asks a question in natural language and receives a Claude-generated analysis of the chart data. On the first request, the extension also sends the app's data-model structure (field names and master items) so Claude can interpret the chart in context.

By default the extension calls `https://api.anthropic.com/v1/messages` **directly from the browser** using Anthropic's `anthropic-dangerous-direct-browser-access` header — **no proxy required**. For this to work in Qlik Sense Enterprise, an administrator adds `api.anthropic.com` to the QMC Content Security Policy once (see Installation).

Optionally, you can route requests through a **local Node.js proxy** ([cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy)) by setting a **Proxy URL** in the extension properties — useful if your organization prefers to keep the API key server-side.

## Requirements

- Qlik Sense Desktop (Windows) or Qlik Sense Enterprise ≥ 3.0
- Anthropic API key (this is the **only** thing an end user configures)
- For the direct (default) mode on Enterprise: a one-time QMC Content Security Policy entry for `api.anthropic.com` (admin step)
- For the optional proxy mode only: a Node.js proxy at `https://localhost:3000/api/anthropic` — see [cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy)

## Installation

1. Copy the repository folder into the Qlik Sense extensions directory:
   - **Desktop**: `%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\`
   - **Enterprise**: QMC console → Extensions → Import
2. **(Enterprise, direct mode only)** In the QMC, open **Content Security Policy** and add an entry
   allowing `api.anthropic.com` on the `connect-src` directive, then restart the proxy/engine service.
   This is a one-time admin step. (Skip if you use the optional Proxy URL instead.)
3. Reload Qlik Sense
4. The extension will appear in the assets panel as **"Anthropic AI Assistant"**

## Configuration

End users only enter an **API key**. The following are exposed in the extension's properties panel
(no code editing required):

| Property | Default | Description |
|---|---|---|
| API Key | — | Your Anthropic API key (stored encrypted in `localStorage`, shared across apps) |
| Model | `claude-haiku-4-5` | Claude model: Haiku 4.5, Sonnet 4.6, or Opus 4.8 |
| Proxy URL | _(blank)_ | Leave blank to call the API directly; set it to route through a local proxy |

Advanced defaults can still be tuned in `js/config.js`:

| Parameter | Default | Description |
|---|---|---|
| `API.URL` | `https://api.anthropic.com/v1/messages` | Direct Anthropic endpoint (used when no Proxy URL is set) |
| `API.VERSION` | `2023-06-01` | `anthropic-version` header for direct calls |
| `API.MODEL` | `claude-haiku-4-5` | Default Claude model |
| `API.MAX_TOKENS` | `4000` | Maximum tokens in the response |
| `DATA.MAX_ROWS` | `1000` | Maximum rows sent to the LLM |
| `DEBUG_MODE` | `false` | Enable/disable console logs |

## Optional proxy

By default the extension calls `https://api.anthropic.com/v1/messages` directly from the browser
(sending the `anthropic-version` and `anthropic-dangerous-direct-browser-access` headers). No proxy
is needed.

If you prefer to keep the API key off the browser, set a **Proxy URL** in the extension properties
and run the **[cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy)** Node.js server (or any proxy)
that:

- Listens at your Proxy URL (e.g. `https://localhost:3000/api/anthropic`)
- Accepts POST requests with the `x-api-key` header (Anthropic key)
- Forwards them to `https://api.anthropic.com/v1/messages`

## Usage

1. Open a dashboard in Qlik Sense
2. Drag the **"Anthropic AI Assistant"** extension onto a sheet
3. Enter your Anthropic API key in the properties panel (optionally pick a Model)
4. Click **"Select Chart"**, choose a visualization and type your question

## Structure

```
AnthropicExtension/
├── AnthropicExtension.js    # Entry point (Qlik RequireJS)
├── AnthropicExtension.qext  # Extension metadata
├── icon.png
├── css/
│   └── style.css
├── html/
│   └── template.html
└── js/
    ├── config.js            # Central configuration
    ├── main.js              # Extension initialization + properties panel
    ├── anthropic-api.js     # API client (direct or via proxy)
    ├── data-collector.js    # Data extraction from Qlik visualizations + app context
    ├── data-format.js       # Data formatting for the LLM
    ├── ui-controller.js     # UI management
    ├── template.js          # Inlined panel markup (loaded with the bundle)
    ├── security.js          # API key management (CryptoJS AES, shared key)
    └── lib/
        └── crypto-js.min.js # CryptoJS 4.2.0 — bundled, no npm install required
```

## Status

- [x] Data extraction from charts (bar, line, combo, map)
- [x] Analysis with Claude (direct browser call by default; optional proxy)
- [x] Data-model structure (fields + master items) sent on first use
- [x] Encrypted API key storage (CryptoJS AES), shared across Qlik apps
- [ ] Qlik Cloud support (untested)

## Notes

- Compatible with **Qlik Sense on Windows** (Desktop and Enterprise); not tested on Qlik Cloud
- The API key is encrypted with CryptoJS AES before being written to `localStorage` and is reused
  across all Qlik apps. The encryption passphrase is bundled in the extension, so this is
  **obfuscation, not strong secrecy** — appropriate for on-prem internal deployments where the goal
  is to keep the key out of plain sight, not to defend against a determined local attacker.
- `crypto-js.min.js` is bundled in the repo; no `npm install` required
- Model and Proxy URL are set in the extension properties panel; deeper defaults live in `js/config.js`

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
