# -*- coding: utf-8 -*-
"""
Genera la Guía del usuario (Word .docx, español, editable) del Anthropic AI
Assistant para Qlik Sense.
Ejecutar:  python build_userguide_es_docx.py
Salida:    Guia-de-Usuario-Asistente-IA-Anthropic-ES.docx
"""

import os
from docx.enum.text import WD_BREAK
import docx_style_es as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'Guia-de-Usuario-Asistente-IA-Anthropic-ES.docx')


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def build():
    doc = S.new_document()
    S.add_footer(doc, u'Anthropic AI Assistant para Qlik Sense · v0.3.3 · '
                      u'Demostración experimental — sin garantía')

    S.cover(doc, u'Guía del usuario', u'Guía del usuario',
            u'Análisis de sus gráficos de Qlik Sense con IA, impulsado por Claude de Anthropic')
    page_break(doc)

    # 1. Introducción
    S.h1(doc, u'1. Introducción: ¿qué es?')
    S.lead(doc,
           u'El Anthropic AI Assistant es una extensión de visualización para Qlik Sense que añade un '
           u'panel de asistente de IA a sus cuadros de mando. El flujo es sencillo: seleccione un '
           u'gráfico, escriba una pregunta en lenguaje natural y reciba un análisis generado por Claude.')
    S.bullets(doc, [
        (0, u'En la primera pregunta, la extensión también envía la estructura del modelo de datos '
            u'(nombres de campos e ítems maestros) para que Claude interprete el gráfico en contexto.'),
        (0, u'Funciona sobre **Qlik Sense client-managed en Windows** (Desktop y Enterprise/QSEoW). '
            u'**Qlik Sense Cloud queda fuera de alcance** (Cloud dispone de asistentes de IA nativos).'),
        (0, u'Llama a la API de Anthropic **directamente desde el navegador**; un proxy local es '
            u'opcional, no obligatorio.'),
    ])

    # 2. Requisitos previos
    S.h1(doc, u'2. Requisitos previos')
    S.bullets(doc, [
        (0, u'Qlik Sense client-managed en Windows, versión **≥ 3.0.x** (Desktop o QSEoW).'),
        (0, u'Una **clave de API de Anthropic**, que se obtiene en '
            u'https://console.anthropic.com/api_keys.'),
        (0, u'Que el navegador pueda alcanzar **api.anthropic.com**. Si la red corporativa bloquea esa '
            u'salida, configure una **URL de proxy** (ver sección 5).'),
    ])

    # 3. Instalación
    S.h1(doc, u'3. Instalación')
    S.h3(doc, u'Qlik Sense Desktop (Windows)')
    S.bullets(doc, [(0, u'Descomprima el paquete `AnthropicExtension-v0.3.3.zip` en:')])
    S.code_block(doc, u'%USERPROFILE%\\Documents\\Qlik\\Sense\\Extensions\\AnthropicExtension\\')
    S.bullets(doc, [(0, u'Asegúrese de que `AnthropicExtension.qext` queda en la raíz de esa carpeta y '
                        u'reinicie Qlik Sense Desktop.')])
    S.h3(doc, u'Qlik Sense Enterprise on Windows (QSEoW)')
    S.bullets(doc, [(0, u'En la **QMC → Extensiones → Importar**, suba el archivo `.zip`. La extensión '
                        u'queda disponible de inmediato.')])
    S.h3(doc, u'Añadir el asistente a una hoja')
    S.bullets(doc, [(0, u'Abra una app en **modo edición**, busque la visualización '
                        u'«**Anthropic AI Assistant**» y arrástrela a la hoja. Aparecerá un panel '
                        u'flotante anclado al cuadro de mando.')])

    # 4. Configuración inicial
    S.h1(doc, u'4. Configuración inicial (panel de propiedades)')
    S.body(doc, u'En el panel de propiedades del objeto, sección «**Anthropic AI Settings**», configure:')
    S.spec_table(doc, [u'Propiedad', u'Descripción'], [
        [u'API key', u'Su clave de API de Anthropic. Se guarda cifrada en el navegador (localStorage). '
                     u'Déjela en blanco para borrar la clave guardada.'],
        [u'Model', u'Modelo a utilizar: «Haiku 4.5 (fast, low cost)» (predeterminado), '
                   u'«Sonnet 4.6 (balanced)» o «Opus 4.8 (most capable)».'],
        [u'Proxy URL (optional)', u'Opcional. Déjelo en blanco para llamar a la API directamente. Indique '
                                  u'la URL de un proxy local solo si su red bloquea la salida directa.'],
        [u'Versión', u'Campo de solo lectura: «Version 0.3.3 · build 24».'],
    ], widths_cm=[4.6, 12.4])
    S.caption(doc, u'La clave se comparte entre todas las apps del mismo navegador. Si no hay clave '
                   u'configurada, al enviar verá: «API key not found. Please enter your Anthropic API '
                   u'key in the settings.»')

    # 5. Recorrido de la interfaz
    page_break(doc)
    S.h1(doc, u'5. Recorrido de la interfaz')
    S.bullets(doc, [
        (0, u'**Botón flotante verde** (esquina inferior derecha): abre y cierra el panel.'),
        (0, u'**Cabecera «AI Assistant»** con botón de cierre «×».'),
        (0, u'**Estado de la clave de API**: avisa si falta configurarla.'),
        (0, u'**«Chart Selection»**: botones «Add Chart» y «Clear All», y las fichas (chips) de los '
            u'gráficos seleccionados.'),
        (0, u'**«Ask about your data:»**: el área de texto donde escribe su pregunta.'),
        (0, u'**«Advanced Options»**: ajustes de datos y estilo de análisis (desplegable).'),
        (0, u'**«AI Conversation»**: el hilo de la conversación, con botón «New chat».'),
        (0, u'**Pie**: «v0.3.3 · build 24 · mabaeyens».'),
    ])

    # 6. Uso paso a paso
    S.h1(doc, u'6. Cómo usarlo, paso a paso')
    S.h2(doc, u'6.1 Seleccionar uno o varios gráficos')
    S.bullets(doc, [
        (0, u'Pulse «**Add Chart**»; el botón cambia a «**Cancel**» y se activa el modo de selección '
            u'(la pista indica «Click a chart to add it»).'),
        (0, u'Haga clic en un gráfico del cuadro de mando: aparece como una ficha con su título y una '
            u'«×» para quitarlo.'),
        (0, u'Puede seleccionar hasta **5 gráficos**. Al alcanzar el límite verá «Maximum 5 charts.».'),
        (0, u'«**Clear All**» quita todos los gráficos. Sin selección, la pista muestra '
            u'«No charts selected».'),
    ])
    S.h2(doc, u'6.2 Hacer una pregunta')
    S.bullets(doc, [
        (0, u'Escriba su pregunta en «Ask about your data:» (p. ej. «¿Cuáles son los 5 clientes con '
            u'mayor facturación?»).'),
        (0, u'Pulse «**Submit**». El botón se deshabilita si no hay clave de API o no hay ningún '
            u'gráfico seleccionado.'),
        (0, u'Mientras Claude responde se muestra el estado «**Thinking…**».'),
    ])
    S.h2(doc, u'6.3 Leer la respuesta')
    S.bullets(doc, [
        (0, u'La respuesta se muestra en el hilo, renderizada con formato Markdown (títulos, listas, '
            u'negrita, código).'),
        (0, u'Cada respuesta incluye un botón «**Copy**» que copia el texto al portapapeles '
            u'(cambia a «Copied ✓»).'),
    ])
    S.h2(doc, u'6.4 Conversación de seguimiento')
    S.bullets(doc, [
        (0, u'Puede seguir preguntando: la extensión conserva la memoria de la conversación '
            u'(hasta **12 turnos**; los más antiguos se descartan).'),
        (0, u'«**New chat**» reinicia la conversación (mantiene los gráficos seleccionados). El contexto '
            u'de la app se reenvía en la primera pregunta de la nueva conversación.'),
    ])
    S.h2(doc, u'6.5 Opciones avanzadas')
    S.body(doc, u'Despliegue «Advanced Options» para ajustar qué datos se envían y el estilo del análisis:')
    S.h3(doc, u'Data Settings')
    S.bullets(doc, [
        (0, u'«Include app context (data model) on first message» (activado por defecto).'),
        (0, u'«Max data rows:» (predeterminado **1000**; rango 10–10000).'),
        (0, u'«Include numeric values», «Simplify data structure», «Include dimensions», '
            u'«Include measures» (todos activados por defecto).'),
    ])
    S.h3(doc, u'Analysis Style')
    S.bullets(doc, [
        (0, u'«Business analyst (default)», «Technical analyst», «Executive summary» o «Custom».'),
        (0, u'Al elegir «Custom» aparece un área de texto («Enter custom system prompt») para escribir '
            u'sus propias instrucciones de sistema.'),
    ])
    S.h2(doc, u'6.6 Sugerir un gráfico')
    S.bullets(doc, [
        (0, u'Tras recibir un análisis, pulse «**Suggest a chart**» (la IA propone un gráfico de Qlik; '
            u'el estado muestra «Designing a chart…»).'),
        (0, u'Se muestra una **vista previa** del gráfico propuesto.'),
        (0, u'Con la hoja en **modo edición**, pulse «**Add to sheet**» para añadirlo '
            u'(«Adding…» → «Added to sheet ✓»). Fuera de edición verá «Open the sheet in Edit mode '
            u'to add charts.».'),
        (0, u'Si la hoja está llena, se ofrece «**Create a new sheet**».'),
        (1, u'Tipos soportados: bar, line, combo, pie, scatter, table, pivot-table, KPI, histogram, '
            u'distribution, boxplot, waterfall, treemap, gauge, mekko y bullet. Los mapas no están '
            u'soportados.'),
    ])

    # 7. Mensajes y avisos
    page_break(doc)
    S.h1(doc, u'7. Mensajes y avisos')
    S.spec_table(doc, [u'Situación', u'Mensaje / comportamiento'], [
        [u'Falta la clave de API',
         u'«API key not found. Please enter your Anthropic API key in the settings.»'],
        [u'Datos grandes (> ~65 KB)',
         u'Cuadro de confirmación: «The selected chart data is about N KB… Send it anyway?». Puede '
         u'cancelar y filtrar con selecciones, o continuar.'],
        [u'Excede la ventana de contexto',
         u'«This request is about N tokens, which exceeds the … context window…». «OK» trunca los datos '
         u'del gráfico para que quepan; «Cancel» detiene el envío para que filtre los datos.'],
        [u'Añadir gráfico sin modo edición', u'«Open the sheet in Edit mode to add charts.»'],
        [u'Hoja llena', u'«Sheet is full — …» con la opción «Create a new sheet».'],
        [u'Error de red / proxy',
         u'Mensaje de error con el detalle. Tiempo de espera de 60 s. Un 401/403 indica clave inválida '
         u'o sin acceso al modelo elegido.'],
    ], widths_cm=[5.0, 12.0])

    # 8. Buenas prácticas y privacidad
    S.h1(doc, u'8. Buenas prácticas y privacidad')
    S.bullets(doc, [
        (0, u'**Filtre los datos con selecciones** antes de enviar: reduce tokens, coste y latencia, y '
            u'evita superar la ventana de contexto del modelo.'),
        (0, u'Recuerde que **los datos del gráfico salen del entorno** hacia un LLM externo (Anthropic), '
            u'junto con nombres reales de tablas/campos y expresiones de ítems maestros en la primera '
            u'pregunta.'),
        (0, u'**No utilice la extensión con datos sensibles, regulados o personales** salvo que el egreso '
            u'de esos datos esté expresamente permitido en su organización.'),
        (0, u'La clave de API se guarda **ofuscada** en el navegador, no cifrada de forma robusta '
            u'(adecuado solo para demos internas).'),
    ])

    # 9. Aviso
    S.h1(doc, u'9. Aviso importante')
    S.disclaimer_box(doc, S.DISCLAIMER_LINES)

    doc.core_properties.title = u'Guía del usuario — Anthropic AI Assistant para Qlik Sense'
    doc.core_properties.author = 'mabaeyens'
    doc.save(OUT)
    print('OK ->', OUT)


if __name__ == '__main__':
    build()
