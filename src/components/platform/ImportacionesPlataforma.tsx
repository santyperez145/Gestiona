/**
 * Importaciones de catálogo por comercio: E3 de docs/TESIS.md («catálogo
 * listo en < 30 min») y las trabadas, que antes sólo se veían en la base.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRelation } from "@/lib/publicDataSource";
import { plural } from "@/lib/plural";
import { META_E3_MINUTOS, resumirImportaciones, type ImportacionPlataforma } from "@/lib/importacionesPlataforma";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function ImportacionesPlataforma() {
  const [filas, setFilas] = useState<ImportacionPlataforma[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinVista, setSinVista] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from("platform_importaciones_catalogo" as never).select("*").order("created_at", { ascending: false });
    if (queryError) {
      if (isMissingRelation(queryError)) setSinVista(true);
      else { console.error("platform_importaciones_catalogo", queryError); setError(queryError.message); }
      setFilas([]);
      return;
    }
    setFilas((data ?? []) as ImportacionPlataforma[]);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (sinVista) {
    return (
      <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>La base todavía no expone <code>platform_importaciones_catalogo</code> (migración 20261010002700).</p>
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">No se pudieron leer las importaciones: {error}</p>;
  if (!filas) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</p>;

  const comercios = resumirImportaciones(filas);
  const trabadas = comercios.reduce((n, c) => n + c.trabadas, 0);
  const cumplen = comercios.filter(c => c.cumpleE3).length;

  return (
    <div className="space-y-4">
      <div className="border border-border p-4 text-sm space-y-1">
        <p className="font-semibold">
          {plural(cumplen, "comercio")} con el catálogo importado en menos de {META_E3_MINUTOS} minutos · {plural(comercios.length, "comercio")} intentaron importar
        </p>
        {trabadas > 0 && (
          <p className="text-destructive">
            {plural(trabadas, "importación trabada", "importaciones trabadas")}: sin terminar y sin avance hace más de {META_E3_MINUTOS} minutos.
          </p>
        )}
      </div>
      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Comercio</th>
              <th className="px-3 py-2 text-right font-medium">Intentos</th>
              <th className="px-3 py-2 text-right font-medium">Terminadas</th>
              <th className="px-3 py-2 text-right font-medium">Trabadas</th>
              <th className="px-3 py-2 text-left font-medium">Llegó hasta</th>
              <th className="px-3 py-2 text-right font-medium">Más rápida</th>
            </tr>
          </thead>
          <tbody>
            {comercios.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Ningún comercio importó todavía.</td></tr>
            )}
            {comercios.map(c => (
              <tr key={c.orgId} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 font-medium">{c.comercio}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.intentos}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.terminadas}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${c.trabadas ? "text-destructive" : ""}`}>{c.trabadas}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                  {c.avanceMaximo ? `${c.avanceMaximo.aplicadas.toLocaleString("es-AR")} de ${c.avanceMaximo.total.toLocaleString("es-AR")} filas` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.mejorMinutos !== null ? `${c.mejorMinutos.toLocaleString("es-AR")} min` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
