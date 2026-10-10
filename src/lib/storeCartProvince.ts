/**
 * Provincia del carrito → checkout.
 *
 * Las plataformas de comercio muestran flete con poca fricción antes del checkout.
 * Guardamos sólo el código de provincia (no dirección) para precargar el
 * formulario; la autoridad del precio sigue siendo `quote_store_shipping`.
 */

import { quoteStoreShipping } from "@/lib/publicDataSource";

const KEY = (slug: string) => `gestiona.store.province.${slug}`;

export function leerProvinciaCarrito(slug: string | null | undefined): string {
  if (!slug) return "";
  try {
    return sessionStorage.getItem(KEY(slug)) ?? "";
  } catch {
    return "";
  }
}

export function guardarProvinciaCarrito(slug: string, code: string): void {
  try {
    if (!code) sessionStorage.removeItem(KEY(slug));
    else sessionStorage.setItem(KEY(slug), code);
  } catch {
    /* private mode */
  }
}

export type CartQuoteOption = {
  carrier: string;
  price: number;
  is_free?: boolean;
  label: string;
};

/**
 * Resumen honesto para la línea Envío del drawer.
 * Prefiere el domicilio más barato; si sólo hay retiro, lo muestra.
 */
export function resumenEnvioCarrito(
  options: CartQuoteOption[],
): { amount: number; subtitle: string } | null {
  if (!Array.isArray(options) || options.length === 0) return null;

  const domicilio = options.filter((o) => String(o.carrier) !== "retiro");
  if (domicilio.length > 0) {
    const best = domicilio.reduce((a, b) =>
      Number(a.price) <= Number(b.price) ? a : b,
    );
    const amount = Math.max(0, Number(best.price) || 0);
    return {
      amount,
      subtitle: String(best.label || "Envío a domicilio"),
    };
  }

  const retiro = options.find((o) => String(o.carrier) === "retiro");
  if (!retiro) return null;
  return {
    amount: Math.max(0, Number(retiro.price) || 0),
    subtitle: String(retiro.label || "Retiro en tienda"),
  };
}

/** Cotiza el envío del carrito y lo resume para la línea Envío; null si no hay opciones. */
export async function cotizarEnvioCarrito(
  slug: string,
  province: string,
  cart: ReadonlyArray<{ productId: string; variantId?: string | null; qty: number }>,
): Promise<{ amount: number; subtitle: string } | null> {
  const rows = await quoteStoreShipping({
    slug,
    province,
    postalCode: null,
    items: cart.map((l) => ({ product_id: l.productId, variant_id: l.variantId ?? null, quantity: l.qty })),
  });
  if (!rows) return null;
  return resumenEnvioCarrito(
    (rows as Array<{ carrier?: string; price?: number; is_free?: boolean; label?: string }>).map((r) => ({
      carrier: String(r.carrier ?? ""),
      price: Number(r.price) || 0,
      is_free: !!r.is_free,
      label: String(r.label ?? ""),
    })),
  );
}
