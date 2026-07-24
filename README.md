# AnthropicExtension

Qlik Sense visualization extension that analyses chart data using a Large Language Model (Claude, via
the Anthropic API) and can suggest and create Qlik charts from the model's responses.

> ## ⚠️ Demo only — no warranty, no liability
>
> This is an **experimental demonstration asset (v0.4.0)**, not a product. It is **not** hardened for
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
> **Exception — local models:** selecting **Ministral 3 8B** or **Ministral 3 3B** (local) runs
> inference on your own machine via Ollama, so **no chart data leaves your environment**. See
> [Local models](#local-models-ministral-3-via-ollama).
>
> See [`CHANGELOG.md`](./CHANGELOG.md), [`INSTALL.md`](./INSTALL.md), and [`diagrams.md`](./diagrams.md).

> ℹ️ This repository is **not public yet**; it may be made public in the future. The disclaimer above
> applies regardless.

## Description

Adds a floating AI assistant panel to any Qlik Sense dashboard. The user selects one or more
visualizations, asks questions in natural language, and receives model-generated analysis rendered as
a **Markdown chat thread** with memory across the conversation. Answers **stream in token by token**
as they are generated. The assistant can also **suggest a Qlik chart** from its answer and **create
it** — preview it in the panel and add it to the current sheet (in Edit mode). On the first request,
the extension sends the app's **data-model structure** (real table and field names, plus master
dimension/measure definitions) so the model can interpret the chart in context.

**Models are chosen in the chat panel**, not buried in the properties: a **Pick model** button next
to *Submit* and *Suggest a chart* switches between Claude (Haiku 4.5 / Sonnet 4.6 / Opus 4.8) and the
local Ministral models at any time. Switching clears the thread (history can't meaningfully cross
models), and the model that produced each answer is named in its footer.

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

Optionally, you can route requests through a **local Node.js proxy** ([cm-llm-proxy](./proxy)) by setting a **Proxy URL** in the extension properties — useful if your organization prefers to keep the API key server-side.

> ℹ️ The proxy lives in this repo under [`./proxy`](./proxy). It was previously the standalone
> [`mabaeyens/cm-llm-proxy`](https://github.com/mabaeyens/cm-llm-proxy) repository, now merged here
> (with its history) so the extension and proxy version together.

## Requirements

- Client-managed Qlik Sense on Windows — Desktop or Enterprise (QSEoW) ≥ 3.0 (not Qlik Cloud)
- Anthropic API key (the **only** thing an end user configures — **not** required for the local model)
- For the optional proxy mode only: a Node.js proxy at `https://localhost:3000/api/anthropic` — see [cm-llm-proxy](./proxy)
- For the local models only: a local [Ollama](https://ollama.com) server plus [cm-llm-proxy](./proxy) ≥ v1.1.0 (`/api/ollama` route) — see [Local models](#local-models-ministral-3-via-ollama)
- For **streamed** answers through a proxy: [cm-llm-proxy](./proxy) ≥ **v1.2.0**, which pipes the upstream response through instead of buffering it. Older versions still work — the extension just falls back to showing the whole answer at once.

## Download

**Latest release: [v0.4.0](https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.4.0)** —
download `AnthropicExtension-v0.4.0.zip` from the
[releases page](https://github.com/mabaeyens/AnthropicExtension/releases). See
[`CHANGELOG.md`](./CHANGELOG.md) for what changed.

## Installation

You can either use the packaged release zip or copy the repository folder directly.

1. Get the extension into the Qlik Sense extensions directory:
   - **Enterprise (QSEoW)**: in the QMC → **Extensions → Import**, upload
     `AnthropicExtension-v0.4.0.zip`.
   - **Desktop**: unzip the release into
     `%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\` (or copy this repo
     folder there).
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
| API key | — | Your Anthropic API key (stored encrypted in `localStorage`, shared across apps). Not required for local models; the "no API key" notice is hidden while one is selected |
| Default model | `claude-haiku-4-5` | The model each session **starts** with — switch any time with **Pick model** in the chat panel |
| Proxy URL | _(blank)_ | Leave blank to call the API directly; set it to route Claude requests through a local proxy |
| Local model URL | _(blank)_ | Ollama endpoint (via the HTTPS proxy) used when a local model is selected — see [Local models](#local-models-ministral-3-via-ollama) |

In the chat panel itself:

| Control | Where | Description |
|---|---|---|
| **Pick model** | next to *Submit* / *Suggest a chart* | Switch model mid-session. Changing it asks for confirmation and **clears the conversation** — history can't meaningfully cross models |
| **Stream the answer as it is generated** | Advanced Options | On by default. Turn it off to wait for the complete response instead |

Advanced defaults can still be tuned in `js/config.js`:

| Parameter | Default | Description |
|---|---|---|
| `API.URL` | `https://api.anthropic.com/v1/messages` | Direct Anthropic endpoint (used when no Proxy URL is set) |
| `API.VERSION` | `2023-06-01` | `anthropic-version` header for direct calls |
| `API.MODEL` | `claude-haiku-4-5` | Model the session starts with (Claude id, or `ministral-local` / `ministral-local-3b`) |
| `API.MODELS` | 5 entries | Model **registry** — `{ id, label, hint, local, tag }`. Drives both the properties dropdown and the in-panel picker, so they can't drift apart. Add a model here and it appears in both |
| `API.MAX_TOKENS` | `4000` | Maximum tokens in the response |
| `API.LOCAL.URL` | `https://localhost:3000/api/ollama` | Local model endpoint (Ollama via the HTTPS proxy) |
| `API.LOCAL.MODEL_TAG` | `ministral-3-demo` | Fallback Ollama model name, used only if a registry entry has no `tag` |
| `CHAT.STREAM` | `true` | Default for the streaming toggle |
| `DATA.MAX_ROWS` | `1000` | Maximum rows sent to the LLM |
| `DEBUG_MODE` | `false` | Enable/disable console logs |

## Optional proxy

By default the extension calls `https://api.anthropic.com/v1/messages` directly from the browser
(sending the `anthropic-version` and `anthropic-dangerous-direct-browser-access` headers). No proxy
is needed.

If you prefer to keep the API key off the browser, set a **Proxy URL** in the extension properties
and run the **[cm-llm-proxy](./proxy)** Node.js server (or any proxy)
that:

- Listens at your Proxy URL (e.g. `https://localhost:3000/api/anthropic`)
- Accepts POST requests with the `x-api-key` header (Anthropic key)
- Forwards them to `https://api.anthropic.com/v1/messages`

## Local models (Ministral 3 via Ollama)

As of **v0.3.4** the assistant can run against a **local model** instead of Claude — useful for
offline demos or when chart data must **not leave the machine**. Pick **Ministral 3 8B** or
**Ministral 3 3B** with **Pick model** in the chat panel; **no API key is required** for this path.

| Model | Ollama tag | Notes |
|---|---|---|
| Ministral 3 8B | `ministral-3-demo` | Better answers; ~6 GB resident |
| Ministral 3 3B | `ministral-3b-demo` | Roughly half the memory at comparable speed |

Because a QSEoW dashboard is served over **HTTPS**, the browser cannot call a plain-HTTP local Ollama
server directly (mixed-content blocking). Requests therefore go through the **cm-llm-proxy**
`/api/ollama` route over HTTPS, which forwards to Ollama on the same machine:

```
Qlik (HTTPS) → https://localhost:3000/api/ollama  (cm-llm-proxy) → http://localhost:11434 (Ollama)
```

**Setup (on the machine running Ollama):**

1. Install [Ollama](https://ollama.com), pull a model, then bake an 8k context window. **Do not skip
   this step:** Ollama now defaults to a **64k** context, which inflates the KV cache to ~10 GB and
   pushes the model almost entirely onto the CPU.
   ```bash
   # 8B
   ollama pull ministral-3:8b
   printf 'FROM ministral-3:8b\nPARAMETER num_ctx 8192\n' > Modelfile
   ollama create ministral-3-demo -f Modelfile

   # 3B — lighter
   ollama pull ministral-3:3b
   printf 'FROM ministral-3:3b\nPARAMETER num_ctx 8192\n' > Modelfile
   ollama create ministral-3b-demo -f Modelfile
   ```
2. Run **[cm-llm-proxy](./proxy)** ≥ v1.1.0 (it exposes the
   `/api/ollama` route; ≥ v1.2.0 to stream). Set `OLLAMA_URL` in its `.env` if Ollama isn't at the
   default `http://localhost:11434`, and `QLIK_ORIGIN` to the URL you open the hub with — CORS
   compares it exactly, so `https://localhost` will reject a hub served from `https://myserver`.
3. **Trust the proxy's certificate.** Without it the browser blocks the extension's request as a
   status-less XHR failure — not a warning you can click through. On Windows, Chrome and Edge read
   the OS store: `certutil -user -addstore Root certs\localhost3000-cert.pem`, then restart the
   browser.
4. Set **Local model URL** = `https://localhost:3000/api/ollama` in the extension properties, and
   pick a Ministral model with **Pick model** in the chat panel.

**Notes**

- Each local model's Ollama tag lives in its `API.MODELS` registry entry (`tag`). The endpoint and
  timeout are in `API.LOCAL` (`URL`, `TIMEOUT` = 5 min), and the context guard in
  `API.CONTEXT_WINDOWS` (`8192` — keep this ≤ the model's baked `num_ctx`).
- Local inference is **slower** than the hosted API, hence the 5-minute timeout. On a 4 GB laptop
  GPU (NVIDIA T1200) expect roughly **6–7 tok/s** for the 8B and **~18 tok/s** for the 3B. Neither
  fits entirely in 4 GB once a browser and Qlik are also using VRAM, so both run partly on the CPU —
  check with `ollama ps`, which reports the CPU/GPU split.
- Streaming makes the slower local path far more pleasant: tokens appear as they're generated
  instead of after a long silence.
- Ministral 3 (Ollama library) is licensed **Apache 2.0**. This path is demo-grade.

## Usage

1. Open a dashboard in Qlik Sense
2. Drag the **"Anthropic AI Assistant"** extension onto a sheet
3. Enter your Anthropic API key in the properties panel (not needed for local models)
4. Click **"Add Chart"**, choose a visualization and type your question
5. Optionally switch model with **Pick model** — the active one is shown under the submit row and in
   each answer's footer

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
   - **Local model:** `POST <Local model URL>` in **OpenAI chat-completions** format (no key); the
     proxy's `/api/ollama` route forwards to a local Ollama server. Data stays on the machine.
5. **Render** — with streaming on, `anthropic-api.streamToAnthropic()` reads the SSE response with
   `fetch` + `ReadableStream` and appends each delta as **plain text**; the Markdown is rendered and
   sanitized **once, when the stream ends** (`formatting.js` + bundled `marked.js`). Parsing Markdown
   per token flickers, costs a sanitize pass per chunk, and shows half-written syntax as noise — and
   inserting text rather than HTML means no markup is ever built from partial model output. An
   in-flight stream is aborted on *New chat* or a model switch. With streaming off (or where it isn't
   available) the buffered `$.ajax` path renders the whole reply at once. Each answer has a **Copy**
   button and a footer naming the model that produced it, pinned at send time.
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
- [x] **Local model** backend (Ministral 3 8B / 3B via Ollama) — no API key, data stays on-machine
- [x] **In-panel model picker** — switch models mid-session; the answering model is named per response
- [x] **Streamed answers** (token by token), with a toggle and an automatic buffered fallback
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
