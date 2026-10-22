import { redondearMoneda } from "@/lib/rounding";

export const INVOICE_TAX_RATES = [0, 2.5, 5, 10.5, 21, 27] as const;

export type TratamientoRenglon = "gravado" | "exento" | "no_gravado";

export interface ManualInvoiceTaxItem {
  quantity: number;
  unit_price: number;
  tax_rate?: number | null;
  /** Lo exento o no gravado no es IVA al 0 %: va aparte (20261022000600). */
  tratamiento?: TratamientoRenglon | null;
}

/** Percepción u otro tributo de la factura (WSFE `Tributos`). */
export interface TributoManual {
  tipo: number;
  descripcion?: string;
  base: number;
  alicuota: number;
  /** Sólo cuenta si la alícuota es 0 (importe fijo). */
  importe?: number;
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
  /** Neto gravado. */
  subtotal: number;
  tax: number;
  exento: number;
  noGravado: number;
  tributos: Array<TributoManual & { importe: number }>;
  tributosTotal: number;
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
  tributosPedidos: TributoManual[] = [],
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
    const tratamiento = item.tratamiento ?? "gravado";
    if (tratamiento !== "gravado") {
      if (options.fiscalEnabled && options.classC) throw new Error("Un comprobante C no separa lo exento ni lo no gravado.");
      return { net, taxRate: options.fiscalEnabled ? 0 : null, tax: 0, tratamiento };
    }
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
    return { net, taxRate, tax, tratamiento };
  });

  const suma = (t: TratamientoRenglon) => redondearMoneda(lines.filter(l => l.tratamiento === t).reduce((sum, l) => sum + l.net, 0), "ARS");
  const subtotal = suma("gravado");
  const exento = suma("exento");
  const noGravado = suma("no_gravado");
  const tax = redondearMoneda(lines.reduce((sum, line) => sum + line.tax, 0), "ARS");
  // Igual que `crear_factura_manual`: base por alícuota; con alícuota 0, importe fijo.
  const tributos = tributosPedidos.map(t => {
    const base = redondearMoneda(Math.max(0, Number(t.base) || 0), "ARS");
    const alicuota = Math.round(Math.max(0, Number(t.alicuota) || 0) * 100) / 100;
    if (alicuota > 100) throw new Error("La alícuota de un tributo no puede superar el 100 %.");
    const importe = alicuota > 0 ? redondearMoneda(base * alicuota / 100, "ARS") : redondearMoneda(Math.max(0, Number(t.importe) || 0), "ARS");
    return { ...t, base, alicuota, importe };
  }).filter(t => t.importe > 0);
  const tributosTotal = redondearMoneda(tributos.reduce((sum, t) => sum + t.importe, 0), "ARS");
  return {
    subtotal,
    tax,
    exento,
    noGravado,
    tributos,
    tributosTotal,
    total: redondearMoneda(subtotal + tax + exento + noGravado + tributosTotal, "ARS"),
    lines: lines.map(({ net, taxRate, tax: impuesto }) => ({ net, taxRate, tax: impuesto })),
    groups: [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rate, values]) => ({ rate, ...values })),
  };
}

/**
 * Neto de un renglón a partir del precio final del catálogo (2026-10-14: la
 * factura manual ahora toma los productos). El catálogo guarda el precio al
 * público, con IVA; la factura manual trabaja con netos. Sin IVA (sin ARCA o
 * factura C) el neto es el mismo precio.
 */
export function netoDesdePrecioFinal(precioFinal: number, alicuota: number): number {
  const final = Math.max(0, Number(precioFinal) || 0);
  const pct = Math.max(0, Number(alicuota) || 0);
  return redondearMoneda(final / (1 + pct / 100), "ARS");
}
