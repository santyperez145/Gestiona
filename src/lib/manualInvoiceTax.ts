import { redondearMoneda } from "@/lib/rounding";

export const INVOICE_TAX_RATES = [0, 2.5, 5, 10.5, 21, 27] as const;

export interface ManualInvoiceTaxItem {
  quantity: number;
  unit_price: number;
  tax_rate?: number | null;
}

interface ManualInvoiceTaxOptions {
  fiscalEnabled: boolean;
  classC: boolean;
  defaultRate: number;
}

export interface ManualInvoiceTaxLine {
  net: number;
  taxRate: number | null;
  tax: number;
}

export interface ManualInvoiceTaxSummary {
  subtotal: number;
  tax: number;
  total: number;
  lines: ManualInvoiceTaxLine[];
  groups: Array<{ rate: number; base: number; amount: number }>;
}

export function isInvoiceTaxRate(value: number): boolean {
  return INVOICE_TAX_RATES.some((rate) => rate === value);
}

/**
 * Cambia la alicuota predeterminada sin pisar renglones que el usuario ya
 * personalizo. Los que aun heredaban el valor anterior siguen al nuevo valor.
 */
export function updateDefaultInvoiceTaxRate<T extends { tax_rate?: number | null }>(
  items: T[],
  previousRate: number,
  nextRate: number,
): T[] {
  return items.map((item) => (
    item.tax_rate == null || item.tax_rate === previousRate
      ? { ...item, tax_rate: nextRate }
      : item
  ));
}

/**
 * Espejo de `crear_factura_manual`: los precios son netos y cada renglón
 * redondea su IVA antes de cerrar la cabecera. La base vuelve a calcular todo;
 * este helper sólo mantiene la vista previa idéntica a la autoridad.
 */
export function manualInvoiceTaxSummary(
  items: ManualInvoiceTaxItem[],
  options: ManualInvoiceTaxOptions,
): ManualInvoiceTaxSummary {
  const defaultRate = Number(options.defaultRate);
  if (options.fiscalEnabled && !options.classC && !isInvoiceTaxRate(defaultRate)) {
    throw new Error("La alícuota predeterminada no está admitida por ARCA.");
  }

  const groups = new Map<number, { base: number; amount: number }>();
  const lines = items.map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    const net = redondearMoneda(quantity * unitPrice, "ARS");
    const taxRate = !options.fiscalEnabled
      ? null
      : options.classC
        ? 0
        : Number(item.tax_rate ?? defaultRate);
    if (taxRate !== null && !isInvoiceTaxRate(taxRate)) {
      throw new Error("Un renglón tiene una alícuota no admitida por ARCA.");
    }
    const tax = taxRate === null ? 0 : redondearMoneda(net * taxRate / 100, "ARS");
    if (taxRate !== null) {
      const group = groups.get(taxRate) ?? { base: 0, amount: 0 };
      groups.set(taxRate, {
        base: redondearMoneda(group.base + net, "ARS"),
        amount: redondearMoneda(group.amount + tax, "ARS"),
      });
    }
    return { net, taxRate, tax };
  });

  const subtotal = redondearMoneda(lines.reduce((sum, line) => sum + line.net, 0), "ARS");
  const tax = redondearMoneda(lines.reduce((sum, line) => sum + line.tax, 0), "ARS");
  return {
    subtotal,
    tax,
    total: redondearMoneda(subtotal + tax, "ARS"),
    lines,
    groups: [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rate, values]) => ({ rate, ...values })),
  };
}
