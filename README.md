# cm-llm-proxy

Proxy HTTPS local que reenvía peticiones desde la extensión Qlik Sense [AnthropicExtension](https://github.com/mabaeyens/AnthropicExtension) hacia la API de Anthropic.

## ¿Por qué es necesario?

Qlik Sense Server impone restricciones de CORS y no permite llamadas directas a APIs externas desde el navegador. Este proxy corre en el servidor Qlik (o en local) y actúa como intermediario seguro.

```
Qlik Sense (browser) → https://localhost:3000/api/anthropic → api.anthropic.com
```

## Requisitos

- Node.js >= 18
- Certificados SSL para `localhost:3000` (ver sección Certificados)

## Instalación

```bash
npm install
```

## Configuración

Edita `server.js` para ajustar:

| Parámetro | Descripción | Valor por defecto |
|---|---|---|
| `port` | Puerto del servidor | `3000` |
| `origin` | Dominio de Qlik Sense permitido por CORS | `https://spmad-mby1` |

## Certificados

Los ficheros `certs/localhost3000-cert.pem` y `certs/localhost3000-key.pem` del repo son **placeholders vacíos**. Genera tus propios certificados autofirmados:

```bash
openssl req -x509 -newkey rsa:4096 -keyout certs/localhost3000-key.pem \
  -out certs/localhost3000-cert.pem -days 365 -nodes \
  -subj "/CN=localhost"
```

> El certificado debe importarse como confiable en el navegador y en Qlik Sense para evitar errores SSL.

## Uso

```bash
npm start
```

El servidor arranca en `https://localhost:3000`. Endpoints disponibles:

- `GET  /health` — Comprueba que el proxy está activo
- `POST /api/anthropic` — Reenvía la petición a `api.anthropic.com/v1/messages`

La API key de Anthropic se pasa en cada petición mediante la cabecera `x-api-key` (la gestiona la extensión Qlik).

## Repositorios relacionados

- [AnthropicExtension](https://github.com/mabaeyens/AnthropicExtension) — Extensión Qlik Sense que consume este proxy
- [RAG](https://github.com/mabaeyens/RAG) — Pipeline RAG con ChromaDB y embeddings locales
