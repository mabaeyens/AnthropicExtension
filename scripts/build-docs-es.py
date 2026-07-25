# -*- coding: utf-8 -*-
"""
Genera la documentación en español (Word + PDF) a partir de un único modelo de
contenido, de modo que ambos formatos no puedan divergir.

Produce, en la raíz del repositorio:
  - Guia-de-Usuario-Asistente-IA-Anthropic-ES.docx / .pdf
  - Resumen-de-Arquitectura-Asistente-IA-Anthropic-ES.docx / .pdf

El contenido refleja el estado ACTUAL del proyecto (v0.5.0, endurecido y
proxy-only): el navegador no guarda ninguna clave de API, todo el tráfico pasa
por el proxy endurecido (que guarda la clave en el servidor y valida la sesión
Qlik), y se han añadido niveles de log, modelos locales (Ollama) y streaming.

Requisitos: python-docx, reportlab. Fuentes Arial/Consolas de Windows (para el
PDF con Unicode correcto). Ejecución:
    python scripts/build-docs-es.py
"""

import os

# ── Metadatos comunes ────────────────────────────────────────────────────────
VERSION = "v0.5.0"
BUILD = "34"
AUTHOR = "Miguel Angel Baeyens"
FECHA = "25 de julio de 2026"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Paleta ───────────────────────────────────────────────────────────────────
CLAY = (0xC1, 0x5F, 0x3C)      # acento (barras de título, encabezados de tabla)
SLATE = (0x2E, 0x34, 0x40)     # texto de títulos
HEADER_FILL = (0xEC, 0xEC, 0xEC)
NOTICE_FILL = (0xFF, 0xF4, 0xE5)
NOTICE_BORDER = (0xC1, 0x5F, 0x3C)


# =============================================================================
#  MODELO DE CONTENIDO
#  Cada documento es una lista de bloques. Tipos de bloque:
#    ("title", txt) ("subtitle", txt) ("meta", [(k,v)]) ("notice", titulo, [parr])
#    ("h1", txt) ("h2", txt) ("p", txt) ("bullets", [items]) ("code", txt)
#    ("table", [cabeceras], [filas])
#  En bullets, un item que empieza por "– " se renderiza como sub-viñeta.
# =============================================================================

def meta_block(producto):
    return ("meta", [
        ("Producto", producto),
        ("Versión", f"{VERSION} · compilación {BUILD}"),
        ("Autor", AUTHOR),
        ("Fecha", FECHA),
        ("Idioma", "Español"),
    ])

NOTICE_DEMO = ("notice", "Aviso — demostración experimental", [
    "Esta extensión es un desarrollo de demostración y no un producto oficialmente "
    "soportado por Qlik. Ni Qlik ni el autor asumen responsabilidad alguna por cualquier incidencia.",
    "Al hacer una pregunta, los datos del gráfico seleccionado salen del entorno hacia un LLM "
    "(Anthropic, a través del proxy) — salvo que use un modelo local, en cuyo caso los datos "
    "permanecen en su infraestructura. No lo utilice con datos sensibles, regulados o "
    "personales sin autorización expresa.",
])

# ── Guía de usuario ──────────────────────────────────────────────────────────
GUIA = [
    ("title", "Guía del usuario"),
    ("subtitle", "Análisis de sus gráficos de Qlik Sense con IA, impulsado por Claude de Anthropic"),
    meta_block("Anthropic AI Assistant para Qlik Sense Enterprise on Windows"),
    NOTICE_DEMO,

    ("h1", "1. Introducción: ¿qué es?"),
    ("p", "El Anthropic AI Assistant es una extensión de visualización para Qlik Sense que "
          "añade un panel de asistente de IA a sus cuadros de mando. El flujo es sencillo: "
          "seleccione hasta 5 gráficos, escriba una pregunta en lenguaje natural y reciba un "
          "análisis generado por Claude."),
    ("bullets", [
        "En la primera pregunta, la extensión también envía la estructura del modelo de datos "
        "(nombres de tablas, campos e ítems maestros) para que Claude interprete el gráfico en contexto.",
        "Funciona sobre Qlik Sense Enterprise on Windows (Client-Managed). Qlik Sense Cloud queda "
        "fuera de alcance (Qlik Cloud dispone de asistentes de IA nativos como Qlik Answers).",
        "Novedad v0.5.0: la extensión ya NO guarda ninguna clave de API en el navegador. Todo el "
        "tráfico pasa por un proxy endurecido, que guarda la clave en el servidor y autentica su "
        "sesión de Qlik. El proxy es obligatorio.",
        "Puede elegir el modelo desde el propio panel (Haiku / Sonnet / Opus) e incluso un modelo "
        "local ejecutado con Ollama, en cuyo caso los datos no salen de su infraestructura.",
    ]),

    ("h1", "2. Requisitos previos"),
    ("bullets", [
        "Qlik Sense Enterprise on Windows versión ≥ 2025 o 2026 (versiones de 2024 pueden funcionar; "
        "en 2025 y 2026 se han introducido varios gráficos nuevos).",
        "El proxy endurecido desplegado y accesible (ver la Guía de instalación / proxy/README.md). "
        "El proxy guarda la clave de API de Anthropic y valida la sesión de Qlik.",
        "Que el navegador pueda alcanzar la URL del proxy por HTTPS con un certificado en el que "
        "confíe (idealmente emitido por su CA interna).",
        "Para modelos locales: un servidor Ollama en marcha y la ruta /api/ollama del proxy configurada.",
    ]),

    ("h1", "3. Instalación"),
    ("h2", "Qlik Sense Enterprise on Windows (QSEoW)"),
    ("bullets", [
        "En la QMC → Extensiones → Importar, suba el archivo .zip. La extensión queda disponible de inmediato.",
    ]),
    ("h2", "Añadir el asistente a una hoja"),
    ("bullets", [
        "Abra una app en modo edición, busque la visualización “Anthropic AI Assistant” y arrástrela a la "
        "hoja. Aparecerá un botón anclado en la parte inferior derecha, que se expandirá en un panel flotante.",
        "El objeto solo debe añadirse una única vez y no es necesario especificar ningún título. En las "
        "propiedades del objeto se configura la URL del proxy.",
    ]),

    ("h1", "4. Configuración inicial (panel de propiedades)"),
    ("p", "En el panel de propiedades del objeto, sección “Anthropic AI Settings”, configure:"),
    ("table", ["Propiedad", "Descripción"], [
        ["Default model", "Modelo con el que arranca cada sesión: “Haiku 4.5 (fast, low cost)” "
                          "(predeterminado), “Sonnet 4.6 (balanced)”, “Opus 4.8 (most capable)” o un "
                          "modelo local (Ministral vía Ollama). Puede cambiarlo en cualquier momento con "
                          "“Pick model” en el panel."],
        ["Proxy URL", "OBLIGATORIA. URL del proxy endurecido que guarda la clave y valida su sesión de "
                      "Qlik, p. ej. https://su-host-qlik:3000/api/anthropic. Déjela en blanco para usar el "
                      "valor por defecto de config.js."],
        ["Local model URL", "Endpoint de Ollama a través del proxy HTTPS, usado cuando se selecciona un "
                            "modelo local. Debe ser HTTPS en QSEoW, p. ej. https://localhost:3000/api/ollama."],
        ["Log level", "Verbosidad de la consola del navegador: ERROR (solo errores), WARN (errores y "
                      "avisos), INFO (además, acciones aceptadas) o DEBUG (todo). Baje a WARN/ERROR una vez "
                      "superada la fase de pruebas."],
        ["Versión", "Campo de solo lectura: “Version 0.5.0 · build 34”."],
    ]),
    ("p", "Ya no existe ninguna propiedad de “API key”: la clave vive únicamente en el proxy. Si la "
          "URL del proxy no está configurada, al enviar verá el mensaje: “Proxy URL is not configured. "
          "Set it in Edit object → Settings.”"),

    ("h1", "5. Recorrido de la interfaz"),
    ("bullets", [
        "Botón flotante (esquina inferior derecha): abre y cierra el panel.",
        "Cabecera “AI Assistant” con botón de cierre “X”.",
        "Estado de conexión: indica el proxy/endpoint configurado.",
        "“Chart Selection”: botones “Add Chart” y “Clear All”, y las fichas (chips) de los gráficos "
        "seleccionados, hasta 5. Se pueden seleccionar gráficos de distintas hojas: el panel es un "
        "elemento persistente y permanece abierto al navegar por la aplicación.",
        "“Ask about your data:”: el área de texto donde escribe su pregunta (prompt).",
        "“Pick model”: selector de modelo en el propio panel (cambia el modelo de la conversación).",
        "“Advanced Options”: ajustes de datos, estilo de análisis y streaming (desplegable).",
        "“AI Conversation”: el hilo de la conversación, con botón “New chat” para empezar de nuevo.",
    ]),

    ("h1", "6. Cómo usarlo, paso a paso"),
    ("h2", "6.1 Seleccionar uno o varios gráficos"),
    ("bullets", [
        "Pulse “Add Chart”; el botón cambia a “Cancel” y se activa el modo de selección "
        "(la pista indica “Click a chart to add it”).",
        "Haga clic en un gráfico del cuadro de mando: aparece como una ficha con su título y una “×” para quitarlo.",
        "Puede seleccionar hasta 5 gráficos. Al alcanzar el límite verá “Maximum 5 charts.”.",
        "“Clear All” quita todos los gráficos. Sin selección, la pista muestra “No charts selected”.",
    ]),
    ("h2", "6.2 Hacer una pregunta"),
    ("bullets", [
        "Escriba su pregunta en “Ask about your data:” (p. ej. “¿Cuáles son los 5 clientes con mayor facturación?”).",
        "Pulse “Submit”. El botón se deshabilita mientras hay una petición en curso o si no hay ningún gráfico seleccionado.",
        "Mientras Claude responde se muestra el estado “Thinking…”. Con streaming activado, la respuesta "
        "aparece token a token.",
    ]),
    ("h2", "6.3 Leer la respuesta"),
    ("bullets", [
        "La respuesta se muestra en el hilo, renderizada con formato Markdown (títulos, listas, negrita, código) y saneada.",
        "Cada respuesta incluye un botón “Copy” que copia el texto al portapapeles (cambia a “Copied ✓”).",
    ]),
    ("h2", "6.4 Conversación de seguimiento"),
    ("bullets", [
        "Puede seguir preguntando: la extensión conserva la memoria de la conversación (hasta 12 turnos; "
        "los más antiguos se descartan para optimizar el contexto).",
        "“New chat” reinicia la conversación (mantiene los gráficos seleccionados). El contexto de la app "
        "se reenvía siempre junto con la primera pregunta de la nueva conversación.",
        "Al cambiar de modelo se le avisa de que se limpiará la conversación en curso.",
    ]),
    ("h2", "6.5 Opciones avanzadas"),
    ("p", "Despliegue “Advanced Options” para ajustar qué datos se envían y el estilo del análisis:"),
    ("bullets", [
        "Data Settings: “Include app context (data model) on first message” (activado por defecto), "
        "“Max data rows” (predeterminado 1000; rango 10–10000), “Include numeric values”, "
        "“Simplify data structure”, “Include dimensions”, “Include measures”.",
        "Analysis Style: “Business analyst (default)”, “Technical analyst”, “Executive summary” o “Custom” "
        "(con un área de texto para sus propias instrucciones de sistema).",
        "Streaming: renderizado token a token de la respuesta (se desactiva automáticamente si el navegador "
        "o el proxy no pueden transmitir).",
    ]),
    ("h2", "6.6 Sugerir un gráfico"),
    ("bullets", [
        "Tras recibir un análisis, pulse “Suggest a chart” (la IA propone un gráfico de Qlik; el estado "
        "muestra “Designing a chart…”).",
        "Se muestra una vista previa del gráfico propuesto.",
        "Con la hoja en modo edición, pulse “Add to sheet” para añadirlo. Fuera de edición verá "
        "“Open the sheet in Edit mode to add charts.”. Si la hoja está llena, se ofrece “Create a new sheet”.",
        "– Tipos soportados: bar, line, combo, pie, scatter, table, pivot-table, KPI, histogram, distribution, "
        "boxplot, waterfall, treemap, gauge, mekko y bullet. Los mapas no están soportados en esta versión.",
    ]),

    ("h1", "7. Mensajes y avisos"),
    ("table", ["Situación", "Mensaje / comportamiento"], [
        ["Proxy sin configurar", "“Proxy URL is not configured. Set it in Edit object → Settings.” Configure "
                                 "la URL del proxy en las propiedades del objeto."],
        ["Datos grandes (> ~65 KB)", "Cuadro de confirmación: “The selected chart data is about N KB… Send it "
                                     "anyway?”. Puede cancelar y filtrar con selecciones, o continuar."],
        ["Excede la ventana de contexto", "“This request is about N tokens, which exceeds the … context "
                                          "window…”. “OK” trunca los datos del gráfico para que quepan; "
                                          "“Cancel” detiene el envío."],
        ["Payload demasiado grande (> 1 MB)", "Bloqueo por el lado del cliente antes de enviar, para evitar "
                                              "un rechazo 413 del proxy con un mensaje menos claro."],
        ["Proxy ocupado (503)", "Mensaje amable de “el servicio está ocupado, vuelva a intentarlo”. El proxy "
                               "aplica control de admisión y cola con límite."],
        ["Añadir gráfico sin modo edición", "“Open the sheet in Edit mode to add charts.”"],
        ["Error de red / sesión (401)", "Mensaje de error con el detalle. Un 401 indica que su sesión de Qlik "
                                        "no es válida o no está autenticada por el proxy. Tiempo de espera de 60 s "
                                        "(hosted) o 5 min (modelo local)."],
    ]),

    ("h1", "8. Buenas prácticas y privacidad"),
    ("bullets", [
        "Filtre los datos con selecciones antes de enviar: reduce tokens, coste y latencia, y evita superar "
        "la ventana de contexto del modelo.",
        "Recuerde que, con modelos hospedados, los datos del gráfico salen del entorno hacia un LLM externo "
        "(Anthropic) a través del proxy, junto con nombres reales de tablas/campos y expresiones de ítems "
        "maestros en la primera pregunta.",
        "Con un modelo local (Ollama) los datos permanecen en su infraestructura: útil para datos que no "
        "deben salir del perímetro.",
        "La clave de API ya no está en el navegador: vive solo en el proxy (variable de entorno del servidor). "
        "El proxy autentica a quien llama mediante su sesión de Qlik.",
        "Atienda al uso de la extensión con datos sensibles, regulados o personales salvo que la salida de "
        "esos datos esté expresamente permitida en su organización.",
    ]),
]

# ── Resumen de arquitectura ──────────────────────────────────────────────────
ARQ = [
    ("title", "Resumen de arquitectura"),
    ("subtitle", "Arquitectura, flujo de datos y modelo de seguridad — para arquitectos empresariales y técnicos"),
    meta_block("Anthropic AI Assistant para Qlik Sense (extensión + proxy)"),
    NOTICE_DEMO,

    ("h1", "1. Resumen ejecutivo"),
    ("p", "El Anthropic AI Assistant es una extensión de visualización de Qlik Sense que permite analizar "
          "los datos del gráfico seleccionado mediante la familia de modelos Claude de Anthropic (o un modelo "
          "local vía Ollama). Desde la v0.5.0 el sistema es una pareja endurecida: la extensión (cliente) y un "
          "proxy Node.js (servidor)."),
    ("bullets", [
        "Plataforma destino: Qlik Sense Enterprise on Windows (QSEoW, qlik-sense ≥ 2025). Qlik Cloud queda fuera de alcance.",
        "Patrón de integración: el navegador NUNCA llama directamente a api.anthropic.com. Todo el tráfico "
        "pasa por el proxy, que guarda la clave en el servidor y valida la sesión de Qlik del llamante.",
        "Sin paso de compilación en el cliente: JavaScript (AMD) cargado mediante el sistema RequireJS de Qlik.",
        "El proxy es un runtime Node.js independiente, versionado por separado, desplegable como servicio de Windows.",
    ]),

    ("h1", "2. Arquitectura de módulos (extensión)"),
    ("p", "Todos los módulos siguen el patrón RequireJS define([deps], factory). El punto de entrada "
          "AnthropicExtension.js delega en js/main.js, que expone paint(element, layout), invocado por Qlik en "
          "cada ciclo de renderizado. La inicialización de UI/selección se realiza una sola vez por instancia "
          "(guarda de primera ejecución sobre el widget flotante); las propiedades (modelo, URL de proxy, URL "
          "local, nivel de log) se aplican en cada llamada a paint()."),
    ("p", "Librerías empaquetadas (sin CDN): marked (Markdown → HTML) y DOMPurify (saneado del HTML). "
          "CryptoJS y js/security.js se han ELIMINADO: al no haber clave en el navegador, ya no hay nada que cifrar."),
    ("table", ["Módulo", "Responsabilidad"], [
        ["AnthropicExtension.js", "Punto de entrada (shim RequireJS hacia js/main)."],
        ["js/main.js", "Ciclo paint() de Qlik, panel de propiedades, guarda de primera ejecución, validación de config."],
        ["js/ui-controller.js", "Panel flotante, hilo de conversación, selección de gráficos, ensamblado de la "
                                "petición, control de una única petición en curso (busy/abort) y guarda de payload."],
        ["js/data-collector.js", "Extrae el hipercubo del objeto seleccionado y recoge el contexto de la app "
                                 "(tablas/campos + ítems maestros) una vez por sesión (memoización race-safe)."],
        ["js/data-format.js", "Compacta y formatea los datos para el LLM; estima tokens y recorta filas para no superar el presupuesto."],
        ["js/anthropic-api.js", "Construye el mensaje, resuelve el ÚNICO transporte (proxy) y realiza el POST con "
                                "credentials:include para reenviar la sesión de Qlik. Soporta streaming (SSE)."],
        ["js/chart-builder.js", "Interpreta la especificación de gráfico de Claude, previsualiza y añade el gráfico a la hoja."],
        ["js/formatting.js", "Renderiza la respuesta Markdown a HTML saneado (DOMPurify, fail-closed)."],
        ["js/config-validate.js", "Valida la configuración al iniciar; los problemas se muestran en el panel en lugar de romper el render."],
        ["js/log.js", "Envoltura de consola con niveles (ERROR/WARN/INFO/DEBUG) controlados por config.LOG_LEVEL."],
        ["js/template.js", "Marcado HTML del panel (inyectado por ui-controller)."],
        ["js/config.js", "Única fuente de verdad: modelo, endpoints de proxy, tokens, límites, niveles de log y prompt."],
    ]),

    ("h1", "3. Flujo de petición de extremo a extremo"),
    ("bullets", [
        "Selección: el click se detecta vía la clase DOM qv-object-<id>; se extrae el hipercubo del objeto "
        "(hasta el tope de celdas permitido).",
        "Contexto de la app (solo en la primera petición): getAppContextCached() obtiene nombres reales de "
        "tablas y campos e ítems maestros (dimensiones/medidas con sus expresiones) y los cachea durante la sesión.",
        "Formateo y presupuesto: se compactan los datos y se estiman tokens (~4 caracteres por token), recortando filas según MAX_ROWS.",
        "Ensamblado: ui-controller construye { userPrompt, chartData, context, systemPrompt, history }. Si el "
        "payload supera ~65 KB se pide confirmación; por encima de 1 MB se bloquea.",
        "Guarda de contexto: si la estimación supera la ventana del modelo, el usuario puede truncar los datos o cancelar.",
        "Transporte: una única ruta al proxy (config.API.PROXY_URL para modelos hospedados; config.API.LOCAL.URL "
        "para modelos locales). El navegador no lleva clave alguna.",
        "Llamada: POST al proxy con credentials:include, de modo que el navegador adjunta automáticamente la "
        "cookie de sesión de Qlik. El proxy valida la sesión, inyecta la clave y reenvía al upstream.",
        "Render: la respuesta se renderiza como Markdown saneado en el hilo, con botón de copia. Con streaming, token a token.",
        "Gráfico sugerido (opcional): chart-builder previsualiza y, en modo edición, añade el objeto a la hoja como el usuario autenticado.",
    ]),

    ("h1", "4. El proxy endurecido"),
    ("p", "El proxy (carpeta proxy/, Node.js + Express) es el punto donde vive la clave y donde se autentica al "
          "llamante. Sus capas de endurecimiento (especificaciones P01–P07):"),
    ("table", ["Capa", "Función"], [
        ["Custodia de credenciales (P01)", "La clave de Anthropic se guarda en el servidor (variable de entorno "
                                           "ANTHROPIC_API_KEY), se inyecta por petición y se elimina cualquier cabecera de clave enviada por el cliente."],
        ["Autenticación del llamante (P02)", "Valida la sesión de Qlik contra la API de QPS por TLS mutuo antes de "
                                             "cualquier llamada upstream. En el despliegue same-site el navegador envía la cookie X-Qlik-Session "
                                             "automáticamente (un virtual proxy con prefijo usa X-Qlik-Session-<prefijo>)."],
        ["Concurrencia y resiliencia (P03)", "Control de admisión con límites global y por usuario, cola FIFO acotada "
                                             "(503 + Retry-After al desbordar), backpressure en streaming y drenado ordenado al apagar."],
        ["Validación y allowlist (P04)", "Validación de esquema por ruta, tope de tamaño de cuerpo y lista blanca de "
                                         "modelos en el servidor: se rechaza lo inválido/excesivo/no permitido."],
        ["Transporte y CORS (P05)", "Allowlist estricta de orígenes, cabeceras de seguridad, suelo de TLS moderno y límite de tasa por IP."],
        ["Observabilidad y servicio (P06)", "Logs JSON estructurados con niveles, log de auditoría separado (sin cuerpos "
                                            "ni secretos), /health · /ready · /metrics, validación de configuración al arrancar y wrapper de servicio de Windows."],
    ]),

    ("h1", "5. Especificación de la API (proxy)"),
    ("h2", "Rutas"),
    ("code", "POST /api/anthropic   → reenvía a api.anthropic.com/v1/messages (la clave la inyecta el proxy)\n"
             "POST /api/ollama      → reenvía a un servidor Ollama local (formato OpenAI chat-completions)\n"
             "GET  /health          → liveness      GET /ready → readiness      GET /metrics → contadores"),
    ("h2", "Petición del cliente al proxy"),
    ("code", "POST <config.API.PROXY_URL>\n"
             "Content-Type: application/json\n"
             "Cookie: X-Qlik-Session=<sesión>   (enviada automáticamente por el navegador, same-site)\n"
             "(el navegador NO envía ninguna clave de API; el proxy la añade en el servidor)"),
    ("p", "Prompt de sistema por defecto: “You are a business analyst and expert Qlik Sense user. Be concise. "
          "Always aggregate the data and show absolute values and percentages. Focus on insights that would help "
          "business decision making. Present your analysis in a structured format with bullet points for key findings.”"),
    ("table", ["Parámetro", "Valor"], [
        ["Endpoint del proxy (hosted)", "https://<host>:3000/api/anthropic (por defecto en config.js: localhost)"],
        ["Endpoint del proxy (local)", "https://<host>:3000/api/ollama"],
        ["Modelo predeterminado", "claude-haiku-4-5"],
        ["Modelos disponibles", "claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-8, Ministral 3 8B/3B (local)"],
        ["max_tokens", "4000"],
        ["Tiempo de espera", "60 000 ms (hosted) · 300 000 ms (modelo local)"],
        ["Ventana de contexto (aprox.)", "200 000 tokens (hosted) · 8 192 (Ministral local)"],
    ]),

    ("h1", "6. Modelo de seguridad"),
    ("h2", "¿Dónde vive la clave de API?"),
    ("bullets", [
        "En el proxy, en el servidor (variable de entorno ANTHROPIC_API_KEY). El navegador nunca la ve ni la almacena.",
        "El proxy elimina cualquier cabecera de clave que un cliente pudiera enviar e inyecta la suya propia por petición.",
        "Ya no hay CryptoJS, ni localStorage, ni passphrase empaquetada: esa superficie de riesgo se ha eliminado por completo.",
    ]),
    ("h2", "Autenticación"),
    ("bullets", [
        "El proxy valida de forma independiente la sesión de Qlik del llamante (nunca confía en una identidad "
        "afirmada por el cliente) y resuelve el usuario real para límites por usuario y auditoría.",
        "Carrier por defecto: la cookie de sesión same-site (X-Qlik-Session). Como alternativa explícita se admite "
        "la cabecera x-qlik-session para despliegues que emitan un ticket de sesión.",
    ]),
    ("h2", "Datos que salen del navegador"),
    ("bullets", [
        "En cada petición: el contenido del hipercubo del gráfico seleccionado, la pregunta del usuario y el historial (hasta 12 mensajes).",
        "Solo en la primera petición: nombres reales de tablas y campos e ítems maestros con sus expresiones.",
        "No se envían: credenciales de Qlik hacia el LLM ni datos de otras hojas/apps. Todo el tráfico es HTTPS.",
        "Con un modelo local (Ollama), los datos van del navegador al proxy y de ahí a Ollama en su propia red: no salen a Internet.",
    ]),

    ("h1", "7. Modelo de despliegue"),
    ("bullets", [
        "Extensión (sin build): JavaScript + RequireJS; no requiere npm, transpilación ni bundling en runtime. "
        "Los cambios surten efecto al refrescar el navegador. Importar el .zip desde la QMC → Extensiones.",
        "Proxy: runtime Node.js en el nodo de Qlik. Instalación automatizada con proxy/scripts/setup.ps1 "
        "(dependencias de runtime con npm ci --omit=dev, certificado TLS, .env y, opcionalmente, servicio de Windows).",
        "Despliegue recomendado del proxy: same-site respecto al hub, de modo que el navegador envíe la cookie de "
        "sesión de Qlik automáticamente y el proxy la valide contra QPS por TLS mutuo.",
        "Certificado del proxy: en producción, CA-firmado para el FQDN que use la extensión, de modo que la página de Qlik confíe sin importaciones manuales.",
    ]),

    ("h1", "8. Límites y restricciones configurables"),
    ("table", ["Parámetro", "Valor", "Propósito"], [
        ["MAX_ROWS", "1000", "Máximo de filas enviadas al LLM por gráfico."],
        ["MAX_FETCH_CELLS", "50000", "Tope de celdas leídas de un hipercubo; más allá se trunca con aviso."],
        ["MAX_CELLS_PER_PAGE", "10000", "Celdas por página de getHyperCubeData."],
        ["LARGE_TABLE_CELLS", "25000", "Umbral a partir del cual se avisa de tabla grande/truncada."],
        ["FETCH_PAGE_CONCURRENCY", "4", "Máximo de peticiones de página concurrentes al motor."],
        ["MAX_FIELDS", "500", "Tope de campos de la lista enviada como contexto."],
        ["WARN / MAX_PAYLOAD_BYTES", "~65 KB / 1 MB", "Aviso de confirmación / bloqueo duro por tamaño de payload."],
        ["HISTORY_MAX", "12", "Mensajes previos enviados por petición."],
    ]),
    ("p", "Las visualizaciones de tipo mapa no están soportadas."),

    ("h1", "9. Consideraciones de gobierno de datos y red"),
    ("bullets", [
        "Cada análisis con un modelo hospedado implica salida de datos del gráfico hacia un LLM externo (Anthropic); "
        "la residencia y retención de esos datos quedan fuera del control directo del cliente.",
        "El proxy centraliza el control: es el único punto que sale a Internet, aplica allowlist de modelos, límites "
        "de tasa, auditoría y validación de la sesión de Qlik.",
        "Para datos que no deban salir del perímetro, use un modelo local (Ollama) a través del proxy.",
    ]),
]


# =============================================================================
#  RENDER DOCX (python-docx)
# =============================================================================

def build_docx(blocks, path):
    from docx import Document
    from docx.shared import Pt, RGBColor, Inches
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    doc = Document()
    # Márgenes
    for s in doc.sections:
        s.left_margin = s.right_margin = Inches(0.9)
        s.top_margin = s.bottom_margin = Inches(0.8)

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)

    def shade(cell, rgb):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:fill"), "%02X%02X%02X" % rgb)
        tcPr.append(shd)

    def set_cell_text(cell, text, bold=False, color=None, size=10):
        cell.text = ""
        p = cell.paragraphs[0]
        run = p.add_run(text)
        run.bold = bold
        run.font.size = Pt(size)
        if color:
            run.font.color.rgb = RGBColor(*color)

    for b in blocks:
        kind = b[0]
        if kind == "title":
            p = doc.add_paragraph()
            p.space_after = Pt(2)
            run = p.add_run(b[1])
            run.bold = True
            run.font.size = Pt(26)
            run.font.color.rgb = RGBColor(*SLATE)
            # barra de acento
            bar = doc.add_paragraph()
            pPr = bar._p.get_or_add_pPr()
            pbdr = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single")
            bottom.set(qn("w:sz"), "24")
            bottom.set(qn("w:space"), "1")
            bottom.set(qn("w:color"), "%02X%02X%02X" % CLAY)
            pbdr.append(bottom)
            pPr.append(pbdr)
        elif kind == "subtitle":
            p = doc.add_paragraph()
            run = p.add_run(b[1])
            run.italic = True
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
            p.space_after = Pt(10)
        elif kind == "meta":
            tbl = doc.add_table(rows=0, cols=2)
            tbl.style = "Table Grid"
            tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
            for k, v in b[1]:
                row = tbl.add_row().cells
                shade(row[0], HEADER_FILL)
                set_cell_text(row[0], k, bold=True)
                set_cell_text(row[1], v)
            row0 = tbl.rows[0].cells
            tbl.columns[0].width = Inches(1.6)
            tbl.columns[1].width = Inches(4.6)
            doc.add_paragraph().space_after = Pt(2)
        elif kind == "notice":
            tbl = doc.add_table(rows=1, cols=1)
            tbl.style = "Table Grid"
            cell = tbl.rows[0].cells[0]
            shade(cell, NOTICE_FILL)
            cell.text = ""
            ph = cell.paragraphs[0]
            r = ph.add_run(b[1])
            r.bold = True
            r.font.color.rgb = RGBColor(*NOTICE_BORDER)
            for para in b[2]:
                pp = cell.add_paragraph()
                pp.add_run(para).font.size = Pt(9.5)
            doc.add_paragraph().space_after = Pt(2)
        elif kind == "h1":
            p = doc.add_paragraph()
            p.space_before = Pt(12)
            p.space_after = Pt(3)
            run = p.add_run(b[1])
            run.bold = True
            run.font.size = Pt(15)
            run.font.color.rgb = RGBColor(*CLAY)
        elif kind == "h2":
            p = doc.add_paragraph()
            p.space_before = Pt(7)
            p.space_after = Pt(2)
            run = p.add_run(b[1])
            run.bold = True
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(*SLATE)
        elif kind == "p":
            p = doc.add_paragraph(b[1])
            p.space_after = Pt(6)
        elif kind == "bullets":
            for item in b[1]:
                sub = item.startswith("– ")
                text = item[2:] if sub else item
                p = doc.add_paragraph(text, style="List Bullet")
                if sub:
                    p.paragraph_format.left_indent = Inches(0.75)
                p.space_after = Pt(2)
        elif kind == "code":
            p = doc.add_paragraph()
            shade_p = p._p.get_or_add_pPr()
            run = p.add_run(b[1])
            run.font.name = "Consolas"
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0x22, 0x22, 0x22)
            p.space_after = Pt(6)
        elif kind == "table":
            headers, rows = b[1], b[2]
            tbl = doc.add_table(rows=1, cols=len(headers))
            tbl.style = "Table Grid"
            for i, h in enumerate(headers):
                shade(tbl.rows[0].cells[i], CLAY)
                set_cell_text(tbl.rows[0].cells[i], h, bold=True, color=(0xFF, 0xFF, 0xFF))
            for r in rows:
                cells = tbl.add_row().cells
                for i, val in enumerate(r):
                    set_cell_text(cells[i], val, size=9.5)
            doc.add_paragraph().space_after = Pt(2)

    doc.save(path)


# =============================================================================
#  RENDER PDF (reportlab)
# =============================================================================

def build_pdf(blocks, path):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                    TableStyle, HRFlowable, ListFlowable, ListItem)
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from xml.sax.saxutils import escape

    F = "C:/Windows/Fonts"
    pdfmetrics.registerFont(TTFont("AR", f"{F}/arial.ttf"))
    pdfmetrics.registerFont(TTFont("AR-B", f"{F}/arialbd.ttf"))
    pdfmetrics.registerFont(TTFont("AR-I", f"{F}/ariali.ttf"))
    pdfmetrics.registerFont(TTFont("MONO", f"{F}/consola.ttf"))
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    registerFontFamily("AR", normal="AR", bold="AR-B", italic="AR-I", boldItalic="AR-B")

    clay = colors.Color(*[c / 255 for c in CLAY])
    slate = colors.Color(*[c / 255 for c in SLATE])
    header_fill = colors.Color(*[c / 255 for c in HEADER_FILL])
    notice_fill = colors.Color(*[c / 255 for c in NOTICE_FILL])

    ss = getSampleStyleSheet()
    st_title = ParagraphStyle("t", parent=ss["Title"], fontName="AR-B", fontSize=24, textColor=slate, spaceAfter=4, leading=28)
    st_sub = ParagraphStyle("s", parent=ss["Normal"], fontName="AR-I", fontSize=11, textColor=colors.HexColor("#555555"), spaceAfter=10, leading=15)
    st_h1 = ParagraphStyle("h1", parent=ss["Normal"], fontName="AR-B", fontSize=14, textColor=clay, spaceBefore=12, spaceAfter=4, leading=17)
    st_h2 = ParagraphStyle("h2", parent=ss["Normal"], fontName="AR-B", fontSize=11.5, textColor=slate, spaceBefore=7, spaceAfter=2, leading=14)
    st_p = ParagraphStyle("p", parent=ss["Normal"], fontName="AR", fontSize=10, textColor=colors.HexColor("#1a1a1a"), spaceAfter=6, leading=14, alignment=TA_LEFT)
    st_li = ParagraphStyle("li", parent=st_p, spaceAfter=3, leading=13.5)
    st_code = ParagraphStyle("c", parent=ss["Normal"], fontName="MONO", fontSize=8.5, textColor=colors.HexColor("#222222"), leading=12, backColor=colors.HexColor("#F3F3F3"), borderPadding=6, spaceAfter=6)
    st_th = ParagraphStyle("th", parent=st_p, fontName="AR-B", textColor=colors.white, fontSize=9.5, spaceAfter=0, leading=12)
    st_td = ParagraphStyle("td", parent=st_p, fontSize=9, spaceAfter=0, leading=12)
    st_meta_k = ParagraphStyle("mk", parent=st_p, fontName="AR-B", fontSize=9.5, spaceAfter=0, leading=12)
    st_notice_t = ParagraphStyle("nt", parent=st_p, fontName="AR-B", textColor=clay, spaceAfter=3)
    st_notice_p = ParagraphStyle("np", parent=st_p, fontSize=9, spaceAfter=3, leading=12)

    def P(text, style):
        return Paragraph(escape(text).replace("\n", "<br/>"), style)

    story = []
    page_w = A4[0] - 2 * 18 * mm

    for b in blocks:
        kind = b[0]
        if kind == "title":
            story.append(P(b[1], st_title))
            story.append(HRFlowable(width="100%", thickness=2.2, color=clay, spaceBefore=1, spaceAfter=6))
        elif kind == "subtitle":
            story.append(P(b[1], st_sub))
        elif kind == "meta":
            data = [[P(k, st_meta_k), P(v, st_td)] for k, v in b[1]]
            t = Table(data, colWidths=[38 * mm, page_w - 38 * mm])
            t.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
                ("BACKGROUND", (0, 0), (0, -1), header_fill),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 8))
        elif kind == "notice":
            inner = [P(b[1], st_notice_t)] + [P(x, st_notice_p) for x in b[2]]
            t = Table([[inner]], colWidths=[page_w])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), notice_fill),
                ("BOX", (0, 0), (-1, -1), 1, clay),
                ("LINEBEFORE", (0, 0), (0, -1), 3, clay),
                ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ]))
            story.append(t)
            story.append(Spacer(1, 8))
        elif kind == "h1":
            story.append(P(b[1], st_h1))
        elif kind == "h2":
            story.append(P(b[1], st_h2))
        elif kind == "p":
            story.append(P(b[1], st_p))
        elif kind == "bullets":
            items = []
            for item in b[1]:
                sub = item.startswith("– ")
                text = item[2:] if sub else item
                items.append(ListItem(P(text, st_li), value="square" if not sub else "circle",
                                      leftIndent=(30 if sub else 14), bulletColor=clay))
            story.append(ListFlowable(items, bulletType="bullet", start="square"))
            story.append(Spacer(1, 4))
        elif kind == "code":
            story.append(P(b[1], st_code))
        elif kind == "table":
            headers, rows = b[1], b[2]
            ncol = len(headers)
            if ncol == 2:
                widths = [42 * mm, page_w - 42 * mm]
            elif ncol == 3:
                widths = [42 * mm, 26 * mm, page_w - 68 * mm]
            else:
                widths = [page_w / ncol] * ncol
            data = [[P(h, st_th) for h in headers]]
            for r in rows:
                data.append([P(str(v), st_td) for v in r])
            t = Table(data, colWidths=widths, repeatRows=1)
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), clay),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F7F7")]),
                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(t)
            story.append(Spacer(1, 8))

    doc = SimpleDocTemplate(path, pagesize=A4,
                            leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm,
                            title="Anthropic AI Assistant — " + VERSION)
    doc.build(story)


# =============================================================================
def main():
    jobs = [
        (GUIA, "Guia-de-Usuario-Asistente-IA-Anthropic-ES"),
        (ARQ, "Resumen-de-Arquitectura-Asistente-IA-Anthropic-ES"),
    ]
    for blocks, base in jobs:
        docx_path = os.path.join(ROOT, base + ".docx")
        pdf_path = os.path.join(ROOT, base + ".pdf")
        build_docx(blocks, docx_path)
        build_pdf(blocks, pdf_path)
        print("wrote", base + ".docx", "+", base + ".pdf")


if __name__ == "__main__":
    main()
