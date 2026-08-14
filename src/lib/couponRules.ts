/**
 * Reglas de cupones — A4 del ROADMAP.
 *
 * ── Qué faltaba ───────────────────────────────────────────────────────────
 *
 * `coupons` tenía `max_uses` global y `current_uses`, y nada más. Sin mínimo de
 * compra y sin límite por persona:
 *
 * - Un cupón de **$10.000 fijo** se usaba en una compra de $12.000. El comercio
 *   regala el 83% de la venta.
 * - Sin límite por persona, **una sola** persona lo usa las veinte veces del
 *   tope global. El cupón que era para captar veinte clientes captó uno.
 *
 * ── Contra qué se mide el mínimo ──────────────────────────────────────────
 *
 * Contra la **mercadería**, no contra el total. Si se midiera contra el total
 * con envío, un cupón de "mínimo $50.000" se activaría con $38.000 de productos
 * y $12.000 de flete — y el comercio estaría subsidiando el envío para llegar a
 * su propio piso.
 *
 * Y se mide **antes** del propio cupón, obviamente, pero **después** de las
 * promociones de precio: la promo "llevando 2" es un precio, no una rebaja, así
 * que lo que el comprador realmente gasta en mercadería ya la tiene aplicada.
 *
 * ── Quién es "la misma persona" ───────────────────────────────────────────
 *
 * El email normalizado. Es lo único que tiene un comprador sin cuenta, y es el
 * mismo criterio con el que el CRM cruza filas sin `customer_id`. No es
 * infalible —alguien puede usar otro email— pero frena el caso real, que es la
 * misma persona usando el mismo cupón cinco veces seguidas.
 *
 * El número que manda lo calcula la base; esto es el espejo para que el
 * checkout pueda decir "te faltan $X" antes de mandar el pedido.
 */

export interface ReglasCupon {
  /** Compra mínima de mercadería. `null` o 0 = sin mínimo. */
  minimoCompra?: number | null;
  /** Cuántas veces puede usarlo la misma persona. `null` = sin límite. */
  maxPorPersona?: number | null;
  /** Tope global del cupón. `null` = sin tope. */
  maxUsos?: number | null;
  usosActuales?: number | null;
  /** Descuento porcentual sobre la mercadería. */
  descuentoPct?: number | null;
  /** Descuento en pesos sobre la mercadería. Se ignora si hay porcentaje. */
  descuentoFijo?: number | null;
  /** A5: el cupón bonifica el envío. */
  bonificaEnvio?: boolean;
  /** Hasta cuánto bonifica. `null` = el envío completo. */
  topeEnvio?: number | null;
}

export type MotivoRechazo =
  | "minimo_no_alcanzado"
  | "limite_por_persona"
  | "limite_global"
  | "sin_efecto";

export interface EvaluacionCupon {
  aplica: boolean;
  motivo?: MotivoRechazo;
  /** Cuánto falta para llegar al mínimo. Sólo si el motivo es el mínimo. */
  faltan?: number;
}

/**
 * ¿Se puede usar este cupón?
 *
 * El orden de los chequeos es el orden en que le sirven al comprador: primero
 * lo que puede resolver —agregar productos para llegar al mínimo— y después lo
 * que no. Decirle "alcanzaste el límite" a alguien que además no llega al
 * mínimo lo manda a un callejón sin salida.
 */
export function evaluarCupon(
  subtotalMercaderia: number,
  usosDeEstaPersona: number,
  reglas: ReglasCupon | null | undefined,
): EvaluacionCupon {
  const sub = Number(subtotalMercaderia);
  const base = Number.isFinite(sub) && sub > 0 ? sub : 0;

  const minimo = Number(reglas?.minimoCompra) || 0;
  if (minimo > 0 && base < minimo) {
    return {
      aplica: false,
      motivo: "minimo_no_alcanzado",
      faltan: Math.round(minimo - base),
    };
  }

  const porPersona = Number(reglas?.maxPorPersona);
  const usados = Number(usosDeEstaPersona) || 0;
  if (Number.isFinite(porPersona) && porPersona > 0 && usados >= porPersona) {
    return { aplica: false, motivo: "limite_por_persona" };
  }

  const global = Number(reglas?.maxUsos);
  const actuales = Number(reglas?.usosActuales) || 0;
  if (Number.isFinite(global) && global > 0 && actuales >= global) {
    return { aplica: false, motivo: "limite_global" };
  }

  return { aplica: true };
}

export interface EfectoCupon {
  /** Lo que descuenta de mercadería. */
  mercaderia: number;
  /** Lo que bonifica de envío — es plata que absorbe el comercio. */
  envio: number;
  /** La suma: lo que el cupón le cuesta al comercio en este pedido. */
  total: number;
}

/**
 * Cuánto hace el cupón en este pedido — A5.
 *
 * ── Por qué el envío va aparte y no como un descuento más ─────────────────
 *
 * Porque no es lo mismo. El descuento de mercadería sale del margen; la
 * bonificación de envío es plata que igual hay que pagarle al correo. Sumarlos
 * en un solo número deja al comercio sin saber cuál de los dos le costó la
 * venta, y descuadra el IVA: la base imponible es lo que el comprador paga.
 *
 * Por eso el envío se descuenta del propio envío —el comprador ve "Gratis"— y
 * lo bonificado queda anotado aparte.
 *
 * ── El tope ───────────────────────────────────────────────────────────────
 *
 * Un "envío gratis" sin tope a Tierra del Fuego puede costar más que la venta.
 * `topeEnvio` bonifica hasta ese monto y el resto lo paga el comprador, que es
 * como lo hace MercadoLibre. Sin tope se bonifica todo.
 */
export function calcularEfecto(
  reglas: ReglasCupon | null | undefined,
  subtotalMercaderia: number,
  costoEnvio = 0,
): EfectoCupon {
  const sub = Number(subtotalMercaderia);
  const base = Number.isFinite(sub) && sub > 0 ? sub : 0;
  const envioBruto = Number(costoEnvio);
  const flete = Number.isFinite(envioBruto) && envioBruto > 0 ? envioBruto : 0;

  const pct = Number(reglas?.descuentoPct) || 0;
  const fijo = Number(reglas?.descuentoFijo) || 0;

  let mercaderia = 0;
  if (pct > 0) mercaderia = Math.round((base * pct) / 100);
  else if (fijo > 0) mercaderia = Math.min(fijo, base);

  // El fijo nunca supera la mercadería: un cupón de $10.000 en una compra de
  // $8.000 no puede devolver plata.
  mercaderia = Math.min(mercaderia, base);

  let envio = 0;
  if (reglas?.bonificaEnvio) {
    const tope = Number(reglas.topeEnvio);
    envio = Number.isFinite(tope) && tope > 0 ? Math.min(flete, tope) : flete;
  }

  return { mercaderia, envio, total: mercaderia + envio };
}

/** Qué se le dice al comprador. Sin jerga y sin culparlo. */
export function mensajeRechazo(
  e: EvaluacionCupon,
  fmt: (n: number) => string,
): string | null {
  if (e.aplica) return null;
  switch (e.motivo) {
    case "minimo_no_alcanzado":
      return `Te faltan ${fmt(e.faltan ?? 0)} para poder usar este cupón`;
    case "limite_por_persona":
      return "Ya usaste este cupón el máximo de veces";
    case "limite_global":
      return "El cupón alcanzó su límite de usos";
    // A5: un cupón de envío gratis sobre un pedido que ya tiene el envío en
    // cero no descuenta nada. Se avisa en vez de aceptarlo: aceptarlo lo
    // consumiría a cambio de nada y el comprador no lo podría usar después.
    case "sin_efecto":
      return "Este cupón bonifica el envío y tu pedido no tiene costo de envío";
    default:
      return "El cupón no se puede usar en este pedido";
  }
}

/**
 * Normaliza el email para contar usos por persona.
 *
 * Minúsculas y sin espacios. No se tocan los puntos ni el `+`: son parte de la
 * dirección para muchos proveedores, y "normalizarlos" fusionaría cuentas de
 * personas distintas — que es peor que dejar pasar un uso de más.
 */
export function normalizarEmail(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim().toLowerCase();
  return e === "" ? null : e;
}
