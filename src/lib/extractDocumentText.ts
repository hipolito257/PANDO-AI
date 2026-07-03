// Plain-text extraction for docx/pptx/xlsx attachments, so their actual content
// (not just the filename) can be sent to Claude as context. Reuses the same
// unzip/XML-text-node logic as the document translation feature.
import {
  extractDocxTexts,
  extractPptxTexts,
  extractXlsxSegments,
  docxPartNames,
  pptxPartNames,
} from "@/lib/documentTranslate";

const MAX_CHARS = 20000;

export async function extractPlainText(buffer: Buffer, ext: "docx" | "pptx" | "xlsx"): Promise<string> {
  try {
    if (ext === "xlsx") {
      const { cellTexts } = await extractXlsxSegments(buffer);
      return cellTexts.join("\n").slice(0, MAX_CHARS);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PizZip = require("pizzip");
    const zip = new PizZip(buffer);
    const names = ext === "docx" ? docxPartNames(zip) : pptxPartNames(zip);
    const texts: string[] = [];
    for (const name of names) {
      const file = zip.files[name];
      if (!file) continue;
      const xml = file.asText();
      const partTexts = ext === "docx" ? extractDocxTexts(xml) : extractPptxTexts(xml);
      texts.push(...partTexts);
    }
    return texts.join("\n").slice(0, MAX_CHARS);
  } catch {
    return "";
  }
}
