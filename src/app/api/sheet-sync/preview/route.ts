import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listStages } from "@/lib/deals";
import {
  downloadSheet, guessColumnMap, guessHeaderRow, headersOf, parseSheetUrl, readWorkbook, stageValues,
  type ColumnMap, type StageMap,
} from "@/lib/sheetSync";

export const maxDuration = 60;

// POST { url, sheetName?, headerRow?, columnMap?, stageMap? } — read the file and suggest the mapping
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const ref = parseSheetUrl(String(b.url ?? ""));
  if (!ref) return NextResponse.json({ error: "Paste the link of a Google Sheet or of an Excel file in Google Drive" }, { status: 400 });
  try {
    const tabs = await readWorkbook(await downloadSheet(ref));
    if (!tabs.length) return NextResponse.json({ error: "The file has no sheets" }, { status: 400 });
    const tab = tabs.find(t => t.name === b.sheetName) ?? tabs[0];
    const headerRow = Number(b.headerRow) >= 1 ? Math.round(Number(b.headerRow)) : guessHeaderRow(tab.rows);
    const headers = headersOf(tab, headerRow);
    const given = (b.columnMap ?? null) as ColumnMap | null;
    const columnMap: ColumnMap = given && Object.values(given).some(h => h && headers.includes(h)) ? given : guessColumnMap(headers);
    const stages = await listStages();
    return NextResponse.json({
      kind: ref.kind,
      tabs: tabs.map(t => t.name),
      sheetName: tab.name,
      headerRow,
      headers,
      sample: tab.rows.slice(headerRow, headerRow + 6),
      rowCount: tab.rows.slice(headerRow).filter(r => r.some(Boolean)).length,
      columnMap,
      stageValues: stageValues(tab, headerRow, columnMap, stages, (b.stageMap ?? {}) as StageMap),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the file" }, { status: 400 });
  }
}
