// Builds a fully formula-driven LBO Excel model — every downstream number
// (Sources & Uses, the operating projection, the debt schedule, IRR/MOIC, the
// sensitivity grid) is a live Excel formula referencing the Assumptions
// sheet's input cells, not a value this code computed and pasted in. Only the
// Assumptions sheet's own input cells and the sensitivity grid's axis labels
// are raw numbers; everything else is `{ formula: "..." }`.
//
// No named ranges: ExcelJS's named-range support is unproven in this codebase
// and a real corruption risk if wrong. Plain 'Sheet Name'!$C$7-style
// references are used everywhere instead — less pretty, much safer.
//
// Circularity avoidance in the Debt Schedule (the one place a naive model
// would go circular): interest expense is always computed from the
// BEGINNING-of-year debt balance, which is fully determined by the prior
// year's ending balance — never from this year's own paydown/ending balance.
import ExcelJS from "exceljs";

export interface LboAssumptions {
  companyName: string;
  currency: "USD" | "MXN" | "EUR";
  transactionYear: number;

  entryEbitda: number;
  revenueYear0: number;
  entryMultiple: number;
  transactionFeesPct: number;
  financingFeesPct: number;

  debtToEbitda: number;
  interestRatePct: number;
  mandatoryAmortPct: number;
  cashSweepPct: number;
  minCashBalance: number;

  // Per-year arrays, length === holdingPeriodYears, index 0 = year 1's assumption.
  // Year 0 is the entry snapshot (revenue/EBITDA come from the inputs above) —
  // no operating activity is modeled for year 0 itself.
  revenueGrowthPct: number[];
  ebitdaMarginPct: number[];
  capexPctRevenue: number[];
  nwcPctRevenue: number[];
  daPctRevenue: number[];
  taxRatePct: number;

  holdingPeriodYears: number;
  exitMultiple: number;

  // Grid axis values for the Sensitivity sheet — computed by the caller
  // (the build route), not by the AI, so they're always a clean, deterministic
  // spread around the chosen entry/exit multiple.
  sensitivityEntryMultiples: number[];
  sensitivityExitMultiples: number[];
}

// ── Styling conventions (standard IB model color coding) ────────────────────
const FONT_NAME = "Calibri";
const INPUT_COLOR = "FF1F4E78";   // blue — hardcoded input
const FORMULA_COLOR = "FF000000"; // black — formula on the same sheet
const LINK_COLOR = "FF006100";    // green — formula pulling from another sheet
const HEADER_FILL = "FF1F4E78";
const INPUT_FILL = "FFDCE6F1";
const SECTION_FILL = "FFF2F2F2";

const FMT_USD = '"$"#,##0';
const FMT_PCT = "0.0%";
const FMT_MULT = '0.00"x"';
const FMT_PCT_IRR = "0.0%";

function colLetter(col: number): string {
  return String.fromCharCode(64 + col); // 1-indexed: 1=A, 2=B, ... good up to col 26
}
function yearCol(n: number): number {
  return 3 + n; // year 0 -> column C (3)
}

function inputCell(ws: ExcelJS.Worksheet, row: number, col: number, label: string, value: number, numFmt: string) {
  ws.getCell(row, 2).value = label;
  const c = ws.getCell(row, col);
  c.value = value;
  c.numFmt = numFmt;
  c.font = { name: FONT_NAME, size: 10, color: { argb: INPUT_COLOR } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
}

function formulaCell(ws: ExcelJS.Worksheet, row: number, col: number, formula: string, numFmt: string, crossSheet = false) {
  const c = ws.getCell(row, col);
  c.value = { formula };
  c.numFmt = numFmt;
  c.font = { name: FONT_NAME, size: 10, color: { argb: crossSheet ? LINK_COLOR : FORMULA_COLOR } };
}

function labelCell(ws: ExcelJS.Worksheet, row: number, col: number, text: string, opts?: { bold?: boolean; section?: boolean }) {
  const c = ws.getCell(row, col);
  c.value = text;
  c.font = { name: FONT_NAME, size: opts?.section ? 11 : 10, bold: !!(opts?.bold || opts?.section), color: { argb: "FF000000" } };
  if (opts?.section) {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } };
  }
}

export async function buildLboWorkbook(a: LboAssumptions): Promise<Buffer> {
  const N = a.holdingPeriodYears;
  if (!Number.isFinite(N) || N < 1) throw new Error("holdingPeriodYears must be at least 1");
  if (a.revenueGrowthPct.length !== N || a.ebitdaMarginPct.length !== N ||
      a.capexPctRevenue.length !== N || a.nwcPctRevenue.length !== N || a.daPctRevenue.length !== N) {
    throw new Error("Per-year assumption arrays must have exactly holdingPeriodYears entries");
  }

  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;

  // ── Sheet 1: Assumptions ───────────────────────────────────────────────────
  const asm = wb.addWorksheet("Assumptions");
  asm.getColumn(1).width = 3;
  asm.getColumn(2).width = 34;
  for (let c = 3; c <= yearCol(N); c++) asm.getColumn(c).width = 13;

  labelCell(asm, 1, 2, `LBO Model — ${a.companyName}`, { bold: true });
  labelCell(asm, 3, 2, "Company"); asm.getCell(3, 3).value = a.companyName;
  labelCell(asm, 4, 2, "Transaction Year"); asm.getCell(4, 3).value = a.transactionYear;

  labelCell(asm, 6, 2, "ENTRY", { section: true });
  inputCell(asm, 7, 3, "Entry EBITDA (LTM)", a.entryEbitda, FMT_USD);
  inputCell(asm, 8, 3, "Entry Revenue (Year 0)", a.revenueYear0, FMT_USD);
  inputCell(asm, 9, 3, "Entry EV / EBITDA Multiple", a.entryMultiple, FMT_MULT);
  formulaCell(asm, 10, 3, "C7*C9", FMT_USD);
  labelCell(asm, 10, 2, "Entry Enterprise Value");
  inputCell(asm, 11, 3, "Transaction Fees %", a.transactionFeesPct, FMT_PCT);
  inputCell(asm, 12, 3, "Financing Fees %", a.financingFeesPct, FMT_PCT);

  labelCell(asm, 14, 2, "FINANCING", { section: true });
  inputCell(asm, 15, 3, "Debt / EBITDA", a.debtToEbitda, FMT_MULT);
  formulaCell(asm, 16, 3, "C7*C15", FMT_USD);
  labelCell(asm, 16, 2, "Initial Debt");
  inputCell(asm, 17, 3, "Interest Rate", a.interestRatePct, FMT_PCT);
  inputCell(asm, 18, 3, "Mandatory Amort % (of orig. principal)", a.mandatoryAmortPct, FMT_PCT);
  inputCell(asm, 19, 3, "Cash Sweep %", a.cashSweepPct, FMT_PCT);
  inputCell(asm, 20, 3, "Minimum Cash Balance", a.minCashBalance, FMT_USD);

  labelCell(asm, 22, 2, "SOURCES & USES", { section: true });
  labelCell(asm, 23, 2, "Uses: Purchase of Enterprise Value"); formulaCell(asm, 23, 3, "C10", FMT_USD);
  labelCell(asm, 24, 2, "Uses: Transaction Fees"); formulaCell(asm, 24, 3, "C10*C11", FMT_USD);
  labelCell(asm, 25, 2, "Uses: Financing Fees"); formulaCell(asm, 25, 3, "C16*C12", FMT_USD);
  labelCell(asm, 26, 2, "Total Uses", { bold: true }); formulaCell(asm, 26, 3, "SUM(C23:C25)", FMT_USD);
  labelCell(asm, 27, 2, "Sources: New Debt"); formulaCell(asm, 27, 3, "C16", FMT_USD);
  labelCell(asm, 28, 2, "Sources: Sponsor Equity (plug)"); formulaCell(asm, 28, 3, "C26-C27", FMT_USD);
  labelCell(asm, 29, 2, "Total Sources", { bold: true }); formulaCell(asm, 29, 3, "SUM(C27:C28)", FMT_USD);

  labelCell(asm, 31, 2, "OPERATING PROJECTION (BASE CASE)", { section: true });
  labelCell(asm, 32, 2, "");
  for (let n = 0; n <= N; n++) asm.getCell(32, yearCol(n)).value = `Year ${n}`;
  asm.getRow(32).font = { name: FONT_NAME, size: 10, bold: true };
  labelCell(asm, 33, 2, "Revenue Growth %");
  labelCell(asm, 34, 2, "EBITDA Margin %");
  labelCell(asm, 35, 2, "Capex % of Revenue");
  labelCell(asm, 36, 2, "NWC % of Revenue");
  labelCell(asm, 37, 2, "D&A % of Revenue");
  for (let n = 1; n <= N; n++) {
    const col = yearCol(n);
    inputCell(asm, 33, col, "", a.revenueGrowthPct[n - 1], FMT_PCT);
    inputCell(asm, 34, col, "", a.ebitdaMarginPct[n - 1], FMT_PCT);
    inputCell(asm, 35, col, "", a.capexPctRevenue[n - 1], FMT_PCT);
    inputCell(asm, 36, col, "", a.nwcPctRevenue[n - 1], FMT_PCT);
    inputCell(asm, 37, col, "", a.daPctRevenue[n - 1], FMT_PCT);
  }
  labelCell(asm, 39, 2, "Tax Rate");
  inputCell(asm, 39, 3, "", a.taxRatePct, FMT_PCT);

  labelCell(asm, 41, 2, "EXIT", { section: true });
  inputCell(asm, 42, 3, "Holding Period (Years)", N, "0");
  inputCell(asm, 43, 3, "Exit EV / EBITDA Multiple", a.exitMultiple, FMT_MULT);

  const AS = "Assumptions";
  const REF = {
    entryEbitda: `${AS}!$C$7`, revenueYear0: `${AS}!$C$8`, entryMultiple: `${AS}!$C$9`, entryEV: `${AS}!$C$10`,
    txnFeesPct: `${AS}!$C$11`, finFeesPct: `${AS}!$C$12`,
    debtToEbitda: `${AS}!$C$15`, initialDebt: `${AS}!$C$16`, interestRate: `${AS}!$C$17`,
    mandAmortPct: `${AS}!$C$18`, cashSweepPct: `${AS}!$C$19`, minCash: `${AS}!$C$20`,
    sponsorEquity: `${AS}!$C$28`, taxRate: `${AS}!$C$39`, holdYears: `${AS}!$C$42`, exitMultiple: `${AS}!$C$43`,
    growth: (n: number) => `${AS}!$${colLetter(yearCol(n))}$33`,
    margin: (n: number) => `${AS}!$${colLetter(yearCol(n))}$34`,
    capex: (n: number) => `${AS}!$${colLetter(yearCol(n))}$35`,
    nwc: (n: number) => `${AS}!$${colLetter(yearCol(n))}$36`,
    da: (n: number) => `${AS}!$${colLetter(yearCol(n))}$37`,
  };

  // ── Sheet 2: Operating Model ───────────────────────────────────────────────
  const om = wb.addWorksheet("Operating Model");
  om.getColumn(1).width = 3; om.getColumn(2).width = 30;
  for (let c = 3; c <= yearCol(N); c++) om.getColumn(c).width = 13;

  labelCell(om, 1, 2, "OPERATING MODEL", { bold: true });
  for (let n = 0; n <= N; n++) om.getCell(3, yearCol(n)).value = `Year ${n}`;
  om.getRow(3).font = { name: FONT_NAME, size: 10, bold: true };

  const OM = "'Operating Model'";
  const rows = { revenue: 4, ebitda: 5, da: 6, ebit: 7, interest: 8, ebt: 9, taxes: 10, ni: 11, daAdd: 12, capex: 13, nwc: 14, cfads: 15, mandAmort: 16, fcfSweep: 17 };
  labelCell(om, rows.revenue, 2, "Revenue");
  labelCell(om, rows.ebitda, 2, "EBITDA");
  labelCell(om, rows.da, 2, "D&A");
  labelCell(om, rows.ebit, 2, "EBIT");
  labelCell(om, rows.interest, 2, "Interest Expense");
  labelCell(om, rows.ebt, 2, "EBT");
  labelCell(om, rows.taxes, 2, "Taxes");
  labelCell(om, rows.ni, 2, "Net Income", { bold: true });
  labelCell(om, rows.daAdd, 2, "(+) D&A");
  labelCell(om, rows.capex, 2, "(-) Capex");
  labelCell(om, rows.nwc, 2, "(-) Increase in NWC");
  labelCell(om, rows.cfads, 2, "Cash Flow Avail. for Debt Service", { bold: true });
  labelCell(om, rows.mandAmort, 2, "(-) Mandatory Amortization");
  labelCell(om, rows.fcfSweep, 2, "Free Cash Flow for Sweep", { bold: true });

  const DS = "'Debt Schedule'";

  for (let n = 0; n <= N; n++) {
    const col = yearCol(n);
    const L = colLetter(col);
    if (n === 0) {
      formulaCell(om, rows.revenue, col, REF.revenueYear0, FMT_USD, true);
      formulaCell(om, rows.ebitda, col, REF.entryEbitda, FMT_USD, true);
      om.getCell(rows.da, col).value = 0; om.getCell(rows.da, col).numFmt = FMT_USD;
      formulaCell(om, rows.ebit, col, `${L}${rows.ebitda}-${L}${rows.da}`, FMT_USD);
      om.getCell(rows.interest, col).value = 0; om.getCell(rows.interest, col).numFmt = FMT_USD;
      formulaCell(om, rows.ebt, col, `${L}${rows.ebit}-${L}${rows.interest}`, FMT_USD);
      om.getCell(rows.taxes, col).value = 0; om.getCell(rows.taxes, col).numFmt = FMT_USD;
      formulaCell(om, rows.ni, col, `${L}${rows.ebt}-${L}${rows.taxes}`, FMT_USD);
      for (const r of [rows.daAdd, rows.capex, rows.nwc, rows.cfads, rows.mandAmort, rows.fcfSweep]) {
        om.getCell(r, col).value = 0; om.getCell(r, col).numFmt = FMT_USD;
      }
      continue;
    }
    const prevL = colLetter(col - 1);
    formulaCell(om, rows.revenue, col, `${prevL}${rows.revenue}*(1+${REF.growth(n)})`, FMT_USD, true);
    formulaCell(om, rows.ebitda, col, `${L}${rows.revenue}*${REF.margin(n)}`, FMT_USD, true);
    formulaCell(om, rows.da, col, `${L}${rows.revenue}*${REF.da(n)}`, FMT_USD, true);
    formulaCell(om, rows.ebit, col, `${L}${rows.ebitda}-${L}${rows.da}`, FMT_USD);
    formulaCell(om, rows.interest, col, `${DS}!${L}${5}`, FMT_USD, true); // Debt Schedule row 5 = interest expense
    formulaCell(om, rows.ebt, col, `${L}${rows.ebit}-${L}${rows.interest}`, FMT_USD);
    formulaCell(om, rows.taxes, col, `MAX(${L}${rows.ebt},0)*${REF.taxRate}`, FMT_USD, true);
    formulaCell(om, rows.ni, col, `${L}${rows.ebt}-${L}${rows.taxes}`, FMT_USD);
    formulaCell(om, rows.daAdd, col, `${L}${rows.da}`, FMT_USD);
    formulaCell(om, rows.capex, col, `-${L}${rows.revenue}*${REF.capex(n)}`, FMT_USD, true);
    formulaCell(om, rows.nwc, col, `-(${L}${rows.revenue}-${prevL}${rows.revenue})*${REF.nwc(n)}`, FMT_USD, true);
    formulaCell(om, rows.cfads, col, `${L}${rows.ni}+${L}${rows.daAdd}+${L}${rows.capex}+${L}${rows.nwc}`, FMT_USD);
    formulaCell(om, rows.mandAmort, col, `-${DS}!${L}${6}`, FMT_USD, true); // Debt Schedule row 6 = mandatory amort (positive amount)
    formulaCell(om, rows.fcfSweep, col, `${L}${rows.cfads}+${L}${rows.mandAmort}`, FMT_USD);
  }

  // ── Sheet 3: Debt Schedule ─────────────────────────────────────────────────
  const ds = wb.addWorksheet("Debt Schedule");
  ds.getColumn(1).width = 3; ds.getColumn(2).width = 30;
  for (let c = 3; c <= yearCol(N); c++) ds.getColumn(c).width = 13;

  labelCell(ds, 1, 2, "DEBT SCHEDULE", { bold: true });
  for (let n = 0; n <= N; n++) ds.getCell(3, yearCol(n)).value = `Year ${n}`;
  ds.getRow(3).font = { name: FONT_NAME, size: 10, bold: true };

  const dRows = { begin: 4, interest: 5, mandAmort: 6, cashAvail: 7, sweep: 8, end: 9, cash: 10 };
  labelCell(ds, dRows.begin, 2, "Beginning Debt Balance");
  labelCell(ds, dRows.interest, 2, "Interest Expense");
  labelCell(ds, dRows.mandAmort, 2, "Mandatory Amortization");
  labelCell(ds, dRows.cashAvail, 2, "Cash Available for Sweep");
  labelCell(ds, dRows.sweep, 2, "Cash Sweep");
  labelCell(ds, dRows.end, 2, "Ending Debt Balance", { bold: true });
  labelCell(ds, dRows.cash, 2, "Cumulative Cash Balance", { bold: true });

  for (let n = 0; n <= N; n++) {
    const col = yearCol(n);
    const L = colLetter(col);
    if (n === 0) {
      formulaCell(ds, dRows.begin, col, REF.initialDebt, FMT_USD, true);
      ds.getCell(dRows.interest, col).value = 0; ds.getCell(dRows.interest, col).numFmt = FMT_USD;
      ds.getCell(dRows.mandAmort, col).value = 0; ds.getCell(dRows.mandAmort, col).numFmt = FMT_USD;
      ds.getCell(dRows.cashAvail, col).value = 0; ds.getCell(dRows.cashAvail, col).numFmt = FMT_USD;
      ds.getCell(dRows.sweep, col).value = 0; ds.getCell(dRows.sweep, col).numFmt = FMT_USD;
      formulaCell(ds, dRows.end, col, `${L}${dRows.begin}`, FMT_USD);
      formulaCell(ds, dRows.cash, col, REF.minCash, FMT_USD, true);
      continue;
    }
    const prevL = colLetter(col - 1);
    formulaCell(ds, dRows.begin, col, `${prevL}${dRows.end}`, FMT_USD);
    formulaCell(ds, dRows.interest, col, `${L}${dRows.begin}*${REF.interestRate}`, FMT_USD, true);
    formulaCell(ds, dRows.mandAmort, col, `MIN(${L}${dRows.begin},${REF.initialDebt}*${REF.mandAmortPct})`, FMT_USD, true);
    formulaCell(ds, dRows.cashAvail, col, `${OM}!${L}${17}`, FMT_USD, true); // Operating Model row 17 = FCF for sweep
    formulaCell(ds, dRows.sweep, col, `MIN(MAX(${L}${dRows.begin}-${L}${dRows.mandAmort},0),MAX(${L}${dRows.cashAvail},0)*${REF.cashSweepPct})`, FMT_USD, true);
    formulaCell(ds, dRows.end, col, `${L}${dRows.begin}-${L}${dRows.mandAmort}-${L}${dRows.sweep}`, FMT_USD);
    formulaCell(ds, dRows.cash, col, `${prevL}${dRows.cash}+${L}${dRows.cashAvail}-${L}${dRows.sweep}`, FMT_USD);
  }

  // ── Sheet 4: Returns ───────────────────────────────────────────────────────
  const ret = wb.addWorksheet("Returns");
  ret.getColumn(1).width = 3; ret.getColumn(2).width = 30; ret.getColumn(3).width = 16;
  for (let c = 4; c <= yearCol(N); c++) ret.getColumn(c).width = 13;

  labelCell(ret, 1, 2, "RETURNS", { bold: true });
  const exitCol = yearCol(N);
  const exitL = colLetter(exitCol);

  labelCell(ret, 3, 2, "Exit Year EBITDA"); formulaCell(ret, 3, 3, `${OM}!${exitL}5`, FMT_USD, true);
  labelCell(ret, 4, 2, "Exit EV / EBITDA Multiple"); formulaCell(ret, 4, 3, REF.exitMultiple, FMT_MULT, true);
  labelCell(ret, 5, 2, "Exit Enterprise Value"); formulaCell(ret, 5, 3, "C3*C4", FMT_USD);
  labelCell(ret, 6, 2, "Less: Exit-Year Net Debt"); formulaCell(ret, 6, 3, `${DS}!${exitL}9-${DS}!${exitL}10`, FMT_USD, true);
  labelCell(ret, 7, 2, "Exit Equity Value", { bold: true }); formulaCell(ret, 7, 3, "C5-C6", FMT_USD);

  labelCell(ret, 9, 2, "EQUITY CASH FLOWS", { section: true });
  for (let n = 0; n <= N; n++) ret.getCell(10, yearCol(n)).value = `Year ${n}`;
  ret.getRow(10).font = { name: FONT_NAME, size: 10, bold: true };
  labelCell(ret, 11, 2, "Equity Cash Flow");
  formulaCell(ret, 11, yearCol(0), `-${REF.sponsorEquity}`, FMT_USD, true);
  for (let n = 1; n < N; n++) { ret.getCell(11, yearCol(n)).value = 0; ret.getCell(11, yearCol(n)).numFmt = FMT_USD; }
  formulaCell(ret, 11, exitCol, "C7", FMT_USD);

  labelCell(ret, 13, 2, "IRR", { bold: true });
  formulaCell(ret, 13, 3, `IRR(${colLetter(yearCol(0))}11:${exitL}11)`, FMT_PCT_IRR);
  labelCell(ret, 14, 2, "MOIC", { bold: true });
  formulaCell(ret, 14, 3, `${exitL}11/-${colLetter(yearCol(0))}11`, FMT_MULT);

  // ── Sheet 5: Sensitivity ───────────────────────────────────────────────────
  const sens = wb.addWorksheet("Sensitivity");
  sens.getColumn(1).width = 3; sens.getColumn(2).width = 10;
  const entryMults = a.sensitivityEntryMultiples;
  const exitMults = a.sensitivityExitMultiples;
  for (let c = 3; c <= 2 + exitMults.length; c++) sens.getColumn(c).width = 12;

  labelCell(sens, 1, 2, "SENSITIVITY: IRR BY ENTRY x EXIT MULTIPLE", { bold: true });
  labelCell(sens, 2, 2,
    "Note (v1 simplification): only entry cost basis and exit value flex across this grid — the debt paydown path is held at the base case for every cell, not re-run per scenario.");
  sens.getCell(2, 2).font = { name: FONT_NAME, size: 8, italic: true, color: { argb: "FF666666" } };

  const gridTop = 4;
  labelCell(sens, gridTop, 2, "Entry \\ Exit", { bold: true });
  exitMults.forEach((v, j) => {
    const c = sens.getCell(gridTop, 3 + j);
    c.value = v; c.numFmt = FMT_MULT; c.font = { name: FONT_NAME, size: 10, bold: true };
  });
  entryMults.forEach((v, i) => {
    const c = sens.getCell(gridTop + 1 + i, 2);
    c.value = v; c.numFmt = FMT_MULT; c.font = { name: FONT_NAME, size: 10, bold: true };
  });

  for (let i = 0; i < entryMults.length; i++) {
    for (let j = 0; j < exitMults.length; j++) {
      const row = gridTop + 1 + i;
      const col = 3 + j;
      const entryRef = `$B${row}`;
      const exitRef = `${colLetter(3 + j)}$${gridTop}`;
      const entryEquity = `(${REF.entryEbitda}*${entryRef}+${REF.entryEbitda}*${entryRef}*${REF.txnFeesPct}+${REF.initialDebt}*${REF.finFeesPct}-${REF.initialDebt})`;
      const exitEquity = `(${OM}!${exitL}5*${exitRef}-(${DS}!${exitL}9-${DS}!${exitL}10))`;
      const formula = `(${exitEquity}/${entryEquity})^(1/${REF.holdYears})-1`;
      formulaCell(sens, row, col, formula, FMT_PCT_IRR, true);
    }
  }

  const moicTop = gridTop + entryMults.length + 3;
  labelCell(sens, moicTop - 1, 2, "MOIC BY ENTRY x EXIT MULTIPLE", { bold: true });
  labelCell(sens, moicTop, 2, "Entry \\ Exit", { bold: true });
  exitMults.forEach((v, j) => {
    const c = sens.getCell(moicTop, 3 + j);
    c.value = v; c.numFmt = FMT_MULT; c.font = { name: FONT_NAME, size: 10, bold: true };
  });
  entryMults.forEach((v, i) => {
    const c = sens.getCell(moicTop + 1 + i, 2);
    c.value = v; c.numFmt = FMT_MULT; c.font = { name: FONT_NAME, size: 10, bold: true };
  });
  for (let i = 0; i < entryMults.length; i++) {
    for (let j = 0; j < exitMults.length; j++) {
      const row = moicTop + 1 + i;
      const col = 3 + j;
      const entryRef = `$B${row}`;
      const exitRef = `${colLetter(3 + j)}$${moicTop}`;
      const entryEquity = `(${REF.entryEbitda}*${entryRef}+${REF.entryEbitda}*${entryRef}*${REF.txnFeesPct}+${REF.initialDebt}*${REF.finFeesPct}-${REF.initialDebt})`;
      const exitEquity = `(${OM}!${exitL}5*${exitRef}-(${DS}!${exitL}9-${DS}!${exitL}10))`;
      const formula = `${exitEquity}/${entryEquity}`;
      formulaCell(sens, row, col, formula, FMT_MULT, true);
    }
  }

  // Header band across each sheet for a bit of polish
  for (const sheet of [asm, om, ds, ret, sens]) {
    sheet.getRow(1).height = 22;
    sheet.getCell(1, 2).font = { name: FONT_NAME, size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    for (let c = 1; c <= yearCol(N) + 1; c++) {
      const cell = sheet.getCell(1, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
