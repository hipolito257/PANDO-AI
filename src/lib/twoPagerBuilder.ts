import {
  Document, Paragraph, TextRun, HeadingLevel, Packer, Footer, Header,
  AlignmentType, PageNumber, BorderStyle,
} from "docx";

const BRAND_DKG = "004F46";
const BRAND_SLATE = "666666";
const FONT = "Work Sans";

export interface TwoPagerSectionContent {
  heading: string;
  paragraphs: string[];
}

export async function buildTwoPagerDocx(
  title: string,
  subtitle: string,
  sections: TwoPagerSectionContent[],
): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 44, color: BRAND_DKG, font: FONT })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: subtitle, italics: true, size: 20, color: BRAND_SLATE, font: FONT })],
      spacing: { after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND_DKG, space: 8 } },
    }),
  ];

  for (const section of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 100 },
        children: [new TextRun({ text: section.heading, bold: true, size: 26, color: BRAND_DKG, font: FONT })],
      }),
    );
    for (const p of section.paragraphs) {
      children.push(
        new Paragraph({
          spacing: { after: 140 },
          children: [new TextRun({ text: p, size: 21, font: FONT })],
        }),
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: "PANDO | Private & Confidential", size: 16, color: BRAND_SLATE, font: FONT })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Page ", size: 16, color: BRAND_SLATE, font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: BRAND_SLATE, font: FONT }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
