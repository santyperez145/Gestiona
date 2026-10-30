/**
 * Saldo a favor parcial en un pedido online (2026-10-30, migración
 * 20261030001400): cuánto paga el saldo y cuánto queda por el otro medio, y
 * cómo se le dice al comprador. El total del pedido no cambia (se factura
 * completo); la base decide lo que se aplica, esto es el espejo.
 */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function repartoDelSaldo(saldo: number, total: number): { aplicado: number; resta: number } {
  const aplicado = Math.max(0, Math.min(r2(saldo), r2(total)));
  return { aplicado, resta: r2(r2(total) - aplicado) };
}

/** Medios con los que el saldo se combina hoy (Mercado Pago, en un paso siguiente). */
export function combinaConSaldo(metodo: string | null | undefined): boolean {
  const m = String(metodo ?? "").toLowerCase().trim();
  return m === "transferencia" || m === "efectivo";
}

export function textoUsarSaldo(saldo: number, total: number, metodo: string, fmt: (n: number) => string): string {
  const { aplicado, resta } = repartoDelSaldo(saldo, total);
  if (resta <= 0) return `Usar mi saldo a favor (${fmt(aplicado)}): cubre todo el pedido`;
  const como = String(metodo).toLowerCase() === "transferencia" ? "por transferencia" : "en efectivo";
  return `Usar mi saldo a favor (${fmt(aplicado)}) y pagar ${fmt(resta)} ${como}`;
}
