/**
 * Transferencia en la tienda online.
 *
 * El default de Commerce es cobrar sin Mercado Pago. Si el medio está
 * marcado pero no hay CBU ni alias, el pedido queda en «te vamos a
 * escribir» y la primera venta online no cierra sola. Los datos viven
 * en `settings` (misma autoridad que el link de pago público).
 */

export function storeBankTransferReady(bank: {
  bank_cbu?: string | null;
  bank_alias?: string | null;
}): boolean {
  return Boolean(
    String(bank.bank_cbu ?? "").trim() || String(bank.bank_alias ?? "").trim(),
  );
}

/** ¿La tienda ofrece transferencia y por tanto necesita datos bancarios? */
export function storeOffersBankTransfer(
  methods: Array<string | null | undefined> | null | undefined,
): boolean {
  return (methods ?? []).some(m => m === "transferencia");
}
