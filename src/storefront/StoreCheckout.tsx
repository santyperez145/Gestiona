import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { Loader2, ShoppingBag, Lock } from "lucide-react";

const METODO_LABEL: Record<string, string> = {
  mercadopago: "MercadoPago",
  transferencia: "Transferencia bancaria",
  efectivo: "Efectivo al recibir",
  stripe: "Tarjeta (Stripe)",
  paypal: "PayPal",
};

export default function StoreCheckout() {
  const { store, cart, subtotal, shippingCost, total, fmt, clearCart } = useStore();
  const navigate = useNavigate();
  const base = `/tienda/${store?.slug ?? ""}`;

  const metodos = store?.payment_methods?.length ? store.payment_methods : ["transferencia"];
  const [form, setForm] = useState({
    nombre: "", email: "", telefono: "",
    calle: "", ciudad: "", provincia: "", cp: "", notas: "",
    metodo: metodos[0],
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const { data, error: rpcError } = await supabase.rpc("create_store_order", {
      p_slug: store!.slug,
      p_items: cart.map(l => ({ product_id: l.productId, quantity: l.qty })),
      p_customer_name: form.nombre,
      p_customer_email: form.email,
      p_customer_phone: form.telefono || null,
      p_shipping: {
        calle: form.calle, ciudad: form.ciudad,
        provincia: form.provincia, cp: form.cp, notas: form.notas,
      },
      p_payment_method: form.metodo,
      p_notes: form.notas || null,
    });

    setEnviando(false);

    if (rpcError) {
      // El RPC valida stock y precios del lado del servidor, así que sus
      // mensajes son los que importan (ej: "Sin stock suficiente de X").
      setError(rpcError.message.replace(/^.*?:\s*/, ""));
      return;
    }

    const orderNumber = (data as any)?.order_number;
    clearCart();

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
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Provincia</span>
                <input value={form.provincia} onChange={e => set("provincia", e.target.value)} className={input} style={inputStyle} />
              </label>
              <label>
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>Código postal</span>
                <input value={form.cp} onChange={e => set("cp", e.target.value)} className={input} style={inputStyle} inputMode="numeric" />
              </label>
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Medio de pago</h2>
            <div className="space-y-2">
              {metodos.map(m => (
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
                  <span className="text-sm">{METODO_LABEL[m] ?? m}</span>
                </label>
              ))}
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
              <div key={l.productId} className="flex gap-2 text-sm">
                <span className="tabular-nums shrink-0" style={{ color: "hsl(var(--st-muted))" }}>{l.qty}×</span>
                <span className="flex-1 leading-tight line-clamp-2">{l.name}</span>
                <span className="shrink-0">{fmt(l.price * l.qty)}</span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t space-y-1 text-sm" style={{ borderColor: "hsl(var(--st-border))" }}>
            <div className="flex justify-between">
              <span style={{ color: "hsl(var(--st-muted))" }}>Subtotal</span><span>{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "hsl(var(--st-muted))" }}>Envío</span>
              <span>{shippingCost === 0 ? "Gratis" : fmt(shippingCost)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base pt-1">
              <span>Total</span><span>{fmt(total)}</span>
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
