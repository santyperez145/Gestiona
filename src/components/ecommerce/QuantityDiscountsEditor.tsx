/**
 * Reglas de descuento por cantidad: "llevando 3 o más, 15% off".
 *
 * Antes lo único que había era `price_2x_ars`: un precio fijo para dos
 * unidades, cargado producto por producto. Servía para un caso y para nada más.
 *
 * ⚠️ **Por producto gana el mejor, nunca la suma.** Un vaper con 2x a $36.000 y
 * una regla de "3+ al 15%" cobra el 2x llevando dos y el 15% llevando tres, lo
 * que sea mejor — nunca los dos. Está dicho en pantalla porque es lo primero
 * que alguien va a suponer al revés.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { toast } from "sonner";
import { Layers, Plus, Trash2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Regla {
  id: string;
  name: string;
  scope: "todos" | "categoria" | "producto";
  target: string | null;
  min_qty: number;
  discount_percent: number;
  is_active: boolean;
  ends_at: string | null;
}

const ALCANCE: Record<Regla["scope"], string> = {
  todos: "Todos los productos",
  categoria: "Una categoría",
  producto: "Un producto",
};

interface Props {
  categorias: { slug: string; name: string }[];
}

export default function QuantityDiscountsEditor({ categorias }: Props) {
  const { orgId } = useOrganization();
  const { ask, dialog } = useConfirmDialog();
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [nueva, setNueva] = useState({
    name: "", scope: "todos" as Regla["scope"], target: "",
    min_qty: "3", discount_percent: "10",
  });

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("quantity_discounts")
      .select("id, name, scope, target, min_qty, discount_percent, is_active, ends_at")
      .eq("org_id", orgId)
      .order("min_qty");
    setLoading(false);
    // Sin `?? []`: vacío por permisos y "no hay reglas" son cosas distintas.
    if (error) { toast.error("No se pudieron cargar las reglas"); return; }
    setReglas((data ?? []) as unknown as Regla[]);
  }, [orgId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear() {
    const min = parseInt(nueva.min_qty) || 0;
    const pct = parseFloat(nueva.discount_percent) || 0;
    if (!nueva.name.trim()) { toast.error("Poné un nombre para reconocerla"); return; }
    if (min < 2) { toast.error("La cantidad mínima tiene que ser 2 o más"); return; }
    if (pct <= 0 || pct > 90) { toast.error("El descuento va entre 1 y 90%"); return; }
    if (nueva.scope !== "todos" && !nueva.target) { toast.error("Elegí a qué se aplica"); return; }

    setGuardando(true);
    const { error } = await supabase.from("quantity_discounts").insert({
      org_id: orgId,
      name: nueva.name.trim(),
      scope: nueva.scope,
      target: nueva.scope === "todos" ? null : nueva.target,
      min_qty: min,
      discount_percent: pct,
    } as never);
    setGuardando(false);
    if (error) { toast.error(error.message); return; }
    setNueva({ name: "", scope: "todos", target: "", min_qty: "3", discount_percent: "10" });
    toast.success("Regla creada", { description: "Ya se aplica en la tienda." });
    cargar();
  }

  async function alternar(r: Regla) {
    const nuevo = !r.is_active;
    const { error } = await supabase.from("quantity_discounts")
      .update({ is_active: nuevo } as never).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    setReglas(prev => prev.map(x => x.id === r.id ? { ...x, is_active: nuevo } : x));
  }

  async function borrar(r: Regla) {
    if (!(await ask({
      title: `¿Borrar la regla "${r.name}"?`,
      confirmText: "Borrar",
    }))) return;
    const { error } = await supabase.from("quantity_discounts").delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    setReglas(prev => prev.filter(x => x.id !== r.id));
    toast.success("Regla borrada");
  }

  const nombreTarget = (r: Regla) =>
    r.scope === "categoria"
      ? (categorias.find(c => c.slug === r.target)?.name ?? r.target)
      : r.target;

  if (loading) {
    return <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border/60 rounded-[10px] px-4 py-3 flex items-start gap-3">
        <Layers className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-medium text-sm">Descuento por cantidad</p>
          <p className="text-[11px] text-muted-foreground">
            "Llevando 3 o más, 15% off". La cantidad se cuenta por producto sumando
            todas sus variantes: dos sabores distintos del mismo vaper cuentan como dos.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            <strong className="text-foreground">No se suma al precio "llevando 2"</strong> de
            la ficha: por cada producto se cobra el mejor de los dos, nunca los dos juntos.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 grid gap-3 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <Label className="text-xs">Nombre</Label>
          <Input
            className="h-9" value={nueva.name} placeholder="3 o más, 15% off"
            onChange={e => setNueva(n => ({ ...n, name: e.target.value }))}
          />
        </div>
        <div>
          <Label className="text-xs">Se aplica a</Label>
          <Select
            value={nueva.scope}
            onValueChange={v => setNueva(n => ({ ...n, scope: v as Regla["scope"], target: "" }))}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ALCANCE) as Regla["scope"][]).map(k => (
                <SelectItem key={k} value={k}>{ALCANCE[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {nueva.scope === "categoria" && (
          <div>
            <Label className="text-xs">Categoría</Label>
            <Select value={nueva.target} onValueChange={v => setNueva(n => ({ ...n, target: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Elegí" /></SelectTrigger>
              <SelectContent>
                {categorias.map(c => <SelectItem key={c.slug} value={c.slug}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {nueva.scope === "producto" && (
          <div>
            <Label className="text-xs">ID del producto</Label>
            <Input
              className="h-9" value={nueva.target}
              onChange={e => setNueva(n => ({ ...n, target: e.target.value }))}
              placeholder="Pegá el id"
            />
          </div>
        )}
        <div>
          <Label className="text-xs">Desde</Label>
          <Input
            className="h-9" type="number" min={2} value={nueva.min_qty}
            onChange={e => setNueva(n => ({ ...n, min_qty: e.target.value }))}
          />
        </div>
        <div>
          <Label className="text-xs">% off</Label>
          <Input
            className="h-9" type="number" min={1} max={90} value={nueva.discount_percent}
            onChange={e => setNueva(n => ({ ...n, discount_percent: e.target.value }))}
          />
        </div>
        <div className="flex items-end">
          <Button onClick={crear} disabled={guardando} className="w-full">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" />Crear</>}
          </Button>
        </div>
      </div>

      {reglas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay reglas. Sin ninguna, la tienda sigue usando el precio
          "llevando 2" de cada producto, como hasta ahora.
        </p>
      ) : (
        <div className="space-y-2">
          {reglas.map(r => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  Llevando {r.min_qty} o más · <strong>{r.discount_percent}% off</strong> ·{" "}
                  {r.scope === "todos" ? "todos los productos" : `${ALCANCE[r.scope].toLowerCase()}: ${nombreTarget(r)}`}
                </p>
              </div>
              {!r.is_active && (
                <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 text-[11px]">Pausada</Badge>
              )}
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => alternar(r)}>
                {r.is_active ? <><EyeOff className="w-3 h-3" />Pausar</> : <><Eye className="w-3 h-3" />Activar</>}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => borrar(r)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}
