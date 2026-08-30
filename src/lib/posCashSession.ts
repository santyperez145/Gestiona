export type PosCashEntryLike = {
  entry_type: string;
  payment_method?: string | null;
  amount_ars: number | string;
  reference_id?: string | null;
  reference_type?: string | null;
  sale_transaction_id?: string | null;
};

export type PosCashSessionTotals = {
  cashNet: number;
  expectedCash: number;
  transferTotal: number;
  cardTotal: number;
  otherPaymentTotal: number;
  salesTotal: number;
  collectionsTotal: number;
  outflowsTotal: number;
  movementCount: number;
  ticketCount: number;
};

const IN_TYPES = new Set(["sale_in", "debt_payment", "manual_in"]);
const OUT_TYPES = new Set(["refund_out", "expense_out", "supplier_out", "manual_out"]);
const CASH_METHODS = new Set(["efectivo", "cash"]);
const TRANSFER_METHODS = new Set(["transferencia", "transfer", "bank_transfer"]);
const CARD_METHODS = new Set(["debito", "credito", "debit", "credit", "card"]);

function amountOf(entry: PosCashEntryLike): number {
  const amount = Number(entry.amount_ars);
  return Number.isFinite(amount) ? amount : 0;
}

function methodOf(entry: PosCashEntryLike): string {
  return String(entry.payment_method || "efectivo").trim().toLowerCase();
}

/**
 * Espejo puro de `cash_session_summary` / `cash_session_expected_cash`.
 * Un ticket con split puede tener varias entradas por medio, pero cuenta una
 * sola vez gracias a `sale_transaction_id`.
 */
export function summarizePosCashSession(
  openingAmount: number | string,
  entries: PosCashEntryLike[],
): PosCashSessionTotals {
  let cashNet = 0;
  let transferTotal = 0;
  let cardTotal = 0;
  let otherPaymentTotal = 0;
  let salesTotal = 0;
  let collectionsTotal = 0;
  let outflowsTotal = 0;
  const tickets = new Set<string>();

  for (const entry of entries) {
    const amount = amountOf(entry);
    const method = methodOf(entry);
    const isIn = IN_TYPES.has(entry.entry_type);
    const isOut = OUT_TYPES.has(entry.entry_type);

    if (entry.entry_type === "sale_in") {
      salesTotal += amount;
      const ticketId = entry.sale_transaction_id
        || (entry.reference_type === "sale_transaction" ? entry.reference_id : null)
        || (entry.reference_type === "sale" ? entry.reference_id : null);
      if (ticketId) tickets.add(ticketId);
    }
    if (entry.entry_type === "debt_payment") collectionsTotal += amount;
    if (isOut) outflowsTotal += amount;

    if (CASH_METHODS.has(method)) {
      if (isIn) cashNet += amount;
      if (isOut) cashNet -= amount;
      continue;
    }
    if (!isIn) continue;
    if (TRANSFER_METHODS.has(method)) transferTotal += amount;
    else if (CARD_METHODS.has(method)) cardTotal += amount;
    else otherPaymentTotal += amount;
  }

  const opening = Number(openingAmount);
  return {
    cashNet,
    expectedCash: (Number.isFinite(opening) ? opening : 0) + cashNet,
    transferTotal,
    cardTotal,
    otherPaymentTotal,
    salesTotal,
    collectionsTotal,
    outflowsTotal,
    movementCount: entries.length,
    ticketCount: tickets.size,
  };
}
