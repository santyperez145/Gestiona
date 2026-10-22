/**
 * Conciliación con «Mis Comprobantes – Emitidos» de ARCA (2026-10-22).
 *
 * Lo que ARCA tiene registrado es la verdad fiscal. Comparar el archivo que
 * descarga el comercio con lo que Nerqia autorizó encuentra:
 *
 *   · un CAE que ARCA otorgó y Nerqia no llegó a guardar (la respuesta se
 *     perdió): la factura sigue «en verificación» o «sin conexión» y hay
 *     riesgo de emitirla dos veces;
 *   · comprobantes emitidos por fuera de Nerqia (otro sistema, la web de ARCA)
 *     en los mismos puntos de venta;
 *   · facturas con CAE en Nerqia que ARCA no tiene, o con otro CAE, otro
 *     importe u otra fecha.
 *
 * El archivo se lee con las mismas reglas que el de Recibidos
 * (`misComprobantes.ts`): columnas por nombre, montos con coma, fechas en
 * cualquiera de sus formatos. Lo que no se puede leer vuelve con el motivo.
 */
import { fechaIso, monto, normalizar, tipoDeComprobante } from "@/lib/misComprobantes";
import { NOTAS_DE_CREDITO } from "../../supabase/functions/_shared/comprobantesArca";

export interface EmitidoArca {
  fila: number;
  fecha: string;
  tipo: number;
  pv: number;
  numero: number;
  cae: string;
  /** Importe del comprobante en su moneda; null si la fila agrupa un rango. */
  total: number | null;
  moneda: string;
  receptor: string;
}

export interface LecturaEmitidos {
  comprobantes: EmitidoArca[];
  problemas: { fila: number; motivo: string }[];
  desde: string | null;
  hasta: string | null;
  error: string | null;
}

/** Un rango Desde–Hasta más grande que esto no se expande (no es de Nerqia). */
const RANGO_MAXIMO = 1000;

function columnas(encabezado: unknown[]) {
  const col: Record<string, number> = {};
  encabezado.forEach((h, i) => {
    const n = normalizar(h);
    const asignar = (clave: string) => { if (col[clave] === undefined) col[clave] = i; };
    if (/^fecha( de emision)?$/.test(n)) asignar("fecha");
    else if (/^tipo( de comprobante)?$/.test(n)) asignar("tipo");
    else if (/^punto de venta$/.test(n)) asignar("pv");
    else if (/^(numero|nro) desde$|^numero$/.test(n)) asignar("desde");
    else if (/^(numero|nro) hasta$/.test(n)) asignar("hasta");
    else if (/^cod(igo)? (de )?autorizacion$|^cae$/.test(n)) asignar("cae");
    else if (/^denominacion receptor$/.test(n)) asignar("receptor");
    else if (/emisor/.test(n)) asignar("emisor");
    else if (/^moneda$/.test(n)) asignar("moneda");
    else if (/^imp(orte)? total$/.test(n)) asignar("total");
  });
  return col;
}

export function leerEmitidosArca(matriz: unknown[][]): LecturaEmitidos {
  const vacio = { comprobantes: [], problemas: [], desde: null, hasta: null };
  const inicio = matriz.slice(0, 15).findIndex(fila => {
    const c = columnas(fila ?? []);
    return c.fecha !== undefined && c.tipo !== undefined && c.pv !== undefined && c.desde !== undefined;
  });
  if (inicio < 0) return { ...vacio, error: "No encontramos las columnas de «Mis Comprobantes» (Fecha, Tipo, Punto de Venta, Número Desde…). Descargá los comprobantes emitidos desde ARCA y subí el archivo sin modificar." };
  const col = columnas(matriz[inicio]);
  if (col.emisor !== undefined && col.receptor === undefined) {
    return { ...vacio, error: "Ese archivo es de comprobantes recibidos. Para conciliar lo que facturaste descargá los «Emitidos»." };
  }
  if (col.cae === undefined) return { ...vacio, error: "Al archivo le falta la columna «Cód. Autorización»." };

  const comprobantes: EmitidoArca[] = [];
  const problemas: LecturaEmitidos["problemas"] = [];
  matriz.slice(inicio + 1).forEach((fila, i) => {
    if (!fila || fila.every(c => String(c ?? "").trim() === "")) return;
    const v = (clave: string) => (col[clave] === undefined ? undefined : fila[col[clave]]);
    const numeroFila = inicio + i + 2;
    const fecha = fechaIso(v("fecha"));
    const tipo = tipoDeComprobante(v("tipo"));
    const pv = Math.trunc(monto(v("pv")));
    const desde = Math.trunc(monto(v("desde")));
    const hasta = col.hasta === undefined ? desde : Math.trunc(monto(v("hasta"))) || desde;
    const cae = String(v("cae") ?? "").replace(/\D/g, "");
    if (!fecha || !tipo || !(pv > 0) || !(desde > 0)) {
      problemas.push({ fila: numeroFila, motivo: "No se pudo leer la fecha, el tipo, el punto de venta o el número." });
      return;
    }
    if (hasta < desde || hasta - desde >= RANGO_MAXIMO) {
      problemas.push({ fila: numeroFila, motivo: `El rango ${desde}–${hasta} no se puede comparar comprobante por comprobante.` });
      return;
    }
    const total = col.total === undefined ? null : Math.abs(monto(v("total")));
    const moneda = normalizar(v("moneda") || "pes");
    const receptor = String(v("receptor") ?? "").trim();
    for (let n = desde; n <= hasta; n++) {
      comprobantes.push({ fila: numeroFila, fecha, tipo, pv, numero: n, cae, total: hasta === desde ? total : null, moneda, receptor });
    }
  });
  const fechas = comprobantes.map(c => c.fecha).sort();
  return {
    comprobantes, problemas,
    desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null,
    error: comprobantes.length || problemas.length ? null : "El archivo no tiene comprobantes.",
  };
}

// ── Comparación ──────────────────────────────────────────────────────────────

export interface FacturaNerqia {
  id: string;
  number?: string | null;
  issue_date: string;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero_afip: number | null;
  cae: string | null;
  total: number;
  currency?: string | null;
  afip_status: string | null;
  customer_name?: string | null;
  codigo_autorizacion_tipo?: string | null;
  caea_informado_at?: string | null;
  afip_candidate_number?: number | null;
}

export interface Diferencia { arca: EmitidoArca; factura: FacturaNerqia; motivos: string[] }
export interface SoloEnArca { arca: EmitidoArca; /** Factura de Nerqia sin CAE que reservó ese número: el CAE se perdió. */ sinRegistrar: FacturaNerqia | null }
export interface SoloEnNerqia { factura: FacturaNerqia; motivo: string }

export interface Conciliacion {
  coinciden: number;
  diferencias: Diferencia[];
  soloEnArca: SoloEnArca[];
  soloEnNerqia: SoloEnNerqia[];
}

const clave = (tipo: number, pv: number, numero: number) => `${tipo}:${pv}:${numero}`;
const esPesos = (moneda: string | null | undefined) => ["pes", "ars", "$", ""].includes(normalizar(moneda ?? ""));
const ars = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function conciliar(arca: EmitidoArca[], facturas: FacturaNerqia[]): Conciliacion {
  const conCae = new Map<string, FacturaNerqia>();
  const reservadas = new Map<string, FacturaNerqia>();
  for (const f of facturas) {
    const tipo = Number(f.tipo_comprobante), pv = Number(f.punto_venta);
    if (!tipo) continue;
    if (f.cae && f.numero_afip) conCae.set(clave(tipo, pv, Number(f.numero_afip)), f);
    else if (!f.cae && f.afip_candidate_number) reservadas.set(clave(tipo, pv, Number(f.afip_candidate_number)), f);
  }

  const r: Conciliacion = { coinciden: 0, diferencias: [], soloEnArca: [], soloEnNerqia: [] };
  const vistas = new Set<string>();
  for (const a of arca) {
    const k = clave(a.tipo, a.pv, a.numero);
    vistas.add(k);
    const f = conCae.get(k);
    if (!f) { r.soloEnArca.push({ arca: a, sinRegistrar: reservadas.get(k) ?? null }); continue; }
    const motivos: string[] = [];
    if (a.cae && f.cae && a.cae !== f.cae.replace(/\D/g, "")) motivos.push(`CAE distinto: ARCA ${a.cae}, Nerqia ${f.cae}`);
    const mismaMoneda = esPesos(a.moneda) === esPesos(f.currency);
    if (a.total !== null && mismaMoneda && Math.abs(a.total - Math.abs(Number(f.total))) > 0.01) {
      motivos.push(`Importe distinto: ARCA $${ars(a.total)}, Nerqia $${ars(Math.abs(Number(f.total)))}`);
    }
    if (a.fecha !== f.issue_date) motivos.push(`Fecha distinta: ARCA ${a.fecha}, Nerqia ${f.issue_date}`);
    if (motivos.length) r.diferencias.push({ arca: a, factura: f, motivos });
    else r.coinciden++;
  }

  const puntos = new Set(arca.map(a => a.pv));
  for (const [k, f] of conCae) {
    if (vistas.has(k)) continue;
    const motivo = f.codigo_autorizacion_tipo === "A" && !f.caea_informado_at
      ? "Emitida con CAEA y todavía no informada: aparece en ARCA cuando se informa."
      : !puntos.has(Number(f.punto_venta))
      ? `Su punto de venta (${f.punto_venta}) no está en el archivo: ¿lo filtraste al descargar?`
      : "ARCA no la tiene registrada. Revisala antes de entregarla o declararla.";
    r.soloEnNerqia.push({ factura: f, motivo });
  }
  return r;
}

export type Celda = string | number;

/** Detalle para el Excel: una fila por comprobante que no coincide. */
export function hojaConciliacion(c: Conciliacion): Celda[][] {
  const nombre = (tipo: number, pv: number, numero: number) => `${NOTAS_DE_CREDITO.has(tipo) ? "NC" : "Cbte"} ${tipo} ${String(pv).padStart(5, "0")}-${String(numero).padStart(8, "0")}`;
  const filas: Celda[][] = [["Situación", "Comprobante", "Fecha", "Receptor", "CAE en ARCA", "CAE en Nerqia", "Detalle"]];
  for (const d of c.diferencias) {
    filas.push(["Diferencia", nombre(d.arca.tipo, d.arca.pv, d.arca.numero), d.arca.fecha, d.arca.receptor, d.arca.cae, d.factura.cae ?? "", d.motivos.join(" · ")]);
  }
  for (const s of c.soloEnArca) {
    filas.push([s.sinRegistrar ? "CAE sin registrar en Nerqia" : "Sólo en ARCA", nombre(s.arca.tipo, s.arca.pv, s.arca.numero), s.arca.fecha, s.arca.receptor, s.arca.cae, "",
      s.sinRegistrar ? `Corresponde a la factura ${s.sinRegistrar.number ?? s.sinRegistrar.id} de Nerqia, que quedó sin CAE.` : "Emitido por fuera de Nerqia."]);
  }
  for (const s of c.soloEnNerqia) {
    const f = s.factura;
    filas.push(["Sólo en Nerqia", nombre(Number(f.tipo_comprobante), Number(f.punto_venta), Number(f.numero_afip)), f.issue_date, f.customer_name ?? "", "", f.cae ?? "", s.motivo]);
  }
  return filas;
}
