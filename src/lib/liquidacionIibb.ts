/**
 * Liquidación mensual de Ingresos Brutos (2026-10-22): el borrador de la
 * declaración jurada de cada jurisdicción, con lo que Nerqia ya sabe.
 *
 *   · Base imponible: lo facturado y autorizado en el mes, sin IVA ni otros
 *     tributos (neto gravado + no gravado + exento), en pesos; las notas de
 *     crédito restan. Es el criterio de lo devengado.
 *   · Contribuyente local: toda la base va a su jurisdicción.
 *   · Convenio Multilateral: la base se reparte con el coeficiente unificado
 *     de cada jurisdicción (el del CM05), que tiene que sumar 1.
 *   · Impuesto determinado = base × alícuota; se le restan las retenciones
 *     sufridas de esa jurisdicción.
 *
 * Las percepciones de IIBB de las compras no traen jurisdicción: se informan
 * aparte para que el contador las impute; no se restan a ciegas.
 *
 * Es un borrador para SIFERE / ARBA / AGIP, no la presentación: no conoce
 * saldos a favor anteriores, anticipos ni deducciones especiales.
 */
import { importesWsfe } from "../../supabase/functions/_shared/wsfeComprobante";
import { NOTAS_DE_CREDITO } from "../../supabase/functions/_shared/comprobantesArca";
import type { ComprobanteVenta } from "./libroIvaVentas";
import type { Celda, RetencionSufrida } from "./subdiarioIva";

export interface InscripcionIibb {
  id: string;
  province: string;
  regime: string;
  rate_pct: number;
  coeficiente?: number | null;
  active: boolean;
}

export interface RenglonIibb {
  jurisdiccion: string;
  regimen: "local" | "convenio";
  coeficiente: number;
  base: number;
  alicuota: number;
  impuesto: number;
  retenciones: number;
  saldo: number;
}

export interface LiquidacionIibb {
  baseTotal: number;
  renglones: RenglonIibb[];
  /** Retenciones de IIBB cuya jurisdicción no es ninguna de las inscriptas. */
  retencionesSinJurisdiccion: number;
  percepcionesDeCompras: number;
  avisos: string[];
  problemas: { id: string; comprobante: string; motivo: string }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** «Ciudad Autónoma de Buenos Aires», «CABA», «caba» → la misma clave. */
export function claveJurisdiccion(nombre: string | null | undefined): string {
  const t = String(nombre ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(caba|capital federal|ciudad autonoma de buenos aires|ciudad de buenos aires|agip)$/.test(t)) return "caba";
  if (/^(buenos aires|provincia de buenos aires|pba|arba)$/.test(t)) return "buenos aires";
  return t.replace(/^provincia de /, "");
}

const esConvenio = (regime: string) => regime === "convenio" || regime === "cm";

/** Base imponible de un comprobante en pesos (negativa si es nota de crédito). */
export function baseIibb(c: ComprobanteVenta): number {
  const tipo = Number(c.tipo_comprobante);
  const imp = importesWsfe({ ...c, invoice_items: c.invoice_items ?? [] } as Parameters<typeof importesWsfe>[0], tipo);
  const cotizacion = String(c.currency ?? "ARS").toUpperCase() === "ARS" ? 1 : Number(c.moneda_cotizacion) || 0;
  if (!(cotizacion > 0)) throw new Error("Falta la cotización de un comprobante en moneda extranjera.");
  const centavos = imp.neto + imp.noGravado + imp.exento;
  const signo = NOTAS_DE_CREDITO.has(tipo) ? -1 : 1;
  return r2(signo * centavos * cotizacion / 100);
}

export function liquidacionIibb(args: {
  comprobantes: ComprobanteVenta[];
  inscripciones: InscripcionIibb[];
  retenciones: RetencionSufrida[];
  percepcionesDeCompras: number;
}): LiquidacionIibb {
  const problemas: LiquidacionIibb["problemas"] = [];
  let baseTotal = 0;
  for (const c of args.comprobantes) {
    try {
      baseTotal += baseIibb(c);
    } catch (e) {
      problemas.push({ id: c.id, comprobante: c.number ?? `${c.punto_venta ?? "?"}-${c.numero_afip ?? "?"}`, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  baseTotal = r2(baseTotal);

  const activas = args.inscripciones.filter(i => i.active);
  const avisos: string[] = [];
  const locales = activas.filter(i => !esConvenio(i.regime));
  const convenio = activas.filter(i => esConvenio(i.regime));
  if (activas.length === 0) avisos.push("No cargaste en qué jurisdicciones estás inscripto: agregalas en Impuestos → IIBB.");
  if (locales.length > 1) avisos.push("Figurás como contribuyente local en más de una jurisdicción: si vendés en varias, corresponde Convenio Multilateral.");
  if (locales.length && convenio.length) avisos.push("Tenés inscripciones locales y de Convenio Multilateral a la vez: revisá cuál corresponde.");
  if (convenio.length) {
    const suma = convenio.reduce((s, i) => s + Number(i.coeficiente ?? 0), 0);
    if (convenio.some(i => !(Number(i.coeficiente) > 0))) avisos.push("Falta el coeficiente unificado de alguna jurisdicción del Convenio (está en tu CM05).");
    else if (Math.abs(suma - 1) > 0.0001) avisos.push(`Los coeficientes del Convenio suman ${suma.toFixed(4)}: tienen que sumar 1.`);
  }

  const retPorJurisdiccion = new Map<string, number>();
  let retencionesSinJurisdiccion = 0;
  const claves = new Set(activas.map(i => claveJurisdiccion(i.province)));
  for (const r of args.retenciones) {
    if (r.impuesto !== "iibb") continue;
    const k = claveJurisdiccion(r.jurisdiccion);
    if (k && claves.has(k)) retPorJurisdiccion.set(k, r2((retPorJurisdiccion.get(k) ?? 0) + Number(r.importe)));
    else retencionesSinJurisdiccion = r2(retencionesSinJurisdiccion + Number(r.importe));
  }
  if (retencionesSinJurisdiccion > 0) avisos.push("Hay retenciones de IIBB sin una jurisdicción inscripta: imputalas en la que corresponda.");

  const renglones: RenglonIibb[] = activas
    .map(i => {
      const convenioDeEsta = esConvenio(i.regime);
      const coeficiente = convenioDeEsta ? Number(i.coeficiente ?? 0) : 1;
      const base = r2(baseTotal * coeficiente);
      const alicuota = Number(i.rate_pct) || 0;
      const impuesto = r2(Math.max(base, 0) * alicuota / 100);
      const retenciones = retPorJurisdiccion.get(claveJurisdiccion(i.province)) ?? 0;
      return { jurisdiccion: i.province, regimen: convenioDeEsta ? "convenio" as const : "local" as const, coeficiente, base, alicuota, impuesto, retenciones, saldo: r2(impuesto - retenciones) };
    })
    .sort((a, b) => b.base - a.base || a.jurisdiccion.localeCompare(b.jurisdiccion));

  return { baseTotal, renglones, retencionesSinJurisdiccion, percepcionesDeCompras: r2(args.percepcionesDeCompras), avisos, problemas };
}

export function hojaIibb(l: LiquidacionIibb): Celda[][] {
  const filas: Celda[][] = [["Jurisdicción", "Régimen", "Coeficiente", "Base imponible", "Alícuota %", "Impuesto determinado", "Retenciones sufridas", "Saldo"]];
  for (const r of l.renglones) {
    filas.push([r.jurisdiccion, r.regimen === "convenio" ? "Convenio Multilateral" : "Local", r.coeficiente, r.base, r.alicuota, r.impuesto, r.retenciones ? -r.retenciones : 0, r.saldo]);
  }
  filas.push([], ["Base imponible total del mes", "", "", l.baseTotal]);
  if (l.percepcionesDeCompras) filas.push(["Percepciones de IIBB en compras (imputar por jurisdicción)", "", "", -l.percepcionesDeCompras]);
  if (l.retencionesSinJurisdiccion) filas.push(["Retenciones de IIBB sin jurisdicción inscripta", "", "", -l.retencionesSinJurisdiccion]);
  filas.push([], ["Borrador: no incluye saldos a favor anteriores, anticipos ni deducciones especiales."]);
  return filas;
}
