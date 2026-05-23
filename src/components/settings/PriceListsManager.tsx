/**
 * PriceListsManager — UI for managing tiered price lists.
 *
 * Supports: Minorista (default), Mayorista, VIP, Distribuidor, etc.
 * Each list has a global discount % applied on top of base sale price,
 * plus optional per-product price overrides.
 *
 * Used in: SettingsPage → Precios tab
 * Applied in: POSPage (auto-select when customer has a price_list_id)
 *             ProductsPage (show price per list)
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus, Trash2, Edit2, Check, X, Star, Tag, Users, Package,
  ChevronDown, ChevronUp, TrendingDown,
} from "lucide-react";
import { useAsyncAction } from "@/hooks/useAsyncAction";

interface PriceList {
  id: string;
  name: string;
  description: string | null;
  discount_pct: number;
  currency: string;
  is_default: boolean;
  is_active: boolean;
}

const PRESET_LISTS = [
  { name: "Mayorista", discount_pct: 20, description: "Descuento para compras al por mayor" },
  { name: "VIP", discount_pct: 15, description: "Clientes VIP con tarifa especial" },
  { name: "Distribuidor", discount_pct: 30, description: "Distribuidores oficiales" },
];

interface Props {
  orgId: string;
}

export default function PriceListsManager({ orgId }: Props) {
  const [lists, setLists] = useState<PriceList[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPct, setNewPct] = useState("0");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("price_lists")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at");
    if (data) setLists(data as PriceList[]);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const [createList, creating] = useAsyncAction(async () => {
    if (!newName.trim()) { toast.error("Ingresá un nombre"); return; }
    const pct = parseFloat(newPct) || 0;
    const { error } = await supabase.from("price_lists").insert({
      org_id: orgId,
      name: newName.trim(),
      description: newDesc.trim() || null,
      discount_pct: pct,
      is_default: false,
      is_active: true,
    });
    if (error) throw error;
    toast.success(`Lista "${newName.trim()}" creada`);
    setNewName(""); setNewDesc(""); setNewPct("0"); setAdding(false);
    await load();
  }, { onError: e => toast.error(e.message) });

  const [deleteList] = useAsyncAction(async (id: string) => {
    const list = lists.find(l => l.id === id);
    if (list?.is_default) { toast.error("No podés eliminar la lista predeterminada"); return; }
    const { error } = await supabase.from("price_lists").delete().eq("id", id);
    if (error) throw error;
    toast.success("Lista eliminada");
    await load();
  }, { onError: e => toast.error(e.message) });

  const [updateList] = useAsyncAction(async (id: string, data: Partial<PriceList>) => {
    const { error } = await supabase.from("price_lists").update(data).eq("id", id);
    if (error) throw error;
    setEditingId(null);
    await load();
  }, { onError: e => toast.error(e.message) });

  const addPreset = async (preset: typeof PRESET_LISTS[0]) => {
    const { error } = await supabase.from("price_lists").insert({
      org_id: orgId,
      name: preset.name,
      description: preset.description,
      discount_pct: preset.discount_pct,
      is_default: false,
      is_active: true,
    });
    if (!error) { toast.success(`Lista "${preset.name}" agregada`); await load(); }
  };

  const existingNames = lists.map(l => l.name.toLowerCase());

  return (
    <div className="rounded-[10px] border border-border/50 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Listas de Precios</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{lists.length}</Badge>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          <p className="text-xs text-muted-foreground/70">
            Creá distintos precios para diferentes segmentos de clientes. El POS aplica automáticamente la lista del cliente seleccionado.
          </p>

          {/* Existing lists */}
          <div className="space-y-2">
            {lists.map(list => (
              <ListRow
                key={list.id}
                list={list}
                editing={editingId === list.id}
                onEdit={() => setEditingId(list.id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={(data) => updateList(list.id, data)}
                onDelete={() => deleteList(list.id)}
              />
            ))}
          </div>

          {/* Presets */}
          {PRESET_LISTS.filter(p => !existingNames.includes(p.name.toLowerCase())).length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Agregar rápido</p>
              <div className="flex flex-wrap gap-2">
                {PRESET_LISTS
                  .filter(p => !existingNames.includes(p.name.toLowerCase()))
                  .map(p => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => addPreset(p)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-[6px] border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all"
                    >
                      <Plus className="w-3 h-3" />{p.name} ({p.discount_pct}%)
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Add new */}
          {!adding ? (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full border-dashed">
              <Plus className="w-3.5 h-3.5 mr-1.5" />Nueva lista
            </Button>
          ) : (
            <div className="rounded-lg border border-border/50 p-3 space-y-3 bg-muted/20">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Nombre (ej: Mayorista)"
                  className="h-8 text-xs"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={newPct}
                    onChange={e => setNewPct(e.target.value)}
                    placeholder="% descuento"
                    className="h-8 text-xs"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">%</span>
                </div>
              </div>
              <Input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Descripción (opcional)"
                className="h-8 text-xs"
              />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 gradient-gold text-primary-foreground text-xs h-8" onClick={() => createList()} disabled={creating}>
                  {creating ? "Creando…" : "Crear lista"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setAdding(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
            <TrendingDown className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground/80">
              En el POS: al seleccionar un cliente con lista asignada, los precios se ajustan automáticamente.
              Podés asignar la lista de precios desde el perfil de cada cliente.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── List row ────────────────────────────────────────────────────────────────

function ListRow({ list, editing, onEdit, onCancelEdit, onSave, onDelete }: {
  list: PriceList;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: Partial<PriceList>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [pct, setPct] = useState(String(list.discount_pct));
  const [desc, setDesc] = useState(list.description ?? "");

  if (editing) {
    return (
      <div className="rounded-lg border border-primary/30 p-3 space-y-2 bg-primary/5">
        <div className="grid grid-cols-2 gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} className="h-7 text-xs" placeholder="Nombre" />
          <div className="flex items-center gap-1">
            <Input type="number" min="0" max="100" value={pct} onChange={e => setPct(e.target.value)} className="h-7 text-xs" />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
        <Input value={desc} onChange={e => setDesc(e.target.value)} className="h-7 text-xs" placeholder="Descripción" />
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs flex-1 gradient-gold text-primary-foreground"
            onClick={() => onSave({ name: name.trim(), discount_pct: parseFloat(pct) || 0, description: desc.trim() || null })}>
            <Check className="w-3 h-3 mr-1" />Guardar
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCancelEdit}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors group">
      <div className="flex items-center gap-2 min-w-0">
        {list.is_default ? <Star className="w-3.5 h-3.5 text-primary shrink-0" /> : <Tag className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />}
        <div className="min-w-0">
          <span className="text-sm font-medium">{list.name}</span>
          {list.description && <p className="text-[10px] text-muted-foreground/60 truncate">{list.description}</p>}
        </div>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ml-1 shrink-0 ${list.discount_pct > 0 ? "border-emerald-500/30 text-emerald-400" : "border-border text-muted-foreground"}`}>
          {list.discount_pct > 0 ? `-${list.discount_pct}%` : "Precio base"}
        </Badge>
        {list.is_default && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary shrink-0">Default</Badge>}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={onEdit} className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        {!list.is_default && (
          <button type="button" onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
