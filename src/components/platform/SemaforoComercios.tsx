/**
 * Semáforo de comercios: rojo/ámbar/verde con lo que traba a cada uno y en qué
 * pantalla del comercio se resuelve. Ver `src/lib/saludComercios.ts`.
 * El destino se muestra como texto: un enlace llevaría al administrador a su
 * propio comercio, no al del cliente.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { contarSemaforos, pantallaDe, type SaludComercio, type Semaforo } from "@/lib/saludComercios";
import { Loader2 } from "lucide-react";

const ESTILO: Record<Semaforo, { punto: string; texto: string }> = {
  rojo: { punto: "bg-destructive", texto: "Rojo" },
  ambar: { punto: "bg-amber-500", texto: "Ámbar" },
  verde: { punto: "bg-emerald-500", texto: "Verde" },
};

export default function SemaforoComercios() {
  const [comercios, setComercios] = useState<SaludComercio[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    supabase.rpc("platform_salud_comercios" as never).then(({ data, error: rpcError }) => {
      if (!activo) return;
      if (rpcError) { console.error("platform_salud_comercios", rpcError); setError(rpcError.message); return; }
      setComercios(((data as unknown as { comercios?: SaludComercio[] })?.comercios) ?? []);
    });
    return () => { activo = false; };
  }, []);

  if (error) return <p className="text-sm text-destructive">No se pudo medir la salud de los comercios: {error}</p>;
  if (!comercios) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Midiendo</p>;

  const cuenta = contarSemaforos(comercios);

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {(["rojo", "ambar", "verde"] as const).map(s => (
          <span key={s} className="mr-4 inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${ESTILO[s].punto}`} aria-hidden />{ESTILO[s].texto}: <span className="font-semibold tabular-nums">{cuenta[s]}</span>
          </span>
        ))}
      </p>
      <div className="overflow-x-auto border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Comercio</th>
              <th className="px-3 py-2 text-left font-medium">Qué lo traba</th>
              <th className="px-3 py-2 text-right font-medium">Ventas 7 días</th>
            </tr>
          </thead>
          <tbody>
            {comercios.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Ningún comercio con actividad.</td></tr>}
            {comercios.map(c => (
              <tr key={c.org_id} className="border-b border-border/50 last:border-0 align-top">
                <td className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${ESTILO[c.semaforo].punto}`} aria-label={ESTILO[c.semaforo].texto} />
                    {c.nombre}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.motivos.length === 0 ? <span className="text-muted-foreground">Nada que resolver.</span> : (
                    <ul className="space-y-1">
                      {c.motivos.map(m => (
                        <li key={m.id}>
                          <span className={m.nivel === "rojo" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>{m.texto}</span>
                          <span className="text-muted-foreground"> · se resuelve en {pantallaDe(m.ir)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.ventas_7d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
