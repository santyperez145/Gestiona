/**
 * Recorrido único de alta fiscal: en qué paso está el comercio y cuál sigue.
 * Ver `src/lib/recorridoAltaFiscal.ts`. Se esconde cuando ya factura en
 * producción: ahí manda la salud fiscal.
 */
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { pasosHechos, type PasoAltaFiscal } from "@/lib/recorridoAltaFiscal";

export default function RecorridoAltaFiscal({ pasos }: { pasos: PasoAltaFiscal[] }) {
  if (pasos.every(p => p.estado === "hecho")) return null;
  return (
    <section aria-labelledby="recorrido-alta-fiscal" className="bg-card border border-border/40 rounded-xl">
      <div className="px-5 py-4 border-b border-border/40">
        <h2 id="recorrido-alta-fiscal" className="font-semibold">Para empezar a facturar</h2>
        <p className="text-xs text-muted-foreground mt-1">{pasosHechos(pasos)} de {pasos.length} pasos listos.</p>
      </div>
      <ol className="divide-y divide-border/30">
        {pasos.map((p, i) => {
          const Icono = p.estado === "hecho" ? CheckCircle2 : p.estado === "actual" ? CircleDot : Circle;
          const color = p.estado === "hecho" ? "text-emerald-600 dark:text-emerald-400" : p.estado === "actual" ? "text-primary" : "text-muted-foreground";
          return (
            <li key={p.id} className="flex items-start gap-3 px-5 py-3" aria-current={p.estado === "actual" ? "step" : undefined}>
              <Icono className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${p.estado === "actual" ? "font-semibold" : "font-medium"}`}>{i + 1}. {p.titulo}</p>
                {p.estado !== "hecho" && <p className="text-xs text-muted-foreground">{p.detalle}</p>}
              </div>
              {p.estado === "actual" && (
                p.ancla.startsWith("#")
                  ? <a href={p.ancla} className="text-xs font-medium text-primary hover:underline shrink-0">Hacerlo ahora</a>
                  : <Link to={p.ancla} className="text-xs font-medium text-primary hover:underline shrink-0">Hacerlo ahora</Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
