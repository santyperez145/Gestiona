import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Package } from "lucide-react";
import { formatARS } from "@/lib/supabaseStore";
import type { SimilarResult } from "@/lib/perfumeMatch";

interface RecoProduct {
  id: string;
  name: string;
  brand?: string;
  image_url?: string | null;
  sale_price_ars?: number | null;
  discount_price_ars?: number | null;
}

function scoreColor(score: number): string {
  if (score >= 60) return "text-emerald-400 bg-emerald-500/15 border-emerald-500/30";
  if (score >= 35) return "text-primary bg-primary/15 border-primary/30";
  return "text-yellow-400 bg-yellow-500/15 border-yellow-500/30";
}

// Modal "tonto": recibe los resultados ya calculados. Reutilizable tanto para
// "perfumes similares a X" como para "recomendados según el cliente".
export default function PerfumeRecommenderModal<P extends RecoProduct>({
  open,
  onOpenChange,
  title,
  subtitle,
  results,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle?: string;
  results: SimilarResult<P>[];
  onPick?: (product: P) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />{title}
          </DialogTitle>
        </DialogHeader>
        {subtitle && <p className="text-xs text-muted-foreground -mt-1">{subtitle}</p>}

        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="w-9 h-9 mb-3 opacity-30" />
            <p className="text-sm text-center">Sin coincidencias suficientes.<br />Cargá la ficha olfativa de más perfumes para mejorar las recomendaciones.</p>
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {results.map(({ product, score }) => {
              const eff = product.discount_price_ars && Number(product.discount_price_ars) < Number(product.sale_price_ars)
                ? Number(product.discount_price_ars) : Number(product.sale_price_ars || 0);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onPick?.(product)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border border-border/60 bg-card hover:border-primary/40 transition-colors text-left ${onPick ? "cursor-pointer" : "cursor-default"}`}
                >
                  <div className="w-11 h-11 rounded-md bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center">
                    {product.image_url
                      ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                      : <Package className="w-5 h-5 text-muted-foreground/40" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    {product.brand && <p className="text-[11px] text-muted-foreground truncate">{product.brand}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {eff > 0 && <p className="text-xs font-mono font-semibold">{formatARS(eff)}</p>}
                    <span className={`inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scoreColor(score)}`}>
                      {score}% match
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
