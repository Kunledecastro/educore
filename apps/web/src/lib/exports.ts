import "server-only";
import ExcelJS from "exceljs";
import { neutralizeFormula, toCsv } from "./imports/csv";

export const MAX_EXPORT_ROWS = 10_000;

export type ExportFormat = "csv" | "xlsx";

export interface ExportTable {
  sheetName: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

/** Builds the download. Column headers match the import templates, so an export can be edited and re-imported. */
export async function renderExport(table: ExportTable, format: ExportFormat): Promise<{ body: Uint8Array | string; contentType: string; ext: string }> {
  if (format === "csv") {
    return { body: toCsv(table.headers, table.rows), contentType: "text/csv; charset=utf-8", ext: "csv" };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "EduCore";
  const ws = wb.addWorksheet(table.sheetName.slice(0, 31));
  ws.addRow(table.headers).font = { bold: true };
  for (const r of table.rows) ws.addRow(r.map((v) => (typeof v === "string" ? neutralizeFormula(v) : (v ?? ""))));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns.forEach((col, i) => {
    const longest = Math.max(table.headers[i]!.length, ...table.rows.slice(0, 500).map((r) => String(r[i] ?? "").length));
    col.width = Math.min(Math.max(longest + 2, 10), 50);
  });
  const buf = await wb.xlsx.writeBuffer();
  return {
    body: new Uint8Array(buf as ArrayBuffer) as Uint8Array<ArrayBuffer>,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  };
}

export function exportFileName(kind: string, school: string | null | undefined, ext: string, today = new Date()): string {
  const slug = (school ?? "educore").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "educore";
  return `${kind}-${slug}-${today.toISOString().slice(0, 10)}.${ext}`;
}
