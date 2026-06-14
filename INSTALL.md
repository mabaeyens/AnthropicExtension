# Install & Run — Anthropic AI Assistant (v0.3.1)

> ⚠️ **Demo only — no warranty, no liability.** This is a demonstration asset, **not** a Qlik product
> and **not** production-hardened. **Neither Qlik nor the author accept any liability** for any issue,
> data exposure, cost, or damage in any customer or production environment. **Use at your own risk.**
>
> **Data leaves your environment.** Asking a question sends Qlik data — the **full** selected
> chart/table (complete hypercube), the app's **table and field names**, and **master
> dimension/measure definitions** — out of your on-prem Qlik Sense environment to an external LLM
> (`api.anthropic.com` by default, or whatever your proxy targets). The API key is only **obfuscated**
> in `localStorage`. **Do not use with sensitive, regulated, or personal data** unless that egress is
> permitted.

This package contains the full Qlik Sense visualization extension. End users configure **only an API
key** — everything else has a sensible default.

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
2. The default direct browser call to `api.anthropic.com` normally works on QSEoW as-is. If your
   environment blocks the outbound call, use the optional **Proxy URL** instead — see §4.

> **Qlik Cloud is out of scope.** This extension targets client-managed Qlik Sense on Windows. Qlik
> Cloud already provides native AI assistants, so Cloud support is not planned.

---

## 2. Add it to a sheet
1. Open an app and edit a sheet.
2. From the **Custom objects** panel, drag **“Anthropic AI Assistant”** onto the sheet.

## 3. Configure & use (end user)
1. In the extension's **properties panel**, paste your **Anthropic API key**.
   (Optionally pick a **Model**: Haiku 4.5 = fast/cheap, Sonnet 4.6 = balanced, Opus 4.8 = most capable.)
2. In the floating panel, click **Add Chart**, click one or more charts on the sheet, type a question,
   and **Submit**. Replies appear in a **Markdown chat thread** with memory (newest on top); use
   **New chat** to reset and the **Copy** button to copy a response.
3. Optionally click **Suggest a chart** — Claude proposes a chart and the panel renders a live
   preview. With the sheet open in **Edit mode**, **Add to sheet** places it below existing objects (or
   offers a new sheet when the current one is full).

The first request also sends the app's **real data model** — table and field names plus master
dimension/measure definitions — so Claude understands the data. For large tables the **entire**
hypercube is retrieved; if the data to be sent exceeds ~65 KB the panel **asks you to confirm** first.

---

## 4. Optional: use a local proxy instead of direct calls
If your organization prefers to keep the API key off the browser, set a **Proxy URL** in the
extension properties (e.g. `https://localhost:3000/api/anthropic`) and run a proxy such as
[cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy) that forwards POSTs (with the `x-api-key`
header) to `https://api.anthropic.com/v1/messages`. The proxy must be reachable from the browser.

---

## How it works
For the end-to-end data flow (User → Qlik Sense → Anthropic → back), transport selection (direct vs
proxy), and key storage, see [`diagrams.md`](./diagrams.md).

## Troubleshooting
- **No response / network error in direct mode:** the browser's outbound call to `api.anthropic.com`
  is being blocked by your environment — set a **Proxy URL** (§4) and route through a local proxy.
- **“API key not found”:** enter the key in the properties panel; it is stored (encrypted) in the
  browser's `localStorage` and reused across apps.
- **401 / 403 from Anthropic:** the API key is invalid or lacks access to the selected model.
- **Model errors:** pick a different model in the properties dropdown.
- **"Add to sheet" does nothing / shows an edit-mode hint:** open the sheet in **Edit mode** first;
  chart creation writes to the live app and is only allowed while editing.
- **Large-data warning before sending:** the selected table exceeds ~65 KB. Apply selections to filter
  the data, or confirm to send it anyway (higher token cost / slower).
- **Maps:** map visualizations are not yet supported for selection or chart creation.
- **Verbose logs:** set `DEBUG_MODE: true` in `js/config.js` (off by default).
