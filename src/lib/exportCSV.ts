/**
 * exportCSV — utility to download data as a UTF-8 BOM CSV file
 * Compatible with Excel (es-AR locale) and Google Sheets
 */
export function exportCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  const BOM = "﻿"; // UTF-8 BOM for Excel compatibility
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    // Wrap in quotes if contains comma, newline or quote
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };

  const lines = [
    headers.map(escape).join(","),
    ...rows.map(row => row.map(escape).join(",")),
  ];

  const csv = BOM + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Format a date for CSV (dd/MM/yyyy) */
export function csvDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("es-AR");
  } catch {
    return dateStr;
  }
}

/** Format currency for CSV (no symbol, comma as decimal) */
export function csvARS(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0";
  return String(Number(value).toFixed(2));
}
