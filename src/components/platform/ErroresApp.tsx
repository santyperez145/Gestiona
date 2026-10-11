/**
 * Platform › Métricas › «Errores»: los errores que vieron comercios y
 * clientes en los últimos 7 días, agrupados (migración 20261011002000). Sin
 * datos personales: mensaje limpio y ruta sin query string.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "@/lib/publicDataSource";
import { AlertTriangle, Loader2 } from "lucide-react";

interface FilaError { origen: string; mensaje: string; ruta: string | null; veces: number; dias: number; ultima_vez: string }
const ORIGEN: Record<string, string> = { panel: "Panel", tienda: "Tienda", otro: "Inicio de sesión / web" };

export default function ErroresApp() {
  const [filas, setFilas] = useState<FilaError[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinFuncion, setSinFuncion] = useState(false);

  useEffect(() => {
    let activo = true;
    void supabase.rpc("platform_errores_app" as never, { p_dias: 7 } as never).then(({ data, error: e }) => {
      if (!activo) return;
      if (e) {
        if (isMissingFunction(e)) setSinFuncion(true);
        else { console.error("platform_errores_app", e); setError(e.message); }
        setFilas([]);
        return;
      }
      setFilas((data ?? []) as FilaError[]);
    });
    return () => { activo = false; };
  }, []);

  if (sinFuncion) {
    return (
      <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>La base todavía no expone <code>platform_errores_app</code> (migración 20261011002000).</p>
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">No se pudieron leer los errores: {error}</p>;
  if (!filas) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</p>;
  if (filas.length === 0) return <p className="text-sm text-muted-foreground">Sin errores registrados en los últimos 7 días.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Últimos 7 días, agrupados por error. Sin datos de las personas: mensaje limpio y página sin parámetros.</p>
      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Dónde</th>
              <th className="px-3 py-2 text-left font-medium">Error</th>
              <th className="px-3 py-2 text-right font-medium">Veces</th>
              <th className="px-3 py-2 text-right font-medium">Días</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-b border-border last:border-0 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{ORIGEN[f.origen] ?? f.origen}</td>
                <td className="px-3 py-2"><p className="break-words">{f.mensaje}</p>{f.ruta && <p className="text-xs text-muted-foreground">{f.ruta}</p>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.veces}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.dias}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
