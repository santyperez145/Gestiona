/**
 * Arqueo de caja (2026-10-23): lo que tiene que haber por medio de pago y la
 * forma en que la base recibe el conteo de billetes.
 *
 * `sistemaPorMedio` hace la misma cuenta que `cash_session_por_medio` en la
 * base (entradas menos salidas del turno, sin efectivo): la pantalla muestra
 * contra qué se compara antes de registrar, y la base vuelve a calcularlo.
 */

/** Billetes y monedas vigentes del peso (BCRA). La base acepta exactamente estos. */
export const BILLETES = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10] as const;
export const MONEDAS = [10, 5, 2, 1] as const;

const ENTRADAS = new Set(["sale_in", "debt_payment", "manual_in"]);
const SALIDAS = new Set(["refund_out", "expense_out", "supplier_out", "manual_out"]);

export type MovimientoDeCaja = { entry_type: string; payment_method?: string | null; amount_ars: number | string };

export const NOMBRE_MEDIO: Record<string, string> = {
  debito: "Débito", credito: "Crédito", transferencia: "Transferencia", qr: "QR",
  mercadopago: "Mercado Pago", gestiona_pay: "Mercado Pago", cheque: "Cheque", otro: "Otro",
};

export function sistemaPorMedio(movimientos: MovimientoDeCaja[]): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (const m of movimientos) {
    const medio = String(m.payment_method ?? "efectivo").trim().toLowerCase() || "efectivo";
    if (medio === "efectivo" || m.entry_type === "opening" || m.entry_type === "closing") continue;
    const signo = ENTRADAS.has(m.entry_type) ? 1 : SALIDAS.has(m.entry_type) ? -1 : 0;
    if (!signo) continue;
    resultado[medio] = Math.round(((resultado[medio] ?? 0) + signo * Number(m.amount_ars)) * 100) / 100;
  }
  return resultado;
}

/**
 * Del contador de billetes (valor → cantidad) a lo que guarda la base: un
 * billete y una moneda del mismo valor ($10) se suman.
 */
export function denominacionesParaBase(conteo: Record<number, number> | null | undefined): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (const [valor, cantidad] of Object.entries(conteo ?? {})) {
    const n = Math.max(0, Math.floor(Number(cantidad) || 0));
    if (!n) continue;
    resultado[String(Number(valor))] = (resultado[String(Number(valor))] ?? 0) + n;
  }
  return resultado;
}

export function totalDenominaciones(conteo: Record<string, number>): number {
  return Object.entries(conteo).reduce((s, [valor, cantidad]) => s + Number(valor) * Number(cantidad), 0);
}
