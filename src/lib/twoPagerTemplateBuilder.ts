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

// ── Resolved run formatting (font/size/color/bold/italic/underline) ─────────
interface RunFormat {
  asciiFont?: string;
  hAnsiFont?: string;
  cs?: string;
  sz?: string;
  szCs?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
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
      case "w:u":
        fmt.underline = attrs["@_w:val"] !== undefined && attrs["@_w:val"] !== "none";
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

interface ParagraphExample {
  styleId: string;
  format: RunFormat;
  align?: string;
}

// Walks the template's ORIGINAL body (before we replace it) collecting, for
// every non-empty paragraph, its paragraph style id, its own alignment
// (w:jc, e.g. centered titles vs justified body), and the fully-resolved
// format (docDefaults -> style chain -> the run's own direct formatting) of
// its first run — i.e. what that paragraph actually looks like on screen.
function collectParagraphExamples(bodyNodes: XNode[], styles: Map<string, StyleInfo>, docDefaults: RunFormat): ParagraphExample[] {
  const out: ParagraphExample[] = [];
  for (const node of bodyNodes) {
    if (tagOf(node) !== "w:p") continue;
    const children = (node["w:p"] as XNode[]) ?? [];
    const pPrNode = findFirst(children, "w:pPr");
    let styleId = "Normal";
    let align: string | undefined;
    if (pPrNode) {
      const pPrChildren = (pPrNode["w:pPr"] as XNode[]) ?? [];
      const pStyleNode = findFirst(pPrChildren, "w:pStyle");
      const val = pStyleNode?.[":@"]?.["@_w:val"];
      if (val) styleId = val;
      const jcNode = findFirst(pPrChildren, "w:jc");
      align = jcNode?.[":@"]?.["@_w:val"];
    }
    for (const child of children) {
      if (tagOf(child) !== "w:r") continue;
      const rChildren = (child["w:r"] as XNode[]) ?? [];
      const tNode = findFirst(rChildren, "w:t");
      const text = tNode ? ((tNode["w:t"] as XNode[]) ?? []).map(c => c["#text"] ?? "").join("") : "";
      if (!text.trim()) continue;
      const rPrNode = findFirst(rChildren, "w:rPr");
      const runOwn = rPrNode ? parseRPrChildren(rPrNode["w:rPr"] as XNode[]) : {};
      out.push({ styleId, format: fullResolve(styleId, styles, docDefaults, runOwn), align });
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

function szNum(f: RunFormat): number {
  return f.sz ? parseInt(f.sz, 10) : 22; // default ~11pt body text, in half-points
}

// Most real-world templates never apply Word's named heading styles at all
// (everything is "Normal"), and simply distinguish headings from body text
// with direct formatting — a bigger size, bold, and/or underline. Word's
// styles.xml also always defines stock Title/Heading1-9 entries whether or
// not the author ever used them, so their mere presence isn't evidence the
// template actually looks like that. Detect the real heading look by finding
// the most common formatting that is BOTH distinct from body text and
// visually heading-like (larger / bolder / underlined), rather than trusting
// style names.
// A bigger score means "more visually distinct from body, the way a
// standalone section heading would be" — a document can have several bold
// treatments (e.g. inline bold lead-in labels within a body paragraph, like
// "Group I:"), and those are usually more numerous (one per paragraph) than
// genuine standalone headings, so ranking candidates by raw frequency alone
// picks the wrong one. Weighting a real size bump above mere bold/underline
// favors the format actually used for whole standalone heading paragraphs.
function headingScore(candidate: RunFormat, body: RunFormat): number {
  let score = 0;
  if (szNum(candidate) > szNum(body)) score += 2;
  if (candidate.underline && !body.underline) score += 1;
  if (candidate.bold && !body.bold) score += 1;
  return score;
}

function findHeadingFormat(examples: ParagraphExample[], bodyFormat: RunFormat): RunFormat | null {
  const bodyKey = JSON.stringify(bodyFormat);
  const counts = new Map<string, { count: number; format: RunFormat }>();
  for (const e of examples) {
    const key = JSON.stringify(e.format);
    if (key === bodyKey) continue;
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { count: 1, format: e.format });
  }
  const candidates = [...counts.values()]
    .map(v => ({ ...v, score: headingScore(v.format, bodyFormat) }))
    .filter(v => v.score > 0)
    .sort((a, b) => b.score - a.score || b.count - a.count);
  return candidates.length ? candidates[0].format : null;
}

// Last-resort fallback for templates with literally no visual distinction
// between headings and body text — synthesize one from the real body font
// rather than falling back to a foreign default font.
function deriveHeadingFromBody(bodyFormat: RunFormat, scale: number): RunFormat {
  return { ...bodyFormat, bold: true, sz: String(Math.round(szNum(bodyFormat) * scale)) };
}

// Find the alignment used by an actual example paragraph matching this
// resolved format (e.g. a template's title is often centered while its
// section headings and body are justified/left) — falls back to the most
// common alignment among all examples sharing that format.
function alignmentForFormat(examples: ParagraphExample[], format: RunFormat): string | undefined {
  const key = JSON.stringify(format);
  const matches = examples.filter(e => JSON.stringify(e.format) === key && e.align);
  if (!matches.length) return undefined;
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.align!, (counts.get(m.align!) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
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
  // Always emit an explicit color, even when the template's real text has no
  // explicit color of its own ("auto" = inherit the theme's normal text
  // color). Every generated paragraph references a plain body-like pStyle,
  // but without this, an *unstyled* run would still fall back to whatever
  // color that style itself defines — which is fine for genuinely-used
  // styles, but Word's stock Heading2/Heading3/Title definitions carry their
  // own theme colors (often blue) whether or not a template ever uses them,
  // and silently bled through when we didn't already know the true color.
  children.push({ "w:color": [], ":@": { "@_w:val": format.color ?? "auto" } });
  if (format.bold) children.push({ "w:b": [] });
  const italic = forceItalic !== undefined ? forceItalic : format.italic;
  if (italic) children.push({ "w:i": [] });
  if (format.underline) children.push({ "w:u": [], ":@": { "@_w:val": "single" } });
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

function paragraph(styleId: string, text: string, rPrNode: XNode | null, align?: string): XNode {
  const pPrChildren: XNode[] = [{ "w:pStyle": [], ":@": { "@_w:val": styleId } }];
  if (align) pPrChildren.push({ "w:jc": [], ":@": { "@_w:val": align } });
  return {
    "w:p": [
      { "w:pPr": pPrChildren },
      textRun(text, rPrNode),
    ],
  };
}

// Word represents a mid-document ("continuous") section break as an empty
// paragraph whose sole purpose is to carry the outgoing section's sectPr —
// it has no run/text of its own. Both sample templates use exactly this
// pattern: a title paragraph, then this empty marker, then the body section
// starts immediately with its own first heading — there is no real
// "subtitle" paragraph in section 1. Reproducing the empty marker (instead
// of attaching the break to our own subtitle text) keeps the subtitle in
// the body section's margins/columns like the template's real content does.
function sectionBreakParagraph(sectPr: XNode): XNode {
  return { "w:p": [{ "w:pPr": [sectPr] }] };
}

// Word documents commonly split a "2-pager" into a single-column title/header
// banner section followed by a multi-column body section (a continuous
// section break in between). That break is a <w:sectPr> nested inside a
// paragraph's <w:pPr>, not a direct child of <w:body> — only the FINAL
// section's sectPr is a direct body child. Collecting every sectPr in
// document order lets us reproduce that same section structure instead of
// collapsing the whole document into a single section (which silently drops
// the header/logo reference and/or the column layout).
function collectOrderedSectPrs(bodyNodes: XNode[]): XNode[] {
  const out: XNode[] = [];
  for (const node of bodyNodes) {
    const tag = tagOf(node);
    if (tag === "w:sectPr") { out.push(node); continue; }
    if (tag === "w:p") {
      const children = (node["w:p"] as XNode[]) ?? [];
      const pPrNode = findFirst(children, "w:pPr");
      if (pPrNode) {
        const nested = findFirst((pPrNode["w:pPr"] as XNode[]) ?? [], "w:sectPr");
        if (nested) out.push(nested);
      }
    }
  }
  return out;
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
  // Every generated paragraph references this same plain body-like style —
  // never Word's stock Title/Heading1-9/Subtitle IDs. Those are always
  // present in styles.xml whether or not the template's author ever used
  // them, and often carry their own theme color/size (Word's defaults lean
  // blue for Heading2/Heading3) that would otherwise silently bleed through
  // whenever we don't already have an explicit override for that property.
  // All visual differentiation (font/size/color/bold/underline/alignment)
  // is instead resolved from the template's actual paragraphs below and
  // applied as direct formatting.
  const bodyStyle = pickStyle(styleIds, ["Normal", "BodyText", "Body Text"]);

  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Template is missing word/document.xml — not a valid .docx");

  const ast: XNode[] = new XMLParser(XML_PARSE_OPTS).parse(documentFile.asText());
  const documentNode = findFirst(ast, "w:document");
  if (!documentNode) throw new Error("Template document.xml has no <w:document> root");

  const bodyNode = findFirst(documentNode["w:document"] as XNode[], "w:body");
  if (!bodyNode) throw new Error("Template document.xml has no <w:body>");

  const originalBody = bodyNode["w:body"] as XNode[];
  // Reproduce the template's section structure: if it has more than one
  // section (e.g. a single-column title banner followed by a multi-column
  // body), put the first section's break right after our title/subtitle
  // (the natural analog of a template's front-matter section) and use the
  // last section's page setup for everything else, instead of collapsing
  // the whole document into a single section.
  const sectPrs = collectOrderedSectPrs(originalBody);
  const finalSectPr = sectPrs.length ? sectPrs[sectPrs.length - 1] : null;
  const frontSectionBreak = sectPrs.length > 1 ? sectPrs[0] : undefined;

  // Resolve what each role actually looks like in THIS template, from real
  // paragraphs where possible, before we discard the original body content.
  // Body/heading roles are detected by actual visual formatting (size, bold,
  // underline), not by style name — most templates never apply Word's named
  // heading styles at all and just distinguish headings with direct
  // formatting on otherwise-"Normal" paragraphs.
  const examples = collectParagraphExamples(originalBody, styles, docDefaults);
  const bodyFormat = modeFormat(examples.map(e => e.format)) ?? formatForStyle(bodyStyle, examples, styles, docDefaults);
  const detectedHeadingFormat = findHeadingFormat(examples, bodyFormat);

  const titleFormat = examples.length ? examples[0].format : (detectedHeadingFormat ?? deriveHeadingFromBody(bodyFormat, 1.7));
  const sectionHeadingFormat = detectedHeadingFormat ?? deriveHeadingFromBody(bodyFormat, 1.25);
  const subtitleFormat = detectedHeadingFormat ? sectionHeadingFormat : bodyFormat;
  const subtitleItalic = !detectedHeadingFormat;

  const titleAlign = examples.length ? examples[0].align : alignmentForFormat(examples, titleFormat);
  const sectionHeadingAlign = alignmentForFormat(examples, sectionHeadingFormat);
  const bodyAlign = alignmentForFormat(examples, bodyFormat);
  const subtitleAlign = detectedHeadingFormat ? sectionHeadingAlign : bodyAlign;

  const titleRPr = buildRPrNode(titleFormat);
  const subtitleRPr = buildRPrNode(subtitleFormat, subtitleItalic || undefined);
  const sectionHeadingRPr = buildRPrNode(sectionHeadingFormat);
  const bodyRPr = buildRPrNode(bodyFormat);

  const newBody: XNode[] = [paragraph(bodyStyle, plan.title, titleRPr, titleAlign)];
  if (frontSectionBreak) newBody.push(sectionBreakParagraph(frontSectionBreak));
  newBody.push(paragraph(bodyStyle, plan.subtitle, subtitleRPr, subtitleAlign));

  for (const section of plan.sections) {
    newBody.push(paragraph(bodyStyle, section.heading, sectionHeadingRPr, sectionHeadingAlign));
    for (const p of section.paragraphs) newBody.push(paragraph(bodyStyle, p, bodyRPr, bodyAlign));
  }

  if (finalSectPr) newBody.push(finalSectPr);

  bodyNode["w:body"] = newBody;

  const newXml = new XMLBuilder(XML_BUILD_OPTS).build(ast);
  zip.file("word/document.xml", newXml);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
