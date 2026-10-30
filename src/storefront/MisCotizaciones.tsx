/**
 * Mis cotizaciones en Mi cuenta (2026-10-30, migración 20261030000700):
 * cada pedido de precio hecho desde la tienda, su estado y, cuando el
 * comercio responde, el link para pagarlo. Sin pedidos no se muestra.
 */
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction, retryPublicRead } from "@/lib/publicDataSource";
import { BRAND_ORIGIN } from "@/lib/brand";
import { fechaLocal } from "@/lib/fechaAR";
import { estadoDeCotizacion, type CotizacionDelComprador } from "@/lib/cotizacionTienda";
import { useStore } from "./storeContext";

const borde = { borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" } as const;
const tenue = { color: "hsl(var(--st-muted))" } as const;

export default function MisCotizaciones({ slug, sesion }: { slug: string; sesion: string }) {
  const { fmt } = useStore();
  const [lista, setLista] = useState<CotizacionDelComprador[]>([]);

  useEffect(() => {
    let vivo = true;
    void retryPublicRead(() => supabase.rpc("mis_cotizaciones_tienda" as never, { p_slug: slug } as never))
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          if (!isMissingFunction(error)) console.error("[cotizaciones] no se pudieron leer", error.message);
          setLista([]);
          return;
        }
        setLista(Array.isArray(data) ? (data as CotizacionDelComprador[]) : []);
      }, () => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [slug, sesion]);

  if (lista.length === 0) return null;
  return (
    <section className="mb-10" aria-labelledby="mis-cotizaciones-titulo">
      <h2 id="mis-cotizaciones-titulo" className="font-semibold mb-3 flex items-center gap-2"><FileText className="w-4 h-4" />Mis cotizaciones</h2>
      <div className="space-y-2">
        {lista.map(c => {
          const estado = estadoDeCotizacion(c.estado);
          return (
            <div key={c.quote_number} className="border p-3 flex items-center justify-between gap-3 flex-wrap" style={borde}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.quote_number} · {c.items === 1 ? "1 producto" : `${c.items} productos`}</p>
                <p className="text-xs" style={tenue}>
                  {fechaLocal(c.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} · {estado.texto}
                  {c.estado === "respondida" && Number(c.total) > 0 ? ` · ${fmt(Number(c.total))}` : ""}
                </p>
              </div>
              {c.pago_id && (
                <a href={`${BRAND_ORIGIN}/pagar/${encodeURIComponent(c.pago_id)}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center min-h-11 px-4 text-sm font-semibold"
                  style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}>
                  Ver y pagar
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
