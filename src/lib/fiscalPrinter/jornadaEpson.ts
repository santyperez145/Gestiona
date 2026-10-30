/**
 * Jornada fiscal del Epson TM-T900FA: informe X, cierre Z y lectura de
 * totales (2026-10-23).
 *
 * Fuente: «Protocolo de Comunicación — Impresora Fiscal Argentina Estándar»,
 * Epson Argentina, rev. E (22/06/2018), §6.6:
 *   · 0801 Informe Diario de Cierre (Cierre Z): sin campos de entrada;
 *     devuelve sólo el número de Z.
 *   · 0802 Informe «Salida de Cajero» (cierre de cajero, el informe X):
 *     extensión bit 0 = imprime.
 *   · 080A Información electrónica general de la jornada en curso, por tipo de
 *     documento: cantidad emitidos (7), cancelados (8), total de ventas (9),
 *     total de IVA (10), internos fijos (11) y porcentuales (12), otros
 *     tributos (13).
 *   · 080B Información de impuestos de la jornada, por tipo: total (1) y, por
 *     cada tasa usada, tasa / IVA / monto vendido / internos fijos /
 *     internos porcentuales.
 *   · 0830 Información de contadores, por tipo: último Z (1) y último número
 *     del tipo pedido (5).
 * Como el Z sólo devuelve su número, los totales se leen ANTES de cerrar.
 *
 * ⚠️ Verificado contra el manual, no contra un equipo. El manual no fija los
 * decimales implícitos de los importes que devuelve el equipo ni si el
 * «monto vendido» por tasa incluye el IVA: se detecta contra el total que
 * informa el propio equipo, y el Z queda en borrador hasta confirmarlo contra
 * el ticket impreso.
 */
import type { EpsonCommand, EpsonResponse } from "@/lib/fiscalPrinter/epson";
import type { ComprobanteZ } from "@/lib/cierreZ";

export const CIERRE_Z: EpsonCommand = { command: "0801", command_extension: "0000" };
/** Informe X: cierre de cajero, impreso. */
export const INFORME_X: EpsonCommand = { command: "0802", command_extension: "0001" };

/** Los tipos que se leen antes del Z: los que puede emitir un controlador 2G. */
export const TIPOS_JORNADA = [81, 82, 83, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120];

/** Para cada tipo: 080A, 080B y 0830, en ese orden. */
export function loteLecturaJornada(tipos: number[] = TIPOS_JORNADA): EpsonCommand[] {
  return tipos.flatMap(tipo => [
    { command: "080A", command_extension: "0000", fields: [String(tipo)], "ignore error": true },
    { command: "080B", command_extension: "0000", fields: [String(tipo)], "ignore error": true },
    { command: "0830", command_extension: "0000", fields: [String(tipo)], "ignore error": true },
  ]);
}

const entero = (v: string | undefined) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const conDecimales = (v: string | undefined, decimales: number) => entero(v) / 10 ** decimales;
const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LecturaJornada {
  ultimoZ: number;
  requiereZ: boolean;
  comprobantes: ComprobanteZ[];
  /** Problemas de lectura o de interpretación: el Z no se confirma con ellos. */
  problemas: string[];
}

/**
 * Arma los comprobantes del Z a partir de las respuestas de `loteLecturaJornada`.
 * `previoHasta`: el último número de cada tipo en el Z anterior confirmado, si
 * se conoce; si no, el primero sale de la cantidad emitida y cancelada.
 */
export function interpretarLecturaJornada(
  respuestas: unknown,
  tipos: number[] = TIPOS_JORNADA,
  previoHasta: Record<number, number> = {},
  decimales = 2,
): LecturaJornada {
  // Como interpretarLoteFactura: el batch puede venir anidado.
  const lista = (Array.isArray(respuestas) ? respuestas : []).flat() as EpsonResponse[];
  const problemas: string[] = [];
  const comprobantes: ComprobanteZ[] = [];
  let ultimoZ = 0;
  let requiereZ = false;
  if (lista.length < tipos.length * 3) {
    problemas.push("El controlador no devolvió todas las lecturas de la jornada.");
  }

  tipos.forEach((tipo, i) => {
    const general = lista[i * 3];
    const impuestos = lista[i * 3 + 1];
    const contadores = lista[i * 3 + 2];
    if (!general || !contadores) return;
    if (general["return code"] && general["return code"] !== "0000") return; // tipo no usado en la jornada
    const g = general.fields ?? [];
    const k = contadores.fields ?? [];
    ultimoZ = Math.max(ultimoZ, entero(g[2]), entero(k[0]));
    requiereZ = requiereZ || g[3] === "S";
    const emitidos = entero(g[6]);
    const cancelados = entero(g[7]);
    if (emitidos === 0 && cancelados === 0) return;

    const total = conDecimales(g[8], decimales);
    const ivaTotal = conDecimales(g[9], decimales);
    const internos = conDecimales(g[10], decimales) + conDecimales(g[11], decimales);
    const otros = conDecimales(g[12], decimales);
    const hasta = entero(k[4]);
    const desde = previoHasta[tipo] ? previoHasta[tipo] + 1 : hasta - (emitidos + cancelados) + 1;

    // Tasas: grupos de 5 campos desde el segundo.
    const f = impuestos?.fields ?? [];
    const tasas: { tasa: number; iva: number; vendido: number }[] = [];
    for (let j = 1; j + 2 < f.length; j += 5) {
      const tasa = conDecimales(f[j], 2);
      const iva = conDecimales(f[j + 1], decimales);
      const vendido = conDecimales(f[j + 2], decimales);
      if (iva === 0 && vendido === 0) continue;
      tasas.push({ tasa, iva, vendido });
    }
    const sumaVendido = tasas.reduce((s, t) => s + t.vendido, 0);
    const sumaIva = tasas.reduce((s, t) => s + t.iva, 0);
    const resto = internos + otros;
    // ¿«Monto vendido» con IVA o neto? El que cierra con el total del equipo.
    let incluyeIva: boolean | null = null;
    if (Math.abs(sumaVendido + resto - total) <= 1) incluyeIva = true;
    else if (Math.abs(sumaVendido + sumaIva + resto - total) <= 1) incluyeIva = false;
    if (tasas.length > 0 && incluyeIva === null) {
      problemas.push(`Tipo ${tipo}: las alícuotas leídas no cierran con el total del equipo; revisalo contra el ticket del Z.`);
    }
    if (Math.abs(sumaIva - ivaTotal) > 1) {
      problemas.push(`Tipo ${tipo}: el IVA por alícuota no suma el IVA total del equipo.`);
    }
    if (!(hasta >= 1) || desde < 1 || desde > hasta) {
      problemas.push(`Tipo ${tipo}: no se pudo leer la numeración (último ${hasta}).`);
    }

    comprobantes.push({
      tipo,
      desde: Math.max(desde, 1),
      hasta: Math.max(hasta, 1),
      cantidad: emitidos,
      cancelados,
      total: redondear(total),
      internos: redondear(internos),
      otros_tributos: redondear(otros),
      alicuotas: tasas.map(t => ({
        tasa: t.tasa,
        neto: redondear(incluyeIva ? t.vendido - t.iva : t.vendido),
        iva: redondear(t.iva),
      })),
    });
  });

  return { ultimoZ, requiereZ, comprobantes, problemas };
}

/** El número de Z que devuelve 0801 (único campo de salida). */
export function numeroDeZ(respuestas: unknown): number | null {
  const r = (Array.isArray(respuestas) ? respuestas.flat()[0] : respuestas) as EpsonResponse | undefined;
  if (!r || (r["return code"] && r["return code"] !== "0000")) return null;
  const n = entero(r.fields?.[0]);
  return n > 0 ? n : null;
}
