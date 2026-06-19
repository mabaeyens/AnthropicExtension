# -*- coding: utf-8 -*-
"""
Genera el Resumen de arquitectura (Word .docx, español, editable) del Anthropic AI
Assistant para Qlik Sense, dirigido a arquitectos empresariales y técnicos.
Ejecutar:  python build_architecture_es_docx.py
Salida:    Resumen-de-Arquitectura-Asistente-IA-Anthropic-ES.docx
"""

import os
from docx.enum.text import WD_BREAK
import docx_style_es as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'Resumen-de-Arquitectura-Asistente-IA-Anthropic-ES.docx')


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def build():
    doc = S.new_document()
    S.add_footer(doc, u'Anthropic AI Assistant para Qlik Sense · v0.3.3 · '
                      u'Demostración experimental — sin garantía')

    S.cover(doc, u'Resumen de arquitectura', u'Resumen de arquitectura',
            u'Arquitectura, flujo de datos y modelo de seguridad — para arquitectos '
            u'empresariales y técnicos')
    page_break(doc)

    # 1. Resumen ejecutivo
    S.h1(doc, u'1. Resumen ejecutivo')
    S.lead(doc,
           u'El Anthropic AI Assistant (v0.3.3, compilación 24) es una extensión de visualización de '
           u'Qlik Sense que permite analizar los datos del gráfico seleccionado mediante el modelo '
           u'Claude de Anthropic. Es un activo de demostración experimental, no reforzado para producción.')
    S.bullets(doc, [
        (0, u'**Plataforma destino:** Qlik Sense client-managed en Windows (Desktop y QSEoW, '
            u'`qlik-sense >= 3.0.x`). Qlik Cloud queda fuera de alcance.'),
        (0, u'**Patrón de integración:** llamada a la API de Anthropic **directamente desde el '
            u'navegador**; un proxy local es opcional.'),
        (0, u'**Sin paso de compilación:** JavaScript «vanilla» cargado mediante el sistema RequireJS '
            u'de Qlik.'),
    ])

    # 2. Arquitectura de módulos
    S.h1(doc, u'2. Arquitectura de módulos')
    S.body(doc,
           u'Todos los módulos siguen el patrón RequireJS `define([deps], factory)`. El punto de entrada '
           u'`AnthropicExtension.js` delega en `js/main.js`, que expone el método `paint(element, layout)` '
           u'que Qlik invoca en cada ciclo de render. La inicialización de UI/selección se realiza '
           u'**una sola vez por instancia** (guarda de primera ejecución); las propiedades de Modelo y '
           u'URL de proxy se aplican en cada llamada a `paint()`.')
    S.spec_table(doc, [u'Módulo', u'Responsabilidad'], [
        [u'AnthropicExtension.js', u'Punto de entrada (shim RequireJS hacia js/main).'],
        [u'js/main.js', u'Ciclo paint() de Qlik, panel de propiedades, guarda de primera ejecución.'],
        [u'js/ui-controller.js', u'Panel flotante, hilo de conversación, selección de gráficos, '
                                 u'ensamblado de la petición y aviso de payload (~65 KB).'],
        [u'js/data-collector.js', u'Extrae el hipercubo del objeto seleccionado y recoge el contexto de '
                                  u'la app (tablas/campos + ítems maestros) una vez por sesión.'],
        [u'js/data-format.js', u'Compacta y formatea los datos para el LLM; estima tokens y recorta '
                               u'filas para no superar el presupuesto.'],
        [u'js/anthropic-api.js', u'Construye el mensaje, elige el transporte (directo vs proxy) y '
                                 u'realiza el POST con la clave en la cabecera x-api-key.'],
        [u'js/security.js', u'Cifra/descifra la clave de API en localStorage con CryptoJS AES.'],
        [u'js/chart-builder.js', u'Interpreta la especificación de gráfico de Claude, previsualiza y '
                                 u'añade el gráfico a la hoja vía la API de visualización de Qlik.'],
        [u'js/formatting.js', u'Renderiza la respuesta Markdown a HTML (saneado).'],
        [u'js/template.js', u'Marcado HTML del panel (inyectado por ui-controller).'],
        [u'js/config.js', u'Única fuente de verdad: modelo, endpoint, tokens, límites y prompt.'],
    ], widths_cm=[4.6, 12.4], mono_cols={0})
    S.caption(doc, u'Librerías empaquetadas (sin CDN): CryptoJS 4.2.0 (AES) y marked (Markdown → HTML).')

    # 3. Flujo de petición
    page_break(doc)
    S.h1(doc, u'3. Flujo de petición de extremo a extremo')
    S.bullets(doc, [
        (0, u'**Selección:** el clic se detecta vía la clase DOM `qv-object-<id>`; se extrae el '
            u'hipercubo completo del objeto (hasta el tope de celdas).'),
        (0, u'**Contexto de la app (solo 1.ª petición):** `getAppContextCached()` obtiene nombres reales '
            u'de tablas y campos e ítems maestros (dimensiones/medidas con sus expresiones) y los cachea '
            u'durante la sesión.'),
        (0, u'**Formateo y presupuesto:** se compactan los datos y se estiman tokens (~4 caracteres por '
            u'token), recortando filas según `MAX_ROWS`.'),
        (0, u'**Ensamblado:** ui-controller construye `{ userPrompt, chartData, context, systemPrompt, '
            u'history }`. Si el payload supera ~65 KB, se pide confirmación.'),
        (0, u'**Guarda de contexto:** si la estimación supera la ventana del modelo, el usuario puede '
            u'truncar los datos para que quepan o cancelar.'),
        (0, u'**Transporte:** `buildTransport()` elige endpoint directo o proxy según '
            u'`config.API.PROXY_URL`.'),
        (0, u'**Llamada:** POST con la clave (descifrada en el navegador) en `x-api-key`; tiempo de '
            u'espera de 60 s.'),
        (0, u'**Render:** la respuesta se renderiza como Markdown en el hilo, con botón de copia.'),
        (0, u'**Gráfico sugerido (opcional):** chart-builder previsualiza y, en modo edición, añade el '
            u'objeto a la hoja como el usuario autenticado.'),
    ])

    # 4. Especificación de la API
    S.h1(doc, u'4. Especificación de la API')
    S.h3(doc, u'Llamada directa (predeterminada)')
    S.code_block(doc,
                 u'POST https://api.anthropic.com/v1/messages\n'
                 u'Content-Type: application/json\n'
                 u'x-api-key: <clave descifrada>\n'
                 u'anthropic-version: 2023-06-01\n'
                 u'anthropic-dangerous-direct-browser-access: true')
    S.h3(doc, u'Llamada vía proxy (opcional)')
    S.code_block(doc,
                 u'POST <config.API.PROXY_URL>\n'
                 u'Content-Type: application/json\n'
                 u'x-api-key: <clave descifrada>\n'
                 u'(el proxy debe reenviar a api.anthropic.com/v1/messages y devolver el cuerpo sin alterar)')
    S.h3(doc, u'Parámetros y modelos')
    S.spec_table(doc, [u'Parámetro', u'Valor'], [
        [u'Endpoint directo', u'https://api.anthropic.com/v1/messages'],
        [u'Modelo predeterminado', u'claude-haiku-4-5'],
        [u'Modelos disponibles', u'claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-8'],
        [u'max_tokens', u'4000'],
        [u'anthropic-version', u'2023-06-01'],
        [u'Tiempo de espera', u'60000 ms (60 s)'],
        [u'Ventana de contexto (aprox.)', u'200000 tokens (por modelo)'],
    ], widths_cm=[5.4, 11.6], mono_cols={1})
    S.caption(doc, u'Prompt de sistema por defecto: «You are a business analyst and expert Qlik Sense '
                   u'user. Be concise. Always aggregate the data and show absolute values and percentages. '
                   u'Focus on insights that would help business decision making. Present your analysis in '
                   u'a structured format with bullet points for key findings.»')

    # 5. Modelo de seguridad
    page_break(doc)
    S.h1(doc, u'5. Modelo de seguridad')
    S.h3(doc, u'Almacenamiento de la clave de API')
    S.bullets(doc, [
        (0, u'La clave se cifra con **CryptoJS AES** y se guarda en `localStorage` bajo una clave '
            u'compartida (`anthropic_api_key`), no por app.'),
        (0, u'La passphrase AES está **empaquetada en la extensión**: se trata de **ofuscación, no de '
            u'secreto fuerte**. Adecuado solo para demos internas on-prem.'),
        (0, u'La clave se descifra en el navegador únicamente al construir la petición y viaja en la '
            u'cabecera `x-api-key` (nunca en el cuerpo).'),
    ])
    S.h3(doc, u'Datos que salen del navegador')
    S.bullets(doc, [
        (0, u'En cada petición: el **contenido completo del hipercubo** del gráfico seleccionado, la '
            u'pregunta del usuario y el historial (hasta 12 mensajes).'),
        (0, u'Solo en la 1.ª petición: nombres reales de tablas y campos e **ítems maestros con sus '
            u'expresiones**.'),
        (0, u'No se envían: credenciales de Qlik ni datos de otras hojas/apps. Todo el tráfico es HTTPS.'),
    ])
    S.h3(doc, u'Directo vs proxy — implicaciones')
    S.spec_table(doc, [u'Modo', u'Arquitectura', u'Consideración'], [
        [u'Directo (predet.)', u'Navegador → api.anthropic.com (HTTPS)',
         u'Funciona normalmente en QSEoW. Anthropic recibe la petición completa.'],
        [u'Proxy (opcional)', u'Navegador → proxy local → api.anthropic.com',
         u'Permite mantener la clave en el servidor si el proxy la gestiona; el proxy ve los datos.'],
    ], widths_cm=[3.0, 5.2, 8.8])

    # 6. Modelo de despliegue
    S.h1(doc, u'6. Modelo de despliegue')
    S.bullets(doc, [
        (0, u'**Sin build:** JavaScript «vanilla» + RequireJS; no requiere npm, transpilación ni '
            u'bundling. Los cambios surten efecto al recargar la app.'),
        (0, u'**Desktop:** copiar la carpeta de la extensión en '
            u'`%USERPROFILE%\\Documents\\Qlik\\Sense\\Extensions\\AnthropicExtension`.'),
        (0, u'**Enterprise (QSEoW):** importar el `.zip` desde la QMC → Extensiones.'),
        (0, u'**Proxy opcional:** debe reenviar a `api.anthropic.com/v1/messages` y devolver el cuerpo '
            u'sin alterar.'),
        (0, u'**Nota:** QSEoW **no** tiene página de CSP en la QMC (eso es propio de Cloud/QSEoK); no es '
            u'necesario configurar CSP en QSEoW.'),
    ])

    # 7. Límites y restricciones
    S.h1(doc, u'7. Límites y restricciones')
    S.spec_table(doc, [u'Parámetro', u'Valor', u'Propósito'], [
        [u'MAX_ROWS', u'1000', u'Máximo de filas enviadas al LLM por gráfico.'],
        [u'MAX_FETCH_CELLS', u'50000', u'Tope de celdas leídas de un hipercubo; más allá se trunca con '
                                       u'aviso (evita congelar la pestaña).'],
        [u'LARGE_TABLE_CELLS', u'25000', u'Umbral a partir del cual se avisa de tabla grande/truncada.'],
        [u'FETCH_PAGE_CONCURRENCY', u'4', u'Máximo de peticiones de página concurrentes al motor.'],
        [u'HISTORY_MAX', u'12', u'Mensajes previos enviados por petición (acota heap y coste).'],
        [u'Aviso de payload', u'~65 KB', u'Por encima se pide confirmación antes de enviar.'],
        [u'Tiempo de espera', u'60000 ms', u'Límite de la petición HTTP.'],
    ], widths_cm=[4.6, 2.4, 10.0], mono_cols={0})
    S.caption(doc, u'Las visualizaciones de tipo mapa no están soportadas.')

    # 8. Gobierno de datos y red
    S.h1(doc, u'8. Consideraciones de gobierno de datos y red')
    S.bullets(doc, [
        (0, u'Cada análisis implica **egreso de datos** del gráfico hacia un LLM externo (Anthropic); la '
            u'residencia y retención de esos datos quedan fuera del control directo del cliente.'),
        (0, u'Si la red corporativa bloquea la salida directa a `api.anthropic.com`, se recomienda enrutar '
            u'mediante un proxy controlado por el cliente.'),
        (0, u'La idoneidad se limita a **demostraciones internas**: la protección de la clave es '
            u'ofuscación, no cifrado robusto.'),
    ])

    # 9. Aviso
    S.h1(doc, u'9. Aviso importante')
    S.disclaimer_box(doc, S.DISCLAIMER_LINES)

    doc.core_properties.title = u'Resumen de arquitectura — Anthropic AI Assistant para Qlik Sense'
    doc.core_properties.author = 'mabaeyens'
    doc.save(OUT)
    print('OK ->', OUT)


if __name__ == '__main__':
    build()
