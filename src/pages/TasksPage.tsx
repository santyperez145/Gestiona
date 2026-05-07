import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckSquare, Plus, Check, Clock, AlertTriangle, X,
  Circle, SquareStack, Flame, ChevronUp, ChevronDown, Search,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "pending" | "in_progress" | "done" | "cancelled";
  due_date: string | null;
  completed_at: string | null;
  category: string | null;
  created_by: string | null;
  assigned_to: string | null;
};

const PRIORITY_CONFIG = {
  urgent: { label: "Urgente", color: "text-destructive bg-destructive/10", icon: Flame, order: 0 },
  high:   { label: "Alta",    color: "text-orange-400 bg-orange-500/10",   icon: ChevronUp, order: 1 },
  medium: { label: "Media",   color: "text-warning bg-warning/10",         icon: Circle, order: 2 },
  low:    { label: "Baja",    color: "text-muted-foreground bg-muted/40",  icon: ChevronDown, order: 3 },
};

const STATUS_CONFIG = {
  pending:     { label: "Pendiente",    color: "text-muted-foreground" },
  in_progress: { label: "En progreso",  color: "text-blue-400" },
  done:        { label: "Completada",   color: "text-success" },
  cancelled:   { label: "Cancelada",    color: "text-muted-foreground line-through" },
};

const EMPTY_FORM = {
  title: "",
  description: "",
  priority: "medium" as Task["priority"],
  due_date: "",
  category: "",
};

const CATEGORIES = ["Compras", "Ventas", "Stock", "Finanzas", "Marketing", "Equipo", "Operaciones", "Otro"];

export default function TasksPage() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState("active");
  const [search, setSearch] = useState("");

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("priority")
      .order("due_date", { nullsFirst: false });
    setTasks((data || []) as Task[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const setField = (k: keyof typeof EMPTY_FORM, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !activeOrg) { toast.error("Ingresá el título de la tarea"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("tasks").insert({
        org_id: activeOrg.id,
        created_by: user?.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        due_date: form.due_date || null,
        category: form.category || null,
        status: "pending",
      });
      if (error) throw error;
      toast.success("Tarea creada");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error al crear tarea");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (task: Task, status: Task["status"]) => {
    const update: any = { status };
    if (status === "done") update.completed_at = new Date().toISOString();
    await supabase.from("tasks").update(update).eq("id", task.id);
    await load();
    if (status === "done") toast.success(`"${task.title}" completada`);
  };

  const deleteTask = async (task: Task) => {
    await supabase.from("tasks").delete().eq("id", task.id);
    await load();
  };

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    const activeTasks = filterStatus === "active"
      ? tasks.filter(t => t.status !== "done" && t.status !== "cancelled")
      : filterStatus === "done"
      ? tasks.filter(t => t.status === "done")
      : tasks;

    const searched = search.trim()
      ? activeTasks.filter(t =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          (t.description?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
          (t.category?.toLowerCase().includes(search.toLowerCase()) ?? false)
        )
      : activeTasks;

    return [...searched].sort((a, b) => {
      const pa = PRIORITY_CONFIG[a.priority]?.order ?? 99;
      const pb = PRIORITY_CONFIG[b.priority]?.order ?? 99;
      if (pa !== pb) return pa - pb;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
  }, [tasks, filterStatus, search]);

  const pending = tasks.filter(t => t.status !== "done" && t.status !== "cancelled");
  const overdue = pending.filter(t => t.due_date && t.due_date < today);
  const urgent = pending.filter(t => t.priority === "urgent" || t.priority === "high");
  const doneToday = tasks.filter(t => t.completed_at?.slice(0, 10) === today);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={CheckSquare}
        title="Agenda de Tareas"
        description="Organizá y seguí las tareas de tu negocio"
        badge={
          overdue.length > 0
            ? { label: `${overdue.length} vencida${overdue.length > 1 ? "s" : ""}`, variant: "destructive" }
            : pending.length === 0
            ? { label: "¡Todo al día ✓", variant: "success" }
            : undefined
        }
        actions={
          <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />Nueva tarea
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Pendientes" value={pending.length} icon={SquareStack} color="primary" sub="tareas activas" />
        <KPICard label="Vencidas" value={overdue.length} icon={AlertTriangle}
          color={overdue.length > 0 ? "destructive" : "success"} sub="sin completar" />
        <KPICard label="Urgentes / Altas" value={urgent.length} icon={Flame}
          color={urgent.length > 0 ? "warning" : "primary"} sub="prioridad alta" />
        <KPICard label="Completadas hoy" value={doneToday.length} icon={Check} color="success" sub="¡buen trabajo!" />
      </div>

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 bg-muted/40 rounded-lg p-1">
          {[
            { value: "active", label: `Activas (${pending.length})` },
            { value: "done", label: `Listas (${tasks.filter(t => t.status === "done").length})` },
            { value: "all", label: `Todas (${tasks.length})` },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilterStatus(tab.value)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                filterStatus === tab.value
                  ? "bg-card border border-border shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tarea…"
            className="pl-8 pr-3 h-8 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 w-48"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando tareas…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <CheckSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-muted-foreground">
            {search ? "Sin resultados para tu búsqueda." : filterStatus === "active" ? "No hay tareas pendientes — ¡todo al día!" : "Sin tareas para mostrar."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => {
            const isOverdue = task.status !== "done" && task.status !== "cancelled" && task.due_date && task.due_date < today;
            const pc = PRIORITY_CONFIG[task.priority];
            const PriorityIcon = pc?.icon || Circle;
            return (
              <div
                key={task.id}
                className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all ${
                  task.status === "done"
                    ? "bg-muted/10 border-border/30 opacity-60"
                    : isOverdue
                    ? "bg-destructive/5 border-destructive/20"
                    : "bg-card border-border hover:border-primary/20"
                }`}
              >
                {/* Status toggle */}
                <button
                  onClick={() => updateStatus(task, task.status === "done" ? "pending" : "done")}
                  className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    task.status === "done" ? "bg-success border-success text-white" : "border-border hover:border-success"
                  }`}
                >
                  {task.status === "done" && <Check className="w-3 h-3" />}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <p className={`text-sm font-medium leading-tight flex-1 ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                      {task.title}
                    </p>
                    <span className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 font-semibold shrink-0 ${pc?.color}`}>
                      <PriorityIcon className="w-2.5 h-2.5" />{pc?.label}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{task.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    {task.category && (
                      <span className="text-[10px] text-primary bg-primary/10 rounded px-1.5 py-0.5">{task.category}</span>
                    )}
                    {task.due_date && (
                      <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        <Clock className="w-3 h-3" />
                        {isOverdue ? "Vencida: " : ""}
                        {new Date(task.due_date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                      </span>
                    )}
                    {task.status === "pending" && (
                      <button
                        onClick={() => updateStatus(task, "in_progress")}
                        className="text-[10px] text-blue-400 hover:underline"
                      >
                        Marcar en progreso
                      </button>
                    )}
                    {task.status === "in_progress" && (
                      <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" />En progreso
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteTask(task)}
                  className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0 mt-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Nueva tarea</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Título *</label>
              <Input value={form.title} onChange={e => setField("title", e.target.value)} placeholder="Ej: Llamar al proveedor, hacer pedido, etc." autoFocus />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Descripción</label>
              <Textarea value={form.description} onChange={e => setField("description", e.target.value)} placeholder="Detalles opcionales…" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Prioridad</label>
                <Select value={form.priority} onValueChange={v => setField("priority", v as Task["priority"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Categoría</label>
                <Select value={form.category} onValueChange={v => setField("category", v)}>
                  <SelectTrigger><SelectValue placeholder="Ninguna" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fecha límite</label>
              <Input type="date" value={form.due_date} onChange={e => setField("due_date", e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
                {saving ? "Creando…" : "Crear tarea"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
