/**
 * Cierres Z e informe diario (2026-10-23).
 *
 * Con controlador fiscal, ARCA pide registrar los tiques del día con un
 * asiento resumen que totalice las operaciones consignando el primer y el
 * último número emitidos («Libro de IVA Digital — modalidades especiales de
 * registración», punto d). En el Libro IVA Digital eso es un renglón por tipo
 * de comprobante y por Z, con el campo 4 = primer número del rango, el campo 5
 * = último, código de documento 99 y «VENTA GLOBAL DIARIA» (especificación
 * RG 4597, campos 4 a 7). El registro de alícuotas lleva el número del campo 4.
 *
 * Los comprobantes con IVA discriminado (Tique-Factura A, sus notas, y los M)
 * se registran «en todos los casos en forma individual» (punto c): no salen del
 * Z sino uno por uno, y si un Z los trae se avisa en vez de agruparlos.
 *
 * El informe diario electrónico (X y Z de quien factura con CAE) se arma con
 * `libroIvaVentas`, el mismo cálculo del Libro IVA: el cierre del día y el
 * libro no pueden dar distinto.
 */
import { libroIvaVentas, importe, texto, type AlicuotaResumen, type ComprobanteVenta } from "@/lib/libroIvaVentas";

export interface ComprobanteZ {
  /** Código ARCA del comprobante (81 Tique-Factura A, 82 B, 83 Tique, 111 C, 6 Factura B…). */
  tipo: number;
  desde: number;
  hasta: number;
  cantidad: number;
  cancelados?: number;
  total: number;
  exento?: number;
  no_gravado?: number;
  internos?: number;
  otros_tributos?: number;
  alicuotas: AlicuotaResumen[];
}

/**
 * El cierre diario de quien factura electrónico (`cierres_z.origen`). Es el
 * único lugar con el literal: coincide con un slug de rubro viejo y la guarda
 * de `categoriaSinRubroPorDefault` lo conoce sólo acá.
 */
export const ORIGEN_ELECTRONICO = "electronico" as const;

export interface CierreZ {
  id?: string;
  origen: "controlador" | "manual" | typeof ORIGEN_ELECTRONICO;
  punto_venta: number;
  numero: number;
  fecha: string;
  estado?: "borrador" | "confirmado";
  equipo?: { marca?: string; modelo?: string; registro?: string } | null;
  comprobantes: ComprobanteZ[];
  total?: number;
  iva?: number;
}

export const NOMBRE_TIPO_Z: Record<number, string> = {
  81: "Tique-Factura A", 82: "Tique-Factura B", 83: "Tique", 110: "Tique Nota de Crédito",
  111: "Tique-Factura C", 112: "Tique Nota de Crédito A", 113: "Tique Nota de Crédito B",
  114: "Tique Nota de Crédito C", 115: "Tique Nota de Débito A", 116: "Tique Nota de Débito B",
  117: "Tique Nota de Débito C", 118: "Tique-Factura M", 119: "Tique Nota de Crédito M", 120: "Tique Nota de Débito M",
};

/** Los tipos que emite un controlador fiscal de segunda generación. */
export const TIPOS_CONTROLADOR = Object.keys(NOMBRE_TIPO_Z).map(Number);

/** Con IVA discriminado: van al libro uno por uno, nunca agrupados. */
export const TIPOS_INDIVIDUALES = new Set([81, 112, 115, 118, 119, 120]);

/** Los C no discriminan IVA: no llevan renglón de alícuota. */
const TIPOS_C = new Set([111, 114, 117]);

const NOTAS_DE_CREDITO = new Set([110, 112, 113, 114, 119]);

const CODIGO_ALICUOTA: Record<number, string> = { 0: "0003", 10.5: "0004", 21: "0005", 27: "0006", 5: "0008", 2.5: "0009" };
const FIN_DE_LINEA = "\r\n";
const ceros = (valor: number | string, largo: number) => String(valor).padStart(largo, "0").slice(-largo);
const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo desglosado (alícuotas, exento, no gravado, tributos) contra el total. */
export function desgloseDe(c: ComprobanteZ): number {
  return redondear((c.alicuotas ?? []).reduce((s, a) => s + Number(a.neto) + Number(a.iva), 0)
    + Number(c.exento ?? 0) + Number(c.no_gravado ?? 0) + Number(c.internos ?? 0) + Number(c.otros_tributos ?? 0));
}

/** Los mismos controles que la base (validar_comprobantes_z), para avisar antes de guardar. */
export function controlesZ(comprobantes: ComprobanteZ[]): { nivel: "error" | "aviso"; texto: string }[] {
  const obs: { nivel: "error" | "aviso"; texto: string }[] = [];
  const vistos = new Set<number>();
  for (const c of comprobantes) {
    const nombre = NOMBRE_TIPO_Z[c.tipo] ?? `tipo ${c.tipo}`;
    if (vistos.has(c.tipo)) obs.push({ nivel: "error", texto: `${nombre} figura dos veces.` });
    vistos.add(c.tipo);
    if (!(c.desde >= 1) || !(c.hasta >= c.desde)) obs.push({ nivel: "error", texto: `${nombre}: la numeración desde/hasta no es válida.` });
    if (c.cantidad > c.hasta - c.desde + 1) obs.push({ nivel: "error", texto: `${nombre}: la cantidad no entra en la numeración.` });
    if (!TIPOS_C.has(c.tipo) && (c.alicuotas ?? []).length > 0 && Math.abs(desgloseDe(c) - Number(c.total)) > 1) {
      obs.push({ nivel: "error", texto: `${nombre}: lo desglosado ($ ${desgloseDe(c).toFixed(2)}) no da el total ($ ${Number(c.total).toFixed(2)}). Revisá contra el ticket.` });
    }
    if (TIPOS_INDIVIDUALES.has(c.tipo)) {
      obs.push({ nivel: "aviso", texto: `${nombre}: tiene IVA discriminado y va al Libro IVA uno por uno, no en el resumen del Z.` });
    }
  }
  return obs;
}

/** Totales con signo (las notas de crédito restan), como `totales_z` en la base. */
export function totalesZ(comprobantes: ComprobanteZ[]): { total: number; iva: number } {
  let total = 0;
  let iva = 0;
  for (const c of comprobantes) {
    const signo = NOTAS_DE_CREDITO.has(c.tipo) ? -1 : 1;
    total += signo * Number(c.total);
    iva += signo * (c.alicuotas ?? []).reduce((s, a) => s + Number(a.iva), 0);
  }
  return { total: redondear(total), iva: redondear(iva) };
}

export interface LibroIvaZ {
  cbte: string[];
  alicuotas: string[];
  avisos: string[];
  resumen: { total: number; debitoFiscal: number; porAlicuota: AlicuotaResumen[] };
}

/**
 * Los renglones del Libro IVA Digital Ventas de los Z confirmados del
 * controlador: uno por tipo y por Z, como venta global diaria. Los cierres
 * electrónicos no entran: sus facturas ya están una por una.
 */
export function libroIvaDesdeZ(cierres: CierreZ[]): LibroIvaZ {
  const cbte: string[] = [];
  const alicuotas: string[] = [];
  const avisos: string[] = [];
  const porTasa = new Map<number, AlicuotaResumen>();
  let total = 0;
  let debitoFiscal = 0;

  const ordenados = cierres
    .filter(z => z.origen !== ORIGEN_ELECTRONICO && (z.estado ?? "confirmado") === "confirmado")
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.punto_venta - b.punto_venta || a.numero - b.numero);

  for (const z of ordenados) {
    for (const c of [...z.comprobantes].sort((a, b) => a.tipo - b.tipo)) {
      if (TIPOS_INDIVIDUALES.has(c.tipo)) {
        avisos.push(`Z ${z.numero} (${z.fecha}): ${NOMBRE_TIPO_Z[c.tipo] ?? c.tipo} del ${c.desde} al ${c.hasta} va uno por uno, no en el resumen del Z.`);
        continue;
      }
      const sinIva = TIPOS_C.has(c.tipo);
      const grupos = sinIva ? [] : (c.alicuotas ?? []).filter(a => Number(a.neto) !== 0 || Number(a.iva) !== 0);
      const exento = Number(c.exento ?? 0);
      const noGravado = Number(c.no_gravado ?? 0);
      const soloTasaCero = grupos.length > 0 && grupos.every(g => Number(g.tasa) === 0);
      const netoGravado = grupos.reduce((s, g) => s + Number(g.neto), 0);
      const tipoTxt = ceros(c.tipo, 3);
      const puntoVenta = ceros(z.punto_venta, 5);
      const desde = ceros(c.desde, 20);

      cbte.push([
        z.fecha.slice(0, 10).replace(/-/g, ""), tipoTxt, puntoVenta, desde, ceros(c.hasta, 20),
        "99", ceros(0, 20), texto("VENTA GLOBAL DIARIA", 30),
        importe(c.total),
        importe(noGravado),
        importe(0), // percepción a no categorizados
        importe(exento),
        importe(0), // percepciones nacionales
        importe(0), // percepciones de Ingresos Brutos
        importe(0), // percepciones municipales
        importe(Number(c.internos ?? 0)),
        "PES", ceros(1_000_000, 10), String(grupos.length),
        netoGravado === 0 && exento > 0 ? "E" : netoGravado === 0 && noGravado > 0 ? "N" : soloTasaCero ? "E" : " ",
        importe(Number(c.otros_tributos ?? 0)),
        "00000000",
      ].join(""));
      for (const g of grupos) {
        const codigo = CODIGO_ALICUOTA[Number(g.tasa)];
        if (!codigo) { avisos.push(`Z ${z.numero}: la alícuota ${g.tasa}% no existe en ARCA.`); continue; }
        alicuotas.push([tipoTxt, puntoVenta, desde, importe(g.neto), codigo, importe(g.iva)].join(""));
      }

      const signo = NOTAS_DE_CREDITO.has(c.tipo) ? -1 : 1;
      total += signo * Number(c.total);
      for (const g of grupos) {
        const r = porTasa.get(Number(g.tasa)) ?? { tasa: Number(g.tasa), neto: 0, iva: 0 };
        porTasa.set(Number(g.tasa), { tasa: r.tasa, neto: r.neto + signo * Number(g.neto), iva: r.iva + signo * Number(g.iva) });
        debitoFiscal += signo * Number(g.iva);
      }
    }
  }

  return {
    cbte: cbte.map(l => l + FIN_DE_LINEA),
    alicuotas: alicuotas.map(l => l + FIN_DE_LINEA),
    avisos,
    resumen: {
      total: redondear(total),
      debitoFiscal: redondear(debitoFiscal),
      porAlicuota: [...porTasa.values()].sort((a, b) => a.tasa - b.tasa)
        .map(a => ({ tasa: a.tasa, neto: redondear(a.neto), iva: redondear(a.iva) })),
    },
  };
}

/**
 * Informe diario de quien factura electrónico (X en cualquier momento, Z al
 * cerrar): lo autorizado de un día y punto de venta, por tipo, con el mismo
 * desglose que el Libro IVA. El total va en la moneda de cada factura, como lo
 * suma la base al verificar (`autorizado_del_dia`).
 */
export function informeDiarioElectronico(comprobantes: ComprobanteVenta[]): { comprobantes: ComprobanteZ[]; problemas: string[] } {
  const porTipo = new Map<number, ComprobanteVenta[]>();
  for (const c of comprobantes) {
    const tipo = Number(c.tipo_comprobante);
    if (!tipo || !c.numero_afip) continue;
    porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), c]);
  }
  const problemas: string[] = [];
  const resultado: ComprobanteZ[] = [];
  for (const [tipo, lista] of [...porTipo.entries()].sort((a, b) => a[0] - b[0])) {
    // Sin conversión de moneda: el informe suma como la base.
    const libro = libroIvaVentas(lista.map(c => ({ ...c, currency: null, moneda_cotizacion: 1 })));
    for (const p of libro.problemas) problemas.push(`${p.comprobante}: ${p.motivo}`);
    const numeros = lista.map(c => Number(c.numero_afip));
    const suma = (f: (c: ComprobanteVenta) => number) => redondear(lista.reduce((s, c) => s + f(c), 0));
    const tributo = (c: ComprobanteVenta, tipos: number[]) =>
      (c.tributos ?? []).filter(t => tipos.includes(Number(t.tipo))).reduce((s, t) => s + Number(t.importe || 0), 0);
    resultado.push({
      tipo,
      desde: Math.min(...numeros),
      hasta: Math.max(...numeros),
      cantidad: lista.length,
      total: suma(c => Number(c.total)),
      exento: suma(c => Number(c.importe_exento ?? 0)),
      no_gravado: suma(c => Number(c.importe_no_gravado ?? 0)),
      internos: suma(c => tributo(c, [4])),
      otros_tributos: suma(c => (c.tributos ?? []).reduce((s, t) => s + Number(t.importe || 0), 0) - tributo(c, [4])),
      // libroIvaVentas resta las notas de crédito; el Z las guarda en positivo por tipo.
      alicuotas: libro.resumen.porAlicuota.map(a => ({ tasa: a.tasa, neto: Math.abs(a.neto), iva: Math.abs(a.iva) })),
    });
  }
  return { comprobantes: resultado, problemas };
}

/** Un renglón del formulario de carga manual del Z, tal como se escribe. */
export type RenglonZ = {
  tipo: string; desde: string; hasta: string; cantidad: string; total: string;
  neto21: string; iva21: string; neto105: string; iva105: string; neto27: string; iva27: string;
  exento: string; noGravado: string; internos: string;
};

export const renglonZVacio = (tipo = "82"): RenglonZ => ({
  tipo, desde: "", hasta: "", cantidad: "", total: "",
  neto21: "", iva21: "", neto105: "", iva105: "", neto27: "", iva27: "", exento: "", noGravado: "", internos: "",
});

const num = (v: string) => Number(String(v).replace(",", ".")) || 0;

/** Del formulario de carga manual a lo que guarda la base. */
export function comprobanteDesdeRenglon(r: RenglonZ): ComprobanteZ {
  const alicuotas = ([[21, r.neto21, r.iva21], [10.5, r.neto105, r.iva105], [27, r.neto27, r.iva27]] as const)
    .filter(([, neto, iva]) => num(neto) !== 0 || num(iva) !== 0)
    .map(([tasa, neto, iva]) => ({ tasa, neto: num(neto), iva: num(iva) }));
  const desde = Math.floor(num(r.desde));
  const hasta = Math.floor(num(r.hasta));
  return {
    tipo: Number(r.tipo), desde, hasta,
    cantidad: r.cantidad.trim() === "" ? Math.max(hasta - desde + 1, 0) : Math.floor(num(r.cantidad)),
    total: num(r.total), exento: num(r.exento), no_gravado: num(r.noGravado), internos: num(r.internos), alicuotas,
  };
}
