// Pure text-extraction and find/replace helpers for Office documents.
// Kept out of the route so they can be exercised directly by tests: the
// find/replace matching here has failed silently more than once, and it is only
// trustworthy if it can be run against real .docx/.pptx bytes.
// ── Normalize PPTX XML runs: merge adjacent plain runs within each paragraph ──
// PPTX splits text across multiple <a:r> runs (spell-check, cursor position, etc.)
// e.g. "Goldman Sachs" stored as <a:r><a:t>Goldman </a:t></a:r><a:r><a:t>Sachs</a:t></a:r>
// After normalization it's a single run, making string find/replace reliable.
export function normalizeXmlRuns(xml: string): string {
  // Merge adjacent <a:r> that contain ONLY <a:t> (no rPr / no formatting)
  // Runs with formatting (<a:rPr ...>) are left untouched to preserve styling
  let changed = true;
  let result = xml;
  while (changed) {
    const prev = result;
    // Pattern: </a:t></a:r> immediately followed by <a:r><a:t> (optional whitespace)
    // Both runs must be plain (no rPr between <a:r> and <a:t>)
    result = result.replace(
      /<a:r>\s*<a:t>([\s\S]*?)<\/a:t>\s*<\/a:r>\s*<a:r>\s*<a:t>([\s\S]*?)<\/a:t>\s*<\/a:r>/g,
      "<a:r><a:t>$1$2</a:t></a:r>",
    );
    changed = result !== prev;
  }
  return result;
}

// ── Extract text from PPTX, structured per slide/shape ────────────────────────
// Returns a human-readable outline that Claude can target precisely.
export function extractPptxStructured(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)![0]);
        const nb = parseInt(b.match(/\d+/)![0]);
        return na - nb;
      });

    const lines: string[] = [];
    for (let si = 0; si < slideFiles.length; si++) {
      const slideXml = normalizeXmlRuns(zip.files[slideFiles[si]].asText());
      const slideLines: string[] = [`=== SLIDE ${si + 1} ===`];

      // Extract each shape's text
      const shapeRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g;
      let shapeMatch: RegExpExecArray | null;
      let shapeIdx = 0;
      while ((shapeMatch = shapeRegex.exec(slideXml)) !== null) {
        const shapeXml = shapeMatch[0];

        // Get shape name if available
        const nameMatch = shapeXml.match(/cNvPr[^>]*name="([^"]+)"/);
        const shapeName = nameMatch ? nameMatch[1] : `Shape ${++shapeIdx}`;

        // Extract text runs per paragraph, joining them
        const paragraphs: string[] = [];
        const paraRegex = /<a:p\b[\s\S]*?<\/a:p>/g;
        let paraMatch: RegExpExecArray | null;
        while ((paraMatch = paraRegex.exec(shapeXml)) !== null) {
          const paraText = [...paraMatch[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
            .map(m => m[1]).join("").trim();
          if (paraText) paragraphs.push(paraText);
        }

        // One paragraph per line, exactly as it appears in the XML. Prefixing
        // the text with "[shape]: " or joining paragraphs with " | " produced
        // strings that exist nowhere in the file, so any "find" copied from
        // this outline could never be located. Shape names stay on their own
        // marker line for context only.
        if (paragraphs.length) {
          slideLines.push(`# ${shapeName}`);
          for (const p of paragraphs) slideLines.push(p);
        }
      }

      if (slideLines.length > 1) lines.push(...slideLines);
    }

    return lines.join("\n").slice(0, 40000);
  } catch { return ""; }
}

// ── Normalize DOCX XML runs: flatten each paragraph into a single run ────────
// Word routinely splits one visual sentence across multiple <w:r> runs —
// not just from spell-check, but whenever formatting changes mid-paragraph
// (e.g. a bold label "Overview. " followed by plain body text is TWO runs).
// A literal find/replace across raw XML can only ever match text that is
// contiguous in a single run, so any find string spanning a formatting
// boundary silently fails to match — the actual root cause of DOCX generation
// leaving the template unchanged. Fix: merge every paragraph's runs into one,
// using the first run's formatting for the merged text. Paragraphs containing
// images, hyperlinks, or fields are left untouched so nothing gets destroyed.
export function normalizeWordRuns(xml: string): string {
  return xml.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g, (full, pAttrs, inner) => {
    if (/<w:drawing\b|<w:hyperlink\b|<w:pict\b|<w:object\b|<w:fldSimple\b|<w:fldChar\b/.test(inner)) {
      return full;
    }

    const pPrMatch = inner.match(/^\s*<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;

    const runs = [...afterPPr.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
    if (runs.length === 0) return full;

    let firstRPr = "";
    let mergedText = "";
    for (const r of runs) {
      const runXml = r[0];
      if (!firstRPr) {
        const rPrMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
        if (rPrMatch) firstRPr = rPrMatch[0];
      }
      const texts = [...runXml.matchAll(/<w:t(?:\s+[\w:]+="[^"]*")*\s*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]);
      mergedText += texts.join("");
    }

    if (!mergedText) return full;

    const newRun = `<w:r>${firstRPr}<w:t xml:space="preserve">${mergedText}</w:t></w:r>`;
    return `<w:p${pAttrs}>${pPr}${newRun}</w:p>`;
  });
}

// ── Extract text from DOCX, structured per paragraph ──────────────────────────
// Normalizes runs first so paragraph text is contiguous and exactly matches
// what applyReplacementsToOffice will search against — required for reliable
// find/replace (raw entities like &amp; are kept as-is, not decoded).
export function extractDocxStructured(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const file = zip.files["word/document.xml"];
    if (!file) return "";
    const xml = normalizeWordRuns(file.asText());

    const lines: string[] = [];
    const paraRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
    let m: RegExpExecArray | null;
    while ((m = paraRegex.exec(xml)) !== null) {
      const paraText = [...m[0].matchAll(/<w:t(?:\s+[\w:]+="[^"]*")*\s*>([\s\S]*?)<\/w:t>/g)]
        .map(x => x[1]).join("");
      if (paraText.trim()) lines.push(paraText);
    }
    return lines.join("\n").slice(0, 40000);
  } catch { return ""; }
}

// ── Extract text from Office docs (DOCX / PPTX / XLSX) ────────────────────────
export function extractOfficeText(buffer: Buffer, ext: string): string {
  if (ext === "pptx") return extractPptxStructured(buffer);
  if (ext === "docx") return extractDocxStructured(buffer);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const xmlFiles = Object.keys(zip.files).filter(name => {
      if (ext === "xlsx") return !!name.match(/^xl\/worksheets\/sheet\d+\.xml$/) || name === "xl/sharedStrings.xml";
      return false;
    });
    return xmlFiles.map(fname => {
      try {
        return zip.files[fname].asText()
          .replace(/<[^>]*>/g, " ")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#xA;/g, "\n")
          .replace(/\s+/g, " ").trim();
      } catch { return ""; }
    }).filter(Boolean).join("\n").slice(0, 10000);
  } catch { return ""; }
}

// Escape XML special chars so replacements don't corrupt the document XML
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Split replacements that span several paragraphs ───────────────────────────
// The extracted template joins each paragraph with "\n", but in the underlying
// XML every paragraph is its own element, so a "find" quoting two paragraphs at
// once exists nowhere in the file and silently matches nothing. Models do this
// constantly because the extracted text reads like continuous prose. Split such
// a pair into per-line pairs so each one can actually land.
export function expandMultilineReplacements(
  replacements: { find: string; replace: string }[]
): { find: string; replace: string }[] {
  const out: { find: string; replace: string }[] = [];
  for (const r of replacements) {
    if (!r.find || !r.find.includes("\n")) { out.push(r); continue; }
    const finds = r.find.split("\n").filter(l => l.trim().length > 1);
    const reps = (r.replace ?? "").split("\n");
    // Pair line-for-line. If the model wrote fewer lines than it quoted, the
    // surplus originals are left alone rather than blanked out.
    for (let i = 0; i < Math.min(finds.length, reps.length); i++) {
      out.push({ find: finds[i], replace: reps[i] });
    }
  }
  return out;
}

// ── Apply text replacements to Office docs ────────────────────────────────────
// Returns the applied subset alongside the buffer. A "find" the model invented,
// or lifted from an attached source file instead of the template, matches
// nothing and is silently a no-op — so the caller must know what actually
// landed rather than trusting what the model proposed.
export function applyReplacementsToOffice(
  buffer: Buffer, type: string,
  replacements: { find: string; replace: string }[]
): { buffer: Buffer; applied: { find: string; replace: string }[] } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  const zip = new PizZip(buffer);
  const xmlFiles = Object.keys(zip.files).filter(name => {
    if (type === "pptx") return !!name.match(/^ppt\/(slides|noteSlides)\/.*\.xml$/);
    if (type === "docx") return !!name.match(/^word\/(document|header\d*|footer\d*).*\.xml$/);
    return false;
  });
  const expanded = expandMultilineReplacements(replacements);
  const appliedFinds = new Set<string>();
  for (const fname of xmlFiles) {
    try {
      let content = type === "pptx"
        ? normalizeXmlRuns(zip.files[fname].asText())
        : type === "docx"
        ? normalizeWordRuns(zip.files[fname].asText())
        : zip.files[fname].asText();
      for (const { find, replace } of expanded) {
        if (!find || find.length <= 1) continue;
        // The extractor keeps a paragraph's trailing spaces while models tend
        // to trim them, so try the trimmed form before giving up.
        const needle = content.includes(find)
          ? find
          : content.includes(find.trim()) ? find.trim() : null;
        if (!needle) continue;
        appliedFinds.add(find);
        // Escape replacement value so special chars don't break the XML
        content = content.split(needle).join(escapeXml(replace));
      }
      zip.file(fname, content);
    } catch { /* skip */ }
  }
  console.log(`[applyReplacementsToOffice] ${type}: ${appliedFinds.size}/${expanded.length} matched (${replacements.length} proposed)`);
  return {
    buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
    applied: expanded.filter(r => appliedFinds.has(r.find)),
  };
}

