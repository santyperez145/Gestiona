/**
 * Motor de redacción de campañas de email — sin Anthropic.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 * La IA de campaña llamaba a Anthropic para escribir 3 párrafos de HTML: a
 * escala de pymes ese costo por campaña es insostenible y el proveedor externo
 * agrega una falla más a un flujo ya crítico (envío de correo). La redacción
 * de una campaña pyme es una fórmula: nombre del comercio + producto + precio
 * + vencimiento. Eso se escribe en local, determinístico y gratis.
 *
 * Anthropic queda para lo que sí vale su costo: `ai-analysis` y
 * `ai-brief-generator` de influencers, gated por plan.
 *
 * El texto sale del Business Core real: nombre del comercio, nombre del
 * producto, precio y descuento. Cero copys inventados.
 */

function formatARS(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
}

const FORMATO_FECHA = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "long" });

function fechaCorta(iso: string): string {
  try {
    return FORMATO_FECHA.format(new Date(iso));
  } catch {
    return "";
  }
}

export type CopyCampaignInput = {
  /** Nombre del comercio (settings.business_name). */
  negocio: string;
  /** Tipo de campaña — cada uno tiene estructura propia. */
  tipo: "liquidacion" | "flash" | "recuperacion_carrito" | "novedad" | "reengagement";
  /** Hasta 3 productos reales para nombrar en el cuerpo. */
  productos: Array<{
    nombre: string;
    precio_ars: number;
    precio_oferta_ars?: number | null;
    url_producto?: string | null;
  }>;
  /** Cupón asociado (coupon_code). */
  cupon?: string | null;
  /** Fecha de vencimiento ISO para el copy de urgencia. */
  vence_el?: string | null;
};

export type CopyCampaignOutput = {
  subject: string;
  body_html: string;
  /** Texto que le explica al comercio por qué la máquina eligió ese ángulo. */
  razon: string;
};

function limpiar(texto: string): string {
  return texto.replace(/[&<>"']/g, "");
}

function linkProducto(p: { url_producto?: string | null; nombre: string }): string {
  const nombre = limpiar(p.nombre);
  const url = (p.url_producto ?? "").trim();
  if (!url) return nombre;
  return `<a href="${url}" style="color:#173aef;text-decoration:underline">${nombre}</a>`;
}

/**
 * Redacta asunto + cuerpo HTML según el tipo de campaña, con datos reales.
 * El HTML es simple y robusto: clientes de correo viejos lo renderizan igual.
 */
export function redactarCampana(input: CopyCampaignInput): CopyCampaignOutput {
  const negocio = limpiar(input.negocio || "Nuestro negocio");
  const productos = input.productos.slice(0, 3);
  const lista = productos
    .map((p) => {
      const precio = Number(p.precio_ars) || 0;
      const oferta = Number(p.precio_oferta_ars) || 0;
      const precioHtml = oferta > 0 && oferta < precio
        ? `<span style="color:#888;text-decoration:line-through">${formatARS(precio)}</span> <strong>${formatARS(oferta)}</strong>`
        : `<strong>${formatARS(precio)}</strong>`;
      return `<li style="margin:0 0 8px">${linkProducto(p)} — ${precioHtml}</li>`;
    })
    .join("");
  const cupon = (input.cupon || "").trim();
  const cuponHtml = cupon
    ? `<p style="margin:16px 0 0">Usá el código <strong style="font-family:monospace;background:#f2f4f7;padding:2px 8px;border-radius:6px">${cupon}</strong></p>`
    : "";
  const vence = input.vence_el ? fechaCorta(input.vence_el) : "";
  const urgencia = vence
    ? `<p style="color:#b45309;font-size:13px;margin:16px 0 0">Vigente hasta el ${vence}.</p>`
    : "";

  if (input.tipo === "recuperacion_carrito") {
    const producto = productos[0];
    const nombre = producto ? limpiar(producto.nombre) : "tus productos";
    return {
      subject: `${negocio}: dejaste ${nombre} en tu carrito`,
      razon: "El asunto nombra el producto abandonado: es la señal que abre el mail en una recuperación.",
      body_html:
        `<p>Hola {{nombre}},</p>` +
        `<p>Vimos que dejaste <strong>${nombre}</strong> en el carrito. Queda reservado por poco tiempo.</p>` +
        (lista ? `<ul style="padding-left:18px;margin:12px 0">${lista}</ul>` : "") +
        `<p style="margin:16px 0 0"><a href="{{url_tienda}}" style="background:#173aef;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">Terminar mi compra</a></p>` +
        urgencia,
    };
  }

  if (input.tipo === "flash") {
    const producto = productos[0] ? limpiar(productos[0].nombre) : "Ofertas";
    return {
      subject: `⚡ ${producto} con precio especial — solo hoy`,
      razon: "Las campañas flash convierten por urgencia: el asunto nombra producto y cierra con la ventana corta.",
      body_html:
        `<p>Hola {{nombre}},</p>` +
        `<p>Oferta relámpago de <strong>${negocio}</strong> — por tiempo limitado:</p>` +
        (lista ? `<ul style="padding-left:18px;margin:12px 0">${lista}</ul>` : "") +
        cupon +
        urgencia,
    };
  }

  if (input.tipo === "reengagement") {
    return {
      subject: `${negocio}: te extrañamos 💙`,
      razon: "Reengagement sin descuento agresivo: primero el vínculo, después la oferta.",
      body_html:
        `<p>Hola {{nombre}},</p>` +
        `<p>Hace un tiempo que no nos vemos en <strong>${negocio}</strong>. Tenemos novedades que creemos que te van a interesar:</p>` +
        (lista ? `<ul style="padding-left:18px;margin:12px 0">${lista}</ul>` : "") +
        cupon,
    };
  }

  if (input.tipo === "novedad") {
    return {
      subject: `Novedades en ${negocio} 👀`,
      razon: "La novedad se comunica con el ingreso nuevo, no con descuento.",
      body_html:
        `<p>Hola {{nombre}},</p>` +
        `<p>Ingresaron productos nuevos a <strong>${negocio}</strong>:</p>` +
        (lista ? `<ul style="padding-left:18px;margin:12px 0">${lista}</ul>` : "") +
        cupon,
    };
  }

  // liquidación
  const descuentoMax = productos.reduce((max, p) => {
    const precio = Number(p.precio_ars) || 0;
    const oferta = Number(p.precio_oferta_ars) || 0;
    const pct = precio > 0 && oferta > 0 && oferta < precio ? Math.round((1 - oferta / precio) * 100) : 0;
    return Math.max(max, pct);
  }, 0);
  return {
    subject: `Liquidación en ${negocio}${descuentoMax > 0 ? ` — hasta ${descuentoMax}% off` : ""}`,
    razon: "La liquidación convierte por descuento: el asunto lidera con el % máximo real del surtido.",
    body_html:
      `<p>Hola {{nombre}},</p>` +
      `<p>Estamos liquidando stock seleccionado de <strong>${negocio}</strong>. Precios con descuento real:</p>` +
      (lista ? `<ul style="padding-left:18px;margin:12px 0">${lista}</ul>` : "") +
      cupon +
      urgencia,
  };
}