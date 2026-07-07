// Builds a Company 2-Pager by cloning an admin-uploaded reference .docx and
// replacing only the body paragraphs with AI-generated content. Everything
// that defines "what the template looks like" — styles.xml, theme, headers,
// footers, page setup (sectPr), media/logos, numbering — is copied through
// untouched.
//
// Generated paragraphs reference the template's own paragraph style IDs
// (Title/Subtitle/Heading1/Heading2/Normal) for paragraph-level properties
// (spacing, alignment, indentation). But font/size/color/bold are resolved
// separately and applied as explicit direct formatting on each generated
// run, because most real-world Word documents set their visual font by
// selecting text and changing it (direct formatting on the run), not by
// editing the named style's definition — relying on w:pStyle alone silently
// falls back to the style's base font (often Calibri) and ignores what the
// document actually looks like.
//
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

import type { TwoPagerSectionContent } from "./twoPagerBuilder";

const XML_PARSE_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  processEntities: true,
};
const XML_BUILD_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  suppressEmptyNode: false,
  unpairedTags: [] as string[],
};

type XNode = Record<string, any>;

function tagOf(node: XNode): string | null {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

function findFirst(nodes: XNode[], tag: string): XNode | null {
  for (const node of nodes) {
    if (tagOf(node) === tag) return node;
  }
  return null;
}

// ── Resolved run formatting (font/size/color/bold/italic) ───────────────────
interface RunFormat {
  asciiFont?: string;
  hAnsiFont?: string;
  cs?: string;
  sz?: string;
  szCs?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

function parseRPrChildren(children: XNode[]): RunFormat {
  const fmt: RunFormat = {};
  for (const node of children) {
    const tag = tagOf(node);
    if (!tag) continue;
    const attrs = (node[":@"] ?? {}) as Record<string, string>;
    const isOff = attrs["@_w:val"] === "0" || attrs["@_w:val"] === "false";
    switch (tag) {
      case "w:rFonts":
        if (attrs["@_w:ascii"]) fmt.asciiFont = attrs["@_w:ascii"];
        if (attrs["@_w:hAnsi"]) fmt.hAnsiFont = attrs["@_w:hAnsi"];
        if (attrs["@_w:cs"]) fmt.cs = attrs["@_w:cs"];
        break;
      case "w:sz":
        if (attrs["@_w:val"]) fmt.sz = attrs["@_w:val"];
        break;
      case "w:szCs":
        if (attrs["@_w:val"]) fmt.szCs = attrs["@_w:val"];
        break;
      case "w:color":
        if (attrs["@_w:val"]) fmt.color = attrs["@_w:val"];
        break;
      case "w:b":
        fmt.bold = !isOff;
        break;
      case "w:i":
        fmt.italic = !isOff;
        break;
    }
  }
  return fmt;
}

interface StyleInfo {
  basedOn?: string;
  rPr: RunFormat;
}

function parseStylesXml(zip: any): { styles: Map<string, StyleInfo>; docDefaults: RunFormat; styleIds: Set<string> } {
  const styles = new Map<string, StyleInfo>();
  const styleIds = new Set<string>();
  let docDefaults: RunFormat = {};

  const file = zip.file("word/styles.xml");
  if (!file) return { styles, docDefaults, styleIds };

  try {
    const ast: XNode[] = new XMLParser(XML_PARSE_OPTS).parse(file.asText());
    const stylesRoot = findFirst(ast, "w:styles");
    if (!stylesRoot) return { styles, docDefaults, styleIds };

    for (const node of stylesRoot["w:styles"] as XNode[]) {
      const tag = tagOf(node);
      if (tag === "w:docDefaults") {
        const rPrDefault = findFirst(node["w:docDefaults"] as XNode[], "w:rPrDefault");
        const rPrNode = rPrDefault ? findFirst(rPrDefault["w:rPrDefault"] as XNode[], "w:rPr") : null;
        if (rPrNode) docDefaults = parseRPrChildren(rPrNode["w:rPr"] as XNode[]);
      } else if (tag === "w:style") {
        const styleId = node[":@"]?.["@_w:styleId"];
        if (!styleId) continue;
        styleIds.add(styleId);
        const children = node["w:style"] as XNode[];
        const basedOnNode = findFirst(children, "w:basedOn");
        const basedOn = basedOnNode?.[":@"]?.["@_w:val"];
        const rPrNode = findFirst(children, "w:rPr");
        const rPr = rPrNode ? parseRPrChildren(rPrNode["w:rPr"] as XNode[]) : {};
        styles.set(styleId, { basedOn, rPr });
      }
    }
  } catch { /* fall through with whatever was parsed so far */ }

  return { styles, docDefaults, styleIds };
}

function resolveStyleFormat(
  styleId: string | undefined,
  styles: Map<string, StyleInfo>,
  seen: Set<string> = new Set(),
): RunFormat {
  if (!styleId || seen.has(styleId)) return {};
  seen.add(styleId);
  const info = styles.get(styleId);
  if (!info) return {};
  const ancestor = info.basedOn ? resolveStyleFormat(info.basedOn, styles, seen) : {};
  return { ...ancestor, ...info.rPr };
}

function fullResolve(styleId: string | undefined, styles: Map<string, StyleInfo>, docDefaults: RunFormat, runOwn: RunFormat): RunFormat {
  return { ...docDefaults, ...resolveStyleFormat(styleId, styles), ...runOwn };
}

function pickStyle(available: Set<string>, chain: string[]): string {
  for (const candidate of chain) if (available.has(candidate)) return candidate;
  return chain[chain.length - 1];
}

const HEADING_STYLE_PATTERN = /^(Title|Subtitle|Heading\d?)$/i;
function isHeadingStyle(styleId: string): boolean {
  return HEADING_STYLE_PATTERN.test(styleId);
}

interface ParagraphExample {
  styleId: string;
  format: RunFormat;
}

// Walks the template's ORIGINAL body (before we replace it) collecting, for
// every non-empty paragraph, its paragraph style id and the fully-resolved
// format (docDefaults -> style chain -> the run's own direct formatting) of
// its first run — i.e. what that paragraph actually looks like on screen.
function collectParagraphExamples(bodyNodes: XNode[], styles: Map<string, StyleInfo>, docDefaults: RunFormat): ParagraphExample[] {
  const out: ParagraphExample[] = [];
  for (const node of bodyNodes) {
    if (tagOf(node) !== "w:p") continue;
    const children = (node["w:p"] as XNode[]) ?? [];
    const pPrNode = findFirst(children, "w:pPr");
    let styleId = "Normal";
    if (pPrNode) {
      const pStyleNode = findFirst(pPrNode["w:pPr"] as XNode[], "w:pStyle");
      const val = pStyleNode?.[":@"]?.["@_w:val"];
      if (val) styleId = val;
    }
    for (const child of children) {
      if (tagOf(child) !== "w:r") continue;
      const rChildren = (child["w:r"] as XNode[]) ?? [];
      const tNode = findFirst(rChildren, "w:t");
      const text = tNode ? ((tNode["w:t"] as XNode[]) ?? []).map(c => c["#text"] ?? "").join("") : "";
      if (!text.trim()) continue;
      const rPrNode = findFirst(rChildren, "w:rPr");
      const runOwn = rPrNode ? parseRPrChildren(rPrNode["w:rPr"] as XNode[]) : {};
      out.push({ styleId, format: fullResolve(styleId, styles, docDefaults, runOwn) });
      break; // first non-empty run is representative for the paragraph
    }
  }
  return out;
}

function modeFormat(formats: RunFormat[]): RunFormat | null {
  if (!formats.length) return null;
  const counts = new Map<string, { count: number; format: RunFormat }>();
  for (const f of formats) {
    const key = JSON.stringify(f);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { count: 1, format: f });
  }
  let best: { count: number; format: RunFormat } | null = null;
  for (const v of counts.values()) if (!best || v.count > best.count) best = v;
  return best!.format;
}

// Prefer an actual paragraph in the document using this style (captures
// direct-formatting quirks real documents have); fall back to the style's
// own definition (through its w:basedOn chain + docDefaults) if the
// template never actually uses that style.
function formatForStyle(
  styleId: string,
  examples: ParagraphExample[],
  styles: Map<string, StyleInfo>,
  docDefaults: RunFormat,
): RunFormat {
  const example = examples.find(e => e.styleId === styleId);
  if (example) return example.format;
  return fullResolve(styleId, styles, docDefaults, {});
}

// Word's styles.xml always defines stock Title/Heading1-9/Subtitle entries
// even when the author never used them — so their mere presence in the
// style list isn't evidence the template actually looks like that (they
// often resolve to a generic default font like Times New Roman via
// docDefaults). If no real paragraph in the template uses a given heading
// style, derive its look from the template's actual body font instead of
// trusting the unused stock style definition, so headings never end up in
// a font foreign to the document.
function headingFormat(
  styleId: string,
  examples: ParagraphExample[],
  bodyFormat: RunFormat,
  scale: number,
): RunFormat {
  const example = examples.find(e => e.styleId === styleId);
  if (example) return example.format;
  const baseSz = bodyFormat.sz ? parseInt(bodyFormat.sz, 10) : 22; // default ~11pt in half-points
  return { ...bodyFormat, bold: true, sz: String(Math.round(baseSz * scale)) };
}

function buildRPrNode(format: RunFormat, forceItalic?: boolean): XNode | null {
  const children: XNode[] = [];
  if (format.asciiFont || format.hAnsiFont || format.cs) {
    children.push({
      "w:rFonts": [],
      ":@": {
        ...(format.asciiFont ? { "@_w:ascii": format.asciiFont, "@_w:hAnsi": format.hAnsiFont ?? format.asciiFont } : {}),
        ...(format.cs ? { "@_w:cs": format.cs } : {}),
      },
    });
  }
  if (format.color) children.push({ "w:color": [], ":@": { "@_w:val": format.color } });
  if (format.bold) children.push({ "w:b": [] });
  const italic = forceItalic !== undefined ? forceItalic : format.italic;
  if (italic) children.push({ "w:i": [] });
  if (format.sz) children.push({ "w:sz": [], ":@": { "@_w:val": format.sz } });
  if (format.szCs) children.push({ "w:szCs": [], ":@": { "@_w:val": format.szCs } });
  return children.length ? { "w:rPr": children } : null;
}

// ── Paragraph node construction (preserveOrder AST format) ──────────────────
function textRun(text: string, rPrNode: XNode | null): XNode {
  return {
    "w:r": [
      ...(rPrNode ? [rPrNode] : []),
      {
        "w:t": text.length ? [{ "#text": text }] : [],
        ":@": /^\s|\s$/.test(text) ? { "@_xml:space": "preserve" } : undefined,
      },
    ],
  };
}

function paragraph(styleId: string, text: string, rPrNode: XNode | null): XNode {
  return {
    "w:p": [
      { "w:pPr": [{ "w:pStyle": [], ":@": { "@_w:val": styleId } }] },
      textRun(text, rPrNode),
    ],
  };
}

interface TemplatePlan {
  title: string;
  subtitle: string;
  sections: TwoPagerSectionContent[];
}

export async function buildTwoPagerFromTemplate(
  templateBuffer: Buffer,
  plan: TemplatePlan,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  const zip = new PizZip(templateBuffer);

  const { styles, docDefaults, styleIds } = parseStylesXml(zip);
  const titleStyle = pickStyle(styleIds, ["Title", "Heading1", "Normal"]);
  // Prefer a style distinct from the section-heading style below so the
  // subtitle doesn't visually collide with section headings; if the template
  // defines no dedicated "Subtitle"/"Heading3" style, fall back to italicizing
  // the body style instead of reusing Heading2.
  const subtitleStyle = pickStyle(styleIds, ["Subtitle", "Heading3", "Normal", "Body Text"]);
  const subtitleItalic = !styleIds.has("Subtitle") && !styleIds.has("Heading3");
  const sectionHeadingStyle = pickStyle(styleIds, ["Heading2", "Heading1", "Heading3", "Normal"]);
  const bodyStyle = pickStyle(styleIds, ["Normal", "BodyText", "Body Text"]);

  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Template is missing word/document.xml — not a valid .docx");

  const ast: XNode[] = new XMLParser(XML_PARSE_OPTS).parse(documentFile.asText());
  const documentNode = findFirst(ast, "w:document");
  if (!documentNode) throw new Error("Template document.xml has no <w:document> root");

  const bodyNode = findFirst(documentNode["w:document"] as XNode[], "w:body");
  if (!bodyNode) throw new Error("Template document.xml has no <w:body>");

  const originalBody = bodyNode["w:body"] as XNode[];
  // The page setup (margins, size, headers/footers refs) lives in the trailing
  // w:sectPr — a direct child of w:body, not wrapped in a paragraph. Keep the
  // last one found (covers the common single-section-per-document case).
  let sectPr: XNode | null = null;
  for (const node of originalBody) if (tagOf(node) === "w:sectPr") sectPr = node;

  // Resolve what each role actually looks like in THIS template, from real
  // paragraphs where possible, before we discard the original body content.
  const examples = collectParagraphExamples(originalBody, styles, docDefaults);
  const bodyExamples = examples.filter(e => !isHeadingStyle(e.styleId));
  const bodyFormat = modeFormat(bodyExamples.map(e => e.format)) ?? formatForStyle(bodyStyle, examples, styles, docDefaults);

  const titleFormat = headingFormat(titleStyle, examples, bodyFormat, 1.7);
  const subtitleFormat = subtitleItalic ? bodyFormat : headingFormat(subtitleStyle, examples, bodyFormat, 1.0);
  const sectionHeadingFormat = headingFormat(sectionHeadingStyle, examples, bodyFormat, 1.25);

  const titleRPr = buildRPrNode(titleFormat);
  const subtitleRPr = buildRPrNode(subtitleFormat, subtitleItalic || undefined);
  const sectionHeadingRPr = buildRPrNode(sectionHeadingFormat);
  const bodyRPr = buildRPrNode(bodyFormat);

  const newBody: XNode[] = [
    paragraph(titleStyle, plan.title, titleRPr),
    paragraph(subtitleStyle, plan.subtitle, subtitleRPr),
  ];

  for (const section of plan.sections) {
    newBody.push(paragraph(sectionHeadingStyle, section.heading, sectionHeadingRPr));
    for (const p of section.paragraphs) newBody.push(paragraph(bodyStyle, p, bodyRPr));
  }

  if (sectPr) newBody.push(sectPr);

  bodyNode["w:body"] = newBody;

  const newXml = new XMLBuilder(XML_BUILD_OPTS).build(ast);
  zip.file("word/document.xml", newXml);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
