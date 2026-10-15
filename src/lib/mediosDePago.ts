/**
 * Nombre visible de un medio de pago guardado (2026-10-15). Ventas mostraba
 * el código tal cual («Mercado_pago», «credito») y cada pantalla tenía su
 * propio mapa. Un código desconocido se muestra con mayúscula inicial y sin
 * guiones bajos, nunca crudo.
 */
const NOMBRES: Record<string, string> = {
  efectivo: "Efectivo",
  cash: "Efectivo",
  transferencia: "Transferencia",
  transfer: "Transferencia",
  deposito: "Depósito",
  debito: "Tarjeta de débito",
  debit: "Tarjeta de débito",
  credito: "Tarjeta de crédito",
  credit: "Tarjeta de crédito",
  tarjeta: "Tarjeta",
  mercado_pago: "Mercado Pago",
  mercadopago: "Mercado Pago",
  qr: "QR",
  modo: "MODO",
  mayorista: "Mayorista",
  fiado: "Fiado (cuenta corriente)",
  cuenta_corriente: "Cuenta corriente",
  saldo_a_favor: "Saldo a favor",
  cheque: "Cheque",
  otro: "Otro",
};

export function nombreDelMedio(medio: string | null | undefined): string {
  const m = String(medio ?? "").trim();
  if (!m) return "Efectivo";
  const conocido = NOMBRES[m.toLowerCase()];
  if (conocido) return conocido;
  const legible = m.replace(/_/g, " ");
  return legible.charAt(0).toUpperCase() + legible.slice(1);
}
