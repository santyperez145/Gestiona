import { useEffect, useState } from "react";
import { Loader2, Tags, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Grupo = { slug: string; nombre: string; cantidad: number; ejemplos: string[] };
type Resultado = { ok: boolean; error?: string; rubro?: string; total?: number; cambios?: number; lote_id?: string | null; por_categoria?: Grupo[] };

type Rpc = { data: unknown; error: { message: string } | null };
const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name as never, args as never) as unknown as Promise<Rpc>;

/**
 * Ordena las categorías del catálogo según el rubro: unifica las importadas
 * («PINTURERIA», «Herramientaselectricas») y clasifica por nombre lo que no
 * tiene categoría. Primero muestra la vista previa; aplicar se puede deshacer.
 */
export default function CategorizeProductsDialog({ open, orgId, onClose, onApplied }: {
  open: boolean;
  orgId: string | null | undefined;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [vista, setVista] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [ultimoLote, setUltimoLote] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orgId) return;
    let vigente = true;
    setVista(null); setCargando(true);
    rpc("categorizar_productos", { p_org: orgId, p_aplicar: false }).then(({ data, error }) => {
      if (!vigente) return;
      setCargando(false);
      if (error) { setVista({ ok: false, error: error.message.replace(/^.*?:\s*/, "") }); return; }
      setVista(data as Resultado);
    });
    return () => { vigente = false; };
  }, [open, orgId]);

  const aplicar = async () => {
    if (!orgId) return;
    setAplicando(true);
    const { data, error } = await rpc("categorizar_productos", { p_org: orgId, p_aplicar: true });
    setAplicando(false);
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    const r = data as Resultado;
    setUltimoLote(r.lote_id ?? null);
    toast.success(`${r.cambios ?? 0} productos ordenados en ${r.por_categoria?.length ?? 0} categorías`);
    onApplied();
    setVista({ ...r, cambios: 0, por_categoria: [] });
  };

  const deshacer = async () => {
    if (!orgId || !ultimoLote) return;
    const { data, error } = await rpc("deshacer_categorizacion", { p_org: orgId, p_lote: ultimoLote });
    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }
    setUltimoLote(null);
    toast.success(`${Number(data ?? 0)} productos volvieron a su categoría anterior`);
    onApplied();
    onClose();
  };

  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Tags className="h-4 w-4" />Ordenar categorías</DialogTitle>
        <DialogDescription>Unifica las categorías importadas y clasifica por nombre los productos sin categoría, según el rubro de tu negocio. Las categorías que creaste vos se respetan.</DialogDescription>
      </DialogHeader>
      {cargando && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Analizando el catálogo…</p>}
      {vista && !vista.ok && <p className="text-sm text-muted-foreground">{vista.error}</p>}
      {vista?.ok && (vista.cambios ?? 0) === 0 && !ultimoLote && <p className="text-sm text-muted-foreground">Tu catálogo ya está ordenado: no hay nada para cambiar.</p>}
      {vista?.ok && (vista.cambios ?? 0) > 0 && <div className="space-y-2 text-sm">
        <p><strong>{vista.cambios}</strong> de {vista.total} productos cambian de categoría:</p>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {vista.por_categoria?.map(g => <li key={g.slug} className="rounded-md border border-border/60 px-2 py-1.5">
            <p className="font-medium">{g.nombre} <span className="text-xs font-normal text-muted-foreground">· {g.cantidad}</span></p>
            <p className="truncate text-xs text-muted-foreground">{g.ejemplos.join(" · ")}</p>
          </li>)}
        </ul>
      </div>}
      <DialogFooter className="gap-2">
        {ultimoLote && <Button variant="outline" onClick={() => void deshacer()}><Undo2 className="mr-1 h-4 w-4" />Deshacer</Button>}
        <Button variant="outline" onClick={onClose}>Cerrar</Button>
        {vista?.ok && (vista.cambios ?? 0) > 0 && <Button disabled={aplicando} onClick={() => void aplicar()}>
          {aplicando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Aplicar
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
