/**
 * Core Web Vitals de las tiendas con visitas reales (migración
 * 20261011001000): por comercio, LCP, CLS e INP de los últimos 28 días y el %
 * de visitas en el rango «bueno» de Google. Pasa si ≥ 75% en las tres.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "@/lib/publicDataSource";
import { resumirVitales, META_VITALES_PCT, type FilaVitales } from "@/lib/vitalesPlataforma";
import { AlertTriangle, Loader2 } from "lucide-react";

const NOMBRE: Record<string, string> = { lcp: "Carga (LCP)", inp: "Respuesta (INP)", cls: "Estabilidad (CLS)" };

export default function VelocidadTiendas() {
  const [filas, setFilas] = useState<FilaVitales[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinFuncion, setSinFuncion] = useState(false);

  useEffect(() => {
    let activo = true;
    void supabase.rpc("platform_vitales_tiendas" as never, { p_dias: 28 } as never).then(({ data, error: e }) => {
      if (!activo) return;
      if (e) {
        if (isMissingFunction(e)) setSinFuncion(true);
        else { console.error("platform_vitales_tiendas", e); setError(e.message); }
        setFilas([]);
        return;
      }
      setFilas((data ?? []) as FilaVitales[]);
    });
    return () => { activo = false; };
  }, []);

  if (sinFuncion) {
    return (
      <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>La base todavía no expone <code>platform_vitales_tiendas</code> (migración 20261011001000).</p>
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">No se pudo leer la velocidad de las tiendas: {error}</p>;
  if (!filas) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</p>;

  const comercios = resumirVitales(filas);
  if (comercios.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay visitas medidas. Se miden solas desde el 11/10 en cada tienda publicada.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Últimos 28 días, visitas reales. Una tienda pasa si al menos el {META_VITALES_PCT}% de las visitas está en el rango bueno de Google en las tres métricas.
      </p>
      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Comercio</th>
              {(["lcp", "inp", "cls"] as const).map(m => <th key={m} className="px-3 py-2 text-right font-medium">{NOMBRE[m]}</th>)}
              <th className="px-3 py-2 text-left font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {comercios.map(c => (
              <tr key={c.org_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{c.comercio}</td>
                {(["lcp", "inp", "cls"] as const).map(m => {
                  const v = c.metricas[m];
                  return (
                    <td key={m} className={`px-3 py-2 text-right tabular-nums ${v && v.pct_buenas !== null && v.pct_buenas < META_VITALES_PCT ? "text-destructive" : ""}`}>
                      {v ? `${v.pct_buenas ?? "—"}% · ${v.visitas}` : "—"}
                    </td>
                  );
                })}
                <td className="px-3 py-2">{c.estado === "pasa" ? "Pasa" : c.estado === "no_pasa" ? "No pasa" : "Pocos datos"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Cada celda: % de visitas buenas · visitas medidas. Con menos de 20 visitas por métrica el resultado es «Pocos datos».</p>
    </div>
  );
}
