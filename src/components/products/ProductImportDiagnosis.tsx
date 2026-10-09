import { AlertCircle, CheckCircle2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProblemaImportacion } from "@/lib/productImportDiagnosis";

/** Problemas agrupados por causa, con su arreglo; la corrección siempre la elige el comercio. */
export default function ProductImportDiagnosis({ problemas, disabled, onCorregir }: {
  problemas: ProblemaImportacion[];
  disabled?: boolean;
  onCorregir: (problema: ProblemaImportacion) => void;
}) {
  if (!problemas.length) {
    return <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />No encontramos problemas en las filas. El servidor vuelve a validar todo antes de guardar.</p>;
  }
  const bloqueantes = problemas.filter(p => p.bloquea).reduce((s, p) => s + p.cantidad, 0);
  return <section aria-labelledby="import-diagnosis-title" className="space-y-3 border-y border-border py-3">
    <div>
      <h4 id="import-diagnosis-title" className="text-sm font-semibold">Problemas detectados y cómo resolverlos</h4>
      <p className="text-xs text-muted-foreground">{bloqueantes > 0 ? `${bloqueantes.toLocaleString("es-AR")} filas no se podrán importar así.` : "Sólo hay advertencias."} Cada corrección es opcional y se puede revisar en la tabla.</p>
    </div>
    <ul className="space-y-3">
      {problemas.map(problema => <li key={problema.id} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${problema.bloquea ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-medium">{problema.titulo} <span className="font-normal text-muted-foreground">· {problema.cantidad.toLocaleString("es-AR")} {problema.cantidad === 1 ? "fila" : "filas"}</span></p>
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Por qué:</span> {problema.causa}</p>
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Cómo se arregla:</span> {problema.arreglo}</p>
          <p className="text-xs text-muted-foreground">Ejemplos: {problema.ejemplos.map(e => `fila ${e.fila} (${e.nombre}${e.valor ? `: “${e.valor}”` : ""})`).join(" · ")}</p>
        </div>
        {problema.correccion && <Button size="sm" variant="outline" className="shrink-0" disabled={disabled} onClick={() => onCorregir(problema)}>
          <Wand2 className="mr-2 h-3.5 w-3.5" />{problema.correccion.etiqueta}
        </Button>}
      </li>)}
    </ul>
  </section>;
}
