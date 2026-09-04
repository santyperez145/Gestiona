import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { useStoreTrackingConsent } from "./trackingConsent";

/**
 * Preferencia por tienda y por origen. Los píxeles de terceros no se cargan
 * hasta una aceptación afirmativa; las métricas operativas first-party siguen
 * funcionando porque no identifican al comprador ni salen de Nerqia.
 */
export default function StoreTrackingConsent({ enabled }: { enabled: boolean }) {
  const { decision, disabled, choose } = useStoreTrackingConsent();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(enabled && decision === null);
  }, [enabled, decision]);

  if (!enabled || disabled) return null;

  const panel = open ? (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="store-tracking-consent-title"
      data-storefront-state="tracking-consent"
      className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-2xl border p-4 shadow-2xl sm:p-5"
      style={{
        borderColor: "hsl(var(--st-border))",
        background: "hsl(var(--st-surface))",
        color: "hsl(var(--st-text))",
        borderRadius: "var(--st-radius)",
      }}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "hsl(var(--st-link))" }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="store-tracking-consent-title" className="text-sm font-semibold">
            Tu privacidad en esta tienda
          </h2>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "hsl(var(--st-muted))" }}>
            Las funciones esenciales mantienen el carrito y el pedido. Si aceptás medición,
            esta tienda también activa Meta, Google Analytics o TikTok para entender campañas.
            Nerqia no agrega tu nombre, email ni dirección a esos eventos.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
              onClick={() => { choose("denied"); setOpen(false); }}
            >
              Usar sólo lo esencial
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm font-medium"
              style={{
                background: "hsl(var(--st-accent))",
                color: "hsl(var(--st-accent-fg))",
                borderRadius: "var(--st-radius)",
              }}
              onClick={() => { choose("granted"); setOpen(false); }}
            >
              Aceptar medición
            </button>
          </div>
        </div>
        {decision !== null && (
          <button
            type="button"
            className="grid min-h-11 min-w-11 shrink-0 place-items-center"
            aria-label="Cerrar preferencias de privacidad"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </aside>
  ) : null;

  return (
    <>
      <button type="button" className="min-h-11 hover:underline" onClick={() => setOpen(true)}>
        Preferencias de privacidad
      </button>
      {panel}
    </>
  );
}
