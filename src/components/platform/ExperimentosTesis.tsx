/**
 * Platform › Métricas › «Experimentos»: E1–E5 de docs/TESIS.md §9 con lo
 * medido hoy contra el criterio escrito antes de empezar y la fecha. La
 * revisión pivotar/perseverar es el 2026-12-15.
 */
import { hoyAR } from "@/lib/fechaAR";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "@/lib/publicDataSource";
import { experimentosTesis, type MedicionesTesis } from "@/lib/experimentosTesis";
import { AlertTriangle, Loader2 } from "lucide-react";

const ESTADO = {
  logrado: { texto: "Logrado", clase: "text-emerald-700 dark:text-emerald-400" },
  en_curso: { texto: "En curso", clase: "text-muted-foreground" },
  vencido: { texto: "Venció sin lograrse", clase: "text-destructive" },
};

export default function ExperimentosTesis() {
  const [m, setM] = useState<MedicionesTesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinFuncion, setSinFuncion] = useState(false);

  useEffect(() => {
    let activo = true;
    void supabase.rpc("platform_experimentos_tesis" as never).then(({ data, error: e }) => {
      if (!activo) return;
      if (e) {
        if (isMissingFunction(e)) setSinFuncion(true);
        else { console.error("platform_experimentos_tesis", e); setError(e.message); }
        return;
      }
      setM(data as unknown as MedicionesTesis);
    });
    return () => { activo = false; };
  }, []);

  if (sinFuncion) {
    return (
      <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>La base todavía no expone <code>platform_experimentos_tesis</code> (migración 20261011001200).</p>
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">No se pudieron leer los experimentos: {error}</p>;
  if (!m) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</p>;

  const hoy = hoyAR();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Criterios escritos en la tesis antes de empezar. Revisión pivotar o perseverar: 15/12/2026.</p>
      <ul className="space-y-2">
        {experimentosTesis(m, hoy).map(x => (
          <li key={x.id} className="border border-border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{x.id} · {x.hipotesis}</p>
              <span className={`text-xs font-medium ${ESTADO[x.estado].clase}`}>{ESTADO[x.estado].texto}</span>
            </div>
            <p className="mt-1">{x.medido}</p>
            <p className="text-xs text-muted-foreground">Éxito si {x.criterio} · hasta el {x.fecha.split("-").reverse().join("/")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
