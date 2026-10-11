/**
 * «Lo que buscan y no encuentran»: los términos más buscados en la tienda sin
 * resultados en los últimos 30 días. Pistas para sumar productos o nombrar
 * mejor los que ya hay. Ver `src/lib/busquedasSinResultado.ts`.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import { topBusquedas, type FilaBusqueda } from "@/lib/busquedasSinResultado";

export default function BusquedasSinResultado({ orgId }: { orgId: string | null | undefined }) {
  const [top, setTop] = useState<FilaBusqueda[] | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let activo = true;
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    supabase.from("store_busquedas_sin_resultado" as never)
      .select("termino, veces").eq("org_id", orgId).gte("dia", desde).limit(2000)
      .then(({ data, error }) => {
        if (!activo) return;
        if (error) {
          if (!isMissingRelation(error)) console.error("store_busquedas_sin_resultado", error);
          setTop([]);
          return;
        }
        setTop(topBusquedas((data ?? []) as FilaBusqueda[]));
      });
    return () => { activo = false; };
  }, [orgId]);

  if (!top) return null;
  return (
    <section className="rounded-xl border border-border p-4 text-sm" aria-labelledby="busquedas-sin-resultado">
      <h3 id="busquedas-sin-resultado" className="font-semibold">Lo que buscan y no encuentran</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Búsquedas en tu tienda que no dieron resultados en los últimos 30 días. Sumá esos productos o usá esas palabras en los nombres de los que ya tenés.
      </p>
      {top.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Todavía no hay búsquedas sin resultados.</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {top.map(b => (
            <li key={b.termino} className="flex items-center justify-between gap-3">
              <span>«{b.termino}»</span>
              <span className="tabular-nums text-muted-foreground">{b.veces} {b.veces === 1 ? "vez" : "veces"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
