import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import OrderTracking from "./OrderTracking";
import StorePaymentBrick, { type StorePaymentBrickConfig } from "./StorePaymentBrick";
import { supabase } from "@/integrations/supabase/client";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { getStoreOrderSecure, type StoreOrderAccessRow } from "@/lib/publicDataSource";
import { useStore } from "./storeContext";
import {
  markStoreConversionSent,
  storeConversionEventId,
  trackOrderPlaced,
  trackPaymentCompleted,
  wasStoreConversionSent,
} from "./tracking";
import { canRetryStorePayment, isStorePaymentReversed } from "@/lib/storeOrderPayment";
import { esPedidoRetiro } from "@/lib/storeOrderQueue";
import {
  etiquetaCostoEntrega, etiquetaDireccionEntrega, etiquetaWhatsAppPedido,
  introPagoRevertido, introPedidoPagado, textoWhatsAppPedido,
} from "@/lib/storeOrderBuyerCopy";
import { esMedioGestionaPay } from "@/lib/gestionaPay";
import { consumeOrderAccessFragment, readOrderAccessToken, saveOrderAccessToken } from "./orderAccess";
import { useStoreTrackingRuntimeReady } from "./trackingConsent";
import { CheckCircle2, Loader2, MessageCircle, Clock, CreditCard, AlertTriangle, ShieldCheck, Copy } from "lucide-react";

type Order = StoreOrderAccessRow;
type CargaPedido =
  | { ok: true; row: Order | null }
  | { ok: false };

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-2.5 min-h-11"
      style={{ background: "hsl(var(--st-bg))", borderRadius: "var(--st-radius)" }}
    >
      <span className="text-xs shrink-0" style={{ color: "hsl(var(--st-muted))" }}>{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-mono truncate" style={{ color: "hsl(var(--st-text))" }}>{value}</span>
        <button
          type="button"
          className="shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center"
          style={{ color: "hsl(var(--st-muted))" }}
          aria-label={`Copiar ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied
            ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--st-link))" }} />
            : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

export default function StoreOrder() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const { store, fmt, basePath: base } = useStore();
  const trackingRuntimeReady = useStoreTrackingRuntimeReady();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const orderRef = useRef<Order | null>(null);
  const [emailVerificacion, setEmailVerificacion] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [accesoError, setAccesoError] = useState<string | null>(null);
  const [pagando, setPagando] = useState(false);
  const [preparandoTarjeta, setPreparandoTarjeta] = useState(false);
  const [pagoError, setPagoError] = useState<string | null>(null);
  const [pagoAviso, setPagoAviso] = useState<string | null>(null);
  const [brickConfig, setBrickConfig] = useState<StorePaymentBrickConfig | null>(null);
  const [tarjetaDisponible, setTarjetaDisponible] = useState(true);
  const [pagoEnProceso, setPagoEnProceso] = useState(false);
  const pedidoPendiente = order?.payment_status === "pending";

  const cargar = useCallback(async (email?: string): Promise<CargaPedido> => {
    if (!store?.slug || !orderNumber) return { ok: false };
    const token = accessToken
      ?? consumeOrderAccessFragment(store.slug, orderNumber)
      ?? readOrderAccessToken(store.slug, orderNumber);
    const result = await getStoreOrderSecure({
      slug: store.slug,
      orderNumber,
      accessToken: token,
      email,
    });
    if (result.error) {
      setLoading(false);
      // Un corte a mitad de un poll no puede borrar un pedido ya visto ni
      // pedir el email como si el número no existiera.
      if (orderRef.current) {
        setAccesoError("No pudimos actualizar el pedido. Reintentá.");
        return { ok: false };
      }
      setLoadError(true);
      setAccesoError(null);
      return { ok: false };
    }
    const row = result.data;
    if (row?.access_token) {
      const saved = saveOrderAccessToken(store.slug, orderNumber, row.access_token);
      if (saved && saved !== accessToken) setAccessToken(saved);
    }
    orderRef.current = row;
    setOrder(row);
    setLoadError(false);
    setAccesoError(null);
    setLoading(false);
    return { ok: true, row };
  }, [store?.slug, orderNumber, accessToken]);

  useEffect(() => { cargar(); }, [cargar]);

  const trackedItems = useMemo(() => (order?.items ?? []).map(i => ({
    id: (i as { product_id?: string }).product_id ?? i.name,
    name: i.name,
    price: Number(i.unit_price),
    quantity: Number(i.quantity),
  })), [order?.items]);
  const trackingConfigurado = trackingRuntimeReady;

  // Pedido colocado y pago acreditado son hechos distintos. El receipt local
  // evita reemitir al recargar; transaction_id/event_id cubren el proveedor.
  useEffect(() => {
    if (!order || !trackingConfigurado) return;
    const eventId = storeConversionEventId("placed", order.order_number);
    if (wasStoreConversionSent(localStorage, eventId)) return;
    const attempted = trackOrderPlaced(
      order.order_number,
      trackedItems,
      Number(order.total),
      store?.currency ?? "ARS",
    );
    if (attempted) markStoreConversionSent(localStorage, eventId);
  }, [order, store?.currency, trackedItems, trackingConfigurado]);

  useEffect(() => {
    if (!order || order.payment_status !== "paid" || !store?.tiktok_pixel_id || !trackingRuntimeReady) return;
    const eventId = storeConversionEventId("paid", order.order_number);
    if (wasStoreConversionSent(localStorage, eventId)) return;
    const attempted = trackPaymentCompleted(
      order.order_number,
      trackedItems,
      Number(order.total),
      store?.currency ?? "ARS",
    );
    if (attempted) markStoreConversionSent(localStorage, eventId);
  }, [order, store?.currency, store?.tiktok_pixel_id, trackedItems, trackingRuntimeReady]);

  // Al volver de MercadoPago el webhook puede tardar unos segundos en
  // confirmar. Se reintenta un rato para no mostrarle "pendiente" a alguien
  // que acaba de pagar.
  useEffect(() => {
    if (!order || order.payment_status !== "pending") return;
    let intentos = 0;
    const t = setInterval(async () => {
      intentos++;
      const r = await cargar();
      const fresco = r.ok ? r.row : orderRef.current;
      if (intentos >= 5 || (fresco && fresco.payment_status !== "pending")) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
    // Solo se dispara al montar con estado pendiente, no en cada refresco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.order_number]);

  // Un pago con tarjeta puede quedar `pending`/`in_process` mientras MP hace
  // una validación adicional. Durante ese intervalo no se habilita otro botón
  // de cobro: dos intentos separados son peor experiencia que esperar unos
  // segundos y pueden terminar en dos débitos. Si el webhook lo resuelve, la
  // página recupera su estado normal; si no, el comprador puede volver más
  // tarde al mismo pedido.
  useEffect(() => {
    if (!pagoEnProceso || !pedidoPendiente) {
      if (pagoEnProceso && !pedidoPendiente) setPagoEnProceso(false);
      return;
    }
    let intentos = 0;
    const t = setInterval(async () => {
      intentos++;
      const r = await cargar();
      const fresco = r.ok ? r.row : orderRef.current;
      if (intentos >= 10 || (fresco && fresco.payment_status !== "pending")) {
        clearInterval(t);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [pagoEnProceso, pedidoPendiente, cargar]);

  const abrirPagoExterno = async () => {
    if (!store?.slug || !order) return;
    setPagando(true);
    setPagoError(null);
    const { data, error } = await supabase.functions.invoke("store-pay", {
      body: { action: "redirect", slug: store.slug, orderNumber: order.order_number, accessToken, returnUrl: window.location.origin },
    });
    setPagando(false);
    const url = (data as { url?: string } | null)?.url;
    if (url) window.location.href = url;
    else setPagoError((await mensajeDeEdgeFunction(error, data)) || "No se pudo abrir el pago online.");
  };

  const prepararPagoConTarjeta = async () => {
    if (!store?.slug || !order) return;
    setPreparandoTarjeta(true);
    setPagoError(null);
    setPagoAviso(null);
    const { data, error } = await supabase.functions.invoke("store-pay", {
      body: { action: "brick-config", slug: store.slug, orderNumber: order.order_number, accessToken },
    });
    setPreparandoTarjeta(false);
    const config = data as Partial<StorePaymentBrickConfig> & { error?: string; fallback?: string } | null;
    if (!error && config && typeof config.publicKey === "string" &&
        Number.isFinite(Number(config.amount)) && Number(config.amount) > 0) {
      setTarjetaDisponible(true);
      setBrickConfig({ publicKey: config.publicKey, amount: Number(config.amount) });
    } else if (!error && config?.fallback === "redirect") {
      setTarjetaDisponible(false);
      setPagoAviso(config.error ?? "El pago con tarjeta está temporalmente pausado. Podés continuar en MercadoPago.");
    } else {
      setPagoError(
        (await mensajeDeEdgeFunction(error, data))
          || config?.error
          || "No se pudo preparar el pago con tarjeta. Podés usar MercadoPago para elegir otro medio.",
      );
    }
  };

  const pagoEmbebidoTerminado = async (status: string) => {
    setBrickConfig(null);
    setPagoEnProceso(true);
    if (status === "approved") {
      setPagoAviso("¡Pago aprobado! Estamos actualizando el estado de tu pedido.");
    } else {
      setPagoAviso("MercadoPago está procesando el pago. Te avisamos apenas quede confirmado.");
    }
    await cargar();
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin opacity-50" />
      </div>
    );
  }

  if (loadError && !order) {
    return (
      <div className="max-w-md mx-auto px-4 py-20">
        <div
          className="border p-6 text-center"
          data-storefront-state="order-error"
          role="alert"
          style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
        >
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-600" />
          <h1 className="text-xl font-bold">No pudimos cargar tu pedido</h1>
          <p className="text-sm mt-2" style={{ color: "hsl(var(--st-muted))" }}>
            La red falló. Reintentá; no te pedimos el email hasta poder consultar.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setLoadError(false);
              void cargar(emailVerificacion.trim() || undefined);
            }}
            className="w-full mt-5 min-h-11 px-4 py-2.5 text-sm font-medium"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            Reintentar
          </button>
          <Link to={base || "/"} className="inline-block mt-5 text-sm hover:underline" style={{ color: "hsl(var(--st-link))" }}>
            Volver a la tienda
          </Link>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-md mx-auto px-4 py-20">
        <div
          className="border p-6 text-center"
          style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
        >
          <ShieldCheck className="w-10 h-10 mx-auto mb-3" style={{ color: "hsl(var(--st-link))" }} />
          <h1 className="text-xl font-bold">Verificá tu pedido</h1>
          <p className="text-sm mt-2" style={{ color: "hsl(var(--st-muted))" }}>
            Para proteger tus datos, ingresá el email que usaste al comprar.
          </p>
          <form
            className="mt-5 text-left"
            onSubmit={async (event) => {
              event.preventDefault();
              setVerificando(true);
              setAccesoError(null);
              const r = await cargar(emailVerificacion.trim());
              setVerificando(false);
              if (!r.ok) {
                setAccesoError("La red falló. Reintentá.");
                return;
              }
              if (!r.row) setAccesoError("No pudimos verificar esos datos. Revisalos o escribile a la tienda.");
            }}
          >
            <label htmlFor="order-email" className="text-xs font-medium">Email de la compra</label>
            <input
              id="order-email"
              type="email"
              autoComplete="email"
              required
              value={emailVerificacion}
              onChange={(event) => setEmailVerificacion(event.target.value)}
              className="w-full mt-1 px-3 py-2.5 text-sm border bg-transparent outline-none focus:ring-1"
              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
            />
            <button
              type="submit"
              disabled={verificando}
              className="w-full mt-3 min-h-11 px-4 py-2.5 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
            >
              {verificando && <Loader2 className="w-4 h-4 animate-spin" />}
              Ver mi pedido
            </button>
          </form>
          {accesoError && <p className="text-xs text-red-600 mt-3" role="alert">{accesoError}</p>}
          <Link to={`${base}/seguimiento`} className="inline-block mt-4 text-sm hover:underline" style={{ color: "hsl(var(--st-link))" }}>
            ¿No tenés el link? Consultá con número y email
          </Link>
          <Link to={base || "/"} className="inline-block mt-3 text-sm hover:underline" style={{ color: "hsl(var(--st-link))" }}>
            Volver a la tienda
          </Link>
        </div>
      </div>
    );
  }

  const dir = order.shipping_address ?? {};
  const dirTexto = [dir.calle, dir.ciudad, dir.provincia, dir.cp].filter(Boolean).join(", ");
  const esRetiro = esPedidoRetiro(order);
  const lugarRetiro = (store?.pickup_address || dirTexto || "").trim();
  const horarioRetiro = store?.pickup_instructions?.trim() || "";

  const pagado = order.payment_status === "paid";
  const fallido = order.payment_status === "failed";
  const pagoRevertido = isStorePaymentReversed(order.payment_status);
  const puedeReintentarPago = canRetryStorePayment(order.payment_status);
  const transferenciaPendiente = pedidoPendiente
    && order.payment_method === "transferencia"
    && Boolean(order.bank_cbu || order.bank_alias);
  const waTexto = encodeURIComponent(textoWhatsAppPedido({
    orderNumber: order.order_number,
    totalFmt: fmt(Number(order.total)),
    esRetiro,
    pagado,
    pagoRevertido,
    transferenciaPendiente,
    chargedBack: order.payment_status === "charged_back",
  }));

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="text-center">
        {pagado
          ? <CheckCircle2 className="w-14 h-14 mx-auto mb-3" style={{ color: "hsl(var(--st-link))" }} />
          : pagoRevertido
            ? <AlertTriangle className="w-14 h-14 mx-auto mb-3 text-red-600" />
          : <Clock className="w-14 h-14 mx-auto mb-3" style={{ color: "hsl(var(--st-muted))" }} />}

        <h1 className="text-2xl font-bold">
          {pagado ? "¡Pago confirmado!" : pagoRevertido ? "El pago fue revertido" : "¡Gracias por tu compra!"}
        </h1>
        <p className="mt-1" style={{ color: "hsl(var(--st-muted))" }}>
          Tu pedido <strong style={{ color: "hsl(var(--st-text))" }}>{order.order_number}</strong> quedó registrado.
        </p>
        <p className="text-sm mt-2" style={{ color: "hsl(var(--st-muted))" }}>
          {pagado
            ? <>{introPedidoPagado(esRetiro)} Te escribimos a <strong style={{ color: "hsl(var(--st-text))" }}>{order.customer_email}</strong>.</>
            : pagoRevertido
              ? <>{introPagoRevertido(esRetiro)} Te escribimos a <strong style={{ color: "hsl(var(--st-text))" }}>{order.customer_email}</strong> para coordinar los próximos pasos.</>
              : transferenciaPendiente
                ? <>Transferí el total a la cuenta de abajo. Cuando acredite, te avisamos a <strong style={{ color: "hsl(var(--st-text))" }}>{order.customer_email}</strong>.</>
                : <>Te vamos a escribir a <strong style={{ color: "hsl(var(--st-text))" }}>{order.customer_email}</strong> para coordinar el pago y la entrega.</>}
        </p>
        {accesoError && (
          <p className="text-xs text-red-600 mt-3" role="alert">
            {accesoError}{" "}
            <button
              type="button"
              className="underline font-medium"
              onClick={() => { void cargar(); }}
            >
              Reintentar
            </button>
          </p>
        )}
      </div>

      {transferenciaPendiente && (
        <div
          className="mt-6 border p-4 space-y-2"
          style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
        >
          <p className="text-sm font-medium">Datos para transferir</p>
          <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
            Usá el importe exacto del pedido. El comercio confirma cuando ve el crédito.
          </p>
          {order.bank_holder && <CopyField label="Titular" value={order.bank_holder} />}
          {order.bank_name && <CopyField label="Banco" value={order.bank_name} />}
          {order.bank_cbu && <CopyField label="CBU" value={order.bank_cbu} />}
          {order.bank_alias && <CopyField label="Alias" value={order.bank_alias} />}
          <CopyField label="Importe" value={fmt(Number(order.total))} />
        </div>
      )}

      {/* Pago pendiente con Nerqia Pay: se ofrece pagar ahora.
          Sirve tanto si el link falló al confirmar como si el comprador
          abandonó el checkout y volvió después. */}
      {puedeReintentarPago && esMedioGestionaPay(order.payment_method) && (
        <div
          className="mt-6 border p-4 text-center"
          style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
        >
          <p className="text-sm font-medium">
            {fallido ? "El pago no se completó" : "Tu pedido está esperando el pago"}
          </p>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--st-muted))" }}>
            Podés pagarlo ahora con Nerqia Pay y lo preparamos enseguida.
          </p>
          {pagoEnProceso ? (
            <div className="mt-4 py-3 text-xs" style={{ color: "hsl(var(--st-muted))" }} aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Estamos confirmando el pago. No hace falta que lo intentes otra vez.
            </div>
          ) : brickConfig ? (
            <div className="mt-4 text-left">
              <p className="text-sm font-medium text-center mb-2">Pagá con tarjeta sin salir de la tienda</p>
              <StorePaymentBrick
                slug={store?.slug ?? ""}
                orderNumber={order.order_number}
                accessToken={accessToken}
                config={brickConfig}
                onResult={pagoEmbebidoTerminado}
              />
              <div className="mt-3 pt-3 border-t text-center" style={{ borderColor: "hsl(var(--st-border))" }}>
                <p className="text-xs mb-2" style={{ color: "hsl(var(--st-muted))" }}>¿Preferís billetera, efectivo u otro medio?</p>
                <button
                  onClick={abrirPagoExterno}
                  disabled={pagando}
                  className="text-xs underline underline-offset-4 disabled:opacity-60"
                  style={{ color: "hsl(var(--st-link))" }}
                >
                  {pagando ? "Abriendo el pago..." : "Elegir otro medio"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col sm:flex-row gap-2 justify-center">
              {tarjetaDisponible && (
                <button
                  onClick={prepararPagoConTarjeta}
                  disabled={preparandoTarjeta || pagando}
                  className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                >
                  {preparandoTarjeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  Pagar con tarjeta {fmt(Number(order.total))}
                </button>
              )}
              <button
                onClick={abrirPagoExterno}
                disabled={pagando || preparandoTarjeta}
                className="w-full sm:w-auto min-h-11 px-5 py-2.5 text-sm font-medium border disabled:opacity-60"
                style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
              >
                {pagando ? "Abriendo el pago..." : tarjetaDisponible ? "Otros medios" : "Pagar con Nerqia Pay"}
              </button>
            </div>
          )}
          {pagoAviso && <p className="text-xs mt-3" style={{ color: "hsl(var(--st-muted))" }}>{pagoAviso}</p>}
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
            <span style={{ color: "hsl(var(--st-muted))" }}>{etiquetaCostoEntrega(esRetiro)}</span>
            <span>{Number(order.shipping_cost) === 0 ? "Gratis" : fmt(Number(order.shipping_cost))}</span>
          </div>
          <div className="flex justify-between font-semibold text-base pt-1">
            <span>Total</span><span>{fmt(Number(order.total))}</span>
          </div>
        </div>

        {(esRetiro ? lugarRetiro : dirTexto) && (
          <div className="pt-2 border-t text-sm" style={{ borderColor: "hsl(var(--st-border))" }}>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: "hsl(var(--st-muted))" }}>
              {etiquetaDireccionEntrega(esRetiro)}
            </p>
            <p>{esRetiro ? lugarRetiro : dirTexto}</p>
            {esRetiro && horarioRetiro ? (
              <p className="text-xs mt-1" style={{ color: "hsl(var(--st-muted))" }}>{horarioRetiro}</p>
            ) : null}
          </div>
        )}
      </div>

      <OrderTracking orderNumber={order.order_number} email={order.customer_email} esRetiro={esRetiro} />

      <div className="mt-6 flex flex-col sm:flex-row gap-2">
        <a
          href={`https://wa.me/?text=${waTexto}`}
          target="_blank" rel="noopener noreferrer"
          className="flex-1 py-2.5 text-center text-sm font-medium inline-flex items-center justify-center gap-2"
          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
        >
          <MessageCircle className="w-4 h-4" /> {etiquetaWhatsAppPedido(pagado)}
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
