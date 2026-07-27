# Install and run

Extension v0.5.4, proxy v2.0.0. Client-managed Qlik Sense on Windows (Desktop or Enterprise).

> **Demo only, no warranty, no liability.** This is a demonstration asset, not a Qlik product.
> Neither Qlik nor the author accept any liability for any issue, data exposure, cost or damage in
> any customer or production environment. Use it at your own risk.
>
> **Your data leaves your environment when you use a Claude model.** A question sends the selected
> chart or table in full, the app table and field names, and master dimension and measure
> definitions, through the proxy to an external LLM. The API key stays on the proxy, never in the
> browser. Do not point this at sensitive, regulated or personal data unless that is allowed where
> you work. Local Ministral models keep everything on the machine.

There are two pieces and you need both:

1. **The proxy**, which holds the Anthropic API key, checks your Qlik session, and forwards requests.
2. **The extension**, which is the panel in Qlik. It never holds a key and always goes through the
   proxy.

Plan on 20 minutes the first time. Most of it is the certificate step.

Qlik Cloud is out of scope on purpose. It already ships native AI assistants, so support for it is
not planned.

---

## 1. Install the proxy

Put it on a host the browser can reach. The Qlik node itself is the easy choice, because the session
cookie is already scoped to that hostname.

```powershell
cd proxy
.\scripts\setup.ps1
```

The script checks Node, installs dependencies, generates a development TLS certificate, writes a
`.env`, and offers to register the Windows service.

Then edit `proxy\.env` and set at least:

```ini
ANTHROPIC_API_KEY=sk-ant-your-real-key
QLIK_ORIGINS=https://your-qlik-host,https://your-qlik-host.domain.com
QLIK_SESSION_URL=https://YOUR-QLIK-HOST:4243/qps/session
QLIK_CERT=./certs/client.pem
QLIK_KEY=./certs/client_key.pem
QLIK_CA=./certs/root.pem
OLLAMA_URL=http://localhost:11434/v1/chat/completions
```

Two things that will cost you an hour if you get them wrong:

- `QLIK_ORIGINS` must be the exact origin of the Qlik page, with no trailing slash. Anything else
  gets no CORS headers, and the browser reports that as a network error rather than a clear failure.
- The host in `QLIK_SESSION_URL` must match a SAN on the QPS certificate. QSEoW uses the **short
  hostname**, not the FQDN. Get this wrong and every session check fails with a 401.

Start it and confirm:

```powershell
npm start
Invoke-WebRequest https://localhost:3000/health -SkipCertificateCheck
```

You want `{"status":"up"}`. The proxy will not start without an API key, even if you only plan to use
local models.

Full detail is in [`proxy/README.md`](./proxy/README.md).

---

## 2. Trust the certificate in the browser

The development certificate is self signed, so each browser has to accept it once, per origin. Skip
this and every request fails with "NetworkError when attempting to fetch resource", because a
rejected handshake on a preflight never becomes a readable HTTP error.

Open this in the same browser you use for Qlik, and accept the warning:

```
https://your-qlik-host:3000/health
```

In Firefox that is Advanced, then "Accept the Risk and Continue". You should end up looking at
`{"status":"up"}`.

Use the **Qlik hostname**, not `localhost`. The proxy identifies you from the Qlik session cookie,
and the browser only sends that cookie to the Qlik host. The port does not matter for cookies, so the
same host on 3000 works fine.

---

## 3. Install the extension

**Enterprise (QSEoW):** QMC, then Extensions, then Import, and upload
`AnthropicExtension-v0.5.4.zip`.

**Desktop:** unzip into

```
%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\
```

so that `AnthropicExtension.qext` sits directly inside the `AnthropicExtension` folder, then restart
Qlik Sense Desktop.

The extension shows up in the assets panel under Custom objects as **Anthropic AI Assistant**.

After any re-import, hard reload the sheet with `Ctrl` + `Shift` + `R`. Qlik and the browser both
cache extension files, and a stale build number in the panel footer is the usual sign you are still
running the previous one.

---

## 4. Configure the object

Drag **Anthropic AI Assistant** onto a sheet, then open Edit object and Settings.

| Setting | What to put there |
|---|---|
| Default model | The model a session starts with. Users can change it in the panel afterwards |
| Proxy URL | `https://your-qlik-host:3000/api/anthropic`. Leave it blank to switch Claude off completely |
| Local model URL | `https://your-qlik-host:3000/api/ollama`. Leave it blank to switch local models off |
| Log level | `Error` for normal use, `Debug` while diagnosing something |

There is no API key field. The key lives on the proxy.

Blank means off. If you only want local models, clear the Proxy URL and the Claude models disappear
from the picker instead of being offered and then failing. The settings panel tells you which backend
is currently switched off.

**Use one object per app.** Every object of this extension shares one configuration in the browser,
so a second object sitting on a sheet you never open used to be able to overwrite your settings.
v0.5.4 makes the configured object win, but an extra object is still confusing. There is a console
snippet in [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) that lists every one of them and names the
sheet it is on.

---

## 5. Local models, optional

For inference that never leaves the machine, install [Ollama](https://ollama.com) on the proxy host
and build the two derived models:

```powershell
ollama pull ministral-3:8b
"FROM ministral-3:8b`nPARAMETER num_ctx 8192" | Out-File -Encoding ascii Modelfile
ollama create ministral-3-demo -f Modelfile

ollama pull ministral-3:3b
"FROM ministral-3:3b`nPARAMETER num_ctx 8192" | Out-File -Encoding ascii Modelfile
ollama create ministral-3b-demo -f Modelfile
```

The `num_ctx 8192` part matters. Ollama defaults to a much larger context, which inflates the KV
cache to several GB and pushes the model onto the CPU, and then answers take minutes.

The 3B is roughly half the memory of the 8B at similar speed, so start there on a small GPU. No API
key is involved on this path.

---

## 6. Check it works

1. Open a sheet and click the green AI button in the bottom right.
2. Click **Add Chart**, then click a chart on the sheet.
3. Ask something like "what stands out in this data".

The answer streams in, with the model that wrote it named in the message footer. **New chat** resets
the thread, the copy button on a message copies it, and streaming can be turned off under Advanced
Options. **Stop** halts a long answer and keeps the text produced so far.

If nothing happens, go to [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md). It has console snippets you
can paste, or hand to an AI assistant, for the common cases: proxy not running, certificate not
trusted, wrong hostname, a duplicate object in the app, and what the proxy status codes mean.

---

## Upgrading

Releases are immutable, so upgrading is importing the newer zip over the old one in the QMC and hard
reloading the sheet. Your object settings survive.

Watch the pairing: extension v0.5.4 needs proxy v2.0.0 or later. v2.0.0 made Qlik session
authentication mandatory, moved the API key server side, and made the Stop button actually halt
inference. Coming from an older proxy is a breaking change, so re-read the `.env` list in step 1.
