/**
 * CustomFieldsPage — Custom field definitions for CRM (customers & products)
 *
 * Salesforce Custom Objects / Fields equivalent.
 * Allows org admins to define extra fields on customers/products:
 *   Text, Number, Date, Boolean, Select (with options)
 *
 * Custom field values are stored in a JSONB column `custom_fields` on
 * the customers/products tables.
 */
import { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Settings2, Plus, X, Loader2, Trash2, Edit2, Text, Hash, Calendar,
  ToggleLeft, List, GripVertical, ChevronRight, Users, Package,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type FieldType = "text" | "number" | "date" | "boolean" | "select";
type EntityType = "customer" | "product";

interface CustomFieldDef {
  id: string;
  org_id: string;
  entity_type: EntityType;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  required: boolean;
  options: string[] | null;
  sort_order: number;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const FIELD_TYPE_CONFIG: Record<FieldType, { label: string; icon: typeof Text; color: string }> = {
  text:    { label: "Texto",         icon: Text,       color: "text-blue-400" },
  number:  { label: "Número",        icon: Hash,       color: "text-purple-400" },
  date:    { label: "Fecha",         icon: Calendar,   color: "text-green-400" },
  boolean: { label: "Sí/No",         icon: ToggleLeft, color: "text-yellow-400" },
  select:  { label: "Lista despleg.", icon: List,       color: "text-orange-400" },
};

const ENTITY_CONFIG: Record<EntityType, { label: string; icon: typeof Users }> = {
  customer: { label: "Clientes / CRM", icon: Users },
  product:  { label: "Productos",      icon: Package },
};

function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[áàä]/g, "a")
    .replace(/[éèë]/g, "e")
    .replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o")
    .replace(/[úùü]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EMPTY_FORM = {
  entity_type: "customer" as EntityType,
  field_label: "",
  field_key: "",
  field_type: "text" as FieldType,
  required: false,
  options_raw: "",
};

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function CustomFieldsPage() {
  usePageTitle("Campos personalizados");

  const { activeOrg, activeRole } = useOrg();
  const [fields, setFields]       = useState<CustomFieldDef[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [editing, setEditing]     = useState<CustomFieldDef | null>(null);
  const [filterEntity, setFilterEntity] = useState<"all" | EntityType>("all");
  const [form, setForm]           = useState({ ...EMPTY_FORM });

  const canManage = activeRole === "owner" || activeRole === "admin";

  // Auto-generate field_key from label
  useEffect(() => {
    if (!editing && form.field_label) {
      setForm(p => ({ ...p, field_key: slugify(p.field_label) }));
    }
  }, [form.field_label, editing]);

  const loadFields = useCallback(async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("custom_field_defs")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("entity_type")
        .order("sort_order");
      if (error) throw error;
      setFields((data || []) as CustomFieldDef[]);
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  useEffect(() => { loadFields(); }, [loadFields]);

  const handleSave = async () => {
    if (!form.field_label.trim() || !form.field_key.trim() || !activeOrg?.id) return;
    setSaving(true);
    try {
      const options = form.field_type === "select" && form.options_raw.trim()
        ? form.options_raw.split(",").map(s => s.trim()).filter(Boolean)
        : null;

      if (editing) {
        const { error } = await supabase.from("custom_field_defs").update({
          field_label: form.field_label.trim(),
          field_key: form.field_key.trim(),
          field_type: form.field_type,
          required: form.required,
          options,
        }).eq("id", editing.id);
        if (error) throw error;
        toast.success("Campo actualizado");
      } else {
        // Check duplicate key per entity
        const duplicate = fields.find(f => f.entity_type === form.entity_type && f.field_key === form.field_key.trim());
        if (duplicate) { toast.error("Ya existe un campo con esa clave para esta entidad"); return; }

        const { error } = await supabase.from("custom_field_defs").insert({
          org_id: activeOrg.id,
          entity_type: form.entity_type,
          field_label: form.field_label.trim(),
          field_key: form.field_key.trim(),
          field_type: form.field_type,
          required: form.required,
          options,
          sort_order: fields.filter(f => f.entity_type === form.entity_type).length + 1,
        });
        if (error) throw error;
        toast.success("Campo creado");
      }
      setShowForm(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      loadFields();
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este campo? Los valores almacenados en registros existentes se perderán.")) return;
    try {
      await supabase.from("custom_field_defs").delete().eq("id", id);
      setFields(prev => prev.filter(f => f.id !== id));
      toast.success("Campo eliminado");
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    }
  };

  const startEdit = (field: CustomFieldDef) => {
    setEditing(field);
    setForm({
      entity_type: field.entity_type,
      field_label: field.field_label,
      field_key: field.field_key,
      field_type: field.field_type,
      required: field.required,
      options_raw: (field.options || []).join(", "),
    });
    setShowForm(true);
  };

  const filtered = filterEntity === "all" ? fields : fields.filter(f => f.entity_type === filterEntity);
  const grouped: Record<EntityType, CustomFieldDef[]> = {
    customer: filtered.filter(f => f.entity_type === "customer"),
    product: filtered.filter(f => f.entity_type === "product"),
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Settings2}
        title="Campos Personalizados"
        description="Extendé clientes y productos con tus propios campos"
        badge={{ label: `${fields.length} campo${fields.length !== 1 ? "s" : ""}`, variant: "secondary" }}
        actions={
          canManage ? (
            <Button onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ ...EMPTY_FORM }); }} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />Nuevo campo
            </Button>
          ) : undefined
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Campos totales" value={fields.length} icon={Settings2} color="primary" sub="definidos" />
        <KPICard label="En Clientes" value={grouped.customer.length} icon={Users} color="blue" sub="campos personalizados" />
        <KPICard label="En Productos" value={grouped.product.length} icon={Package} color="purple" sub="campos personalizados" />
        <KPICard label="Requeridos" value={fields.filter(f => f.required).length} icon={Hash} color={fields.filter(f => f.required).length > 0 ? "warning" : "success"} sub="obligatorios" />
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{editing ? "Editar campo" : "Nuevo campo personalizado"}</h3>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setShowForm(false); setEditing(null); }}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Entidad</Label>
              <Select value={form.entity_type} onValueChange={v => setForm(p => ({ ...p, entity_type: v as EntityType }))} disabled={!!editing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ENTITY_CONFIG) as EntityType[]).map(k => (
                    <SelectItem key={k} value={k}>{ENTITY_CONFIG[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Tipo de campo</Label>
              <Select value={form.field_type} onValueChange={v => setForm(p => ({ ...p, field_type: v as FieldType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(FIELD_TYPE_CONFIG) as FieldType[]).map(k => (
                    <SelectItem key={k} value={k}>{FIELD_TYPE_CONFIG[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Etiqueta visible *</Label>
              <Input placeholder="Ej: Tipo de empresa" value={form.field_label}
                onChange={e => setForm(p => ({ ...p, field_label: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Clave interna (auto)</Label>
              <Input placeholder="tipo_empresa" value={form.field_key}
                onChange={e => setForm(p => ({ ...p, field_key: slugify(e.target.value) }))} />
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Usada en exportaciones CSV y API</p>
            </div>
            {form.field_type === "select" && (
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground mb-1 block">Opciones (separadas por coma)</Label>
                <Input placeholder="Opción 1, Opción 2, Opción 3" value={form.options_raw}
                  onChange={e => setForm(p => ({ ...p, options_raw: e.target.value }))} />
              </div>
            )}
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                type="checkbox" id="required" className="rounded"
                checked={form.required}
                onChange={e => setForm(p => ({ ...p, required: e.target.checked }))}
              />
              <label htmlFor="required" className="text-sm cursor-pointer">Campo obligatorio</label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.field_label.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {editing ? "Guardar cambios" : "Crear campo"}
            </Button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        {(["all", "customer", "product"] as const).map(opt => (
          <button
            key={opt}
            onClick={() => setFilterEntity(opt)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterEntity === opt ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {opt === "all" ? "Todos" : ENTITY_CONFIG[opt].label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} campo{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Field list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Settings2 className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sin campos personalizados. Creá el primero para extender tus registros.</p>
        </div>
      ) : (
        <div className="space-y-5 pb-12">
          {(Object.keys(grouped) as EntityType[]).map(entity => {
            const entityFields = grouped[entity];
            if (entityFields.length === 0) return null;
            const ec = ENTITY_CONFIG[entity];
            const EntityIcon = ec.icon;
            return (
              <div key={entity}>
                <div className="flex items-center gap-2 mb-3">
                  <EntityIcon className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{ec.label}</h3>
                  <span className="text-xs text-muted-foreground/60 ml-1">({entityFields.length})</span>
                </div>
                <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                  {entityFields.map(field => {
                    const ftc = FIELD_TYPE_CONFIG[field.field_type];
                    const FTIcon = ftc.icon;
                    return (
                      <div key={field.id} className="flex items-center gap-3 px-4 py-3">
                        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                        <FTIcon className={`w-4 h-4 shrink-0 ${ftc.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{field.field_label}</span>
                            {field.required && (
                              <span className="text-[10px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1.5">*Obligatorio</span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ftc.color} bg-current/10 border-current/20`}>
                              {ftc.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground font-mono">{field.field_key}</p>
                          {field.options && field.options.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1">
                              {field.options.slice(0, 6).map(opt => (
                                <span key={opt} className="text-[10px] bg-muted rounded px-1.5 py-0.5">{opt}</span>
                              ))}
                              {field.options.length > 6 && (
                                <span className="text-[10px] text-muted-foreground">+{field.options.length - 6} más</span>
                              )}
                            </div>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(field)}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:bg-red-500/10" onClick={() => handleDelete(field.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info box */}
      <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">¿Cómo funciona?</p>
        <ul className="text-xs text-muted-foreground/80 space-y-1 list-disc list-inside">
          <li>Los campos definidos aquí aparecen en la ficha de <strong>Clientes</strong> y <strong>Productos</strong>.</li>
          <li>Los valores se guardan en la columna <code className="bg-muted px-1 rounded text-[10px]">custom_fields</code> (JSONB) de cada entidad.</li>
          <li>Podés exportar los campos personalizados en el CSV de clientes y productos.</li>
          <li>La clave interna se usa en integraciones via API (ej: <code className="bg-muted px-1 rounded text-[10px]">/api/customers?custom_fields=true</code>).</li>
        </ul>
      </div>
    </div>
  );
}
