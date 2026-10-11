/**
 * Escalera de docs/TESIS.md §8 en vivo: cuatro escalones con su meta, cuál
 * manda ahora y las ventas por semana de cada comercio (E1: ≥ 20 por semana).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ESCALONES, META_E1_VENTAS_SEMANA, REVISION_PIVOTAR, cumpleE1, escalonActual, semanasCronologicas,
  type Escalera,
} from "@/lib/escaleraTesis";
import { Loader2 } from "lucide-react";

export default function EscaleraTesis() {
  const [datos, setDatos] = useState<Escalera | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    supabase.rpc("platform_escalera_tesis" as never).then(({ data, error: rpcError }) => {
      if (!activo) return;
      if (rpcError) { console.error("platform_escalera_tesis", rpcError); setError(rpcError.message); return; }
      setDatos(data as unknown as Escalera);
    });
    return () => { activo = false; };
  }, []);

  if (error) return <p className="text-sm text-destructive">No se pudo medir la escalera: {error}</p>;
  if (!datos) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Midiendo</p>;

  const actual = escalonActual(datos);
  const revision = new Date(`${REVISION_PIVOTAR}T12:00:00`).toLocaleDateString("es-AR");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 text-sm">
        {ESCALONES.map(s => {
          const valor = Number(datos[s.id]) || 0;
          const cumplido = valor >= s.meta;
          return (
            <div key={s.id} className={`border p-3 ${actual?.id === s.id ? "border-primary" : "border-border"}`}>
              <p className="text-xs text-muted-foreground">{s.nombre}</p>
              <p className={`text-xl font-semibold tabular-nums ${cumplido ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                {valor} <span className="text-sm font-normal text-muted-foreground">de {s.meta}</span>
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        {actual ? <>Escalón de ahora: <span className="font-medium text-foreground">{actual.nombre}</span>. </> : "Los cuatro escalones están cumplidos. "}
        Revisión pivotar o perseverar: {revision}.
      </p>

      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Comercio</th>
              <th className="px-3 py-2 text-left font-medium">Ventas por semana (8 semanas, la última a la derecha)</th>
              <th className="px-3 py-2 text-right font-medium">Esta semana</th>
            </tr>
          </thead>
          <tbody>
            {datos.comercios.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Ningún comercio con ventas ni tienda todavía.</td></tr>
            )}
            {datos.comercios.map(c => {
              const semanas = semanasCronologicas(c);
              const max = Math.max(1, ...semanas);
              return (
                <tr key={c.org_id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-medium">{c.nombre}</td>
                  <td className="px-3 py-2">
                    <div className="flex h-8 items-end gap-1" aria-label={`Ventas por semana: ${semanas.join(", ")}`}>
                      {semanas.map((n, i) => (
                        <div key={i} className="w-4 rounded-sm bg-primary/70" style={{ height: `${Math.max(2, (n / max) * 100)}%` }} title={`${n}`} />
                      ))}
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${cumpleE1(c) ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                    {Number(c.semanas?.[0]) || 0} <span className="text-xs text-muted-foreground">/ {META_E1_VENTAS_SEMANA}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
