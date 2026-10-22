/**
 * Remitos de entrega (2026-10-22). Ver la migración 20261022000400.
 *
 * El circuito mayorista es presupuesto → venta → remito → factura → cobro. El
 * remito documenta qué salió, a quién y cuándo; una venta se puede entregar en
 * varios viajes y cada remito descuenta de lo pendiente. Acá vive lo que no
 * depende de la base: cuánto falta entregar, el número, la letra y el papel.
 *
 * «R» con CAI vigente (talonario autorizado por ARCA, código 91); «X» sin CAI,
 * que vale como constancia de entrega pero no ampara el traslado.
 */
import { escapePrintHtml as esc } from "@/lib/saleReceipt";
import { condicionIvaLabel, fechaFiscalArgentina, numeroFiscal } from "@/lib/arcaInvoice";
import { formatearCuit, validarCuit, validarDni } from "@/lib/fiscalIdentity";
import { csvCell } from "@/lib/csv";

export type EstadoRemito = "emitido" | "entregado" | "anulado";

export interface RemitoItem {
  id?: string;
  sale_id: string | null;
  product_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

export interface Remito {
  id: string;
  punto_venta: number;
  numero: number;
  letra: "R" | "X";
  cai: string | null;
  cai_vence: string | null;
  fecha: string;
  sale_transaction_id: string | null;
  customer_id: string | null;
  cliente_nombre: string;
  cliente_cuit: string | null;
  cliente_domicilio: string | null;
  transportista: string | null;
  bultos: number | null;
  valor_declarado: number | null;
  observaciones: string | null;
  estado: EstadoRemito;
  entregado_at: string | null;
  recibio_nombre: string | null;
  recibio_dni: string | null;
  anulado_at: string | null;
  anulado_motivo: string | null;
  created_at: string;
  remito_items: RemitoItem[];
}

export interface Talonario {
  punto_venta: number;
  proximo_numero: number;
  cai: string | null;
  cai_vence: string | null;
}

export interface EmisorDelRemito {
  nombre: string;
  razonSocial?: string | null;
  cuit?: string | null;
  domicilio?: string | null;
  tipoEmisor?: string | null;
  ingresosBrutos?: string | null;
  inicioActividades?: string | null;
}

export const ESTADOS_REMITO: Record<EstadoRemito, { label: string; tono: "info" | "ok" | "neutro" }> = {
  emitido: { label: "En camino", tono: "info" },
  entregado: { label: "Entregado", tono: "ok" },
  anulado: { label: "Anulado", tono: "neutro" },
};

export const UNIDADES = ["un", "kg", "g", "l", "m", "m²", "m³", "caja", "bulto", "par", "docena"] as const;

/** 00001-00000001, como lo pide ARCA desde la RG 4291. */
export function numeroDeRemito(puntoVenta: number, numero: number): string {
  return numeroFiscal(puntoVenta, numero) ?? `${puntoVenta}-${numero}`;
}

/** El mismo código corto que muestra Ventas: los últimos 8 caracteres del id. */
export const codigoDeVenta = (id: string) => id.slice(-8).toUpperCase();

const tresDecimales = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;

export function cantidadLegible(n: number): string {
  return tresDecimales(n).toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

// ── Pendiente de entrega ───────────────────────────────────────────────────

export interface LineaVendida {
  id: string;
  product_name?: string | null;
  quantity?: number | null;
  returned_quantity?: number | null;
}

export interface LineaPendiente {
  saleId: string;
  descripcion: string;
  vendido: number;
  devuelto: number;
  remitido: number;
  pendiente: number;
}

/**
 * Lo que falta entregar de cada renglón: vendido − devuelto − remitido (los
 * remitos anulados no cuentan). Es la misma cuenta que hace `emitir_remito`;
 * la base es la que manda, esto es para mostrarlo antes de mandar.
 */
export function pendientesDeEntrega(
  lineas: LineaVendida[],
  remitos: Pick<Remito, "estado" | "remito_items">[],
): LineaPendiente[] {
  const remitido = new Map<string, number>();
  for (const r of remitos) {
    if (r.estado === "anulado") continue;
    for (const it of r.remito_items ?? []) {
      if (!it.sale_id) continue;
      remitido.set(it.sale_id, (remitido.get(it.sale_id) ?? 0) + Number(it.cantidad || 0));
    }
  }
  return lineas.map(l => {
    const vendido = tresDecimales(Number(l.quantity ?? 0));
    const devuelto = tresDecimales(Number(l.returned_quantity ?? 0));
    const yaRemitido = tresDecimales(remitido.get(l.id) ?? 0);
    return {
      saleId: l.id,
      descripcion: l.product_name?.trim() || "Producto",
      vendido,
      devuelto,
      remitido: yaRemitido,
      pendiente: Math.max(0, tresDecimales(vendido - devuelto - yaRemitido)),
    };
  });
}

export type EstadoDeEntrega = "sin_remitir" | "parcial" | "completa" | "nada_que_entregar";

export function estadoDeEntrega(pendientes: LineaPendiente[]): EstadoDeEntrega {
  const aEntregar = pendientes.reduce((s, p) => s + Math.max(0, p.vendido - p.devuelto), 0);
  if (aEntregar <= 0) return "nada_que_entregar";
  const remitido = pendientes.reduce((s, p) => s + p.remitido, 0);
  const pendiente = pendientes.reduce((s, p) => s + p.pendiente, 0);
  if (pendiente <= 0) return "completa";
  return remitido > 0 ? "parcial" : "sin_remitir";
}

export const TEXTO_ESTADO_DE_ENTREGA: Record<EstadoDeEntrega, string> = {
  sin_remitir: "Sin remitir",
  parcial: "Entrega parcial",
  completa: "Entregada completa",
  nada_que_entregar: "Nada que entregar",
};

// ── Talonario ──────────────────────────────────────────────────────────────

/** ¿Con este talonario el remito de esta fecha sale «R»? La base decide igual. */
export function letraDelRemito(t: Pick<Talonario, "cai" | "cai_vence"> | null, fecha: string): "R" | "X" {
  return t?.cai && t.cai_vence && t.cai_vence >= fecha ? "R" : "X";
}

export type AvisoDelCai = { tono: "error" | "aviso"; texto: string } | null;

/** El CAI vence: avisar antes, y decir qué pasa si se vence. */
export function avisoDelCai(t: Pick<Talonario, "cai" | "cai_vence"> | null, hoy: string): AvisoDelCai {
  if (!t?.cai || !t.cai_vence) return null;
  if (t.cai_vence < hoy) {
    return { tono: "error", texto: `El CAI venció el ${fechaFiscalArgentina(t.cai_vence)}: los remitos salen «X» hasta que cargues uno nuevo.` };
  }
  const dias = Math.round((Date.parse(`${t.cai_vence}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86_400_000);
  if (dias <= 15) {
    return { tono: "aviso", texto: `El CAI vence ${dias === 0 ? "hoy" : `en ${dias} ${dias === 1 ? "día" : "días"}`}. Pedí el nuevo en ARCA para no quedarte sin remitos «R».` };
  }
  return null;
}

export interface FormularioTalonario { puntoVenta: string; cai: string; caiVence: string; proximoNumero: string }

export function erroresDelTalonario(f: FormularioTalonario, minimo: number): string[] {
  const pv = Number(f.puntoVenta);
  const cai = f.cai.replace(/\D/g, "");
  const proximo = f.proximoNumero.trim() ? Number(f.proximoNumero) : null;
  return [
    !(Number.isInteger(pv) && pv >= 1 && pv <= 99999) && "El punto de venta va de 1 a 99999.",
    cai && cai.length !== 14 && "El CAI tiene 14 dígitos.",
    Boolean(cai) !== Boolean(f.caiVence) && "El CAI y su vencimiento van juntos.",
    proximo !== null && !(Number.isInteger(proximo) && proximo >= 1) && "El próximo número tiene que ser un entero mayor a cero.",
    proximo !== null && proximo < minimo && `El próximo número no puede ser menor a ${minimo}: ya se emitió el ${minimo - 1}.`,
  ].filter(Boolean) as string[];
}

// ── Emitir ─────────────────────────────────────────────────────────────────

export interface RenglonDelFormulario {
  saleId: string | null;
  descripcion: string;
  cantidad: string;
  unidad: string;
  /** Tope cuando sale de una venta. */
  pendiente: number | null;
}

export interface FormularioRemito {
  fecha: string;
  clienteNombre: string;
  clienteCuit: string;
  clienteDomicilio: string;
  transportista: string;
  bultos: string;
  valorDeclarado: string;
  observaciones: string;
  renglones: RenglonDelFormulario[];
}

/** «1.234,5» o «1234.5» → 1234.5. Vacío o inválido → NaN. */
export function leerCantidad(texto: string): number {
  const t = texto.trim().replace(/\s/g, "");
  if (!t) return NaN;
  const normalizado = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^\d+(\.\d+)?$/.test(normalizado) ? Number(normalizado) : NaN;
}

export function erroresDelRemito(f: FormularioRemito): string[] {
  const conCantidad = f.renglones.filter(r => r.cantidad.trim() !== "");
  const errores: (string | false)[] = [
    !f.clienteNombre.trim() && "Falta a quién se entrega.",
    f.clienteCuit.trim() !== "" && !validarCuit(f.clienteCuit) && !validarDni(f.clienteCuit) && "El CUIT o DNI del cliente no es válido.",
    conCantidad.length === 0 && "Indicá qué cantidad se entrega en al menos un renglón.",
    f.bultos.trim() !== "" && !(Number.isInteger(Number(f.bultos)) && Number(f.bultos) > 0) && "Los bultos son un número entero.",
    f.valorDeclarado.trim() !== "" && !(leerCantidad(f.valorDeclarado) >= 0) && "El valor declarado no es un importe válido.",
  ];
  f.renglones.forEach((r, i) => {
    if (r.cantidad.trim() === "") return;
    const n = leerCantidad(r.cantidad);
    const nombre = r.descripcion.trim() || `Renglón ${i + 1}`;
    if (!(n > 0)) errores.push(`${nombre}: la cantidad tiene que ser mayor a cero.`);
    else if (r.pendiente !== null && n > r.pendiente + 0.0005) errores.push(`${nombre}: quedan ${cantidadLegible(r.pendiente)} por entregar.`);
    if (!r.saleId && !r.descripcion.trim()) errores.push(`Renglón ${i + 1}: falta qué se entrega.`);
  });
  return errores.filter(Boolean) as string[];
}

/** Lo que recibe `emitir_remito`. Los renglones sin cantidad no viajan. */
export function datosParaEmitir(f: FormularioRemito, extra: { saleTransactionId?: string | null; customerId?: string | null }) {
  const cuit = f.clienteCuit.replace(/\D/g, "");
  const valor = leerCantidad(f.valorDeclarado);
  return {
    fecha: f.fecha,
    sale_transaction_id: extra.saleTransactionId ?? null,
    customer_id: extra.customerId ?? null,
    cliente_nombre: f.clienteNombre.trim(),
    cliente_cuit: cuit || null,
    cliente_domicilio: f.clienteDomicilio.trim() || null,
    transportista: f.transportista.trim() || null,
    bultos: f.bultos.trim() ? Number(f.bultos) : null,
    valor_declarado: Number.isFinite(valor) ? valor : null,
    observaciones: f.observaciones.trim() || null,
    items: f.renglones
      .filter(r => r.cantidad.trim() !== "")
      .map(r => ({
        ...(r.saleId ? { sale_id: r.saleId } : {}),
        descripcion: r.descripcion.trim() || null,
        cantidad: leerCantidad(r.cantidad),
        unidad: r.unidad || "un",
      })),
  };
}

/**
 * Los errores de las funciones vienen en castellano y pensados para mostrarse
 * (22023, 42501). Lo demás es técnico: no se le muestra al comercio tal cual.
 */
export function mensajeDeRemito(error: { code?: string; message?: string } | null, accion: string): string {
  if (!error) return `No se pudo ${accion}.`;
  if (error.code === "22023" || error.code === "42501" || error.code === "P0001") return error.message ?? `No se pudo ${accion}.`;
  if (/failed to fetch|network|load failed/i.test(error.message ?? "")) {
    return `Sin conexión: no se pudo ${accion}. Revisá internet y probá de nuevo.`;
  }
  return `No se pudo ${accion}. Probá de nuevo en unos minutos.`;
}

// ── Exportar ───────────────────────────────────────────────────────────────

/** CSV con «;»: es el separador que espera Excel en castellano. */
export function remitosCsv(remitos: Remito[]): string {
  const cabecera = ["Letra", "Número", "Fecha", "Cliente", "CUIT/DNI", "Domicilio de entrega", "Detalle", "Transportista", "Bultos",
    "Valor declarado", "Estado", "Recibió", "DNI de quien recibió", "Entregado el", "Motivo de anulación"];
  const filas = remitos.map(r => [
    r.letra, numeroDeRemito(r.punto_venta, r.numero), fechaFiscalArgentina(r.fecha), r.cliente_nombre, r.cliente_cuit ?? "",
    r.cliente_domicilio ?? "", r.remito_items.map(it => `${cantidadLegible(it.cantidad)} ${it.unidad} ${it.descripcion}`).join(" | "),
    r.transportista ?? "", r.bultos ?? "", r.valor_declarado === null ? "" : String(r.valor_declarado).replace(".", ","),
    ESTADOS_REMITO[r.estado].label, r.recibio_nombre ?? "", r.recibio_dni ?? "",
    r.entregado_at ? fechaFiscalArgentina(r.entregado_at.slice(0, 10)) : "", r.anulado_motivo ?? "",
  ].map(csvCell).join(";"));
  return [cabecera.map(csvCell).join(";"), ...filas].join("\r\n");
}

// ── Papel ──────────────────────────────────────────────────────────────────

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

function hojaDelRemito(r: Remito, e: EmisorDelRemito, copia: string): string {
  const esR = r.letra === "R";
  const cuitEmisor = e.cuit ? formatearCuit(e.cuit) : "";
  const filas = r.remito_items.map(it => `
      <tr><td class="n">${esc(cantidadLegible(it.cantidad))}</td><td>${esc(it.unidad)}</td><td>${esc(it.descripcion)}</td></tr>`).join("");
  const vacias = Math.max(0, 8 - r.remito_items.length);
  const relleno = Array.from({ length: vacias }, () => `<tr class="vacia"><td></td><td></td><td></td></tr>`).join("");
  const transporte = [
    r.transportista && `<div><span>Transportista</span><strong>${esc(r.transportista)}</strong></div>`,
    r.bultos && `<div><span>Bultos</span><strong>${esc(r.bultos)}</strong></div>`,
    r.valor_declarado !== null && r.valor_declarado !== undefined && `<div><span>Valor declarado</span><strong>${esc(ars(Number(r.valor_declarado)))}</strong></div>`,
  ].filter(Boolean).join("");
  return `
  <section class="hoja">
    ${r.estado === "anulado" ? `<div class="sello">ANULADO</div>` : ""}
    <p class="copia">${esc(copia)}</p>
    <header class="cabecera">
      <div class="emisor">
        <h1>${esc(e.razonSocial || e.nombre)}</h1>
        ${e.razonSocial && e.razonSocial !== e.nombre ? `<p>${esc(e.nombre)}</p>` : ""}
        ${e.domicilio ? `<p>${esc(e.domicilio)}</p>` : ""}
        ${e.tipoEmisor ? `<p>${esc(condicionIvaLabel(e.tipoEmisor))}</p>` : ""}
      </div>
      <div class="letra"><strong>${esc(r.letra)}</strong>${esR ? "<span>COD. 91</span>" : ""}</div>
      <div class="datos">
        <h2>REMITO</h2>
        <p class="numero">N.º ${esc(numeroDeRemito(r.punto_venta, r.numero))}</p>
        <p>Fecha: ${esc(fechaFiscalArgentina(r.fecha))}</p>
        ${cuitEmisor ? `<p>CUIT: ${esc(cuitEmisor)}</p>` : ""}
        ${e.ingresosBrutos ? `<p>Ingresos Brutos: ${esc(e.ingresosBrutos)}</p>` : ""}
        ${e.inicioActividades ? `<p>Inicio de actividades: ${esc(fechaFiscalArgentina(e.inicioActividades))}</p>` : ""}
      </div>
    </header>
    <div class="cliente">
      <div><span>Señor(es)</span><strong>${esc(r.cliente_nombre)}</strong></div>
      <div><span>${r.cliente_cuit && r.cliente_cuit.length === 11 ? "CUIT" : "Documento"}</span><strong>${esc(r.cliente_cuit ? formatearCuit(r.cliente_cuit) : "—")}</strong></div>
      <div class="ancho"><span>Domicilio de entrega</span><strong>${esc(r.cliente_domicilio || "—")}</strong></div>
    </div>
    <table>
      <thead><tr><th class="n">Cantidad</th><th>Unidad</th><th>Descripción</th></tr></thead>
      <tbody>${filas}${relleno}</tbody>
    </table>
    ${transporte ? `<div class="transporte">${transporte}</div>` : ""}
    ${r.observaciones ? `<p class="obs"><span>Observaciones:</span> ${esc(r.observaciones)}</p>` : ""}
    <div class="conforme">
      <p class="titulo">Recibí conforme</p>
      <div class="firmas"><div>Firma</div><div>Aclaración</div><div>DNI</div><div>Fecha</div></div>
    </div>
    <footer>
      ${esR
        ? `<p><strong>CAI N.º ${esc(r.cai)}</strong> · Fecha de vencimiento: ${esc(fechaFiscalArgentina(r.cai_vence))}</p>`
        : `<p><strong>Documento no válido como factura.</strong> Constancia de entrega sin CAI.</p>`}
    </footer>
  </section>`;
}

/** Original y duplicado, una hoja A4 cada uno. */
export function remitoHtml(r: Remito, emisor: EmisorDelRemito): string {
  const numero = numeroDeRemito(r.punto_venta, r.numero);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Remito ${esc(r.letra)} ${esc(numero)}</title>
  <style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#111;font:11px/1.35 Arial,Helvetica,sans-serif}
    .hoja{position:relative;min-height:270mm;display:flex;flex-direction:column;border:1px solid #111;padding:0;page-break-after:always}
    .hoja:last-child{page-break-after:auto}
    .copia{position:absolute;top:-1px;right:-1px;margin:0;padding:2px 8px;border:1px solid #111;font-size:9px;font-weight:700;letter-spacing:.12em}
    .cabecera{display:grid;grid-template-columns:1fr 64px 1fr;border-bottom:1px solid #111}
    .emisor,.datos{padding:14px 14px 10px}.emisor h1{margin:0 0 4px;font-size:16px}.emisor p,.datos p{margin:1px 0}
    .datos h2{margin:0;font-size:18px;letter-spacing:.08em}.numero{font-size:13px;font-weight:700}
    .letra{display:flex;flex-direction:column;align-items:center;border-left:1px solid #111;border-right:1px solid #111;border-bottom:1px solid #111;height:64px;background:#fff}
    .letra strong{font-size:34px;line-height:46px}.letra span{font-size:8px;font-weight:700}
    .cliente{display:grid;grid-template-columns:2fr 1fr;gap:6px 16px;padding:10px 14px;border-bottom:1px solid #111}
    .cliente .ancho{grid-column:1/-1}.cliente span,.transporte span{display:block;font-size:8.5px;color:#555;text-transform:uppercase;letter-spacing:.06em}
    .cliente strong{font-size:12px}
    table{width:100%;border-collapse:collapse}th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;text-align:left;border-bottom:1px solid #111;padding:6px 10px;background:#f3f3f3}
    td{padding:6px 10px;border-bottom:1px solid #ddd;vertical-align:top}th:first-child,td:first-child{width:90px}th:nth-child(2),td:nth-child(2){width:70px}
    .n{text-align:right;font-variant-numeric:tabular-nums}.vacia td{height:22px}
    .transporte{display:flex;gap:28px;padding:10px 14px;border-top:1px solid #111}.transporte strong{font-size:12px}
    .obs{margin:0;padding:8px 14px;border-top:1px solid #ddd}.obs span{font-weight:700}
    .conforme{margin-top:auto;padding:10px 14px 4px;border-top:1px solid #111}.conforme .titulo{margin:0 0 30px;font-weight:700}
    .firmas{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}.firmas div{border-top:1px solid #111;padding-top:3px;text-align:center;font-size:9px}
    footer{padding:8px 14px;border-top:1px solid #111;text-align:center;font-size:10px}footer p{margin:0}
    .sello{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:96px;font-weight:900;color:rgba(200,0,0,.18);letter-spacing:.1em;pointer-events:none}
  </style></head><body>
    ${hojaDelRemito(r, emisor, "ORIGINAL")}
    ${hojaDelRemito(r, emisor, "DUPLICADO")}
  </body></html>`;
}

/**
 * La ventana se abre en el clic, antes de esperar a la base: abierta después
 * de un `await`, el navegador la bloquea como emergente.
 */
export function abrirVentanaDeRemito(): Window | null {
  const ventana = window.open("", "_blank", "width=820,height=980");
  if (ventana) ventana.document.write(`<!doctype html><meta charset="utf-8"><title>Remito</title><p style="font:14px Arial;padding:24px">Preparando el remito…</p>`);
  return ventana;
}

export function imprimirEnVentana(ventana: Window, r: Remito, emisor: EmisorDelRemito): void {
  ventana.document.open();
  ventana.document.write(remitoHtml(r, emisor));
  ventana.document.close();
  ventana.focus();
  ventana.addEventListener("afterprint", () => ventana.close(), { once: true });
  window.setTimeout(() => ventana.print(), 150);
}

/** Abre la impresión. Se llama desde el clic: si no, el navegador bloquea la ventana. */
export function imprimirRemito(r: Remito, emisor: EmisorDelRemito): void {
  const ventana = abrirVentanaDeRemito();
  if (!ventana) throw new Error("Permití las ventanas emergentes para imprimir el remito.");
  imprimirEnVentana(ventana, r, emisor);
}

/** Enlace para mandar el detalle por WhatsApp (el contacto se elige en WhatsApp). */
export function enlaceWhatsAppDelRemito(r: Remito, emisor: EmisorDelRemito): string {
  return `https://wa.me/?text=${encodeURIComponent(textoDelRemito(r, emisor))}`;
}

export function textoDelRemito(r: Remito, emisor: EmisorDelRemito): string {
  return [
    `*${emisor.razonSocial || emisor.nombre}* — Remito ${r.letra} N.º ${numeroDeRemito(r.punto_venta, r.numero)}`,
    `Para ${r.cliente_nombre}, ${fechaFiscalArgentina(r.fecha)}.`,
    ...r.remito_items.map(it => `• ${cantidadLegible(it.cantidad)} ${it.unidad} — ${it.descripcion}`),
    ...(r.transportista ? [`Transporte: ${r.transportista}${r.bultos ? ` · ${r.bultos} bultos` : ""}`] : []),
  ].join("\n");
}
