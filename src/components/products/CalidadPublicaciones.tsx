/**
 * Calidad de las publicaciones, arriba del catálogo.
 *
 * Es lo que MercadoLibre le muestra a cualquier vendedor y Tiendanube no
 * tiene: en vez de un listado donde todo se ve igual, dice qué falta y **por
 * dónde conviene empezar**. El orden no es por cantidad de productos sino por
 * impacto total: cargarle el SKU a 60 productos es más trabajo y rinde menos
 * que sacarle la foto a los 10 que no tienen.
 *
 * Cada arreglo filtra el listado de abajo, porque una lista de pendientes que
 * no lleva a ningún lado no se completa nunca.
 *
 * Las reglas y el puntaje viven en `productQuality.ts` (22 tests).
 */
import { useMemo, useState } from "react";
import { Sparkles, ChevronDown, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  resumirCatalogo, evaluarProducto, tonoDeNivel, nivelDePuntaje,
  type ProductoParaEvaluar, type ImpactoId,
} from "@/lib/productQuality";

interface Props {
  productos: ProductoParaEvaluar[];
  /** Filtro activo del listado, para marcar cuál está aplicado. */
  filtroActivo: ImpactoId | null;
  onFiltrar: (id: ImpactoId | null) => void;
}

export default function CalidadPublicaciones({ productos, filtroActivo, onFiltrar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const resumen = useMemo(() => resumirCatalogo(productos), [productos]);

  if (resumen.productos === 0) return null;

  const tono = tonoDeNivel(nivelDePuntaje(resumen.puntajePromedio));

  return (
    <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
      <button
        onClick={() => setAbierto(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {abierto ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Calidad de las publicaciones</p>
          <p className="text-[11px] text-muted-foreground">
            {resumen.ranking.length === 0
              ? "Todas las fichas están completas."
              : `${resumen.incompletas > 0
                  ? `${resumen.incompletas} ${resumen.incompletas === 1 ? "ficha muy incompleta" : "fichas muy incompletas"} · `
                  : ""}${resumen.ranking[0].productos} sin ${resumen.ranking[0].label.toLowerCase()}`}
          </p>
        </div>
        <span className={`font-mono font-bold text-lg shrink-0 ${tono}`}>
          {resumen.puntajePromedio}
          <span className="text-xs font-normal text-muted-foreground">/100</span>
        </span>
      </button>

      {abierto && (
        <div className="border-t border-border/40 p-4 space-y-3">
          {resumen.ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              No queda nada por completar.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Ordenado por lo que más rinde arreglar, no por cuántos productos lo
                tienen. Tocá uno para ver sólo esos productos.
              </p>
              <div className="space-y-2">
                {resumen.ranking.map(f => {
                  const activo = filtroActivo === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => onFiltrar(activo ? null : f.id)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                        activo
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/50 bg-muted/20 hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{f.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {f.productos} {f.productos === 1 ? "producto" : "productos"}
                        </span>
                        {activo && (
                          <span className="text-[11px] text-primary ml-auto">filtrando ↓</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{f.porque}</p>
                    </button>
                  );
                })}
              </div>
              {filtroActivo && (
                <Button variant="outline" size="sm" onClick={() => onFiltrar(null)}>
                  Ver todos los productos
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Badge compacto para la fila del listado. */
export function BadgeCalidad({ producto }: { producto: ProductoParaEvaluar }) {
  const ev = useMemo(() => evaluarProducto(producto), [producto]);
  if (ev.puntaje >= 95) return null;   // lo completo no necesita aviso
  return (
    <span
      className={`font-mono text-[11px] ${tonoDeNivel(ev.nivel)}`}
      title={"Falta: " + ev.faltantes.map(f => f.label).join(", ")}
    >
      {ev.puntaje}
    </span>
  );
}
