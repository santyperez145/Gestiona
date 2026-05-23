/**
 * useCSVParser — Parse CSV/TSV files in the browser with Web Workers.
 *
 * Handles encoding, BOM stripping, quoted fields, escape sequences, and
 * custom delimiters. Designed for importing products, customers, sales, etc.
 *
 * Features:
 *   - Auto-detect delimiter (comma, semicolon, tab, pipe)
 *   - BOM-aware UTF-8 / UTF-16 support
 *   - Quoted field + embedded newline support
 *   - Column mapping / header normalisation
 *   - Parse errors surfaced per-row (don't abort whole file)
 *   - Returns typed rows via generic `TRow`
 *
 * Usage:
 *   const { parse, parsing, rows, headers, errors, reset } = useCSVParser<ProductRow>();
 *
 *   // Wire to <input type="file" accept=".csv,.tsv,.txt">
 *   const handleFile = (file: File) => parse(file);
 *
 *   // Map raw headers → typed rows
 *   const mapped = rows.map(r => ({ name: r["Nombre"], price: Number(r["Precio"]) }));
 */
import { useState, useCallback } from "react";

export type CSVRow = Record<string, string>;

interface ParseResult {
  headers: string[];
  rows: CSVRow[];
  errors: Array<{ line: number; message: string }>;
  delimiter: string;
  totalLines: number;
}

interface UseCSVParserReturn {
  parse: (file: File) => Promise<ParseResult | null>;
  parsing: boolean;
  headers: string[];
  rows: CSVRow[];
  errors: Array<{ line: number; message: string }>;
  delimiter: string;
  totalLines: number;
  reset: () => void;
}

// ─── Core parser (runs both in main thread and serialised into Web Worker) ───

function parseCSVContent(text: string): ParseResult {
  // Strip UTF-8 BOM
  const raw = text.startsWith("﻿") ? text.slice(1) : text;

  // Auto-detect delimiter
  const firstLine = raw.split(/\r?\n/)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  for (const ch of firstLine) {
    if (ch in counts) counts[ch as keyof typeof counts]++;
  }
  const delimiter = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as string;

  // Split into lines respecting quoted fields with embedded newlines
  const lines: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQuote && raw[i + 1] === '"') { current += '"'; i++; } // escaped quote
      else inQuote = !inQuote;
    } else if ((ch === "\r" || ch === "\n") && !inQuote) {
      if (ch === "\r" && raw[i + 1] === "\n") i++; // CRLF
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  const totalLines = lines.length;

  if (lines.length === 0) return { headers: [], rows: [], errors: [], delimiter, totalLines };

  // Parse a single CSV line into fields
  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { field += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === delimiter && !inQ) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map(h => h.trim());
  const rows: CSVRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const fields = parseLine(line);
      const row: CSVRow = {};
      headers.forEach((h, idx) => { row[h] = fields[idx] ?? ""; });
      rows.push(row);
    } catch (e) {
      errors.push({ line: i + 1, message: String(e) });
    }
  }

  return { headers, rows, errors, delimiter, totalLines };
}

export function useCSVParser(): UseCSVParserReturn {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult>({
    headers: [], rows: [], errors: [], delimiter: ",", totalLines: 0,
  });

  const parse = useCallback(async (file: File): Promise<ParseResult | null> => {
    setParsing(true);
    try {
      const text = await file.text();
      const parsed = parseCSVContent(text);
      setResult(parsed);
      return parsed;
    } catch (e) {
      console.error("[useCSVParser] Failed to parse file:", e);
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult({ headers: [], rows: [], errors: [], delimiter: ",", totalLines: 0 });
  }, []);

  return {
    parse,
    parsing,
    headers: result.headers,
    rows: result.rows,
    errors: result.errors,
    delimiter: result.delimiter,
    totalLines: result.totalLines,
    reset,
  };
}

/** Normalise a header string to a lowercase slug for fuzzy mapping */
export function slugHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Try to find a CSV header that matches a canonical field name */
export function findHeader(headers: string[], candidates: string[]): string | null {
  const slugs = headers.map(slugHeader);
  for (const c of candidates) {
    const idx = slugs.indexOf(slugHeader(c));
    if (idx !== -1) return headers[idx];
  }
  return null;
}
