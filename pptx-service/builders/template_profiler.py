"""
TemplateProfiler — extracts colors, fonts, layouts from a PPTX template.
Returns a profile dict the Next.js app stores in the DB and sends to Claude.
"""
import io, zipfile
from xml.etree import ElementTree as ET

from pptx import Presentation
from pptx.util import Inches


THEME_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PH_NAMES = {18: "category", 16: "title", 17: "takeaway", 14: "note", 26: "content"}


class TemplateProfiler:
    def __init__(self, template_bytes: bytes):
        self.prs = Presentation(io.BytesIO(template_bytes))
        self.raw = template_bytes

    def extract(self) -> dict:
        return {
            "colors":  self._colors(),
            "fonts":   self._fonts(),
            "layouts": self._layouts(),
            "slide_width_in":  round(self.prs.slide_width  / 914400, 2),
            "slide_height_in": round(self.prs.slide_height / 914400, 2),
        }

    def _colors(self) -> dict:
        """Extract theme color hex codes from theme1.xml inside the PPTX zip."""
        try:
            with zipfile.ZipFile(io.BytesIO(self.raw)) as z:
                theme_files = [n for n in z.namelist() if "theme/theme" in n]
                if not theme_files:
                    return {}
                xml = z.read(theme_files[0]).decode("utf-8")
            root = ET.fromstring(xml)
            ns = {"a": THEME_NS}
            color_map = {}
            color_scheme = root.find(".//a:clrScheme", ns)
            if color_scheme is None:
                return {}
            for child in color_scheme:
                name = child.tag.split("}")[-1]
                srgb = child.find("a:srgbClr", ns)
                sys_clr = child.find("a:sysClr", ns)
                if srgb is not None:
                    color_map[name] = srgb.get("val", "")
                elif sys_clr is not None:
                    color_map[name] = sys_clr.get("lastClr", "")
            return color_map
        except Exception:
            return {}

    def _fonts(self) -> dict:
        """Extract major/minor font names from theme."""
        try:
            with zipfile.ZipFile(io.BytesIO(self.raw)) as z:
                theme_files = [n for n in z.namelist() if "theme/theme" in n]
                if not theme_files:
                    return {}
                xml = z.read(theme_files[0]).decode("utf-8")
            root = ET.fromstring(xml)
            ns = {"a": THEME_NS}
            fonts = {}
            font_scheme = root.find(".//a:fontScheme", ns)
            if font_scheme is None:
                return {}
            for kind in ["majorFont", "minorFont"]:
                el = font_scheme.find(f"a:{kind}", ns)
                if el is not None:
                    latin = el.find("a:latin", ns)
                    if latin is not None:
                        fonts[kind] = latin.get("typeface", "")
            return fonts
        except Exception:
            return {}

    def _layouts(self) -> list:
        """List available slide masters and layouts with placeholder info."""
        layouts = []
        for mi, master in enumerate(self.prs.slide_masters):
            for li, layout in enumerate(master.slide_layouts):
                phs = {}
                for ph in layout.placeholders:
                    idx = ph.placeholder_format.idx
                    name = PH_NAMES.get(idx, f"ph_{idx}")
                    phs[name] = idx
                layouts.append({
                    "key": f"m{mi}_l{li}",
                    "name": layout.name or f"Layout {li}",
                    "master_idx": mi,
                    "layout_idx": li,
                    "placeholders": phs,
                })
        return layouts
