// Builds a Company 2-Pager by cloning an admin-uploaded reference .docx and
// replacing only the body paragraphs with AI-generated content. Everything
// that defines "what the template looks like" — styles.xml, theme, headers,
// footers, page setup (sectPr), media/logos, numbering — is copied through
// untouched. Generated paragraphs reference the template's own paragraph
// style IDs (Title/Subtitle/Heading1/Heading2/Normal), so Word renders them
// with the template's exact fonts/colors/spacing without us having to
// reverse-engineer those values.
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

// ── Discover which built-in paragraph styles the template actually defines ──
function extractStyleIds(zip: any): Set<string> {
  const ids = new Set<string>();
  const file = zip.file("word/styles.xml");
  if (!file) return ids;

  try {
    const ast: XNode[] = new XMLParser(XML_PARSE_OPTS).parse(file.asText());
    const stylesRoot = findFirst(ast, "w:styles");
    if (!stylesRoot) return ids;
    for (const node of stylesRoot["w:styles"] as XNode[]) {
      if (tagOf(node) === "w:style") {
        const styleId = node[":@"]?.["@_w:styleId"];
        if (styleId) ids.add(styleId);
      }
    }
  } catch { /* fall through to defaults */ }

  return ids;
}

function findFirst(nodes: XNode[], tag: string): XNode | null {
  for (const node of nodes) {
    if (tagOf(node) === tag) return node;
  }
  return null;
}

function pickStyle(available: Set<string>, chain: string[]): string {
  for (const candidate of chain) if (available.has(candidate)) return candidate;
  return chain[chain.length - 1];
}

// ── Paragraph node construction (preserveOrder AST format) ──────────────────
function textRun(text: string, italic?: boolean): XNode {
  return {
    "w:r": [
      ...(italic ? [{ "w:rPr": [{ "w:i": [] }] }] : []),
      {
        "w:t": text.length ? [{ "#text": text }] : [],
        ":@": /^\s|\s$/.test(text) ? { "@_xml:space": "preserve" } : undefined,
      },
    ],
  };
}

function paragraph(styleId: string, text: string, italic?: boolean): XNode {
  return {
    "w:p": [
      { "w:pPr": [{ "w:pStyle": [], ":@": { "@_w:val": styleId } }] },
      textRun(text, italic),
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

  const styleIds = extractStyleIds(zip);
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

  const newBody: XNode[] = [
    paragraph(titleStyle, plan.title),
    paragraph(subtitleStyle, plan.subtitle, subtitleItalic),
  ];

  for (const section of plan.sections) {
    newBody.push(paragraph(sectionHeadingStyle, section.heading));
    for (const p of section.paragraphs) newBody.push(paragraph(bodyStyle, p));
  }

  if (sectPr) newBody.push(sectPr);

  bodyNode["w:body"] = newBody;

  const newXml = new XMLBuilder(XML_BUILD_OPTS).build(ast);
  zip.file("word/document.xml", newXml);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
