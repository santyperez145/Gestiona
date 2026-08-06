import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";
import { Loader2, ShoppingBag, Lock, Tag, Truck } from "lucide-react";
import { AR_PROVINCES } from "@/lib/shippingCalc";
import { quoteStoreShipping, createStoreOrder } from "@/lib/publicDataSource";
import { trackBeginCheckout } from "./tracking";
import { precioConMedioDePago, porcentajeDe, nombreMedio } from "@/lib/paymentDiscount";

/** Fila que devuelve el RPC `quote_store_shipping`. */
interface ShippingOption {
  option_id: string;
  carrier: string;
  service: string;
  label: string;
  price: number;
  is_free: boolean;
  days_min: number | null;
  days_max: number | null;
  zone_id: string | null;
  zone_name: string | null;
}

const METODO_LABEL: Record<string, string> = {
  mercadopago: "MercadoPago",
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo al recibir",
  stripe: "Tarjeta (Stripe)",
  paypal: "PayPal",
};

export default function StoreCheckout() {
  // `total` del contexto no se usa acá: el checkout calcula el suyo con el cupón.
  const { store, products, cart, subtotal, promo2x, shippingCost, fmt, clearCart } = useStore();
  const navigate = useNavigate();
  const base = `/tienda/${store?.slug ?? ""}`;

  const { customer } = useStoreAuth();
  const metodos = store?.payment_methods?.length ? store.payment_methods : ["transferencia"];
  const [form, setForm] = useState({
    nombre: "", email: "", telefono: "",
    calle: "", ciudad: "", provincia: "", cp: "", notas: "",
    metodo: metodos[0],
  });

  // Si el comprador tiene cuenta, se precarga con sus datos y su última
  // dirección: es el sentido de tener cuenta, no volver a tipear todo.
  useEffect(() => {
    if (!customer) return;
    const d = customer.default_address ?? {};
    setForm(f => ({
      ...f,
      nombre: f.nombre || customer.name || "",
      email: f.email || customer.email || "",
      telefono: f.telefono || customer.phone || "",
      calle: f.calle || d.calle || "",
      ciudad: f.ciudad || d.ciudad || "",
      provincia: f.provincia || d.provincia || "",
      cp: f.cp || d.cp || "",
    }));
  }, [customer]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Cupón ───────────────────────────────────────────────────────────────
  const [cupon, setCupon] = useState("");
  const [cuponAplicado, setCuponAplicado] = useState<{ code: string; discount: number } | null>(null);
  const [cuponError, setCuponError] = useState<string | null>(null);
  const [validandoCupon, setValidandoCupon] = useState(false);

  const aplicarCupon = async () => {
    if (!cupon.trim() || !store) return;
    setValidandoCupon(true);
    setCuponError(null);
    const { data, error: rpcErr } = await supabase.rpc("check_store_coupon", {
      p_slug: store.slug, p_code: cupon.trim(),
      p_subtotal: Math.max(0, subtotal - promo2x),
    });
    setValidandoCupon(false);

    const res = data as any;
    if (rpcErr || !res?.valid) {
      setCuponAplicado(null);
      setCuponError(res?.reason ?? "No se pudo validar el cupón");
      return;
    }
    setCuponAplicado({ code: res.code, discount: Number(res.discount) || 0 });
  };

  // ── Envío ───────────────────────────────────────────────────────────────
  // La tienda puede cotizar por zona y peso, no sólo un precio plano. Las
  // opciones y sus precios los calcula el servidor: acá sólo se eligen.
  const [opciones, setOpciones] = useState<ShippingOption[]>([]);
  const [opcionElegida, setOpcionElegida] = useState<string | null>(null);
  const [cotizando, setCotizando] = useState(false);
  const [envioAviso, setEnvioAviso] = useState<string | null>(null);

  const porZona = store?.shipping_mode === "zones";

  useEffect(() => {
    if (!store) return;
    // Sin provincia no hay zona que resolver. En modo plano o gratis se cotiza
    // igual, para que el resumen muestre el mismo número que va a cobrar el RPC.
    if (porZona && !form.provincia) {
      setOpciones([]); setOpcionElegida(null); setEnvioAviso(null);
      return;
    }

    let cancelado = false;
    setCotizando(true);
    setEnvioAviso(null);

    quoteStoreShipping({
      slug: store.slug,
      province: form.provincia || null,
      postalCode: form.cp || null,
      items: cart.map(l => ({ product_id: l.productId, variant_id: l.variantId ?? null, quantity: l.qty })),
    }).then(rows => {
      if (cancelado) return;
      setCotizando(false);

      // `null` = la cotización por zona todavía no está en la base. No es un
      // error del comprador, así que no se le avisa nada: se cobra el envío
      // plano de la tienda, como antes.
      if (rows === null) {
        setOpciones([]); setOpcionElegida(null); setEnvioAviso(null);
        return;
      }

      const lista = rows as unknown as ShippingOption[];
      setOpciones(lista);

      if (lista.length === 0) {
        setEnvioAviso(
          porZona
            ? "Todavía no hacemos envíos a esa provincia."
            : null,
        );
        setOpcionElegida(null);
        return;
      }
      // Preseleccionar la más barata: es lo que el RPC va a elegir si no se
      // manda ninguna, así el resumen y el cobro coinciden.
      setOpcionElegida(prev =>
        prev && lista.some(o => o.option_id === prev) ? prev : lista[0].option_id);
    }, () => {
      if (cancelado) return;
      setCotizando(false);
      setEnvioAviso("No pudimos calcular el envío. Probá de nuevo en un momento.");
    });

    return () => { cancelado = true; };
  // `cart` se serializa para no recotizar en cada render por identidad de array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.slug, form.provincia, form.cp, porZona, JSON.stringify(cart.map(l => [l.productId, l.variantId, l.qty]))]);

  const opcion = opciones.find(o => o.option_id === opcionElegida) ?? null;
  // Mientras no haya cotización se usa el costo del contexto, que es el plano.
  const envio = opcion ? Number(opcion.price) : (opciones.length > 0 ? 0 : shippingCost);

  const descuento = cuponAplicado?.discount ?? 0;

  // Mismo orden que `create_store_order`: primero la promo "llevando 2"
  // —que es un precio, no una rebaja—, después el cupón sobre lo que queda, y
  // el descuento del medio de pago al final. El envío se suma después y no se
  // descuenta: sería regalar lo que se le paga al correo.
  //
  // Esto es sólo para mostrar: el número que se cobra lo recalcula la base.
  const baseMercaderia = Math.max(0, subtotal - promo2x - descuento);

  // El descuento del medio de pago se mide contra el precio de LISTA de cada
  // línea y no sobre el subtotal, que ya viene con la oferta aplicada: si no, un
  // producto con 20% off pagado por transferencia con 20% terminaba con 36% de
  // descuento. Espejo de `create_store_order`.
  const ahorroPorMedio = (metodo: string) => Math.min(
    cart.reduce((s, l) => {
      const pr = products.find(x => x.id === l.productId);
      const lista = Number(pr?.sale_price_ars) || l.price;
      return s + Math.max(0, l.price - precioConMedioDePago(lista, l.price, metodo, store?.payment_discounts)) * l.qty;
    }, 0),
    baseMercaderia,
  );

  const descuentoPago = ahorroPorMedio(form.metodo);
  const totalFinal = Math.max(0, baseMercaderia - descuentoPago) + envio;

  // Inicio de checkout: Meta y GA lo usan para medir abandono.
  // Solo al montar, no en cada cambio del carrito.
  useEffect(() => {
    if (cart.length === 0) return;
    trackBeginCheckout(
      cart.map(l => ({ id: l.variantId ?? l.productId, name: l.name, price: l.price, quantity: l.qty })),
      subtotal,
      store?.currency ?? "ARS",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  if (cart.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-24 text-center">
        <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Tu carrito está vacío</p>
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

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);

    const { data, error: rpcError } = await createStoreOrder({
      p_slug: store!.slug,
      p_items: cart.map(l => ({ product_id: l.productId, variant_id: l.variantId ?? null, quantity: l.qty })),
      p_customer_name: form.nombre,
      p_customer_email: form.email,
      p_customer_phone: form.telefono || null,
      p_shipping: {
        calle: form.calle, ciudad: form.ciudad,
        provincia: form.provincia, cp: form.cp, notas: form.notas,
      },
      p_payment_method: form.metodo,
      p_notes: form.notas || null,
      // El RPC revalida el cupón: entre que se escribió y se confirma pudo
      // agotarse o vencer.
      p_coupon: cuponAplicado?.code ?? null,
      // Se manda CUÁL opción eligió, no cuánto cuesta: el precio lo recalcula
      // el RPC contra las tarifas de la tienda.
      p_shipping_option: opcionElegida,
    });

    setEnviando(false);

    if (rpcError) {
      // El RPC valida stock y precios del lado del servidor, así que sus
      // mensajes son los que importan (ej: "Sin stock suficiente de X").
      setError(rpcError.message.replace(/^.*?:\s*/, ""));
      return;
    }

    const orderNumber = (data as any)?.order_number;

    // Se cierra la sesión de carrito para que no le llegue un email de
    // "te quedó algo pendiente" a quien acaba de comprar.
    try {
      const token = localStorage.getItem(`gestiona.store.session.${store!.slug}`);
      if (token) {
        supabase.rpc("convert_store_cart", { p_slug: store!.slug, p_token: token })
          .then(undefined, () => {});
      }
    } catch { /* sin localStorage */ }

    clearCart();

    // Avisos por email, best-effort: si falla el envío la compra ya está hecha
    // y no tiene sentido frenar al comprador por eso.
    supabase.functions.invoke("store-order-email", {
      body: { slug: store!.slug, orderNumber, baseUrl: window.location.origin },
    }).catch(() => {});

    // Con MercadoPago se manda al checkout externo; el webhook confirma el
    // pago y de ahí vuelve a la página del pedido. Si falla la generación del
    // link no se pierde nada: la orden ya está creada y se puede pagar después
    // desde esa misma página.
    if (form.metodo === "mercadopago") {
      setEnviando(true);
      const { data: pay, error: payErr } = await supabase.functions.invoke("store-pay", {
        body: { slug: store!.slug, orderNumber, returnUrl: window.location.origin },
      });
      setEnviando(false);
      const url = (pay as any)?.url;
      if (url) { window.location.href = url; return; }
      if (payErr || (pay as any)?.error) {
        setError((pay as any)?.error ?? "No se pudo abrir el pago online. Tu pedido quedó registrado.");
      }
    }

    navigate(`${base}/orden/${orderNumber}`, { replace: true });
  };

  const input = "w-full px-3 py-2 text-sm border bg-transparent outline-none focus:ring-1";
  const inputStyle = { borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" } as React.CSSProperties;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Finalizar compra</h1>

      <form onSubmit={confirmar} className="grid md:grid-cols-[1fr_20rem] gap-8 items-start">
        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Tus datos</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="sm:col-span-2">
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Nombre y apellido *</span>
                <input required value={form.nombre} onChange={e => set("nombre", e.target.value)} className={input} style={inputStyle} />
              </label>
              <label>
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Email *</span>
                <input required type="email" value={form.email} onChange={e => set("email", e.target.value)} className={input} style={inputStyle} />
              </label>
              <label>
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Teléfono</span>
                <input value={form.telefono} onChange={e => set("telefono", e.target.value)} className={input} style={inputStyle} inputMode="tel" />
              </label>
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Envío</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="sm:col-span-2">
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Calle y número</span>
                <input value={form.calle} onChange={e => set("calle", e.target.value)} className={input} style={inputStyle} />
              </label>
              <label>
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Ciudad</span>
                <input value={form.ciudad} onChange={e => set("ciudad", e.target.value)} className={input} style={inputStyle} />
              </label>
              <label>
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                  Provincia {porZona && "*"}
                </span>
                {/* Selector y no texto libre: la zona de envío se resuelve por
                    código de provincia, y "Bs As" no matchea con nada. */}
                <select
                  required={porZona}
                  value={form.provincia}
                  onChange={e => set("provincia", e.target.value)}
                  className={input}
                  style={inputStyle}
                >
                  <option value="">Elegí tu provincia</option>
                  {AR_PROVINCES.map(p => (
                    <option key={p.code} value={p.code}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Código postal</span>
                <input value={form.cp} onChange={e => set("cp", e.target.value)} className={input} style={inputStyle} inputMode="numeric" />
              </label>
            </div>

            {/* Opciones de envío cotizadas por el servidor */}
            <div className="mt-3 space-y-2">
              {cotizando && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: "hsl(var(--st-muted))" }}>
                  <Loader2 className="w-3 h-3 animate-spin" /> Calculando el envío…
                </p>
              )}

              {envioAviso && (
                <p className="text-xs px-3 py-2 border" style={{ ...inputStyle, borderColor: "hsl(var(--st-border))" }}>
                  {envioAviso}
                </p>
              )}

              {porZona && !form.provincia && !cotizando && (
                <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                  Elegí tu provincia para ver las formas de envío y su costo.
                </p>
              )}

              {opciones.length > 1 && opciones.map(o => (
                <label
                  key={o.option_id}
                  className="flex items-center gap-3 px-3 py-2.5 border cursor-pointer"
                  style={{
                    ...inputStyle,
                    borderColor: opcionElegida === o.option_id
                      ? "hsl(var(--st-accent))"
                      : "hsl(var(--st-border))",
                  }}
                >
                  <input
                    type="radio"
                    name="envio"
                    checked={opcionElegida === o.option_id}
                    onChange={() => setOpcionElegida(o.option_id)}
                  />
                  <Truck className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--st-muted))" }} />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm block truncate">{o.label}</span>
                    {o.days_min != null && (
                      <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                        {o.days_min}–{o.days_max ?? "?"} días hábiles
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-medium shrink-0">
                    {o.is_free || Number(o.price) === 0 ? "Gratis" : fmt(Number(o.price))}
                  </span>
                </label>
              ))}

              {/* Una sola opción: no se hace elegir, se informa */}
              {opciones.length === 1 && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: "hsl(var(--st-muted))" }}>
                  <Truck className="w-3 h-3" />
                  {opciones[0].label}
                  {opciones[0].days_min != null && ` · ${opciones[0].days_min}–${opciones[0].days_max ?? "?"} días hábiles`}
                  {" · "}
                  {opciones[0].is_free || Number(opciones[0].price) === 0
                    ? "Gratis"
                    : fmt(Number(opciones[0].price))}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Medio de pago</h2>
            <div className="space-y-2">
              {metodos.map(m => {
                const pct = porcentajeDe(m, store?.payment_discounts);
                const ahorro = ahorroPorMedio(m);
                return (
                  <label
                    key={m}
                    className="flex items-center gap-3 px-3 py-2.5 border cursor-pointer"
                    style={{
                      ...inputStyle,
                      borderColor: form.metodo === m ? "hsl(var(--st-accent))" : "hsl(var(--st-border))",
                    }}
                  >
                    <input
                      type="radio" name="metodo" value={m}
                      checked={form.metodo === m}
                      onChange={() => set("metodo", m)}
                    />
                    <span className="text-sm flex-1">{METODO_LABEL[m] ?? m}</span>
                    {/* Se muestra el ahorro en pesos y no sólo el porcentaje:
                        "ahorrás $2.000" decide una compra, "10% off" hay que
                        calcularlo. El número que se cobra igual lo recalcula la
                        base — esto es el espejo. */}
                    {pct > 0 && (
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded"
                        style={{ background: "hsl(var(--st-accent) / 0.12)", color: "hsl(var(--st-accent))" }}
                      >
                        {pct}% — ahorrás {fmt(ahorro)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <p className="text-xs mt-2" style={{ color: "hsl(var(--st-muted))" }}>
              Te contactamos para coordinar el pago y la entrega apenas recibamos el pedido.
            </p>
          </section>

          <label className="block">
            <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Notas para el vendedor</span>
            <textarea
              value={form.notas} onChange={e => set("notas", e.target.value)}
              rows={2} className={input} style={inputStyle}
              placeholder="Horario de entrega, referencias, etc."
            />
          </label>
        </div>

        {/* ── Resumen ─────────────────────────────────────────────── */}
        <aside
          className="border p-4 space-y-3 md:sticky md:top-20"
          style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
        >
          <p className="font-semibold">Tu pedido</p>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {cart.map(l => (
              <div key={(l.variantId ? l.productId + "::" + l.variantId : l.productId)} className="flex gap-2 text-sm">
                <span className="tabular-nums shrink-0" style={{ color: "hsl(var(--st-muted))" }}>{l.qty}×</span>
                <span className="flex-1 leading-tight line-clamp-2">{l.name}</span>
                <span className="shrink-0">{fmt(l.price * l.qty)}</span>
              </div>
            ))}
          </div>

          {/* Cupón de descuento */}
          <div className="pt-2 border-t" style={{ borderColor: "hsl(var(--st-border))" }}>
            {cuponAplicado ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" style={{ color: "hsl(var(--st-accent))" }} />
                  <strong>{cuponAplicado.code}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => { setCuponAplicado(null); setCupon(""); }}
                  className="text-xs hover:underline"
                  style={{ color: "hsl(var(--st-muted))" }}
                >
                  Quitar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={cupon}
                  onChange={e => { setCupon(e.target.value.toUpperCase()); setCuponError(null); }}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); aplicarCupon(); } }}
                  placeholder="Cupón de descuento"
                  className="flex-1 px-3 py-2 text-sm border bg-transparent outline-none uppercase"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={aplicarCupon}
                  disabled={validandoCupon || !cupon.trim()}
                  className="px-3 text-sm font-medium border disabled:opacity-50"
                  style={inputStyle}
                >
                  {validandoCupon ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
                </button>
              </div>
            )}
            {cuponError && <p className="text-xs mt-1.5 text-red-600">{cuponError}</p>}
          </div>

          <div className="pt-2 border-t space-y-1 text-sm" style={{ borderColor: "hsl(var(--st-border))" }}>
            <div className="flex justify-between">
              <span style={{ color: "hsl(var(--st-muted))" }}>Subtotal</span><span>{fmt(subtotal)}</span>
            </div>
            {descuento > 0 && (
              <div className="flex justify-between" style={{ color: "hsl(var(--st-accent))" }}>
                <span>Cupón {cuponAplicado?.code}</span><span>−{fmt(descuento)}</span>
              </div>
            )}
            {descuentoPago > 0 && (
              <div className="flex justify-between" style={{ color: "hsl(var(--st-accent))" }}>
                <span>Pagando con {nombreMedio(form.metodo)}</span>
                <span>−{fmt(descuentoPago)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span style={{ color: "hsl(var(--st-muted))" }}>
                Envío
                {opcion && (
                  <span className="block text-[11px] truncate max-w-[160px]">{opcion.label}</span>
                )}
              </span>
              <span>{envio === 0 ? "Gratis" : fmt(envio)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base pt-1">
              <span>Total</span><span>{fmt(totalFinal)}</span>
            </div>
          </div>

          {error && (
            <p className="text-xs px-3 py-2 bg-red-500/10 text-red-600" style={{ borderRadius: "var(--st-radius)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full py-3 font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {enviando ? "Confirmando..." : "Confirmar pedido"}
          </button>

          <p className="text-[11px] text-center" style={{ color: "hsl(var(--st-muted))" }}>
            Los precios y el stock se validan en el servidor al confirmar.
          </p>
        </aside>
      </form>
    </div>
  );
}
