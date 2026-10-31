/**
 * «Velocidad de tu tienda» (2026-10-31): las Core Web Vitals de visitas reales
 * de los últimos 28 días (`store_vitales`, que ya mide la tienda desde el
 * 11/10 y hasta ahora sólo veía la plataforma), con la vara de Google y qué
 * hacer con lo que no pasa. Ver `src/lib/velocidadTienda.ts`.
 */
import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import { diaAR } from "@/lib/fechaAR";
import {
  CONSEJO_METRICA, DIAS_VELOCIDAD, META_BUENAS, MINIMO_VISITAS, NOMBRE_METRICA, NOMBRE_PAGINA,
  resumirVitales, type FilaVitales,
} from "@/lib/velocidadTienda";

export default function VelocidadDeTuTienda({ orgId }: { orgId: string | null | undefined }) {
  const [filas, setFilas] = useState<FilaVitales[] | null>(null);
  const [error, setError] = useState(false);
  const [disponible, setDisponible] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    let activo = true;
    setFilas(null);
    setError(false);
    const desde = diaAR(Date.now() - (DIAS_VELOCIDAD - 1) * 86_400_000);
    void supabase.from("store_vitales" as never).select("metrica, pagina, buenas, regulares, malas")
      .eq("org_id" as never, orgId as never).gte("dia" as never, desde as never).limit(5000)
      .then(({ data, error: fallo }) => {
        if (!activo) return;
        if (fallo) {
          if (isMissingRelation(fallo)) { setDisponible(false); return; }
          console.error("[velocidad] no se pudo leer store_vitales", fallo);
          setError(true);
          return;
        }
        setFilas((data ?? []) as FilaVitales[]);
      });
    return () => { activo = false; };
  }, [orgId]);

  if (!orgId || !disponible) return null;
  const resumen = filas ? resumirVitales(filas) : null;
  const sinVisitas = resumen ? resumen.metricas.every(m => m.visitas === 0) : false;

  return (
    <section className="rounded-xl border border-border p-4 text-sm" aria-labelledby="velocidad-de-tu-tienda" data-testid="velocidad-de-tu-tienda">
      <div className="flex items-start gap-2">
        <Gauge className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 id="velocidad-de-tu-tienda" className="font-semibold">Velocidad de tu tienda</h3>
          <p className="text-xs text-muted-foreground">
            Últimos {DIAS_VELOCIDAD} días, con visitas reales de compradores. La vara de Google: al menos {META_BUENAS}% de visitas buenas en cada medida.
          </p>
        </div>
        {resumen && resumen.pasa !== null && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${resumen.pasa ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"}`}>
            {resumen.pasa ? "Pasa" : "A mejorar"}
          </span>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-muted-foreground">No pudimos leer la velocidad de la tienda. Probá de nuevo en un rato.</p>}
      {!error && !resumen && <p className="mt-3 text-xs text-muted-foreground">Leyendo…</p>}
      {resumen && sinVisitas && (
        <p className="mt-3 text-xs text-muted-foreground">Todavía no hay visitas medidas: aparecen cuando entran compradores a la tienda.</p>
      )}
      {resumen && !sinVisitas && (
        <ul className="mt-3 space-y-2">
          {resumen.metricas.map(m => (
            <li key={m.metrica} className="rounded-lg border border-border/60 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{NOMBRE_METRICA[m.metrica]}</span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {m.estado === "pocos_datos"
                    ? `Pocos datos (${m.visitas} de ${MINIMO_VISITAS} visitas)`
                    : `${m.pctBuenas}% buenas · ${m.visitas} visitas`}
                </span>
              </div>
              {m.estado === "a_mejorar" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {CONSEJO_METRICA[m.metrica]}
                  {m.peorPagina && NOMBRE_PAGINA[m.peorPagina] ? ` Lo más lento es ${NOMBRE_PAGINA[m.peorPagina]}.` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
