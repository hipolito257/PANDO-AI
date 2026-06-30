"""
PptxBuilder — builds PANDO presentations from a JSON slide plan.
Accepts a template PPTX (bytes) + slide_plan dict, returns PPTX bytes.
"""
import copy
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

PALETTE = {
    "DKG": "004F46", "MDG": "437742", "OLV": "806E4B", "TEL": "4B5F62",
    "GRG": "D9DBD4", "NKB": "0A231F", "WHT": "FFFFFF", "LBL": "A5C8D1",
}

LAYOUT_MAP = {
    "cover":      (2, 0),
    "takeaway":   (1, 0),
    "divider":    (0, 2),
    "blank":      (2, 0),
    "back_cover": (2, 0),
}

PH = {"cat": 18, "title": 16, "takeaway": 17, "note": 14, "content": 26}


# ── Safe value helpers ─────────────────────────────────────────────────────────

def _rgb(h) -> RGBColor:
    """Convert a hex string to RGBColor. Returns DKG green for any invalid input."""
    _fallback = RGBColor(0x00, 0x4F, 0x46)
    if not isinstance(h, str) or not h:
        return _fallback
    h = h.lstrip("#")
    if len(h) != 6:
        return _fallback
    try:
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except (ValueError, TypeError):
        return _fallback


def _str(val, default: str = "") -> str:
    """Return val as a string, falling back to default for None/False/True."""
    if val is None or val is False or val is True:
        return default
    return str(val)


def _num(val, default: float = 0.0) -> float:
    """Return val as float, falling back to default for non-numeric values."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


CONTENT_X = 0.918      # left edge of title/takeaway/content placeholders in the template (839788 EMU)
CONTENT_RIGHT = 12.415  # right edge of the content placeholder (839788 + 10512714 EMU) — symmetric margin


def _geom(el: dict, defaults=(CONTENT_X, 2.0, 11.5, 4.0)):
    """Extract x, y, w, h from element dict with safe defaults and content-area clamps.
    y minimum is 2.0" — where the main content area starts in the template (1826680 EMU).
    x minimum is 0.918" and right edge capped at 12.415" — matches the template's title/
    takeaway/content placeholder bounds exactly, so generated elements stay left- and
    right-aligned with the headers instead of drifting outside them."""
    x = max(_num(el.get("x"), defaults[0]), CONTENT_X)
    y = max(_num(el.get("y"), defaults[1]), 2.0)
    w = max(_num(el.get("w"), defaults[2]), 0.1)
    h = max(_num(el.get("h"), defaults[3]), 0.1)
    if x + w > CONTENT_RIGHT:
        w = max(CONTENT_RIGHT - x, 0.1)
    return x, y, w, h


# ── Builder ────────────────────────────────────────────────────────────────────

class PptxBuilder:
    def __init__(self, template_bytes: bytes):
        self.prs = Presentation(io.BytesIO(template_bytes))
        self._save_template_covers()
        self._clear_slides()

    def _save_template_covers(self):
        slides = list(self.prs.slides)
        self._cover_info = None
        self._back_cover_info = None
        if slides:
            self._cover_info = self._capture_slide(slides[0])
        if len(slides) >= 2:
            self._back_cover_info = self._capture_slide(slides[-1])

    def _capture_slide(self, slide) -> dict:
        rels = []
        for rId, rel in slide.part.rels.items():
            if "notesSlide" in rel.reltype or "slideLayout" in rel.reltype:
                continue
            rels.append((rId, rel))
        return {"xml": copy.deepcopy(slide._element), "rels": rels}

    def _restore_slide(self, info: dict) -> Any:
        mi = min(0, len(self.prs.slide_masters) - 1)
        li = min(0, len(self.prs.slide_masters[mi].slide_layouts) - 1)
        layout = self.prs.slide_masters[mi].slide_layouts[li]
        slide = self.prs.slides.add_slide(layout)
        slide._element = info["xml"]
        for rId, rel in info["rels"]:
            try:
                slide.part._rels[rId] = rel
            except Exception:
                pass
        return slide

    def _clear_slides(self):
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
        slides_data = slide_plan.get("slides", [])
        cover_data      = next((s for s in slides_data if s.get("layout") == "cover"),      {})
        back_cover_data = next((s for s in slides_data if s.get("layout") == "back_cover"), {})
        content_slides  = [s for s in slides_data if s.get("layout") not in ("cover", "back_cover")]

        if self._cover_info:
            cover_slide = self._restore_slide(self._cover_info)
            if cover_data:
                self._update_cover_text(cover_slide, cover_data)
        else:
            mi = min(2, len(self.prs.slide_masters) - 1)
            li = min(0, len(self.prs.slide_masters[mi].slide_layouts) - 1)
            slide = self.prs.slides.add_slide(self.prs.slide_masters[mi].slide_layouts[li])
            self._draw_cover(slide, cover_data)

        for sd in content_slides:
            try:
                self._add_slide(sd)
            except Exception:
                pass  # skip broken slides rather than crashing the build

        if self._back_cover_info:
            self._restore_slide(self._back_cover_info)
        else:
            mi = min(2, len(self.prs.slide_masters) - 1)
            li = min(0, len(self.prs.slide_masters[mi].slide_layouts) - 1)
            slide = self.prs.slides.add_slide(self.prs.slide_masters[mi].slide_layouts[li])
            self._draw_back_cover(slide, back_cover_data)

        out = io.BytesIO()
        self.prs.save(out)
        return out.getvalue()

    def _update_cover_text(self, slide, cover_data: dict):
        title    = _str(cover_data.get("title")).strip()
        subtitle = _str(cover_data.get("subtitle")).strip()
        if not title and not subtitle:
            return

        shapes_by_size = []
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            max_sz = 0
            for para in shape.text_frame.paragraphs:
                for run in para.runs:
                    sz = run.font.size or 0
                    if sz > max_sz:
                        max_sz = sz
            if max_sz > 0:
                shapes_by_size.append((max_sz, shape))
        shapes_by_size.sort(reverse=True)

        def _replace_text(shape, new_text: str):
            tf = shape.text_frame
            first_run_el = None
            for para in tf.paragraphs:
                for run in para.runs:
                    first_run_el = copy.deepcopy(run._r)
                    break
                if first_run_el is not None:
                    break
            tf.clear()
            p = tf.paragraphs[0]
            if first_run_el is not None:
                t_el = first_run_el.find(qn("a:t"))
                if t_el is not None:
                    t_el.text = new_text
                p._p.append(first_run_el)
            else:
                r = p.add_run()
                r.text = new_text
                r.font.color.rgb = _rgb(PALETTE["WHT"])

        if title and shapes_by_size:
            _replace_text(shapes_by_size[0][1], title)
        if subtitle and len(shapes_by_size) > 1:
            title_shape = shapes_by_size[0][1]
            for _, shape in shapes_by_size[1:]:
                if shape is not title_shape:
                    _replace_text(shape, subtitle)
                    break

    # ── Slide assembly ─────────────────────────────────────────────────────────
    def _add_slide(self, sd: dict):
        layout_key = _str(sd.get("layout"), "takeaway")
        mi, li = LAYOUT_MAP.get(layout_key, (1, 0))
        mi = min(mi, len(self.prs.slide_masters) - 1)
        li = min(li, len(self.prs.slide_masters[mi].slide_layouts) - 1)
        layout = self.prs.slide_masters[mi].slide_layouts[li]
        slide = self.prs.slides.add_slide(layout)

        self._fill_phs(slide, sd)

        elements = [el for el in sd.get("elements", []) if isinstance(el, dict)]
        # Shift all elements up so the topmost one starts at y=2.0" (content area start).
        # This corrects Claude placing the first element at e.g. y=2.8 which leaves a large gap.
        if elements and layout_key != "divider":
            min_y = min(_num(el.get("y"), 2.0) for el in elements)
            if min_y > 2.0:
                shift = min_y - 2.0
                for el in elements:
                    el["y"] = _num(el.get("y"), min_y) - shift

        for el in elements:
            self._element(slide, el)

    def _fill_phs(self, slide, sd: dict):
        layout_key = _str(sd.get("layout"), "takeaway")
        title_val    = _str(sd.get("title"))    or None
        takeaway_val = _str(sd.get("takeaway")) or None
        cat_val      = _str(sd.get("category")) or None
        note_val     = _str(sd.get("note"))     or None

        phs = list(slide.placeholders)

        if layout_key == "divider":
            # Divider slides live on a different master with different placeholder
            # indices — fill by vertical position rather than by index number.
            text_phs = sorted(
                [p for p in phs if p.has_text_frame],
                key=lambda p: p.top if p.top is not None else 0,
            )
            filled = set()
            if text_phs and title_val:
                self._set_markdown_text(text_phs[0], title_val)
                filled.add(id(text_phs[0]))
            if len(text_phs) > 1 and takeaway_val:
                self._set_markdown_text(text_phs[1], takeaway_val)
                filled.add(id(text_phs[1]))
            for ph in phs:
                if id(ph) not in filled:
                    sp = ph._element
                    parent = sp.getparent()
                    if parent is not None:
                        parent.remove(sp)
            return

        # Regular content slides: fill by known placeholder index
        mapping = {
            PH["cat"]:      cat_val,
            PH["title"]:    title_val,
            PH["takeaway"]: takeaway_val,
            PH["note"]:     note_val,
        }
        to_remove = []
        for ph in phs:
            idx = ph.placeholder_format.idx
            val = mapping.get(idx)
            if val:
                self._set_markdown_text(ph, val)
            else:
                to_remove.append(ph)
        for ph in to_remove:
            sp = ph._element
            parent = sp.getparent()
            if parent is not None:
                parent.remove(sp)

    # ── Cover fallback ─────────────────────────────────────────────────────────
    def _draw_cover(self, slide, sd: dict):
        W, H = 13.33, 7.5

        def _txt(text, x, y, w, h, size, bold=False, italic=False, fg=PALETTE["NKB"], align="l", wrap=True):
            box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
            tf = box.text_frame; tf.word_wrap = wrap
            p = tf.paragraphs[0]
            p.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
            r = p.add_run(); r.text = _str(text)
            r.font.name = DEFAULT_FONT; r.font.size = Pt(size)
            r.font.bold = bold; r.font.italic = italic
            r.font.color.rgb = _rgb(fg)

        def _rect(x, y, w, h, color):
            sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
            sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(color)
            sh.line.fill.background()

        _rect(0, 0, 0.40, H, PALETTE["DKG"])
        _rect(0.40, H * 0.6, W - 0.40, 0.04, PALETTE["OLV"])
        _txt(sd.get("title", sd.get("company", "")), 0.75, 2.20, W - 1.2, 1.40, 44, bold=True, fg=PALETTE["NKB"])
        _txt(sd.get("subtitle", "Investment Overview"),  0.75, 3.80, W - 1.2, 0.60, 20, fg=PALETTE["TEL"])
        _rect(0.75, 3.70, W - 1.5, 0.025, PALETTE["DKG"])
        _txt("Private & Confidential", 0.75, H - 0.65, 6, 0.35, 8, italic=True, fg="999999")
        _txt("STRICTLY CONFIDENTIAL", 0.02, 2.5, 0.28, 3.5, 6.5, fg=PALETTE["WHT"], align="c", wrap=True)

    def _draw_back_cover(self, slide, sd: dict):
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
            r = p.add_run(); r.text = _str(text)
            r.font.name = DEFAULT_FONT; r.font.size = Pt(size)
            r.font.bold = bold; r.font.italic = italic
            r.font.color.rgb = _rgb(fg)

        _rect(0, 0, W, H, PALETTE["DKG"])
        _rect(0, H * 0.75, W, 0.05, PALETTE["OLV"])
        _txt(sd.get("title", "Preguntas"), 1, H / 2 - 0.8, W - 2, 1.4, 48, bold=True)
        subtitle = _str(sd.get("subtitle"))
        if subtitle:
            _txt(subtitle, 1, H / 2 + 0.7, W - 2, 0.5, 16, fg="A5C8D1")
        _txt("pando.vc  |  Private & Confidential", 0, H - 0.55, W, 0.35, 9, italic=True)

    def _set_markdown_text(self, ph, text: str):
        tf = ph.text_frame
        tf.clear()
        lines = _str(text).split("\n")
        for line_idx, line in enumerate(lines):
            p = tf.paragraphs[0] if line_idx == 0 else tf.add_paragraph()
            for part in re.split(r'(\*\*.*?\*\*)', line):
                if not part:
                    continue
                r = p.add_run()
                if part.startswith("**") and part.endswith("**"):
                    r.text = part[2:-2]
                    r.font.bold = True
                else:
                    r.text = part

    # ── Element dispatcher ─────────────────────────────────────────────────────
    def _element(self, slide, el: dict):
        t = _str(el.get("type"))

        # Skip text-only elements with no actual content
        if t in ("textbox", "panel_hdr") and not _str(el.get("text")).strip():
            return
        if t == "shape" and not _str(el.get("text")).strip() and not el.get("bg") and not el.get("border"):
            return
        # Skip chart elements with no data
        if t in ("line", "line_multi", "bar") and not el.get("labels") and not el.get("series"):
            return
        if t == "hbar_float" and not el.get("series"):
            return
        if t == "donut" and not el.get("slices"):
            return
        if t == "scatter" and not el.get("points"):
            return
        if t == "table" and not el.get("headers"):
            return

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
        if not fn:
            return
        try:
            fn(slide, el)
        except Exception:
            pass  # skip broken elements; never crash the whole slide

    # ── Basic shapes / text ────────────────────────────────────────────────────
    def _panel_hdr(self, slide, el: dict):
        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 0.27))
        h = max(_num(el.get("h"), 0.27), 0.1)
        bg = el.get("bg", PALETTE["DKG"])
        sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
        sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(bg)
        sh.line.fill.background()
        tf = sh.text_frame; tf.word_wrap = False
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.LEFT
        r = p.add_run(); r.text = _str(el.get("text"))
        r.font.name = DEFAULT_FONT; r.font.size = Pt(_num(el.get("size"), 7.5))
        r.font.bold = True; r.font.color.rgb = _rgb(PALETTE["WHT"])

    def _textbox(self, slide, el: dict):
        x, y, w, h = _geom(el, (0.85, 1.78, 5.0, 0.25))
        h = max(_num(el.get("h"), 0.25), 0.1)
        box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = box.text_frame; tf.word_wrap = el.get("wrap", True)
        align_map = {"c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT, "l": PP_ALIGN.LEFT}
        font_size  = Pt(_num(el.get("size"), 7.5))
        font_bold  = bool(el.get("bold", False))
        font_ital  = bool(el.get("italic", False))
        font_color = _rgb(el.get("fg", PALETTE["NKB"]))
        align      = align_map.get(_str(el.get("align"), "l"), PP_ALIGN.LEFT)
        lines = _str(el.get("text")).split("\n")
        for i, line in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            r = p.add_run()
            r.text = line
            r.font.name = DEFAULT_FONT; r.font.size = font_size
            r.font.bold = font_bold; r.font.italic = font_ital
            r.font.color.rgb = font_color

    def _shape(self, slide, el: dict):
        x, y, w, h = _geom(el, (0.85, 1.78, 5.0, 0.27))
        h = max(_num(el.get("h"), 0.27), 0.1)
        sh = slide.shapes.add_shape(1, Inches(x), Inches(y), Inches(w), Inches(h))
        bg = el.get("bg")
        if bg and isinstance(bg, str):
            sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(bg)
        else:
            sh.fill.background()
        border = el.get("border")
        if border and isinstance(border, str):
            sh.line.color.rgb = _rgb(border)
            sh.line.width = Pt(_num(el.get("border_pt"), 0.75))
        else:
            sh.line.fill.background()
        text = _str(el.get("text"))
        if text:
            tf = sh.text_frame; tf.word_wrap = True
            font_size  = Pt(_num(el.get("size"), 8))
            font_bold  = bool(el.get("bold", False))
            font_color = _rgb(el.get("fg", PALETTE["WHT"]))
            lines = text.split("\n")
            for i, line in enumerate(lines):
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                p.alignment = PP_ALIGN.CENTER
                r = p.add_run(); r.text = line
                r.font.name = DEFAULT_FONT; r.font.size = font_size
                r.font.bold = font_bold; r.font.color.rgb = font_color

    # ── Charts: shared helpers ─────────────────────────────────────────────────
    def _smooth_all(self, ch):
        for ser_el in ch._element.findall(".//{%s}ser" % C_NS):
            sm = ser_el.find("{%s}smooth" % C_NS)
            if sm is None:
                ser_el.append(parse_xml(f'<c:smooth xmlns:c="{C_NS}" val="1"/>'))
            else:
                sm.set("val", "1")

    def _fix_catax(self, ch, skip: int = 1):
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
        try:
            va = ch.value_axis
            if ymin is not None: va.minimum_scale = _num(ymin)
            if ymax is not None: va.maximum_scale = _num(ymax)
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
        except Exception: pass
        try:
            ca = ch.category_axis
            ca.has_major_gridlines = False
            ca.tick_labels.font.size = Pt(csize)
            ca.tick_labels.font.color.rgb = _rgb("999999")
            try:
                ca.format.line.color.rgb = _rgb("DDDDD8")
                ca.format.line.width = Pt(0.25)
            except Exception: pass
            self._fix_catax(ch, skip)
        except Exception: pass

    def _set_line_style(self, series, color, width_pt: float = 1.5, dashed: bool = False):
        try:
            series.format.line.color.rgb = _rgb(color)
            series.format.line.width = Pt(_num(width_pt, 1.5))
            if dashed:
                ser_el = series._element
                spPr = ser_el.find("{%s}spPr" % C_NS)
                if spPr is not None:
                    ln = spPr.find("{%s}ln" % A_NS)
                    if ln is not None:
                        pd = etree.SubElement(ln, "{%s}prstDash" % A_NS)
                        pd.set("val", "dash")
        except Exception: pass

    def _color_bar_points(self, series, colors: list, n: int):
        NS = (f'xmlns:c="{C_NS}" xmlns:a="{A_NS}"')
        cat_el = series._element.find(qn("c:cat"))
        if cat_el is None:
            cat_el = series._element.find(qn("c:val"))
        if cat_el is None:
            return  # can't determine insertion point — skip coloring
        idx = list(series._element).index(cat_el)
        for i in range(n):
            col = _str(colors[i % len(colors)], PALETTE["DKG"]) if colors else PALETTE["DKG"]
            series._element.insert(idx + i, parse_xml(
                f'<c:dPt {NS}><c:idx val="{i}"/>'
                f'<c:invertIfNegative val="0"/>'
                f'<c:spPr><a:solidFill><a:srgbClr val="{col}"/></a:solidFill>'
                f'<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>'
            ))

    # ── Horizontal floating bar (pricing ranges) ───────────────────────────────
    def _hbar_float(self, slide, el: dict):
        series_defs = el.get("series", [])
        if not series_defs:
            return
        labels = [_str(s.get("label", "")) for s in series_defs]
        lows   = [_num(s.get("min"), 0) for s in series_defs]
        highs  = [max(_num(s.get("max"), 0) - _num(s.get("min"), 0), 0) for s in series_defs]

        cd = ChartData()
        cd.categories = labels
        cd.add_series("spacer", lows)
        cd.add_series("range",  highs)

        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 4.0))
        cf = slide.shapes.add_chart(XL_CHART_TYPE.BAR_STACKED, Inches(x), Inches(y), Inches(w), Inches(h), cd)
        ch = cf.chart
        ch.has_title = False; ch.has_legend = False

        sp = ch.series[0]
        sp.format.fill.background()
        sp.format.line.fill.background()

        colors = el.get("colors") or [PALETTE["DKG"], PALETTE["MDG"], PALETTE["OLV"], PALETTE["TEL"], PALETTE["LBL"], PALETTE["GRG"]]
        rng = ch.series[1]
        self._color_bar_points(rng, colors, len(series_defs))

        try:
            ch.value_axis.has_major_gridlines = True
            ch.value_axis.major_gridlines.format.line.color.rgb = _rgb("EBEBEB")
            ch.value_axis.major_gridlines.format.line.width = Pt(0.25)
            ch.value_axis.tick_labels.font.size = Pt(6)
            ch.value_axis.tick_labels.font.color.rgb = _rgb("999999")
            ch.value_axis.tick_labels.number_format = "#,##0"
            ch.category_axis.has_major_gridlines = False
            ch.category_axis.tick_labels.font.size = Pt(7)
            ch.category_axis.tick_labels.font.color.rgb = _rgb("444444")
        except Exception: pass
        try: ch.plot_area.format.line.fill.background()
        except Exception: pass

    # ── Single-series line chart ───────────────────────────────────────────────
    def _line(self, slide, el: dict):
        labels = el.get("labels") or []
        values = [_num(v) for v in (el.get("values") or [])]
        if not labels or not values:
            return
        cd = ChartData()
        cd.categories = [_str(l) for l in labels]
        cd.add_series("", values)
        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 4.0))
        cf = slide.shapes.add_chart(XL_CHART_TYPE.LINE, Inches(x), Inches(y), Inches(w), Inches(h), cd)
        ch = cf.chart; ch.has_title = False; ch.has_legend = False
        self._set_line_style(ch.series[0], el.get("color", PALETTE["MDG"]), _num(el.get("width"), 1.8))
        self._smooth_all(ch)
        self._style_axes(ch, ymin=el.get("ymin"), ymax=el.get("ymax"),
                         num_fmt=_str(el.get("num_fmt"), "#,##0"),
                         skip=int(_num(el.get("skip"), 6)), csize=5.5)

    # ── Multi-series line chart ────────────────────────────────────────────────
    def _line_multi(self, slide, el: dict):
        series_list = el.get("series") or []
        labels = [_str(l) for l in (el.get("labels") or [])]
        if not labels or not series_list:
            return
        cd = ChartData()
        cd.categories = labels
        for s in series_list:
            vals = [_num(v) for v in (s.get("values") or [])]
            if len(vals) < len(labels):
                last = vals[-1] if vals else 0.0
                vals = vals + [last] * (len(labels) - len(vals))
            cd.add_series(_str(s.get("name"), ""), vals)
        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 4.0))
        cf = slide.shapes.add_chart(XL_CHART_TYPE.LINE, Inches(x), Inches(y), Inches(w), Inches(h), cd)
        ch = cf.chart; ch.has_title = False
        for i, s in enumerate(series_list):
            if i < len(ch.series):
                self._set_line_style(ch.series[i], s.get("color", PALETTE["DKG"]),
                                     _num(s.get("width"), 1.4), dashed=bool(s.get("dashed")))
        self._smooth_all(ch)
        self._style_axes(ch, ymin=_num(el.get("ymin"), 0), ymax=el.get("ymax"),
                         num_fmt=_str(el.get("num_fmt"), "#,##0"),
                         skip=int(_num(el.get("skip"), 1)), csize=5)
        ch.has_legend = True
        ch.legend.position = XL_LEGEND_POSITION.BOTTOM
        ch.legend.include_in_layout = False

    # ── Clustered column chart ─────────────────────────────────────────────────
    def _bar(self, slide, el: dict):
        series_list = el.get("series") or []
        labels = [_str(l) for l in (el.get("labels") or [])]
        if not labels or not series_list:
            return
        cd = ChartData()
        cd.categories = labels
        for s in series_list:
            cd.add_series(_str(s.get("name"), ""), [_num(v) for v in (s.get("values") or [])])
        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 4.0))
        cf = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(x), Inches(y), Inches(w), Inches(h), cd)
        ch = cf.chart; ch.has_title = False

        for i, s in enumerate(series_list):
            if i >= len(ch.series):
                break
            ser = ch.series[i]
            col = s.get("color", PALETTE["DKG"])
            ser.format.fill.solid(); ser.format.fill.fore_color.rgb = _rgb(col)
            ser.format.line.fill.background()
            if s.get("hatched"):
                self._set_hatch(ser, _str(col, PALETTE["DKG"]))
            if s.get("data_labels"):
                try:
                    ser.has_data_labels = True
                    dl = ser.data_labels
                    dl.number_format = _str(el.get("num_fmt"), "0%")
                    dl.number_format_is_linked = False
                    dl.font.size = Pt(7); dl.font.bold = False
                    dl.font.color.rgb = _rgb("444444")
                    dl.position = XL_LABEL_POSITION.OUTSIDE_END
                except Exception: pass

        try:
            ch.plot_area.gap_width = int(_num(el.get("gap_width"), 60))
            ch.plot_area.overlap   = int(_num(el.get("overlap"), -10))
        except Exception: pass

        self._style_axes(ch, ymin=_num(el.get("ymin"), 0), ymax=el.get("ymax"),
                         num_fmt=_str(el.get("num_fmt"), "0%"),
                         skip=int(_num(el.get("skip"), 1)), csize=6.5)

        if len(series_list) > 1:
            ch.has_legend = True
            ch.legend.position = XL_LEGEND_POSITION.BOTTOM
            ch.legend.include_in_layout = False
        else:
            ch.has_legend = False

    def _set_hatch(self, series, color: str):
        try:
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
        except Exception: pass

    # ── Table ─────────────────────────────────────────────────────────────────
    def _table(self, slide, el: dict):
        headers = el.get("headers") or []
        rows    = el.get("rows")    or []
        if not headers:
            return
        n_cols = len(headers)
        n_rows = len(rows) + 1
        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 3.0))
        header_h = max(_num(el.get("header_h"), 0.32), 0.1)
        row_h    = max(_num(el.get("row_h"),    0.28), 0.1)
        h = max(_num(el.get("h"), header_h + row_h * len(rows)), 0.2)

        gframe = slide.shapes.add_table(n_rows, n_cols, Inches(x), Inches(y), Inches(w), Inches(h))
        table = gframe.table

        tbl_el = table._tbl
        tblPr = tbl_el.find(qn("a:tblPr"))
        if tblPr is not None:
            tblPr.set("firstRow", "0")
            tblPr.set("bandRow", "0")

        col_widths = el.get("col_widths")
        if col_widths and isinstance(col_widths, list):
            for i, cw in enumerate(col_widths[:n_cols]):
                try:
                    table.columns[i].width = Inches(_num(cw, 1.0))
                except Exception: pass

        size = _num(el.get("size"), 8)

        def _style_cell(cell, text, bold, fg, bg, align):
            try:
                cell.fill.solid(); cell.fill.fore_color.rgb = _rgb(bg)
                cell.margin_left = Inches(0.06); cell.margin_right = Inches(0.06)
                cell.margin_top = Inches(0.02);  cell.margin_bottom = Inches(0.02)
                cell.vertical_anchor = 3
                tf = cell.text_frame; tf.word_wrap = True
                p = tf.paragraphs[0]
                p.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
                r = p.add_run(); r.text = _str(text)
                r.font.name = DEFAULT_FONT; r.font.size = Pt(size)
                r.font.bold = bold; r.font.color.rgb = _rgb(fg)
            except Exception: pass

        for c, htext in enumerate(headers):
            _style_cell(table.cell(0, c), htext, True, PALETTE["WHT"], PALETTE["DKG"],
                        "l" if c == 0 else "c")
        try: table.rows[0].height = Inches(header_h)
        except Exception: pass

        zebra           = el.get("zebra", True)
        bold_first_col  = el.get("bold_first_col", False)
        for ridx, row in enumerate(rows):
            bg = PALETTE["GRG"] if (zebra and ridx % 2 == 1) else PALETTE["WHT"]
            row_vals = list(row) if isinstance(row, (list, tuple)) else []
            for c in range(n_cols):
                val = row_vals[c] if c < len(row_vals) else ""
                _style_cell(table.cell(ridx + 1, c), val, bold_first_col and c == 0,
                            PALETTE["NKB"], bg, "l" if c == 0 else "c")
            try: table.rows[ridx + 1].height = Inches(row_h)
            except Exception: pass

    # ── Donut chart ────────────────────────────────────────────────────────────
    def _donut(self, slide, el: dict):
        slices = el.get("slices") or []
        if not slices:
            return
        cd = ChartData()
        cd.categories = [_str(s.get("label", "")) for s in slices]
        cd.add_series("", [_num(s.get("value"), 0) for s in slices])
        x, y, w, h = _geom(el, (0.85, 1.78, 5.0, 4.0))
        cf = slide.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT, Inches(x), Inches(y), Inches(w), Inches(h), cd)
        ch = cf.chart; ch.has_title = False; ch.has_legend = False
        ser = ch.series[0]
        NS = f'xmlns:c="{C_NS}" xmlns:a="{A_NS}"'
        cat_el = ser._element.find(qn("c:cat"))
        if cat_el is None:
            cat_el = ser._element.find(qn("c:val"))
        if cat_el is not None:
            idx = list(ser._element).index(cat_el)
            for i, s in enumerate(slices):
                col = _str(s.get("color"), PALETTE["GRG"])
                ser._element.insert(idx + i, parse_xml(
                    f'<c:dPt {NS}><c:idx val="{i}"/>'
                    f'<c:spPr><a:solidFill><a:srgbClr val="{col}"/></a:solidFill>'
                    f'<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>'
                ))
        hole = int(_num(el.get("hole"), 55))
        for dc in ch._element.findall(".//{%s}doughnutChart" % C_NS):
            hs = dc.find("{%s}holeSize" % C_NS)
            if hs is not None: hs.set("val", str(hole))
            else: dc.append(parse_xml(f'<c:holeSize xmlns:c="{C_NS}" val="{hole}"/>'))

    # ── Scatter chart ──────────────────────────────────────────────────────────
    def _scatter(self, slide, el: dict):
        points = el.get("points") or []
        if not points:
            return
        cd = XyChartData()
        for pt in points:
            s = cd.add_series(_str(pt.get("label", "")))
            s.add_data_point(_num(pt.get("x")), _num(pt.get("y")))
        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 4.0))
        cf = slide.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, Inches(x), Inches(y), Inches(w), Inches(h), cd)
        ch = cf.chart; ch.has_title = False; ch.has_legend = False
        for i, pt in enumerate(points):
            if i >= len(ch.series):
                break
            try:
                s = ch.series[i]
                s.format.line.fill.background()
                s.marker.format.fill.solid()
                s.marker.format.fill.fore_color.rgb = _rgb(pt.get("color", PALETTE["DKG"]))
                s.marker.format.line.fill.background()
                s.marker.size = int(_num(pt.get("size"), 10))
            except Exception: pass
        try:
            ch.value_axis.tick_labels.font.size = Pt(6)
            ch.value_axis.tick_labels.number_format = "0%"
            ch.category_axis.tick_labels.font.size = Pt(6)
            ch.category_axis.tick_labels.number_format = "0%"
        except Exception: pass

    # ── Quadrant map ───────────────────────────────────────────────────────────
    def _quadrant(self, slide, el: dict):
        x, y, w, h = _geom(el, (0.85, 1.78, 12.18, 4.0))
        labels = el.get("axis_labels") or {}
        mid_x = x + w / 2; mid_y = y + h / 2
        try:
            vl = slide.shapes.add_connector(1, Inches(mid_x), Inches(y), Inches(mid_x), Inches(y + h))
            vl.line.color.rgb = _rgb("CCCCCC"); vl.line.width = Pt(0.5)
            hl = slide.shapes.add_connector(1, Inches(x), Inches(mid_y), Inches(x + w), Inches(mid_y))
            hl.line.color.rgb = _rgb("CCCCCC"); hl.line.width = Pt(0.5)
        except Exception: pass

        def _lbl(text, lx, ly, lw=1.5, lh=0.22, size=6.5, fg="888888", align="c"):
            try:
                box = slide.shapes.add_textbox(Inches(lx), Inches(ly), Inches(lw), Inches(lh))
                tf = box.text_frame; p = tf.paragraphs[0]
                p.alignment = PP_ALIGN.CENTER if align == "c" else PP_ALIGN.LEFT
                r = p.add_run(); r.text = _str(text)
                r.font.name = DEFAULT_FONT; r.font.size = Pt(size)
                r.font.color.rgb = _rgb(fg)
            except Exception: pass

        if labels.get("top"):    _lbl(labels["top"],    mid_x - 0.75, y - 0.25)
        if labels.get("bottom"): _lbl(labels["bottom"], mid_x - 0.75, y + h + 0.03)
        if labels.get("left"):   _lbl(labels["left"],   x - 1.6,      mid_y - 0.10)
        if labels.get("right"):  _lbl(labels["right"],  x + w + 0.05, mid_y - 0.10)

        for brand in (el.get("brands") or []):
            try:
                bx = x + _num(brand.get("px")) * w
                by = y + (1 - _num(brand.get("py"))) * h
                col = _str(brand.get("color"), PALETTE["DKG"])
                dot = slide.shapes.add_shape(9, Inches(bx - 0.08), Inches(by - 0.08), Inches(0.16), Inches(0.16))
                dot.fill.solid(); dot.fill.fore_color.rgb = _rgb(col)
                dot.line.fill.background()
                box = slide.shapes.add_textbox(Inches(bx - 0.5), Inches(by + 0.10), Inches(1.0), Inches(0.20))
                tf = box.text_frame; p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
                r = p.add_run(); r.text = _str(brand.get("label"))
                r.font.name = DEFAULT_FONT; r.font.size = Pt(6.5)
                r.font.color.rgb = _rgb(col)
            except Exception: pass
