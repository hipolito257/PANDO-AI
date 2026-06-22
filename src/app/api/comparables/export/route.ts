import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";

type RowType = "private" | "public" | "median";
type Row = { cells: string[]; type: RowType };

type NativeChartReq =
  | { type: "column"; title: string; sheetName: string; categories: (string | null)[]; values: (number | null)[] }
  | { type: "scatter"; title: string; sheetName: string; xLabel: string; yLabel: string; points: { x: number; y: number; label: string }[] };

// Brand colors (ARGB format for ExcelJS)
const C = {
  carbon:      "FF202020",
  white:       "FFFFFFFF",
  orange:      "FFFF682C",
  orangeLight: "FFFFF8F5",
  fog:         "FFF7F6F4",
  fogMid:      "FFF0EFEC",
  chalk:       "FFE8E6E2",
  slate:       "FF828282",
};

// ── XML helpers ───────────────────────────────────────────────────────────────
function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sheetRef(name: string): string {
  return /[^A-Za-z0-9_]/.test(name) ? `'${name}'` : name;
}

// ── Chart XML builders ────────────────────────────────────────────────────────
function buildColumnChartXml(title: string, dataSheet: string, rows: number, i: number): string {
  const ref = sheetRef(dataSheet);
  const end = rows + 1;
  const ax1 = (i + 1) * 10000 + 1;
  const ax2 = ax1 + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:lang val="es-MX"/>
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:barChart>
<c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="1"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:cat><c:strRef><c:f>${ref}!$A$2:$A$${end}</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>${ref}!$B$2:$B$${end}</c:f></c:numRef></c:val>
</c:ser>
<c:axId val="${ax1}"/><c:axId val="${ax2}"/>
</c:barChart>
<c:catAx>
<c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/>
<c:crossAx val="${ax2}"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>
</c:catAx>
<c:valAx>
<c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/><c:axPos val="l"/>
<c:numFmt formatCode="General" sourceLinked="0"/>
<c:tickLblPos val="nextTo"/><c:crossAx val="${ax1}"/><c:crossBetween val="between"/>
</c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="1"/>
</c:chart>
</c:chartSpace>`;
}

function buildScatterChartXml(title: string, dataSheet: string, rows: number, xLabel: string, yLabel: string, i: number): string {
  const ref = sheetRef(dataSheet);
  const end = rows + 1;
  const ax1 = (i + 1) * 10000 + 1;
  const ax2 = ax1 + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:lang val="es-MX"/>
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:scatterChart>
<c:scatterStyle val="marker"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:xVal><c:numRef><c:f>${ref}!$B$2:$B$${end}</c:f></c:numRef></c:xVal>
<c:yVal><c:numRef><c:f>${ref}!$C$2:$C$${end}</c:f></c:numRef></c:yVal>
</c:ser>
<c:axId val="${ax1}"/><c:axId val="${ax2}"/>
</c:scatterChart>
<c:valAx>
<c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/><c:axPos val="b"/>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escXml(xLabel)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:numFmt formatCode="0.0" sourceLinked="0"/>
<c:tickLblPos val="nextTo"/><c:crossAx val="${ax2}"/>
</c:valAx>
<c:valAx>
<c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/><c:axPos val="l"/>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escXml(yLabel)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:numFmt formatCode="0.0" sourceLinked="0"/>
<c:tickLblPos val="nextTo"/><c:crossAx val="${ax1}"/>
</c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="1"/>
</c:chart>
</c:chartSpace>`;
}

function buildChartSheetXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView tabSelected="0" workbookViewId="0"/></sheetViews>
<drawing r:id="rId1"/>
</chartsheet>`;
}

function buildChartSheetRels(chartNum: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNum}.xml"/>
</Relationships>`;
}

// ── JSZip injection ───────────────────────────────────────────────────────────
async function injectChartSheets(
  buffer: Buffer | ArrayBuffer,
  charts: { displayName: string; xmlContent: string }[],
): Promise<ArrayBuffer> {
  // jszip is a direct dep of exceljs — always present
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require("jszip") as typeof import("jszip");
  const zip = await JSZip.loadAsync(buffer);

  const wbXml  = await zip.file("xl/workbook.xml")!.async("string");
  const wbRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const ctXml  = await zip.file("[Content_Types].xml")!.async("string");

  const rIdNums     = [...wbRels.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1]));
  const sheetIdNums = [...wbXml.matchAll(/sheetId="(\d+)"/g)].map(m => parseInt(m[1]));
  let maxRId     = rIdNums.length     ? Math.max(...rIdNums)     : 0;
  let maxSheetId = sheetIdNums.length ? Math.max(...sheetIdNums) : 0;

  let newSheets = "";
  let newRels   = "";
  let newCt     = "";

  for (let i = 0; i < charts.length; i++) {
    const chartNum = i + 1;
    maxRId++;
    maxSheetId++;

    zip.file(`xl/charts/chart${chartNum}.xml`,              charts[i].xmlContent);
    zip.file(`xl/chartsheets/sheet${chartNum}.xml`,         buildChartSheetXml());
    zip.file(`xl/chartsheets/_rels/sheet${chartNum}.xml.rels`, buildChartSheetRels(chartNum));

    newSheets += `<sheet name="${escXml(charts[i].displayName)}" sheetId="${maxSheetId}" r:id="rId${maxRId}"/>`;
    newRels   += `<Relationship Id="rId${maxRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet${chartNum}.xml"/>`;
    newCt     += `<Override PartName="/xl/charts/chart${chartNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
    newCt     += `<Override PartName="/xl/chartsheets/sheet${chartNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"/>`;
  }

  zip.file("xl/workbook.xml",            wbXml.replace("</sheets>",         newSheets + "</sheets>"));
  zip.file("xl/_rels/workbook.xml.rels", wbRels.replace("</Relationships>", newRels   + "</Relationships>"));
  zip.file("[Content_Types].xml",        ctXml.replace("</Types>",          newCt     + "</Types>"));

  const nodeBuf = await zip.generateAsync({ type: "nodebuffer" });
  // Convert to plain ArrayBuffer so NextResponse accepts it without type issues
  const ab = new ArrayBuffer(nodeBuf.byteLength);
  new Uint8Array(ab).set(nodeBuf);
  return ab;
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { headers, rows, companyName, nativeCharts = [] } = (await req.json()) as {
    headers: string[];
    rows: Row[];
    companyName: string;
    nativeCharts?: NativeChartReq[];
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "PANDO";
  wb.created = new Date();

  // ── Comparables metrics sheet ─────────────────────────────────────────────
  const ws = wb.addWorksheet("Comparables", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  ws.columns = [
    { width: 30 },
    { width: 9  },
    { width: 14 },
    ...headers.slice(3).map(() => ({ width: 13 })),
  ];

  const hRow = ws.addRow(headers);
  hRow.height = 24;
  hRow.eachCell((cell, col) => {
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C.carbon } };
    cell.font      = { bold: true, color: { argb: C.white }, size: 10, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: col <= 3 ? (col === 1 ? "left" : "center") : "right" };
    cell.border    = { bottom: { style: "thin", color: { argb: C.chalk } } };
  });

  let publicRowCount = 0;
  for (const row of rows) {
    const eRow = ws.addRow(row.cells);
    eRow.height = 20;

    if (row.type === "private") {
      eRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.orangeLight } };
        cell.font = { bold: true, size: 10, name: "Calibri" };
      });
      eRow.getCell(1).border = {
        left:   { style: "medium", color: { argb: C.orange } },
        bottom: { style: "thin",   color: { argb: C.chalk  } },
      };
    } else if (row.type === "median") {
      eRow.eachCell(cell => {
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: C.fogMid } };
        cell.font   = { bold: true, size: 10, name: "Calibri", color: { argb: C.carbon } };
        cell.border = { top: { style: "thin", color: { argb: C.chalk } }, bottom: { style: "thin", color: { argb: C.chalk } } };
      });
    } else {
      publicRowCount++;
      const bg = publicRowCount % 2 === 0 ? C.fog : C.white;
      eRow.eachCell(cell => {
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.font   = { size: 10, name: "Calibri" };
        cell.border = { bottom: { style: "hair", color: { argb: C.chalk } } };
      });
    }

    eRow.getCell(1).alignment = { horizontal: "left",   vertical: "middle" };
    eRow.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    eRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    for (let i = 4; i <= row.cells.length; i++) {
      eRow.getCell(i).alignment = { horizontal: "right", vertical: "middle" };
    }
  }

  ws.addRow([]);
  const noteRow = ws.addRow(["Fuente: Yahoo Finance · Generado por PANDO · " + new Date().toLocaleDateString("es-MX")]);
  noteRow.getCell(1).font      = { italic: true, size: 9, color: { argb: C.slate }, name: "Calibri" };
  noteRow.getCell(1).alignment = { horizontal: "left" };
  ws.mergeCells(noteRow.number, 1, noteRow.number, headers.length);

  // ── Chart data sheets (one per native chart) ──────────────────────────────
  const chartInfos: { displayName: string; xmlContent: string }[] = [];

  for (let i = 0; i < nativeCharts.length; i++) {
    const nc = nativeCharts[i];
    const dataSheetName = `Datos_${i + 1}`; // internal name, ≤ 31 chars, no special chars

    if (nc.type === "column") {
      const ds = wb.addWorksheet(dataSheetName);
      ds.getRow(1).values = ["Empresa", nc.title];
      ds.getRow(1).font   = { bold: true, name: "Calibri", size: 10 };
      nc.categories.forEach((cat, j) => {
        ds.getRow(j + 2).values = [cat ?? "", nc.values[j] ?? null];
      });
      ds.getColumn(1).width = 28;
      ds.getColumn(2).width = 16;
      chartInfos.push({
        displayName: nc.sheetName,
        xmlContent:  buildColumnChartXml(nc.title, dataSheetName, nc.categories.length, i),
      });
    } else if (nc.type === "scatter") {
      const ds = wb.addWorksheet(dataSheetName);
      ds.getRow(1).values = ["Empresa", nc.xLabel, nc.yLabel];
      ds.getRow(1).font   = { bold: true, name: "Calibri", size: 10 };
      nc.points.forEach((pt, j) => {
        ds.getRow(j + 2).values = [pt.label, pt.x, pt.y];
      });
      ds.getColumn(1).width = 15;
      ds.getColumn(2).width = 16;
      ds.getColumn(3).width = 16;
      chartInfos.push({
        displayName: nc.sheetName,
        xmlContent:  buildScatterChartXml(nc.title, dataSheetName, nc.points.length, nc.xLabel, nc.yLabel, i),
      });
    }
  }

  // ── Generate buffer & inject chart sheets ─────────────────────────────────
  const rawBuffer = await wb.xlsx.writeBuffer();
  const safeName  = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const date      = new Date().toISOString().slice(0, 10);
  const finalBuf  = chartInfos.length > 0
    ? await injectChartSheets(rawBuffer, chartInfos)
    : rawBuffer;

  return new NextResponse(finalBuf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="comps_${safeName}_${date}.xlsx"`,
    },
  });
}
