import { Check } from "lucide-react";
import type { PasoDelArmado } from "@/lib/storeFirstPublish";

/**
 * La barra de pasos del armado de la tienda (2026-11-03): cuánto falta para
 * publicar, siempre a la vista mientras la tienda no está publicada.
 *
 * Con todo listo menos publicar, el último paso es un botón (2026-11-04): el
 * comercio que llegaba desde el menú no encontraba dónde publicar.
 */
export default function PasosDeLaTienda({
  pasos,
  onPublicar,
}: {
  pasos: PasoDelArmado[];
  onPublicar?: () => void;
}) {
  const hechos = pasos.filter(p => p.done).length;
  const actual = pasos.findIndex(p => !p.done);
  if (actual === -1) return null;
  return (
    <nav aria-label="Pasos para publicar la tienda" className="rounded-xl border border-border/60 bg-card p-3 sm:p-4">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">
        Tu tienda: {hechos} de {pasos.length} pasos listos
      </p>
      <ol className="flex flex-wrap gap-x-4 gap-y-2">
        {pasos.map((paso, i) => {
          const marca = (
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                paso.done ? "border-emerald-600 bg-emerald-600 text-white" : i === actual ? "border-primary text-primary" : "border-border"
              }`}
            >
              {paso.done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
          );
          const estado = <span className="sr-only">{paso.done ? " (listo)" : i === actual ? " (paso actual)" : " (pendiente)"}</span>;
          const esBotonPublicar = Boolean(onPublicar) && paso.id === "publicar" && i === actual;
          return (
            <li
              key={paso.id}
              aria-current={i === actual ? "step" : undefined}
              className={`flex items-center gap-1.5 text-[13px] ${
                paso.done ? "text-foreground" : i === actual ? "font-semibold text-primary" : "text-muted-foreground"
              }`}
            >
              {esBotonPublicar ? (
                <button
                  type="button"
                  onClick={onPublicar}
                  className="-my-3 flex min-h-11 items-center gap-1.5 rounded-md underline underline-offset-2 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {marca}
                  {paso.label}
                  {estado}
                </button>
              ) : (
                <>
                  {marca}
                  {paso.label}
                  {estado}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
