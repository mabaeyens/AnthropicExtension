# Install & Run — Anthropic AI Assistant (v0.5.0)

> ⚠️ **Demo only — no warranty, no liability.** This is a demonstration asset, **not** a Qlik product.
> **Neither Qlik nor the author accept any liability** for any issue, data exposure, cost, or damage in
> any customer or production environment. **Use at your own risk.**
>
> **Data leaves your environment.** Asking a question sends Qlik data — the **full** selected
> chart/table (complete hypercube), the app's **table and field names**, and **master
> dimension/measure definitions** — out of your on-prem Qlik Sense environment, **through the proxy**,
> to an external LLM (`api.anthropic.com` by default). The API key is held on the **proxy**
> (server-side), never in the browser. **Do not use with sensitive, regulated, or personal data**
> unless that egress is permitted.

This package contains the Qlik Sense visualization extension. As of v0.5.0 it is **proxy-only**: you
must **deploy the proxy** (which holds the API key and authenticates the Qlik session) and point the
extension at it — there is no direct-browser mode and no API key is entered in the browser.

> ### Prerequisite: deploy the proxy
> Deploy [`proxy/`](./proxy) on a reachable host (typically the Qlik node). Its
> `scripts/setup.ps1` automates the install (Node check, `npm ci`, dev TLS cert, `.env`, and the
> Windows service). Set at least `ANTHROPIC_API_KEY`, `QLIK_SESSION_URL`, the Qlik client certs, and
> `QLIK_ORIGINS` in its `.env`. Full instructions: [`proxy/README.md`](./proxy/README.md).

---

## 1. Deploy the extension

### Qlik Sense Desktop (Windows)
Unzip this package into:

```
%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\
```

so that `AnthropicExtension.qext` sits directly inside the `AnthropicExtension` folder. Restart /
reload Qlik Sense Desktop.

### Qlik Sense Enterprise on Windows (client-managed / QSEoW)
1. In the **QMC**, go to **Extensions → Import** and upload this `.zip`.
2. Make sure the **proxy is deployed and reachable** (see the prerequisite above), then set the
   **Proxy URL** in the extension properties — see §4.

> **Qlik Cloud is out of scope.** This extension targets client-managed Qlik Sense on Windows. Qlik
> Cloud already provides native AI assistants, so Cloud support is not planned.

---

## 2. Add it to a sheet
1. Open an app and edit a sheet.
2. From the **Custom objects** panel, drag **“Anthropic AI Assistant”** onto the sheet.

## 3. Configure & use (end user)
1. In the extension's **properties panel**, set the **Proxy URL** (e.g.
   `https://your-host:3000/api/anthropic`) and, for local models, the **Local model URL**. There is
   **no API key field** — the key lives on the proxy. Optionally set the **Log level**.
2. In the floating panel, click **Add Chart**, click one or more charts on the sheet, type a question,
   and **Submit**. The answer **streams in as it is generated**; replies appear in a **Markdown chat
   thread** with memory (newest on top). Use **New chat** to reset and the **Copy** button to copy a
   response. Streaming can be turned off under **Advanced Options**.
3. Use **Pick model** (next to *Submit*) to switch model at any time: Haiku 4.5 = fast/cheap,
   Sonnet 4.6 = balanced, Opus 4.8 = most capable, or a local Ministral. Switching **clears the
   conversation** and asks you to confirm first. The model that answered is named in each reply's
   footer.
4. Optionally click **Suggest a chart** — the model proposes a chart and the panel renders a live
   preview. With the sheet open in **Edit mode**, **Add to sheet** places it below existing objects (or
   offers a new sheet when the current one is full).

The first request also sends the app's **real data model** — table and field names plus master
dimension/measure definitions — so Claude understands the data. For large tables the **entire**
hypercube is retrieved; if the data to be sent exceeds ~65 KB the panel **asks you to confirm** first.

---

## 4. The proxy (required)
The extension talks **only** to the proxy — there is no direct-browser mode. Set the **Proxy URL** in
the extension properties (e.g. `https://your-host:3000/api/anthropic`) to your deployed
[`proxy/`](./proxy). The proxy holds the `ANTHROPIC_API_KEY` server-side, authenticates the caller's
Qlik session, validates input, and enforces concurrency/rate limits. Deploy and configure it with
`proxy/scripts/setup.ps1` — see [`proxy/README.md`](./proxy/README.md). For local models, also set the
**Local model URL** to the proxy's `/api/ollama` route.

---

## How it works
For the end-to-end data flow (User → Qlik Sense → proxy → Anthropic → back), authentication, and where
the key lives, see [`diagrams.md`](./diagrams.md).

## Troubleshooting
- **No response / network error:** the **Proxy URL** is wrong or the proxy is unreachable — check the
  proxy is running (`https://<host>:3000/health`) and its cert is trusted by the browser.
- **401 Unauthenticated from the proxy:** the Qlik session couldn't be validated — confirm the
  proxy's `QLIK_SESSION_URL` + client certs, and that the browser reaches the proxy through the Qlik
  site so the session cookie is sent.
- **403 Model not allowed:** the selected model isn't on the proxy's allowlist (`ALLOWED_*_MODELS`).
- **503 "busy, try again":** the proxy's concurrency queue is full — retry shortly.
- **"Add to sheet" does nothing / shows an edit-mode hint:** open the sheet in **Edit mode** first;
  chart creation writes to the live app and is only allowed while editing.
- **Large-data warning before sending:** the selected table exceeds ~65 KB. Apply selections to filter
  the data, or confirm to send it anyway (higher token cost / slower). A payload over the proxy's body
  limit (~1 MB) is stopped client-side.
- **Maps:** map visualizations are not yet supported for selection or chart creation.
- **Verbose logs:** set the **Log level** property (or `LOG_LEVEL` in `js/config.js`) to `DEBUG`;
  lower to `ERROR`/`WARN` to quieten the console. The proxy has its own `LOG_LEVEL` in `.env`.
