import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Eye, Loader2 } from "lucide-react";

/**
 * Preview del rediseño UX/UI propuesto — sin copiar assets de competidores.
 * Usa tokens shadcn (`primary`, `card`, `border`, `muted`, `destructive`).
 * Valida jerarquía visual, contraste y estados completos (loading, empty, success, error).
 */
export default function DesignPreview() {
  return (
    <section className="space-y-6 px-2 sm:px-4" aria-label="Previews de rediseño UX">
      <header className="mb-2">
        <h2 className="text-xl font-display font-bold tracking-tight text-foreground">Rediseño UX — vista profesional</h2>
        <p className="text-xs text-muted-foreground">Tokens shadcn + Tailwind · responsive · estados completos · sin IDs visibles</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Card profesional */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Transacción reciente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-medium">Tienda Central</p>
                <p className="text-xs text-muted-foreground">Online · Confirmado</p>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-relaxed">
              <span className="font-medium text-foreground">$12.450</span> · <span className="text-muted-foreground">Margen explicado</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1">Ver detalle</Button>
              <Button size="sm" className="h-8 gap-1">Acción</Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabla operativa */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Cola operativa</CardTitle>
            <Badge variant="secondary" className="text-[10px]">3 activos</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Fuente</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  <tr className="hover:bg-muted/20"><td className="px-3 py-2">MercadoLibre webhook</td><td className="px-3 py-2"><Badge variant="warning" className="text-[10px]">Falló</Badge></td><td className="px-3 py-2"><Button size="sm" variant="outline" className="h-7 text-[11px]">Reintentar</Button></td></tr>
                  <tr className="hover:bg-muted/20"><td className="px-3 py-2">Entrega de eventos</td><td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">Pendiente</Badge></td><td className="px-3 py-2"><Button size="sm" variant="outline" className="h-7 text-[11px]">Ver</Button></td></tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando estado actualizado</div>
          </CardContent>
        </Card>
      </div>

      {/* Estados de formulario / input */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-2">
          <p className="text-xs font-medium">Botón primario</p>
          <Button size="sm">Guardar presentación</Button>
          <Button size="sm" variant="outline">Cancelar</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-2">
          <p className="text-xs font-medium">Input con label</p>
          <Input placeholder="Nombre de la tienda" />
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-2">
          <p className="text-xs font-medium">Estado vacío</p>
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-2">
          <p className="text-xs font-medium">Estado error</p>
          <Input error placeholder="Revisá este campo" />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">Nota: los previews son de código (no captura de navegador). Se validan responsive con `sm:`, `md:`, `lg:` de Tailwind. No hay copia de UI de Shopify/Tiendanube: se traduce la jerarquía (header → tabs → filtro → tabla → acciones) con el propio sistema de tokens Nerqia.</p>
    </section>
  );
}
