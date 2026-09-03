/**
 * Rótulo de envío en el carrito (drawer).
 *
 * Shopify/Tiendanube no cierran el flete sin ubicación cuando cotizan por
 * zona/provincia. Con `shipping_mode=zones` (default del 2º comercio) usar
 * `shipping_cost` plano y decir «Gratis» si es 0 miente: el checkout cotiza
 * otra cosa con `quote_store_shipping`.
 */

export type CartShippingDisplay = {
  /** Texto cuando el monto aún no se conoce o es Gratis. */
  label: string;
  /**
   * Monto a sumar al total del drawer.
   * null = todavía no se conoce (no se inventa 0 = gratis).
   */
  amount: number | null;
};

export function cartShippingDisplay(opts: {
  shippingMode: string | null | undefined;
  cartEmpty: boolean;
  /** Costo plano de la tienda (modo flat). */
  flatShippingCost: number;
  /** Umbral de envío gratis alcanzado sobre el neto del carrito. */
  freeShippingUnlocked: boolean;
}): CartShippingDisplay {
  if (opts.cartEmpty) {
    return { label: "—", amount: 0 };
  }

  const mode = String(opts.shippingMode ?? "flat").trim().toLowerCase() || "flat";

  if (mode === "free") {
    return { label: "Gratis", amount: 0 };
  }

  if (mode === "zones") {
    // La provincia decide. No se usa shipping_cost ni se dice Gratis.
    return { label: "Se calcula con tu provincia", amount: null };
  }

  // flat (y cualquier modo desconocido: no inventar zones-like).
  if (opts.freeShippingUnlocked) {
    return { label: "Gratis", amount: 0 };
  }
  const flat = Math.max(0, Number(opts.flatShippingCost) || 0);
  if (flat === 0) {
    return { label: "Gratis", amount: 0 };
  }
  // El UI formatea el monto; label vacío marca “mostrar plata”.
  return { label: "", amount: flat };
}

/** Texto de la celda Envío del drawer. */
export function cartShippingCellText(
  display: CartShippingDisplay,
  fmt: (n: number) => string,
): string {
  if (display.amount === null) return display.label;
  if (display.amount === 0) return display.label || "Gratis";
  return fmt(display.amount);
}
