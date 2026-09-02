/** La opción de retiro no necesita domicilio; cualquier entrega sí. */
export interface CheckoutDeliveryOption {
  carrier: string;
  option_id?: string;
}

/**
 * Antes de que llegue la cotización sólo se puede omitir el domicilio si el
 * comercio tiene retiro habilitado: ésa es la única opción que puede aparecer
 * sin provincia. Una vez elegida una opción, manda su carrier real.
 */
export function requiereDireccionDeEntrega(
  option: CheckoutDeliveryOption | null,
  pickupEnabled: boolean,
): boolean {
  if (option) return option.carrier !== "retiro";
  return !pickupEnabled;
}

export type DecisionEntregaCheckout = {
  /** Se muestra; no apaga Confirmar. */
  info: string | null;
  /** Impide confirmar. */
  bloqueo: string | null;
};

/**
 * Shopify / Tiendanube cotizan después de la ubicación: si no hay domicilio
 * y sí hay retiro, informan y dejan cerrar. Medido 2026-09-02: Exentry con
 * Córdoba ponía el aviso en el mismo flag que deshabilita el botón, así que
 * el comprador no podía ni retirar.
 */
export function decisionEntregaCheckout(input: {
  quoting: boolean;
  quoteFailed?: boolean;
  /** El RPC todavía no está: se cobra el envío plano, no es “sin cobertura”. */
  quoteUnavailable?: boolean;
  options: CheckoutDeliveryOption[];
  selectedId: string | null;
  province: string;
  zonesMode: boolean;
}): DecisionEntregaCheckout {
  if (input.quoting) {
    return { info: null, bloqueo: "Esperá a que terminemos de calcular la entrega." };
  }
  if (input.quoteFailed) {
    return { info: null, bloqueo: "No pudimos calcular el envío. Probá de nuevo en un momento." };
  }
  if (input.quoteUnavailable) {
    return { info: null, bloqueo: null };
  }

  const provincia = String(input.province ?? "").trim();
  const selected = input.options.find((o) => o.option_id === input.selectedId) ?? null;
  const hayRetiro = input.options.some((o) => o.carrier === "retiro");
  const hayDomicilio = input.options.some((o) => o.carrier !== "retiro");

  if (input.zonesMode && provincia && hayRetiro && !hayDomicilio) {
    const aviso = "A domicilio no llega a tu provincia. Podés retirar en tienda.";
    if (selected?.carrier === "retiro") {
      return { info: aviso, bloqueo: null };
    }
    if (input.selectedId) {
      return {
        info: aviso,
        bloqueo: "A domicilio no llega a tu provincia. Elegí retiro en tienda.",
      };
    }
    return { info: aviso, bloqueo: "Elegí cómo recibir el pedido." };
  }

  if (input.zonesMode && provincia && input.options.length === 0) {
    return { info: null, bloqueo: "Todavía no hacemos envíos a esa provincia." };
  }

  if (input.zonesMode && !provincia && input.options.length === 0) {
    return {
      info: null,
      bloqueo: "Elegí tu provincia para ver las formas de envío y su costo.",
    };
  }

  if (input.options.length > 0 && !selected) {
    return { info: null, bloqueo: "Elegí cómo recibir el pedido." };
  }

  if (input.selectedId && !selected) {
    return { info: null, bloqueo: "Elegí una forma de entrega disponible." };
  }

  return { info: null, bloqueo: null };
}

export function puedeConfirmarEntrega(
  input: Parameters<typeof decisionEntregaCheckout>[0],
): boolean {
  return decisionEntregaCheckout(input).bloqueo == null;
}
