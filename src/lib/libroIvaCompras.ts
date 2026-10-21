/**
 * Libro IVA Digital — Compras y posición de IVA del mes (2026-10-21).
 *
 * Arma los dos archivos que importa ARCA con los comprobantes de proveedores
 * (tabla `comprobantes_de_compra`), según las especificaciones de la RG 4597
 * (revisión 30/07/2025):
 *
 *   · COMPRAS_CBTE: 325 posiciones por comprobante.
 *   · COMPRAS_ALICUOTAS: 84 posiciones por alícuota.
 *
 * Reglas del diseño que se aplican acá:
 *   · B y C no discriminan IVA: cantidad de alícuotas 0, sin renglones de
 *     alícuota y sin crédito fiscal.
 *   · Sin prorrateo, el crédito fiscal computable es el IVA liquidado.
 *   · Un A o M sin alícuotas (todo exento o no gravado) se informa con una
 *     alícuota 0 % y código de operación E o N.
 *   · Despacho de importación en ceros; CUIT y denominación del corredor en
 *     ceros y blancos: las importaciones van en otro archivo.
 *
 * La posición de IVA es débito fiscal (ventas) menos crédito fiscal (compras)
 * menos percepciones de IVA sufridas. Es una referencia para el mes, no la
 * declaración jurada: no incluye retenciones sufridas ni saldos anteriores.
 */
import { importe, texto } from "@/lib/libroIvaVentas";

export interface AlicuotaCompra { tasa: number; neto: number; iva: number }

export interface ComprobanteCompra {
  id: string;
  fecha: string;
  tipo_comprobante: number;
  punto_venta: number;
  numero: number;
  cuit_emisor: string;
  razon_social_emisor: string;
  alicuotas: AlicuotaCompra[];
  no_gravado: number;
  exento: number;
  percepcion_iva: number;
  percepcion_nacionales: number;
  percepcion_iibb: number;
  percepcion_municipal: number;
  impuestos_internos: number;
  otros_tributos: number;
  total: number;
}

/** Tipos de comprobante que se cargan a mano, con su nombre. */
export const TIPOS_DE_COMPRA: { codigo: number; nombre: string; discriminaIva: boolean }[] = [
  { codigo: 1, nombre: "Factura A", discriminaIva: true },
  { codigo: 2, nombre: "Nota de débito A", discriminaIva: true },
  { codigo: 3, nombre: "Nota de crédito A", discriminaIva: true },
  { codigo: 51, nombre: "Factura M", discriminaIva: true },
  { codigo: 52, nombre: "Nota de débito M", discriminaIva: true },
  { codigo: 53, nombre: "Nota de crédito M", discriminaIva: true },
  { codigo: 201, nombre: "Factura de crédito electrónica MiPyME A", discriminaIva: true },
  { codigo: 202, nombre: "Nota de débito electrónica MiPyME A", discriminaIva: true },
  { codigo: 203, nombre: "Nota de crédito electrónica MiPyME A", discriminaIva: true },
  { codigo: 6, nombre: "Factura B", discriminaIva: false },
  { codigo: 7, nombre: "Nota de débito B", discriminaIva: false },
  { codigo: 8, nombre: "Nota de crédito B", discriminaIva: false },
  { codigo: 11, nombre: "Factura C", discriminaIva: false },
  { codigo: 12, nombre: "Nota de débito C", discriminaIva: false },
  { codigo: 13, nombre: "Nota de crédito C", discriminaIva: false },
];

const SIN_IVA = new Set([6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 61, 64, 82, 83, 111, 206, 207, 208, 211, 212, 213]);
const NOTAS_DE_CREDITO = new Set([3, 8, 13, 53, 203, 208, 213]);
const CODIGO_ALICUOTA: Record<number, string> = { 0: "0003", 10.5: "0004", 21: "0005", 27: "0006", 5: "0008", 2.5: "0009" };
const FIN_DE_LINEA = "\r\n";

const ceros = (valor: number | string, largo: number) => String(valor).padStart(largo, "0").slice(-largo);
const centavos = (n: number) => Math.round((Number(n) || 0) * 100);
const pesos = (c: number) => c / 100;

export const discriminaIva = (tipo: number) => !SIN_IVA.has(Number(tipo));
export const esNotaDeCredito = (tipo: number) => NOTAS_DE_CREDITO.has(Number(tipo));

export interface LibroIvaCompras {
  cbte: string;
  alicuotas: string;
  incluidos: number;
  resumen: {
    creditoFiscal: number;
    percepcionesIva: number;
    porAlicuota: { tasa: number; neto: number; iva: number }[];
    notasDeCredito: number;
  };
}

export function libroIvaCompras(comprobantes: ComprobanteCompra[]): LibroIvaCompras {
  const cbte: string[] = [];
  const alicuotas: string[] = [];
  const porTasa = new Map<number, { neto: number; iva: number }>();
  let credito = 0;
  let percepciones = 0;
  let notasDeCredito = 0;

  const ordenados = [...comprobantes].sort((a, b) =>
    a.fecha.localeCompare(b.fecha) || a.tipo_comprobante - b.tipo_comprobante ||
    a.punto_venta - b.punto_venta || a.numero - b.numero || a.cuit_emisor.localeCompare(b.cuit_emisor));

  for (const c of ordenados) {
    const tipo = Number(c.tipo_comprobante);
    const conIva = discriminaIva(tipo);
    const signo = esNotaDeCredito(tipo) ? -1 : 1;
    if (signo < 0) notasDeCredito++;
    const numero = ceros(c.numero, 20);
    const puntoVenta = ceros(c.punto_venta, 5);
    const tipoTxt = ceros(tipo, 3);
    const cuit = ceros(c.cuit_emisor, 20);

    let renglones: AlicuotaCompra[] = conIva ? [...(c.alicuotas ?? [])].sort((a, b) => a.tasa - b.tasa) : [];
    let codigoOperacion = " ";
    if (conIva && renglones.length === 0) {
      renglones = [{ tasa: 0, neto: 0, iva: 0 }];
      codigoOperacion = Number(c.exento) > 0 ? "E" : "N";
    } else if (conIva && renglones.every(r => r.tasa === 0)) {
      codigoOperacion = Number(c.exento) > 0 || Number(c.no_gravado) === 0 ? "E" : "N";
    }
    const ivaCentavos = renglones.reduce((s, r) => s + centavos(r.iva), 0);

    cbte.push([
      c.fecha.slice(0, 10).replace(/-/g, ""), tipoTxt, puntoVenta, numero,
      "0".repeat(16), // despacho de importación: va en el archivo de importaciones
      "80", cuit, texto(c.razon_social_emisor, 30),
      importe(c.total), importe(c.no_gravado), importe(c.exento),
      importe(c.percepcion_iva), importe(c.percepcion_nacionales), importe(c.percepcion_iibb),
      importe(c.percepcion_municipal), importe(c.impuestos_internos),
      "PES", "0001000000", String(conIva ? renglones.length : 0), codigoOperacion,
      importe(pesos(ivaCentavos)), // crédito fiscal computable, sin prorrateo
      importe(c.otros_tributos),
      "0".repeat(11), " ".repeat(30), importe(0), // corredor: no interviene
    ].join(""));

    for (const r of conIva ? renglones : []) {
      alicuotas.push([tipoTxt, puntoVenta, numero, "80", cuit, importe(r.neto), CODIGO_ALICUOTA[r.tasa] ?? "0003", importe(r.iva)].join(""));
      if (r.neto !== 0 || r.iva !== 0) {
        const t = porTasa.get(r.tasa) ?? { neto: 0, iva: 0 };
        porTasa.set(r.tasa, { neto: t.neto + signo * centavos(r.neto), iva: t.iva + signo * centavos(r.iva) });
      }
    }
    credito += signo * ivaCentavos;
    percepciones += signo * centavos(c.percepcion_iva);
  }

  return {
    cbte: cbte.map(l => l + FIN_DE_LINEA).join(""),
    alicuotas: alicuotas.map(l => l + FIN_DE_LINEA).join(""),
    incluidos: cbte.length,
    resumen: {
      creditoFiscal: pesos(credito),
      percepcionesIva: pesos(percepciones),
      porAlicuota: [...porTasa.entries()].sort(([a], [b]) => a - b).map(([tasa, t]) => ({ tasa, neto: pesos(t.neto), iva: pesos(t.iva) })),
      notasDeCredito,
    },
  };
}

export interface PosicionIva {
  debitoFiscal: number;
  creditoFiscal: number;
  percepcionesIva: number;
  /** Positivo: a pagar. Negativo: saldo técnico a favor. */
  saldo: number;
}

export function posicionIva(debitoFiscal: number, compras: LibroIvaCompras["resumen"]): PosicionIva {
  const saldo = centavos(debitoFiscal) - centavos(compras.creditoFiscal) - centavos(compras.percepcionesIva);
  return { debitoFiscal, creditoFiscal: compras.creditoFiscal, percepcionesIva: compras.percepcionesIva, saldo: pesos(saldo) };
}

/** Lo que la base va a exigir, para avisar antes de guardar. */
export function erroresDeComprobante(c: Omit<ComprobanteCompra, "id">): string[] {
  const errores: string[] = [];
  if (!/^\d{11}$/.test(c.cuit_emisor)) errores.push("El CUIT del proveedor tiene que tener 11 dígitos.");
  if (!c.razon_social_emisor.trim()) errores.push("Falta la razón social del proveedor.");
  if (!(c.numero > 0)) errores.push("Falta el número del comprobante.");
  if (!(c.punto_venta >= 0 && c.punto_venta <= 99999)) errores.push("El punto de venta no es válido.");
  if (!(c.total > 0)) errores.push("El total tiene que ser mayor a cero.");
  const conIva = discriminaIva(c.tipo_comprobante);
  if (!conIva && c.alicuotas.length > 0) errores.push("Los comprobantes B y C no discriminan IVA.");
  if (conIva) {
    for (const a of c.alicuotas) {
      if (Math.abs(centavos(a.iva) - Math.round(centavos(a.neto) * a.tasa / 100)) > 100) {
        errores.push(`El IVA al ${a.tasa.toLocaleString("es-AR")} % no corresponde a su neto.`);
      }
    }
    if (c.alicuotas.length === 0 && Number(c.no_gravado) + Number(c.exento) === 0) {
      errores.push("Cargá al menos una alícuota, o el importe exento o no gravado.");
    }
    const partes = c.alicuotas.reduce((s, a) => s + centavos(a.neto) + centavos(a.iva), 0)
      + [c.no_gravado, c.exento, c.percepcion_iva, c.percepcion_nacionales, c.percepcion_iibb, c.percepcion_municipal, c.impuestos_internos, c.otros_tributos]
        .reduce((s, v) => s + centavos(v), 0);
    if (Math.abs(partes - centavos(c.total)) > 1) errores.push(`El total no coincide con la suma de sus partes (${(partes / 100).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}).`);
  }
  return errores;
}

/**
 * Importe escrito como se escribe acá. «1.234,56» y «2.100» (dos mil cien) usan
 * el punto de miles; «1234.56» o «1.5», sin coma y sin grupos de tres, usan el
 * punto decimal.
 */
export function leerImporte(v: string): number {
  const limpio = v.trim().replace(/[\s$]/g, "");
  const conMiles = limpio.includes(",") || /^-?\d{1,3}(\.\d{3})+$/.test(limpio);
  const n = Number(conMiles ? limpio.replace(/\./g, "").replace(",", ".") : limpio);
  return Number.isFinite(n) ? n : 0;
}
