/**
 * Cartera de cheques (2026-10-14, migración 20261014001400). La base custodia
 * el ciclo de vida (trg_guard_cheque_estado); esto es el espejo para mostrar
 * sólo las acciones válidas de cada cheque.
 *   recibido: pendiente → depositado | rebotado | cancelado;
 *             depositado → acreditado | rebotado.
 *   emitido:  pendiente → debitado | rebotado | cancelado.
 */
export type TipoDeCheque = "received" | "issued";
export type EstadoDeCheque = "pending" | "deposited" | "cleared" | "bounced" | "cancelled";

export interface AccionDeCheque {
  estado: EstadoDeCheque;
  etiqueta: string;
  peligro?: boolean;
}

export function accionesDeCheque(tipo: TipoDeCheque, estado: EstadoDeCheque): AccionDeCheque[] {
  if (tipo === "received" && estado === "pending") {
    return [
      { estado: "deposited", etiqueta: "Depositar" },
      { estado: "bounced", etiqueta: "Rebotó", peligro: true },
      { estado: "cancelled", etiqueta: "Cancelar", peligro: true },
    ];
  }
  if (tipo === "received" && estado === "deposited") {
    return [
      { estado: "cleared", etiqueta: "Acreditado" },
      { estado: "bounced", etiqueta: "Rebotó", peligro: true },
    ];
  }
  if (tipo === "issued" && estado === "pending") {
    return [
      { estado: "cleared", etiqueta: "Debitado" },
      { estado: "bounced", etiqueta: "Rebotó", peligro: true },
      { estado: "cancelled", etiqueta: "Anular", peligro: true },
    ];
  }
  return [];
}

/** Cómo se llama cada estado según el tipo: un emitido «acreditado» es un débito. */
export function etiquetaDeEstado(tipo: TipoDeCheque, estado: EstadoDeCheque): string {
  if (estado === "cleared") return tipo === "issued" ? "Debitado" : "Acreditado";
  return { pending: "Pendiente", deposited: "Depositado", bounced: "Rebotado", cancelled: tipo === "issued" ? "Anulado" : "Cancelado" }[estado];
}
