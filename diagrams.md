# Data Flow & Diagrams

How a question travels **User → Qlik Sense → external LLM → back**, and how a suggested chart is
created, for the Anthropic AI Assistant extension (v0.3.3). Diagrams use
[Mermaid](https://mermaid.js.org/) and render automatically on GitHub.

> ⚠️ **Demo only — no warranty, no liability.** Not a Qlik product or supported integration. **Neither
> Qlik nor the author accept any liability** for use in any environment.
>
> **Data egress:** asking a question sends the **full** selected chart/table (complete hypercube), the
> app's **table and field names**, and **master dimension/measure definitions** out of the on-prem
> Qlik Sense environment to an external LLM. In the default (direct) mode this goes from the browser to
> `api.anthropic.com`; the API key is only obfuscated in `localStorage`. The **chart-creation** step
> (§5) writes back to the live Qlik app locally as the logged-in user and does **not** involve the LLM.

---

## 1. High-level data flow

The extension runs **in the browser** (the Qlik Sense client) and talks to the Qlik engine for chart
data. For analysis, Qlik data **leaves the on-prem environment** and crosses the trust boundary to an
**external LLM**. The chart-*creation* step (§5) stays local — it writes back to the Qlik app.

```mermaid
flowchart LR
  U["User"]

  subgraph OnPrem["On-prem / your environment (browser — Qlik Sense client)"]
    QS["Qlik Sense engine<br/>full hypercube · tables · fields · master items"]
    subgraph EXT["Anthropic AI Assistant extension"]
      UIC["ui-controller.js<br/>conversation · ~65 KB warning"]
      DC["data-collector.js"]
      DF["data-format.js"]
      CB["chart-builder.js"]
      API["anthropic-api.js"]
      SEC["security.js<br/>CryptoJS AES"]
      LS[("localStorage<br/>obfuscated key")]
    end
  end

  ANT["External LLM<br/>api.anthropic.com /v1/messages"]
  PX["Local proxy<br/>(optional)"]

  U -->|"select chart(s) + ask question"| UIC
  UIC --> DC
  DC <-->|"full hypercube + data model"| QS
  UIC --> DF
  UIC --> API
  API --> SEC
  SEC <--> LS
  API ==>|"DATA LEAVES ON-PREM:<br/>chart data + table/field names + master items"| ANT
  API -.->|"if Proxy URL set"| PX
  PX ==> ANT
  ANT -->|"analysis (JSON)"| API
  API -->|"Markdown answer"| UIC
  UIC -->|"renders chat thread"| U

  UIC -. "Suggest a chart" .-> CB
  CB ==>|"create object / add to sheet<br/>(local, as logged-in user)"| QS
```

---

## 2. Request lifecycle (sequence)

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Extension panel (ui-controller.js)
  participant DC as data-collector.js
  participant QS as Qlik Sense engine
  participant SEC as security.js
  participant API as anthropic-api.js
  participant PX as Local proxy (optional)
  participant ANT as Anthropic API

  Note over User,SEC: One-time setup
  User->>UI: Enter API key (properties panel)
  UI->>SEC: storeAPIKey(key)
  SEC->>SEC: AES encrypt (CryptoJS)
  SEC-->>UI: saved to localStorage (shared key)

  Note over User,QS: Select a chart
  User->>UI: Click "Add Chart", then click a chart
  UI->>DC: getObjectData(objectId)
  DC->>QS: get layout, then page the full hypercube (all rows)
  QS-->>DC: dimensions, measures, all rows
  DC-->>UI: chartData (complete result set)

  Note over User,ANT: Ask a question (data leaves on-prem)
  User->>UI: Type question + Submit
  UI->>DC: getAppContextCached()
  Note right of DC: Collected once per session, then cached
  DC->>QS: getTablesAndKeys + field/dimension/measure session object (first time only)
  QS-->>DC: real tables, fields, master items (with expressions)
  DC-->>UI: appContext

  UI->>UI: if payload over ~65 KB, confirm() with the user
  UI->>API: sendToAnthropic({ userPrompt, chartData, context, systemPrompt, history })
  API->>SEC: getAPIKey()
  SEC-->>API: decrypted key
  API->>API: buildMessageContent() + buildTransport()

  alt Proxy URL blank (default — direct)
    API->>ANT: POST /v1/messages (x-api-key, anthropic-version, direct-browser-access)
  else Proxy URL set
    API->>PX: POST [Proxy URL] (x-api-key)
    PX->>ANT: forward POST /v1/messages
    ANT-->>PX: completion
    PX-->>API: completion
  end
  ANT-->>API: completion (content[0].text)

  API-->>UI: response + token metrics
  UI->>UI: render Markdown (formatting.js + marked.js), append to thread
  UI-->>User: Rendered analysis (with Copy button)
```

---

## 3. Transport decision (direct vs proxy)

`anthropic-api.js → buildTransport()` chooses the endpoint and headers per request based on
`config.API.PROXY_URL` (set from the **Proxy URL** property in `main.js:paint()`).

```mermaid
flowchart TD
  S["buildTransport(apiKey)"] --> Q{"config.API.PROXY_URL set?"}
  Q -->|"No (default)"| D["url = config.API.URL<br/>(api.anthropic.com/v1/messages)<br/><br/>headers:<br/>• Content-Type<br/>• x-api-key<br/>• anthropic-version<br/>• anthropic-dangerous-direct-browser-access"]
  Q -->|"Yes"| P["url = Proxy URL<br/><br/>headers:<br/>• Content-Type<br/>• x-api-key<br/>(proxy adds anthropic-version)"]
  D --> R["jQuery $.ajax POST"]
  P --> R
  R --> A["Anthropic API"]
```

> **QSEoW note:** on client-managed Qlik Sense on Windows the direct path normally works as-is. If the
> environment blocks the outbound browser call, set a **Proxy URL** and route through a local proxy
> (which must be reachable from the browser). Qlik Cloud is out of scope.

---

## 4. API key storage

The key is entered once and reused across all Qlik apps. It is encrypted before storage and
decrypted only when building a request.

```mermaid
flowchart LR
  K["API key (plaintext, from properties panel)"]
  K -->|"security.storeAPIKey()"| E["CryptoJS.AES.encrypt(key, passphrase)"]
  E --> LS[("localStorage['anthropic_api_key']<br/>ciphertext")]
  LS -->|"security.getAPIKey()"| DEC["CryptoJS.AES.decrypt(...).toString(enc.Utf8)"]
  DEC --> H["used as x-api-key header"]
```

> The AES passphrase is bundled in the extension, so this is **obfuscation, not strong secrecy** —
> appropriate for on-prem internal demos only.

---

## 5. Chart creation (local write-back — no LLM)

"Suggest a chart" asks the model for a chart **spec** (the only LLM step). Building and placing the
chart happens **entirely in the browser** against the in-session Qlik engine, as the logged-in user —
no data is sent externally in this step. Writing to a sheet requires **Edit mode**.

```mermaid
flowchart TD
  R["LLM response<br/>(fenced qlik-chart JSON)"] --> P["chart-builder.parseChartSpec()<br/>structural validation"]
  P -->|"valid spec"| V["app.visualization.create(type, columns)<br/>live preview in the panel"]
  P -.->|"no valid spec"| T["fall back to Markdown text"]
  V --> ADD{"Add to sheet?<br/>(Edit mode required)"}
  ADD -->|"room on sheet"| PLACE["createChild + setProperties<br/>place below existing objects · doSave"]
  ADD -->|"sheet is full"| NEW["create a new sheet with the chart · gotoSheet"]
  ADD -->|"not in Edit mode"| HINT["show 'open in Edit mode' hint"]
  PLACE --> QS["Qlik app (persisted)"]
  NEW --> QS
```

---

## Module reference

| Module | Role in the flow |
|---|---|
| `main.js` | Entry; applies Model/Proxy-URL properties to `config`; one-time init (paint guard) |
| `ui-controller.js` | Panel UI, conversation thread + memory, chart selection, copy, ~65 KB warning, assembles the request |
| `data-collector.js` | Extracts the selected chart's **full hypercube**; collects the **real data model** (`getTablesAndKeys` + session lists) and caches it (`getAppContextCached`) |
| `data-format.js` | Formats/trims chart data for the LLM |
| `anthropic-api.js` | Builds the message + serializes the data-model context, selects transport (`buildTransport`), POSTs to the LLM/proxy |
| `chart-builder.js` | Parses the chart spec, renders a live preview, and adds the chart to the sheet (Qlik viz/engine API; Edit-mode write-back) |
| `security.js` | Encrypts/decrypts the API key (CryptoJS AES, shared key) |
| `config.js` | Model, endpoint, version, proxy URL, system prompt, optimization defaults |
| `template.js` | Inlined panel markup |
| `formatting.js` | Markdown→HTML rendering of responses (bundled `marked.js`) and status messages |
