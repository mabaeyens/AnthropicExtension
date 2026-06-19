# -*- coding: utf-8 -*-
"""
Shared styling/helpers for the Spanish PDF documents of the
Anthropic AI Assistant Qlik Sense extension.

Look & feel: Qlik-green professional. Pure reportlab (Platypus) — no system deps.
Used by build_userguide_es.py and build_architecture_es.py.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    Paragraph, Spacer, Table, TableStyle, Flowable, KeepTogether
)

# --- Palette -----------------------------------------------------------------
QLIK_GREEN = HexColor('#009845')   # matches the extension panel header
QLIK_GREEN_DARK = HexColor('#007a38')
DARK = HexColor('#333333')
GREY = HexColor('#595959')
LIGHT_GREY = HexColor('#f2f4f3')
RULE_GREY = HexColor('#d7dcd9')
ZEBRA = HexColor('#f7faf8')
WARN_BG = HexColor('#fff8e6')
WARN_BORDER = HexColor('#e0a800')

PAGE_W, PAGE_H = A4
MARGIN = 2 * cm
CONTENT_W = PAGE_W - 2 * MARGIN

FONT = 'Helvetica'
FONT_B = 'Helvetica-Bold'
FONT_I = 'Helvetica-Oblique'
FONT_MONO = 'Courier'

# --- Paragraph styles --------------------------------------------------------
H1 = ParagraphStyle('H1', fontName=FONT_B, fontSize=17, leading=21,
                    textColor=QLIK_GREEN_DARK, spaceBefore=16, spaceAfter=8)
H2 = ParagraphStyle('H2', fontName=FONT_B, fontSize=13, leading=17,
                    textColor=DARK, spaceBefore=12, spaceAfter=5)
H3 = ParagraphStyle('H3', fontName=FONT_B, fontSize=11, leading=15,
                    textColor=GREY, spaceBefore=8, spaceAfter=3)
BODY = ParagraphStyle('Body', fontName=FONT, fontSize=10, leading=14.5,
                      textColor=DARK, spaceAfter=6, alignment=TA_LEFT)
LEAD = ParagraphStyle('Lead', parent=BODY, fontSize=10.5, leading=15,
                      textColor=GREY, spaceAfter=8)
BULLET = ParagraphStyle('Bullet', parent=BODY, leftIndent=14, spaceAfter=3,
                        bulletIndent=2)
SUBBULLET = ParagraphStyle('SubBullet', parent=BODY, leftIndent=28, spaceAfter=2,
                           bulletIndent=16, textColor=GREY)
CODE = ParagraphStyle('Code', fontName=FONT_MONO, fontSize=8.5, leading=11.5,
                      textColor=DARK, backColor=LIGHT_GREY, borderPadding=4,
                      spaceBefore=4, spaceAfter=8)
CAPTION = ParagraphStyle('Caption', parent=BODY, fontSize=8.5, leading=11,
                         textColor=GREY, spaceAfter=4)
TH = ParagraphStyle('TH', fontName=FONT_B, fontSize=9, leading=12, textColor=white)
TD = ParagraphStyle('TD', fontName=FONT, fontSize=9, leading=12, textColor=DARK)
TD_MONO = ParagraphStyle('TDmono', fontName=FONT_MONO, fontSize=8.3, leading=11,
                         textColor=DARK)
DISC = ParagraphStyle('Disc', fontName=FONT, fontSize=8.7, leading=12.5,
                      textColor=HexColor('#7a5c00'))
DISC_B = ParagraphStyle('DiscB', parent=DISC, fontName=FONT_B,
                        textColor=HexColor('#6b4f00'))


# --- Helpers -----------------------------------------------------------------
def para(text, style=BODY):
    return Paragraph(text, style)


def bullets(items):
    """items: list of (level, text). level 0 = top bullet, 1 = sub bullet."""
    flow = []
    for level, text in items:
        if level == 0:
            flow.append(Paragraph(u'<font color="#009845">▪</font>&nbsp;&nbsp;' + text, BULLET))
        else:
            flow.append(Paragraph(u'–&nbsp;&nbsp;' + text, SUBBULLET))
    return flow


def _wrap_cell(value, header=False, mono=False):
    if isinstance(value, Flowable):
        return value
    style = TH if header else (TD_MONO if mono else TD)
    return Paragraph(str(value), style)


def spec_table(headers, rows, col_widths=None, mono_cols=None):
    """Green header row, zebra striping, wrapping cells.
    mono_cols: set of column indexes rendered in monospace."""
    mono_cols = mono_cols or set()
    data = [[_wrap_cell(h, header=True) for h in headers]]
    for r in rows:
        data.append([_wrap_cell(c, mono=(i in mono_cols)) for i, c in enumerate(r)])
    if col_widths is None:
        col_widths = [CONTENT_W / len(headers)] * len(headers)
    t = Table(data, colWidths=col_widths, repeatRows=1, hAlign='LEFT')
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), QLIK_GREEN),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, RULE_GREY),
        ('LINEBEFORE', (0, 0), (0, -1), 2, QLIK_GREEN),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(('BACKGROUND', (0, i), (-1, i), ZEBRA))
    t.setStyle(TableStyle(style))
    return t


def kv_table(rows, key_width=5.2 * cm, mono_value=False):
    """Two-column key/value table."""
    return spec_table(
        ['Elemento', 'Detalle'], rows,
        col_widths=[key_width, CONTENT_W - key_width],
        mono_cols={1} if mono_value else set(),
    )


class _Rule(Flowable):
    def __init__(self, width, color=RULE_GREY, thickness=0.6):
        super().__init__()
        self.width, self.color, self.thickness = width, color, thickness

    def wrap(self, *args):
        return (self.width, self.thickness + 4)

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 2, self.width, 2)


def rule():
    return _Rule(CONTENT_W)


def disclaimer_box(lines, title=u'Aviso — demostración experimental'):
    """Callout box: light fill, green left border. lines: list of strings."""
    inner = [Paragraph(title, DISC_B)]
    for ln in lines:
        inner.append(Paragraph(ln, DISC))
    box = Table([[inner]], colWidths=[CONTENT_W])
    box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), WARN_BG),
        ('LINEBEFORE', (0, 0), (0, -1), 3, WARN_BORDER),
        ('BOX', (0, 0), (-1, -1), 0.4, WARN_BORDER),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
    ]))
    return box


DISCLAIMER_LINES = [
    u'Esta extensión es un activo de <b>demostración experimental (v0.3.3, compilación 24)</b>, '
    u'no un producto. <b>No</b> está reforzada para producción y <b>no</b> es una oferta de Qlik ni '
    u'una integración soportada.',
    u'<b>Ni Qlik ni el autor asumen responsabilidad alguna</b> por cualquier incidencia, exposición de '
    u'datos, coste o daño derivado de su uso en cualquier entorno de cliente o producción. '
    u'Úselo bajo su propia responsabilidad.',
    u'Al hacer una pregunta, los datos del gráfico seleccionado salen del entorno hacia un LLM externo '
    u'(Anthropic). No lo utilice con datos sensibles, regulados o personales sin autorización expresa.',
]


def cover_page(doc_title, subtitle, doc_kind):
    """Returns a list of flowables for the cover page."""
    story = []
    story.append(Spacer(1, 2.4 * cm))
    band = Table([[Paragraph(doc_kind.upper(), ParagraphStyle(
        'kind', fontName=FONT_B, fontSize=10, textColor=white, leading=13))]],
        colWidths=[CONTENT_W])
    band.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), QLIK_GREEN),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(band)
    story.append(Spacer(1, 0.8 * cm))
    story.append(Paragraph(doc_title, ParagraphStyle(
        'CoverTitle', fontName=FONT_B, fontSize=26, leading=31, textColor=DARK)))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(subtitle, ParagraphStyle(
        'CoverSub', fontName=FONT, fontSize=13, leading=18, textColor=GREY)))
    story.append(Spacer(1, 0.5 * cm))
    story.append(rule())
    story.append(Spacer(1, 0.3 * cm))
    meta = Table([
        [Paragraph(u'<b>Producto</b>', TD), Paragraph(u'Anthropic AI Assistant para Qlik Sense', TD)],
        [Paragraph(u'<b>Versión</b>', TD), Paragraph(u'v0.3.3 · compilación 24', TD)],
        [Paragraph(u'<b>Autor</b>', TD), Paragraph(u'mabaeyens', TD)],
        [Paragraph(u'<b>Fecha</b>', TD), Paragraph(u'19 de junio de 2026', TD)],
        [Paragraph(u'<b>Idioma</b>', TD), Paragraph(u'Español', TD)],
    ], colWidths=[4 * cm, CONTENT_W - 4 * cm])
    meta.setStyle(TableStyle([
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(meta)
    story.append(Spacer(1, 1.0 * cm))
    story.append(disclaimer_box(DISCLAIMER_LINES))
    return story


def make_header_footer(doc_title):
    """Return an onPage callback drawing the top rule + footer."""
    def _hf(canvas, doc):
        canvas.saveState()
        # top green rule
        canvas.setStrokeColor(QLIK_GREEN)
        canvas.setLineWidth(2)
        y_top = PAGE_H - MARGIN + 0.55 * cm
        canvas.line(MARGIN, y_top, PAGE_W - MARGIN, y_top)
        if doc.page > 1:
            canvas.setFont(FONT, 7.5)
            canvas.setFillColor(GREY)
            canvas.drawString(MARGIN, y_top + 3, doc_title)
        # footer
        canvas.setStrokeColor(RULE_GREY)
        canvas.setLineWidth(0.5)
        y_bot = MARGIN - 0.55 * cm
        canvas.line(MARGIN, y_bot, PAGE_W - MARGIN, y_bot)
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(GREY)
        canvas.drawString(MARGIN, y_bot - 11,
                          u'Anthropic AI Assistant para Qlik Sense · v0.3.3 · '
                          u'Demostración experimental — sin garantía')
        canvas.drawRightString(PAGE_W - MARGIN, y_bot - 11, u'Página %d' % doc.page)
        canvas.restoreState()
    return _hf
