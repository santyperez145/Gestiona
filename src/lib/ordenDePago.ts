/**
 * Orden de pago a un proveedor (2026-10-22): con qué se pagan qué deudas, y
 * el comprobante para imprimir. La autoridad es `emitir_orden_de_pago`
 * (migración 20261022001400); esto valida antes de mandar y arma el papel.
 * La retención de Ingresos Brutos de un agente (20261022001600) la calcula la
 * base: acá sólo se muestra, se manda marcada `automatica` y se imprime. En
 * AGIP la hoja es el certificado del agente; en ARBA, desde el 1/12/2025
 * (RN 22/2025), el único comprobante válido es el A-122R que genera ARBA al
 * cargar la retención, así que la hoja es el detalle con el número de
 * transacción y lo dice.
 */
import type { EmisorDelRemito } from "@/lib/remitos";

export type MedioDePago = "efectivo" | "transferencia" | "cheque_propio" | "cheque_tercero" | "retencion" | "otro";

export const MEDIOS: Record<MedioDePago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque_propio: "Cheque propio",
  cheque_tercero: "Cheque de terceros",
  retencion: "Retención",
  otro: "Otro",
};

export interface ImputacionForm { deudaId: string; descripcion: string; saldo: number; importe: string }
export interface MedioForm {
  medio: MedioDePago; importe: string; referencia: string;
  chequeId: string; banco: string; numero: string; vencimiento: string;
  /** Retención de IIBB calculada por la base: el certificado se numera al emitir. */
  automatica?: boolean; base?: string;
}

/** Lo que devuelve `retencion_para_proveedor`. */
export type CalculoRetencion =
  | { aplica: true; jurisdiccion: string; base: number; alicuota: number; importe: number; origen: "padron" | "sin_padron" }
  | { aplica: false; motivo: "no_agente" | "sin_cuit" | "bajo_minimo" | "padron_vencido" | "alicuota_cero"; jurisdiccion?: string; minimo?: number; aviso?: string };

/** El medio de retención automática, listo para la orden. */
export const medioDeRetencion = (c: Extract<CalculoRetencion, { aplica: true }>): MedioForm =>
  ({ ...medioVacio("retencion", String(c.importe)), automatica: true, base: String(c.base) });

/** Qué decirle al que paga cuando no corresponde retener (null: nada). */
export function avisoDeRetencion(c: CalculoRetencion | null): string | null {
  if (!c || !("motivo" in c)) return null;
  if (c.motivo === "sin_cuit") return "Sos agente de retención de Ingresos Brutos, pero este proveedor no tiene CUIT: cargalo en su ficha para retenerle.";
  if (c.motivo === "padron_vencido") return c.aviso ?? "El padrón de retenciones no está vigente: cargá el del mes.";
  if (c.motivo === "bajo_minimo") return `Este pago no llega a la base mínima de retención${c.minimo ? ` (${pesos(c.minimo)})` : ""}: no se retiene.`;
  return null;
}

export const medioVacio = (medio: MedioDePago = "transferencia", importe = ""): MedioForm =>
  ({ medio, importe, referencia: "", chequeId: "", banco: "", numero: "", vencimiento: "" });

/** «1.234,56», «1234.56» o «1234» → número; vacío o inválido → 0. */
export function leerMonto(texto: string): number {
  const t = String(texto ?? "").trim().replace(/\s|\$/g, "");
  if (!t) return 0;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function totales(imputaciones: ImputacionForm[], medios: MedioForm[]) {
  const imputado = Math.round(imputaciones.reduce((s, i) => s + leerMonto(i.importe), 0) * 100) / 100;
  const pagado = Math.round(medios.reduce((s, m) => s + leerMonto(m.importe), 0) * 100) / 100;
  return { imputado, pagado, diferencia: Math.round((imputado - pagado) * 100) / 100 };
}

/** Lo que la base rechazaría, dicho antes de mandar. */
export function erroresDeOrden(imputaciones: ImputacionForm[], medios: MedioForm[], cheques: { id: string; amount_ars: number }[] = []): string[] {
  const e: string[] = [];
  if (!imputaciones.length) e.push("Elegí al menos una deuda.");
  for (const i of imputaciones) {
    const v = leerMonto(i.importe);
    if (v <= 0 || v > i.saldo + 0.001) e.push(`«${i.descripcion}»: el importe tiene que ser mayor a cero y no superar el saldo.`);
  }
  if (!medios.length) e.push("Indicá con qué pagás.");
  const usados = new Set<string>();
  for (const m of medios) {
    const v = leerMonto(m.importe);
    if (v <= 0) e.push(`${MEDIOS[m.medio]}: falta el importe.`);
    if (m.medio === "cheque_tercero") {
      const ch = cheques.find(c => c.id === m.chequeId);
      if (!ch) e.push("Elegí el cheque de terceros de la cartera.");
      else if (Math.abs(Number(ch.amount_ars) - v) > 0.001) e.push("Un cheque de terceros se entrega por su importe completo.");
      if (m.chequeId && usados.has(m.chequeId)) e.push("El mismo cheque está dos veces.");
      usados.add(m.chequeId);
    }
    if (m.medio === "cheque_propio" && (!m.numero.trim() || !m.vencimiento)) e.push("El cheque propio necesita número y fecha de pago.");
    if (m.medio === "retencion" && !m.automatica && !m.referencia.trim()) e.push("La retención necesita el número de certificado.");
  }
  const t = totales(imputaciones, medios);
  if (imputaciones.length && medios.length && t.diferencia !== 0) {
    e.push(t.diferencia > 0 ? `Falta asignar ${pesos(t.diferencia)} a algún medio de pago.` : `Los medios superan lo que se paga en ${pesos(-t.diferencia)}.`);
  }
  return e;
}

/** El cuerpo que recibe `emitir_orden_de_pago`. */
export function ordenParaEnviar(a: { supplierId: string; clave: string; notas: string; imputaciones: ImputacionForm[]; medios: MedioForm[] }) {
  return {
    supplier_id: a.supplierId, idempotency_key: a.clave, notas: a.notas.trim() || null,
    imputaciones: a.imputaciones.map(i => ({ deuda_id: i.deudaId, importe: leerMonto(i.importe) })),
    medios: a.medios.map(m => ({
      medio: m.medio, importe: leerMonto(m.importe),
      ...(m.medio === "cheque_tercero" ? { cheque_id: m.chequeId } : {}),
      ...(m.medio === "cheque_propio" ? { banco: m.banco.trim() || null, numero: m.numero.trim(), vencimiento: m.vencimiento } : {}),
      ...(m.automatica ? { automatica: true, base: leerMonto(m.base ?? "") } : {}),
      ...(!m.automatica && m.referencia.trim() ? { referencia: m.referencia.trim() } : {}),
    })),
  };
}

const pesos = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fecha = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export interface OrdenImpresa {
  numero: number; fecha: string; proveedor: string; proveedorCuit: string | null; total: number; notas: string | null;
  imputaciones: { descripcion: string; importe: number }[];
  medios: { medio: MedioDePago; importe: number; referencia: string | null }[];
  /** Certificados de las retenciones automáticas, impresos después de la orden. */
  retenciones?: RetencionImpresa[];
}

export interface RetencionImpresa { jurisdiccion: string; certificado: number; base: number; alicuota: number; importe: number }

const NOMBRE_JURISDICCION: Record<string, string> = {
  ARBA: "Agencia de Recaudación de la Provincia de Buenos Aires (ARBA)",
  AGIP: "Administración Gubernamental de Ingresos Públicos de la Ciudad (AGIP)",
};

/** La hoja de la retención: certificado del agente (AGIP) o detalle para el A-122R (ARBA). */
function certificadoDeRetencion(o: OrdenImpresa, r: RetencionImpresa, emisor: EmisorDelRemito, copia: string): string {
  const numero = String(r.certificado).padStart(8, "0");
  const arba = r.jurisdiccion === "ARBA";
  return `<section class="hoja"><p class="copia">${copia}</p>
    <header><div><h1>${esc(emisor.razonSocial || emisor.nombre)}</h1>${emisor.cuit ? `<p>CUIT ${esc(emisor.cuit)} · Agente de retención</p>` : ""}${emisor.domicilio ? `<p>${esc(emisor.domicilio)}</p>` : ""}</div>
    <div class="dato"><h2>${arba ? "DETALLE DE RETENCIÓN" : "CERTIFICADO DE RETENCIÓN"}</h2><p class="numero">IIBB ${esc(r.jurisdiccion)}${arba ? " · transacción" : ""} N.º ${numero}</p><p>Fecha ${fecha(o.fecha)}</p></div></header>
    ${arba ? `<p class="notas"><strong>No es el comprobante de la retención.</strong> El comprobante válido es el A-122R que genera ARBA cuando el agente carga esta retención (RN ARBA 22/2025); se le entrega al proveedor.</p>` : ""}
    <p class="prov"><span>Sujeto retenido</span><strong>${esc(o.proveedor)}</strong>${o.proveedorCuit ? ` · CUIT ${esc(o.proveedorCuit)}` : ""}</p>
    <table><tbody>
      <tr><td>Impuesto</td><td>Ingresos Brutos — ${esc(NOMBRE_JURISDICCION[r.jurisdiccion] ?? r.jurisdiccion)}</td></tr>
      <tr><td>Comprobante de pago</td><td>Orden de pago N.º ${String(o.numero).padStart(8, "0")}</td></tr>
      <tr><td>Base sujeta a retención</td><td class="n">${pesos(r.base)}</td></tr>
      <tr><td>Alícuota</td><td class="n">${r.alicuota.toLocaleString("es-AR", { maximumFractionDigits: 2 })} %</td></tr>
    </tbody></table>
    <p class="total">Importe retenido ${pesos(r.importe)}</p>
    <div class="firmas"><div>Firma del agente de retención</div><div>Recibí conforme (firma y aclaración)</div></div>
    <footer>${arba ? "Se declara con el lote A-122R del período (Nerqia › ARCA › Retenciones al pagar)." : "El importe retenido se ingresa a nombre del sujeto retenido en la declaración del agente."}</footer></section>`;
}

/** El comprobante para el proveedor: original y duplicado. */
export function ordenDePagoHtml(o: OrdenImpresa, emisor: EmisorDelRemito): string {
  const numero = String(o.numero).padStart(8, "0");
  const hoja = (copia: string) => `<section class="hoja"><p class="copia">${copia}</p>
    <header><div><h1>${esc(emisor.razonSocial || emisor.nombre)}</h1>${emisor.cuit ? `<p>CUIT ${esc(emisor.cuit)}</p>` : ""}${emisor.domicilio ? `<p>${esc(emisor.domicilio)}</p>` : ""}</div>
    <div class="dato"><h2>ORDEN DE PAGO</h2><p class="numero">N.º ${numero}</p><p>Fecha ${fecha(o.fecha)}</p></div></header>
    <p class="prov"><span>Proveedor</span><strong>${esc(o.proveedor)}</strong>${o.proveedorCuit ? ` · CUIT ${esc(o.proveedorCuit)}` : ""}</p>
    <h3>Se cancela</h3><table><thead><tr><th>Comprobante</th><th class="n">Importe</th></tr></thead><tbody>
    ${o.imputaciones.map(i => `<tr><td>${esc(i.descripcion)}</td><td class="n">${pesos(i.importe)}</td></tr>`).join("")}</tbody></table>
    <h3>Se paga con</h3><table><thead><tr><th>Medio</th><th>Detalle</th><th class="n">Importe</th></tr></thead><tbody>
    ${o.medios.map(m => `<tr><td>${MEDIOS[m.medio]}</td><td>${esc(m.referencia ?? "")}</td><td class="n">${pesos(m.importe)}</td></tr>`).join("")}</tbody></table>
    <p class="total">Total ${pesos(o.total)}</p>${o.notas ? `<p class="notas">${esc(o.notas)}</p>` : ""}
    <div class="firmas"><div>Entregó</div><div>Recibí conforme (firma y aclaración)</div></div>
    <footer>Documento no válido como factura.</footer></section>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Orden de pago ${numero}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#111;font:11px/1.4 Arial,Helvetica,sans-serif}
    .hoja{position:relative;min-height:265mm;display:flex;flex-direction:column;gap:10px;border:1px solid #111;padding:16px;page-break-after:always}
    .hoja:last-child{page-break-after:auto}.copia{position:absolute;top:-1px;right:-1px;margin:0;padding:2px 8px;border:1px solid #111;font-size:9px;font-weight:700;letter-spacing:.12em}
    header{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #111;padding-bottom:10px}h1{margin:0 0 4px;font-size:16px}h2{margin:0;font-size:18px;letter-spacing:.08em}
    header p{margin:1px 0}.dato{text-align:right}.numero{font-size:13px;font-weight:700}.prov span{display:block;font-size:8.5px;color:#555;text-transform:uppercase;letter-spacing:.06em}
    .prov strong{font-size:13px}h3{margin:6px 0 0;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    table{width:100%;border-collapse:collapse}th{font-size:9px;text-transform:uppercase;text-align:left;border-bottom:1px solid #111;padding:5px 8px;background:#f3f3f3}
    td{padding:5px 8px;border-bottom:1px solid #ddd}.n{text-align:right;font-variant-numeric:tabular-nums}
    .total{margin:4px 0 0;text-align:right;font-size:14px;font-weight:700}.notas{margin:0;color:#333}
    .firmas{margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:40px;padding-top:40px}.firmas div{border-top:1px solid #111;padding-top:3px;text-align:center;font-size:9px}
    footer{text-align:center;font-size:10px;border-top:1px solid #111;padding-top:6px}
  </style></head><body>${hoja("ORIGINAL")}${hoja("DUPLICADO")}${(o.retenciones ?? []).map(r => certificadoDeRetencion(o, r, emisor, "ORIGINAL") + certificadoDeRetencion(o, r, emisor, "DUPLICADO")).join("")}</body></html>`;
}
