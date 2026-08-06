import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "./storeContext";
import {
  mejorDescuento, nombreMedio, precioConMedioDePago, medioMejoraElPrecio,
} from "@/lib/paymentDiscount";
import { opcionDestacada, textoCuotas } from "@/lib/installments";
import { ahorroDeUnPar } from "@/lib/promo2x";
import { useInstallments } from "./useInstallments";
import ProductCard from "./ProductCard";
import { getCategoryLabel } from "@/lib/supabaseStore";
import {
  FAMILIAS_OLFATIVAS, DURACIONES, PROYECCIONES, ESTACIONES, OCASIONES, NOTAS_COMUNES, taxLabel,
} from "@/lib/scentTaxonomy";
import { ChevronLeft, Minus, Plus, ShoppingBag, Check, Heart } from "lucide-react";
import { trackViewItem, trackAddToCart } from "./tracking";
import ProductReviews from "./ProductReviews";
import ProductQuestions from "./ProductQuestions";
import StockAlertForm from "./StockAlertForm";
import { useWishlist } from "./wishlist";

export default function StoreProduct() {
  const { productId } = useParams<{ productId: string }>();
  const { store, products, perfumes, variantsByProduct, priceOf, fmt, addToCart } = useStore();

  // El mejor descuento por medio de pago que ofrece la tienda, o null.
  const descuentoPago = mejorDescuento(store?.payment_methods ?? null, store?.payment_discounts ?? null);
  const deseos = useWishlist();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [added, setAdded] = useState(false);
  const [variantId, setVariantId] = useState<string | null>(null);

  const base = `/tienda/${store?.slug ?? ""}`;
  const p = products.find(x => x.id === productId);
  const d = productId ? perfumes[productId] : undefined;

  const relacionados = useMemo(() => {
    if (!p) return [];
    return products
      .filter(x => x.id !== p.id && (x.category === p.category || x.brand === p.brand))
      .slice(0, 4);
  }, [p, products]);

  // Ver producto: es el evento con el que Meta arma públicos similares.
  // Va ANTES del early return: los hooks no pueden ser condicionales.
  const precioParaTracking = p
    ? (variantsByProduct[p.id]?.find(v => v.id === variantId)?.price_override || priceOf(p))
    : 0;
  useEffect(() => {
    if (!p) return;
    trackViewItem({ id: p.id, name: p.name, price: Number(precioParaTracking) }, store?.currency ?? "ARS");
  }, [p, precioParaTracking, store?.currency]);

  // Cuotas: va ANTES del early return por la regla de los hooks, igual que el
  // tracking. Se consulta sobre `precioParaTracking`, que ya contempla la
  // variante elegida.
  const cuotas = useInstallments(store?.slug, precioParaTracking);
  const textoCuota = textoCuotas(opcionDestacada(cuotas), fmt);

  if (!p) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-24 text-center">
        <p className="font-medium">Producto no encontrado</p>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
          Puede que ya no esté disponible o se haya quedado sin stock.
        </p>
        <Link
          to={`${base}/productos`}
          className="inline-block mt-5 px-4 py-2 text-sm font-medium"
          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
        >
          Ver productos
        </Link>
      </div>
    );
  }

  // Variantes con stock de este producto. Si hay, la compra es de una
  // variante concreta: 50ml y 100ml tienen precio y stock propios.
  const variantes = variantsByProduct[p.id] ?? [];
  const variante = variantes.find(v => v.id === variantId) ?? null;
  const faltaElegir = variantes.length > 0 && !variante;

  const price = variante && Number(variante.price_override) > 0
    ? Number(variante.price_override)
    : priceOf(p);
  const stockEfectivo = variante ? variante.stock : p.stock;
  const list = Number(p.sale_price_ars);
  // Sobre qué precio se descuenta el medio de pago. Cuando la oferta acumula
  // la vista devuelve el precio de oferta, y entonces el descuento se suma
  // encima; cuando no, devuelve el de lista y la oferta ya lo contenía.
  const baseMedioPago = Number(p.payment_base_price) || list;
  const off = price < list ? Math.round((1 - price / list) * 100) : 0;
  // Se deduplica: `image_url` suele estar repetida dentro de `image_urls`, y
  // eso generaba dos miniaturas iguales con la misma key de React.
  const imagenes = [...new Set(
    [p.image_url, ...(p.image_urls ?? [])].filter(Boolean) as string[],
  )];

  const agregar = () => {
    if (faltaElegir) return;
    addToCart(p, qty, variante);
    trackAddToCart(
      { id: variante?.id ?? p.id, name: p.name, price, quantity: qty },
      store?.currency ?? "ARS",
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  const notas = [
    { t: "Salida", v: d?.notas_salida },
    { t: "Corazón", v: d?.notas_corazon },
    { t: "Fondo", v: d?.notas_fondo },
  ].filter(n => n.v?.length);

  // La fila de `perfume_details` existe apenas se abre la ficha en gestión,
  // aunque se guarde vacía. Sin esto la tienda muestra el título "Perfil
  // olfativo" con nada debajo, que se lee como un error de carga.
  const hayPerfil = !!d && (
    notas.length > 0 || !!d.familia_olfativa || !!d.duracion || !!d.proyeccion ||
    (d.estacion?.length ?? 0) > 0 || (d.ocasion?.length ?? 0) > 0 || !!d.inspiracion
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm mb-5 hover:underline"
        style={{ color: "hsl(var(--st-muted))" }}
      >
        <ChevronLeft className="w-4 h-4" /> Volver
      </button>

      <div className="grid md:grid-cols-2 gap-8">
        {/* ── Galería ─────────────────────────────────────────────── */}
        <div>
          <div
            className="aspect-square overflow-hidden bg-black/5 border"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            {imagenes[imgIdx]
              ? <img src={imagenes[imgIdx]} alt={p.name} className="w-full h-full object-cover" />
              : <div className="w-full h-full grid place-items-center opacity-20"><ShoppingBag className="w-12 h-12" /></div>}
          </div>
          {imagenes.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {imagenes.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setImgIdx(i)}
                  className="w-16 h-16 shrink-0 overflow-hidden border-2 transition-colors"
                  style={{
                    borderColor: i === imgIdx ? "hsl(var(--st-accent))" : "hsl(var(--st-border))",
                    borderRadius: "var(--st-radius)",
                  }}
                >
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Datos y compra ──────────────────────────────────────── */}
        <div>
          {p.brand && (
            <p className="text-xs uppercase tracking-wide" style={{ color: "hsl(var(--st-muted))" }}>{p.brand}</p>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold mt-1 leading-tight">{p.name}</h1>

          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs" style={{ color: "hsl(var(--st-muted))" }}>
            {p.category && <span>{getCategoryLabel(p.category)}</span>}
            {p.gender && <span className="capitalize">· {p.gender}</span>}
            {p.content_ml ? <span>· {p.content_ml} ml</span> : null}
          </div>

          <div className="mt-4 flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-bold">{fmt(price)}</span>
            {off > 0 && (
              <>
                <span className="text-base line-through" style={{ color: "hsl(var(--st-muted))" }}>{fmt(list)}</span>
                <span
                  className="px-2 py-0.5 text-xs font-bold"
                  style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                >
                  −{off}%
                </span>
              </>
            )}
          </div>

          {/* Precio con el mejor medio de pago. Va acá, pegado al precio, que es
              donde se decide: en Argentina el mismo producto "sale distinto"
              según cómo se pague, y esconderlo hasta el checkout es perder la
              venta antes de llegar. El monto exacto lo recalcula la base al
              crear la orden; esto es el espejo. */}
          {/* Sólo si mejora lo que ya paga: con una oferta del 20% y
              transferencia del 20%, el precio con transferencia ES el de
              oferta, y anunciarlo al lado de un número idéntico hace dudar de
              los dos. Los descuentos no se acumulan. */}
          {descuentoPago && medioMejoraElPrecio(baseMedioPago, price, descuentoPago.metodo, store?.payment_discounts) && (
            <p className="mt-1.5 text-sm">
              <strong style={{ color: "hsl(var(--st-accent))" }}>
                {fmt(precioConMedioDePago(baseMedioPago, price, descuentoPago.metodo, store?.payment_discounts))}
              </strong>{" "}
              <span style={{ color: "hsl(var(--st-muted))" }}>
                con {nombreMedio(descuentoPago.metodo)} ({descuentoPago.porcentaje}% OFF)
              </span>
            </p>
          )}

          {/* Promo "llevando 2". El comercio ya la tenía cargada y la
              publicaba en el catálogo por WhatsApp; la tienda cobraba el precio
              pleno. El ahorro lo recalcula la base al cobrar. */}
          {(() => {
            const ahorro = ahorroDeUnPar(Number(precioParaTracking), p.price_2x_ars);
            if (!ahorro) return null;
            return (
              <p
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium"
                style={{
                  background: "hsl(var(--st-accent) / 0.12)",
                  color: "hsl(var(--st-accent))",
                  borderRadius: "var(--st-radius)",
                }}
              >
                Llevando 2: {fmt(Number(p.price_2x_ars))}
                <span className="font-normal">· ahorrás {fmt(ahorro)}</span>
              </p>
            );
          })()}

          {/* Cuotas reales de la cuenta de MercadoPago del comercio. Si no hay
              conexión OAuth, o MercadoPago no contesta, no aparece nada — antes
              que mostrar una cuota inventada que el checkout va a desmentir. */}
          {textoCuota && (
            <p className="mt-1 text-sm" style={{ color: "hsl(var(--st-muted))" }}>
              {textoCuota}
            </p>
          )}

          <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
            {stockEfectivo <= 0 ? "Sin stock"
              : stockEfectivo > 3 ? "En stock"
              : `¡Últimas ${stockEfectivo} unidades!`}
          </p>

          {variantes.length > 0 && (
            <div className="mt-5">
              <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "hsl(var(--st-muted))" }}>
                {variantes[0].variant_type === "sabor" ? "Sabor"
                  : variantes[0].variant_type === "color" ? "Color"
                  : variantes[0].variant_type === "talle" ? "Talle"
                  : "Opciones"}
              </p>
              <div className="flex flex-wrap gap-2">
                {variantes.map(v => {
                  const sel = v.id === variantId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { setVariantId(sel ? null : v.id); setQty(1); }}
                      className="px-3 py-1.5 text-sm border transition-colors"
                      style={{
                        borderColor: sel ? "hsl(var(--st-accent))" : "hsl(var(--st-border))",
                        background: sel ? "hsl(var(--st-accent) / 0.1)" : "transparent",
                        borderRadius: "var(--st-radius)",
                      }}
                    >
                      {v.variant_name}
                      {v.stock <= 3 && (
                        <span className="ml-1.5 text-[10px]" style={{ color: "hsl(var(--st-muted))" }}>
                          ({v.stock})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {faltaElegir && (
                <p className="text-xs mt-2" style={{ color: "hsl(var(--st-muted))" }}>
                  Elegí una opción para continuar.
                </p>
              )}
            </div>
          )}

          {stockEfectivo <= 0 ? (
            <StockAlertForm productId={p.id} variantId={variantId} />
          ) : (
          <div className="flex items-center gap-3 mt-6">
            <div className="flex items-center border" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>
              <button className="px-3 py-2.5" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Restar">
                <Minus className="w-4 h-4" />
              </button>
              <span className="px-3 tabular-nums font-medium">{qty}</span>
              <button
                className="px-3 py-2.5 disabled:opacity-30"
                onClick={() => setQty(q => Math.min(stockEfectivo, q + 1))}
                disabled={qty >= stockEfectivo}
                aria-label="Sumar"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={agregar}
              disabled={faltaElegir}
              className="flex-1 py-3 font-medium inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
            >
              {added ? <><Check className="w-4 h-4" /> Agregado</> : <><ShoppingBag className="w-4 h-4" /> Agregar al carrito</>}
            </button>
            <button
              onClick={() => deseos.toggle(p.id)}
              aria-label={deseos.has(p.id) ? "Quitar de mis deseos" : "Guardar en mis deseos"}
              aria-pressed={deseos.has(p.id)}
              className="p-3 border transition-colors"
              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
            >
              <Heart
                className={`w-4 h-4 ${deseos.has(p.id) ? "fill-current" : ""}`}
                style={{ color: deseos.has(p.id) ? "hsl(var(--st-accent))" : "inherit" }}
              />
            </button>
          </div>
          )}

          {p.description && (
            <p className="mt-6 text-sm leading-relaxed whitespace-pre-line" style={{ color: "hsl(var(--st-muted))" }}>
              {p.description}
            </p>
          )}

          {/* ── Ficha olfativa ───────────────────────────────────── */}
          {hayPerfil && (
            <div className="mt-7 pt-6 border-t space-y-4" style={{ borderColor: "hsl(var(--st-border))" }}>
              <h2 className="font-semibold">Perfil olfativo</h2>

              <div className="grid grid-cols-3 gap-3 text-sm">
                {[
                  { t: "Familia", v: d.familia_olfativa && taxLabel(FAMILIAS_OLFATIVAS, d.familia_olfativa) },
                  { t: "Duración", v: d.duracion && taxLabel(DURACIONES, d.duracion) },
                  { t: "Proyección", v: d.proyeccion && taxLabel(PROYECCIONES, d.proyeccion) },
                ].filter(x => x.v).map(x => (
                  <div key={x.t}>
                    <p className="text-[11px] uppercase tracking-wide" style={{ color: "hsl(var(--st-muted))" }}>{x.t}</p>
                    <p className="font-medium">{x.v}</p>
                  </div>
                ))}
              </div>

              {notas.map(n => (
                <div key={n.t}>
                  <p className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: "hsl(var(--st-muted))" }}>
                    Notas de {n.t.toLowerCase()}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {n.v!.map(x => (
                      <span
                        key={x}
                        className="px-2 py-0.5 text-xs border"
                        style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                      >
                        {taxLabel(NOTAS_COMUNES, x)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {/* `0 || 0` es `0`, y React imprime el cero. Con `> 0` la
                  condición es booleana y no deja basura en la página. */}
              {((d.estacion?.length ?? 0) > 0 || (d.ocasion?.length ?? 0) > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  {d.estacion?.length ? (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "hsl(var(--st-muted))" }}>Estación</p>
                      <p className="text-sm">{d.estacion.map(x => taxLabel(ESTACIONES, x)).join(", ")}</p>
                    </div>
                  ) : null}
                  {d.ocasion?.length ? (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "hsl(var(--st-muted))" }}>Ocasión</p>
                      <p className="text-sm">{d.ocasion.map(x => taxLabel(OCASIONES, x)).join(", ")}</p>
                    </div>
                  ) : null}
                </div>
              )}

              {d.inspiracion && (
                <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
                  Inspirado en <strong style={{ color: "hsl(var(--st-text))" }}>{d.inspiracion}</strong>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <ProductQuestions productId={p.id} />

      <ProductReviews productId={p.id} />

      {relacionados.length > 0 && (
        <section className="mt-14">
          <h2 className="text-lg font-semibold mb-4">También te puede gustar</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {relacionados.map(r => <ProductCard key={r.id} p={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}
