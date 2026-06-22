import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";

type RowType = "private" | "public" | "median";
type Row = { cells: string[]; type: RowType };

// Brand colors (ARGB format for ExcelJS)
const C = {
  carbon:       "FF202020",
  white:        "FFFFFFFF",
  orange:       "FFFF682C",
  orangeLight:  "FFFFF8F5",
  fog:          "FFF7F6F4",
  fogMid:       "FFF0EFEC",
  chalk:        "FFE8E6E2",
  slate:        "FF828282",
  emerald:      "FF059669",
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  type ChartItem = { name: string; base64: string };
  const { headers, rows, companyName, charts = [] } = (await req.json()) as {
    headers: string[];
    rows: Row[];
    companyName: string;
    charts?: ChartItem[];
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "PANDO";
  wb.created = new Date();

  const ws = wb.addWorksheet("Comparables", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  // Column widths
  ws.columns = [
    { width: 30 },  // Company
    { width: 9  },  // Ticker
    { width: 14 },  // Tipo
    ...headers.slice(3).map(() => ({ width: 13 })),
  ];

  // ── Header row ────────────────────────────────────────────────────────────
  const hRow = ws.addRow(headers);
  hRow.height = 24;
  hRow.eachCell((cell, col) => {
    cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: C.carbon } };
    cell.font  = { bold: true, color: { argb: C.white }, size: 10, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: col <= 3 ? (col === 1 ? "left" : "center") : "right" };
    cell.border = { bottom: { style: "thin", color: { argb: C.chalk } } };
  });

  // ── Data rows ─────────────────────────────────────────────────────────────
  let publicRowCount = 0;
  for (const row of rows) {
    const eRow = ws.addRow(row.cells);
    eRow.height = 20;

    if (row.type === "private") {
      // Orange-tinted row for the target private company
      eRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.orangeLight } };
        cell.font = { bold: true, size: 10, name: "Calibri" };
      });
      // Orange left-edge accent via thick left border on col A
      eRow.getCell(1).border = {
        left:   { style: "medium", color: { argb: C.orange } },
        bottom: { style: "thin",   color: { argb: C.chalk  } },
      };

    } else if (row.type === "median") {
      // Median footer
      eRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.fogMid } };
        cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: C.carbon } };
        cell.border = {
          top:    { style: "thin", color: { argb: C.chalk } },
          bottom: { style: "thin", color: { argb: C.chalk } },
        };
      });

    } else {
      // Alternating white / fog for public comps
      publicRowCount++;
      const bgColor = publicRowCount % 2 === 0 ? C.fog : C.white;
      eRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        cell.font = { size: 10, name: "Calibri" };
        cell.border = { bottom: { style: "hair", color: { argb: C.chalk } } };
      });
    }

    // Column alignment (first 3 special, rest right-aligned)
    eRow.getCell(1).alignment = { horizontal: "left",   vertical: "middle" };
    eRow.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    eRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    for (let i = 4; i <= row.cells.length; i++) {
      eRow.getCell(i).alignment = { horizontal: "right", vertical: "middle" };
    }
  }

  // ── Footer note ───────────────────────────────────────────────────────────
  ws.addRow([]);
  const noteRow = ws.addRow([
    "Fuente: Yahoo Finance · Generado por PANDO · " + new Date().toLocaleDateString("es-MX"),
  ]);
  noteRow.getCell(1).font = { italic: true, size: 9, color: { argb: C.slate }, name: "Calibri" };
  noteRow.getCell(1).alignment = { horizontal: "left" };
  ws.mergeCells(noteRow.number, 1, noteRow.number, headers.length);

  // ── Charts sheet ─────────────────────────────────────────────────────────
  if (charts.length > 0) {
    const wsC = wb.addWorksheet("Gráficas", { properties: { defaultRowHeight: 20 } });
    wsC.getColumn(1).width = 90;
    let rowCursor = 1;
    for (const chart of charts) {
      // Title row
      const titleRow = wsC.getRow(rowCursor);
      titleRow.height = 18;
      titleRow.getCell(1).value = chart.name;
      titleRow.getCell(1).font = { bold: true, size: 11, name: "Calibri", color: { argb: C.carbon } };
      rowCursor++;

      // Image (PNG base64 from client)
      const imgId = wb.addImage({ base64: chart.base64, extension: "png" });
      const imgHeightRows = 22;
      wsC.addImage(imgId, {
        tl: { col: 0, row: rowCursor - 1 },
        ext: { width: 860, height: 300 },
        editAs: "oneCell",
      });
      for (let r = rowCursor; r < rowCursor + imgHeightRows; r++) wsC.getRow(r).height = 14;
      rowCursor += imgHeightRows + 1; // gap between charts
    }
  }

  // ── Generate buffer ───────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const safeName = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const date     = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="comps_${safeName}_${date}.xlsx"`,
    },
  });
}
