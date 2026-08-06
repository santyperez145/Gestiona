/**
 * Desglose de IVA — A3 del ROADMAP.
 *
 * ── Qué estaba mal ────────────────────────────────────────────────────────
 *
 * `ecommerce_orders.tax_amount` se insertaba con el literal `0`. Verificado
 * contra producción: **6 órdenes, $1.549.574 facturados, IVA cero en todas**.
 * Con la organización configurada en 21% y precios IVA incluido, eso son unos
 * $268.900 de IVA que la orden no discrimina.
 *
 * No es un número decorativo: sin discriminarlo no se puede emitir la factura
 * desde la orden, que es el bloqueo del circuito AFIP entero.
 *
 * ── Las dos formas de cotizar, y por qué importa cuál ─────────────────────
 *
 * En Argentina el precio al consumidor final se muestra **con IVA incluido**
 * (es lo que exige la ley de lealtad comercial). Al responsable inscripto se le
 * discrimina. Son dos cuentas distintas sobre el mismo precio:
 *
 *   incluido:     neto = total / (1 + t)      iva = total − neto
 *   no incluido:  iva  = base × t             total = base + iva
 *
 * Confundirlas es un error de 21% sobre la base imponible, en la dirección
 * equivocada: tomar un precio con IVA incluido y sumarle 21% factura de más.
 *
 * ── El redondeo, que es donde se pierden los centavos ─────────────────────
 *
 * `neto + iva` tiene que dar **exactamente** el total. Si se redondean los dos
 * por separado, la suma se va uno o dos centavos y la factura no cierra contra
 * la orden. Por eso se redondea el neto y el IVA sale por diferencia — nunca al
 * revés.
 */

/** Alícuotas que se usan en Argentina. 21% es la general. */
export const ALICUOTAS_IVA = [0, 10.5, 21, 27] as const;

export interface DesgloseIva {
  /** Base imponible: lo que se factura sin IVA. */
  neto: number;
  /** El IVA en sí. */
  iva: number;
  /** Lo que paga el comprador. `neto + iva`, exacto. */
  total: number;
  /** La alícuota aplicada, para poder mostrarla. */
  tasa: number;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Desglosa un importe en neto e IVA.
 *
 * @param importe  Con IVA incluido o sin él, según `incluido`.
 * @param tasa     Alícuota en porcentaje (21, 10.5…). 0 = exento.
 * @param incluido `true` si `importe` ya trae el IVA adentro.
 *
 * Una tasa 0, negativa o no numérica devuelve todo como neto: un producto
 * exento tiene IVA cero, no IVA desconocido.
 */
export function desglosarIva(
  importe: number,
  tasa: number,
  incluido: boolean,
): DesgloseIva {
  const bruto = Number(importe);
  const t = Number(tasa);

  if (!Number.isFinite(bruto) || bruto <= 0) {
    return { neto: 0, iva: 0, total: 0, tasa: Number.isFinite(t) && t > 0 ? t : 0 };
  }
  if (!Number.isFinite(t) || t <= 0) {
    const v = redondear(bruto);
    return { neto: v, iva: 0, total: v, tasa: 0 };
  }

  if (incluido) {
    const total = redondear(bruto);
    // El neto se redondea y el IVA sale por diferencia: así `neto + iva`
    // siempre da el total sin perder centavos.
    const neto = redondear(total / (1 + t / 100));
    return { neto, iva: redondear(total - neto), total, tasa: t };
  }

  const neto = redondear(bruto);
  const iva = redondear(neto * (t / 100));
  return { neto, iva, total: redondear(neto + iva), tasa: t };
}

export interface ConfiguracionIva {
  /** Si la organización factura con IVA. */
  habilitado: boolean;
  /** Alícuota general de la organización. */
  tasa: number;
  /** Si los precios cargados ya incluyen IVA. */
  preciosIncluyenIva: boolean;
}

/**
 * El IVA contenido en el total de una orden.
 *
 * La base imponible es **todo lo que se cobra**: la mercadería ya con sus
 * descuentos, más el envío. El flete es un servicio gravado al 21% en
 * Argentina; dejarlo afuera subdeclararía el IVA de cada venta con envío.
 *
 * Los descuentos van **antes**: se tributa sobre lo que efectivamente se cobra,
 * no sobre el precio de lista.
 */
export function ivaDeOrden(
  totalCobrado: number,
  config: ConfiguracionIva | null | undefined,
): DesgloseIva {
  if (!config?.habilitado) {
    const v = redondear(Number(totalCobrado) || 0);
    return { neto: v, iva: 0, total: v, tasa: 0 };
  }
  return desglosarIva(totalCobrado, config.tasa, config.preciosIncluyenIva);
}

/**
 * Cómo se muestra en la vitrina.
 *
 * Con precios IVA incluido, al consumidor final **no se le discrimina**: se le
 * dice "IVA incluido" y listo. Discriminar en la vitrina es lo que hacen las
 * tiendas mayoristas, y confunde al comprador minorista.
 */
export function leyendaIva(config: ConfiguracionIva | null | undefined): string | null {
  if (!config?.habilitado || config.tasa <= 0) return null;
  return config.preciosIncluyenIva ? "IVA incluido" : `+ IVA ${config.tasa}%`;
}

/**
 * ¿La alícuota es una de las que existen?
 *
 * Sirve para no guardar un 15% que después no se puede facturar: ARCA acepta
 * las alícuotas de la ley, no cualquier número.
 */
export function alicuotaValida(tasa: number): boolean {
  return (ALICUOTAS_IVA as readonly number[]).includes(Number(tasa));
}
