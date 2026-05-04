import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, X, Edit2, Trash2, DollarSign, User, Calendar,
  TrendingUp, Loader2, GripVertical,
} from "lucide-react";
import { formatARS } from "@/lib/supabaseStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "lead" | "contactado" | "propuesta" | "negociacion" | "cerrado" | "perdido";

interface Deal {
  id: string;
  org_id: string;
  title: string;
  customer_name: string;
  value_ars: number;
  stage: Stage;
  notes: string;
  expected_close: string | null;
  created_at: string;
  updated_at: string;
}

const STAGES: { value: Stage; label: string; color: string; bg: string }[] = [
  { value: "lead",        label: "Lead",         color: "text-muted-foreground", bg: "bg-muted/40" },
  { value: "contactado",  label: "Contactado",   color: "text-blue-400",         bg: "bg-blue-500/10" },
  { value: "propuesta",   label: "Propuesta",    color: "text-purple-400",       bg: "bg-purple-500/10" },
  { value: "negociacion", label: "Negociación",  color: "text-yellow-400",       bg: "bg-yellow-500/10" },
  { value: "cerrado",     label: "Cerrado ✓",    color: "text-emerald-400",      bg: "bg-emerald-500/10" },
  { value: "perdido",     label: "Perdido ✗",    color: "text-red-400",          bg: "bg-red-500/10" },
];

const EMPTY_FORM = {
  title: "",
  customer_name: "",
  value_ars: "",
  stage: "lead" as Stage,
  notes: "",
  expected_close: "",
};

// ─── Deal Form Dialog ─────────────────────────────────────────────────────────

function DealDialog({
  initial,
  open,
  onClose,
  onSave,
}: {
  initial?: Partial<Deal>;
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        title: initial?.title ?? "",
        customer_name: initial?.customer_name ?? "",
        value_ars: initial?.value_ars !== undefined ? String(initial.value_ars) : "",
        stage: initial?.stage ?? "lead",
        notes: initial?.notes ?? "",
        expected_close: initial?.expected_close?.slice(0, 10) ?? "",
      });
    }
  }, [open, initial]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("El título es obligatorio"); return; }
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        customer_name: form.customer_name.trim() || null,
        value_ars: form.value_ars ? Number(form.value_ars) : 0,
        stage: form.stage,
        notes: form.notes.trim() || null,
        expected_close: form.expected_close || null,
      });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar oportunidad" : "Nueva oportunidad"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Ej: Pedido perfumes Lattafa x20" className="bg-muted" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Input value={form.customer_name} onChange={e => set("customer_name", e.target.value)} placeholder="Nombre del cliente" className="bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label>Valor estimado ($)</Label>
              <Input type="number" value={form.value_ars} onChange={e => set("value_ars", e.target.value)} placeholder="0" className="bg-muted" min={0} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Etapa</Label>
              <Select value={form.stage} onValueChange={v => set("stage", v)}>
                <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cierre estimado</Label>
              <Input type="date" value={form.expected_close} onChange={e => set("expected_close", e.target.value)} className="bg-muted" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Detalles, seguimiento, requisitos..." className="bg-muted resize-none" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground">
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            {initial?.id ? "Guardar cambios" : "Crear oportunidad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deal Card ────────────────────────────────────────────────────────────────

function DealCard({
  deal,
  onEdit,
  onDelete,
  onMove,
  stages,
}: {
  deal: Deal;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (stage: Stage) => void;
  stages: typeof STAGES;
}) {
  const isOverdue = deal.expected_close && new Date(deal.expected_close) < new Date() && deal.stage !== "cerrado" && deal.stage !== "perdido";
  const stageInfo = stages.find(s => s.value === deal.stage)!;

  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-sm hover:border-primary/30 transition-all group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold leading-tight flex-1">{deal.title}</p>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onEdit} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <Edit2 className="w-3 h-3" />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {deal.customer_name && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
          <User className="w-3 h-3 shrink-0" />
          <span className="truncate">{deal.customer_name}</span>
        </div>
      )}

      {deal.value_ars > 0 && (
        <div className="flex items-center gap-1 text-xs font-mono font-semibold text-primary mb-1.5">
          <DollarSign className="w-3 h-3 shrink-0" />
          {formatARS(deal.value_ars)}
        </div>
      )}

      {deal.expected_close && (
        <div className={`flex items-center gap-1 text-xs mb-2 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
          <Calendar className="w-3 h-3 shrink-0" />
          {new Date(deal.expected_close + "T12:00:00").toLocaleDateString("es-AR")}
          {isOverdue && <span className="text-[10px] font-medium">(vencido)</span>}
        </div>
      )}

      {deal.notes && (
        <p className="text-[10px] text-muted-foreground line-clamp-2 mb-2 bg-muted/40 rounded px-2 py-1">
          {deal.notes}
        </p>
      )}

      {/* Quick move to next stage */}
      <div className="flex gap-1 flex-wrap">
        {stages
          .filter(s => s.value !== deal.stage)
          .slice(0, 3)
          .map(s => (
            <button
              key={s.value}
              onClick={() => onMove(s.value)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-all hover:opacity-80 ${s.bg} ${s.color} border-current/20`}
            >
              → {s.label}
            </button>
          ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalesPipelinePage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; deal?: Deal; prefillStage?: Stage }>({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("deals" as any)
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDeals((data || []) as Deal[]);
    } catch (e: any) {
      toast.error(e.message || "Error al cargar oportunidades");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  const handleSave = async (data: any) => {
    if (!activeOrg || !user) return;
    if (dialog.deal?.id) {
      const { error } = await supabase
        .from("deals" as any)
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq("id", dialog.deal.id);
      if (error) throw error;
      toast.success("Oportunidad actualizada");
    } else {
      const { error } = await supabase
        .from("deals" as any)
        .insert({ ...data, org_id: activeOrg.id, user_id: user.id, stage: dialog.prefillStage ?? data.stage });
      if (error) throw error;
      toast.success("Oportunidad creada");
    }
    await load();
  };

  const handleMove = async (deal: Deal, stage: Stage) => {
    try {
      await supabase.from("deals" as any).update({ stage, updated_at: new Date().toISOString() }).eq("id", deal.id);
      setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, stage } : d));
    } catch {
      toast.error("Error al mover");
    }
  };

  const handleDelete = async (deal: Deal) => {
    if (!confirm(`¿Eliminar "${deal.title}"?`)) return;
    setDeletingId(deal.id);
    try {
      await supabase.from("deals" as any).delete().eq("id", deal.id);
      setDeals(prev => prev.filter(d => d.id !== deal.id));
    } finally {
      setDeletingId(null);
    }
  };

  // Pipeline stats
  const stats = useMemo(() => {
    const pipeline = deals.filter(d => d.stage !== "perdido");
    const won = deals.filter(d => d.stage === "cerrado");
    const total = deals.filter(d => d.stage !== "perdido" && d.stage !== "cerrado");
    const winRate = deals.length > 0 ? (won.length / deals.length) * 100 : 0;
    return {
      pipelineValue: pipeline.reduce((s, d) => s + (d.value_ars || 0), 0),
      wonValue: won.reduce((s, d) => s + (d.value_ars || 0), 0),
      openCount: total.length,
      winRate,
    };
  }, [deals]);

  const dealsByStage = useMemo(() => {
    const map: Record<Stage, Deal[]> = {} as any;
    STAGES.forEach(s => { map[s.value] = []; });
    deals.forEach(d => { map[d.stage]?.push(d); });
    return map;
  }, [deals]);

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Dialog */}
      <DealDialog
        open={dialog.open}
        initial={dialog.deal ? { ...dialog.deal } : dialog.prefillStage ? { stage: dialog.prefillStage } : undefined}
        onClose={() => setDialog({ open: false })}
        onSave={handleSave}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            Pipeline de Ventas
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Seguimiento de oportunidades comerciales</p>
        </div>
        <Button onClick={() => setDialog({ open: true })} className="gradient-gold text-primary-foreground gap-1.5">
          <Plus className="w-4 h-4" />Nueva oportunidad
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Pipeline total", value: formatARS(stats.pipelineValue), color: "text-primary" },
          { label: "Oportunidades abiertas", value: stats.openCount, color: "text-blue-400" },
          { label: "Cerradas ganadas", value: formatARS(stats.wonValue), color: "text-emerald-400" },
          { label: "Tasa de cierre", value: `${stats.winRate.toFixed(0)}%`, color: stats.winRate >= 50 ? "text-emerald-400" : stats.winRate >= 25 ? "text-yellow-400" : "text-red-400" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3 md:p-4">
            <div className="text-xs text-muted-foreground mb-1">{k.label}</div>
            <div className={`text-xl font-bold font-display ${k.color}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />Cargando...
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {STAGES.map(stage => {
              const stageDeals = dealsByStage[stage.value] || [];
              const stageTotal = stageDeals.reduce((s, d) => s + (d.value_ars || 0), 0);
              return (
                <div key={stage.value} className="w-64 flex flex-col gap-2">
                  {/* Column header */}
                  <div className={`rounded-xl px-3 py-2.5 ${stage.bg}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-bold uppercase tracking-wide ${stage.color}`}>
                        {stage.label}
                      </span>
                      <span className="text-xs bg-card border border-border rounded-full px-1.5 py-0.5 text-muted-foreground font-medium">
                        {stageDeals.length}
                      </span>
                    </div>
                    {stageTotal > 0 && (
                      <div className={`text-xs font-mono font-semibold ${stage.color}`}>
                        {formatARS(stageTotal)}
                      </div>
                    )}
                  </div>

                  {/* Add button */}
                  <button
                    onClick={() => setDialog({ open: true, prefillStage: stage.value })}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors border border-dashed border-border hover:border-primary/30"
                  >
                    <Plus className="w-3 h-3" />Agregar
                  </button>

                  {/* Cards */}
                  <div className="flex flex-col gap-2">
                    {stageDeals.map(deal => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        stages={STAGES}
                        onEdit={() => setDialog({ open: true, deal })}
                        onDelete={() => handleDelete(deal)}
                        onMove={newStage => handleMove(deal, newStage)}
                      />
                    ))}
                    {stageDeals.length === 0 && (
                      <div className="text-center py-6 text-[11px] text-muted-foreground/50">
                        Sin oportunidades
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
