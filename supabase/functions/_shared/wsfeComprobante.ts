/**
 * El detalle de un comprobante para FECAESolicitar, completo (2026-10-22).
 *
 * Hasta acá la factura salía siempre como «productos», en pesos y con el no
 * gravado, el exento y los tributos en cero. Eso dejaba afuera a:
 *   - los comercios de servicios (concepto 2 o 3 exige el período del servicio
 *     y el vencimiento del pago, y sin eso ARCA rechaza);
 *   - lo exento o no gravado (se declaraba como gravado al 0 %, que no es lo mismo);
 *   - los agentes de percepción (IIBB, IVA): la percepción va en `Tributos`;
 *   - la factura en dólares o euros (`MonId`, `MonCotiz`, `CanMisMonExt`).
 *
 * Es puro: no habla con ARCA ni con la base. Lo usa `afip-authorize` y lo
 * prueban los tests de `src/test/wsfeComprobante.test.ts`.
 *
 * El orden de los elementos es el del WSDL de WSFEv1 (FECAEDetRequest).
 */
import { invoiceIvaGroups, type InvoiceTaxDocument, type InvoiceTaxLine } from "./invoiceIva.ts";
import { associatedVoucherXml, type AfipAssociatedVoucher } from "./afipAssociatedVoucher.ts";
import { CLASE_A, CLASE_C, FCE, FCE_FACTURAS } from "./comprobantesArca.ts";

/** Tipos de tributo de WSFE (FEParamGetTiposTributos). */
export const TIPOS_DE_TRIBUTO: Record<number, string> = {
  1: "Impuestos nacionales",
  2: "Impuestos provinciales",
  3: "Impuestos municipales",
  4: "Impuestos internos",
  5: "Ingresos Brutos",
  6: "Percepción de IVA",
  7: "Percepción de Ingresos Brutos",
  8: "Percepciones por impuestos municipales",
  9: "Otras percepciones",
  13: "Percepción de IVA a no categorizado",
  99: "Otros",
};

export type TratamientoIva = "gravado" | "exento" | "no_gravado";

export interface TributoDeComprobante {
  tipo: number;
  descripcion?: string | null;
  base: number;
  alicuota: number;
  importe: number;
}

export interface OpcionalWsfe { id: string; valor: string }

export interface ComprobanteParaWsfe extends InvoiceTaxDocument {
  issue_date: string;
  due_date?: string | null;
  customer_tax_id?: string | null;
  condicion_iva_receptor?: number | null;
  concepto?: number | null;
  servicio_desde?: string | null;
  servicio_hasta?: string | null;
  importe_no_gravado?: number | null;
  importe_exento?: number | null;
  importe_tributos?: number | null;
  tributos?: TributoDeComprobante[] | null;
  currency?: string | null;
  moneda_cotizacion?: number | null;
  cancela_misma_moneda?: boolean | null;
  invoice_items?: (InvoiceTaxLine & { tratamiento?: TratamientoIva | string | null })[];
}

const TIPOS_C = CLASE_C;
const TIPOS_A = CLASE_A;

function centavos(valor: unknown, campo: string): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${campo}: el importe no es válido.`);
  return Math.round((n + Number.EPSILON) * 100);
}
const pesos = (c: number) => (c / 100).toFixed(2);
const fechaWsfe = (iso: string, campo: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) throw new Error(`${campo}: la fecha no es válida.`);
  return `${m[1]}${m[2]}${m[3]}`;
};
const xmlTexto = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * CBU válido: 22 dígitos con los dos verificadores del BCRA (bloque 1: banco
 * y sucursal; bloque 2: cuenta).
 */
export function cbuValido(cbu: string | null | undefined): boolean {
  const d = String(cbu ?? "").replace(/\D/g, "");
  if (d.length !== 22) return false;
  const verificador = (digitos: string, pesos: number[]) => {
    const suma = [...digitos].reduce((s, c, i) => s + Number(c) * pesos[i % pesos.length], 0);
    return (10 - (suma % 10)) % 10;
  };
  const bloque1 = d.slice(0, 8);
  const bloque2 = d.slice(8);
  return verificador(bloque1.slice(0, 7), [7, 1, 3, 9, 7, 1, 3]) === Number(bloque1[7])
    && verificador(bloque2.slice(0, 13), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) === Number(bloque2[13]);
}

export interface DatosFce {
  fce_cbu?: string | null;
  fce_alias?: string | null;
  /** SCA: Sistema de Circulación Abierta; ADC: Agente de Depósito Colectivo. */
  fce_transferencia?: string | null;
  /** En una nota: si anula la factura porque el comprador la rechazó. */
  fce_anulacion?: boolean | null;
}

/**
 * Los opcionales que ARCA exige en la Factura de Crédito Electrónica MiPyME
 * (RG 4367): en la factura, el CBU del emisor (2101), su alias (2102,
 * opcional) y la modalidad de transferencia (27); en sus notas, si anulan la
 * factura (22).
 */
export function opcionalesFce(tipoCbte: number, d: DatosFce): OpcionalWsfe[] {
  if (!FCE.has(tipoCbte)) return [];
  if (!FCE_FACTURAS.has(tipoCbte)) return [{ id: "22", valor: d.fce_anulacion ? "S" : "N" }];
  const cbu = String(d.fce_cbu ?? "").replace(/\D/g, "");
  if (!cbuValido(cbu)) throw new Error("La factura de crédito MiPyME necesita un CBU válido del emisor (22 dígitos).");
  const transferencia = String(d.fce_transferencia ?? "SCA").toUpperCase();
  if (transferencia !== "SCA" && transferencia !== "ADC") throw new Error("La transferencia de la factura de crédito es SCA o ADC.");
  const alias = String(d.fce_alias ?? "").trim();
  return [
    { id: "2101", valor: cbu },
    ...(alias ? [{ id: "2102", valor: alias.slice(0, 20) }] : []),
    { id: "27", valor: transferencia },
  ];
}

/**
 * La quincena de una fecha, como la pide FECAEASolicitar: período AAAAMM y
 * orden 1 (del 1 al 15) o 2 (del 16 a fin de mes).
 */
export function quincenaDe(fecha: string): { periodo: number; orden: 1 | 2; desde: string; hasta: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  if (!m) throw new Error("La fecha no es válida.");
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const orden = dia <= 15 ? 1 : 2;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    periodo: anio * 100 + mes, orden,
    desde: `${m[1]}-${m[2]}-${orden === 1 ? "01" : "16"}`,
    hasta: `${m[1]}-${m[2]}-${orden === 1 ? "15" : pad(ultimo)}`,
  };
}

/** La quincena siguiente (para pedir el CAEA antes de que empiece). */
export function quincenaSiguiente(fecha: string) {
  const actual = quincenaDe(fecha);
  const d = new Date(`${actual.hasta}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return quincenaDe(d.toISOString().slice(0, 10));
}

/** ARS → PES, USD → DOL, EUR → 060 (FEParamGetTiposMonedas). */
export function monedaWsfe(currency: string | null | undefined): "PES" | "DOL" | "060" {
  const c = String(currency ?? "ARS").toUpperCase();
  if (c === "ARS" || c === "PES" || c === "") return "PES";
  if (c === "USD" || c === "DOL") return "DOL";
  if (c === "EUR" || c === "060") return "060";
  throw new Error(`La moneda ${currency} no está admitida para facturar.`);
}

/** CUIT (80), DNI (96) o consumidor final sin identificar (99). */
export function documentoDelReceptor(taxId: string | null | undefined): { docTipo: number; docNro: number } {
  const d = String(taxId ?? "").replace(/\D/g, "");
  if (d.length === 11) return { docTipo: 80, docNro: Number(d) };
  if (d.length === 7 || d.length === 8) return { docTipo: 96, docNro: Number(d) };
  return { docTipo: 99, docNro: 0 };
}

/** Los importes que declara WSFE, en centavos, y que cierren con el total. */
export function importesWsfe(c: ComprobanteParaWsfe, tipoCbte: number) {
  const neto = centavos(c.subtotal, "Neto gravado");
  const iva = centavos(c.tax_amount, "IVA");
  const noGravado = centavos(c.importe_no_gravado, "No gravado");
  const exento = centavos(c.importe_exento, "Exento");
  const tributos = centavos(c.importe_tributos, "Tributos");
  const total = centavos(c.total, "Total");
  if (neto + iva + noGravado + exento + tributos !== total) {
    throw new Error("El total no es la suma de neto gravado, IVA, no gravado, exento y tributos.");
  }
  if (TIPOS_C.has(tipoCbte) && (iva !== 0 || noGravado !== 0 || exento !== 0)) {
    throw new Error("Un comprobante C no discrimina IVA ni separa lo exento o no gravado.");
  }
  const lista = c.tributos ?? [];
  const sumaTributos = lista.reduce((s, t) => s + centavos(t.importe, "Tributo"), 0);
  if (sumaTributos !== tributos) throw new Error("Los tributos no suman el importe de tributos del comprobante.");
  for (const t of lista) {
    if (!TIPOS_DE_TRIBUTO[Number(t.tipo)]) throw new Error(`El tipo de tributo ${t.tipo} no existe en ARCA.`);
    const base = centavos(t.base, "Base del tributo");
    const alic = Number(t.alicuota);
    if (!Number.isFinite(alic) || alic < 0 || alic > 100) throw new Error("La alícuota de un tributo no es válida.");
    if (alic > 0 && Math.abs(Math.round(base * alic / 100) - centavos(t.importe, "Tributo")) > 1) {
      throw new Error(`${t.descripcion || TIPOS_DE_TRIBUTO[Number(t.tipo)]}: el importe no es la base por la alícuota.`);
    }
  }
  return { neto, iva, noGravado, exento, tributos, total };
}

/**
 * El bloque `<ar:Iva>` sólo con lo gravado (`invoiceIvaGroups` filtra los
 * renglones). Lo exento y lo no gravado no son IVA al 0 %: van en `ImpOpEx` e
 * `ImpTotConc`.
 */
function ivaWsfe(c: ComprobanteParaWsfe, tipoCbte: number): string {
  const groups = invoiceIvaGroups({ ...c, tipo_comprobante: tipoCbte });
  return groups.length ? `<ar:Iva>${groups.map(g =>
    `<ar:AlicIva><ar:Id>${g.id}</ar:Id><ar:BaseImp>${g.base.toFixed(2)}</ar:BaseImp><ar:Importe>${g.amount.toFixed(2)}</ar:Importe></ar:AlicIva>`).join("")}</ar:Iva>` : "";
}

export function detalleWsfe(c: ComprobanteParaWsfe, args: {
  puntoVenta: number;
  tipoCbte: number;
  numero: number;
  asociado: AfipAssociatedVoucher | null;
  /** Cotización oficial que devolvió ARCA (FEParamGetCotizacion), si la factura no trae una. */
  cotizacionOficial?: number | null;
  opcionales?: OpcionalWsfe[];
  /**
   * Comprobante de contingencia: se arma como `FECAEADetRequest` (para
   * FECAEARegInformativo) con el CAEA y la fecha y hora de generación.
   */
  caea?: { codigo: string; generado: Date } | null;
}): string {
  const { tipoCbte, numero } = args;
  const imp = importesWsfe(c, tipoCbte);
  const { docTipo, docNro } = documentoDelReceptor(c.customer_tax_id);
  if (TIPOS_A.has(tipoCbte) && docTipo !== 80) throw new Error("Un comprobante A requiere el CUIT del cliente.");

  const concepto = Number(c.concepto ?? 1);
  if (![1, 2, 3].includes(concepto)) throw new Error("El concepto tiene que ser productos, servicios o ambos.");
  const cbteFch = fechaWsfe(c.issue_date, "Fecha del comprobante");
  let servicio = "";
  if (concepto !== 1) {
    if (!c.servicio_desde || !c.servicio_hasta) throw new Error("Para facturar servicios hace falta el período del servicio (desde y hasta).");
    const desde = fechaWsfe(c.servicio_desde, "Servicio desde");
    const hasta = fechaWsfe(c.servicio_hasta, "Servicio hasta");
    if (desde > hasta) throw new Error("El período del servicio empieza después de terminar.");
    const vto = fechaWsfe(c.due_date || c.issue_date, "Vencimiento del pago");
    if (vto < cbteFch) throw new Error("El vencimiento del pago no puede ser anterior a la fecha del comprobante.");
    servicio = `<ar:FchServDesde>${desde}</ar:FchServDesde><ar:FchServHasta>${hasta}</ar:FchServHasta><ar:FchVtoPago>${vto}</ar:FchVtoPago>`;
  } else if ([201, 206, 211].includes(tipoCbte)) {
    // La factura de crédito MiPyME, aun de productos, lleva vencimiento de pago.
    if (!c.due_date) throw new Error("La factura de crédito MiPyME necesita la fecha de vencimiento del pago.");
    const vto = fechaWsfe(c.due_date, "Vencimiento del pago");
    if (vto < cbteFch) throw new Error("El vencimiento del pago no puede ser anterior a la fecha del comprobante.");
    servicio = `<ar:FchVtoPago>${vto}</ar:FchVtoPago>`;
  }

  const monId = monedaWsfe(c.currency);
  let moneda = "<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>";
  if (monId !== "PES") {
    const cot = Number(c.moneda_cotizacion ?? args.cotizacionOficial ?? 0);
    if (!Number.isFinite(cot) || cot <= 0) throw new Error("Para facturar en moneda extranjera hace falta la cotización.");
    moneda = `<ar:MonId>${monId}</ar:MonId><ar:MonCotiz>${Number(cot.toFixed(6))}</ar:MonCotiz><ar:CanMisMonExt>${c.cancela_misma_moneda ? "S" : "N"}</ar:CanMisMonExt>`;
  }

  const condicionIva = Number(c.condicion_iva_receptor) || 5;
  const tributos = (c.tributos ?? []).length ? `<ar:Tributos>${(c.tributos ?? []).map(t =>
    `<ar:Tributo><ar:Id>${Number(t.tipo)}</ar:Id><ar:Desc>${xmlTexto((t.descripcion || TIPOS_DE_TRIBUTO[Number(t.tipo)]).slice(0, 80))}</ar:Desc>` +
    `<ar:BaseImp>${pesos(centavos(t.base, "Base"))}</ar:BaseImp><ar:Alic>${Number(t.alicuota).toFixed(2)}</ar:Alic>` +
    `<ar:Importe>${pesos(centavos(t.importe, "Tributo"))}</ar:Importe></ar:Tributo>`).join("")}</ar:Tributos>` : "";
  const opcionales = args.opcionales?.length ? `<ar:Opcionales>${args.opcionales.map(o =>
    `<ar:Opcional><ar:Id>${xmlTexto(o.id)}</ar:Id><ar:Valor>${xmlTexto(o.valor)}</ar:Valor></ar:Opcional>`).join("")}</ar:Opcionales>` : "";

  const etiqueta = args.caea ? "FECAEADetRequest" : "FECAEDetRequest";
  let caea = "";
  if (args.caea) {
    if (!/^\d{14}$/.test(args.caea.codigo)) throw new Error("El CAEA tiene 14 dígitos.");
    // Hora de Argentina, AAAAMMDDHHMMSS.
    const ar = new Date(args.caea.generado.getTime() - 3 * 3600_000).toISOString();
    caea = `<ar:CAEA>${args.caea.codigo}</ar:CAEA><ar:CbteFchHsGen>${ar.slice(0, 19).replace(/[-T:]/g, "")}</ar:CbteFchHsGen>`;
  }
  return `<ar:${etiqueta}>` +
    `<ar:Concepto>${concepto}</ar:Concepto>` +
    `<ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${numero}</ar:CbteDesde><ar:CbteHasta>${numero}</ar:CbteHasta>` +
    `<ar:CbteFch>${cbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${pesos(imp.total)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>${pesos(imp.noGravado)}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${pesos(imp.neto)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${pesos(imp.exento)}</ar:ImpOpEx>` +
    `<ar:ImpTrib>${pesos(imp.tributos)}</ar:ImpTrib>` +
    `<ar:ImpIVA>${pesos(imp.iva)}</ar:ImpIVA>` +
    servicio + moneda +
    `<ar:CondicionIVAReceptorId>${condicionIva}</ar:CondicionIVAReceptorId>` +
    associatedVoucherXml(tipoCbte, args.asociado) +
    tributos +
    (TIPOS_C.has(tipoCbte) ? "" : ivaWsfe(c, tipoCbte)) +
    opcionales +
    caea +
    `</ar:${etiqueta}>`;
}
