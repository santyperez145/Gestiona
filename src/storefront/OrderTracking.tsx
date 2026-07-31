/**
 * Seguimiento del pedido, para el comprador.
 *
 * Se pide con número de orden + email, que es el mismo par con el que ya se
 * abre la página del pedido: no se abre ninguna puerta nueva y no hace falta
 * tener cuenta. "¿Dónde está mi pedido?" es la consulta número uno de
 * cualquier tienda, y contestarla sola ahorra el mensaje.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { carrierLabel } from "@/lib/carriers";
import { Package, Truck, Home, Check, ExternalLink } from "lucide-react";

interface Tracking {
  found: boolean;
  fulfillment_status?: string;
  tracking_number?: string | null;
  carrier?: string | null;
  shipment_status?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  tracking_url?: string | null;
  ordered_at?: string | null;
}

/** Los cuatro momentos que al comprador le importan, en orden. */
const PASOS = [
  { id: "pending", label: "Pedido recibido", icon: Check },
  { id: "processing", label: "Preparando el envío", icon: Package },
  { id: "shipped", label: "En camino", icon: Truck },
  { id: "delivered", label: "Entregado", icon: Home },
];

const fecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "long" }) : null;

export default function OrderTracking({
  orderNumber, email,
}: { orderNumber: string; email: string }) {
  const [t, setT] = useState<Tracking | null>(null);

  useEffect(() => {
    if (!orderNumber || !email) return;
    supabase
      .rpc("get_order_tracking", { p_order_number: orderNumber, p_email: email })
      .then(({ data }) => setT(data as unknown as Tracking), () => {});
  }, [orderNumber, email]);

  if (!t?.found) return null;

  const actual = Math.max(0, PASOS.findIndex(p => p.id === t.fulfillment_status));
  // Un pedido entregado tiene los cuatro pasos hechos; uno recién recibido, uno.
  const hechos = actual + 1;

  return (
    <section
      className="mt-6 border p-4"
      style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
    >
      <p className="text-xs uppercase tracking-wide mb-3" style={{ color: "hsl(var(--st-muted))" }}>
        Seguimiento
      </p>

      <ol className="space-y-3">
        {PASOS.map((paso, i) => {
          const hecho = i < hechos;
          const Icono = paso.icon;
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

      {t.tracking_number && (
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
