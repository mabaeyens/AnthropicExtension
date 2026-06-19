# -*- coding: utf-8 -*-
"""
Genera la Guía del usuario (PDF, español) del Anthropic AI Assistant para Qlik Sense.
Ejecutar:  python build_userguide_es.py
Salida:    Guia-de-Usuario-Asistente-IA-Anthropic-ES.pdf
"""

import os
from reportlab.platypus import SimpleDocTemplate, Spacer, PageBreak, KeepTogether
from reportlab.lib.units import cm

import pdf_style_es as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   'Guia-de-Usuario-Asistente-IA-Anthropic-ES.pdf')

DOC_TITLE = u'Guía del usuario'
HF_TITLE = u'Guía del usuario — Anthropic AI Assistant'


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
        u'Análisis de sus gráficos de Qlik Sense con IA, impulsado por Claude de Anthropic',
        u'Guía del usuario')
    story.append(PageBreak())

    # ---- 1. Introducción ----
    story.append(h1(u'1. Introducción: ¿qué es?'))
    story.append(lead(
        u'El <b>Anthropic AI Assistant</b> es una extensión de visualización para Qlik Sense que '
        u'añade un panel de asistente de IA a sus cuadros de mando. El flujo es sencillo: '
        u'<b>seleccione un gráfico → escriba una pregunta en lenguaje natural → reciba un análisis '
        u'generado por Claude</b>.'))
    story += S.bullets([
        (0, u'En la primera pregunta, la extensión también envía la estructura del modelo de datos '
            u'(nombres de campos e ítems maestros) para que Claude interprete el gráfico en contexto.'),
        (0, u'Funciona sobre <b>Qlik Sense client-managed en Windows</b> (Desktop y Enterprise/QSEoW). '
            u'<b>Qlik Sense Cloud queda fuera de alcance</b> (Cloud dispone de asistentes de IA nativos).'),
        (0, u'Llama a la API de Anthropic <b>directamente desde el navegador</b>; un proxy local es '
            u'opcional, no obligatorio.'),
    ])

    # ---- 2. Requisitos previos ----
    story.append(h1(u'2. Requisitos previos'))
    story += S.bullets([
        (0, u'Qlik Sense client-managed en Windows, versión <b>≥ 3.0.x</b> (Desktop o QSEoW).'),
        (0, u'Una <b>clave de API de Anthropic</b>, que se obtiene en '
            u'<font color="#007a38">https://console.anthropic.com/api_keys</font>.'),
        (0, u'Que el navegador pueda alcanzar <b>api.anthropic.com</b>. Si la red corporativa bloquea '
            u'esa salida, configure una <b>URL de proxy</b> (ver sección 5).'),
    ])

    # ---- 3. Instalación ----
    story.append(h1(u'3. Instalación'))
    story.append(h3(u'Qlik Sense Desktop (Windows)'))
    story += S.bullets([
        (0, u'Descomprima el paquete <font name="Courier">AnthropicExtension-v0.3.3.zip</font> en:'),
    ])
    story.append(S.para(u'%USERPROFILE%\\Documents\\Qlik\\Sense\\Extensions\\AnthropicExtension\\', S.CODE))
    story += S.bullets([
        (0, u'Asegúrese de que <font name="Courier">AnthropicExtension.qext</font> queda en la raíz de '
            u'esa carpeta y reinicie Qlik Sense Desktop.'),
    ])
    story.append(h3(u'Qlik Sense Enterprise on Windows (QSEoW)'))
    story += S.bullets([
        (0, u'En la <b>QMC → Extensiones → Importar</b>, suba el archivo <font name="Courier">.zip</font>. '
            u'La extensión queda disponible de inmediato.'),
    ])
    story.append(h3(u'Añadir el asistente a una hoja'))
    story += S.bullets([
        (0, u'Abra una app en <b>modo edición</b>, busque la visualización «<b>Anthropic AI Assistant</b>» '
            u'y arrástrela a la hoja. Aparecerá un panel flotante anclado al cuadro de mando.'),
    ])

    # ---- 4. Configuración inicial ----
    story.append(h1(u'4. Configuración inicial (panel de propiedades)'))
    story.append(p(
        u'En el panel de propiedades del objeto, sección «<b>Anthropic AI Settings</b>», configure:'))
    story.append(S.spec_table(
        [u'Propiedad', u'Descripción'],
        [
            [u'API key', u'Su clave de API de Anthropic. Se guarda cifrada en el navegador '
                         u'(localStorage). Déjela en blanco para borrar la clave guardada.'],
            [u'Model', u'Modelo a utilizar: «Haiku 4.5 (fast, low cost)» (predeterminado), '
                       u'«Sonnet 4.6 (balanced)» o «Opus 4.8 (most capable)».'],
            [u'Proxy URL (optional)', u'Opcional. Déjelo en blanco para llamar a la API directamente. '
                                      u'Indique la URL de un proxy local solo si su red bloquea la '
                                      u'salida directa.'],
            [u'Versión', u'Campo de solo lectura: «Version 0.3.3 · build 24».'],
        ],
        col_widths=[4.6 * cm, S.CONTENT_W - 4.6 * cm]))
    story.append(Spacer(1, 0.2 * cm))
    story.append(S.para(
        u'La clave se comparte entre todas las apps del mismo navegador. Si no hay clave configurada, '
        u'al enviar verá el mensaje: «API key not found. Please enter your Anthropic API key in the '
        u'settings.»', S.CAPTION))

    # ---- 5. Recorrido de la interfaz ----
    story.append(PageBreak())
    story.append(h1(u'5. Recorrido de la interfaz'))
    story += S.bullets([
        (0, u'<b>Botón flotante verde</b> (esquina inferior derecha): abre y cierra el panel.'),
        (0, u'<b>Cabecera «AI Assistant»</b> con botón de cierre «×».'),
        (0, u'<b>Estado de la clave de API</b>: avisa si falta configurarla.'),
        (0, u'<b>«Chart Selection»</b>: botones «Add Chart» y «Clear All», y las fichas (chips) de los '
            u'gráficos seleccionados.'),
        (0, u'<b>«Ask about your data:»</b>: el área de texto donde escribe su pregunta.'),
        (0, u'<b>«Advanced Options»</b>: ajustes de datos y estilo de análisis (desplegable).'),
        (0, u'<b>«AI Conversation»</b>: el hilo de la conversación, con botón «New chat».'),
        (0, u'<b>Pie</b>: «v0.3.3 · build 24 · mabaeyens».'),
    ])

    # ---- 6. Uso paso a paso ----
    story.append(h1(u'6. Cómo usarlo, paso a paso'))

    story.append(h2(u'6.1 Seleccionar uno o varios gráficos'))
    story += S.bullets([
        (0, u'Pulse «<b>Add Chart</b>»; el botón cambia a «<b>Cancel</b>» y se activa el modo de selección '
            u'(la pista indica «Click a chart to add it»).'),
        (0, u'Haga clic en un gráfico del cuadro de mando: aparece como una ficha con su título y una «×» '
            u'para quitarlo.'),
        (0, u'Puede seleccionar hasta <b>5 gráficos</b>. Al alcanzar el límite verá «Maximum 5 charts.».'),
        (0, u'«<b>Clear All</b>» quita todos los gráficos. Sin selección, la pista muestra '
            u'«No charts selected».'),
    ])

    story.append(h2(u'6.2 Hacer una pregunta'))
    story += S.bullets([
        (0, u'Escriba su pregunta en «Ask about your data:» (p. ej. «¿Cuáles son los 5 clientes con '
            u'mayor facturación?»).'),
        (0, u'Pulse «<b>Submit</b>». El botón se deshabilita si no hay clave de API o no hay ningún '
            u'gráfico seleccionado.'),
        (0, u'Mientras Claude responde se muestra el estado «<b>Thinking…</b>».'),
    ])

    story.append(h2(u'6.3 Leer la respuesta'))
    story += S.bullets([
        (0, u'La respuesta se muestra en el hilo, renderizada con formato Markdown (títulos, listas, '
            u'negrita, código).'),
        (0, u'Cada respuesta incluye un botón «<b>Copy</b>» que copia el texto al portapapeles '
            u'(cambia a «Copied ✓»).'),
    ])

    story.append(h2(u'6.4 Conversación de seguimiento'))
    story += S.bullets([
        (0, u'Puede seguir preguntando: la extensión conserva la memoria de la conversación '
            u'(hasta <b>12 turnos</b>; los más antiguos se descartan).'),
        (0, u'«<b>New chat</b>» reinicia la conversación (mantiene los gráficos seleccionados). '
            u'El contexto de la app se reenvía en la primera pregunta de la nueva conversación.'),
    ])

    story.append(h2(u'6.5 Opciones avanzadas'))
    story.append(p(u'Despliegue «Advanced Options» para ajustar qué datos se envían y el estilo del análisis:'))
    story.append(h3(u'Data Settings'))
    story += S.bullets([
        (0, u'«Include app context (data model) on first message» (activado por defecto).'),
        (0, u'«Max data rows:» (predeterminado <b>1000</b>; rango 10–10000).'),
        (0, u'«Include numeric values», «Simplify data structure», «Include dimensions», '
            u'«Include measures» (todos activados por defecto).'),
    ])
    story.append(h3(u'Analysis Style'))
    story += S.bullets([
        (0, u'«Business analyst (default)», «Technical analyst», «Executive summary» o «Custom».'),
        (0, u'Al elegir «Custom» aparece un área de texto («Enter custom system prompt») para escribir '
            u'sus propias instrucciones de sistema.'),
    ])

    story.append(h2(u'6.6 Sugerir un gráfico'))
    story += S.bullets([
        (0, u'Tras recibir un análisis, pulse «<b>Suggest a chart</b>» (la IA propone un gráfico de Qlik; '
            u'el estado muestra «Designing a chart…»).'),
        (0, u'Se muestra una <b>vista previa</b> del gráfico propuesto.'),
        (0, u'Con la hoja en <b>modo edición</b>, pulse «<b>Add to sheet</b>» para añadirlo '
            u'(«Adding…» → «Added to sheet ✓»). Fuera de edición verá «Open the sheet in Edit mode '
            u'to add charts.».'),
        (0, u'Si la hoja está llena, se ofrece «<b>Create a new sheet</b>».'),
        (1, u'Tipos soportados: bar, line, combo, pie, scatter, table, pivot-table, KPI, histogram, '
            u'distribution, boxplot, waterfall, treemap, gauge, mekko y bullet. Los <b>mapas no están '
            u'soportados</b>.'),
    ])

    # ---- 7. Mensajes y avisos ----
    story.append(PageBreak())
    story.append(h1(u'7. Mensajes y avisos'))
    story.append(S.spec_table(
        [u'Situación', u'Mensaje / comportamiento'],
        [
            [u'Falta la clave de API',
             u'«API key not found. Please enter your Anthropic API key in the settings.»'],
            [u'Datos grandes (> ~65 KB)',
             u'Cuadro de confirmación: «The selected chart data is about N KB… Send it anyway?». '
             u'Puede cancelar y filtrar con selecciones, o continuar.'],
            [u'Excede la ventana de contexto',
             u'«This request is about N tokens, which exceeds the … context window…». «OK» trunca los '
             u'datos del gráfico para que quepan; «Cancel» detiene el envío para que filtre los datos.'],
            [u'Añadir gráfico sin modo edición',
             u'«Open the sheet in Edit mode to add charts.»'],
            [u'Hoja llena',
             u'«Sheet is full — …» con la opción «Create a new sheet».'],
            [u'Error de red / proxy',
             u'Mensaje de error con el detalle. Tiempo de espera de 60 s. Un 401/403 indica clave '
             u'inválida o sin acceso al modelo elegido.'],
        ],
        col_widths=[5.0 * cm, S.CONTENT_W - 5.0 * cm]))

    # ---- 8. Buenas prácticas y privacidad ----
    story.append(h1(u'8. Buenas prácticas y privacidad'))
    story += S.bullets([
        (0, u'<b>Filtre los datos con selecciones</b> antes de enviar: reduce tokens, coste y latencia, '
            u'y evita superar la ventana de contexto del modelo.'),
        (0, u'Recuerde que <b>los datos del gráfico salen del entorno</b> hacia un LLM externo (Anthropic), '
            u'junto con nombres reales de tablas/campos y expresiones de ítems maestros en la primera '
            u'pregunta.'),
        (0, u'<b>No utilice la extensión con datos sensibles, regulados o personales</b> salvo que el '
            u'egreso de esos datos esté expresamente permitido en su organización.'),
        (0, u'La clave de API se guarda <b>ofuscada</b> en el navegador, no cifrada de forma robusta '
            u'(adecuado solo para demos internas).'),
    ])

    # ---- 9. Aviso ----
    story.append(h1(u'9. Aviso importante'))
    story.append(S.disclaimer_box(S.DISCLAIMER_LINES))

    doc = SimpleDocTemplate(
        OUT, pagesize=S.A4,
        leftMargin=S.MARGIN, rightMargin=S.MARGIN,
        topMargin=S.MARGIN + 0.3 * cm, bottomMargin=S.MARGIN,
        title=DOC_TITLE, author='mabaeyens',
        subject=u'Guía del usuario — Anthropic AI Assistant para Qlik Sense')
    hf = S.make_header_footer(HF_TITLE)
    doc.build(story, onFirstPage=hf, onLaterPages=hf)
    print('OK ->', OUT)


if __name__ == '__main__':
    build()
