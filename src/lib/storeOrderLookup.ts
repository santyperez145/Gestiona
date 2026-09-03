/** Normaliza el número que el comprador escribe en «Consultar pedido». */
export function normalizeStoreOrderNumber(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/\s+/g, "").toUpperCase();
}
