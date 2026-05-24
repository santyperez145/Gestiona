import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  FormInput, Plus, Edit2, Trash2, RefreshCw, Search,
  Copy, ExternalLink, Eye, BarChart3, ArrowUp, ArrowDown,
  GripVertical, CheckSquare, List, Hash, Mail, Phone,
  AlignLeft, Star, Calendar, Type, Minus,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormField {
  id: string;
  type: "text" | "email" | "phone" | "select" | "checkbox" | "radio" | "textarea" | "number" | "date" | "rating" | "heading" | "divider";
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  width?: "full" | "half";
}

interface CustomForm {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  status: string;
  form_type: string;
  fields: FormField[];
  success_message: string;
  notify_email: string | null;
  response_count: number;
  created_at: string;
}

interface FormResponse {
  id: string;
  form_id: string;
  data: Record<string, unknown>;
  submitted_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const FIELD_TYPES = [
  { type: "text", label: "Texto", icon: Type },
  { type: "email", label: "Email", icon: Mail },
  { type: "phone", label: "Teléfono", icon: Phone },
  { type: "number", label: "Número", icon: Hash },
  { type: "textarea", label: "Texto largo", icon: AlignLeft },
  { type: "select", label: "Lista desplegable", icon: List },
  { type: "radio", label: "Opción única", icon: CheckSquare },
  { type: "checkbox", label: "Múltiple opción", icon: CheckSquare },
  { type: "date", label: "Fecha", icon: Calendar },
  { type: "rating", label: "Calificación", icon: Star },
  { type: "heading", label: "Título de sección", icon: Type },
  { type: "divider", label: "Separador", icon: Minus },
];

const FORM_TYPES: Record<string, string> = {
  lead: "Captura de leads", survey: "Encuesta", contact: "Contacto",
  order: "Pedido", booking: "Reserva", feedback: "Feedback", other: "Otro",
};

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:    { label: "Borrador",  cls: "bg-muted text-muted-foreground" },
  active:   { label: "Activo",   cls: "bg-emerald-500/15 text-emerald-400" },
  closed:   { label: "Cerrado",  cls: "bg-destructive/15 text-destructive" },
  archived: { label: "Archivado", cls: "bg-muted text-muted-foreground opacity-60" },
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function generateFieldId() {
  return "f_" + Math.random().toString(36).substring(2, 9);
}

// ── Field editor ──────────────────────────────────────────────────────────────
function FieldEditor({ field, onChange, onDelete, onMoveUp, onMoveDown, isFirst, isLast }: {
  field: FormField; onChange: (f: FormField) => void; onDelete: () => void;
  onMoveUp: () => void; onMoveDown: () => void; isFirst: boolean; isLast: boolean;
}) {
  const isLayout = field.type === "heading" || field.type === "divider";

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" />
        <div className="flex-1 grid grid-cols-2 gap-2">
          <Input
            placeholder={isLayout ? "Texto del título/separador..." : "Etiqueta del campo..."}
            value={field.label}
            onChange={e => onChange({ ...field, label: e.target.value })}
            className="text-sm h-8"
          />
          <Select value={field.type} onValueChange={v => onChange({ ...field, type: v as FormField["type"] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map(ft => <SelectItem key={ft.type} value={ft.type}>{ft.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-0.5 shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onMoveUp} disabled={isFirst}>
            <ArrowUp className="w-3 h-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onMoveDown} disabled={isLast}>
            <ArrowDown className="w-3 h-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
      {!isLayout && (
        <div className="flex gap-2 items-center">
          <Input placeholder="Placeholder..." value={field.placeholder || ""}
            onChange={e => onChange({ ...field, placeholder: e.target.value })}
            className="text-xs h-7 flex-1" />
          <Select value={field.width || "full"} onValueChange={v => onChange({ ...field, width: v as "full" | "half" })}>
            <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Completo</SelectItem>
              <SelectItem value="half">Mitad</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <input type="checkbox" id={`req-${field.id}`} checked={field.required || false}
              onChange={e => onChange({ ...field, required: e.target.checked })} className="w-3.5 h-3.5" />
            <label htmlFor={`req-${field.id}`} className="text-xs">Requerido</label>
          </div>
        </div>
      )}
      {(field.type === "select" || field.type === "radio" || field.type === "checkbox") && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Opciones (una por línea)</p>
          <Textarea
            value={field.options?.join("\n") || ""}
            onChange={e => onChange({ ...field, options: e.target.value.split("\n").filter(Boolean) })}
            rows={3} className="text-xs" placeholder="Opción A&#10;Opción B&#10;Opción C" />
        </div>
      )}
    </div>
  );
}

// ── Form Builder Dialog ───────────────────────────────────────────────────────
function FormBuilderDialog({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: CustomForm | null;
  orgId: string; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [formType, setFormType] = useState("lead");
  const [status, setStatus] = useState("draft");
  const [successMsg, setSuccessMsg] = useState("¡Gracias por tu respuesta!");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name); setSlug(editing.slug);
      setDescription(editing.description || ""); setFormType(editing.form_type);
      setStatus(editing.status); setSuccessMsg(editing.success_message);
      setNotifyEmail(editing.notify_email || "");
      setFields(editing.fields || []);
    } else {
      setName(""); setSlug(""); setDescription(""); setFormType("lead");
      setStatus("draft"); setSuccessMsg("¡Gracias por tu respuesta!");
      setNotifyEmail(""); setFields([]);
    }
  }, [editing, open]);

  const addField = (type: FormField["type"]) => {
    setFields(p => [...p, { id: generateFieldId(), type, label: "", required: false, width: "full" }]);
  };
  const updateField = (i: number, f: FormField) => setFields(p => p.map((x, idx) => idx === i ? f : x));
  const deleteField = (i: number) => setFields(p => p.filter((_, idx) => idx !== i));
  const moveField = (i: number, dir: -1 | 1) => {
    setFields(p => {
      const arr = [...p];
      const temp = arr[i]; arr[i] = arr[i + dir]; arr[i + dir] = temp;
      return arr;
    });
  };

  async function save() {
    if (!name.trim()) { toast.error("Nombre requerido"); return; }
    const finalSlug = slug || slugify(name);
    setSaving(true);
    const payload = {
      org_id: orgId, name: name.trim(), slug: finalSlug,
      description: description || null, form_type: formType, status,
      success_message: successMsg, notify_email: notifyEmail || null,
      fields: fields,
    };
    const { error } = editing
      ? await supabase.from("custom_forms").update(payload).eq("id", editing.id)
      : await supabase.from("custom_forms").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Formulario guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
        <DialogHeader><DialogTitle>{editing ? "Editar formulario" : "Nuevo formulario"}</DialogTitle></DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nombre *</Label>
              <Input value={name} onChange={e => { setName(e.target.value); if (!editing) setSlug(slugify(e.target.value)); }} />
            </div>
            <div><Label>Slug (URL)</Label>
              <Input value={slug} onChange={e => setSlug(slugify(e.target.value))} placeholder="mi-formulario" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Tipo</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FORM_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notificar a email</Label>
              <Input type="email" value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)} placeholder="admin@..." />
            </div>
          </div>
          <div><Label>Mensaje de éxito</Label>
            <Input value={successMsg} onChange={e => setSuccessMsg(e.target.value)} />
          </div>

          {/* Fields */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Campos del formulario</Label>
              <div className="flex gap-1 flex-wrap justify-end">
                {["text","email","phone","textarea","select","radio","date","number","heading"].map(t => {
                  const ft = FIELD_TYPES.find(f => f.type === t);
                  return (
                    <Button key={t} size="sm" variant="outline" className="h-7 text-xs px-2"
                      onClick={() => addField(t as FormField["type"])}>
                      {ft?.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              {fields.map((f, i) => (
                <FieldEditor key={f.id} field={f}
                  onChange={nf => updateField(i, nf)}
                  onDelete={() => deleteField(i)}
                  onMoveUp={() => moveField(i, -1)}
                  onMoveDown={() => moveField(i, 1)}
                  isFirst={i === 0} isLast={i === fields.length - 1} />
              ))}
              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6 rounded-lg border border-dashed border-border/50">
                  Agregá campos usando los botones de arriba.
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="pt-2 border-t border-border/50">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar formulario"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Responses modal ───────────────────────────────────────────────────────────
function ResponsesModal({ form, onClose }: { form: CustomForm; onClose: () => void }) {
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("form_responses").select("*")
      .eq("form_id", form.id).order("submitted_at", { ascending: false }).limit(100)
      .then(({ data }) => { setResponses(data || []); setLoading(false); });
  }, [form.id]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Respuestas — {form.name} ({form.response_count})</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-3">
          {loading ? <p className="text-sm text-muted-foreground text-center py-8">Cargando...</p>
           : responses.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Sin respuestas aún.</p>
           : responses.map(r => (
            <div key={r.id} className="rounded-lg border border-border/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-2">
                {new Date(r.submitted_at).toLocaleString("es-AR")}
              </p>
              {form.fields.filter(f => !["heading","divider"].includes(f.type)).map(f => {
                const val = (r.data as Record<string, unknown>)[f.id];
                if (val === undefined || val === null || val === "") return null;
                return (
                  <div key={f.id} className="flex gap-2 text-xs py-0.5">
                    <span className="font-medium text-muted-foreground w-32 shrink-0 truncate">{f.label}:</span>
                    <span>{Array.isArray(val) ? val.join(", ") : String(val)}</span>
                  </div>
                );
              })}
            </div>
           ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FormsBuilderPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<CustomForm | null>(null);
  const [viewResponses, setViewResponses] = useState<CustomForm | null>(null);
  const [search, setSearch] = useState("");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase.from("custom_forms").select("*")
      .eq("org_id", orgId).order("created_at", { ascending: false });
    setForms((data || []) as CustomForm[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function deleteForm(id: string) {
    if (!confirm("¿Eliminar este formulario y todas sus respuestas?")) return;
    await supabase.from("custom_forms").delete().eq("id", id);
    toast.success("Formulario eliminado");
    loadData();
  }

  async function toggleStatus(form: CustomForm) {
    const next = form.status === "active" ? "draft" : "active";
    await supabase.from("custom_forms").update({ status: next }).eq("id", form.id);
    toast.success(next === "active" ? "Formulario activado" : "Formulario desactivado");
    loadData();
  }

  const filtered = forms.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.slug.toLowerCase().includes(search.toLowerCase())
  );

  const totalResponses = forms.reduce((s, f) => s + f.response_count, 0);
  const activeCount = forms.filter(f => f.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FormInput className="w-6 h-6 text-primary" /> Constructor de Formularios
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Creá formularios personalizados para leads, encuestas, pedidos y más.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setBuilderOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Nuevo formulario
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Formularios", value: forms.length, icon: FormInput, color: "text-primary" },
          { label: "Activos", value: activeCount, icon: CheckSquare, color: "text-emerald-400" },
          { label: "Respuestas totales", value: totalResponses, icon: BarChart3, color: "text-blue-400" },
          { label: "Promedio resp.", value: forms.length > 0 ? Math.round(totalResponses / forms.length) : 0, icon: Star, color: "text-yellow-400" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className={`w-4 h-4 ${k.color}`} />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar formularios..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="icon" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {forms.length === 0 ? "Creá tu primer formulario." : "Sin resultados."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(form => {
            const cfg = STATUS_CFG[form.status];
            return (
              <div key={form.id} className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{form.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg?.cls}`}>{cfg?.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{FORM_TYPES[form.form_type]}</p>
                  </div>
                </div>
                {form.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{form.description}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono">/form/{form.slug}</span>
                  <span>·</span>
                  <span>{form.fields?.length || 0} campos</span>
                  <span>·</span>
                  <span className="font-semibold text-primary">{form.response_count} resp.</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => { setEditing(form); setBuilderOpen(true); }}>
                    <Edit2 className="w-3.5 h-3.5 mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setViewResponses(form)}>
                    <BarChart3 className="w-3.5 h-3.5 mr-1" /> Resp.
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => toggleStatus(form)}>
                    {form.status === "active" ? "Desactivar" : "Activar"}
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8 text-destructive" onClick={() => deleteForm(form.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FormBuilderDialog open={builderOpen} onClose={() => setBuilderOpen(false)}
        editing={editing} orgId={orgId} onSaved={loadData} />
      {viewResponses && <ResponsesModal form={viewResponses} onClose={() => setViewResponses(null)} />}
    </div>
  );
}
