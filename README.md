# AnthropicExtension

Qlik Sense visualization extension that analyses chart data using a Large Language Model (Claude, via
the Anthropic API) and can suggest and create Qlik charts from the model's responses.

> ## 🔒 Proxy-only as of v0.5.0
>
> The extension is **proxy-only**: the browser holds **no API key** and **never** calls
> `api.anthropic.com` directly. Every request goes to the **hardened proxy** under
> [`proxy/`](./proxy) (**v2.0.0**), which holds the Anthropic key server-side and authenticates the
> caller by their **Qlik session**. The direct-browser transport, the bundled crypto, and the
> API-key property have been removed. You **must deploy the proxy** and set a **Proxy URL** (and, for
> local models, a **Local model URL**) in the extension settings, see
> [Proxy (required)](#proxy-required) and [`proxy/README.md`](./proxy/README.md) (its
> `scripts/setup.ps1` automates the install). The proxy is versioned and tagged independently of the
> extension (`proxy-vX.Y.Z` vs `vX.Y.Z`); **extension v0.5.5 pairs with proxy v2.0.2**.

> ## ⚠️ Independent project, not a Qlik product
>
> This is an independently built and maintained extension (extension v0.5.5, proxy v2.0.2). It is
> **not** a Qlik product, offering, or supported integration, and carries no Qlik warranty or support
> commitment. It is actively used and maintained, but support comes from the author, not Qlik, see the
> Contributing section below to report an issue. **Neither Qlik nor the author accept any
> liability** for any issue, data exposure, cost, or damage arising from its use in any customer,
> production, or other environment. **Use at your own risk.**
>
> ### Your data leaves your environment
>
> When a question is asked, the extension sends Qlik data **out of your on-prem Qlik Sense environment
> to an external Large Language Model**. As of v0.3.0 this includes the **full** contents of the
> selected chart/table (the complete hypercube, not just a preview), the app's **field and table
> names**, and **master dimension/measure definitions**. This is sent **through the proxy** to
> whichever LLM endpoint it targets (Anthropic by default). The Anthropic API key is held only on the
> proxy (server-side), never in the browser. **Do not use this with sensitive, regulated, or personal
> data** unless that data egress is explicitly permitted in your environment.
>
> **Exception, local models:** selecting **Ministral 3 8B** or **Ministral 3 3B** (local) runs
> inference on your own machine via Ollama, so **no chart data leaves your environment**. See
> [Local models](#local-models-ministral-3-via-ollama).
>
> See [`CHANGELOG.md`](./CHANGELOG.md), [`INSTALL.md`](./INSTALL.md), [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md),
> and [`diagrams.md`](./diagrams.md).
> The production-hardening architecture (implemented across the proxy and extension in v0.5.0):
> [`docs/security-model.md`](./docs/security-model.md) and
> [`docs/concurrency-model.md`](./docs/concurrency-model.md).

## Description

The extension puts a floating AI panel on any Qlik Sense sheet. You pick one or more charts, ask a
question in plain language, and the answer comes back as a chat thread that remembers what was said
before. Answers stream in while they are being written, so you can start reading straight away, and
the Stop button cuts a long answer short while keeping whatever text already arrived.

It can also propose a chart. When an answer suggests a visualisation, "Suggest a chart" turns it into
a real Qlik chart definition, previews it inside the panel, and adds it to the sheet if you are in
Edit mode.

On the first question of a session it sends the app data model as well: the real table and field
names, plus master dimension and measure definitions. That context is what lets the model discuss
your data in your own terms instead of guessing what "Column 3" is supposed to mean.

You choose the model in the panel, not buried in the properties. "Pick model" switches between the
Claude models (Haiku 4.5, Sonnet 4.6, Opus 4.8) and the local Ministral models whenever you like.
Switching starts a fresh thread, because a conversation does not carry across models, and every
answer says which model wrote it.

### Where your data goes

Asking a question sends the selected chart data (the full hypercube, not just the first page) and the
data model structure to the proxy, which forwards it to the LLM. Your Qlik session goes with the
request so the proxy can check who you are, and the API key stays on the proxy, never in the browser.
Above roughly 65 KB the panel asks you to confirm first, and anything above the proxy body limit
(1 MB) is stopped in the browser with a clear message rather than failing server side.

If you pick one of the local Ministral models, inference runs on your own machine through Ollama and
no chart data leaves your environment at all.

This targets client-managed Qlik Sense on Windows, Desktop and Enterprise. Qlik Cloud is out of scope
on purpose, since it already ships its own AI assistants.

> The proxy lives in this repo under [`./proxy`](./proxy), imported with history from the former
> standalone [`mabaeyens/cm-llm-proxy`](https://github.com/mabaeyens/cm-llm-proxy) repo. It holds the
> API key server side, authenticates the Qlik session, and enforces concurrency and rate limits. See
> [`proxy/README.md`](./proxy/README.md).

## Use cases

What this is actually good for, based on using it in demos and on real apps:

- **Explaining a chart to someone who did not build it.** Select the chart, ask "what is going on
  here", and get a written read of the numbers instead of a meeting.
- **A quick sanity pass before you present.** Ask what stands out, what looks off, or which segment
  is driving a total, and you walk in knowing the story in the data.
- **Turning a question into a chart.** Describe what you want to see, let it propose the chart, then
  preview it and drop it on the sheet if it is right.
- **Getting oriented in an unfamiliar app.** Because the data model goes with the first question, you
  can ask what a field means or which table something comes from.
- **Demos where data cannot leave the building.** Switch to a local Ministral model and the whole
  conversation stays on the machine, which makes the "but where does our data go" conversation short.
- **Showing customers what an on-prem AI assistant could look like** without waiting for a product
  roadmap, and without handing anyone an API key.

Keep in mind it is an independent, community-supported extension. It is good at reading a chart and
drafting an explanation. It is not a governed, Qlik-supported analytics feature, and it should not be
pointed at sensitive data.

## Requirements

- Client-managed Qlik Sense on Windows, Desktop or Enterprise (QSEoW) ≥ 3.0 (not Qlik Cloud)
- The **hardened proxy (v2.0.0) deployed and reachable** (it holds the Anthropic API key and
  authenticates the Qlik session), see [`proxy/`](./proxy). The proxy is **required**; there is no
  direct-browser mode. v2.0.0 or later is needed: earlier proxies don't authenticate the caller and
  don't propagate client cancellation (**Stop**).
- The **Anthropic API key**: configured **on the proxy** (`ANTHROPIC_API_KEY` in its `.env`), not in
  the browser. Not needed for the local-model path.
- For the local models: a local [Ollama](https://ollama.com) server behind the proxy's `/api/ollama`
  route, see [Local models](#local-models-ministral-3-via-ollama).

## Download

**Latest release: [v0.5.5](https://github.com/mabaeyens/AnthropicExtension/releases/tag/v0.5.5)**.
Download `AnthropicExtension-v0.5.5.zip` from the
[releases page](https://github.com/mabaeyens/AnthropicExtension/releases). See
[`CHANGELOG.md`](./CHANGELOG.md) for what changed.

The proxy ships separately as **[proxy-v2.0.2](https://github.com/mabaeyens/AnthropicExtension/releases/tag/proxy-v2.0.2)**
(source under [`proxy/`](./proxy), notes in [`proxy/CHANGELOG.md`](./proxy/CHANGELOG.md)).

## Installation

You can either use the packaged release zip or copy the repository folder directly.

1. Get the extension into the Qlik Sense extensions directory:
   - **Enterprise (QSEoW)**: in the QMC → **Extensions → Import**, upload
     `AnthropicExtension-v0.5.5.zip`.
   - **Desktop**: unzip the release into
     `%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\` (or copy this repo
     folder there).
2. Reload Qlik Sense
3. The extension will appear in the assets panel as **"Anthropic AI Assistant"**

> **The proxy must be deployed first.** Deploy [`proxy/`](./proxy) (its `scripts/setup.ps1` automates
> Node check, deps, dev cert, `.env`, and the Windows service), then set the **Proxy URL** in the
> extension properties. Without a reachable, authenticated proxy the assistant cannot answer.

## Configuration

There is **no API-key field**: the key lives on the proxy. The following are exposed in the
extension's properties panel (no code editing required):

| Property | Default | Description |
|---|---|---|
| Default model | `claude-haiku-4-5` | The model each session **starts** with, switch any time with **Pick model** in the chat panel |
| Proxy URL | _(config default)_ | **Required for Claude models.** The hardened proxy's Anthropic route, e.g. `https://your-host:3000/api/anthropic`. **Blank disables Claude entirely**: the Claude models are hidden from this dropdown and from the chat panel's picker, and the object's settings say so |
| Local model URL | _(config default)_ | **Required for local models.** The proxy's Ollama route, see [Local models](#local-models-ministral-3-via-ollama). Blank disables the local models the same way |
| Log level | `DEBUG` | Browser-console verbosity: **ERROR / WARN / INFO / DEBUG**. Applied live. Lower it to quieten the console once past testing |

In the chat panel itself:

| Control | Where | Description |
|---|---|---|
| **Pick model** | next to *Submit* / *Suggest a chart* | Switch model mid-session. Changing it asks for confirmation and **clears the conversation**: history can't meaningfully cross models |
| **Stop** (v0.5.1) | replaces the submit row while generating | Aborts the answer immediately, keeping the text produced so far and marking the message as stopped. It halts **inference**, not just the UI, the proxy propagates the disconnect upstream (needs proxy ≥ 2.0.0) |
| **Stream the answer as it is generated** | Advanced Options | On by default. Turn it off to wait for the complete response instead |

Advanced defaults can still be tuned in `js/config.js`:

| Parameter | Default | Description |
|---|---|---|
| `API.PROXY_URL` | _(blank)_ | Proxy route for hosted (Anthropic) models, set by the Proxy URL property. **Blank = Claude switched off** and its models withheld from the pickers |
| `API.MODEL_DEFAULT` | `claude-haiku-4-5` | Model the session starts with, seeded from the Default model property. `API.MODEL_PICK` (null by default) holds an in-panel choice; the model in effect is `resolveActiveModel()` = pick or default, corrected for a backend that is off |
| `API.MODELS` | 5 entries | Model **registry**: `{ id, label, hint, local, tag }`. Drives both the properties dropdown and the in-panel picker, so they can't drift apart. Add a model here and it appears in both |
| `API.MAX_TOKENS` | `4000` | Maximum tokens in the response |
| `API.LOCAL.URL` | _(blank)_ | Proxy route for the local models (Ollama), set by the Local model URL property. **Blank = local models switched off** |
| `API.LOCAL.MODEL_TAG` | `ministral-3-demo` | Fallback Ollama model name, used only if a registry entry has no `tag` |
| `API.LOCAL.SYSTEM_SUFFIX` | brevity instruction | Appended to the system prompt **on local calls only** (v0.5.1), keeps Ministral answers to a few bullets/sentences, since a verbose answer at a few tokens/second runs for minutes. Hosted models are unaffected |
| `CHAT.STREAM` | `true` | Default for the streaming toggle |
| `DATA.MAX_ROWS` | `1000` | Maximum rows sent to the LLM (all data-collection bounds live in `DATA.*`, validated at init) |
| `LOG_LEVEL` | `DEBUG` | Console verbosity (ERROR/WARN/INFO/DEBUG); overridden by the Log level property |

## Proxy (required)

Every request goes through the hardened proxy in [`proxy/`](./proxy) (**v2.0.0**): there is no
direct-browser mode. The proxy:

- **Holds the Anthropic API key** server-side (`ANTHROPIC_API_KEY`) and strips any client key header,
  so the key is never in the browser.
- **Authenticates the caller** by validating the forwarded Qlik session before any upstream call.
- **Validates input** (per-route body schema + a server-side model allowlist + size caps), enforces
  **concurrency** limits with a bounded queue + graceful drain, and hardens transport (CORS allowlist,
  security headers, TLS floor, per-IP rate limit).
- Exposes `/health`, `/ready`, `/metrics`; writes structured logs (verbosity via `LOG_LEVEL`) plus a
  separate audit log; and can run as an auto-restart Windows service.
- Bridges the local-model path: `/api/ollama` forwards to a plain-HTTP Ollama server from the HTTPS
  Qlik page.
- **Propagates client cancellation:** when the browser disconnects (closed tab, or the extension's
  **Stop** button) the upstream call is cancelled so the model stops generating, the streaming path
  destroys the piped stream, the buffered path aborts the in-flight upstream call via an
  `AbortSignal` wired to the response `close`.

Deploy it with `proxy/scripts/setup.ps1` (automates Node check, `npm ci`, dev cert, `.env`, and the
service), then point the extension's **Proxy URL** / **Local model URL** at it. Full setup, config,
and operations are in [`proxy/README.md`](./proxy/README.md); release notes in
[`proxy/CHANGELOG.md`](./proxy/CHANGELOG.md).

> **Version pairing.** The proxy ships on its own cadence under `proxy-vX.Y.Z` tags. Extension
> **v0.5.5** requires **proxy v2.0.0 or later**: v2.0.0 makes Qlik-session auth mandatory, moves the
> Anthropic key server-side, and adds the cancel propagation that makes **Stop** actually halt
> inference.

> **Upgrading from a pre-2.0.0 proxy:** v2.0.0 is a breaking release. Every `/api/*` request must now
> present a valid Qlik session, so `QLIK_SESSION_URL`, `QLIK_CERT`, `QLIK_KEY`, and `QLIK_ORIGINS`
> must be set in `.env`, the proxy fails fast at boot without them. `ANTHROPIC_API_KEY` must be in
> the environment; any client-supplied key header is stripped. Note that `QLIK_SESSION_URL`'s host
> must match a SAN of the QPS certificate (QSEoW uses the **short hostname**, not the FQDN).

## Local models (Ministral 3 via Ollama)

As of **v0.3.4** the assistant can run against a **local model** instead of Claude, useful for
offline demos or when chart data must **not leave the machine**. Pick **Ministral 3 8B** or
**Ministral 3 3B** with **Pick model** in the chat panel; **no API key is required** for this path.

| Model | Ollama tag | Notes |
|---|---|---|
| Ministral 3 8B | `ministral-3-demo` | Better answers; ~6 GB resident |
| Ministral 3 3B | `ministral-3b-demo` | Roughly half the memory at comparable speed |

Because a QSEoW dashboard is served over **HTTPS**, the browser cannot call a plain-HTTP local Ollama
server directly (mixed-content blocking). Requests therefore go through the **proxy's**
`/api/ollama` route over HTTPS, which forwards to Ollama on the same machine:

```
Qlik (HTTPS) → https://localhost:3000/api/ollama  (proxy v2.0.0) → http://localhost:11434 (Ollama)
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

   # 3B, lighter
   ollama pull ministral-3:3b
   printf 'FROM ministral-3:3b\nPARAMETER num_ctx 8192\n' > Modelfile
   ollama create ministral-3b-demo -f Modelfile
   ```
2. Run the **[proxy](./proxy)** (it exposes the `/api/ollama` route and streams). Set `OLLAMA_URL` in
   its `.env` if Ollama isn't at the default `http://localhost:11434`, and `QLIK_ORIGINS` to the
   URL(s) you open the hub with, CORS compares them exactly, so `https://localhost` will reject a hub
   served from `https://myserver`.
3. **Trust the proxy's certificate.** Without it the browser blocks the extension's request as a
   status-less XHR failure, not a warning you can click through. On Windows, Chrome and Edge read
   the OS store: `certutil -user -addstore Root certs\localhost3000-cert.pem`, then restart the
   browser.
4. Set **Local model URL** = `https://localhost:3000/api/ollama` in the extension properties, and
   pick a Ministral model with **Pick model** in the chat panel.

**Notes**

- Each local model's Ollama tag lives in its `API.MODELS` registry entry (`tag`). The endpoint and
  timeout are in `API.LOCAL` (`URL`, `TIMEOUT` = 5 min), and the context guard in
  `API.CONTEXT_WINDOWS` (`8192`, keep this ≤ the model's baked `num_ctx`).
- As of **v0.5.1** a brevity instruction (`API.LOCAL.SYSTEM_SUFFIX`) is appended to the system prompt
  on local calls only, so Ministral answers in a few bullets/sentences instead of running for minutes
  at a few tokens/second. Hosted models are unchanged. The **Stop** button cancels a run outright.
- Local inference is **slower** than the hosted API, hence the 5-minute timeout. On a 4 GB laptop
  GPU (NVIDIA T1200) expect roughly **6–7 tok/s** for the 8B and **~18 tok/s** for the 3B. Neither
  fits entirely in 4 GB once a browser and Qlik are also using VRAM, so both run partly on the CPU,
  check with `ollama ps`, which reports the CPU/GPU split.
- Streaming makes the slower local path far more pleasant: tokens appear as they're generated
  instead of after a long silence.
- Ministral 3 (Ollama library) is licensed **Apache 2.0**. This path is demo-grade.

## Usage

1. Open a dashboard in Qlik Sense
2. Drag the **"Anthropic AI Assistant"** extension onto a sheet
3. Set the **Proxy URL** (and **Local model URL** for local models) in the properties panel to point
   at your deployed proxy, no API key is entered in the browser
4. Click **"Add Chart"**, choose a visualization and type your question
5. Optionally switch model with **Pick model**: the active one is shown under the submit row and in
   each answer's footer
6. Click **Stop** while an answer is generating to halt it and keep what has been produced so far

## Architecture & data flow

The request path (User → Qlik Sense → **external LLM** → back) is:

1. **Select**: clicking a chart is detected via its `qv-object-<id>` DOM class; `data-collector.js`
   resolves the real object id (engine-validated) and pulls the object's hypercube. For large tables
   it **pages the full hypercube** rather than a single initial page; `data-format.js` formats it for
   the model.
2. **Context (first use)**: `data-collector.getAppContextCached()` collects the **real data model**
   via `getTablesAndKeys` plus a field/dimension/measure session object (table names, full field list,
   master dimensions/measures with expressions) **once per session** and caches it.
3. **Assemble**: `ui-controller.js` builds `{ userPrompt, chartData, context, systemPrompt, history }`
   as a running conversation. Chart data is resent only when the selection changes; context only on
   the first turn. If the payload exceeds ~65 KB it **prompts the user to confirm** before sending.
4. **Send (data leaves on-prem)**: `anthropic-api.js` formats the message and POSTs through the
   single **proxy transport** (`buildTransport()`), forwarding the Qlik session credential
   (`credentials: 'include'`), no API key ever leaves the browser:
   - **Hosted:** `POST <Proxy URL>` (Anthropic Messages shape). The proxy authenticates the session,
     injects the key, and forwards to `api.anthropic.com`.
   - **Local model:** `POST <Local model URL>` in **OpenAI chat-completions** format; the proxy's
     `/api/ollama` route forwards to a local Ollama server. Data stays on the machine.
5. **Render**: with streaming on, `anthropic-api.streamToAnthropic()` reads the SSE response with
   `fetch` + `ReadableStream` and appends each delta as **plain text**; the Markdown is rendered and
   sanitized **once, when the stream ends** (`formatting.js` + bundled `marked.js`). Parsing Markdown
   per token flickers, costs a sanitize pass per chunk, and shows half-written syntax as noise, and
   inserting text rather than HTML means no markup is ever built from partial model output. An
   in-flight stream is aborted on **Stop**, *New chat*, or a model switch, and because the proxy
   propagates the disconnect upstream, the model stops generating too rather than finishing
   server-side. With streaming off (or where it isn't
   available) the buffered `$.ajax` path renders the whole reply at once. Each answer has a **Copy**
   button and a footer naming the model that produced it, pinned at send time.
6. **Create a chart (optional, write-back)**: "Suggest a chart" asks the model for a chart spec;
   `chart-builder.js` renders a **live preview** via the in-session Qlik visualization API and can
   **add it to the current sheet** (Edit mode), placing it below existing objects or offering a new
   sheet when the current one is full. This path writes to the live app **as the logged-in user**: no
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
├── package.json             # Dev-only: ESLint + node:test (NOT shipped; runtime stays AMD)
├── scripts/                 # Dev-only: pre-release-check.ps1
├── test/                    # Dev-only: node:test unit suites + AMD test harness
├── proxy/                   # The hardened proxy (in-tree; holds the key, authenticates the session)
├── docs/                    # security-model.md, concurrency-model.md
├── css/
│   └── style.css
├── html/
│   └── template.html        # Reference copy (panel markup is inlined in js/template.js)
└── js/
    ├── config.js            # Central configuration (single source of VERSION/BUILD, DATA bounds, LOG_LEVEL)
    ├── config-validate.js   # Boot config validation (proxy URL, model registry, numeric bounds)
    ├── main.js              # Extension initialization + properties panel + teardown
    ├── anthropic-api.js     # Proxy transport + context/message serialization (no key in the browser)
    ├── data-collector.js    # Data extraction (full hypercube) + real data-model context
    ├── data-format.js       # Data formatting for the LLM
    ├── ui-controller.js     # Panel UI, conversation thread, single-flight lifecycle, copy, warnings
    ├── chart-builder.js     # Parse chart spec → live preview / add to sheet (Qlik viz API)
    ├── formatting.js        # Markdown→HTML rendering (marked) + fail-closed DOMPurify sanitize
    ├── log.js               # Level-gated console logging (ERROR/WARN/INFO/DEBUG)
    ├── template.js          # Inlined panel markup (loaded with the bundle)
    └── lib/
        ├── dompurify.min.js # DOMPurify, bundled HTML sanitizer
        └── marked.min.js    # marked 12.x, bundled Markdown renderer
```

## Notes

- **Independent project.** Not a Qlik product, offering, or supported integration; support comes from
  the author via GitHub Issues, not Qlik support channels. **Neither Qlik nor the author accept any
  liability** for issues, data exposure, or costs in any environment, use at your own risk.
- **Data egress.** Asking a question sends chart data (the full table/hypercube), table/field names,
  and master-item definitions to an external LLM. Don't use it with sensitive/regulated/personal data
  unless that egress is permitted.
- Compatible with **client-managed Qlik Sense on Windows** (Desktop and Enterprise / QSEoW). Qlik
  Cloud is out of scope (it already has native AI assistants)
- **The API key is never in the browser.** It lives only on the proxy (`ANTHROPIC_API_KEY`), which
  injects it server-side and strips any client-supplied key header. The extension forwards the Qlik
  session so the proxy can authenticate the caller.
- Model, Proxy URL, Local model URL, and Log level are set in the extension properties panel; deeper
  defaults live in `js/config.js`. Dev tooling (`package.json`, `test/`, ESLint) is **not shipped**,
  the runtime stays plain AMD.

## Author

Created and maintained by **mabaeyens**. (Independent project, not a Qlik product, see the
no-warranty / no-liability notice above.)

## 🛠️ Development Workflow: Human-AI Collaboration

This project is the result of a strategic collaboration between human design and AI-assisted code generation.

- **Architecture & Logic:** Fully defined by the author. This includes system structure, business rules, data flow, and implementation strategy.
- **Code Generation:** The syntactic implementation and line-by-line code writing was performed by **Claude Code**, following precise and iterative instructions provided by the author.
- **Supervision & Refinement:** All code was manually reviewed, tested, and adjusted to ensure quality, consistency, and compliance with project standards.

This approach demonstrates the ability to direct advanced AI tools to accelerate development without sacrificing creative control or technical quality.

## 📄 License

This project is licensed under the **MIT License**. You can find the full text in the [`LICENSE`](./LICENSE) file.

> **No warranty / no liability.** Consistent with the MIT License, this project is provided
> "AS IS", without warranty of any kind. **Neither Qlik nor the author is liable** for any claim,
> damage, data exposure, or cost arising from its use, including in customer or production
> environments. It is **not** a Qlik product or supported integration.

> **Note on authorship:** Although much of the source code was generated by an AI, the creative direction, architecture, and final integration are human work. Usage rights are granted under the terms of the MIT License.

## 🚀 Contributing

Feel free to fork this project!
- If you find a bug, open an issue.
- If you have an improvement, submit a Pull Request.
- Feel free to use this code in your own projects!
