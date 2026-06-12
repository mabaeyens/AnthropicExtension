# Data Flow & Diagrams

How a question travels **User → Qlik Sense → Anthropic → back**, for the Anthropic AI Assistant
extension (v0.2.0). Diagrams use [Mermaid](https://mermaid.js.org/) and render automatically on
GitHub.

> ⚠️ Experimental / demo. In the default (direct) mode the API key is sent from the browser to
> `api.anthropic.com` and is only obfuscated in `localStorage`.

---

## 1. High-level data flow

Everything except the Anthropic API runs **in the browser** (the Qlik Sense client). The extension
talks to the Qlik engine for chart data and to Anthropic for the analysis.

```mermaid
flowchart LR
  U["User"]

  subgraph Browser["Browser — Qlik Sense client"]
    QS["Qlik Sense engine<br/>hypercube · field list · master items"]
    subgraph EXT["Anthropic AI Assistant extension"]
      UIC["ui-controller.js"]
      DC["data-collector.js"]
      DF["data-format.js"]
      API["anthropic-api.js"]
      SEC["security.js<br/>CryptoJS AES"]
      LS[("localStorage<br/>encrypted key")]
    end
  end

  ANT["api.anthropic.com<br/>/v1/messages"]
  PX["Local proxy<br/>(optional)"]

  U -->|"select chart + ask question"| UIC
  UIC --> DC
  DC <-->|"hypercube + app context"| QS
  UIC --> DF
  UIC --> API
  API --> SEC
  SEC <--> LS
  API -->|"default: direct POST"| ANT
  API -.->|"if Proxy URL set"| PX
  PX --> ANT
  ANT -->|"analysis (JSON)"| API
  API -->|"formatted text"| UIC
  UIC -->|"renders answer"| U
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
  User->>UI: Click "Select Chart", then click a chart
  UI->>DC: getObjectData(objectId)
  DC->>QS: get visualization layout (hypercube)
  QS-->>DC: dimensions, measures, rows
  DC-->>UI: chartData (token-optimized)

  Note over User,ANT: Ask a question
  User->>UI: Type question + Submit
  UI->>DC: getAppContextCached()
  Note right of DC: Collected once per session, then cached
  DC->>QS: FieldList() + master items (first time only)
  QS-->>DC: fields + master items
  DC-->>UI: appContext

  UI->>API: sendToAnthropic({ userPrompt, chartData, context, systemPrompt })
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
  UI->>UI: format markdown (formatting.js)
  UI-->>User: Rendered analysis
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

> **Enterprise note:** the direct path needs a one-time QMC **Content Security Policy** entry
> allowing `api.anthropic.com` on `connect-src`. The proxy path does not, but the proxy must be
> reachable from the browser.

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

## Module reference

| Module | Role in the flow |
|---|---|
| `main.js` | Entry; applies Model/Proxy-URL properties to `config`; one-time init (paint guard) |
| `ui-controller.js` | Panel UI, chart selection, submit, assembles the request, renders the reply |
| `data-collector.js` | Extracts the selected chart's hypercube; caches the app context (`getAppContextCached`) |
| `data-format.js` | Formats/trims chart data for the LLM (token budget) |
| `anthropic-api.js` | Builds the message, selects transport (`buildTransport`), POSTs to Anthropic/proxy |
| `security.js` | Encrypts/decrypts the API key (CryptoJS AES, shared key) |
| `config.js` | Model, endpoint, version, proxy URL, system prompt, optimization defaults |
| `template.js` | Inlined panel markup |
| `formatting.js` | Markdown/HTML formatting of the response and status messages |
