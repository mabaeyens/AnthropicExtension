# AnthropicExtension

Extensión de visualización para Qlik Sense que permite analizar datos de gráficos usando la API de Anthropic (Claude).

## Descripción

Añade un panel de IA a cualquier dashboard de Qlik Sense. El usuario selecciona una visualización, hace una pregunta en lenguaje natural y recibe un análisis generado por Claude sobre los datos del gráfico.

La extensión se comunica con Anthropic a través de un **servidor proxy local en Node.js** (no incluido en este repo) que escucha en `localhost:3000`. Este proxy es necesario porque Qlik Sense on Windows corre en navegador y los navegadores bloquean llamadas directas a `api.anthropic.com` por CORS.

## Requisitos

- Qlik Sense Desktop (Windows) o Qlik Sense Enterprise ≥ 3.0
- API key de Anthropic
- Servidor proxy Node.js corriendo en `https://localhost:3000/api/anthropic`

## Instalación

1. Copia la carpeta del repositorio en la carpeta de extensiones de Qlik Sense:
   - **Desktop**: `%USERPROFILE%\Documents\Qlik\Sense\Extensions\AnthropicExtension\`
   - **Enterprise**: consola QMC → Extensions → Import
2. Recarga Qlik Sense
3. La extensión aparecerá en el panel de activos como **"Anthropic AI Assistant"**

## Configuración

Edita `js/config.js` para ajustar:

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| `API.URL` | `https://localhost:3000/api/anthropic` | URL del proxy local |
| `API.MODEL` | `claude-3-haiku-20240307` | Modelo de Claude |
| `API.MAX_TOKENS` | `4000` | Límite de tokens en la respuesta |
| `DATA.MAX_ROWS` | `1000` | Máximo de filas enviadas al LLM |
| `DEBUG_MODE` | `true` | Activar/desactivar logs de consola |

## Proxy requerido

La extensión no llama directamente a la API de Anthropic. Se necesita el servidor proxy Node.js **[cm-cse-llm-proxy](https://github.com/mby-qlik/cm-cse-llm-proxy)**, que:

- Escucha en `https://localhost:3000/api/anthropic`
- Acepta peticiones POST con el header `x-api-key` (clave de Anthropic)
- Las reenvía a `https://api.anthropic.com/v1/messages`

## Uso

1. Asegúrate de que el proxy Node.js está corriendo
2. Abre un dashboard en Qlik Sense
3. Arrastra la extensión **"Anthropic AI Assistant"** a la hoja
4. Introduce tu API key de Anthropic en el panel de propiedades
5. Haz clic en **"Seleccionar gráfico"**, elige una visualización y escribe tu pregunta

## Estructura

```
AnthropicExtension/
├── AnthropicExtension.js    # Punto de entrada (Qlik RequireJS)
├── AnthropicExtension.qext  # Metadatos de la extensión
├── icon.png
├── css/
│   └── style.css
├── html/
│   └── template.html
└── js/
    ├── config.js            # Configuración central
    ├── main.js              # Inicialización de la extensión
    ├── anthropic-api.js     # Cliente API (vía proxy)
    ├── data-collector.js    # Extracción de datos de visualizaciones Qlik
    ├── data-format.js       # Formateo de datos para el LLM
    ├── ui-controller.js     # Gestión de la interfaz
    ├── security.js          # Gestión segura de API keys (localStorage cifrado)
    └── lib/
        └── crypto-js.min.js # CryptoJS v4 — bundled, no requiere npm
```

## Estado

- [x] Extracción de datos de gráficos (bar, line, combo, mapa)
- [x] Análisis con Claude vía proxy
- [x] Almacenamiento cifrado de API key por app de Qlik
- [x] Servidor proxy disponible en [mby-qlik/cm-cse-llm-proxy](https://github.com/mby-qlik/cm-cse-llm-proxy)
- [ ] Soporte para Qlik Cloud (sin necesidad de proxy)

## Notas

- Compatible con **Qlik Sense on Windows** (Desktop y Enterprise); no probado en Qlik Cloud
- La API key se almacena cifrada en `localStorage`, asociada al ID de la app de Qlik
- `crypto-js.min.js` está incluido en el repo; no se necesita `npm install`
- Para cambiar el modelo de Claude, editar `API.MODEL` en `js/config.js`
