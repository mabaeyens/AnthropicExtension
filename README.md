# AnthropicExtension

Qlik Sense visualization extension that analyses chart data using a Large Language Model (Claude, via
the Anthropic API) and can suggest and create Qlik charts from the model's responses.

> ## ⚠️ Demo only — no warranty, no liability
>
> This is an **experimental demonstration asset (v0.3.1)**, not a product. It is **not** hardened for
> production and is **not** a Qlik offering or a supported integration. **Neither Qlik nor the author
> accept any liability** for any issue, data exposure, cost, or damage arising from its use in any
> customer, production, or other environment. **Use entirely at your own risk.**
>
> ### Your data leaves your environment
>
> When a question is asked, the extension sends Qlik data **out of your on-prem Qlik Sense environment
> to an external Large Language Model**. As of v0.3.0 this includes the **full** contents of the
> selected chart/table (the complete hypercube, not just a preview), the app's **field and table
> names**, and **master dimension/measure definitions**. In the default mode this goes from the
> **browser directly to `api.anthropic.com`**; with the optional proxy it goes to whichever LLM
> endpoint the proxy targets. The Anthropic API key is only **obfuscated** in `localStorage`, not
> strongly encrypted. **Do not use this with sensitive, regulated, or personal data** unless that
> data egress is explicitly permitted in your environment.
>
> See [`CHANGELOG.md`](./CHANGELOG.md), [`INSTALL.md`](./INSTALL.md), and [`diagrams.md`](./diagrams.md).

> ℹ️ This repository is **not public yet**; it may be made public in the future. The disclaimer above
> applies regardless.

## Description

Adds a floating AI assistant panel to any Qlik Sense dashboard. The user selects one or more
visualizations, asks questions in natural language, and receives Claude-generated analysis rendered as
a **Markdown chat thread** with memory across the conversation. The assistant can also **suggest a
Qlik chart** from its answer and **create it** — preview it in the panel and add it to the current
sheet (in Edit mode). On the first request, the extension sends the app's **data-model structure**
(real table and field names, plus master dimension/measure definitions) so Claude can interpret the
chart in context.

**Where the data goes:** the selected chart's data — as of v0.3.0 the **full** hypercube, not just an
initial page — together with the data-model structure is sent to an external LLM. By default the
extension calls `https://api.anthropic.com/v1/messages` **directly from the browser** using Anthropic's
`anthropic-dangerous-direct-browser-access` header — **no proxy required**. On client-managed Qlik
Sense (QSEoW) the direct call normally works as-is; if your environment blocks it, set the optional
**Proxy URL** (see Installation). If the selected data exceeds ~65 KB, the panel **warns before
sending**.

This extension targets **client-managed Qlik Sense on Windows** (Desktop and Enterprise). **Qlik Cloud
is intentionally out of scope** — Qlik Cloud already ships native AI assistants, so there is no plan to
support it here.

Optionally, you can route requests through a **local Node.js proxy** ([cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy)) by setting a **Proxy URL** in the extension properties — useful if your organization prefers to keep the API key server-side.

## Requirements

- Client-managed Qlik Sense on Windows — Desktop or Enterprise (QSEoW) ≥ 3.0 (not Qlik Cloud)
- Anthropic API key (this is the **only** thing an end user configures)
- For the optional proxy mode only: a Node.js proxy at `https://localhost:3000/api/anthropic` — see [cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy)

## Installation

1. Copy the repository folder into the Qlik Sense extensions directory:
   - **Desktop**: `%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\`
   - **Enterprise**: QMC console → Extensions → Import
2. Reload Qlik Sense
3. The extension will appear in the assets panel as **"Anthropic AI Assistant"**

> On client-managed Qlik Sense (QSEoW) the default direct browser call usually works without extra
> configuration. If your environment blocks the outbound call, set the optional **Proxy URL** in the
> extension properties (see below) and run a local proxy.

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

## Architecture & data flow

The request path (User → Qlik Sense → **external LLM** → back) is:

1. **Select** — clicking a chart is detected via its `qv-object-<id>` DOM class; `data-collector.js`
   resolves the real object id (engine-validated) and pulls the object's hypercube. For large tables
   it **pages the full hypercube** rather than a single initial page; `data-format.js` formats it for
   the model.
2. **Context (first use)** — `data-collector.getAppContextCached()` collects the **real data model**
   via `getTablesAndKeys` plus a field/dimension/measure session object (table names, full field list,
   master dimensions/measures with expressions) **once per session** and caches it.
3. **Assemble** — `ui-controller.js` builds `{ userPrompt, chartData, context, systemPrompt, history }`
   as a running conversation. Chart data is resent only when the selection changes; context only on
   the first turn. If the payload exceeds ~65 KB it **prompts the user to confirm** before sending.
4. **Send (data leaves on-prem)** — `anthropic-api.js` decrypts the key (`security.js`), formats the
   message, and chooses the transport with `buildTransport()`:
   - **Direct (default):** `POST https://api.anthropic.com/v1/messages` with `x-api-key`,
     `anthropic-version`, and `anthropic-dangerous-direct-browser-access: true`.
   - **Proxy (optional):** `POST <Proxy URL>` with `x-api-key`; the proxy forwards to the LLM.
5. **Render** — Claude's reply is rendered as Markdown (`formatting.js` + bundled `marked.js`) into the
   chat thread; each answer has a **Copy** button.
6. **Create a chart (optional, write-back)** — "Suggest a chart" asks the model for a chart spec;
   `chart-builder.js` renders a **live preview** via the in-session Qlik visualization API and can
   **add it to the current sheet** (Edit mode), placing it below existing objects or offering a new
   sheet when the current one is full. This path writes to the live app **as the logged-in user** — no
   external service is involved in the creation step.

See [`diagrams.md`](./diagrams.md) for sequence, component, key-storage, transport-decision, and
chart-creation diagrams (rendered with Mermaid on GitHub).

## Structure

```
AnthropicExtension/
├── AnthropicExtension.js    # Entry point (Qlik RequireJS)
├── AnthropicExtension.qext  # Extension metadata (version, name)
├── README.md                # This file
├── CHANGELOG.md             # Release notes
├── INSTALL.md               # Deployment / run instructions
├── diagrams.md              # Data-flow & sequence diagrams (Mermaid)
├── icon.png
├── css/
│   └── style.css
├── html/
│   └── template.html        # Reference copy (panel markup is inlined in js/template.js)
└── js/
    ├── config.js            # Central configuration
    ├── main.js              # Extension initialization + properties panel
    ├── anthropic-api.js     # API client (direct or via proxy) + context/message serialization
    ├── data-collector.js    # Data extraction (full hypercube) + real data-model context
    ├── data-format.js       # Data formatting for the LLM
    ├── ui-controller.js     # Panel UI, conversation thread, copy, large-payload warning
    ├── chart-builder.js     # Parse chart spec → live preview / add to sheet (Qlik viz API)
    ├── formatting.js        # Markdown→HTML rendering of responses (uses marked.js)
    ├── template.js          # Inlined panel markup (loaded with the bundle)
    ├── security.js          # API key management (CryptoJS AES, shared key)
    └── lib/
        ├── crypto-js.min.js # CryptoJS 4.2.0 — bundled, no npm install required
        └── marked.min.js    # marked 12.x — bundled Markdown renderer
```

## Status

- [x] Data extraction from native charts (bar, line, combo, box, etc.); engine-validated id resolution
- [x] **Full hypercube** retrieval for large tables (with a ~65 KB pre-send warning)
- [x] Analysis with Claude (direct browser call by default; optional proxy)
- [x] **Conversation thread** with memory, Markdown rendering, and per-response copy
- [x] **Real data-model context** (tables, fields, master dimensions/measures) sent on first use
- [x] **Suggest a chart** (live preview) and **add to sheet** (Edit mode; new-sheet fallback)
- [x] Encrypted API key storage (CryptoJS AES), shared across Qlik apps
- [ ] **Map** visualizations (selection / creation) — not yet supported
- Qlik Cloud — **out of scope** (Cloud already has native AI assistants)

## Notes

- **Demo only.** Not a Qlik product and not production-hardened. **Neither Qlik nor the author accept
  any liability** for issues, data exposure, or costs in any environment — use at your own risk.
- **Data egress.** Asking a question sends chart data (the full table/hypercube), table/field names,
  and master-item definitions to an external LLM. Don't use it with sensitive/regulated/personal data
  unless that egress is permitted.
- Compatible with **client-managed Qlik Sense on Windows** (Desktop and Enterprise / QSEoW). Qlik
  Cloud is out of scope (it already has native AI assistants)
- The API key is encrypted with CryptoJS AES before being written to `localStorage` and is reused
  across all Qlik apps. The encryption passphrase is bundled in the extension, so this is
  **obfuscation, not strong secrecy** — appropriate for on-prem internal deployments where the goal
  is to keep the key out of plain sight, not to defend against a determined local attacker.
- `crypto-js.min.js` is bundled in the repo; no `npm install` required
- Model and Proxy URL are set in the extension properties panel; deeper defaults live in `js/config.js`

## Author

Created and maintained by **mabaeyens**. (Demo asset — see the no-warranty / no-liability notice
above; not a Qlik product.)

## 🛠️ Development Workflow: Human-AI Collaboration

This project is the result of a strategic collaboration between human design and AI-assisted code generation.

- **Architecture & Logic:** Fully defined by the author. This includes system structure, business rules, data flow, and implementation strategy.
- **Code Generation:** The syntactic implementation and line-by-line code writing was performed by **Claude Code**, following precise and iterative instructions provided by the author.
- **Supervision & Refinement:** All code was manually reviewed, tested, and adjusted to ensure quality, consistency, and compliance with project standards.

This approach demonstrates the ability to direct advanced AI tools to accelerate development without sacrificing creative control or technical quality.

## 📄 License

This project is licensed under the **MIT License**. You can find the full text in the [`LICENSE`](./LICENSE) file.

> **No warranty / no liability.** Consistent with the MIT License, this demo asset is provided
> "AS IS", without warranty of any kind. **Neither Qlik nor the author is liable** for any claim,
> damage, data exposure, or cost arising from its use — including in customer or production
> environments. It is **not** a Qlik product or supported integration.

> **Note on authorship:** Although much of the source code was generated by an AI, the creative direction, architecture, and final integration are human work. Usage rights are granted under the terms of the MIT License.

## 🚀 Contributing

Feel free to fork this project!
- If you find a bug, open an issue.
- If you have an improvement, submit a Pull Request.
- Feel free to use this code in your own projects!
