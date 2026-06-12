# Install & Run — Anthropic AI Assistant (v0.2.0)

> ⚠️ **Experimental / demo only.** Not for production. In the default mode your Anthropic API key is
> sent from the browser directly to `api.anthropic.com`, and it is only obfuscated in `localStorage`.

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

### Qlik Sense Enterprise on Windows (client-managed)
1. In the **QMC**, go to **Extensions → Import** and upload this `.zip`.
2. **(Direct mode only)** In the QMC, open **Content Security Policy** and add an origin entry that
   allows `api.anthropic.com` on the **`connect-src`** directive, then restart the engine/proxy
   service. This is a one-time administrator step. *(Skip this if you will use the optional Proxy
   URL instead — see §4.)*

---

## 2. Add it to a sheet
1. Open an app and edit a sheet.
2. From the **Custom objects** panel, drag **“Anthropic AI Assistant”** onto the sheet.

## 3. Configure (end user)
1. In the extension's **properties panel**, paste your **Anthropic API key**.
   (Optionally pick a **Model**: Haiku 4.5 = fast/cheap, Sonnet 4.6 = balanced, Opus 4.8 = most capable.)
2. In the panel, click **Select Chart**, click any chart on the sheet, type a question, and **Submit**.

The first request also sends the app's field names and master items so Claude understands the data
model.

---

## 4. Optional: use a local proxy instead of direct calls
If your organization prefers to keep the API key off the browser, set a **Proxy URL** in the
extension properties (e.g. `https://localhost:3000/api/anthropic`) and run a proxy such as
[cm-llm-proxy](https://github.com/mabaeyens/cm-llm-proxy) that forwards POSTs (with the `x-api-key`
header) to `https://api.anthropic.com/v1/messages`. When a Proxy URL is set, the CSP step in §1 is
not required (but the proxy must be reachable from the browser).

---

## How it works
For the end-to-end data flow (User → Qlik Sense → Anthropic → back), transport selection (direct vs
proxy), and key storage, see [`diagrams.md`](./diagrams.md).

## Troubleshooting
- **No response / network error in direct mode (Enterprise):** the CSP `connect-src` entry for
  `api.anthropic.com` is missing — see §1, step 2.
- **“API key not found”:** enter the key in the properties panel; it is stored (encrypted) in the
  browser's `localStorage` and reused across apps.
- **401 / 403 from Anthropic:** the API key is invalid or lacks access to the selected model.
- **Model errors:** pick a different model in the properties dropdown.
- **Verbose logs:** set `DEBUG_MODE: true` in `js/config.js` (off by default).
