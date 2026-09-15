# Troubleshooting

Practical checks for the Anthropic AI Assistant extension, written so you can paste them
straight into a browser console, or hand this file to an AI assistant and let it run them
and read the output back to you.

**How to open the console:** on the Qlik sheet, press `F12` → **Console** tab. Paste a
snippet, press Enter. If the console refuses to accept pasted text, type `allow pasting`
first (Firefox/Chrome ask for this once).

**Adjust the module path if needed.** The snippets load extension modules from
`extensions/AnthropicExtension/js/...`, which is correct for a standard QSEoW install of
this extension. If you renamed the extension folder, change that prefix to match.

**Quietening the console first:** set **Log level** to `Error` in *Edit object → Settings*
while diagnosing, or the extension's own DEBUG output will bury the answers.

---

## 1. The model changes by itself when I switch sheets

**Almost always: a second AI Assistant object exists somewhere in the app.**

All objects of this extension in an app share one configuration in the browser, but the
**properties are per object**. A second object, even one on a sheet you never look at, even one
whose settings you never touched, paints its own defaults over the shared
configuration when its sheet is rendered. Its untouched **Default model** (Haiku) and blank
URLs then replace yours. As of **v0.5.4** the configured object wins regardless, and the
extra object is ignored with a console warning, but it is still worth finding and deleting.

### Find every AI Assistant object in the app

```js
require(['qlik'], function (q) {
  var app = q.currApp(), found = 0;
  app.getList('sheet', function (list) {
    list.qAppObjectList.qItems.forEach(function (s) {
      app.getObjectProperties(s.qInfo.qId).then(function (sheet) {
        var cells = (sheet.properties && sheet.properties.cells) ||
                    (sheet.layout && sheet.layout.cells) || [];
        cells.forEach(function (cell) {
          app.getObjectProperties(cell.name).then(function (o) {
            var viz = (o.properties && o.properties.visualization) || '';
            if (!/anthropic/i.test(viz)) return;
            found++;
            console.log('AI Assistant already installed on sheet "' + s.qMeta.title +
              '", object ' + cell.name + ', settings: ' +
              JSON.stringify(o.properties.props || {}));
          });
        });
      });
    });
  });
  setTimeout(function () {
    console.log('=== ' + found + ' AI Assistant object(s) found. Exactly one should be ' +
      'configured; delete the extras. ===');
  }, 3000);
});
```

**Reading the output:** one line per object, naming the sheet and the object ID. An object
whose settings print as `{"model":"claude-haiku-4-5"}`, with no `proxyUrl` and no `localUrl`, is
an unconfigured stray. Delete it, or configure it identically to the real one.

**To delete it:** open the named sheet, enter **Edit sheet**, select the AI Assistant
object, delete, and save.

### See what the shared configuration currently holds

Run this on the sheet where things look right, then again where they look wrong. It prints
one line and copies it to your clipboard.

```js
require(['extensions/AnthropicExtension/js/config',
         'extensions/AnthropicExtension/js/anthropic-api'], function (c, a) {
  c.__p = c.__p || Math.random().toString(36).slice(2);
  var s = JSON.stringify({ instance: c.__p, build: c.BUILD,
    def: c.API.MODEL_DEFAULT, pick: c.API.MODEL_PICK, resolved: a.resolveActiveModel(),
    proxy: c.API.PROXY_URL, local: c.API.LOCAL.URL });
  console.log('[AI] ' + s); copy(s);
});
```

| Field | Meaning |
|---|---|
| `instance` | Identifies the loaded module set. **Same value on both sheets** ⇒ the modules were not reloaded, so anything that changed was changed by code, normally another object's `paint()` |
| `def` | The **Default model** property of whichever object owns the configuration |
| `pick` | The in-panel **Pick model** choice; `null` means "follow the property" |
| `resolved` | The model actually in effect: `pick` or `def`, substituted if that model's backend is switched off |
| `proxy` / `local` | The two endpoints in effect. Blank means that backend is **switched off**, and its models are hidden from the picker |

If `def` changes between sheets, a second object overwrote it. Run the enumeration above.

---

## 2. "Configuration problem, No endpoint configured"

The banner means both **Proxy URL** and **Local model URL** are blank in the configuration
currently in effect. Since v0.5.4 it re-evaluates on every paint and clears itself as soon
as one is valid; if it persists:

- Check the object's settings actually contain the URL (*Edit object → Settings*).
- Run the config probe (§1). If `proxy` and `local` are both `""`, another object owns the
  configuration. Enumerate objects as above.
- On **v0.5.3 and earlier** the banner was validated once at startup and could never clear.
  Upgrade.

---

## 3. "NetworkError when attempting to fetch resource" (or "Failed to fetch")

The browser could not reach the proxy at all. In order of likelihood:

**The proxy isn't running.** From the proxy machine:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
Invoke-WebRequest https://localhost:3000/health -SkipCertificateCheck
```

Expect `{"status":"up"}`. If not, start it: `cd proxy; npm start` (it refuses to start
without a real `ANTHROPIC_API_KEY` in `.env`, even when only the Ollama route is used).

**The certificate isn't trusted by *this* browser.** A self-signed cert must be accepted
once per origin, and a failed TLS handshake on a preflight surfaces as exactly this
NetworkError. Visit `https://<proxy-host>:3000/health` in the same browser and accept the
warning (Firefox: **Advanced… → Accept the Risk and Continue**). Exceptions are per origin:
`localhost:3000` and `myhost:3000` each need their own.

> If Firefox instead shows **`MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY`** with no "Accept the Risk" option at all, that's not a trust problem, the cert itself is malformed: its `basicConstraints` extension is `CA:TRUE`, which Firefox's strict validator refuses to use as a server cert (Chrome/Windows tolerate it, which is why this only shows up in Firefox). Regenerate it per `proxy/README.md` → Certificates, with `basicConstraints=critical,CA:FALSE` explicitly set, accepting a warning can't fix this, the cert has to be reissued.
>
> Also note Firefox keeps its **own certificate store**, separate from Windows, trusting the cert via `certutil` (below) doesn't reach Firefox unless you also import it directly into Firefox or enable `security.enterprise_roots.enabled` in `about:config` (see `proxy/README.md` → Certificates).

> If the proxy shares a **hostname** with the Qlik hub (e.g. both reached as `myhost`, just a different port), you won't get a click-through warning at all, Chrome/Edge instead refuse outright with *"You cannot visit `myhost` right now because the website uses HSTS."* This happens because the Qlik hub (port 443) already sent a `Strict-Transport-Security` header for that bare hostname, and HSTS is enforced per hostname regardless of port, with no bypass. The only fix is to actually trust the cert in the OS store first (`proxy/README.md` → Certificates), not click through it:
> ```powershell
> certutil -user -addstore Root proxy\certs\localhost3000-cert.pem
> ```
> then fully close and reopen the browser (not just the tab, HSTS/cert state is cached per process).

**You used `localhost` from a remote browser.** `https://localhost:3000` resolves to the
*browser's* machine. Use the proxy host's name.

**Wrong host for the session cookie.** The proxy authenticates you with the Qlik session
cookie, which the browser only sends to the **Qlik host name**. Use
`https://<qlik-host>:3000/api/...`, not `localhost`, or every call returns 401. Ports are
irrelevant to cookie scope, so the same host on port 3000 is fine.

**The origin isn't allowlisted.** The proxy's `QLIK_ORIGINS` must contain the exact origin
of the Qlik page (e.g. `https://myhost`, no trailing slash). A denied origin gets no CORS
headers, which the browser reports as a NetworkError rather than an HTTP error.

---

## 4. Errors that came back from the proxy

| Status | Meaning | Fix |
|---|---|---|
| **401 / 403 Unauthorized** | The proxy could not validate your Qlik session | Reach the proxy on the **Qlik host name** so the session cookie is sent (§3); check `QLIK_SESSION_URL` and the client certs in the proxy's `.env` |
| **403 Model not allowed** | The model isn't on the proxy's allowlist | Add it to `ALLOWED_ANTHROPIC_MODELS` / `ALLOWED_OLLAMA_MODELS` |
| **413 Request body too large** | Chart data exceeds the proxy's `BODY_LIMIT` (1 MB) | Filter with selections, or select fewer charts |
| **429 / 503** | Rate limit or concurrency queue | Retry; tune `RATE_LIMIT_MAX`, `MAX_USER_INFLIGHT` |
| **502 Upstream request failed** | The proxy reached the route but the backend failed | For Claude: a real `ANTHROPIC_API_KEY`. For local: is Ollama running? `Invoke-WebRequest http://localhost:11434/api/tags` |

Every proxy response carries a `requestId`; grep the proxy log for it to see the server side.

---

## 5. A model is missing from the picker

By design: a model whose backend has no URL is withheld.

- **Claude models missing** → **Proxy URL** is blank. That is how you run local-only.
- **Ministral models missing** → **Local model URL** is blank.
- **Both blank** → all models are listed as a fail-safe, and every request fails with
  "not configured".

The object's **Settings** panel states which backend is off. The chat panel deliberately
says nothing, it only lists what works.

---

## 6. The local (Ministral) model is very slow, or never answers

- First call after a cold start loads the model into memory (~20 s), then generates at a
  few tokens/second on a small GPU. The client timeout for local calls is 5 minutes.
- Check the model tag exists: `ollama list` must show `ministral-3b-demo` or
  `ministral-3-demo` (the derived tags with `num_ctx 8192`, see README).
- Use **Stop** to abort; it really halts inference (the proxy propagates the disconnect).
- Ministral 3 3B is roughly half the memory of the 8B at similar speed.

---

## 7. Am I even running the build I think I am?

The panel footer shows `vX.Y.Z · build N`. Qlik and the browser both cache extension files
aggressively. After re-importing in the QMC, hard-reload the sheet (`Ctrl`+`Shift`+`R`).
If the footer still shows the old build, clear the cache or use a private window.

The console probe in §1 prints `build` too, which is the reliable check when you are unsure
whether a fix is actually loaded.

---

## 8. Nothing above matches

Collect this before asking for help:

1. Panel footer version + build.
2. Output of both snippets in §1 (object enumeration, config probe).
3. The browser console with **Log level** set to `Debug`, filtered to `[AI]`/`[DEBUG]`.
4. The proxy log around the same moment (`LOG_DIR` in its `.env`, else stdout), including
   the `requestId` from the failed response.

Then open an issue with that information at
[github.com/mabaeyens/AnthropicExtension/issues](https://github.com/mabaeyens/AnthropicExtension/issues).
