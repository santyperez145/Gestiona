/**
 * Paquete del mes para el contador (2026-10-30): un .zip con todo lo que
 * necesita para liquidar IVA e Ingresos Brutos sin pedir nada.
 *
 *   · Libro IVA Digital Ventas (comprobantes y alícuotas), con los cierres Z
 *     y los Tique-Factura A del controlador.
 *   · Libro IVA Digital Compras (comprobantes y alícuotas).
 *   · El Excel: subdiarios, posición de IVA, retenciones, cierres Z e IIBB.
 *   · LEAME.txt: los totales del mes y lo que conviene revisar antes de
 *     presentar (comprobantes que no entraron, Z en borrador, avisos).
 *
 * Todos los archivos salen del mismo cálculo que la pantalla: el paquete y lo
 * que ve el comercio no pueden diferir.
 */

export interface DatosLeame {
  periodo: string;
  razonSocial?: string | null;
  cuit?: string | null;
  monotributo: boolean;
  ventas: { incluidos: number; total: number; debitoFiscal: number; notasDeCredito: number; porAlicuota: { tasa: number; neto: number; iva: number }[] };
  compras?: { incluidos: number; creditoFiscal: number; percepcionesIva: number } | null;
  posicion?: { debitoFiscal: number; creditoFiscal: number; percepcionesIva: number; retencionesIva: number; saldo: number } | null;
  iibb?: { jurisdiccion: string; base: number; impuesto: number; retenciones: number; saldo: number }[] | null;
  cierresZ: number;
  homologacion: number;
  /** Lo que hay que mirar antes de presentar. */
  pendientes: string[];
}

const FIN = "\r\n";
const pesos = (n: number) => `$ ${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function nombresDelPaquete(periodo: string) {
  const sufijo = periodo.replace("-", "");
  return {
    zip: `contador-${periodo}.zip`,
    ventasCbte: `LIBRO_IVA_DIGITAL_VENTAS_CBTE_${sufijo}.txt`,
    ventasAlicuotas: `LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_${sufijo}.txt`,
    comprasCbte: `LIBRO_IVA_DIGITAL_COMPRAS_CBTE_${sufijo}.txt`,
    comprasAlicuotas: `LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS_${sufijo}.txt`,
    excel: `subdiario-iva-${periodo}.xlsx`,
    leame: "LEAME.txt",
  };
}

export function leameDelMes(d: DatosLeame): string {
  const [anio, mes] = d.periodo.split("-");
  const n = nombresDelPaquete(d.periodo);
  const lineas: string[] = [
    `Paquete del mes para el contador — ${mes}/${anio}`,
    d.razonSocial || d.cuit ? `${d.razonSocial ?? ""}${d.cuit ? ` · CUIT ${d.cuit}` : ""}` : "",
    "",
    "ARCHIVOS",
    `  ${n.ventasCbte} y ${n.ventasAlicuotas}: Libro IVA Digital Ventas, para importar en ARCA › Portal IVA.`,
  ];
  if (!d.monotributo) lineas.push(`  ${n.comprasCbte} y ${n.comprasAlicuotas}: Libro IVA Digital Compras.`);
  lineas.push(`  ${n.excel}: subdiarios de ventas y compras, posición de IVA, retenciones, cierres Z e Ingresos Brutos.`, "");

  lineas.push("VENTAS",
    `  Comprobantes en el libro: ${d.ventas.incluidos}${d.ventas.notasDeCredito ? ` (${d.ventas.notasDeCredito} notas de crédito)` : ""}`,
    `  Total: ${pesos(d.ventas.total)}`,
    `  Débito fiscal: ${pesos(d.ventas.debitoFiscal)}`);
  for (const a of d.ventas.porAlicuota) lineas.push(`    ${String(a.tasa).replace(".", ",")}%: neto ${pesos(a.neto)}, IVA ${pesos(a.iva)}`);
  if (d.cierresZ) lineas.push(`  Incluye ${d.cierresZ} cierre(s) Z del controlador fiscal como venta global diaria.`);
  if (d.homologacion) lineas.push(`  Se dejaron afuera ${d.homologacion} comprobante(s) de homologación (de prueba).`);
  lineas.push("");

  if (d.monotributo) {
    lineas.push("Monotributo: no se presenta Libro IVA; los archivos de ventas sirven de respaldo.", "");
  } else {
    if (d.compras) {
      lineas.push("COMPRAS",
        `  Comprobantes en el libro: ${d.compras.incluidos}`,
        `  Crédito fiscal: ${pesos(d.compras.creditoFiscal)}`,
        `  Percepciones de IVA sufridas: ${pesos(d.compras.percepcionesIva)}`, "");
    }
    if (d.posicion) {
      lineas.push("POSICIÓN DE IVA DEL MES (referencia, sin saldos anteriores)",
        `  Débito fiscal: ${pesos(d.posicion.debitoFiscal)}`,
        `  − Crédito fiscal: ${pesos(d.posicion.creditoFiscal)}`,
        `  − Percepciones de IVA: ${pesos(d.posicion.percepcionesIva)}`,
        `  − Retenciones de IVA: ${pesos(d.posicion.retencionesIva)}`,
        `  ${d.posicion.saldo >= 0 ? "Saldo a pagar" : "Saldo técnico a favor"}: ${pesos(Math.abs(d.posicion.saldo))}`, "");
    }
  }
  if (d.iibb?.length) {
    lineas.push("INGRESOS BRUTOS");
    for (const r of d.iibb) lineas.push(`  ${r.jurisdiccion}: base ${pesos(r.base)}, impuesto ${pesos(r.impuesto)}, retenciones ${pesos(r.retenciones)}, saldo ${pesos(r.saldo)}`);
    lineas.push("");
  }

  lineas.push("ANTES DE PRESENTAR");
  if (d.pendientes.length === 0) lineas.push("  Nada pendiente: todo lo autorizado del mes está en los archivos.");
  else for (const p of d.pendientes) lineas.push(`  · ${p}`);
  lineas.push("", `Generado por Nerqia el ${new Date().toLocaleString("es-AR")}.`);
  return lineas.filter((l, i) => !(l === "" && i === 1)).join(FIN) + FIN;
}
