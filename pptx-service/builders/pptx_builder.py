"""
PptxBuilder — builds PANDO presentations from a JSON slide plan.
Accepts a template PPTX (bytes) + slide_plan dict, returns PPTX bytes.

Slide plan schema:
{
  "slides": [
    {
      "layout": "takeaway" | "divider" | "blank",
      "category": str,          # small label top-left
      "title": str,
      "takeaway": str,           # bottom message (takeaway layout only)
      "note": str,               # footnote
      "elements": [ ... ]        # see element types below
    }
  ]
}

Element types:
  panel_hdr  — colored header bar with white text
  textbox    — plain text box
  shape      — filled rectangle (optionally with text)
  hbar_float — horizontal floating bar chart (pricing ranges)
  line       — single-series line chart
  line_multi — multi-series line chart (vintage / cohort)
  donut      — doughnut chart (market share)
  scatter    — XY scatter chart
  quadrant   — 2×2 positioning matrix with labels
"""
import io
import re
from typing import Any

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION
from pptx.chart.data import ChartData, XyChartData
from pptx.oxml import parse_xml
from pptx.oxml.ns import qn
from pptx.enum.text import PP_ALIGN
from lxml import etree


# ── Constants ─────────────────────────────────────────────────────────────────
C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
DEFAULT_FONT = "Work Sans Light"

# PANDO palette
PALETTE = {
    "DKG": "004F46", "MDG": "437742", "OLV": "806E4B", "TEL": "4B5F62",
    "GRG": "D9DBD4", "NKB": "0A231F", "WHT": "FFFFFF", "LBL": "A5C8D1",
}

# Layout index map  (master_index, layout_index)
LAYOUT_MAP = {
    "cover":      (2, 0),   # blank master — cover is drawn programmatically
    "takeaway":   (1, 0),
    "divider":    (0, 2),
    "blank":      (2, 0),
    "back_cover": (2, 0),   # blank master — back cover drawn programmatically
}

# Placeholder indices
PH = {"cat": 18, "title": 16, "takeaway": 17, "note": 14, "content": 26}


def _rgb(h: str) -> RGBColor:
    h = h.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


class PptxBuilder:
    def __init__(self, template_bytes: bytes):
        self.prs = Presentation(io.BytesIO(template_bytes))
        self._clear_slides()

    def _clear_slides(self):
        """Remove all existing slides from the template, keeping masters/layouts."""
        sldIdLst = self.prs.slides._sldIdLst
        for sldId in list(sldIdLst):
            rId = sldId.get(qn("r:id"))
            try:
                self.prs.slides.part.drop_rel(rId)
            except Exception:
                pass
            sldIdLst.remove(sldId)

    # ── Public ─────────────────────────────────────────────────────────────────
    def build(self, slide_plan: dict) -> bytes:
        for slide_def in slide_plan.get("slides", []):
            self._add_slide(slide_def)
        out = io.BytesIO()
        self.prs.save(out)
        return out.getvalue()

    # ── Slide assembly ─────────────────────────────────────────────────────────
    def _add_slide(self, sd: dict):
        layout_key = sd.get("layout", "takeaway")
        # Resolve layout, falling back through masters if index out of range
        mi, li = LAYOUT_MAP.get(layout_key, (1, 0))
        n_masters = len(self.prs.slide_masters)
        mi = min(mi, n_masters - 1)
        n_layouts = len(self.prs.slide_masters[mi].slide_layouts)
        li = min(li, n_layouts - 1)
        layout = self.prs.slide_masters[mi].slide_layouts[li]
        slide = self.prs.slides.add_slide(layout)

        if layout_key == "cover":
            self._draw_cover(slide, sd)
        elif layout_key == "back_cover":
            self._draw_back_cover(slide, sd)
        else:
            self._fill_phs(slide, sd)
            for el in sd.get("elements", []):
                self._element(slide, el)

    def _fill_phs(self, slide, sd: dict):
        mapping = {
            PH["cat"]: sd.get("category"),
            PH["title"]: sd.get("title"),
            PH["takeaway"]: sd.get("takeaway"),
            PH["note"]: sd.get("note"),
        }
        to_remove = []
        for ph in slide.placeholders:
            idx = ph.placeholder_format.idx
            val = mapping.get(idx)
            if val:
                self._set_markdown_text(ph, val)
            else:
                # Remove every unfilled placeholder so default label text doesn't show
                to_remove.append(ph._element)
        for el in to_remove:
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)

    # ── Cover slide (programmatic, template-independent) ──────────────────────
    def _draw_cover(self, slide, sd: dict):
        """Draw a professional PANDO-branded front cover on a blank slide."""
        W, H = 13.33, 7.5

        def _txt(text, x, y, w, h, size, bold=False, italic=False, fg=PALETTE["NKB"], align="l", wrap=True):
            box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
            tf = box.text_frame; tf.word_wrap = wrap
            p = tf.paragraphs[0]
            p.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
            r = p.add_run(); r.text = text
            r.font.name = DEFAULT_FONT; r.font.size = Pt(size)
            r.font.bold = bold; r.font.italic = italic
            r.font.color.rgb = _rgb(fg)

        def _rect(x, y, w, h, color):
            sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
            sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(color)
            sh.line.fill.background()

        # Dark green vertical bar on the left edge
        _rect(0, 0, 0.40, H, PALETTE["DKG"])

        # Thin olive accent line
        _rect(0.40, H * 0.6, W - 0.40, 0.04, PALETTE["OLV"])

        # Company name — large
        title = sd.get("title", sd.get("company", ""))
        _txt(title, 0.75, 2.20, W - 1.2, 1.40, 44, bold=True, fg=PALETTE["NKB"], align="l")

        # Subtitle / deck name
        subtitle = sd.get("subtitle", "Investment Overview")
        _txt(subtitle, 0.75, 3.80, W - 1.2, 0.60, 20, fg=PALETTE["TEL"], align="l")

        # Horizontal rule below company name
        _rect(0.75, 3.70, W - 1.5, 0.025, PALETTE["DKG"])

        # Confidentiality + date bottom
        _txt("Private & Confidential", 0.75, H - 0.65, 6, 0.35, 8, italic=True, fg="999999")

        # Strictly Confidential sidebar (rotated is not supported, so put it vertical below)
        _txt("STRICTLY CONFIDENTIAL", 0.02, 2.5, 0.28, 3.5, 6.5, bold=False, fg=PALETTE["WHT"], align="c", wrap=True)

    # ── Back cover (programmatic) ──────────────────────────────────────────────
    def _draw_back_cover(self, slide, sd: dict):
        """Draw a PANDO-branded back cover — full dark green with centered message."""
        W, H = 13.33, 7.5

        def _rect(x, y, w, h, color):
            sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
            sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(color)
            sh.line.fill.background()

        def _txt(text, x, y, w, h, size, bold=False, italic=False, fg=PALETTE["WHT"], align="c"):
            box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
            tf = box.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
            r = p.add_run(); r.text = text
            r.font.name = DEFAULT_FONT; r.font.size = Pt(size)
            r.font.bold = bold; r.font.italic = italic
            r.font.color.rgb = _rgb(fg)

        # Full dark background
        _rect(0, 0, W, H, PALETTE["DKG"])

        # Thin olive accent stripe
        _rect(0, H * 0.75, W, 0.05, PALETTE["OLV"])

        # Large centered message
        message = sd.get("title", "Preguntas")
        _txt(message, 1, H / 2 - 0.8, W - 2, 1.4, 48, bold=True, fg=PALETTE["WHT"], align="c")

        # Subtitle
        subtitle = sd.get("subtitle", "")
        if subtitle:
            _txt(subtitle, 1, H / 2 + 0.7, W - 2, 0.5, 16, fg="A5C8D1", align="c")

        # Bottom: PANDO / contact
        _txt("pando.vc  |  Private & Confidential", 0, H - 0.55, W, 0.35, 9, italic=True, fg="FFFFFF", align="c")

    def _set_markdown_text(self, ph, text: str):
        """Set placeholder text, rendering **bold** spans as bold runs.
        Inherits font name/size/color from the layout's placeholder defaults."""
        tf = ph.text_frame
        tf.clear()
        p = tf.paragraphs[0]
        for part in re.split(r'(\*\*.*?\*\*)', text):
            if not part:
                continue
            r = p.add_run()
            if part.startswith("**") and part.endswith("**"):
                r.text = part[2:-2]
                r.font.bold = True
            else:
                r.text = part

    def _element(self, slide, el: dict):
        t = el.get("type", "")
        # Clamp x so no element ever overlaps the template's left margin line
        if "x" in el:
            el = dict(el, x=max(el["x"], 0.85))
        dispatch = {
            "panel_hdr":  self._panel_hdr,
            "textbox":    self._textbox,
            "shape":      self._shape,
            "hbar_float": self._hbar_float,
            "line":       self._line,
            "line_multi": self._line_multi,
            "bar":        self._bar,
            "donut":      self._donut,
            "scatter":    self._scatter,
            "quadrant":   self._quadrant,
            "table":      self._table,
        }
        fn = dispatch.get(t)
        if fn:
            fn(slide, el)

    # ── Basic shapes / text ────────────────────────────────────────────────────
    def _panel_hdr(self, slide, el: dict):
        x, y, w, h = el["x"], el["y"], el["w"], el.get("h", 0.27)
        bg = el.get("bg", PALETTE["DKG"])
        sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
        sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(bg)
        sh.line.fill.background()
        tf = sh.text_frame; tf.word_wrap = False
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT
        r = p.add_run(); r.text = el.get("text", "")
        r.font.name = DEFAULT_FONT; r.font.size = Pt(el.get("size", 7.5))
        r.font.bold = True; r.font.color.rgb = _rgb(PALETTE["WHT"])

    def _textbox(self, slide, el: dict):
        x, y, w, h = el["x"], el["y"], el["w"], el.get("h", 0.25)
        box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = box.text_frame; tf.word_wrap = el.get("wrap", True)
        align_map = {"c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT, "l": PP_ALIGN.LEFT}
        p = tf.paragraphs[0]
        p.alignment = align_map.get(el.get("align", "l"), PP_ALIGN.LEFT)
        r = p.add_run(); r.text = el.get("text", "")
        r.font.name = DEFAULT_FONT
        r.font.size = Pt(el.get("size", 7.5))
        r.font.bold = el.get("bold", False)
        r.font.italic = el.get("italic", False)
        r.font.color.rgb = _rgb(el.get("fg", PALETTE["NKB"]))

    def _shape(self, slide, el: dict):
        x, y, w, h = el["x"], el["y"], el["w"], el.get("h", 0.27)
        sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
        bg = el.get("bg")
        if bg:
            sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(bg)
        else:
            sh.fill.background()
        border = el.get("border")
        if border:
            sh.line.color.rgb = _rgb(border)
            sh.line.width = Pt(el.get("border_pt", 0.75))
        else:
            sh.line.fill.background()
        text = el.get("text", "")
        if text:
            tf = sh.text_frame; tf.word_wrap = False
            p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
            r = p.add_run(); r.text = text
            r.font.name = DEFAULT_FONT
            r.font.size = Pt(el.get("size", 8))
            r.font.bold = el.get("bold", False)
            r.font.color.rgb = _rgb(el.get("fg", PALETTE["WHT"]))

    # ── Charts: shared helpers ─────────────────────────────────────────────────
    def _smooth_all(self, ch):
        for ser_el in ch._element.findall(".//{%s}ser" % C_NS):
            sm = ser_el.find("{%s}smooth" % C_NS)
            if sm is None:
                ser_el.append(parse_xml(f'<c:smooth xmlns:c="{C_NS}" val="1"/>'))
            else:
                sm.set("val", "1")

    def _fix_catax(self, ch, skip: int = 1):
        """Insert tickLblSkip/tickMarkSkip BEFORE noMultiLvlLbl (correct schema order)."""
        for catAx in ch._element.findall(".//{%s}catAx" % C_NS):
            noMulti  = catAx.find("{%s}noMultiLvlLbl" % C_NS)
            extLst_e = catAx.find("{%s}extLst" % C_NS)
            anchor = noMulti if noMulti is not None else (extLst_e if extLst_e is not None else None)
            for tag in ["tickLblSkip", "tickMarkSkip"]:
                el = catAx.find("{%s}%s" % (C_NS, tag))
                if el is None:
                    new_el = parse_xml(f'<c:{tag} xmlns:c="{C_NS}" val="{skip}"/>')
                    if anchor is not None:
                        catAx.insert(list(catAx).index(anchor), new_el)
                    else:
                        catAx.append(new_el)
                else:
                    el.set("val", str(skip))

    def _style_axes(self, ch, ymin=None, ymax=None, num_fmt="#,##0",
                    skip=1, csize=5.5, grid_color="EBEBEB"):
        va = ch.value_axis
        if ymin is not None: va.minimum_scale = ymin
        if ymax is not None: va.maximum_scale = ymax
        va.has_major_gridlines = True
        try:
            va.major_gridlines.format.line.color.rgb = _rgb(grid_color)
            va.major_gridlines.format.line.width = Pt(0.25)
        except Exception: pass
        va.tick_labels.font.size = Pt(6)
        va.tick_labels.font.color.rgb = _rgb("999999")
        va.tick_labels.number_format = num_fmt
        try: va.format.line.fill.background()
        except Exception: pass
        ca = ch.category_axis
        ca.has_major_gridlines = False
        ca.tick_labels.font.size = Pt(csize)
        ca.tick_labels.font.color.rgb = _rgb("999999")
        try:
            ca.format.line.color.rgb = _rgb("DDDDD8")
            ca.format.line.width = Pt(0.25)
        except Exception: pass
        self._fix_catax(ch, skip)

    def _set_line_style(self, series, color: str, width_pt: float = 1.5, dashed: bool = False):
        series.format.line.color.rgb = _rgb(color)
        series.format.line.width = Pt(width_pt)
        if dashed:
            ser_el = series._element
            spPr = ser_el.find("{%s}spPr" % C_NS)
            if spPr is not None:
                ln = spPr.find("{%s}ln" % A_NS)
                if ln is not None:
                    pd = etree.SubElement(ln, "{%s}prstDash" % A_NS)
                    pd.set("val", "dash")

    # ── Horizontal floating bar chart (pricing ranges) ─────────────────────────
    def _hbar_float(self, slide, el: dict):
        series_defs = el.get("series", [])
        labels = [s["label"] for s in series_defs]
        lows   = [s["min"] for s in series_defs]
        highs  = [s["max"] - s["min"] for s in series_defs]

        cd = ChartData()
        cd.categories = labels
        cd.add_series("spacer", lows)
        cd.add_series("range",  highs)

        x, y, w, h = el["x"], el["y"], el["w"], el["h"]
        cf = slide.shapes.add_chart(
            XL_CHART_TYPE.BAR_STACKED,
            Inches(x), Inches(y), Inches(w), Inches(h), cd
        )
        ch = cf.chart
        ch.has_title = False; ch.has_legend = False

        # Spacer invisible
        sp = ch.series[0]
        sp.format.fill.background()
        sp.format.line.fill.background()

        # Color range bars
        colors = el.get("colors", [PALETTE["DKG"], PALETTE["MDG"], PALETTE["OLV"], PALETTE["TEL"],
                                    PALETTE["LBL"], PALETTE["GRG"]])
        rng = ch.series[1]
        self._color_bar_points(rng, colors, len(series_defs))

        # Axes
        ch.value_axis.has_major_gridlines = True
        try:
            ch.value_axis.major_gridlines.format.line.color.rgb = _rgb("EBEBEB")
            ch.value_axis.major_gridlines.format.line.width = Pt(0.25)
        except Exception: pass
        ch.value_axis.tick_labels.font.size = Pt(6)
        ch.value_axis.tick_labels.font.color.rgb = _rgb("999999")
        ch.value_axis.tick_labels.number_format = "#,##0"
        ch.category_axis.has_major_gridlines = False
        ch.category_axis.tick_labels.font.size = Pt(7)
        ch.category_axis.tick_labels.font.color.rgb = _rgb("444444")
        try: ch.plot_area.format.line.fill.background()
        except Exception: pass

    def _color_bar_points(self, series, colors: list, n: int):
        NS = (f'xmlns:c="{C_NS}" xmlns:a="{A_NS}"')
        cat_el = series._element.find(qn("c:cat"))
        if cat_el is None:
            cat_el = series._element.find(qn("c:val"))
        idx = list(series._element).index(cat_el)
        for i in range(n):
            col = colors[i % len(colors)]
            series._element.insert(idx + i, parse_xml(
                f'<c:dPt {NS}><c:idx val="{i}"/>'
                f'<c:invertIfNegative val="0"/>'
                f'<c:spPr><a:solidFill><a:srgbClr val="{col}"/></a:solidFill>'
                f'<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>'
            ))

    # ── Single-series line chart ───────────────────────────────────────────────
    def _line(self, slide, el: dict):
        cd = ChartData()
        cd.categories = el["labels"]
        cd.add_series("", el["values"])
        x, y, w, h = el["x"], el["y"], el["w"], el["h"]
        cf = slide.shapes.add_chart(
            XL_CHART_TYPE.LINE, Inches(x), Inches(y), Inches(w), Inches(h), cd
        )
        ch = cf.chart; ch.has_title = False; ch.has_legend = False
        color = el.get("color", PALETTE["MDG"])
        self._set_line_style(ch.series[0], color, el.get("width", 1.8))
        self._smooth_all(ch)
        self._style_axes(ch,
                         ymin=el.get("ymin"), ymax=el.get("ymax"),
                         num_fmt=el.get("num_fmt", "#,##0"),
                         skip=el.get("skip", 6), csize=5.5)

    # ── Multi-series line chart (vintage / cohort) ─────────────────────────────
    def _line_multi(self, slide, el: dict):
        series_list = el.get("series", [])
        cd = ChartData()
        cd.categories = el["labels"]
        for s in series_list:
            vals = s["values"]
            if len(vals) < len(el["labels"]):
                last = vals[-1] if vals else 0
                vals = vals + [last] * (len(el["labels"]) - len(vals))
            cd.add_series(s["name"], vals)
        x, y, w, h = el["x"], el["y"], el["w"], el["h"]
        cf = slide.shapes.add_chart(
            XL_CHART_TYPE.LINE, Inches(x), Inches(y), Inches(w), Inches(h), cd
        )
        ch = cf.chart; ch.has_title = False
        for i, s in enumerate(series_list):
            self._set_line_style(
                ch.series[i],
                s.get("color", PALETTE["DKG"]),
                s.get("width", 1.4),
                dashed=s.get("dashed", False)
            )
        self._smooth_all(ch)
        self._style_axes(ch,
                         ymin=el.get("ymin", 0), ymax=el.get("ymax"),
                         num_fmt=el.get("num_fmt", "#,##0"),
                         skip=el.get("skip", 1), csize=5)
        ch.has_legend = True
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False

    # ── Clustered vertical column chart (grouped category comparisons) ────────
    def _bar(self, slide, el: dict):
        """Vertical clustered bar chart — e.g. Perception vs Experience across attributes.
        Supports per-series solid colors, optional hatched/textured fill on one series,
        and optional in-chart data labels."""
        series_list = el.get("series", [])
        cd = ChartData()
        cd.categories = el["labels"]
        for s in series_list:
            cd.add_series(s["name"], s["values"])
        x, y, w, h = el["x"], el["y"], el["w"], el["h"]
        cf = slide.shapes.add_chart(
            XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(x), Inches(y), Inches(w), Inches(h), cd
        )
        ch = cf.chart; ch.has_title = False

        for i, s in enumerate(series_list):
            ser = ch.series[i]
            col = s.get("color", PALETTE["DKG"])
            ser.format.fill.solid(); ser.format.fill.fore_color.rgb = _rgb(col)
            ser.format.line.fill.background()
            if s.get("hatched"):
                self._set_hatch(ser, col)
            if s.get("data_labels"):
                ser.has_data_labels = True
                dl = ser.data_labels
                dl.number_format = el.get("num_fmt", "0%")
                dl.number_format_is_linked = False
                dl.font.size = Pt(7); dl.font.bold = False
                dl.font.color.rgb = _rgb("444444")
                dl.position = XL_LABEL_POSITION.OUTSIDE_END

        try:
            ch.plot_area.gap_width = el.get("gap_width", 60)
            ch.plot_area.overlap = el.get("overlap", -10)
        except Exception: pass

        self._style_axes(ch, ymin=el.get("ymin", 0), ymax=el.get("ymax"),
                         num_fmt=el.get("num_fmt", "0%"), skip=el.get("skip", 1), csize=6.5)

        if len(series_list) > 1:
            ch.has_legend = True
            ch.legend.position = XL_LEGEND_POSITION.BOTTOM
            ch.legend.include_in_layout = False
        else:
            ch.has_legend = False

    def _set_hatch(self, series, color: str):
        """Apply a diagonal-line hatch pattern fill to a bar series (matches PANDO 'perception' style)."""
        ser_el = series._element
        spPr = ser_el.find("{%s}spPr" % C_NS)
        if spPr is None: return
        solidFill = spPr.find("{%s}solidFill" % A_NS)
        if solidFill is not None:
            spPr.remove(solidFill)
        pattFill = parse_xml(
            f'<a:pattFill xmlns:a="{A_NS}" prst="lgDnDiag">'
            f'<a:fgClr><a:srgbClr val="{color}"/></a:fgClr>'
            f'<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr>'
            f'</a:pattFill>'
        )
        ln_el = spPr.find("{%s}ln" % A_NS)
        if ln_el is not None:
            ln_el.addprevious(pattFill)
        else:
            spPr.append(pattFill)

    # ── Native table ────────────────────────────────────────────────────────────
    def _table(self, slide, el: dict):
        """Native PPTX table. PANDO style: dark-green header row with white bold text,
        light-grey zebra striping on body rows, no default PowerPoint banding theme."""
        headers = el.get("headers", [])
        rows = el.get("rows", [])
        n_cols = len(headers)
        n_rows = len(rows) + 1
        x = max(el["x"], 0.85)   # never overlap the template's left margin line
        y, w = el["y"], el["w"]
        header_h = el.get("header_h", 0.32)
        row_h = el.get("row_h", 0.28)
        h = el.get("h", header_h + row_h * len(rows))

        gframe = slide.shapes.add_table(n_rows, n_cols, Inches(x), Inches(y), Inches(w), Inches(h))
        table = gframe.table

        # Strip PowerPoint's default banded theme style so our colors aren't overridden
        tbl_el = table._tbl
        tblPr = tbl_el.find(qn("a:tblPr"))
        if tblPr is not None:
            tblPr.set("firstRow", "0")
            tblPr.set("bandRow", "0")

        col_widths = el.get("col_widths")
        if col_widths:
            for i, cw in enumerate(col_widths[:n_cols]):
                table.columns[i].width = Inches(cw)

        size = el.get("size", 8)

        def _style_cell(cell, text, bold, fg, bg, align):
            cell.fill.solid(); cell.fill.fore_color.rgb = _rgb(bg)
            cell.margin_left = Inches(0.06); cell.margin_right = Inches(0.06)
            cell.margin_top = Inches(0.02); cell.margin_bottom = Inches(0.02)
            cell.vertical_anchor = 3  # middle
            tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
            r = p.add_run(); r.text = str(text)
            r.font.name = DEFAULT_FONT; r.font.size = Pt(size)
            r.font.bold = bold; r.font.color.rgb = _rgb(fg)

        for c, htext in enumerate(headers):
            _style_cell(table.cell(0, c), htext, True, PALETTE["WHT"], PALETTE["DKG"],
                        "l" if c == 0 else "c")
        table.rows[0].height = Inches(header_h)

        zebra = el.get("zebra", True)
        bold_first_col = el.get("bold_first_col", False)
        for ridx, row in enumerate(rows):
            bg = PALETTE["GRG"] if (zebra and ridx % 2 == 1) else PALETTE["WHT"]
            for c, val in enumerate(row):
                _style_cell(table.cell(ridx + 1, c), val, bold_first_col and c == 0,
                            PALETTE["NKB"], bg, "l" if c == 0 else "c")
            table.rows[ridx + 1].height = Inches(row_h)

    # ── Donut chart (market share) ─────────────────────────────────────────────
    def _donut(self, slide, el: dict):
        slices = el.get("slices", [])
        cd = ChartData()
        cd.categories = [s["label"] for s in slices]
        cd.add_series("", [s["value"] for s in slices])
        x, y, w, h = el["x"], el["y"], el["w"], el["h"]
        cf = slide.shapes.add_chart(
            XL_CHART_TYPE.DOUGHNUT, Inches(x), Inches(y), Inches(w), Inches(h), cd
        )
        ch = cf.chart; ch.has_title = False; ch.has_legend = False
        # Per-slice colors
        ser = ch.series[0]
        NS = f'xmlns:c="{C_NS}" xmlns:a="{A_NS}"'
        cat_el = ser._element.find(qn("c:cat"))
        if cat_el is None: cat_el = ser._element.find(qn("c:val"))
        idx = list(ser._element).index(cat_el)
        for i, s in enumerate(slices):
            col = s.get("color", PALETTE["GRG"])
            ser._element.insert(idx + i, parse_xml(
                f'<c:dPt {NS}><c:idx val="{i}"/>'
                f'<c:spPr><a:solidFill><a:srgbClr val="{col}"/></a:solidFill>'
                f'<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>'
            ))
        # Hole size
        hole = el.get("hole", 55)
        for dc in ch._element.findall(".//{%s}doughnutChart" % C_NS):
            hs = dc.find("{%s}holeSize" % C_NS)
            if hs is not None: hs.set("val", str(hole))
            else: dc.append(parse_xml(f'<c:holeSize xmlns:c="{C_NS}" val="{hole}"/>'))

    # ── Scatter chart (CAGR vs EBITDA) ────────────────────────────────────────
    def _scatter(self, slide, el: dict):
        points = el.get("points", [])
        cd = XyChartData()
        for pt in points:
            s = cd.add_series(pt["label"])
            s.add_data_point(pt["x"], pt["y"])
        x, y, w, h = el["x"], el["y"], el["w"], el["h"]
        cf = slide.shapes.add_chart(
            XL_CHART_TYPE.XY_SCATTER, Inches(x), Inches(y), Inches(w), Inches(h), cd
        )
        ch = cf.chart; ch.has_title = False; ch.has_legend = False
        for i, pt in enumerate(points):
            col = pt.get("color", PALETTE["DKG"])
            s = ch.series[i]
            s.format.line.fill.background()
            s.marker.format.fill.solid()
            s.marker.format.fill.fore_color.rgb = _rgb(col)
            s.marker.format.line.fill.background()
            s.marker.size = pt.get("size", 10)
        # Axes
        try:
            ch.value_axis.tick_labels.font.size = Pt(6)
            ch.value_axis.tick_labels.number_format = "0%"
            ch.category_axis.tick_labels.font.size = Pt(6)
            ch.category_axis.tick_labels.number_format = "0%"
        except Exception: pass

    # ── Quadrant positioning map ───────────────────────────────────────────────
    def _quadrant(self, slide, el: dict):
        """Draw a 2×2 quadrant map with brand label textboxes."""
        x, y, w, h = el["x"], el["y"], el["w"], el["h"]
        labels = el.get("axis_labels", {})
        # Draw quadrant lines
        mid_x = x + w / 2; mid_y = y + h / 2
        # Vertical line
        vl = slide.shapes.add_connector(1,
            Inches(mid_x), Inches(y), Inches(mid_x), Inches(y + h))
        vl.line.color.rgb = _rgb("CCCCCC"); vl.line.width = Pt(0.5)
        # Horizontal line
        hl = slide.shapes.add_connector(1,
            Inches(x), Inches(mid_y), Inches(x + w), Inches(mid_y))
        hl.line.color.rgb = _rgb("CCCCCC"); hl.line.width = Pt(0.5)
        # Axis labels
        font = DEFAULT_FONT
        def _lbl(text, lx, ly, lw=1.5, lh=0.22, size=6.5, fg="888888", bold=False, align="c"):
            box = slide.shapes.add_textbox(Inches(lx), Inches(ly), Inches(lw), Inches(lh))
            tf = box.text_frame; p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.CENTER if align == "c" else PP_ALIGN.LEFT
            r = p.add_run(); r.text = text
            r.font.name = font; r.font.size = Pt(size)
            r.font.bold = bold; r.font.color.rgb = _rgb(fg)
        if labels.get("top"):    _lbl(labels["top"],    mid_x-0.75, y-0.25)
        if labels.get("bottom"): _lbl(labels["bottom"], mid_x-0.75, y+h+0.03)
        if labels.get("left"):   _lbl(labels["left"],   x-1.6,      mid_y-0.10, 1.5, align="c")
        if labels.get("right"):  _lbl(labels["right"],  x+w+0.05,   mid_y-0.10, 1.5, align="c")
        # Brand dots
        for brand in el.get("brands", []):
            bx = x + brand["px"] * w   # px: 0-1 horizontal position
            by = y + (1 - brand["py"]) * h  # py: 0-1 vertical (0=bottom)
            col = brand.get("color", PALETTE["DKG"])
            dot = slide.shapes.add_shape(9,  # oval
                Inches(bx - 0.08), Inches(by - 0.08), Inches(0.16), Inches(0.16))
            dot.fill.solid(); dot.fill.fore_color.rgb = _rgb(col)
            dot.line.fill.background()
            # Label
            box = slide.shapes.add_textbox(
                Inches(bx - 0.5), Inches(by + 0.10), Inches(1.0), Inches(0.20))
            tf = box.text_frame; p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
            r = p.add_run(); r.text = brand.get("label", "")
            r.font.name = font; r.font.size = Pt(6.5); r.font.color.rgb = _rgb(col)
