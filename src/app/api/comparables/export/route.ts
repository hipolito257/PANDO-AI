import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";

type RowType = "private" | "public" | "median";
type Row = { cells: string[]; type: RowType };

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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { headers, rows, companyName } = (await req.json()) as {
    headers: string[];
    rows: Row[];
    companyName: string;
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "PANDO";
  wb.created = new Date();

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

  // ── Header row ─────────────────────────────────────────────────────────────
  const hRow = ws.addRow(headers);
  hRow.height = 24;
  hRow.eachCell((cell, col) => {
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: C.carbon } };
    cell.font      = { bold: true, color: { argb: C.white }, size: 10, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: col <= 3 ? (col === 1 ? "left" : "center") : "right" };
    cell.border    = { bottom: { style: "thin", color: { argb: C.chalk } } };
  });

  // ── Data rows ──────────────────────────────────────────────────────────────
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

  // ── Footer note ────────────────────────────────────────────────────────────
  ws.addRow([]);
  const noteRow = ws.addRow(["Fuente: Yahoo Finance · Generado por PANDO · " + new Date().toLocaleDateString("es-MX")]);
  noteRow.getCell(1).font      = { italic: true, size: 9, color: { argb: C.slate }, name: "Calibri" };
  noteRow.getCell(1).alignment = { horizontal: "left" };
  ws.mergeCells(noteRow.number, 1, noteRow.number, headers.length);

  // ── Generate ───────────────────────────────────────────────────────────────
  const buffer   = await wb.xlsx.writeBuffer();
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
