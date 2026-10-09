import { useEffect, useState } from "react";
import { Boxes, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorPresentacion, etiquetaPresentacion, type ProductPresentation } from "@/lib/productPresentations";

/**
 * Cajas y bultos del producto. Se guardan al momento (no esperan al botón del
 * formulario) porque son filas propias, como las variantes.
 */
export default function ProductPresentationsEditor({ orgId, productId, unidad, canEdit }: {
  orgId: string;
  productId: string;
  unidad: string;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<ProductPresentation[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState("");
  const [factor, setFactor] = useState("");
  const [codigo, setCodigo] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    supabase.from("product_presentations").select("id, product_id, name, factor, barcode")
      .eq("org_id", orgId).eq("product_id", productId).order("factor")
      .then(({ data, error }) => {
        if (!vigente) return;
        if (error) console.error("[presentaciones]", error);
        setItems((data ?? []) as ProductPresentation[]);
        setCargando(false);
      });
    return () => { vigente = false; };
  }, [orgId, productId]);

  const agregar = async () => {
    const valor = Number(factor.replace(",", "."));
    const error = errorPresentacion(nombre, valor, unidad);
    if (error) { toast.error(error); return; }
    setGuardando(true);
    const { data, error: dbError } = await supabase.from("product_presentations")
      .insert({ org_id: orgId, product_id: productId, name: nombre.trim(), factor: valor, barcode: codigo.trim() || null })
      .select("id, product_id, name, factor, barcode").single();
    setGuardando(false);
    if (dbError) {
      toast.error(dbError.code === "23505" ? "Ese código ya es de otra presentación" : dbError.message);
      return;
    }
    setItems(prev => [...prev, data as ProductPresentation].sort((a, b) => a.factor - b.factor));
    setNombre(""); setFactor(""); setCodigo("");
  };

  const quitar = async (id: string) => {
    const { error } = await supabase.from("product_presentations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setItems(prev => prev.filter(p => p.id !== id));
  };

  return <div className="space-y-2 rounded-[10px] border border-border/60 p-3">
    <p className="flex items-center gap-2 text-sm font-medium"><Boxes className="h-4 w-4" />Presentaciones (caja, bulto, pack)</p>
    <p className="text-[11px] text-muted-foreground">Escanear el código de la caja en el POS suma esa cantidad de unidades. Stock y precio siguen por unidad.</p>
    {cargando ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <ul className="space-y-1">
      {items.map(p => <li key={p.id} className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">{etiquetaPresentacion(p, unidad)}</span>
        {p.barcode && <span className="font-mono text-xs text-muted-foreground">{p.barcode}</span>}
        {canEdit && <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Quitar ${p.name}`} onClick={() => void quitar(p.id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>}
      </li>)}
      {!items.length && <li className="text-xs text-muted-foreground">Sin presentaciones.</li>}
    </ul>}
    {canEdit && <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem_1fr_auto]">
      <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Caja x12" aria-label="Nombre de la presentación" className="bg-muted border-border text-sm" />
      <Input value={factor} onChange={e => setFactor(e.target.value)} inputMode="decimal" placeholder={unidad === "unidad" ? "12" : "4,5"} aria-label="Cantidad que contiene" className="bg-muted border-border text-sm" />
      <Input value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Código de la caja" aria-label="Código de barras de la presentación" className="bg-muted border-border font-mono text-sm" />
      <Button type="button" variant="outline" disabled={guardando} onClick={() => void agregar()}>
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}<span className="ml-1">Agregar</span>
      </Button>
    </div>}
  </div>;
}
