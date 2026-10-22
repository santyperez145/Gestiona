/**
 * Recibo de un cobro de cuenta corriente (2026-10-22).
 *
 * El cobro ya se guardaba (`cobros_cuenta_corriente`, con sus imputaciones),
 * pero el cliente se iba sin nada en la mano: ni papel ni mensaje que diga
 * cuánto pagó, qué se canceló y cuánto le queda. El recibo sale de lo que
 * devolvió la base, no de lo que se tipeó en el formulario.
 *
 * No es un comprobante fiscal: lo dice. La factura, si corresponde, se emite
 * por la venta.
 */
import type { CobroCuentaCorriente } from "@/lib/supabaseStore";
import { escapePrintHtml as esc } from "@/lib/saleReceipt";
import { MEDIOS_DE_COBRO, MEDIO_SALDO_A_FAVOR } from "@/lib/cuentaCorriente";

export interface ReciboDeCobro {
  numero: string;
  fecha: string;
  negocio: { nombre: string; cuit?: string | null };
  cliente: string;
  medio: string;
  imputaciones: { descripcion: string; aplicado: number; saldo: number }[];
  total: number;
  aFavor: number;
  saldoPendiente: number;
  nota?: string | null;
}

const nombreDelMedio = (medio: string) =>
  medio === MEDIO_SALDO_A_FAVOR ? "Saldo a favor" : MEDIOS_DE_COBRO.find(m => m.value === medio)?.label ?? medio;

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
const centavos = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Número corto y estable: el mismo cobro da siempre el mismo número. */
export const numeroDeRecibo = (cobroId: string) => cobroId.replace(/-/g, "").slice(0, 8).toUpperCase();

export function reciboDesdeCobros(
  cobros: CobroCuentaCorriente[],
  datos: { negocio: ReciboDeCobro["negocio"]; cliente: string; medio: string; fecha?: string; nota?: string | null },
): ReciboDeCobro {
  const imputaciones = cobros.flatMap(c => c.imputaciones.map(i => ({
    descripcion: i.descripcion?.trim() || "Deuda",
    aplicado: centavos(i.aplicado),
    saldo: centavos(i.saldo),
  })));
  const ultimo = cobros[cobros.length - 1];
  return {
    numero: cobros.map(c => numeroDeRecibo(c.cobro_id)).join(" · "),
    fecha: datos.fecha ?? new Date().toISOString(),
    negocio: datos.negocio,
    cliente: datos.cliente.trim() || "Cliente",
    medio: nombreDelMedio(datos.medio),
    imputaciones,
    total: centavos(cobros.reduce((s, c) => s + Number(c.aplicado) + Number(c.a_favor ?? 0), 0)),
    aFavor: centavos(cobros.reduce((s, c) => s + Number(c.a_favor ?? 0), 0)),
    saldoPendiente: centavos(ultimo?.saldo_pendiente ?? 0),
    nota: datos.nota?.trim() || null,
  };
}

function cuitConGuiones(cuit?: string | null): string | null {
  const d = String(cuit ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : null;
}

export function reciboHtml(r: ReciboDeCobro): string {
  const cuit = cuitConGuiones(r.negocio.cuit);
  const filas = r.imputaciones.map(i => `
    <tr><td>${esc(i.descripcion)}</td><td class="n">${esc(ars(i.aplicado))}</td><td class="n">${esc(ars(i.saldo))}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibo ${esc(r.numero)}</title>
  <style>
    @page{size:A5;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#111;font:12px/1.4 Arial,sans-serif}
    h1{margin:0;font-size:18px}.meta{color:#555;margin:2px 0}.titulo{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
    .recibo{text-align:right}.recibo strong{font-size:16px;letter-spacing:.05em}table{width:100%;border-collapse:collapse;margin:8px 0}
    th{text-align:left;font-size:10px;color:#555;border-bottom:1px solid #999;padding:4px 0}td{padding:4px 0;border-bottom:1px solid #eee}
    .n{text-align:right;font-variant-numeric:tabular-nums}.total{display:flex;justify-content:space-between;font-size:15px;font-weight:700;margin-top:6px}
    .fila{display:flex;justify-content:space-between;margin:3px 0}.aviso{margin-top:18px;padding-top:8px;border-top:1px dashed #777;text-align:center;font-size:10px;color:#444}
    .firma{margin-top:36px;width:55%;border-top:1px solid #111;text-align:center;font-size:10px;padding-top:3px}
  </style></head><body>
    <div class="titulo">
      <div><h1>${esc(r.negocio.nombre)}</h1>${cuit ? `<p class="meta">CUIT ${esc(cuit)}</p>` : ""}</div>
      <div class="recibo"><strong>RECIBO</strong><p class="meta">N.º ${esc(r.numero)}</p><p class="meta">${esc(new Date(r.fecha).toLocaleDateString("es-AR"))}</p></div>
    </div>
    <p>Recibimos de <strong>${esc(r.cliente)}</strong> la suma de <strong>${esc(ars(r.total))}</strong> en ${esc(r.medio.toLowerCase())}.</p>
    ${r.imputaciones.length ? `<table><thead><tr><th>Aplicado a</th><th class="n">Pagado</th><th class="n">Le queda</th></tr></thead><tbody>${filas}</tbody></table>` : ""}
    ${r.aFavor > 0 ? `<div class="fila"><span>Queda a favor del cliente</span><span class="n">${esc(ars(r.aFavor))}</span></div>` : ""}
    <div class="total"><span>Saldo pendiente total</span><span class="n">${esc(ars(r.saldoPendiente))}</span></div>
    ${r.nota ? `<p class="meta">Nota: ${esc(r.nota)}</p>` : ""}
    <div class="firma">Firma y aclaración</div>
    <p class="aviso">Documento no válido como factura.</p>
  </body></html>`;
}

export function textoDeRecibo(r: ReciboDeCobro): string {
  const lineas = [
    `*${r.negocio.nombre}* — Recibo N.º ${r.numero}`,
    `Recibimos de ${r.cliente} ${ars(r.total)} (${r.medio.toLowerCase()}) el ${new Date(r.fecha).toLocaleDateString("es-AR")}.`,
    ...r.imputaciones.map(i => `• ${i.descripcion}: ${ars(i.aplicado)} (le queda ${ars(i.saldo)})`),
    ...(r.aFavor > 0 ? [`Queda a favor: ${ars(r.aFavor)}`] : []),
    `Saldo pendiente: ${ars(r.saldoPendiente)}`,
    "Documento no válido como factura.",
  ];
  return lineas.join("\n");
}

/** Abre la impresión. Se llama desde el clic: si no, el navegador bloquea la ventana. */
export function imprimirRecibo(r: ReciboDeCobro): void {
  const ventana = window.open("", "_blank", "width=620,height=760");
  if (!ventana) throw new Error("Permití las ventanas emergentes para imprimir el recibo.");
  ventana.document.write(reciboHtml(r));
  ventana.document.close();
  ventana.focus();
  ventana.addEventListener("afterprint", () => ventana.close(), { once: true });
  window.setTimeout(() => ventana.print(), 150);
}

/** Enlace para mandar el recibo por WhatsApp (elegís el contacto en WhatsApp). */
export function enlaceWhatsApp(r: ReciboDeCobro, telefono?: string | null): string {
  const numero = String(telefono ?? "").replace(/\D/g, "");
  return `https://wa.me/${numero}?text=${encodeURIComponent(textoDeRecibo(r))}`;
}

/**
 * Opciones para el aviso de «cobro registrado»: imprimir el recibo o mandarlo
 * por WhatsApp. El formulario se cierra al cobrar, así que el recibo vive en
 * el aviso, que dura más que uno común.
 */
export function avisoConRecibo(r: ReciboDeCobro, alFallar: (mensaje: string) => void) {
  return {
    duration: 20_000,
    action: {
      label: "Imprimir recibo",
      onClick: () => {
        try { imprimirRecibo(r); } catch (e) { alFallar(e instanceof Error ? e.message : "No se pudo abrir el recibo."); }
      },
    },
    cancel: {
      label: "WhatsApp",
      onClick: () => { window.open(enlaceWhatsApp(r), "_blank", "noopener,noreferrer"); },
    },
  };
}
