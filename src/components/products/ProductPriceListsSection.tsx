/**
 * ProductPriceListsSection — precios mayoristas del producto dentro de su ficha.
 *
 * Muestra, para cada lista de precios activa de la organización, qué precio
 * termina pagando ese canal y permite fijar un override por producto
 * (precio fijo o % de descuento) guardado en `price_list_items`.
 *
 * Prioridad de precio (misma que `usePriceList`):
 *   1. override.price_ars   → precio fijo
 *   2. override.discount_pct → % sobre el precio de venta
 *   3. discount_pct de la lista
 *   4. precio de venta base
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tags, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface PriceList {
  id: string;
  name: string;
  discount_pct: number;
  is_default: boolean;
  is_active: boolean;
}

interface Override {
  id: string;
  price_list_id: string;
  price_ars: number | null;
  discount_pct: number | null;
}

interface Props {
  productId?: string;
  orgId?: string;
  /** Precio de venta actual del formulario, para previsualizar en vivo. */
  salePriceARS: number;
}

export default function ProductPriceListsSection({ productId, orgId, salePriceARS }: Props) {
  const [lists, setLists] = useState<PriceList[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { price: string; pct: string }>>({});

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    const [listRes, itemRes] = await Promise.all([
      supabase.from("price_lists").select("id,name,discount_pct,is_default,is_active")
        .eq("org_id", orgId).eq("is_active", true).order("name"),
      productId
        ? supabase.from("price_list_items").select("id,price_list_id,price_ars,discount_pct").eq("product_id", productId)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setLists((listRes.data ?? []) as PriceList[]);
    const map: Record<string, Override> = {};
    const d: Record<string, { price: string; pct: string }> = {};
    ((itemRes.data ?? []) as Override[]).forEach(o => {
      map[o.price_list_id] = o;
      d[o.price_list_id] = { price: o.price_ars != null ? String(o.price_ars) : "", pct: o.discount_pct != null ? String(o.discount_pct) : "" };
    });
    setOverrides(map);
    setDraft(d);
    setLoading(false);
  }, [orgId, productId]);

  useEffect(() => { load(); }, [load]);

  const effectivePrice = (list: PriceList): number => {
    const o = overrides[list.id];
    if (o?.price_ars != null) return o.price_ars;
    if (o?.discount_pct != null) return Math.round(salePriceARS * (1 - o.discount_pct / 100));
    if (list.discount_pct > 0) return Math.round(salePriceARS * (1 - list.discount_pct / 100));
    return salePriceARS;
  };

  const saveOverride = async (list: PriceList) => {
    if (!productId || !orgId) return;
    const d = draft[list.id] ?? { price: "", pct: "" };
    const price = d.price.trim() ? Number(d.price) : null;
    const pct = d.pct.trim() ? Number(d.pct) : null;
    if (price != null && (!Number.isFinite(price) || price < 0)) { toast.error("Precio inválido"); return; }
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) { toast.error("El descuento debe estar entre 0 y 100"); return; }

    setSavingId(list.id);
    const { error } = await supabase.from("price_list_items").upsert({
      org_id: orgId,
      price_list_id: list.id,
      product_id: productId,
      price_ars: price,
      discount_pct: pct,
    } as any, { onConflict: "price_list_id,product_id" });
    setSavingId(null);
    if (error) { toast.error("No se pudo guardar: " + error.message); return; }
    toast.success(`Precio de "${list.name}" actualizado`);
    load();
  };

  const clearOverride = async (list: PriceList) => {
    const o = overrides[list.id];
    if (!o) return;
    setSavingId(list.id);
    const { error } = await supabase.from("price_list_items").delete().eq("id", o.id);
    setSavingId(null);
    if (error) { toast.error("No se pudo quitar: " + error.message); return; }
    toast.success(`"${list.name}" vuelve al precio de la lista`);
    load();
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando listas de precios…
      </div>
    );
  }

  if (!lists.length) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
      <p className="text-xs font-semibold flex items-center gap-1.5">
        <Tags className="w-3.5 h-3.5 text-primary" />
        Precios por lista (mayorista / distribuidor)
      </p>

      {!productId && (
        <p className="text-[11px] text-muted-foreground">
          Guardá el producto primero para poder fijar un precio distinto por lista.
        </p>
      )}

      <div className="space-y-2">
        {lists.map(list => {
          const o = overrides[list.id];
          const eff = effectivePrice(list);
          const off = salePriceARS > 0 ? Math.round((1 - eff / salePriceARS) * 100) : 0;
          const d = draft[list.id] ?? { price: "", pct: "" };
          return (
            <div key={list.id} className="rounded-lg border border-border/50 bg-card p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium truncate">{list.name}</span>
                  {list.is_default && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold">Por defecto</span>}
                  {o && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-semibold">Override</span>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-primary">{formatARS(eff)}</p>
                  {off !== 0 && <p className="text-[10px] text-muted-foreground">{off > 0 ? `−${off}%` : `+${-off}%`} vs. venta</p>}
                </div>
              </div>

              {productId && (
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[110px]">
                    <p className="text-[10px] text-muted-foreground mb-1">Precio fijo ARS</p>
                    <Input
                      type="number" min="0" inputMode="numeric"
                      value={d.price}
                      onChange={e => setDraft(prev => ({ ...prev, [list.id]: { price: e.target.value, pct: "" } }))}
                      placeholder="—"
                      className="bg-muted border-border h-8 text-xs"
                    />
                  </div>
                  <div className="flex-1 min-w-[110px]">
                    <p className="text-[10px] text-muted-foreground mb-1">o descuento %</p>
                    <Input
                      type="number" min="0" max="100" inputMode="numeric"
                      value={d.pct}
                      onChange={e => setDraft(prev => ({ ...prev, [list.id]: { price: "", pct: e.target.value } }))}
                      placeholder={`${list.discount_pct}`}
                      className="bg-muted border-border h-8 text-xs"
                    />
                  </div>
                  <Button
                    type="button" size="sm" variant="outline" className="h-8 text-xs"
                    disabled={savingId === list.id}
                    onClick={() => saveOverride(list)}
                  >
                    {savingId === list.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Guardar"}
                  </Button>
                  {o && (
                    <Button
                      type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground"
                      disabled={savingId === list.id}
                      onClick={() => clearOverride(list)}
                      title="Volver al precio general de la lista"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Sin override, cada lista aplica su descuento general sobre el precio de venta.
      </p>
    </div>
  );
}
