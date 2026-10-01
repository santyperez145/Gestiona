import { afipIvaId } from "./afipIva.ts";

export type InvoiceTaxLine = {
  total: number;
  tax_rate?: number | null;
  tax_amount?: number | null;
};
export type InvoiceTaxDocument = {
  tipo_comprobante?: number | null;
  subtotal: number;
  tax_pct: number;
  tax_amount: number;
  total: number;
  invoice_items?: InvoiceTaxLine[];
};
export type InvoiceIvaGroup = { rate: number; id: number; base: number; amount: number };

function cents(value: unknown): number {
  const number = Number(value);
  if (value == null || !Number.isFinite(number) || number < 0) {
    throw new Error("El comprobante contiene importes fiscales inválidos.");
  }
  return Math.round((number + Number.EPSILON) * 100);
}

export function invoiceIvaGroups(invoice: InvoiceTaxDocument): InvoiceIvaGroup[] {
  const net = cents(invoice.subtotal);
  const vat = cents(invoice.tax_amount);
  if (net + vat !== cents(invoice.total)) {
    throw new Error("El neto y el IVA no coinciden con el total del comprobante.");
  }
  const lines = invoice.invoice_items ?? [];
  const creditNote = [3, 8, 13].includes(Number(invoice.tipo_comprobante));
  const detailed = lines.some((line) => line.tax_rate != null || line.tax_amount != null);
  const groups = new Map<number, { base: number; amount: number }>();
  if (detailed) {
    for (const line of lines) {
      if (line.tax_rate == null || line.tax_amount == null) {
        throw new Error("El desglose de IVA de los renglones está incompleto.");
      }
      const rate = Number(line.tax_rate);
      afipIvaId(rate);
      const base = cents(line.total);
      const amount = cents(line.tax_amount);
      if ((rate === 0 && amount !== 0) || (!creditNote && Math.abs(amount - Math.round(base * rate / 100)) > 1)) {
        throw new Error("El IVA de un renglón no corresponde a su alícuota.");
      }
      const group = groups.get(rate) ?? { base: 0, amount: 0 };
      groups.set(rate, { base: group.base + base, amount: group.amount + amount });
    }
    const values = [...groups.values()];
    if (values.reduce((sum, group) => sum + group.base, 0) !== net ||
        values.reduce((sum, group) => sum + group.amount, 0) !== vat) {
      throw new Error("El desglose de los renglones no coincide con la cabecera fiscal.");
    }
  }
  if ([11, 12, 13].includes(Number(invoice.tipo_comprobante))) {
    if (vat !== 0 || Number(invoice.tax_pct) !== 0 || [...groups.keys()].some((rate) => rate !== 0)) {
      throw new Error("Los comprobantes C no discriminan IVA.");
    }
    return [];
  }
  if (!detailed) {
    const rate = Number(invoice.tax_pct);
    afipIvaId(rate);
    if ((rate === 0 && vat !== 0) || (!creditNote && Math.abs(vat - Math.round(net * rate / 100)) > 1)) {
      throw new Error("La alícuota no coincide con el IVA del comprobante.");
    }
    groups.set(rate, { base: net, amount: vat });
  }
  return [...groups.entries()].sort(([a], [b]) => a - b)
    .filter(([, group]) => group.base > 0 || group.amount > 0)
    .map(([rate, group]) => ({ rate, id: afipIvaId(rate), base: group.base / 100, amount: group.amount / 100 }));
}

export function invoiceDisplayLines<T extends InvoiceTaxLine & { quantity: number; unit_price: number }>(
  invoice: Omit<InvoiceTaxDocument, "invoice_items"> & { invoice_items?: T[] },
): T[] {
  const lines = invoice.invoice_items ?? [];
  for (const line of lines) {
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw new Error("El comprobante contiene cantidades inválidas.");
    }
    cents(line.total);
  }
  if ([1, 2, 3].includes(Number(invoice.tipo_comprobante))) return lines;
  if (lines.every((line) => line.tax_amount != null)) {
    return lines.map((line) => {
      const total = (cents(line.total) + cents(line.tax_amount)) / 100;
      return { ...line, total, unit_price: total / Number(line.quantity) };
    });
  }
  const sum = lines.reduce((amount, line) => amount + cents(line.total), 0);
  // Older POS documents stored gross prices; manual documents stored net prices.
  if (sum === cents(invoice.total)) return lines;
  if (sum !== cents(invoice.subtotal)) {
    throw new Error("Los importes de los renglones no coinciden con el comprobante.");
  }
  const vat = cents(invoice.tax_amount);
  const allocations = lines.map((line, index) => {
    const share = sum ? vat * cents(line.total) / sum : 0;
    return { index, cents: Math.floor(share), remainder: share - Math.floor(share) };
  });
  let remainder = vat - allocations.reduce((amount, allocation) => amount + allocation.cents, 0);
  for (const allocation of [...allocations].sort((a, b) => b.remainder - a.remainder)) {
    if (remainder-- > 0) allocation.cents++;
  }
  return lines.map((line, index) => {
    const total = (cents(line.total) + allocations[index].cents) / 100;
    return { ...line, total, unit_price: total / Number(line.quantity) };
  });
}

export function invoiceIvaXml(invoice: InvoiceTaxDocument): string {
  const groups = invoiceIvaGroups(invoice);
  return groups.length ? `<ar:Iva>${groups.map((group) =>
    `<ar:AlicIva><ar:Id>${group.id}</ar:Id><ar:BaseImp>${group.base.toFixed(2)}</ar:BaseImp><ar:Importe>${group.amount.toFixed(2)}</ar:Importe></ar:AlicIva>`
  ).join("")}</ar:Iva>` : "";
}
