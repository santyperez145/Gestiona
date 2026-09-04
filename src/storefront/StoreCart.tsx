/**
 * Página de carrito — paridad Shopify/Tiendanube (/cart).
 *
 * El drawer sigue para el mini-cart al agregar; esta ruta da espacio completo
 * en mobile para editar líneas, cotizar envío y finalizar compra.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "./storeContext";
import { sugerenciasParaElCarrito, TEXTO_MOTIVO } from "@/lib/crossSell";
import { AR_PROVINCES } from "@/lib/shippingCalc";
import { quoteStoreShipping } from "@/lib/publicDataSource";
import {
  guardarProvinciaCarrito,
  leerProvinciaCarrito,
  resumenEnvioCarrito,
} from "@/lib/storeCartProvince";
import { etiquetaProvinciaCheckout, textoCoberturaDomicilio } from "@/lib/storeShippingCoverage";
import { atributosDeImagenVitrina, mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";
import { ArrowLeft, CheckCircle2, CloudOff, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";

export default function StoreCart() {
  const {
    store, products, variantsByProduct, cart, cartCount, subtotal, promo2x,
    shippingLabel, shippingPending, total, freeShippingGap, fmt, priceOf,
    addToCart, setQty, removeFromCart, lineKeyOf, cartSyncStatus, cartSyncNotice,
    basePath: base,
  } = useStore();
  const [provinciaCarrito, setProvinciaCarrito] = useState("");
  const [cotizandoCarrito, setCotizandoCarrito] = useState(false);
  const [resumenCotizacion, setResumenCotizacion] = useState<{ amount: number; subtitle: string } | null>(null);
  const [cotizacionError, setCotizacionError] = useState<string | null>(null);

  const coberturaEnvio = textoCoberturaDomicilio(store?.shipping_provinces);

  useEffect(() => {
    if (!store?.slug) return;
    setProvinciaCarrito(leerProvinciaCarrito(store.slug));
  }, [store?.slug]);

  useEffect(() => {
    if (!shippingPending || !store?.slug || cart.length === 0 || !provinciaCarrito) {
      setResumenCotizacion(null);
      setCotizandoCarrito(false);
      setCotizacionError(null);
      return;
    }
    let cancelado = false;
    setCotizandoCarrito(true);
    setCotizacionError(null);
    quoteStoreShipping({
      slug: store.slug,
      province: provinciaCarrito,
      postalCode: null,
      items: cart.map((l) => ({
        product_id: l.productId,
        variant_id: l.variantId ?? null,
        quantity: l.qty,
      })),
    }).then((rows) => {
      if (cancelado) return;
      setCotizandoCarrito(false);
      if (!rows) {
        setResumenCotizacion(null);
        return;
      }
      setResumenCotizacion(
        resumenEnvioCarrito(
          (rows as Array<{ carrier?: string; price?: number; is_free?: boolean; label?: string }>).map((r) => ({
            carrier: String(r.carrier ?? ""),
            price: Number(r.price) || 0,
            is_free: !!r.is_free,
            label: String(r.label ?? ""),
          })),
        ),
      );
    }, (error: unknown) => {
      if (cancelado) return;
      console.error("[carrito] no se pudo cotizar el envío:", error);
      setCotizandoCarrito(false);
      setResumenCotizacion(null);
      setCotizacionError("No pudimos cotizar ahora. Podés volver a intentar o elegir la entrega en el checkout.");
    });
    return () => { cancelado = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingPending, store?.slug, provinciaCarrito, JSON.stringify(cart.map((l) => [l.productId, l.variantId, l.qty]))]);

  const envioTexto = resumenCotizacion
    ? (resumenCotizacion.amount === 0 ? "Gratis" : fmt(resumenCotizacion.amount))
    : (cotizandoCarrito ? "Cotizando…" : shippingLabel);
  const totalPagina = resumenCotizacion
    ? Math.max(0, subtotal - promo2x) + resumenCotizacion.amount
    : total;
  const totalTexto = shippingPending && !resumenCotizacion
    ? `${fmt(totalPagina)} + envío`
    : fmt(totalPagina);

  const sugerencias = useMemo(
    () => sugerenciasParaElCarrito({
      cart: cart.map(l => ({ productId: l.productId, price: l.price, qty: l.qty })),
      productos: products,
      precioDe: priceOf,
      faltaEnvioGratis: freeShippingGap,
    }),
    [cart, products, priceOf, freeShippingGap],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-32 md:pb-8">
      <Link
        to={`${base}/productos`}
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium"
        style={{ color: "hsl(var(--st-muted))" }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Seguir comprando
      </Link>

      <h1 className="text-xl font-semibold mb-4">Tu carrito ({cartCount})</h1>

      {cart.length > 0 && (
        <div className="mb-5 space-y-1" aria-live="polite">
          <p className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(var(--st-muted))" }}>
            {cartSyncStatus === "error" ? (
              <CloudOff className="h-3.5 w-3.5" aria-hidden />
            ) : cartSyncStatus === "loading" || cartSyncStatus === "syncing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {cartSyncStatus === "error"
              ? "No pudimos sincronizar; tu carrito sigue en este dispositivo"
              : cartSyncStatus === "local"
                ? "Guardado en este dispositivo"
                : cartSyncStatus === "loading" || cartSyncStatus === "syncing"
                  ? "Guardando carrito…"
                  : "Carrito guardado"}
          </p>
          {cartSyncNotice && (
            <p className="text-xs font-medium" style={{ color: "hsl(var(--st-accent))" }}>
              {cartSyncNotice}
            </p>
          )}
        </div>
      )}

      {cart.length === 0 ? (
        <div className="py-16 text-center">
          <ShoppingBag className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden />
          <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
            Todavía no agregaste nada.
          </p>
          <Link
            to={`${base}/productos`}
            className="mt-4 inline-flex min-h-11 items-center px-4 py-2 text-sm font-medium"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            Ver productos
          </Link>
        </div>
      ) : (
        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <div className="space-y-3">
            {cart.map(l => (
              <div key={lineKeyOf(l)} className="flex gap-3 border-b pb-3" style={{ borderColor: "hsl(var(--st-border))" }}>
                <div
                  className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden bg-black/5"
                  style={{ borderRadius: "var(--st-radius)" }}
                >
                  <ShoppingBag aria-hidden className="h-5 w-5 opacity-20" />
                  {l.image && (
                    <img
                      src={l.image}
                      alt=""
                      {...atributosDeImagenVitrina("miniatura")}
                      onLoad={mostrarImagenValida}
                      onError={ocultarImagenRota}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight line-clamp-2">{l.name}</p>
                  <p className="mt-0.5 text-sm font-semibold">{fmt(l.price * l.qty)}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex items-center border" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>
                      <button type="button" className="grid min-h-11 min-w-11 place-items-center px-2 py-1" onClick={() => setQty(lineKeyOf(l), l.qty - 1)} aria-label="Restar">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="px-2 text-sm tabular-nums">{l.qty}</span>
                      <button
                        type="button"
                        className="grid min-h-11 min-w-11 place-items-center px-2 py-1 disabled:opacity-30"
                        onClick={() => setQty(lineKeyOf(l), l.qty + 1)}
                        disabled={l.qty >= l.stock}
                        aria-label="Sumar"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <button type="button" onClick={() => removeFromCart(lineKeyOf(l))} aria-label="Quitar" className="grid min-h-11 min-w-11 place-items-center">
                      <Trash2 className="h-3.5 w-3.5" style={{ color: "hsl(var(--st-muted))" }} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            </div>

            {sugerencias.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium">Completá tu compra</p>
                <div className="space-y-2">
                  {sugerencias.map(sg => (
                    <div key={sg.producto.id} className="flex items-center gap-2">
                      <Link to={`${base}/producto/${sg.producto.id}`} className="min-w-0 flex-1 text-xs font-medium line-clamp-1 hover:underline">
                        {sg.producto.name} · {fmt(sg.precio)} · {TEXTO_MOTIVO[sg.motivo]}
                      </Link>
                      {(variantsByProduct[sg.producto.id]?.length ?? 0) > 0 ? (
                        <Link to={`${base}/producto/${sg.producto.id}`} className="shrink-0 px-2 py-1 text-[11px] font-medium border min-h-11 inline-flex items-center" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>
                          Elegir
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToCart(sg.producto, 1, null)}
                          className="shrink-0 px-2 py-1 min-h-11 text-[11px] font-medium"
                          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                        >
                          Agregar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside
            className="storefront-cart-summary space-y-2 border p-4 md:sticky md:top-20"
            style={{
              borderColor: "hsl(var(--st-border))",
              background: "hsl(var(--st-surface))",
              borderRadius: "var(--st-radius)",
            }}
          >
            {freeShippingGap !== null && freeShippingGap > 0 && coberturaEnvio && (
              <p className="text-center text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                Te faltan <strong>{fmt(freeShippingGap)}</strong> para el envío gratis · {coberturaEnvio}
              </p>
            )}
            {shippingPending && (
              <label className="block text-xs space-y-1" style={{ color: "hsl(var(--st-muted))" }}>
                <span>Provincia para cotizar el envío</span>
                <select
                  value={provinciaCarrito}
                  onChange={(e) => {
                    const code = e.target.value;
                    setProvinciaCarrito(code);
                    if (store?.slug) guardarProvinciaCarrito(store.slug, code);
                  }}
                  className="w-full min-h-11 px-2 text-sm"
                  style={{
                    borderRadius: "var(--st-radius)",
                    border: "1px solid hsl(var(--st-border))",
                    background: "hsl(var(--st-bg))",
                    color: "hsl(var(--st-fg))",
                  }}
                  aria-label="Provincia para cotizar el envío"
                >
                  <option value="">Elegí tu provincia</option>
                  {AR_PROVINCES.map((p) => (
                    <option key={p.code} value={p.code}>
                      {etiquetaProvinciaCheckout(p.code, p.name, store?.shipping_provinces)}
                    </option>
                  ))}
                </select>
                {resumenCotizacion && (
                  <span className="block text-[11px]">{resumenCotizacion.subtitle}</span>
                )}
              </label>
            )}
            {cotizacionError && (
              <p
                className="text-xs px-3 py-2 bg-red-500/10 text-red-600"
                role="alert"
                style={{ borderRadius: "var(--st-radius)" }}
              >
                {cotizacionError}
              </p>
            )}
            <div className="flex justify-between text-sm">
              <span style={{ color: "hsl(var(--st-muted))" }}>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            {promo2x > 0 && (
              <div className="flex justify-between text-sm" style={{ color: "hsl(var(--st-accent))" }}>
                <span>Promo llevando 2</span>
                <span>−{fmt(promo2x)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span style={{ color: "hsl(var(--st-muted))" }}>Envío</span>
              <span>{envioTexto}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold" style={{ borderColor: "hsl(var(--st-border))" }}>
              <span>Total</span>
              <span>{totalTexto}</span>
            </div>
            <Link
              to={`${base}/checkout`}
              className="mt-2 hidden min-h-12 items-center justify-center py-2.5 text-center font-medium md:flex"
              style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
            >
              Finalizar compra
            </Link>
          </aside>

          <div
            className="storefront-cart-mobile-bar fixed inset-x-0 bottom-0 z-40 border-t shadow-[0_-10px_30px_rgba(0,0,0,0.12)] md:hidden"
            style={{
              borderColor: "hsl(var(--st-border))",
              background: "hsl(var(--st-surface))",
            }}
          >
            <div
              className="mx-auto flex max-w-5xl items-center gap-3 px-4 pt-3"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            >
              <p className="min-w-0 flex-1" aria-live="polite">
                <span className="block text-[11px]" style={{ color: "hsl(var(--st-muted))" }}>Total</span>
                <strong className="block truncate text-sm tabular-nums">{totalTexto}</strong>
              </p>
              <Link
                to={`${base}/checkout`}
                className="inline-flex min-h-12 shrink-0 items-center justify-center px-4 py-2.5 text-sm font-medium"
                style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
              >
                Finalizar compra
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
