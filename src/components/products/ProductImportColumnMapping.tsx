import type { WorkbookImportResult } from "@/lib/productImportWorkbook";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RotateCcw } from "lucide-react";

type Props = {
  workbook: WorkbookImportResult;
  disabled: boolean;
  onChange: (column: string, target: string) => void;
  onDetect: () => void;
};

/** Every source column has one visible destination; omissions never change catalog fields. */
export default function ProductImportColumnMapping({ workbook, disabled, onChange, onDetect }: Props) {
  const assigned = workbook.columns.filter(column => workbook.columnMapping[column.id]).length;
  return <section className="space-y-3 border-y border-border py-4" aria-labelledby="import-column-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h4 id="import-column-heading" className="text-sm font-semibold">Asigná las columnas del archivo</h4>
        <p className="text-xs text-muted-foreground">{assigned} de {workbook.columns.length} columnas asignadas. Revisá los ejemplos y elegí qué dato representa cada columna.</p>
      </div>
      <Button variant="outline" size="sm" disabled={disabled} onClick={onDetect}><RotateCcw className="mr-2 h-4 w-4" />Restaurar detección</Button>
    </div>
    <p className="text-xs text-muted-foreground">Un destino sólo puede usarse una vez. Para moverlo, dejá primero su columna actual en «No importar». Las columnas omitidas no modifican ese dato del catálogo.</p>
    <div className="max-h-[440px] overflow-y-auto overscroll-contain" tabIndex={0} aria-label="Asignación de columnas del archivo">
      <ol className="divide-y divide-border">
        {workbook.columns.map(column => {
          const target = workbook.columnMapping[column.id] || "";
          const changed = target !== column.suggestedTarget;
          return <li key={column.id} className="grid min-w-0 gap-3 py-3 sm:grid-cols-2 sm:items-center">
            <div className="min-w-0 space-y-1 sm:pr-4">
              <div className="flex min-w-0 items-start gap-2"><span className="shrink-0 rounded bg-muted px-2 py-1 font-mono text-xs">{column.letter}</span><p className="min-w-0 break-words text-sm font-medium">{column.label}</p></div>
              <p className="break-words text-xs text-muted-foreground">{column.samples.length ? `Ejemplos: ${column.samples.join(" · ")}` : "Sin valores de ejemplo"}</p>
            </div>
            <div className="min-w-0 space-y-1">
              <Select value={target || "__none"} onValueChange={value => onChange(column.id, value === "__none" ? "" : value)} disabled={disabled}>
                <SelectTrigger aria-label={`Destino de columna ${column.letter}: ${column.label}`} className="h-11 w-full text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No importar</SelectItem>
                  {workbook.mappingFields.map(field => <SelectItem key={field.id} value={field.id} disabled={Object.entries(workbook.columnMapping).some(([id, value]) => id !== column.id && value === field.id)}>{field.label}{field.required ? " · Obligatorio" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <Badge variant="secondary" className="bg-muted text-foreground">{!target ? "No se importa" : changed ? "Asignación manual" : "Detectada automáticamente · revisar"}</Badge>
            </div>
          </li>;
        })}
      </ol>
    </div>
  </section>;
}
