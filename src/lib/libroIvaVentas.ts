/**
 * Libro IVA Digital — Ventas (2026-10-21).
 *
 * Todo Responsable Inscripto presenta cada mes el Libro IVA Digital en ARCA.
 * Hasta ahora el comercio (o su contador) tenía que volver a cargar a mano
 * cada factura que Nerqia ya había autorizado. Esto arma los dos archivos que
 * importa el aplicativo, con el diseño de registro de ARCA (RG 4597, mismo
 * formato que el ex CITI Ventas):
 *
 *   · VENTAS_CBTE: un renglón de 266 caracteres por comprobante.
 *   · VENTAS_ALICUOTAS: un renglón de 62 caracteres por alícuota de cada uno.
 *
 * Los importes y el desglose por alícuota salen de `invoiceIvaGroups`, la
 * misma función que arma el bloque <Iva> que se manda a WSFE: el libro
 * coincide con lo que ARCA autorizó. El documento del comprador replica la
 * regla de `afip-authorize` (11 dígitos CUIT, 7-8 DNI, si no consumidor final).
 *
 * Un comprobante que no se puede desglosar no se omite en silencio: vuelve en
 * `problemas` con el motivo, y no entra en los archivos.
 */
import { invoiceIvaGroups, type InvoiceTaxLine } from "../../supabase/functions/_shared/invoiceIva";
import { monedaWsfe, type TributoDeComprobante } from "../../supabase/functions/_shared/wsfeComprobante";
import { CLASE_C, NOTAS_DE_CREDITO as NOTAS_DE_CREDITO_ARCA } from "../../supabase/functions/_shared/comprobantesArca";

export interface ComprobanteVenta {
  id: string;
  number?: string | null;
  issue_date: string;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero_afip: number | null;
  customer_tax_id?: string | null;
  customer_name?: string | null;
  subtotal: number;
  tax_amount: number;
  tax_pct: number;
  total: number;
  invoice_items?: InvoiceTaxLine[] | null;
  /** Desde 20261022000600: lo que no es neto gravado, la moneda y el concepto. */
  importe_no_gravado?: number | null;
  importe_exento?: number | null;
  importe_tributos?: number | null;
  tributos?: TributoDeComprobante[] | null;
  currency?: string | null;
  moneda_cotizacion?: number | null;
  concepto?: number | null;
  due_date?: string | null;
}

export interface AlicuotaResumen { tasa: number; neto: number; iva: number }

export interface LibroIvaVentas {
  cbte: string;
  alicuotas: string;
  incluidos: number;
  problemas: { id: string; comprobante: string; motivo: string }[];
  resumen: {
    /** Facturas y notas de débito menos notas de crédito. */
    total: number;
    debitoFiscal: number;
    porAlicuota: AlicuotaResumen[];
    notasDeCredito: number;
  };
}

/** Códigos de alícuota del diseño de registro (los mismos Id de WSFE). */
const CODIGO_ALICUOTA: Record<number, string> = { 0: "0003", 10.5: "0004", 21: "0005", 27: "0006", 5: "0008", 2.5: "0009" };
// Incluyen la Factura de Crédito Electrónica MiPyME (203/208/213, 211-213).
const NOTAS_DE_CREDITO = NOTAS_DE_CREDITO_ARCA;
const COMPROBANTES_C = CLASE_C;
const FIN_DE_LINEA = "\r\n";

const ceros = (valor: number | string, largo: number) => String(valor).padStart(largo, "0").slice(-largo);

/** Importe con 2 decimales implícitos, 15 posiciones. */
export function importe(valor: number): string {
  const centavos = Math.round((Math.abs(Number(valor) || 0) + Number.EPSILON) * 100);
  return ceros(centavos, 15);
}

/** Texto a la izquierda, sin tildes ni caracteres fuera de ASCII imprimible. */
export function texto(valor: string | null | undefined, largo: number): string {
  const limpio = String(valor ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  return limpio.slice(0, largo).padEnd(largo, " ");
}

/** El mismo criterio con que `afip-authorize` informó al comprador. */
export function documentoDelComprador(taxId: string | null | undefined): { tipo: number; numero: string } {
  const digitos = String(taxId ?? "").replace(/[-\s]/g, "");
  if (/^\d{11}$/.test(digitos)) return { tipo: 80, numero: digitos };
  if (/^\d{7,8}$/.test(digitos)) return { tipo: 96, numero: digitos };
  return { tipo: 99, numero: "0" };
}

const fecha = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const etiqueta = (c: ComprobanteVenta) =>
  c.punto_venta && c.numero_afip ? `${ceros(c.punto_venta, 5)}-${ceros(c.numero_afip, 8)}` : (c.number ?? c.id);

/** Del 1 al último día del mes, en fecha fiscal argentina (AAAA-MM). */
export function rangoDelPeriodo(periodo: string): { desde: string; hasta: string } {
  const [anio, mes] = periodo.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(ultimo).padStart(2, "0")}` };
}

/** El mes anterior al actual (AAAA-MM): es el que se presenta. */
export function periodoAPresentar(mesActual: string): string {
  const [anio, mes] = mesActual.split("-").map(Number);
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, "0")}`;
}

export function libroIvaVentas(comprobantes: ComprobanteVenta[]): LibroIvaVentas {
  const cbte: string[] = [];
  const alicuotas: string[] = [];
  const problemas: LibroIvaVentas["problemas"] = [];
  const porTasa = new Map<number, AlicuotaResumen>();
  let total = 0;
  let debitoFiscal = 0;
  let notasDeCredito = 0;

  const ordenados = [...comprobantes].sort((a, b) =>
    a.issue_date.localeCompare(b.issue_date) ||
    Number(a.tipo_comprobante) - Number(b.tipo_comprobante) ||
    Number(a.punto_venta) - Number(b.punto_venta) ||
    Number(a.numero_afip) - Number(b.numero_afip));

  for (const c of ordenados) {
    const tipo = Number(c.tipo_comprobante);
    if (!tipo || !c.punto_venta || !c.numero_afip) {
      problemas.push({ id: c.id, comprobante: etiqueta(c), motivo: "No tiene tipo, punto de venta o número de ARCA." });
      continue;
    }
    let grupos: ReturnType<typeof invoiceIvaGroups>;
    try {
      grupos = invoiceIvaGroups({ ...c, tipo_comprobante: tipo, invoice_items: c.invoice_items ?? [] });
    } catch (e) {
      problemas.push({ id: c.id, comprobante: etiqueta(c), motivo: e instanceof Error ? e.message : "No se pudo desglosar el IVA." });
      continue;
    }

    let moneda: ReturnType<typeof monedaWsfe>;
    try { moneda = monedaWsfe(c.currency); } catch (e) {
      problemas.push({ id: c.id, comprobante: etiqueta(c), motivo: e instanceof Error ? e.message : "Moneda no admitida." });
      continue;
    }
    const cotizacion = moneda === "PES" ? 1 : Number(c.moneda_cotizacion) || 0;
    if (cotizacion <= 0) {
      problemas.push({ id: c.id, comprobante: etiqueta(c), motivo: "Está en moneda extranjera y no tiene la cotización con la que se autorizó." });
      continue;
    }
    // Cada percepción va en su columna del diseño de registro (RG 4597).
    const tributo = (tipos: number[]) => (c.tributos ?? [])
      .filter(t => tipos.includes(Number(t.tipo))).reduce((suma, t) => suma + Number(t.importe || 0), 0);
    const noGravado = Number(c.importe_no_gravado ?? 0);
    const exento = Number(c.importe_exento ?? 0);
    const netoGravado = Number(c.subtotal);

    const doc = documentoDelComprador(c.customer_tax_id);
    const nombre = doc.tipo === 99 && !c.customer_name?.trim() ? "CONSUMIDOR FINAL" : c.customer_name;
    const soloTasaCero = grupos.length > 0 && grupos.every(g => g.rate === 0);
    const numero = ceros(c.numero_afip, 20);
    const puntoVenta = ceros(c.punto_venta, 5);
    const tipoTxt = ceros(tipo, 3);
    // Los comprobantes C no discriminan IVA y no llevan renglón de alícuota.
    const cantidad = COMPROBANTES_C.has(tipo) ? 0 : grupos.length;

    cbte.push([
      fecha(c.issue_date), tipoTxt, puntoVenta, numero, numero,
      ceros(doc.tipo, 2), ceros(doc.numero, 20), texto(nombre, 30),
      importe(c.total),
      importe(noGravado), // conceptos que no integran el neto gravado
      importe(tributo([13])), // percepción a no categorizados
      importe(exento), // operaciones exentas
      importe(tributo([1, 6])), // percepciones de impuestos nacionales (IVA incluida)
      importe(tributo([5, 7])), // percepciones de Ingresos Brutos
      importe(tributo([3, 8])), // percepciones municipales
      importe(tributo([4])), // impuestos internos
      moneda, ceros(Math.round(cotizacion * 1_000_000), 10), String(cantidad),
      // «No corresponde» es un espacio: el importador de ARCA rechaza el «0»
      // que aceptaba el ex CITI («el código de Operación es inválido»).
      netoGravado === 0 && exento > 0 ? "E" : netoGravado === 0 && noGravado > 0 ? "N" : soloTasaCero ? "E" : " ",
      importe(tributo([2, 9, 99])), // otros tributos
      // Vencimiento de pago: sólo servicios (concepto 2 o 3).
      [2, 3].includes(Number(c.concepto)) ? fecha(c.due_date || c.issue_date) : "00000000",
    ].join(""));

    for (const g of grupos) {
      alicuotas.push([tipoTxt, puntoVenta, numero, importe(g.base), CODIGO_ALICUOTA[g.rate], importe(g.amount)].join(""));
    }

    const signo = NOTAS_DE_CREDITO.has(tipo) ? -1 : 1;
    if (signo < 0) notasDeCredito++;
    // El resumen va en pesos: un comprobante en dólares suma a su cotización.
    total += signo * Number(c.total) * cotizacion;
    for (const g of grupos) {
      const r = porTasa.get(g.rate) ?? { tasa: g.rate, neto: 0, iva: 0 };
      porTasa.set(g.rate, { tasa: g.rate, neto: r.neto + signo * g.base * cotizacion, iva: r.iva + signo * g.amount * cotizacion });
      debitoFiscal += signo * g.amount * cotizacion;
    }
  }

  const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    cbte: cbte.map(l => l + FIN_DE_LINEA).join(""),
    alicuotas: alicuotas.map(l => l + FIN_DE_LINEA).join(""),
    incluidos: cbte.length,
    problemas,
    resumen: {
      total: redondear(total),
      debitoFiscal: redondear(debitoFiscal),
      porAlicuota: [...porTasa.values()].sort((a, b) => a.tasa - b.tasa)
        .map(a => ({ tasa: a.tasa, neto: redondear(a.neto), iva: redondear(a.iva) })),
      notasDeCredito,
    },
  };
}
