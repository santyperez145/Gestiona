import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Search,
  Zap,
  Target,
  Mail,
  MessageCircle,
  Send,
  BarChart3,
  CheckCircle,
  Layers,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import KPICard from "@/components/shared/KPICard";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SegmentRule {
  field: string;
  op: string;
  value: string;
}

interface CustomerSegment {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  color: string;
  is_dynamic: boolean;
  rules: SegmentRule[];
  customer_count: number;
  last_synced_at: string | null;
  active: boolean;
  created_at: string;
}

interface SegmentCampaign {
  id: string;
  segment_id: string;
  name: string;
  channel: "email" | "whatsapp" | "sms" | "push" | "in_app";
  status: "draft" | "scheduled" | "running" | "completed" | "cancelled";
  scheduled_at: string | null;
  sent_count: number;
  open_count: number;
  click_count: number;
  conversion_count: number;
  subject: string | null;
  body_preview: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RULE_FIELDS: { value: string; label: string; type: "number" | "text" | "select" }[] = [
  { value: "total_spent", label: "Total gastado (ARS)", type: "number" },
  { value: "total_purchases", label: "Cantidad de compras", type: "number" },
  { value: "city", label: "Ciudad", type: "text" },
  { value: "tag", label: "Tag", type: "text" },
];

const RULE_OPS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: "gte", label: "≥ mayor o igual" },
    { value: "lte", label: "≤ menor o igual" },
  ],
  text: [
    { value: "eq", label: "= igual a" },
    { value: "contains", label: "contiene" },
  ],
};

const CHANNEL_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  email: { label: "Email", icon: Mail, color: "text-blue-400" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "text-emerald-400" },
  sms: { label: "SMS", icon: Send, color: "text-amber-400" },
  push: { label: "Push", icon: Zap, color: "text-violet-400" },
  in_app: { label: "In-App", icon: Target, color: "text-orange-400" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "bg-muted/40 text-muted-foreground" },
  scheduled: { label: "Programada", color: "bg-blue-500/15 text-blue-400" },
  running: { label: "Enviando", color: "bg-amber-500/15 text-amber-400" },
  completed: { label: "Enviada", color: "bg-emerald-500/15 text-emerald-400" },
  cancelled: { label: "Cancelada", color: "bg-red-500/15 text-red-400" },
};

const COLOR_PRESETS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#06b6d4"];

// ─── Segment Form ─────────────────────────────────────────────────────────────

interface SegFormProps {
  open: boolean;
  segment: CustomerSegment | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function SegForm({ open, segment, orgId, onClose, onSaved }: SegFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [isDynamic, setIsDynamic] = useState(true);
  const [rules, setRules] = useState<SegmentRule[]>([]);

  useEffect(() => {
    if (segment) {
      setName(segment.name); setDescription(segment.description ?? ""); setColor(segment.color);
      setIsDynamic(segment.is_dynamic); setRules(segment.rules ?? []);
    } else {
      setName(""); setDescription(""); setColor("#6366f1"); setIsDynamic(true); setRules([]);
    }
  }, [segment, open]);

  const addRule = () => setRules(r => [...r, { field: "total_spent", op: "gte", value: "0" }]);
  const removeRule = (i: number) => setRules(r => r.filter((_, idx) => idx !== i));
  const updateRule = (i: number, key: keyof SegmentRule, val: string) => {
    setRules(r => r.map((rule, idx) => {
      if (idx !== i) return rule;
      const updated = { ...rule, [key]: val };
      // Reset op when field changes
      if (key === "field") {
        const fieldDef = RULE_FIELDS.find(f => f.value === val);
        updated.op = fieldDef?.type === "number" ? "gte" : "eq";
      }
      return updated;
    }));
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nombre requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId, name: name.trim(), description: description.trim() || null,
      color, is_dynamic: isDynamic, rules: rules, active: true,
    };
    const { error, data } = segment
      ? await supabase.from("customer_segments").update(payload).eq("id", segment.id).select().single()
      : await supabase.from("customer_segments").insert(payload).select().single();
    if (error) { toast.error("Error: " + error.message); setLoading(false); return; }
    // Auto-sync if dynamic
    if (isDynamic && data) {
      await supabase.rpc("sync_segment_members", { p_segment_id: data.id });
    }
    setLoading(false);
    toast.success(segment ? "Segmento actualizado" : "Segmento creado");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{segment ? "Editar segmento" : "Nuevo segmento"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nombre *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Clientes VIP" />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-2 mt-1">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? "border-white scale-110" : "border-transparent"}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_dynamic" checked={isDynamic} onChange={e => setIsDynamic(e.target.checked)} className="rounded" />
            <Label htmlFor="is_dynamic">Segmento dinámico (se actualiza automáticamente)</Label>
          </div>

          {isDynamic && (
            <div className="space-y-2 pb-12">
              <div className="flex items-center justify-between">
                <Label>Reglas de inclusión</Label>
                <Button size="sm" variant="outline" onClick={addRule}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar regla
                </Button>
              </div>
              {rules.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2 border border-dashed border-border rounded">
                  Sin reglas = incluye todos los clientes
                </p>
              )}
              {rules.map((rule, i) => {
                const fieldDef = RULE_FIELDS.find(f => f.value === rule.field);
                const ops = RULE_OPS[fieldDef?.type ?? "text"] ?? RULE_OPS.text;
                return (
                  <div key={i} className="flex gap-2 items-center">
                    <Select value={rule.field} onValueChange={v => updateRule(i, "field", v)}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RULE_FIELDS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={rule.op} onValueChange={v => updateRule(i, "op", v)}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ops.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      className="w-28"
                      value={rule.value}
                      onChange={e => updateRule(i, "value", e.target.value)}
                      placeholder="Valor"
                    />
                    <Button size="sm" variant="ghost" onClick={() => removeRule(i)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {segment ? "Guardar" : "Crear segmento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Segment Card ─────────────────────────────────────────────────────────────

interface SegCardProps {
  segment: CustomerSegment;
  campaigns: SegmentCampaign[];
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  onNewCampaign: () => void;
}

function SegCard({ segment, campaigns, onEdit, onDelete, onSync, onNewCampaign }: SegCardProps) {
  const [expanded, setExpanded] = useState(false);
  const segCampaigns = campaigns.filter(c => c.segment_id === segment.id);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div
          className="w-3 h-10 rounded-full shrink-0"
          style={{ background: segment.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{segment.name}</h3>
            {segment.is_dynamic && <Badge className="text-xs bg-violet-500/15 text-violet-400"><Zap className="w-3 h-3 mr-1" />Dinámico</Badge>}
            {!segment.active && <Badge className="text-xs bg-muted/40 text-muted-foreground">Inactivo</Badge>}
          </div>
          {segment.description && <p className="text-xs text-muted-foreground mt-0.5">{segment.description}</p>}
          {segment.last_synced_at && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Sync: {formatDistanceToNow(new Date(segment.last_synced_at), { addSuffix: true, locale: es })}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold">{segment.customer_count}</p>
          <p className="text-xs text-muted-foreground">clientes</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="border-t border-border p-4 bg-muted/10 space-y-3">
          {segment.rules && segment.rules.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Reglas:</p>
              <div className="flex flex-wrap gap-2">
                {segment.rules.map((r, i) => {
                  const fd = RULE_FIELDS.find(f => f.value === r.field);
                  return (
                    <Badge key={i} className="text-xs bg-muted text-muted-foreground">
                      {fd?.label ?? r.field} {r.op} {r.value}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {segCampaigns.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Campañas:</p>
              <div className="space-y-1 pb-12">
                {segCampaigns.slice(0, 3).map(c => {
                  const ch = CHANNEL_CONFIG[c.channel];
                  const sc = STATUS_CONFIG[c.status];
                  const ChIcon = ch.icon;
                  return (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <ChIcon className={`w-3.5 h-3.5 ${ch.color}`} />
                      <span className="font-medium truncate flex-1">{c.name}</span>
                      <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
                      {c.status === "completed" && (
                        <span className="text-muted-foreground">{c.sent_count} enviados</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onNewCampaign}>
              <Send className="w-3.5 h-3.5 mr-1" /> Nueva campaña
            </Button>
            {segment.is_dynamic && (
              <Button size="sm" variant="outline" onClick={onSync}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Sincronizar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Edit className="w-3.5 h-3.5 mr-1" /> Editar
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Campaign Form ────────────────────────────────────────────────────────────

interface CampFormProps {
  open: boolean;
  segmentId: string | null;
  segments: CustomerSegment[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function CampForm({ open, segmentId, segments, orgId, onClose, onSaved }: CampFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [selSegId, setSelSegId] = useState(segmentId ?? "none");
  const [channel, setChannel] = useState("email");
  const [subject, setSubject] = useState("");
  const [bodyPreview, setBodyPreview] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  useEffect(() => {
    setSelSegId(segmentId ?? "none");
    setName(""); setChannel("email"); setSubject(""); setBodyPreview(""); setScheduledAt("");
  }, [open, segmentId]);

  const handleSave = async () => {
    if (!name.trim() || selSegId === "none") { toast.error("Nombre y segmento requeridos"); return; }
    setLoading(true);
    const { error } = await supabase.from("segment_campaigns").insert({
      org_id: orgId, segment_id: selSegId, name: name.trim(), channel,
      subject: subject.trim() || null, body_preview: bodyPreview.trim() || null,
      scheduled_at: scheduledAt || null, status: scheduledAt ? "scheduled" : "draft",
    });
    setLoading(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success("Campaña creada");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva campaña de segmento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nombre *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Black Friday VIP" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Segmento *</Label>
              <Select value={selSegId} onValueChange={setSelSegId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar...</SelectItem>
                  {segments.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.customer_count})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Canal</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANNEL_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {channel === "email" && (
            <div>
              <Label>Asunto</Label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Asunto del email..." />
            </div>
          )}
          <div>
            <Label>Vista previa del contenido</Label>
            <Textarea value={bodyPreview} onChange={e => setBodyPreview(e.target.value)} rows={3} placeholder="Primeras líneas del mensaje..." />
          </div>
          <div>
            <Label>Programar para (vacío = borrador)</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            Crear campaña
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomerSegmentsTab() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [segments, setSegments] = useState<CustomerSegment[]>([]);
  const [campaigns, setCampaigns] = useState<SegmentCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [segFormOpen, setSegFormOpen] = useState(false);
  const [editingSegment, setEditingSegment] = useState<CustomerSegment | null>(null);
  const [campFormOpen, setCampFormOpen] = useState(false);
  const [campSegmentId, setCampSegmentId] = useState<string | null>(null);

  const loadAll = async () => {
    if (!orgId) return;
    setLoading(true);
    const [segRes, campRes] = await Promise.all([
      supabase.from("customer_segments").select("*").eq("org_id", orgId).order("customer_count", { ascending: false }),
      supabase.from("segment_campaigns").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    ]);
    setSegments((segRes.data ?? []) as CustomerSegment[]);
    setCampaigns(campRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [orgId]);

  const kpis = useMemo(() => ({
    total: segments.length,
    dynamic: segments.filter(s => s.is_dynamic).length,
    totalCustomers: segments.reduce((a, s) => a + s.customer_count, 0),
    campaigns: campaigns.length,
  }), [segments, campaigns]);

  const filtered = useMemo(() => {
    if (!search) return segments;
    return segments.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  }, [segments, search]);

  const handleSync = async (segment: CustomerSegment) => {
    const { data, error } = await supabase.rpc("sync_segment_members", { p_segment_id: segment.id });
    if (error) { toast.error("Error al sincronizar"); return; }
    toast.success(`Segmento sincronizado: ${data} clientes`);
    loadAll();
  };

  const handleDelete = async (segment: CustomerSegment) => {
    if (!confirm(`¿Eliminar "${segment.name}"?`)) return;
    const { error } = await supabase.from("customer_segments").delete().eq("id", segment.id);
    if (error) { toast.error("No se pudo eliminar"); return; }
    setSegments(prev => prev.filter(s => s.id !== segment.id));
    toast.success("Segmento eliminado");
  };

  const syncAll = async () => {
    const dynamic = segments.filter(s => s.is_dynamic && s.active);
    if (dynamic.length === 0) { toast.info("Sin segmentos dinámicos"); return; }
    for (const seg of dynamic) {
      await supabase.rpc("sync_segment_members", { p_segment_id: seg.id });
    }
    toast.success(`${dynamic.length} segmentos sincronizados`);
    loadAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Layers className="w-4 h-4 text-primary" />Segmentos de Clientes</h2>
          <p className="text-xs text-muted-foreground">Audiencias dinámicas basadas en comportamiento y datos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={syncAll}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Sync todos
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setCampSegmentId(null); setCampFormOpen(true); }}>
            <Send className="w-4 h-4 mr-1.5" /> Nueva campaña
          </Button>
          <Button size="sm" onClick={() => { setEditingSegment(null); setSegFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Nuevo segmento
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard label="Segmentos" value={kpis.total} icon={Layers} color="primary" />
        <KPICard label="Dinámicos" value={kpis.dynamic} icon={Zap} color="purple" />
        <KPICard label="Clientes totales" value={kpis.totalCustomers.toLocaleString("es-AR")} icon={Users} color="blue" />
        <KPICard label="Campañas" value={kpis.campaigns} icon={Send} color="success" />
      </div>

      <Tabs defaultValue="segments">
        <TabsList>
          <TabsTrigger value="segments">Segmentos</TabsTrigger>
          <TabsTrigger value="campaigns">Campañas ({campaigns.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="segments" className="mt-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar segmento..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>

          {loading ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Layers className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin segmentos</p>
              <p className="text-sm">Creá tu primer segmento de clientes</p>
            </div>
          ) : filtered.map(s => (
            <SegCard
              key={s.id}
              segment={s}
              campaigns={campaigns}
              onEdit={() => { setEditingSegment(s); setSegFormOpen(true); }}
              onDelete={() => handleDelete(s)}
              onSync={() => handleSync(s)}
              onNewCampaign={() => { setCampSegmentId(s.id); setCampFormOpen(true); }}
            />
          ))}
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4">
          {campaigns.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Send className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Sin campañas</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Campaña</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Segmento</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Canal</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Estado</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Enviados</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Abiertos</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Clicks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {campaigns.map(c => {
                    const ch = CHANNEL_CONFIG[c.channel];
                    const sc = STATUS_CONFIG[c.status];
                    const ChIcon = ch.icon;
                    const seg = segments.find(s => s.id === c.segment_id);
                    const openRate = c.sent_count > 0 ? ((c.open_count / c.sent_count) * 100).toFixed(0) : "—";
                    const ctr = c.open_count > 0 ? ((c.click_count / c.open_count) * 100).toFixed(0) : "—";
                    return (
                      <tr key={c.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium">{c.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{seg?.name ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <ChIcon className={`w-3.5 h-3.5 ${ch.color}`} />
                            <span>{ch.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5"><Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge></td>
                        <td className="px-4 py-2.5 text-right">{c.sent_count || "—"}</td>
                        <td className="px-4 py-2.5 text-right">{c.open_count > 0 ? `${openRate}%` : "—"}</td>
                        <td className="px-4 py-2.5 text-right">{c.click_count > 0 ? `${ctr}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <SegForm open={segFormOpen} segment={editingSegment} orgId={orgId}
        onClose={() => { setSegFormOpen(false); setEditingSegment(null); }} onSaved={loadAll} />

      <CampForm open={campFormOpen} segmentId={campSegmentId} segments={segments} orgId={orgId}
        onClose={() => { setCampFormOpen(false); setCampSegmentId(null); }} onSaved={loadAll} />
    </div>
  );
}
