import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import OrderTracking from "./OrderTracking";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { trackPurchase } from "./tracking";
import { CheckCircle2, Loader2, MessageCircle, Clock, CreditCard } from "lucide-react";

interface Order {
  order_number: string;
  customer_name: string;
  customer_email: string;
  items: { name: string; quantity: number; unit_price: number; total: number }[];
  subtotal: number;
  shipping_cost: number;
  total: number;
  payment_method: string;
  payment_status: string;
  fulfillment_status: string;
  shipping_address: Record<string, string>;
  created_at: string;
}

export default function StoreOrder() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const { store, fmt } = useStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagando, setPagando] = useState(false);
  const [pagoError, setPagoError] = useState<string | null>(null);
  const base = `/tienda/${store?.slug ?? ""}`;

  const cargar = useCallback(async () => {
    if (!store?.slug || !orderNumber) return null;
    const { data } = await supabase.rpc("get_store_order", {
      p_slug: store.slug, p_order_number: orderNumber,
    });
    const row = (Array.isArray(data) ? data[0] : data) as Order | undefined;
    setOrder(row ?? null);
    setLoading(false);
    return row ?? null;
  }, [store?.slug, orderNumber]);

  useEffect(() => { cargar(); }, [cargar]);

  // Compra concretada. Se dispara una sola vez por pedido: el comprador puede
  // recargar esta pagina y no queremos contar la venta dos veces.
  const purchaseEnviado = useRef<string | null>(null);
  useEffect(() => {
    if (!order || purchaseEnviado.current === order.order_number) return;
    purchaseEnviado.current = order.order_number;
    trackPurchase(
      order.order_number,
      (order.items ?? []).map(i => ({
        id: (i as { product_id?: string }).product_id ?? i.name,
        name: i.name, price: Number(i.unit_price), quantity: Number(i.quantity),
      })),
      Number(order.total),
      store?.currency ?? "ARS",
    );
  }, [order, store?.currency]);

  // Al volver de MercadoPago el webhook puede tardar unos segundos en
  // confirmar. Se reintenta un rato para no mostrarle "pendiente" a alguien
  // que acaba de pagar.
  useEffect(() => {
    if (!order || order.payment_status !== "pending") return;
    let intentos = 0;
    const t = setInterval(async () => {
      intentos++;
      const fresco = await cargar();
      if (intentos >= 5 || (fresco && fresco.payment_status !== "pending")) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
    // Solo se dispara al montar con estado pendiente, no en cada refresco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.order_number]);

  const pagar = async () => {
    if (!store?.slug || !order) return;
    setPagando(true);
    const { data } = await supabase.functions.invoke("store-pay", {
      body: { slug: store.slug, orderNumber: order.order_number, returnUrl: window.location.origin },
    });
    setPagando(false);
    const url = (data as any)?.url;
    if (url) window.location.href = url;
    else setPagoError((data as any)?.error ?? "No se pudo abrir el pago online.");
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin opacity-50" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <p className="font-medium">No encontramos ese pedido</p>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
          Revisá el número o escribinos y lo buscamos nosotros.
        </p>
        <Link to={base} className="inline-block mt-5 text-sm hover:underline" style={{ color: "hsl(var(--st-accent))" }}>
          Volver a la tienda
        </Link>
      </div>
    );
  }

  const dir = order.shipping_address ?? {};
  const dirTexto = [dir.calle, dir.ciudad, dir.provincia, dir.cp].filter(Boolean).join(", ");

  const waTexto = encodeURIComponent(
    `Hola! Acabo de hacer el pedido ${order.order_number} por ${fmt(Number(order.total))}. Quedo atento para coordinar el pago.`,
  );

  const pagado = order.payment_status === "paid";
  const fallido = order.payment_status === "failed";

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="text-center">
        {pagado
          ? <CheckCircle2 className="w-14 h-14 mx-auto mb-3" style={{ color: "hsl(var(--st-accent))" }} />
          : <Clock className="w-14 h-14 mx-auto mb-3" style={{ color: "hsl(var(--st-muted))" }} />}

        <h1 className="text-2xl font-bold">
          {pagado ? "¡Pago confirmado!" : "¡Gracias por tu compra!"}
        </h1>
        <p className="mt-1" style={{ color: "hsl(var(--st-muted))" }}>
          Tu pedido <strong style={{ color: "hsl(var(--st-text))" }}>{order.order_number}</strong> quedó registrado.
        </p>
        <p className="text-sm mt-2" style={{ color: "hsl(var(--st-muted))" }}>
          {pagado
            ? <>Ya estamos preparando tu envío. Te escribimos a <strong style={{ color: "hsl(var(--st-text))" }}>{order.customer_email}</strong> con las novedades.</>
            : <>Te vamos a escribir a <strong style={{ color: "hsl(var(--st-text))" }}>{order.customer_email}</strong> para coordinar el pago y la entrega.</>}
        </p>
      </div>

      {/* Pago pendiente con MercadoPago habilitado: se ofrece pagar ahora.
          Sirve tanto si el link falló al confirmar como si el comprador
          abandonó el checkout y volvió después. */}
      {!pagado && order.payment_method === "mercadopago" && (
        <div
          className="mt-6 border p-4 text-center"
          style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
        >
          <p className="text-sm font-medium">
            {fallido ? "El pago no se completó" : "Tu pedido está esperando el pago"}
          </p>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--st-muted))" }}>
            Podés pagarlo ahora con MercadoPago y lo preparamos enseguida.
          </p>
          <button
            onClick={pagar}
            disabled={pagando}
            className="mt-3 w-full sm:w-auto px-6 py-2.5 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            {pagando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Pagar {fmt(Number(order.total))}
          </button>
          {pagoError && <p className="text-xs mt-2 text-red-600">{pagoError}</p>}
        </div>
      )}

      <div
        className="mt-8 border p-4 space-y-3"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
      >
        <p className="font-semibold text-sm">Detalle del pedido</p>

        <div className="space-y-2">
          {(order.items ?? []).map((it, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="tabular-nums shrink-0" style={{ color: "hsl(var(--st-muted))" }}>{it.quantity}×</span>
              <span className="flex-1 leading-tight">{it.name}</span>
              <span className="shrink-0">{fmt(Number(it.total))}</span>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t space-y-1 text-sm" style={{ borderColor: "hsl(var(--st-border))" }}>
          <div className="flex justify-between">
            <span style={{ color: "hsl(var(--st-muted))" }}>Subtotal</span>
            <span>{fmt(Number(order.subtotal))}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "hsl(var(--st-muted))" }}>Envío</span>
            <span>{Number(order.shipping_cost) === 0 ? "Gratis" : fmt(Number(order.shipping_cost))}</span>
          </div>
          <div className="flex justify-between font-semibold text-base pt-1">
            <span>Total</span><span>{fmt(Number(order.total))}</span>
          </div>
        </div>

        {dirTexto && (
          <div className="pt-2 border-t text-sm" style={{ borderColor: "hsl(var(--st-border))" }}>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: "hsl(var(--st-muted))" }}>Envío a</p>
            <p>{dirTexto}</p>
          </div>
        )}
      </div>

      <OrderTracking orderNumber={order.order_number} email={order.customer_email} />

      <div className="mt-6 flex flex-col sm:flex-row gap-2">
        <a
          href={`https://wa.me/?text=${waTexto}`}
          target="_blank" rel="noopener noreferrer"
          className="flex-1 py-2.5 text-center text-sm font-medium inline-flex items-center justify-center gap-2"
          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
        >
          <MessageCircle className="w-4 h-4" /> Coordinar por WhatsApp
        </a>
        <Link
          to={`${base}/productos`}
          className="flex-1 py-2.5 text-center text-sm font-medium border"
          style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
        >
          Seguir comprando
        </Link>
      </div>

      <p className="text-xs text-center mt-6" style={{ color: "hsl(var(--st-muted))" }}>
        Guardá este número: <strong>{order.order_number}</strong>
      </p>
    </div>
  );
}
