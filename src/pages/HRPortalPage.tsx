import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { KPICard } from "@/components/shared/KPICard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Users, UserPlus, Calendar, Star, FileText, ChevronDown, ChevronUp,
  Plus, Pencil, Trash2, CheckCircle2, XCircle, Clock, Building2,
  Phone, Mail, AlertCircle, Award, RefreshCcw, Shield, Loader2
} from "lucide-react";
import { toast } from "sonner";

/* ─────────────────────────── types ─────────────────────────── */
interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  cuil: string | null;
  position: string;
  department: string;
  hire_date: string;
  termination_date: string | null;
  contract_type: string;
  salary: number;
  salary_currency: string;
  manager_id: string | null;
  status: string;
  notes: string | null;
}

interface LeaveType {
  id: string;
  name: string;
  max_days_per_year: number;
  is_paid: boolean;
  color: string;
  requires_approval: boolean;
}

interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string | null;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  employees: { first_name: string; last_name: string } | null;
  leave_types: { name: string; color: string } | null;
}

interface PerformanceReview {
  id: string;
  employee_id: string;
  review_period: string;
  review_type: string;
  overall_rating: number | null;
  goals_score: number | null;
  skills_score: number | null;
  teamwork_score: number | null;
  leadership_score: number | null;
  strengths: string | null;
  improvements: string | null;
  status: string;
  employees: { first_name: string; last_name: string } | null;
}

/* ─────────────────────────── configs ─────────────────────────── */
const CONTRACT_LABELS: Record<string, string> = {
  full_time: "Tiempo completo", part_time: "Tiempo parcial", contractor: "Contratista",
  intern: "Pasante", temporary: "Temporal",
};
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:     { label: "Activo",      color: "bg-green-500/15 text-green-400" },
  on_leave:   { label: "De licencia", color: "bg-yellow-500/15 text-yellow-400" },
  terminated: { label: "Finalizado",  color: "bg-red-500/15 text-red-400" },
  suspended:  { label: "Suspendido",  color: "bg-orange-500/15 text-orange-400" },
};
const LEAVE_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: "Pendiente", color: "bg-yellow-500/15 text-yellow-400", icon: <Clock className="w-3 h-3" /> },
  approved:  { label: "Aprobada",  color: "bg-green-500/15 text-green-400",  icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:  { label: "Rechazada", color: "bg-red-500/15 text-red-400",      icon: <XCircle className="w-3 h-3" /> },
  cancelled: { label: "Cancelada", color: "bg-muted/50 text-muted-foreground", icon: <XCircle className="w-3 h-3" /> },
};
const REVIEW_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:        { label: "Borrador",    color: "bg-muted/40 text-muted-foreground" },
  submitted:    { label: "Enviada",     color: "bg-blue-500/15 text-blue-400" },
  acknowledged: { label: "Confirmada", color: "bg-green-500/15 text-green-400" },
};

const TABS = ["Empleados", "Licencias", "Evaluaciones", "Tipos de licencia"] as const;
type Tab = typeof TABS[number];

function StarRating({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(String(n))}
          className={`text-xl transition-colors ${Number(value) >= n ? "text-yellow-400" : "text-muted/40 hover:text-yellow-200"}`}>
          ★
        </button>
      ))}
    </div>
  );
}

export default function HRPortalPage() {
  usePageTitle("Portal RRHH");
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<Tab>("Empleados");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);

  /* dialogs */
  const [showEmpDialog, setShowEmpDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showLeaveTypeDialog, setShowLeaveTypeDialog] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [editingReview, setEditingReview] = useState<PerformanceReview | null>(null);
  const [rejectingLeave, setRejectingLeave] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  /* forms */
  const blankEmp = { first_name: "", last_name: "", email: "", phone: "", cuil: "", position: "", department: "General", hire_date: new Date().toISOString().slice(0,10), contract_type: "full_time", salary: "", salary_currency: "ARS", status: "active", notes: "", manager_id: "" };
  const [empForm, setEmpForm] = useState<typeof blankEmp & Record<string, string>>(blankEmp);
  const [leaveForm, setLeaveForm] = useState({ employee_id: "", leave_type_id: "", start_date: "", end_date: "", reason: "" });
  const [reviewForm, setReviewForm] = useState({ employee_id: "", review_period: "", review_type: "annual", overall_rating: "3", goals_score: "3", skills_score: "3", teamwork_score: "3", leadership_score: "3", strengths: "", improvements: "" });
  const [ltForm, setLtForm] = useState({ name: "", max_days_per_year: "15", is_paid: true, color: "#3b82f6", requires_approval: true });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [er, ltr, lrr, rr] = await Promise.allSettled([
      supabase.from("employees").select("*").eq("org_id", orgId).order("last_name"),
      supabase.from("leave_types").select("*").eq("org_id", orgId).order("name"),
      supabase.from("leave_requests").select("*, employees(first_name,last_name), leave_types(name,color)").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("performance_reviews").select("*, employees(first_name,last_name)").eq("org_id", orgId).order("created_at", { ascending: false }),
    ]);
    if (er.status === "fulfilled" && er.value.data) setEmployees(er.value.data as Employee[]);
    if (ltr.status === "fulfilled" && ltr.value.data) setLeaveTypes(ltr.value.data as LeaveType[]);
    if (lrr.status === "fulfilled" && lrr.value.data) setLeaveRequests(lrr.value.data as LeaveRequest[]);
    if (rr.status === "fulfilled" && rr.value.data) setReviews(rr.value.data as PerformanceReview[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function seedLeaveTypes() {
    if (!orgId) return;
    await supabase.rpc("seed_leave_types", { p_org_id: orgId });
    toast.success("Tipos de licencia cargados");
    load();
  }

  /* ── Employee CRUD ── */
  function openNewEmp() {
    setEditingEmp(null);
    setEmpForm(blankEmp);
    setShowEmpDialog(true);
  }
  function openEditEmp(e: Employee) {
    setEditingEmp(e);
    setEmpForm({ first_name: e.first_name, last_name: e.last_name, email: e.email ?? "", phone: e.phone ?? "", cuil: e.cuil ?? "", position: e.position, department: e.department, hire_date: e.hire_date, contract_type: e.contract_type, salary: String(e.salary), salary_currency: e.salary_currency, status: e.status, notes: e.notes ?? "", manager_id: e.manager_id ?? "" });
    setShowEmpDialog(true);
  }
  async function saveEmp() {
    if (!orgId || !empForm.first_name.trim() || !empForm.last_name.trim()) return;
    const payload = { org_id: orgId, first_name: empForm.first_name.trim(), last_name: empForm.last_name.trim(), email: empForm.email || null, phone: empForm.phone || null, cuil: empForm.cuil || null, position: empForm.position, department: empForm.department, hire_date: empForm.hire_date, contract_type: empForm.contract_type, salary: parseFloat(empForm.salary) || 0, salary_currency: empForm.salary_currency, status: empForm.status, notes: empForm.notes || null, manager_id: empForm.manager_id || null };
    if (editingEmp) {
      const { error } = await supabase.from("employees").update(payload).eq("id", editingEmp.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("employees").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Empleado guardado");
    setShowEmpDialog(false);
    load();
  }

  /* ── Leave request actions ── */
  async function approveLeave(id: string) {
    const { error } = await supabase.from("leave_requests").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Licencia aprobada");
    load();
  }
  async function rejectLeave(id: string) {
    if (!rejectReason.trim()) { toast.error("Ingresá el motivo de rechazo"); return; }
    await supabase.from("leave_requests").update({ status: "rejected", rejection_reason: rejectReason }).eq("id", id);
    toast.success("Licencia rechazada");
    setRejectingLeave(null);
    setRejectReason("");
    load();
  }

  /* ── Save leave request ── */
  async function saveLeave() {
    if (!orgId || !leaveForm.employee_id || !leaveForm.leave_type_id || !leaveForm.start_date || !leaveForm.end_date) return;
    const days = Math.max(1, Math.ceil((new Date(leaveForm.end_date).getTime() - new Date(leaveForm.start_date).getTime()) / 86400000) + 1);
    const { error } = await supabase.from("leave_requests").insert({ org_id: orgId, employee_id: leaveForm.employee_id, leave_type_id: leaveForm.leave_type_id, start_date: leaveForm.start_date, end_date: leaveForm.end_date, days_count: days, reason: leaveForm.reason || null, status: "pending" });
    if (error) { toast.error(error.message); return; }
    toast.success("Solicitud enviada");
    setShowLeaveDialog(false);
    load();
  }

  /* ── Save review ── */
  async function saveReview() {
    if (!orgId || !reviewForm.employee_id || !reviewForm.review_period.trim()) return;
    const payload = { org_id: orgId, employee_id: reviewForm.employee_id, review_period: reviewForm.review_period, review_type: reviewForm.review_type, overall_rating: parseFloat(reviewForm.overall_rating), goals_score: parseFloat(reviewForm.goals_score), skills_score: parseFloat(reviewForm.skills_score), teamwork_score: parseFloat(reviewForm.teamwork_score), leadership_score: parseFloat(reviewForm.leadership_score), strengths: reviewForm.strengths || null, improvements: reviewForm.improvements || null, status: "draft" };
    if (editingReview) {
      await supabase.from("performance_reviews").update(payload).eq("id", editingReview.id);
    } else {
      const { error } = await supabase.from("performance_reviews").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Evaluación guardada");
    setShowReviewDialog(false);
    load();
  }

  /* ── Leave type CRUD ── */
  async function saveLeaveType() {
    if (!orgId || !ltForm.name.trim()) return;
    await supabase.from("leave_types").insert({ org_id: orgId, name: ltForm.name, max_days_per_year: parseInt(ltForm.max_days_per_year) || 15, is_paid: ltForm.is_paid, color: ltForm.color, requires_approval: ltForm.requires_approval });
    toast.success("Tipo guardado");
    setShowLeaveTypeDialog(false);
    load();
  }

  /* ── Stats ── */
  const activeCount = employees.filter(e => e.status === "active").length;
  const pendingLeaves = leaveRequests.filter(l => l.status === "pending").length;
  const deptMap = employees.reduce<Record<string, number>>((acc, e) => { acc[e.department] = (acc[e.department] ?? 0) + 1; return acc; }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Portal RRHH"
        description="Empleados, licencias y evaluaciones de desempeño"
        actions={
          <div className="flex gap-2">
            {activeTab === "Empleados" && <Button size="sm" onClick={openNewEmp}><Plus className="w-4 h-4 mr-1" /> Empleado</Button>}
            {activeTab === "Licencias" && <Button size="sm" onClick={() => setShowLeaveDialog(true)}><Plus className="w-4 h-4 mr-1" /> Solicitud</Button>}
            {activeTab === "Evaluaciones" && <Button size="sm" onClick={() => { setEditingReview(null); setReviewForm({ employee_id: "", review_period: "", review_type: "annual", overall_rating: "3", goals_score: "3", skills_score: "3", teamwork_score: "3", leadership_score: "3", strengths: "", improvements: "" }); setShowReviewDialog(true); }}><Plus className="w-4 h-4 mr-1" /> Evaluación</Button>}
            {activeTab === "Tipos de licencia" && <Button size="sm" onClick={() => setShowLeaveTypeDialog(true)}><Plus className="w-4 h-4 mr-1" /> Tipo</Button>}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Empleados activos" value={activeCount} icon={Users} color="purple" />
        <KPICard label="Licencias pendientes" value={pendingLeaves} icon={Clock} color="warning" />
        <KPICard label="Departamentos" value={Object.keys(deptMap).length} icon={Building2} color="blue" />
        <KPICard label="Evaluaciones abiertas" value={reviews.filter(r => r.status !== "acknowledged").length} icon={Star} color="success" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit border border-border/40">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* ── Empleados ── */}
          {activeTab === "Empleados" && (
            <div className="bg-card rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>{["Nombre", "Puesto", "Depto.", "Contrato", "Sueldo", "Ingreso", "Estado", ""].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {employees.map(e => {
                    const st = STATUS_CONFIG[e.status] ?? STATUS_CONFIG.active;
                    const isExp = expandedEmp === e.id;
                    return (
                      <>
                        <tr key={e.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => setExpandedEmp(isExp ? null : e.id)}>
                          <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold">{e.first_name[0]}{e.last_name[0]}</div>
                            {e.first_name} {e.last_name}
                            {isExp ? <ChevronUp className="w-4 h-4 text-muted-foreground ml-auto" /> : <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto" />}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{e.position}</td>
                          <td className="px-4 py-3 text-muted-foreground">{e.department}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{CONTRACT_LABELS[e.contract_type]}</td>
                          <td className="px-4 py-3 font-medium">${e.salary.toLocaleString("es-AR")} {e.salary_currency}</td>
                          <td className="px-4 py-3 text-muted-foreground/70 text-xs">{e.hire_date}</td>
                          <td className="px-4 py-3"><Badge className={`${st.color} text-xs`}>{st.label}</Badge></td>
                          <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openEditEmp(e)}><Pencil className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="sm" className="text-red-500" onClick={() => supabase.from("employees").delete().eq("id", e.id).then(load)}><Trash2 className="w-4 h-4" /></Button>
                            </div>
                          </td>
                        </tr>
                        {isExp && (
                          <tr key={`${e.id}-exp`} className="bg-violet-500/5">
                            <td colSpan={8} className="px-6 py-3">
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                {e.email && <span className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3.5 h-3.5" />{e.email}</span>}
                                {e.phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="w-3.5 h-3.5" />{e.phone}</span>}
                                {e.cuil && <span className="text-muted-foreground">CUIL: {e.cuil}</span>}
                                {e.notes && <span className="col-span-3 text-muted-foreground italic">{e.notes}</span>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {employees.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Sin empleados registrados</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Licencias ── */}
          {activeTab === "Licencias" && (
            <div className="bg-card rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>{["Empleado","Tipo","Inicio","Fin","Días","Motivo","Estado",""].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {leaveRequests.map(l => {
                    const st = LEAVE_STATUS_CONFIG[l.status] ?? LEAVE_STATUS_CONFIG.pending;
                    return (
                      <tr key={l.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">{l.employees ? `${l.employees.first_name} ${l.employees.last_name}` : "—"}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${(l.leave_types as LeaveRequest["leave_types"])?.color}20`, color: (l.leave_types as LeaveRequest["leave_types"])?.color }}>
                            {(l.leave_types as LeaveRequest["leave_types"])?.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{l.start_date}</td>
                        <td className="px-4 py-3 text-muted-foreground">{l.end_date}</td>
                        <td className="px-4 py-3 font-medium">{l.days_count}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">{l.reason ?? "—"}</td>
                        <td className="px-4 py-3"><Badge className={`${st.color} flex items-center gap-1 text-xs w-fit`}>{st.icon}{st.label}</Badge></td>
                        <td className="px-4 py-3">
                          {l.status === "pending" && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50" onClick={() => approveLeave(l.id)}><CheckCircle2 className="w-3.5 h-3.5" /></Button>
                              <Button size="sm" variant="outline" className="text-red-500 border-red-200 hover:bg-red-50" onClick={() => { setRejectingLeave(l.id); setRejectReason(""); }}><XCircle className="w-3.5 h-3.5" /></Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {leaveRequests.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Sin solicitudes de licencia</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Evaluaciones ── */}
          {activeTab === "Evaluaciones" && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {reviews.map(r => {
                const st = REVIEW_STATUS_CONFIG[r.status] ?? REVIEW_STATUS_CONFIG.draft;
                const metrics = [r.goals_score, r.skills_score, r.teamwork_score, r.leadership_score].filter(Boolean) as number[];
                const avg = metrics.length > 0 ? metrics.reduce((a, b) => a + b, 0) / metrics.length : 0;
                return (
                  <div key={r.id} className="bg-card rounded-xl border p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "—"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{r.review_period} · {r.review_type}</p>
                      </div>
                      <Badge className={`${st.color} text-xs`}>{st.label}</Badge>
                    </div>
                    {r.overall_rating && (
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {[1,2,3,4,5].map(n => <span key={n} className={`text-lg ${(r.overall_rating ?? 0) >= n ? "text-yellow-400" : "text-gray-200"}`}>★</span>)}
                        </div>
                        <span className="text-sm font-medium text-foreground">{r.overall_rating.toFixed(1)} / 5</span>
                      </div>
                    )}
                    {avg > 0 && (
                      <div className="grid grid-cols-4 gap-1 text-xs text-center text-muted-foreground">
                        {[["Metas", r.goals_score], ["Skills", r.skills_score], ["Equipo", r.teamwork_score], ["Liderazgo", r.leadership_score]].map(([label, val]) => (
                          <div key={label as string} className="bg-muted/30 rounded p-1">
                            <p className="font-medium text-foreground">{val ?? "—"}</p>
                            <p className="text-muted-foreground">{label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => { setEditingReview(r); setReviewForm({ employee_id: r.employee_id, review_period: r.review_period, review_type: r.review_type, overall_rating: String(r.overall_rating ?? 3), goals_score: String(r.goals_score ?? 3), skills_score: String(r.skills_score ?? 3), teamwork_score: String(r.teamwork_score ?? 3), leadership_score: String(r.leadership_score ?? 3), strengths: r.strengths ?? "", improvements: r.improvements ?? "" }); setShowReviewDialog(true); }}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                      </Button>
                      {r.status === "submitted" && <Button size="sm" className="flex-1" onClick={() => supabase.from("performance_reviews").update({ status: "acknowledged", acknowledged_at: new Date().toISOString() }).eq("id", r.id).then(load)}>Confirmar</Button>}
                    </div>
                  </div>
                );
              })}
              {reviews.length === 0 && <div className="col-span-3 text-center py-16 text-muted-foreground"><Award className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>Sin evaluaciones</p></div>}
            </div>
          )}

          {/* ── Tipos de licencia ── */}
          {activeTab === "Tipos de licencia" && (
            <div className="space-y-4">
              {leaveTypes.length === 0 && (
                <Button variant="outline" size="sm" onClick={seedLeaveTypes}><RefreshCcw className="w-4 h-4 mr-1" /> Cargar tipos predeterminados</Button>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {leaveTypes.map(lt => (
                  <div key={lt.id} className="bg-card rounded-xl border p-4 flex items-center gap-3">
                    <div className="w-3 h-10 rounded-full" style={{ backgroundColor: lt.color }} />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{lt.name}</p>
                      <p className="text-xs text-muted-foreground">{lt.max_days_per_year} días/año · {lt.is_paid ? "Con goce" : "Sin goce"}</p>
                    </div>
                    {lt.requires_approval && <Shield className="w-4 h-4 text-muted-foreground/50" title="Requiere aprobación" />}
                    <button onClick={() => supabase.from("leave_types").delete().eq("id", lt.id).then(load)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Employee Dialog ── */}
      <Dialog open={showEmpDialog} onOpenChange={setShowEmpDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editingEmp ? "Editar Empleado" : "Nuevo Empleado"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nombre *</Label><Input value={empForm.first_name} onChange={e => setEmpForm(p => ({ ...p, first_name: e.target.value }))} /></div>
            <div><Label>Apellido *</Label><Input value={empForm.last_name} onChange={e => setEmpForm(p => ({ ...p, last_name: e.target.value }))} /></div>
            <div><Label>Email</Label><Input value={empForm.email} onChange={e => setEmpForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div><Label>Teléfono</Label><Input value={empForm.phone} onChange={e => setEmpForm(p => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>CUIL</Label><Input value={empForm.cuil} onChange={e => setEmpForm(p => ({ ...p, cuil: e.target.value }))} /></div>
            <div><Label>Puesto</Label><Input value={empForm.position} onChange={e => setEmpForm(p => ({ ...p, position: e.target.value }))} /></div>
            <div><Label>Departamento</Label><Input value={empForm.department} onChange={e => setEmpForm(p => ({ ...p, department: e.target.value }))} /></div>
            <div><Label>Fecha de ingreso</Label><Input type="date" value={empForm.hire_date} onChange={e => setEmpForm(p => ({ ...p, hire_date: e.target.value }))} /></div>
            <div>
              <Label>Tipo de contrato</Label>
              <Select value={empForm.contract_type} onValueChange={v => setEmpForm(p => ({ ...p, contract_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CONTRACT_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={empForm.status} onValueChange={v => setEmpForm(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(STATUS_CONFIG).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Salario</Label><Input type="number" value={empForm.salary} onChange={e => setEmpForm(p => ({ ...p, salary: e.target.value }))} /></div>
            <div>
              <Label>Moneda</Label>
              <Select value={empForm.salary_currency} onValueChange={v => setEmpForm(p => ({ ...p, salary_currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ARS">ARS</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Notas</Label><Input value={empForm.notes} onChange={e => setEmpForm(p => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmpDialog(false)}>Cancelar</Button>
            <Button onClick={saveEmp}>{editingEmp ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Leave Request Dialog ── */}
      <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva Solicitud de Licencia</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Empleado *</Label>
              <Select value={leaveForm.employee_id} onValueChange={v => setLeaveForm(p => ({ ...p, employee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de licencia *</Label>
              <Select value={leaveForm.leave_type_id} onValueChange={v => setLeaveForm(p => ({ ...p, leave_type_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                <SelectContent>{leaveTypes.map(lt => <SelectItem key={lt.id} value={lt.id}>{lt.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Desde *</Label><Input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(p => ({ ...p, start_date: e.target.value }))} /></div>
              <div><Label>Hasta *</Label><Input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(p => ({ ...p, end_date: e.target.value }))} /></div>
            </div>
            <div><Label>Motivo</Label><Input value={leaveForm.reason} onChange={e => setLeaveForm(p => ({ ...p, reason: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeaveDialog(false)}>Cancelar</Button>
            <Button onClick={saveLeave}>Solicitar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Leave Dialog ── */}
      <Dialog open={!!rejectingLeave} onOpenChange={() => setRejectingLeave(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rechazar solicitud</DialogTitle></DialogHeader>
          <div><Label>Motivo de rechazo *</Label><Input value={rejectReason} onChange={e => setRejectReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingLeave(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => rejectingLeave && rejectLeave(rejectingLeave)}>Rechazar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Review Dialog ── */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingReview ? "Editar Evaluación" : "Nueva Evaluación"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Empleado *</Label>
              <Select value={reviewForm.employee_id} onValueChange={v => setReviewForm(p => ({ ...p, employee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Período *</Label><Input value={reviewForm.review_period} onChange={e => setReviewForm(p => ({ ...p, review_period: e.target.value }))} placeholder="2026-Q2" /></div>
              <div>
                <Label>Tipo</Label>
                <Select value={reviewForm.review_type} onValueChange={v => setReviewForm(p => ({ ...p, review_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["probation","quarterly","semi_annual","annual","360"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {[
              { key: "overall_rating", label: "Puntaje general" },
              { key: "goals_score", label: "Cumplimiento de metas" },
              { key: "skills_score", label: "Habilidades" },
              { key: "teamwork_score", label: "Trabajo en equipo" },
              { key: "leadership_score", label: "Liderazgo" },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center gap-4">
                <Label className="w-40 shrink-0">{label}</Label>
                <StarRating value={reviewForm[key as keyof typeof reviewForm] as string} onChange={v => setReviewForm(p => ({ ...p, [key]: v }))} />
              </div>
            ))}
            <div><Label>Fortalezas</Label><textarea rows={2} value={reviewForm.strengths} onChange={e => setReviewForm(p => ({ ...p, strengths: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm resize-none" /></div>
            <div><Label>Áreas de mejora</Label><textarea rows={2} value={reviewForm.improvements} onChange={e => setReviewForm(p => ({ ...p, improvements: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm resize-none" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>Cancelar</Button>
            <Button onClick={saveReview}>{editingReview ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Leave Type Dialog ── */}
      <Dialog open={showLeaveTypeDialog} onOpenChange={setShowLeaveTypeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo tipo de licencia</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre *</Label><Input value={ltForm.name} onChange={e => setLtForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Máx. días/año</Label><Input type="number" value={ltForm.max_days_per_year} onChange={e => setLtForm(p => ({ ...p, max_days_per_year: e.target.value }))} /></div>
              <div><Label>Color</Label><input type="color" value={ltForm.color} onChange={e => setLtForm(p => ({ ...p, color: e.target.value }))} className="h-10 w-full rounded border cursor-pointer" /></div>
            </div>
            <div className="flex items-center gap-3"><Switch checked={ltForm.is_paid} onCheckedChange={v => setLtForm(p => ({ ...p, is_paid: v }))} /><Label>Con goce de sueldo</Label></div>
            <div className="flex items-center gap-3"><Switch checked={ltForm.requires_approval} onCheckedChange={v => setLtForm(p => ({ ...p, requires_approval: v }))} /><Label>Requiere aprobación</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeaveTypeDialog(false)}>Cancelar</Button>
            <Button onClick={saveLeaveType}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
