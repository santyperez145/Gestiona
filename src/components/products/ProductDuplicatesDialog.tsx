import { useMemo, useState } from "react";
import { Copy, Loader2, Merge } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { detectarDuplicados, type ProductoComparable } from "@/lib/productDuplicates";
import { formatARS } from "@/lib/supabaseStore";

type Producto = ProductoComparable & { sale_price_ars?: number | null };
const GRUPOS_POR_PAGINA = 15;

/**
 * Revisión de duplicados: el comercio elige qué producto conserva y cuáles
 * se unifican. La base traslada stock por Kardex, mueve los códigos como
 * alternativos y elimina o archiva cada duplicado según tenga historia.
 */
export default function ProductDuplicatesDialog({ open, orgId, products, onClose, onMerged }: {
  open: boolean;
  orgId: string | null | undefined;
  products: Producto[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const grupos = useMemo(() => (open ? detectarDuplicados(products) : []), [open, products]);
  const [pagina, setPagina] = useState(0);
  // Por grupo (ids ordenados), no por índice: al unificar los grupos se recalculan.
  const [conservar, setConservar] = useState<Record<string, string>>({});
  const [excluidos, setExcluidos] = useState<Record<string, boolean>>({});
  const [unificando, setUnificando] = useState<string | null>(null);
  const claveGrupo = (g: { productos: { id: string }[] }) => g.productos.map(p => p.id).sort().join(",");
  const visibles = grupos.slice(pagina * GRUPOS_POR_PAGINA, (pagina + 1) * GRUPOS_POR_PAGINA);

  const unificar = async (grupo: (typeof grupos)[number]) => {
    const clave = claveGrupo(grupo);
    const keep = conservar[clave] ?? grupo.sugerido;
    const duplicados = grupo.productos.map(p => p.id).filter(id => id !== keep && !excluidos[id]);
    if (!orgId || !duplicados.length) return;
    setUnificando(clave);
    const { data, error } = await supabase.rpc("unificar_productos" as never, { p_org: orgId, p_keep: keep, p_duplicates: duplicados } as never) as
      { data: { eliminados?: number; archivados?: number; stock_trasladado?: number } | null; error: { message: string } | null };
    setUnificando(null);
    if (error) {
      console.error("[productos] unificar_productos", error);
      toast.error(error.message.replace(/^.*?:\s*/, "") || "No se pudo unificar");
      return;
    }
    const partes = [
      data?.eliminados ? `${data.eliminados} eliminado${data.eliminados === 1 ? "" : "s"}` : "",
      data?.archivados ? `${data.archivados} archivado${data.archivados === 1 ? "" : "s"} (tenían historia)` : "",
      data?.stock_trasladado ? `${data.stock_trasladado} u. de stock trasladadas` : "",
    ].filter(Boolean);
    toast.success(`Unificado: ${partes.join(" · ") || "listo"}`);
    onMerged();
  };

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Copy className="h-4 w-4" />Productos duplicados</DialogTitle>
        <DialogDescription>
          {grupos.length
            ? `${grupos.length} grupo${grupos.length === 1 ? "" : "s"} con el mismo código o el mismo nombre y marca. Elegí cuál conservar: el stock se traslada por Kardex, los códigos pasan como alternativos y los duplicados se eliminan, o se archivan si ya tienen ventas o compras.`
            : "No encontramos productos duplicados por código ni por nombre y marca."}
        </DialogDescription>
      </DialogHeader>
      <ol className="space-y-4">
        {visibles.map((grupo, n) => {
          const clave = claveGrupo(grupo);
          const keep = conservar[clave] ?? grupo.sugerido;
          const aUnificar = grupo.productos.filter(p => p.id !== keep && !excluidos[p.id]).length;
          return <li key={clave} className="space-y-2 border-b border-border pb-3">
            <p className="text-xs text-muted-foreground">{grupo.motivo === "codigo" ? "Mismo código" : "Mismo nombre y marca"}</p>
            <div role="radiogroup" aria-label="Producto a conservar" className="space-y-1">
              {grupo.productos.map(p => <div key={p.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name={`keep-${n}`} aria-label={`Conservar ${p.name}`} checked={p.id === keep} onChange={() => setConservar(c => ({ ...c, [clave]: p.id }))} />
                {p.id !== keep && <Checkbox aria-label={`Unificar ${p.name}`} checked={!excluidos[p.id]} onCheckedChange={v => setExcluidos(e => ({ ...e, [p.id]: v !== true }))} />}
                <span className="min-w-0 flex-1 truncate"><strong>{p.name}</strong>{p.brand ? ` · ${p.brand}` : ""}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{[p.sku && `SKU ${p.sku}`, p.barcode && `EAN ${p.barcode}`, `stock ${Number(p.stock) || 0}`, p.sale_price_ars != null && formatARS(Number(p.sale_price_ars))].filter(Boolean).join(" · ")}</span>
                {p.id === keep && <span className="shrink-0 text-xs font-semibold text-primary">Se conserva</span>}
              </div>)}
            </div>
            <Button size="sm" variant="outline" disabled={!aUnificar || unificando !== null} onClick={() => void unificar(grupo)}>
              {unificando === clave ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Merge className="mr-2 h-3.5 w-3.5" />}
              Unificar {aUnificar} en el seleccionado
            </Button>
          </li>;
        })}
      </ol>
      {grupos.length > GRUPOS_POR_PAGINA && <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Grupos {pagina * GRUPOS_POR_PAGINA + 1}–{Math.min((pagina + 1) * GRUPOS_POR_PAGINA, grupos.length)} de {grupos.length}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</Button>
          <Button size="sm" variant="outline" disabled={(pagina + 1) * GRUPOS_POR_PAGINA >= grupos.length} onClick={() => setPagina(p => p + 1)}>Siguiente</Button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
