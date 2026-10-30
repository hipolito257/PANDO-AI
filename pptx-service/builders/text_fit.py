"""
Text measurement for template slides: resolves the effective font size / face /
weight of a paragraph through PowerPoint's inheritance chain (run → shape list
style → layout placeholder → master placeholder → master text styles →
presentation defaults) and estimates how many lines a string needs in a box.

There is no renderer on the server, so widths come from Helvetica's AFM metrics
scaled by a per-family factor. That is accurate to a few percent for typical
sans-serif decks, which is enough to size copy and to shrink text that would
overflow.
"""
from __future__ import annotations

import re
from lxml import etree

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS = {"a": A, "p": P}
EMU_PER_IN = 914400

# Helvetica widths per 1000 em for ASCII 32..126
_HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
         556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
         1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
         667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
         333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
         556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
_ACCENTS = str.maketrans("áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ",
                         "aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC")

# Width relative to Helvetica, by family substring (lowercase). Unknown → 1.05
# (slightly wide on purpose: overestimating length errs toward shorter copy).
_FAMILY_FACTOR = [
    ("narrow", 0.82), ("condensed", 0.82), ("calibri", 0.9), ("times", 0.9), ("garamond", 0.9),
    ("aptos", 0.97), ("arial", 1.0), ("helvetica", 1.0), ("segoe", 0.98), ("roboto", 0.98),
    ("lato", 0.97), ("source sans", 0.95), ("inter", 1.03), ("open sans", 1.05), ("georgia", 1.05),
    ("work sans", 1.1), ("gotham", 1.1), ("montserrat", 1.12), ("verdana", 1.15), ("poppins", 1.12),
]


def family_factor(face: str | None) -> float:
    f = (face or "").lower()
    for key, factor in _FAMILY_FACTOR:
        if key in f:
            return factor
    return 1.05


def text_width_pt(text: str, size_pt: float, face: str | None = None, bold: bool = False, caps: bool = False) -> float:
    if caps:
        text = text.upper()
    total = 0
    for ch in text.translate(_ACCENTS):
        o = ord(ch)
        total += _HELV[o - 32] if 32 <= o <= 126 else 556
    w = total / 1000 * size_pt * family_factor(face)
    return w * (1.06 if bold else 1.0)


def wrap_lines(text: str, width_pt: float, size_pt: float, face: str | None, bold: bool = False, caps: bool = False) -> int:
    """Lines needed for one paragraph when word-wrapped into width_pt."""
    if width_pt <= 0:
        return 999
    if not text.strip():
        return 1
    space = text_width_pt(" ", size_pt, face, bold, caps)
    lines, cur = 1, 0.0
    for word in text.split():
        w = text_width_pt(word, size_pt, face, bold, caps)
        if cur == 0:
            # A word longer than the line breaks across lines.
            lines += int(w // width_pt) if w > width_pt else 0
            cur = w % width_pt if w > width_pt else w
        elif cur + space + w <= width_pt:
            cur += space + w
        else:
            lines += 1
            cur = w if w <= width_pt else w % width_pt
    return lines


# ── Inheritance resolution ───────────────────────────────────────────────────

def _lvl_props(lst_style, level: int) -> dict:
    """defRPr / pPr attributes for a level from an a:lstStyle-like element."""
    out: dict = {}
    if lst_style is None:
        return out
    lvl = lst_style.find(f"a:lvl{level + 1}pPr", NS)
    if lvl is None:
        return out
    _merge_ppr(out, lvl)
    d = lvl.find("a:defRPr", NS)
    if d is not None:
        _merge_rpr(out, d)
    return out


def _merge_rpr(out: dict, rpr) -> None:
    if rpr is None:
        return
    if rpr.get("sz") and "size" not in out:
        out["size"] = int(rpr.get("sz")) / 100
    if rpr.get("b") is not None and "bold" not in out:
        out["bold"] = rpr.get("b") in ("1", "true")
    if rpr.get("cap") and "caps" not in out:
        out["caps"] = rpr.get("cap") == "all"
    latin = rpr.find("a:latin", NS)
    if latin is not None and latin.get("typeface") and "face" not in out:
        out["face"] = latin.get("typeface")


def _merge_ppr(out: dict, ppr) -> None:
    if ppr is None:
        return
    ln = ppr.find("a:lnSpc", NS)
    if ln is not None and "line_spacing" not in out:
        pct = ln.find("a:spcPct", NS)
        pts = ln.find("a:spcPts", NS)
        if pct is not None:
            out["line_spacing"] = ("pct", int(pct.get("val")) / 100000)
        elif pts is not None:
            out["line_spacing"] = ("pts", int(pts.get("val")) / 100)
    for tag, key in (("a:spcBef", "space_before"), ("a:spcAft", "space_after")):
        el = ppr.find(tag, NS)
        if el is not None and key not in out:
            pts = el.find("a:spcPts", NS)
            out[key] = int(pts.get("val")) / 100 if pts is not None else 0


class StyleResolver:
    """Resolves effective text properties for shapes on a slide."""

    def __init__(self, prs):
        self.prs = prs
        self.theme_fonts = self._theme_fonts()
        pres_el = prs.part._element
        self.default_style = pres_el.find("p:defaultTextStyle", NS)

    def _theme_fonts(self) -> dict:
        fonts = {"major": None, "minor": None}
        try:
            master = self.prs.slide_masters[0]
            for rel in master.part.rels.values():
                if rel.reltype.endswith("/theme"):
                    root = etree.fromstring(rel.target_part.blob)
                    maj = root.find(".//a:majorFont/a:latin", NS)
                    mn = root.find(".//a:minorFont/a:latin", NS)
                    fonts["major"] = maj.get("typeface") if maj is not None else None
                    fonts["minor"] = mn.get("typeface") if mn is not None else None
                    break
        except Exception:
            pass
        return fonts

    def resolve_face(self, face: str | None) -> str | None:
        if face and face.startswith("+mj"):
            return self.theme_fonts["major"]
        if face and face.startswith("+mn"):
            return self.theme_fonts["minor"]
        return face

    @staticmethod
    def _norm_ph(t: str | None) -> str:
        t = t or "body"
        return {"ctrTitle": "title", "subTitle": "body", "obj": "body"}.get(t, t)

    def _find_ph(self, container, ph_type: str, ph_idx: str | None, by_idx: bool):
        phs = []
        for lp in container.placeholders:
            lph = lp.element.find(".//p:nvPr/p:ph", NS)
            if lph is not None:
                phs.append((lp, lph))
        if by_idx and ph_idx is not None:
            for lp, lph in phs:
                if lph.get("idx") == ph_idx:
                    return lp
        for lp, lph in phs:
            if self._norm_ph(lph.get("type")) == self._norm_ph(ph_type):
                return lp
        return None

    def _inherited_chain(self, shape, slide):
        """lstStyle-like elements from most to least specific, after the shape's own."""
        chain = []
        ph = shape.element.find(".//p:nvPr/p:ph", NS)
        layout = slide.slide_layout
        master = layout.slide_master
        tx_styles = master.element.find("p:txStyles", NS)
        if ph is not None:
            ph_type, ph_idx = ph.get("type", "body"), ph.get("idx")
            for container, by_idx in ((layout, True), (master, False)):
                match = self._find_ph(container, ph_type, ph_idx, by_idx)
                if match is not None:
                    chain.append(match.element.find(".//p:txBody/a:lstStyle", NS))
            if tx_styles is not None:
                norm = self._norm_ph(ph_type)
                key = "p:titleStyle" if norm == "title" else "p:bodyStyle" if norm == "body" else "p:otherStyle"
                chain.append(tx_styles.find(key, NS))
            chain.append(self.default_style)
        else:
            # Plain text boxes inherit from the presentation defaults.
            chain.append(self.default_style)
        return chain

    def paragraph_props(self, shape, slide, p_el) -> dict:
        """Effective props of a paragraph: size, bold, face, caps, line_spacing, space_before/after."""
        level = int(p_el.find("a:pPr", NS).get("lvl", 0)) if p_el.find("a:pPr", NS) is not None else 0
        out: dict = {}
        r = p_el.find("a:r/a:rPr", NS)
        _merge_rpr(out, r)
        ppr = p_el.find("a:pPr", NS)
        _merge_ppr(out, ppr)
        if ppr is not None:
            _merge_rpr(out, ppr.find("a:defRPr", NS))
        end = p_el.find("a:endParaRPr", NS)
        if "size" not in out:
            _merge_rpr(out, end)
        tx = shape.element.find(".//p:txBody", NS)
        if tx is None:
            tx = shape.element.find(".//a:txBody", NS)
        own = tx.find("a:lstStyle", NS) if tx is not None else None
        for src in [own, *self._inherited_chain(shape, slide)]:
            for k, v in _lvl_props(src, level).items():
                out.setdefault(k, v)
        out.setdefault("size", 18.0)
        out.setdefault("bold", False)
        out.setdefault("caps", False)
        out["face"] = self.resolve_face(out.get("face")) or self.theme_fonts["minor"]
        out["level"] = level
        return out


def body_metrics(tx_body) -> dict:
    """Insets, wrap, autofit and font scale from a:bodyPr."""
    bp = tx_body.find("a:bodyPr", NS) if tx_body is not None else None
    g = (lambda k, d: int(bp.get(k)) / EMU_PER_IN if bp is not None and bp.get(k) is not None else d)
    out = {"l": g("lIns", 0.1), "r": g("rIns", 0.1), "t": g("tIns", 0.05), "b": g("bIns", 0.05),
           "wrap": (bp.get("wrap") if bp is not None else None) != "none", "autofit": "none", "font_scale": 1.0,
           "vertical": bp is not None and (bp.get("vert") or "horz") not in ("horz",)}
    if bp is not None:
        na = bp.find("a:normAutofit", NS)
        if na is not None:
            out["autofit"] = "shrink"
            if na.get("fontScale"):
                out["font_scale"] = int(na.get("fontScale")) / 100000
        elif bp.find("a:spAutoFit", NS) is not None:
            out["autofit"] = "grow"
    return out


def paragraph_height_pt(lines: int, props: dict) -> float:
    size = props["size"]
    ls = props.get("line_spacing")
    if ls and ls[0] == "pts":
        line_h = ls[1]
    else:
        line_h = size * 1.2 * (ls[1] if ls else 1.0)
    return lines * line_h + props.get("space_before", 0) + props.get("space_after", 0)


_MD_BOLD = re.compile(r"\*\*(.+?)\*\*")


def strip_markup(text: str) -> str:
    return _MD_BOLD.sub(r"\1", text)


def needed_height_in(paragraphs: list[tuple[str, dict]], width_in: float, scale: float = 1.0) -> float:
    """Height (inches) a list of (text, props) paragraphs needs at a given font scale."""
    total = 0.0
    for text, props in paragraphs:
        size = props["size"] * scale
        lines = wrap_lines(strip_markup(text), width_in * 72, size, props.get("face"), props.get("bold", False), props.get("caps", False))
        total += paragraph_height_pt(lines, {**props, "size": size})
    return total / 72


def chars_per_line(width_in: float, props: dict, scale: float = 1.0) -> int:
    """Average characters of running text that fit on one line."""
    size = props["size"] * scale
    avg_char = text_width_pt("the quick brown fox jumps over lazy dogs", size, props.get("face"), props.get("bold"), props.get("caps")) / 40
    return max(1, int(width_in * 72 / avg_char))


def fit_lines(height_in: float, props: dict, scale: float = 1.0) -> int:
    """Lines that fit inside the box height."""
    line_h = paragraph_height_pt(1, {**props, "size": props["size"] * scale, "space_before": 0, "space_after": 0})
    return max(1, int(height_in * 72 / line_h + 0.2))


def lines_needed(paragraphs: list[tuple[str, dict]], width_in: float, scale: float = 1.0) -> int:
    """Total wrapped lines of (text, props) paragraphs at a font scale."""
    total = 0
    for text, props in paragraphs:
        total += wrap_lines(strip_markup(text), width_in * 72, props["size"] * scale, props.get("face"),
                            props.get("bold", False), props.get("caps", False))
    return total
