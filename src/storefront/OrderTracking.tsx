/**
 * Seguimiento del pedido, para el comprador.
 *
 * Se pide con número de orden + email, que es el mismo par con el que ya se
 * abre la página del pedido: no se abre ninguna puerta nueva y no hace falta
 * tener cuenta. "¿Dónde está mi pedido?" es la consulta número uno de
 * cualquier tienda, y contestarla sola ahorra el mensaje.
 *
 * Retiro ≠ envío: los pasos salen de `pasosSeguimiento`. El RPC trae
 * carrier/shipping_service de la orden; el padre puede pasar `esRetiro` si
 * ya lo sabe (gracias) para no esperar al round-trip.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { carrierLabel } from "@/lib/carriers";
import { esPedidoRetiro } from "@/lib/storeOrderQueue";
import {
  indicePasoSeguimiento, pasosSeguimiento,
} from "@/lib/storeOrderBuyerCopy";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Home,
  Loader2,
  Package,
  RefreshCw,
  Store,
  Truck,
} from "lucide-react";

interface Tracking {
  found: boolean;
  fulfillment_status?: string;
  tracking_number?: string | null;
  carrier?: string | null;
  shipping_service?: string | null;
  shipment_status?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  tracking_url?: string | null;
  ordered_at?: string | null;
}

const fecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "long" }) : null;

const ICONOS: Record<string, typeof Check> = {
  pending: Check,
  processing: Package,
  shipped: Truck,
  delivered: Home,
};

const ICONOS_RETIRO: Record<string, typeof Check> = {
  pending: Check,
  processing: Package,
  shipped: Store,
  delivered: Home,
};

export default function OrderTracking({
  orderNumber, email, esRetiro: esRetiroProp,
}: {
  orderNumber: string;
  email: string;
  /** Si el padre ya sabe (gracias). Si no, se deduce del RPC. */
  esRetiro?: boolean;
}) {
  const [t, setT] = useState<Tracking | null>(null);
  const [estado, setEstado] = useState<"loading" | "ready" | "error">("loading");
  const solicitud = useRef(0);

  const cargar = useCallback(async () => {
    if (!orderNumber || !email) return;
    const estaSolicitud = ++solicitud.current;
    setEstado("loading");
    try {
      const { data, error } = await supabase.rpc("get_order_tracking", {
        p_order_number: orderNumber,
        p_email: email,
      });
      if (error) throw error;
      const siguiente = data as unknown as Tracking | null;
      // Esta pieza vive dentro de una orden que ya fue verificada. Un `found`
      // falso no significa que el pedido desapareció: es una lectura
      // inconsistente y se presenta como recuperable, nunca como vacío.
      if (!siguiente?.found) throw new Error("Tracking no disponible para una orden verificada");
      if (estaSolicitud !== solicitud.current) return;
      setT(siguiente);
      setEstado("ready");
    } catch (error) {
      if (estaSolicitud !== solicitud.current) return;
      console.error("No se pudo cargar el seguimiento del pedido", error);
      setEstado("error");
    }
  }, [orderNumber, email]);

  useEffect(() => {
    void cargar();
    return () => { solicitud.current += 1; };
  }, [cargar]);

  if (!orderNumber || !email) return null;

  if (estado === "loading") {
    return (
      <section
        className="mt-6 border p-4"
        data-storefront-state="tracking-loading"
        role="status"
        aria-live="polite"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: "hsl(var(--st-muted))" }}>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Actualizando seguimiento…
        </div>
      </section>
    );
  }

  if (estado === "error" || !t?.found) {
    return (
      <section
        className="mt-6 border p-4"
        data-storefront-state="tracking-error"
        role="alert"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "hsl(var(--st-accent))" }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">No pudimos actualizar el seguimiento</p>
            <p className="mt-1 text-xs" style={{ color: "hsl(var(--st-muted))" }}>
              Tu pedido sigue guardado. Revisá tu conexión y volvé a intentar.
            </p>
            <button
              type="button"
              onClick={() => { void cargar(); }}
              className="mt-3 inline-flex min-h-11 items-center gap-2 border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reintentar seguimiento
            </button>
          </div>
        </div>
      </section>
    );
  }

  const esRetiro = esRetiroProp ?? esPedidoRetiro(t);
  const pasos = pasosSeguimiento(esRetiro);
  const iconos = esRetiro ? ICONOS_RETIRO : ICONOS;
  const actual = indicePasoSeguimiento(t.fulfillment_status, esRetiro);
  const hechos = actual + 1;

  return (
    <section
      className="mt-6 border p-4"
      data-storefront-state="tracking-ready"
      style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
    >
      <p className="text-xs uppercase tracking-wide mb-3" style={{ color: "hsl(var(--st-muted))" }}>
        Seguimiento
      </p>

      <ol className="space-y-3">
        {pasos.map((paso, i) => {
          const hecho = i < hechos;
          const Icono = iconos[paso.id] ?? Check;
          const cuando = paso.id === "shipped" ? fecha(t.picked_up_at)
            : paso.id === "delivered" ? fecha(t.delivered_at)
            : paso.id === "pending" ? fecha(t.ordered_at)
            : null;
          return (
            <li key={paso.id} className="flex items-start gap-3">
              <span
                className="w-7 h-7 rounded-full grid place-items-center shrink-0"
                style={{
                  background: hecho ? "hsl(var(--st-accent))" : "hsl(var(--st-border))",
                  color: hecho ? "hsl(var(--st-accent-fg))" : "hsl(var(--st-muted))",
                }}
              >
                <Icono className="w-3.5 h-3.5" />
              </span>
              <div className="pt-0.5">
                <p className="text-sm" style={{ opacity: hecho ? 1 : 0.5 }}>{paso.label}</p>
                {hecho && cuando && (
                  <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>{cuando}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!esRetiro && t.tracking_number && (
        <div className="mt-4 pt-3 border-t text-sm" style={{ borderColor: "hsl(var(--st-border))" }}>
          <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
            {carrierLabel(t.carrier)}
          </p>
          <p className="font-mono font-medium mt-0.5">{t.tracking_number}</p>
          {t.tracking_url && (
            <a
              href={t.tracking_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs mt-1.5 hover:underline"
              style={{ color: "hsl(var(--st-accent))" }}
            >
              Seguirlo en el sitio del correo <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
