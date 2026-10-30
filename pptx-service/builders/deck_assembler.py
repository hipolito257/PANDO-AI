"""
DeckAssembler — builds a new .pptx whose slides are copies of template slides,
in any order and with repeats, working directly on the OPC package:

  - each output slide is a byte copy of its source slide XML
  - parts the slide owns (charts + their embedded workbooks and styles,
    SmartArt, tags, OLE objects) are duplicated so every copy can be edited
    independently; layouts, masters, themes and media stay shared
  - notes and comments are dropped; the presentation's slide list, its
    relationships and [Content_Types].xml are rebuilt
  - parts no longer reachable (media of unused slides, etc.) are removed

The result opens in python-pptx (and PowerPoint) like any other deck, ready
for content to be filled in.
"""
from __future__ import annotations

import io
import posixpath
import re
import zipfile

from lxml import etree

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
SLIDE_REL = R_NS + "/slide"

SHARED_PREFIXES = ("ppt/media/", "ppt/slideLayouts/", "ppt/slideMasters/", "ppt/theme/",
                   "ppt/notesMasters/", "ppt/handoutMasters/", "ppt/fonts/")
DROP_REL_SUFFIXES = ("/notesSlide", "/comments", "/commentAuthors")


def _rels_path(part: str) -> str:
    d, n = posixpath.split(part)
    return posixpath.join(d, "_rels", n + ".rels")


def _resolve(src_part: str, target: str) -> str:
    if target.startswith("/"):
        return target[1:]
    return posixpath.normpath(posixpath.join(posixpath.dirname(src_part), target))


def _relative(from_part: str, to_part: str) -> str:
    return posixpath.relpath(to_part, posixpath.dirname(from_part))


class DeckAssembler:
    def __init__(self, template_bytes: bytes):
        with zipfile.ZipFile(io.BytesIO(template_bytes)) as z:
            self.orig = {n: z.read(n) for n in z.namelist()}
        self.files: dict[str, bytes] = dict(self.orig)
        self.ct = etree.fromstring(self.orig["[Content_Types].xml"])
        self.overrides = {o.get("PartName").lstrip("/"): o.get("ContentType")
                          for o in self.ct.findall(f"{{{CT_NS}}}Override")}
        self.template_slides = self._template_slides()

    # ── Template inspection ────────────────────────────────────────────────────
    def _template_slides(self) -> list[str]:
        pres = etree.fromstring(self.orig["ppt/presentation.xml"])
        rels = etree.fromstring(self.orig["ppt/_rels/presentation.xml.rels"])
        by_id = {r.get("Id"): r.get("Target") for r in rels}
        out = []
        lst = pres.find(f"{{{P_NS}}}sldIdLst")
        for sid in (lst if lst is not None else []):
            target = by_id.get(sid.get(f"{{{R_NS}}}id"))
            if target:
                out.append(_resolve("ppt/presentation.xml", target))
        return out

    def _rels(self, part: str) -> list[etree._Element]:
        data = self.orig.get(_rels_path(part))
        return list(etree.fromstring(data)) if data else []

    # ── Assembly ───────────────────────────────────────────────────────────────
    def assemble(self, sequence: list[int]) -> bytes:
        """sequence: 1-based template slide numbers, in output order (repeats allowed)."""
        if not sequence:
            raise ValueError("Empty slide sequence")
        for n in sequence:
            if not 1 <= n <= len(self.template_slides):
                raise ValueError(f"Template has no slide {n}")

        # Remove the original slides; their owned parts become unreachable and
        # are swept at the end.
        for s in self.template_slides:
            self.files.pop(s, None)
            self.files.pop(_rels_path(s), None)

        new_slides = []
        for k, n in enumerate(sequence, 1):
            src = self.template_slides[n - 1]
            dst = f"ppt/slides/slide{k}.xml"
            self._copy_part(src, dst, is_slide=True)
            new_slides.append(dst)

        self._rewrite_presentation(new_slides)
        self._sweep_unreachable()
        self._write_content_types()

        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", self.files.pop("[Content_Types].xml"))
            for name, data in self.files.items():
                z.writestr(name, data)
        return out.getvalue()

    def _unique_name(self, part: str) -> str:
        d, n = posixpath.split(part)
        m = re.match(r"^(.*?)(\d*)(\.[^.]+)$", n)
        stem, ext = (m.group(1), m.group(3)) if m else (n, "")
        i = 1
        while True:
            cand = posixpath.join(d, f"{stem}{i}{ext}")
            if cand not in self.files and cand not in self.overrides:
                return cand
            i += 1

    def _copy_part(self, src: str, dst: str, is_slide: bool = False) -> None:
        data = self.orig[src]
        if is_slide:
            data = self._clean_slide_xml(data)
        self.files[dst] = data
        if src in self.overrides:
            self.overrides[dst] = self.overrides[src]

        rels_out = etree.Element(f"{{{REL_NS}}}Relationships", nsmap={None: REL_NS})
        for rel in self._rels(src):
            rtype, target, mode = rel.get("Type"), rel.get("Target"), rel.get("TargetMode")
            if any(rtype.endswith(s) for s in DROP_REL_SUFFIXES):
                continue
            new = etree.SubElement(rels_out, f"{{{REL_NS}}}Relationship", Id=rel.get("Id"), Type=rtype)
            if mode == "External":
                new.set("Target", target)
                new.set("TargetMode", "External")
                continue
            abs_target = _resolve(src, target)
            if rtype == SLIDE_REL:
                # Hyperlink to another slide: point at the first output slide.
                new.set("Target", _relative(dst, "ppt/slides/slide1.xml"))
            elif abs_target.startswith(SHARED_PREFIXES) or abs_target not in self.orig:
                new.set("Target", _relative(dst, abs_target))
            else:
                copy_name = self._unique_name(abs_target)
                self._copy_part(abs_target, copy_name)
                new.set("Target", _relative(dst, copy_name))
        if len(rels_out):
            self.files[_rels_path(dst)] = etree.tostring(rels_out, xml_declaration=True, encoding="UTF-8", standalone=True)

    @staticmethod
    def _clean_slide_xml(data: bytes) -> bytes:
        root = etree.fromstring(data)
        # Drop per-slide extensions (creation ids etc.) that must be unique per deck.
        ext_lst = root.find(f"{{{P_NS}}}extLst")
        if ext_lst is not None:
            root.remove(ext_lst)
        root.attrib.pop("show", None)  # hidden template slides become visible copies
        return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    def _rewrite_presentation(self, new_slides: list[str]) -> None:
        pres = etree.fromstring(self.orig["ppt/presentation.xml"])
        rels = etree.fromstring(self.orig["ppt/_rels/presentation.xml.rels"])
        for r in list(rels):
            if r.get("Type") == SLIDE_REL:
                rels.remove(r)
        lst = pres.find(f"{{{P_NS}}}sldIdLst")
        if lst is None:
            lst = etree.Element(f"{{{P_NS}}}sldIdLst")
            pres.find(f"{{{P_NS}}}sldMasterIdLst").addnext(lst)
        for c in list(lst):
            lst.remove(c)
        for k, path in enumerate(new_slides, 1):
            rid = f"rIdSlide{k}"
            etree.SubElement(rels, f"{{{REL_NS}}}Relationship", Id=rid, Type=SLIDE_REL,
                             Target=_relative("ppt/presentation.xml", path))
            etree.SubElement(lst, f"{{{P_NS}}}sldId", id=str(255 + k), **{f"{{{R_NS}}}id": rid})
        # Sections reference the old slide ids.
        ext_lst = pres.find(f"{{{P_NS}}}extLst")
        if ext_lst is not None:
            for ext in list(ext_lst):
                if ext.get("uri") == "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}":
                    ext_lst.remove(ext)
        self.files["ppt/presentation.xml"] = etree.tostring(pres, xml_declaration=True, encoding="UTF-8", standalone=True)
        self.files["ppt/_rels/presentation.xml.rels"] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)

    def _sweep_unreachable(self) -> None:
        reachable = {"[Content_Types].xml", "_rels/.rels"}
        stack = ["_rels/.rels"]
        while stack:
            rels_file = stack.pop()
            data = self.files.get(rels_file)
            if not data:
                continue
            owner = rels_file.replace("_rels/", "").removesuffix(".rels")
            for rel in etree.fromstring(data):
                if rel.get("TargetMode") == "External":
                    continue
                part = _resolve(owner if owner != "" else "x", rel.get("Target")) if owner else rel.get("Target").lstrip("/")
                if part in self.files and part not in reachable:
                    reachable.add(part)
                    rp = _rels_path(part)
                    if rp in self.files:
                        reachable.add(rp)
                        stack.append(rp)
        for name in list(self.files):
            if name not in reachable:
                del self.files[name]
                self.overrides.pop(name, None)

    def _write_content_types(self) -> None:
        for o in self.ct.findall(f"{{{CT_NS}}}Override"):
            self.ct.remove(o)
        defaults = {d.get("Extension").lower() for d in self.ct.findall(f"{{{CT_NS}}}Default")}
        for part, ctype in sorted(self.overrides.items()):
            if part in self.files:
                etree.SubElement(self.ct, f"{{{CT_NS}}}Override", PartName="/" + part, ContentType=ctype)
        # Every remaining file needs a content type: by override or by extension default.
        for part in self.files:
            ext = part.rsplit(".", 1)[-1].lower()
            if part not in self.overrides and ext not in defaults and part != "[Content_Types].xml":
                guess = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "gif": "image/gif",
                         "emf": "image/x-emf", "wmf": "image/x-wmf", "svg": "image/svg+xml", "tiff": "image/tiff",
                         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                         "bin": "application/vnd.openxmlformats-officedocument.oleObject"}.get(ext)
                if guess:
                    etree.SubElement(self.ct, f"{{{CT_NS}}}Default", Extension=ext, ContentType=guess)
                    defaults.add(ext)
        self.files["[Content_Types].xml"] = etree.tostring(self.ct, xml_declaration=True, encoding="UTF-8", standalone=True)
