# -*- coding: utf-8 -*-
"""
Genera el Resumen de arquitectura (PDF, español) del Anthropic AI Assistant para
Qlik Sense, dirigido a arquitectos empresariales y técnicos del cliente.
Ejecutar:  python build_architecture_es.py
Salida:    Resumen-de-Arquitectura-Asistente-IA-Anthropic-ES.pdf
"""

import os
from reportlab.platypus import SimpleDocTemplate, Spacer, PageBreak
from reportlab.lib.units import cm

import pdf_style_es as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'Resumen-de-Arquitectura-Asistente-IA-Anthropic-ES.pdf')

DOC_TITLE = u'Resumen de arquitectura'
HF_TITLE = u'Resumen de arquitectura — Anthropic AI Assistant'


def h1(t): return S.para(t, S.H1)
def h2(t): return S.para(t, S.H2)
def h3(t): return S.para(t, S.H3)
def p(t): return S.para(t, S.BODY)
def lead(t): return S.para(t, S.LEAD)


def build():
    story = []

    # ---- Portada ----
    story += S.cover_page(
        DOC_TITLE,
        u'Arquitectura, flujo de datos y modelo de seguridad — para arquitectos '
        u'empresariales y técnicos',
        u'Resumen de arquitectura')
    story.append(PageBreak())

    # ---- 1. Resumen ejecutivo ----
    story.append(h1(u'1. Resumen ejecutivo'))
    story.append(lead(
        u'El <b>Anthropic AI Assistant</b> (v0.3.3, compilación 24) es una extensión de visualización '
        u'de Qlik Sense que permite analizar los datos del gráfico seleccionado mediante el modelo '
        u'Claude de Anthropic. Es un <b>activo de demostración experimental</b>, no reforzado para '
        u'producción.'))
    story += S.bullets([
        (0, u'<b>Plataforma destino:</b> Qlik Sense client-managed en Windows (Desktop y QSEoW, '
            u'<font name="Courier">qlik-sense >= 3.0.x</font>). Qlik Cloud queda fuera de alcance.'),
        (0, u'<b>Patrón de integración:</b> llamada a la API de Anthropic <b>directamente desde el '
            u'navegador</b>; un proxy local es opcional.'),
        (0, u'<b>Sin paso de compilación:</b> JavaScript «vanilla» cargado mediante el sistema '
            u'RequireJS de Qlik.'),
    ])

    # ---- 2. Arquitectura de módulos ----
    story.append(h1(u'2. Arquitectura de módulos'))
    story.append(p(
        u'Todos los módulos siguen el patrón RequireJS <font name="Courier">define([deps], factory)</font>. '
        u'El punto de entrada <font name="Courier">AnthropicExtension.js</font> delega en '
        u'<font name="Courier">js/main.js</font>, que expone el método <font name="Courier">paint(element, '
        u'layout)</font> que Qlik invoca en cada ciclo de render. La inicialización de UI/selección se '
        u'realiza <b>una sola vez por instancia</b> (guarda de primera ejecución); las propiedades de '
        u'Modelo y URL de proxy se aplican en cada llamada a <font name="Courier">paint()</font>.'))
    story.append(S.spec_table(
        [u'Módulo', u'Responsabilidad'],
        [
            [u'AnthropicExtension.js', u'Punto de entrada (shim RequireJS hacia js/main).'],
            [u'js/main.js', u'Ciclo paint() de Qlik, panel de propiedades, guarda de primera ejecución.'],
            [u'js/ui-controller.js', u'Panel flotante, hilo de conversación, selección de gráficos, '
                                     u'ensamblado de la petición y aviso de payload (~65 KB).'],
            [u'js/data-collector.js', u'Extrae el hipercubo del objeto seleccionado y recoge el contexto '
                                      u'de la app (tablas/campos + ítems maestros) una vez por sesión.'],
            [u'js/data-format.js', u'Compacta y formatea los datos para el LLM; estima tokens y recorta '
                                   u'filas para no superar el presupuesto.'],
            [u'js/anthropic-api.js', u'Construye el mensaje, elige el transporte (directo vs proxy) y '
                                     u'realiza el POST con la clave en la cabecera x-api-key.'],
            [u'js/security.js', u'Cifra/descifra la clave de API en localStorage con CryptoJS AES.'],
            [u'js/chart-builder.js', u'Interpreta la especificación de gráfico de Claude, previsualiza '
                                     u'y añade el gráfico a la hoja vía la API de visualización de Qlik.'],
            [u'js/formatting.js', u'Renderiza la respuesta Markdown a HTML (saneado).'],
            [u'js/template.js', u'Marcado HTML del panel (inyectado por ui-controller).'],
            [u'js/config.js', u'Única fuente de verdad: modelo, endpoint, tokens, límites y prompt.'],
        ],
        col_widths=[4.6 * cm, S.CONTENT_W - 4.6 * cm], mono_cols={0}))
    story.append(Spacer(1, 0.2 * cm))
    story.append(S.para(
        u'Librerías empaquetadas (sin CDN): CryptoJS 4.2.0 (AES) y marked (Markdown → HTML).', S.CAPTION))

    # ---- 3. Flujo de petición ----
    story.append(PageBreak())
    story.append(h1(u'3. Flujo de petición de extremo a extremo'))
    story += S.bullets([
        (0, u'<b>Selección:</b> el clic se detecta vía la clase DOM <font name="Courier">qv-object-&lt;id&gt;</font>; '
            u'se extrae el hipercubo completo del objeto (hasta el tope de celdas).'),
        (0, u'<b>Contexto de la app (solo 1.ª petición):</b> <font name="Courier">getAppContextCached()</font> '
            u'obtiene nombres reales de tablas y campos e ítems maestros (dimensiones/medidas con sus '
            u'expresiones) y los cachea durante la sesión.'),
        (0, u'<b>Formateo y presupuesto:</b> se compactan los datos y se estiman tokens (~4 caracteres '
            u'por token), recortando filas según <font name="Courier">MAX_ROWS</font>.'),
        (0, u'<b>Ensamblado:</b> ui-controller construye <font name="Courier">{ userPrompt, chartData, '
            u'context, systemPrompt, history }</font>. Si el payload supera ~65 KB, se pide confirmación.'),
        (0, u'<b>Guarda de contexto:</b> si la estimación supera la ventana del modelo, el usuario puede '
            u'truncar los datos para que quepan o cancelar.'),
        (0, u'<b>Transporte:</b> <font name="Courier">buildTransport()</font> elige endpoint directo o '
            u'proxy según <font name="Courier">config.API.PROXY_URL</font>.'),
        (0, u'<b>Llamada:</b> POST con la clave (descifrada en el navegador) en <font name="Courier">'
            u'x-api-key</font>; tiempo de espera de 60 s.'),
        (0, u'<b>Render:</b> la respuesta se renderiza como Markdown en el hilo, con botón de copia.'),
        (0, u'<b>Gráfico sugerido (opcional, sin LLM adicional para la creación):</b> chart-builder '
            u'previsualiza y, en modo edición, añade el objeto a la hoja como el usuario autenticado.'),
    ])

    # ---- 4. Especificación de la API ----
    story.append(h1(u'4. Especificación de la API'))
    story.append(h3(u'Llamada directa (predeterminada)'))
    story.append(S.para(
        u'POST https://api.anthropic.com/v1/messages<br/>'
        u'Content-Type: application/json<br/>'
        u'x-api-key: &lt;clave descifrada&gt;<br/>'
        u'anthropic-version: 2023-06-01<br/>'
        u'anthropic-dangerous-direct-browser-access: true', S.CODE))
    story.append(h3(u'Llamada vía proxy (opcional)'))
    story.append(S.para(
        u'POST &lt;config.API.PROXY_URL&gt;<br/>'
        u'Content-Type: application/json<br/>'
        u'x-api-key: &lt;clave descifrada&gt;<br/>'
        u'(el proxy debe reenviar a api.anthropic.com/v1/messages y devolver el cuerpo sin alterar)',
        S.CODE))
    story.append(h3(u'Parámetros y modelos'))
    story.append(S.spec_table(
        [u'Parámetro', u'Valor'],
        [
            [u'Endpoint directo', u'https://api.anthropic.com/v1/messages'],
            [u'Modelo predeterminado', u'claude-haiku-4-5'],
            [u'Modelos disponibles', u'claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-8'],
            [u'max_tokens', u'4000'],
            [u'anthropic-version', u'2023-06-01'],
            [u'Tiempo de espera', u'60000 ms (60 s)'],
            [u'Ventana de contexto (aprox.)', u'200000 tokens (por modelo)'],
        ],
        col_widths=[5.4 * cm, S.CONTENT_W - 5.4 * cm], mono_cols={1}))
    story.append(Spacer(1, 0.15 * cm))
    story.append(S.para(
        u'Prompt de sistema por defecto: «You are a business analyst and expert Qlik Sense user. Be '
        u'concise. Always aggregate the data and show absolute values and percentages. Focus on insights '
        u'that would help business decision making. Present your analysis in a structured format with '
        u'bullet points for key findings.»', S.CAPTION))

    # ---- 5. Modelo de seguridad ----
    story.append(PageBreak())
    story.append(h1(u'5. Modelo de seguridad'))
    story.append(h3(u'Almacenamiento de la clave de API'))
    story += S.bullets([
        (0, u'La clave se cifra con <b>CryptoJS AES</b> y se guarda en <font name="Courier">localStorage</font> '
            u'bajo una clave compartida (<font name="Courier">anthropic_api_key</font>), no por app.'),
        (0, u'La passphrase AES está <b>empaquetada en la extensión</b>: se trata de <b>ofuscación, no de '
            u'secreto fuerte</b>. Adecuado solo para demos internas on-prem.'),
        (0, u'La clave se descifra en el navegador únicamente al construir la petición y viaja en la '
            u'cabecera <font name="Courier">x-api-key</font> (nunca en el cuerpo).'),
    ])
    story.append(h3(u'Datos que salen del navegador'))
    story += S.bullets([
        (0, u'En cada petición: el <b>contenido completo del hipercubo</b> del gráfico seleccionado, la '
            u'pregunta del usuario y el historial (hasta 12 mensajes).'),
        (0, u'Solo en la 1.ª petición: nombres reales de tablas y campos e <b>ítems maestros con sus '
            u'expresiones</b>.'),
        (0, u'No se envían: credenciales de Qlik ni datos de otras hojas/apps. Todo el tráfico es HTTPS.'),
    ])
    story.append(h3(u'Directo vs proxy — implicaciones'))
    story.append(S.spec_table(
        [u'Modo', u'Arquitectura', u'Consideración'],
        [
            [u'Directo (predet.)', u'Navegador → api.anthropic.com (HTTPS)',
             u'Funciona normalmente en QSEoW. Anthropic recibe la petición completa.'],
            [u'Proxy (opcional)', u'Navegador → proxy local → api.anthropic.com',
             u'Permite mantener la clave en el servidor si el proxy la gestiona; el proxy ve los datos.'],
        ],
        col_widths=[3.0 * cm, 5.2 * cm, S.CONTENT_W - 8.2 * cm]))

    # ---- 6. Modelo de despliegue ----
    story.append(h1(u'6. Modelo de despliegue'))
    story += S.bullets([
        (0, u'<b>Sin build:</b> JavaScript «vanilla» + RequireJS; no requiere npm, transpilación ni '
            u'bundling. Los cambios surten efecto al recargar la app.'),
        (0, u'<b>Desktop:</b> copiar la carpeta de la extensión en '
            u'<font name="Courier">%USERPROFILE%\\Documents\\Qlik\\Sense\\Extensions\\AnthropicExtension</font>.'),
        (0, u'<b>Enterprise (QSEoW):</b> importar el <font name="Courier">.zip</font> desde la QMC → Extensiones.'),
        (0, u'<b>Proxy opcional:</b> debe reenviar a <font name="Courier">api.anthropic.com/v1/messages</font> '
            u'y devolver el cuerpo sin alterar.'),
        (0, u'<b>Nota:</b> QSEoW <b>no</b> tiene página de CSP en la QMC (eso es propio de Cloud/QSEoK); '
            u'no es necesario configurar CSP en QSEoW.'),
    ])

    # ---- 7. Límites y restricciones ----
    story.append(h1(u'7. Límites y restricciones'))
    story.append(S.spec_table(
        [u'Parámetro', u'Valor', u'Propósito'],
        [
            [u'MAX_ROWS', u'1000', u'Máximo de filas enviadas al LLM por gráfico.'],
            [u'MAX_FETCH_CELLS', u'50000', u'Tope de celdas leídas de un hipercubo; más allá se trunca '
                                           u'con aviso (evita congelar la pestaña).'],
            [u'LARGE_TABLE_CELLS', u'25000', u'Umbral a partir del cual se avisa de tabla grande/truncada.'],
            [u'FETCH_PAGE_CONCURRENCY', u'4', u'Máximo de peticiones de página concurrentes al motor.'],
            [u'HISTORY_MAX', u'12', u'Mensajes previos enviados por petición (acota heap y coste).'],
            [u'Aviso de payload', u'~65 KB', u'Por encima se pide confirmación antes de enviar.'],
            [u'Tiempo de espera', u'60000 ms', u'Límite de la petición HTTP.'],
        ],
        col_widths=[4.6 * cm, 2.4 * cm, S.CONTENT_W - 7.0 * cm], mono_cols={0}))
    story.append(Spacer(1, 0.15 * cm))
    story.append(S.para(u'Las visualizaciones de tipo mapa no están soportadas.', S.CAPTION))

    # ---- 8. Gobierno de datos y red ----
    story.append(h1(u'8. Consideraciones de gobierno de datos y red'))
    story += S.bullets([
        (0, u'Cada análisis implica <b>egreso de datos</b> del gráfico hacia un LLM externo (Anthropic); '
            u'la residencia y retención de esos datos quedan fuera del control directo del cliente.'),
        (0, u'Si la red corporativa bloquea la salida directa a <font name="Courier">api.anthropic.com</font>, '
            u'se recomienda enrutar mediante un proxy controlado por el cliente.'),
        (0, u'La idoneidad se limita a <b>demostraciones internas</b>: la protección de la clave es '
            u'ofuscación, no cifrado robusto.'),
    ])

    # ---- 9. Aviso ----
    story.append(h1(u'9. Aviso importante'))
    story.append(S.disclaimer_box(S.DISCLAIMER_LINES))

    doc = SimpleDocTemplate(
        OUT, pagesize=S.A4,
        leftMargin=S.MARGIN, rightMargin=S.MARGIN,
        topMargin=S.MARGIN + 0.3 * cm, bottomMargin=S.MARGIN,
        title=DOC_TITLE, author='mabaeyens',
        subject=u'Resumen de arquitectura — Anthropic AI Assistant para Qlik Sense')
    hf = S.make_header_footer(HF_TITLE)
    doc.build(story, onFirstPage=hf, onLaterPages=hf)
    print('OK ->', OUT)


if __name__ == '__main__':
    build()
