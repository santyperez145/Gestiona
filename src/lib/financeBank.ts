/**
 * F5.4 — Conciliación bancaria (lado cliente).
 *
 * Toda la autoridad vive en la base: `bank_statement_upload` importa el
 * extracto (idempotente por hash), `bank_lines_match` propone matches contra
 * los asientos que mueven banco y `bank_line_confirm` confirma o rechaza.
 * Acá sólo se orquesta y se tipa.
 */
import { supabase } from "@/integrations/supabase/client";

export interface BankStatement {
  id: string;
  banco: string;
  fecha_desde: string;
  fecha_hasta: string;
  row_count: number;
  matched_count: number;
  total_ingresos: number;
  total_egresos: number;
  status: 'importado' | 'parcial' | 'conciliado';
  created_at: string;
}

export interface BankLine {
  id: string;
  fecha: string;
  concepto: string;
  referencia: string | null;
  monto: number;
  match_status: 'pendiente' | 'propuesto' | 'confirmado' | 'sin_match';
  match_entry_id: string | null;
  matched_at: string | null;
}

/** Una fila del extracto tal como la escribe el importador. */
export interface BankLineInput {
  fecha: string;
  concepto: string;
  referencia?: string;
  monto: number;
}

/** Importa un extracto y devuelve el id del lote (idempotente por hash). */
export async function bankStatementUpload(input: {
  orgId: string;
  banco: string;
  fechaDesde: string;
  fechaHasta: string;
  lines: BankLineInput[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("bank_statement_upload" as never, {
    p_org: input.orgId,
    p_banco: input.banco,
    p_fecha_desde: input.fechaDesde,
    p_fecha_hasta: input.fechaHasta,
    p_lines: input.lines,
  } as never);
  if (error) throw error;
  return String(data);
}

/** Recalcula las propuestas de match y devuelve cuántas propuso. */
export async function bankLinesMatch(statementId: string): Promise<number> {
  const { data, error } = await supabase.rpc("bank_lines_match" as never, {
    p_statement_id: statementId,
  } as never);
  if (error) throw error;
  return Number(data ?? 0);
}

/** Confirma o rechaza el match propuesto de un movimiento. */
export async function bankLineConfirm(lineId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("bank_line_confirm" as never, {
    p_line_id: lineId,
    p_accept: accept,
  } as never);
  if (error) throw error;
}

/**
 * Parser de CSV bancario con detección de columnas.
 *
 * Acepta separador `,` o `;` y comillas. Busca por nombre de columna
 * (fecha/date, concepto/detalle/descripcion, referencia, monto/importe/
 * amount/credito/debito); si el CSV no tiene encabezado reconocible, falla
 * con un mensaje accionable en vez de importar basura.
 */
export function parseBankCsv(raw: string): { lines: BankLineInput[] } {
  const text = raw.replace(/^\uFEFF/, '');
  const firstBreak = text.indexOf('\n');
  if (firstBreak === -1) throw new Error("El archivo no tiene filas");
  const headerLine = text.slice(0, firstBreak).trim();
  const sep = (headerLine.match(/;/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === sep && !quoted) {
        out.push(cur); cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };

  const headers = split(headerLine).map(h => h.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const idx = (names: string[]) =>
    headers.findIndex(h => names.some(n => h.includes(n)));

  const iFecha = idx(['fecha', 'date']);
  const iConcepto = idx(['concepto', 'detalle', 'descripcion', 'description', 'movimiento']);
  const iRef = idx(['referencia', 'reference', 'numero comprob', 'id transaccion']);
  const iMonto = idx(['monto', 'importe', 'amount', 'credito']);
  const iDebito = idx(['debito', 'debit']);
  if (iFecha === -1 || iConcepto === -1 || (iMonto === -1 && iDebito === -1)) {
    throw new Error(
      "No pudimos reconocer las columnas. El CSV necesita columnas de fecha, concepto y monto (o credito/debito)."
    );
  }

  const parseMonto = (s: string): number => {
    let v = s.trim();
    if (!v) return 0;
    // es-AR: 1.234,56 → 1234.56
    if (/,\d{2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
    else v = v.replace(/,/g, '');
    const n = Number(v.replace(/[$\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };

  const toIso = (s: string): string | null => {
    const v = s.trim();
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  };

  const lines: BankLineInput[] = [];
  for (const line of text.slice(firstBreak + 1).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = split(line);
    const fecha = toIso(cells[iFecha] ?? '');
    const concepto = (cells[iConcepto] ?? '').trim();
    let monto = iMonto !== -1 ? parseMonto(cells[iMonto] ?? '') : 0;
    if (monto === 0 && iDebito !== -1) {
      const deb = parseMonto(cells[iDebito] ?? '');
      if (deb !== 0) monto = -Math.abs(deb);
    }
    if (!fecha || !concepto || monto === 0) continue;
    lines.push({
      fecha,
      concepto: concepto.slice(0, 500),
      referencia: iRef !== -1 ? (cells[iRef] ?? '').trim().slice(0, 200) || undefined : undefined,
      monto,
    });
  }
  if (lines.length === 0) {
    throw new Error("El CSV no tiene movimientos utilizables (faltan fecha, concepto o monto).");
  }
  return { lines };
}
