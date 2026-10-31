/**
 * Saldo a favor parcial en un pedido online (2026-10-30, migraciones
 * 20261030001400 y 20261030001700): cuánto paga el saldo y cuánto queda por
 * el otro medio (transferencia, efectivo o Nerqia Pay), y
 * cómo se le dice al comprador. El total del pedido no cambia (se factura
 * completo); la base decide lo que se aplica, esto es el espejo.
 */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function repartoDelSaldo(saldo: number, total: number): { aplicado: number; resta: number } {
  const aplicado = Math.max(0, Math.min(r2(saldo), r2(total)));
  return { aplicado, resta: r2(r2(total) - aplicado) };
}

/**
 * Días que el saldo queda reservado para un pedido impago (20261030001500):
 * un pago rechazado se reintenta sin perderlo; pasado el plazo, vuelve solo.
 */
export const DIAS_RESERVA_SALDO = 7;

/** Lo que el comprador lee sobre su saldo según cómo quedó el pedido. */
export function textoEstadoDelSaldo(estadoDePago: string | null | undefined): string | null {
  const estado = String(estadoDePago ?? "").toLowerCase().trim();
  if (estado === "pending" || estado === "failed") {
    return `Si el pedido no se paga en ${DIAS_RESERVA_SALDO} días, el saldo vuelve a tu cuenta.`;
  }
  if (estado === "refunded") return "Como el pedido se reintegró, ese saldo volvió a tu cuenta.";
  return null;
}

/** Medios con los que el saldo se combina: el resto se paga por ellos. */
export function combinaConSaldo(metodo: string | null | undefined): boolean {
  const m = String(metodo ?? "").toLowerCase().trim();
  return m === "transferencia" || m === "efectivo" || m === "gestiona_pay" || m === "mercadopago";
}

function porElMedio(metodo: string): string {
  const m = String(metodo).toLowerCase().trim();
  if (m === "transferencia") return "por transferencia";
  if (m === "efectivo") return "en efectivo";
  return "con Nerqia Pay";
}

export function textoUsarSaldo(saldo: number, total: number, metodo: string, fmt: (n: number) => string): string {
  const { aplicado, resta } = repartoDelSaldo(saldo, total);
  if (resta <= 0) return `Usar mi saldo a favor (${fmt(aplicado)}): cubre todo el pedido`;
  return `Usar mi saldo a favor (${fmt(aplicado)}) y pagar ${fmt(resta)} ${porElMedio(metodo)}`;
}
