import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
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
  FolderKanban, Plus, Pencil, Trash2, CheckCircle2, Circle, Clock,
  ChevronDown, ChevronRight, DollarSign, Timer, AlertTriangle, Loader2,
  BarChart3, CheckSquare,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMemo } from "react";

interface Project {
  id: string;
  name: string;
  description: string | null;
  customer_name: string | null;
  status: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  budget: number | null;
  spent: number;
  color: string;
  progress_pct: number;
  tags: string[];
  created_at: string;
}

interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_name: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  logged_hours: number;
  sort_order: number;
}

interface TimeLog {
  id: string;
  task_id: string;
  user_name: string | null;
  hours: number;
  description: string | null;
  logged_at: string;
}

interface ProjectExpense {
  id: string;
  project_id: string;
  description: string;
  amount: number;
  category: string | null;
  date: string;
}

const PROJECT_STATUS: Record<string, { label: string; color: string; dot: string }> = {
  planning:  { label: "Planificación", color: "bg-blue-500/15 text-blue-400",     dot: "bg-blue-400" },
  active:    { label: "Activo",        color: "bg-emerald-500/15 text-emerald-400", dot: "bg-emerald-400" },
  on_hold:   { label: "En pausa",      color: "bg-yellow-500/15 text-yellow-400", dot: "bg-yellow-400" },
  completed: { label: "Completado",    color: "bg-muted/50 text-muted-foreground", dot: "bg-muted-foreground" },
  cancelled: { label: "Cancelado",     color: "bg-destructive/15 text-destructive", dot: "bg-destructive" },
};

const TASK_STATUS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  todo:        { label: "Por hacer",   icon: Circle,        color: "text-muted-foreground" },
  in_progress: { label: "En progreso", icon: Clock,         color: "text-blue-400" },
  review:      { label: "En revisión", icon: AlertTriangle, color: "text-yellow-400" },
  done:        { label: "Hecho",       icon: CheckCircle2,  color: "text-emerald-400" },
  cancelled:   { label: "Cancelado",   icon: Circle,        color: "text-destructive" },
};

const PRIORITY_COLOR: Record<string, string> = {
  low: "text-muted-foreground", medium: "text-blue-400", high: "text-yellow-400", critical: "text-destructive",
};
const PRIORITY_LABEL: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
function isOverdue(d: string | null) {
  if (!d) return false;
  return new Date(d + "T23:59:59") < new Date();
}

const EMPTY_PROJECT = {
  name: "", description: "", customer_name: "", status: "planning", priority: "medium",
  start_date: new Date().toISOString().substring(0, 10), due_date: "", budget: "", color: "#6366f1", tags: "",
};

export default function ProjectManagementPage() {
  usePageTitle("Gestión de Proyectos");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const orgId = activeOrg?.id ?? "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [expenses, setExpenses] = useState<ProjectExpense[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);

  const [projectForm, setProjectForm] = useState(EMPTY_PROJECT);
  const [taskForm, setTaskForm] = useState({
    title: "", description: "", status: "todo", priority: "medium",
    assignee_name: "", due_date: "", estimated_hours: "",
  });
  const [timeForm, setTimeForm] = useState({ hours: "", description: "", logged_at: new Date().toISOString().substring(0,10) });
  const [expenseForm, setExpenseForm] = useState({ description: "", amount: "", category: "", date: new Date().toISOString().substring(0,10) });
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [projRes, taskRes, tlRes, expRes] = await Promise.all([
      supabase.from("projects").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("project_tasks").select("*").eq("org_id", orgId).order("sort_order"),
      supabase.from("project_time_logs").select("*").eq("org_id", orgId).order("logged_at", { ascending: false }),
      supabase.from("project_expenses").select("*").eq("org_id", orgId).order("date", { ascending: false }),
    ]);
    setProjects((projRes.data || []) as Project[]);
    setTasks((taskRes.data || []) as ProjectTask[]);
    setTimeLogs((tlRes.data || []) as TimeLog[]);
    setExpenses((expRes.data || []) as ProjectExpense[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function saveProject() {
    if (!projectForm.name.trim()) { toast.error("Nombre requerido"); return; }
    const payload = {
      org_id: orgId, name: projectForm.name.trim(), description: projectForm.description || null,
      customer_name: projectForm.customer_name || null, status: projectForm.status,
      priority: projectForm.priority, start_date: projectForm.start_date || null,
      due_date: projectForm.due_date || null, budget: projectForm.budget ? Number(projectForm.budget) : null,
      color: projectForm.color,
      tags: projectForm.tags ? projectForm.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      created_by: user?.id || null,
    };
    if (editingProject) {
      const { error } = await supabase.from("projects").update(payload).eq("id", editingProject.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Proyecto actualizado");
    } else {
      const { error } = await supabase.from("projects").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Proyecto creado");
    }
    setProjectOpen(false); setEditingProject(null); setProjectForm(EMPTY_PROJECT);
    loadData();
  }

  async function deleteProject(id: string) {
    if (!confirm("¿Eliminar proyecto y todas sus tareas?")) return;
    await supabase.from("projects").delete().eq("id", id);
    if (selectedProject?.id === id) setSelectedProject(null);
    toast.success("Proyecto eliminado");
    loadData();
  }

  async function updateProjectStatus(id: string, status: string) {
    await supabase.from("projects").update({ status, ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}) }).eq("id", id);
    setProjects(ps => ps.map(p => p.id === id ? { ...p, status } : p));
    toast.success("Estado actualizado");
  }

  async function saveTask() {
    if (!selectedProject || !taskForm.title.trim()) { toast.error("Título requerido"); return; }
    const { error } = await supabase.from("project_tasks").insert({
      org_id: orgId, project_id: selectedProject.id, title: taskForm.title.trim(),
      description: taskForm.description || null, status: taskForm.status, priority: taskForm.priority,
      assignee_name: taskForm.assignee_name || null,
      due_date: taskForm.due_date || null,
      estimated_hours: taskForm.estimated_hours ? Number(taskForm.estimated_hours) : null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Tarea creada");
    setTaskOpen(false);
    setTaskForm({ title: "", description: "", status: "todo", priority: "medium", assignee_name: "", due_date: "", estimated_hours: "" });
    loadData();
  }

  async function updateTaskStatus(id: string, status: string) {
    await supabase.from("project_tasks").update({ status }).eq("id", id);
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status } : t));
  }

  async function deleteTask(id: string) {
    await supabase.from("project_tasks").delete().eq("id", id);
    toast.success("Tarea eliminada");
    loadData();
  }

  async function logTime() {
    if (!selectedTask || !timeForm.hours) { toast.error("Horas requeridas"); return; }
    const { error } = await supabase.from("project_time_logs").insert({
      org_id: orgId, task_id: selectedTask.id, hours: Number(timeForm.hours),
      user_name: user?.email || null, description: timeForm.description || null,
      logged_at: timeForm.logged_at,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Tiempo registrado");
    setTimeOpen(false); setSelectedTask(null);
    setTimeForm({ hours: "", description: "", logged_at: new Date().toISOString().substring(0,10) });
    loadData();
  }

  async function addExpense() {
    if (!selectedProject || !expenseForm.description.trim() || !expenseForm.amount) {
      toast.error("Descripción y monto requeridos"); return;
    }
    const { error } = await supabase.from("project_expenses").insert({
      org_id: orgId, project_id: selectedProject.id,
      description: expenseForm.description.trim(), amount: Number(expenseForm.amount),
      category: expenseForm.category || null, date: expenseForm.date,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Gasto registrado");
    setExpenseOpen(false);
    setExpenseForm({ description: "", amount: "", category: "", date: new Date().toISOString().substring(0,10) });
    loadData();
  }

  const filteredProjects = statusFilter === "all" ? projects : projects.filter(p => p.status === statusFilter);
  const projectTasks = selectedProject ? tasks.filter(t => t.project_id === selectedProject.id) : [];
  const projectExpenses = selectedProject ? expenses.filter(e => e.project_id === selectedProject.id) : [];
  const totalHours = selectedProject ? timeLogs.filter(t => projectTasks.some(pt => pt.id === t.task_id)).reduce((s, t) => s + t.hours, 0) : 0;

  const tasksByStatus = (status: string) => projectTasks.filter(t => t.status === status);

  const kpis = useMemo(() => {
    const activeProjects = projects.filter(p => p.status === "active").length;
    const totalTasks = tasks.length;
    const doneTasks = tasks.filter(t => t.status === "done").length;
    const totalBudget = projects.reduce((s, p) => s + (p.budget ?? 0), 0);
    return [
      { label: "Proyectos activos", value: activeProjects, icon: FolderKanban, color: "primary" as const },
      { label: "Tareas totales", value: totalTasks, icon: BarChart3, color: "blue" as const },
      { label: "Tareas completadas", value: doneTasks, icon: CheckSquare, color: "success" as const },
      { label: "Presupuesto total", value: new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(totalBudget), icon: DollarSign, color: "warning" as const },
    ];
  }, [projects, tasks]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={FolderKanban}
        title="Gestión de Proyectos"
        description="Proyectos con hitos, tareas Kanban, registro de horas y control de presupuesto."
        actions={
          <Button onClick={() => { setEditingProject(null); setProjectForm(EMPTY_PROJECT); setProjectOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nuevo proyecto
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} color={k.color} />
        ))}
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {["all", "planning", "active", "on_hold", "completed"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
            {s === "all" ? "Todos" : PROJECT_STATUS[s]?.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <div className={`grid gap-6 ${selectedProject ? "grid-cols-1 lg:grid-cols-[320px_1fr]" : ""}`}>
          {/* Project cards */}
          <div className="space-y-3 pb-12">
            {filteredProjects.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <FolderKanban className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sin proyectos. Creá el primero.</p>
              </div>
            ) : filteredProjects.map(project => {
              const st = PROJECT_STATUS[project.status];
              const projTasks = tasks.filter(t => t.project_id === project.id);
              const doneTasks = projTasks.filter(t => t.status === "done").length;
              const pct = projTasks.length > 0 ? Math.round((doneTasks / projTasks.length) * 100) : project.progress_pct;
              const budgetPct = project.budget && project.budget > 0 ? Math.min((project.spent / project.budget) * 100, 100) : 0;
              const isSelected = selectedProject?.id === project.id;

              return (
                <div key={project.id}
                  className={`rounded-xl border cursor-pointer transition-all ${isSelected ? "border-primary/50 bg-primary/5" : "border-border/50 bg-card hover:border-border"}`}
                  onClick={() => setSelectedProject(isSelected ? null : project)}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                        <h3 className="font-semibold text-sm">{project.name}</h3>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditingProject(project); setProjectForm({ name: project.name, description: project.description || "", customer_name: project.customer_name || "", status: project.status, priority: project.priority, start_date: project.start_date || "", due_date: project.due_date || "", budget: project.budget ? String(project.budget) : "", color: project.color, tags: project.tags.join(", ") }); setProjectOpen(true); }}
                          className="text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteProject(project.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                      <span className={`text-[10px] font-semibold ${PRIORITY_COLOR[project.priority]}`}>
                        ● {PRIORITY_LABEL[project.priority]}
                      </span>
                      {project.customer_name && <span className="text-xs text-muted-foreground">{project.customer_name}</span>}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{doneTasks}/{projTasks.length} tareas</span>
                      <span className={isOverdue(project.due_date) && project.status === "active" ? "text-destructive" : ""}>
                        {fmtDate(project.due_date)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    {project.budget && (
                      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>Presupuesto</span>
                        <span className={budgetPct >= 90 ? "text-destructive" : ""}>
                          {fmt(project.spent)} / {fmt(project.budget)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Project detail */}
          {selectedProject && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="border-b border-border/30 p-4 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-base">{selectedProject.name}</h2>
                  <p className="text-xs text-muted-foreground">{selectedProject.customer_name || "Sin cliente"}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setExpenseOpen(true); }}>
                    <DollarSign className="w-3 h-3 mr-1" /> Gasto
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => setTaskOpen(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Tarea
                  </Button>
                </div>
              </div>

              <Tabs defaultValue="kanban" className="p-4">
                <TabsList className="mb-3">
                  <TabsTrigger value="kanban">Kanban</TabsTrigger>
                  <TabsTrigger value="expenses">Gastos ({projectExpenses.length})</TabsTrigger>
                  <TabsTrigger value="time">Horas ({totalHours.toFixed(1)}h)</TabsTrigger>
                </TabsList>

                <TabsContent value="kanban">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {["todo", "in_progress", "review", "done"].map(status => {
                      const sc = TASK_STATUS[status];
                      const StatusIcon = sc.icon;
                      const colTasks = tasksByStatus(status);
                      return (
                        <div key={status} className="bg-muted/20 rounded-lg p-2">
                          <div className={`flex items-center gap-1.5 mb-2 text-xs font-semibold ${sc.color}`}>
                            <StatusIcon className="w-3 h-3" />
                            {sc.label}
                            <span className="ml-auto bg-muted/50 px-1.5 rounded-full">{colTasks.length}</span>
                          </div>
                          <div className="space-y-1.5">
                            {colTasks.map(task => (
                              <div key={task.id} className="bg-card rounded-lg p-2 border border-border/30 text-xs group">
                                <p className="font-medium leading-snug">{task.title}</p>
                                {task.assignee_name && <p className="text-muted-foreground mt-0.5">{task.assignee_name}</p>}
                                {task.due_date && (
                                  <p className={`mt-0.5 ${isOverdue(task.due_date) ? "text-destructive" : "text-muted-foreground"}`}>
                                    {fmtDate(task.due_date)}
                                  </p>
                                )}
                                {task.estimated_hours && (
                                  <p className="text-muted-foreground/60 mt-0.5">{task.logged_hours}/{task.estimated_hours}h</p>
                                )}
                                <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => { setSelectedTask(task); setTimeOpen(true); }}
                                    className="text-muted-foreground hover:text-primary"><Timer className="w-3 h-3" /></button>
                                  {status !== "done" && (
                                    <button onClick={() => updateTaskStatus(task.id, "done")}
                                      className="text-muted-foreground hover:text-emerald-400"><CheckCircle2 className="w-3 h-3" /></button>
                                  )}
                                  <button onClick={() => deleteTask(task.id)}
                                    className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="expenses">
                  {projectExpenses.length === 0 ? (
                    <p className="text-center py-6 text-muted-foreground text-sm">Sin gastos registrados.</p>
                  ) : (
                    <div className="space-y-1 pb-12">
                      {projectExpenses.map(exp => (
                        <div key={exp.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/20">
                          <span className="flex-1">{exp.description}</span>
                          {exp.category && <span className="text-xs text-muted-foreground">{exp.category}</span>}
                          <span className="font-mono font-semibold">{fmt(exp.amount)}</span>
                          <span className="text-xs text-muted-foreground">{fmtDate(exp.date)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between font-semibold text-sm pt-2">
                        <span>Total gastado</span>
                        <span className={selectedProject.budget && selectedProject.spent > selectedProject.budget ? "text-destructive" : ""}>{fmt(selectedProject.spent)}</span>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="time">
                  {timeLogs.filter(t => projectTasks.some(pt => pt.id === t.task_id)).length === 0 ? (
                    <p className="text-center py-6 text-muted-foreground text-sm">Sin horas registradas.</p>
                  ) : (
                    <div className="space-y-1 pb-12">
                      {timeLogs.filter(t => projectTasks.some(pt => pt.id === t.task_id)).map(tl => {
                        const task = projectTasks.find(t => t.id === tl.task_id);
                        return (
                          <div key={tl.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/20">
                            <span className="flex-1 text-muted-foreground truncate">{task?.title || "Tarea"}</span>
                            {tl.description && <span className="text-xs text-muted-foreground hidden md:block">{tl.description}</span>}
                            <span className="font-mono font-semibold">{tl.hours}h</span>
                            <span className="text-xs text-muted-foreground">{fmtDate(tl.logged_at)}</span>
                          </div>
                        );
                      })}
                      <div className="flex justify-between font-semibold text-sm pt-2">
                        <span>Total horas</span>
                        <span>{totalHours.toFixed(1)}h</span>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      )}

      {/* Project dialog */}
      <Dialog open={projectOpen} onOpenChange={v => { setProjectOpen(v); if (!v) setEditingProject(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingProject ? "Editar proyecto" : "Nuevo proyecto"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre *</Label>
                <Input value={projectForm.name} onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))} placeholder="Rediseño web..." />
              </div>
              <div><Label>Cliente</Label>
                <Input value={projectForm.customer_name} onChange={e => setProjectForm(p => ({ ...p, customer_name: e.target.value }))} placeholder="Empresa XYZ..." />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Estado</Label>
                <Select value={projectForm.status} onValueChange={v => setProjectForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PROJECT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Prioridad</Label>
                <Select value={projectForm.priority} onValueChange={v => setProjectForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Color</Label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={projectForm.color} onChange={e => setProjectForm(p => ({ ...p, color: e.target.value }))}
                    className="h-9 w-12 rounded border border-border cursor-pointer bg-transparent" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inicio</Label>
                <Input type="date" value={projectForm.start_date} onChange={e => setProjectForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div><Label>Vencimiento</Label>
                <Input type="date" value={projectForm.due_date} onChange={e => setProjectForm(p => ({ ...p, due_date: e.target.value }))} />
              </div>
            </div>
            <div><Label>Presupuesto</Label>
              <Input type="number" min="0" value={projectForm.budget} onChange={e => setProjectForm(p => ({ ...p, budget: e.target.value }))} placeholder="$0" />
            </div>
            <div><Label>Descripción</Label>
              <Textarea value={projectForm.description} onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div><Label>Tags (separados por coma)</Label>
              <Input value={projectForm.tags} onChange={e => setProjectForm(p => ({ ...p, tags: e.target.value }))} placeholder="web, diseño, urgente..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setProjectOpen(false); setEditingProject(null); }}>Cancelar</Button>
            <Button onClick={saveProject}>{editingProject ? "Guardar" : "Crear proyecto"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task dialog */}
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nueva tarea — {selectedProject?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Título *</Label>
              <Input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} autoFocus placeholder="Implementar login..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Estado</Label>
                <Select value={taskForm.status} onValueChange={v => setTaskForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TASK_STATUS).slice(0,4).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Prioridad</Label>
                <Select value={taskForm.priority} onValueChange={v => setTaskForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Asignado a</Label>
                <Input value={taskForm.assignee_name} onChange={e => setTaskForm(p => ({ ...p, assignee_name: e.target.value }))} placeholder="Nombre..." />
              </div>
              <div><Label>Vencimiento</Label>
                <Input type="date" value={taskForm.due_date} onChange={e => setTaskForm(p => ({ ...p, due_date: e.target.value }))} />
              </div>
            </div>
            <div><Label>Horas estimadas</Label>
              <Input type="number" min="0" step="0.5" value={taskForm.estimated_hours} onChange={e => setTaskForm(p => ({ ...p, estimated_hours: e.target.value }))} placeholder="4" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskOpen(false)}>Cancelar</Button>
            <Button onClick={saveTask}>Crear tarea</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time log dialog */}
      <Dialog open={timeOpen} onOpenChange={v => { setTimeOpen(v); if (!v) setSelectedTask(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registrar horas — {selectedTask?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Horas *</Label>
                <Input type="number" min="0.5" step="0.5" value={timeForm.hours} onChange={e => setTimeForm(p => ({ ...p, hours: e.target.value }))} autoFocus placeholder="2" />
              </div>
              <div><Label>Fecha</Label>
                <Input type="date" value={timeForm.logged_at} onChange={e => setTimeForm(p => ({ ...p, logged_at: e.target.value }))} />
              </div>
            </div>
            <div><Label>Descripción</Label>
              <Input value={timeForm.description} onChange={e => setTimeForm(p => ({ ...p, description: e.target.value }))} placeholder="Qué hice..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTimeOpen(false)}>Cancelar</Button>
            <Button onClick={logTime}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expense dialog */}
      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Gasto del proyecto — {selectedProject?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Descripción *</Label>
              <Input value={expenseForm.description} onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))} placeholder="Hosting, diseño, tools..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Monto *</Label>
                <Input type="number" min="0" value={expenseForm.amount} onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))} placeholder="$0" />
              </div>
              <div><Label>Fecha</Label>
                <Input type="date" value={expenseForm.date} onChange={e => setExpenseForm(p => ({ ...p, date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseOpen(false)}>Cancelar</Button>
            <Button onClick={addExpense}>Registrar gasto</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
