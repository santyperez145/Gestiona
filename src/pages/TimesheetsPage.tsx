import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Clock,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Search,
  Users,
  CheckCircle,
  XCircle,
  DollarSign,
  BarChart3,
  Download,
  UserPlus,
  Calendar,
  Banknote,
  Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  name: string;
  email: string | null;
  position: string | null;
  department: string | null;
  hourly_rate: number;
  salary_type: string;
  active: boolean;
  hired_at: string | null;
}

interface Timesheet {
  id: string;
  employee_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  hours_worked: number;
  overtime_hours: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  notes: string | null;
  employee?: Employee;
}

interface PayrollPeriod {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  status: "open" | "closed" | "paid";
  total_gross: number;
  total_net: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TS_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "Borrador", color: "bg-muted/40 text-muted-foreground", icon: Clock },
  submitted: { label: "Enviado", color: "bg-blue-500/15 text-blue-400", icon: Clock },
  approved: { label: "Aprobado", color: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle },
  rejected: { label: "Rechazado", color: "bg-red-500/15 text-red-400", icon: XCircle },
};

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

function fmtHours(h: number) {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// ─── Employee Form ────────────────────────────────────────────────────────────

interface EmpFormProps {
  open: boolean;
  employee: Employee | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function EmpForm({ open, employee, orgId, onClose, onSaved }: EmpFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [hourlyRate, setHourlyRate] = useState("0");
  const [salaryType, setSalaryType] = useState("hourly");
  const [hiredAt, setHiredAt] = useState("");

  useEffect(() => {
    if (employee) {
      setName(employee.name); setEmail(employee.email ?? ""); setPosition(employee.position ?? "");
      setDepartment(employee.department ?? ""); setHourlyRate(String(employee.hourly_rate));
      setSalaryType(employee.salary_type); setHiredAt(employee.hired_at ?? "");
    } else {
      setName(""); setEmail(""); setPosition(""); setDepartment(""); setHourlyRate("0"); setSalaryType("hourly"); setHiredAt("");
    }
  }, [employee, open]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nombre requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId, name: name.trim(), email: email.trim() || null,
      position: position.trim() || null, department: department.trim() || null,
      hourly_rate: parseFloat(hourlyRate) || 0, salary_type: salaryType,
      hired_at: hiredAt || null, active: true,
    };
    const { error } = employee
      ? await supabase.from("employees").update(payload).eq("id", employee.id)
      : await supabase.from("employees").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(employee ? "Empleado actualizado" : "Empleado creado");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{employee ? "Editar empleado" : "Nuevo empleado"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nombre *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <Label>Cargo / Puesto</Label>
              <Input value={position} onChange={e => setPosition(e.target.value)} />
            </div>
            <div>
              <Label>Departamento</Label>
              <Input value={department} onChange={e => setDepartment(e.target.value)} />
            </div>
            <div>
              <Label>Fecha de ingreso</Label>
              <Input type="date" value={hiredAt} onChange={e => setHiredAt(e.target.value)} />
            </div>
            <div>
              <Label>Tipo de salario</Label>
              <Select value={salaryType} onValueChange={setSalaryType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Por hora</SelectItem>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="commission">Comisión</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{salaryType === "hourly" ? "Tarifa por hora" : "Salario base"}</Label>
              <Input type="number" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} min="0" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {employee ? "Guardar" : "Crear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Timesheet Form ───────────────────────────────────────────────────────────

interface TSFormProps {
  open: boolean;
  ts: Timesheet | null;
  employees: Employee[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function TSForm({ open, ts, employees, orgId, onClose, onSaved }: TSFormProps) {
  const [loading, setLoading] = useState(false);
  const [empId, setEmpId] = useState("none");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [clockIn, setClockIn] = useState("09:00");
  const [clockOut, setClockOut] = useState("18:00");
  const [breakMins, setBreakMins] = useState("60");
  const [overtime, setOvertime] = useState("0");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (ts) {
      setEmpId(ts.employee_id); setDate(ts.date); setClockIn(ts.clock_in ?? "09:00");
      setClockOut(ts.clock_out ?? "18:00"); setBreakMins(String(ts.break_minutes));
      setOvertime(String(ts.overtime_hours)); setNotes(ts.notes ?? "");
    } else {
      setEmpId("none"); setDate(format(new Date(), "yyyy-MM-dd")); setClockIn("09:00");
      setClockOut("18:00"); setBreakMins("60"); setOvertime("0"); setNotes("");
    }
  }, [ts, open]);

  const previewHours = useMemo(() => {
    const [inH, inM] = clockIn.split(":").map(Number);
    const [outH, outM] = clockOut.split(":").map(Number);
    const mins = (outH * 60 + outM) - (inH * 60 + inM) - (parseInt(breakMins) || 0);
    return Math.max(0, mins / 60);
  }, [clockIn, clockOut, breakMins]);

  const handleSave = async () => {
    if (empId === "none") { toast.error("Seleccioná un empleado"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId, employee_id: empId, date, clock_in: clockIn, clock_out: clockOut,
      break_minutes: parseInt(breakMins) || 0, overtime_hours: parseFloat(overtime) || 0,
      notes: notes.trim() || null, status: "submitted",
    };
    const { error } = ts
      ? await supabase.from("timesheets").update(payload).eq("id", ts.id)
      : await supabase.from("timesheets").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(ts ? "Actualizado" : "Fichaje cargado");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ts ? "Editar fichaje" : "Nuevo fichaje"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Empleado *</Label>
              <Select value={empId} onValueChange={setEmpId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar...</SelectItem>
                  {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Fecha</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Entrada</Label>
              <Input type="time" value={clockIn} onChange={e => setClockIn(e.target.value)} />
            </div>
            <div>
              <Label>Salida</Label>
              <Input type="time" value={clockOut} onChange={e => setClockOut(e.target.value)} />
            </div>
            <div>
              <Label>Descanso (minutos)</Label>
              <Input type="number" value={breakMins} onChange={e => setBreakMins(e.target.value)} min="0" />
            </div>
            <div>
              <Label>Horas extra</Label>
              <Input type="number" value={overtime} onChange={e => setOvertime(e.target.value)} min="0" step="0.5" />
            </div>
          </div>
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-center">
            <p className="text-xs text-muted-foreground">Horas trabajadas</p>
            <p className="text-2xl font-bold text-primary">{fmtHours(previewHours)}</p>
          </div>
          <div>
            <Label>Notas</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {ts ? "Guardar" : "Cargar fichaje"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TimesheetsPage() {
  usePageTitle("Fichajes & Liquidación");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [payrollPeriods, setPayrollPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterEmp, setFilterEmp] = useState("all");
  const [viewMonth, setViewMonth] = useState(format(new Date(), "yyyy-MM"));

  const [empFormOpen, setEmpFormOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [tsFormOpen, setTsFormOpen] = useState(false);
  const [editingTs, setEditingTs] = useState<Timesheet | null>(null);
  const [generatingPayroll, setGeneratingPayroll] = useState(false);

  const loadAll = async () => {
    if (!orgId) return;
    setLoading(true);
    const monthStart = `${viewMonth}-01`;
    const monthEnd = format(endOfMonth(new Date(monthStart + "T00:00:00")), "yyyy-MM-dd");
    const [empRes, tsRes, prRes] = await Promise.all([
      supabase.from("employees").select("*").eq("org_id", orgId).order("name"),
      supabase.from("timesheets").select("*, employee:employees(*)").eq("org_id", orgId)
        .gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: false }),
      supabase.from("payroll_periods").select("*").eq("org_id", orgId).order("period_start", { ascending: false }).limit(6),
    ]);
    setEmployees(empRes.data ?? []);
    setTimesheets(tsRes.data ?? []);
    setPayrollPeriods(prRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [orgId, viewMonth]);

  const kpis = useMemo(() => {
    const totalHours = timesheets.filter(t => t.status === "approved").reduce((a, t) => a + (t.hours_worked ?? 0), 0);
    const totalCost = timesheets.filter(t => t.status === "approved").reduce((a, t) => {
      const emp = employees.find(e => e.id === t.employee_id);
      return a + (t.hours_worked ?? 0) * (emp?.hourly_rate ?? 0);
    }, 0);
    const pending = timesheets.filter(t => t.status === "submitted").length;
    const activeEmp = employees.filter(e => e.active).length;
    return { totalHours, totalCost, pending, activeEmp };
  }, [timesheets, employees]);

  const filteredTs = useMemo(() => {
    return timesheets.filter(t => {
      const matchEmp = filterEmp === "all" || t.employee_id === filterEmp;
      return matchEmp;
    });
  }, [timesheets, filterEmp]);

  const handleApprove = async (ts: Timesheet) => {
    await supabase.from("timesheets").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", ts.id);
    setTimesheets(prev => prev.map(t => t.id === ts.id ? { ...t, status: "approved" as const } : t));
    toast.success("Fichaje aprobado");
  };

  const handleReject = async (ts: Timesheet) => {
    await supabase.from("timesheets").update({ status: "rejected" }).eq("id", ts.id);
    setTimesheets(prev => prev.map(t => t.id === ts.id ? { ...t, status: "rejected" as const } : t));
    toast.success("Fichaje rechazado");
  };

  const handleDeleteTs = async (ts: Timesheet) => {
    await supabase.from("timesheets").delete().eq("id", ts.id);
    setTimesheets(prev => prev.filter(t => t.id !== ts.id));
    toast.success("Eliminado");
  };

  const handleCreatePayrollPeriod = async () => {
    const monthStart = `${viewMonth}-01`;
    const monthEnd = format(endOfMonth(new Date(monthStart + "T00:00:00")), "yyyy-MM-dd");
    const monthName = format(new Date(monthStart + "T00:00:00"), "MMMM yyyy", { locale: es });
    const { data, error } = await supabase.from("payroll_periods").insert({
      org_id: orgId, name: monthName, period_start: monthStart, period_end: monthEnd, status: "open",
    }).select().single();
    if (error) { toast.error("Error: " + error.message); return; }
    setGeneratingPayroll(true);
    await supabase.rpc("generate_payroll", { p_period_id: data.id, p_org_id: orgId });
    setGeneratingPayroll(false);
    toast.success("Liquidación generada");
    loadAll();
  };

  const exportCSV = () => {
    const rows = [
      ["Empleado", "Fecha", "Entrada", "Salida", "Horas", "Estado", "Costo"],
      ...filteredTs.map(t => {
        const emp = employees.find(e => e.id === t.employee_id);
        const cost = (t.hours_worked ?? 0) * (emp?.hourly_rate ?? 0);
        return [emp?.name ?? "—", t.date, t.clock_in ?? "—", t.clock_out ?? "—",
          (t.hours_worked ?? 0).toFixed(2), TS_STATUS_CONFIG[t.status]?.label, cost.toFixed(2)];
      }),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fichajes-${viewMonth}.csv`; a.click();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Clock}
        title="Fichajes & Liquidación"
        description="Control de asistencia y generación de liquidaciones"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Input type="month" value={viewMonth} onChange={e => setViewMonth(e.target.value)} className="w-36" />
            <Button variant="outline" size="sm" onClick={exportCSV}><Download className="w-4 h-4 mr-1.5" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={() => { setEditingEmp(null); setEmpFormOpen(true); }}>
              <UserPlus className="w-4 h-4 mr-1.5" /> Empleado
            </Button>
            <Button size="sm" onClick={() => { setEditingTs(null); setTsFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Fichaje
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard label="Empleados activos" value={kpis.activeEmp} icon={Users} color="blue" />
        <KPICard label="Horas aprobadas" value={fmtHours(kpis.totalHours)} icon={Clock} color="success" />
        <KPICard label="Costo estimado" value={fmtCurrency(kpis.totalCost)} icon={DollarSign} color="primary" />
        <KPICard label="Pendientes aprobación" value={kpis.pending} icon={BarChart3} color="warning" />
      </div>

      <Tabs defaultValue="timesheets">
        <TabsList>
          <TabsTrigger value="timesheets">Fichajes ({filteredTs.length})</TabsTrigger>
          <TabsTrigger value="employees">Empleados ({employees.length})</TabsTrigger>
          <TabsTrigger value="payroll">Liquidaciones</TabsTrigger>
        </TabsList>

        {/* ── Timesheets ── */}
        <TabsContent value="timesheets" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Select value={filterEmp} onValueChange={setFilterEmp}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los empleados</SelectItem>
                {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
          : filteredTs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Sin fichajes este mes</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Empleado</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Fecha</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Entrada / Salida</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Horas</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Costo</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Estado</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredTs.map(t => {
                    const emp = employees.find(e => e.id === t.employee_id);
                    const cost = (t.hours_worked ?? 0) * (emp?.hourly_rate ?? 0);
                    const sc = TS_STATUS_CONFIG[t.status];
                    const SCIcon = sc.icon;
                    return (
                      <tr key={t.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium">{emp?.name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-sm">
                          <span className={isToday(new Date(t.date + "T00:00:00")) ? "text-primary font-medium" : ""}>
                            {format(new Date(t.date + "T00:00:00"), "dd/MM/yy")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {t.clock_in ?? "—"} → {t.clock_out ?? "—"}
                          {t.break_minutes > 0 && <span className="text-muted-foreground ml-1">(-{t.break_minutes}m)</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold">{fmtHours(t.hours_worked ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right">{fmtCurrency(cost)}</td>
                        <td className="px-4 py-2.5">
                          <Badge className={`text-xs ${sc.color}`}><SCIcon className="w-3 h-3 mr-1" />{sc.label}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1">
                            {t.status === "submitted" && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => handleApprove(t)} title="Aprobar">
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => handleReject(t)} title="Rechazar">
                                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => { setEditingTs(t); setTsFormOpen(true); }}>
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteTs(t)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Employees ── */}
        <TabsContent value="employees" className="mt-4 space-y-3">
          {employees.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Sin empleados registrados</p>
            </div>
          ) : employees.map(emp => (
            <div key={emp.id} className={`flex items-center gap-3 p-4 rounded-xl border border-border bg-card ${!emp.active ? "opacity-50" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{emp.name}</span>
                  {emp.position && <Badge className="text-xs bg-muted text-muted-foreground">{emp.position}</Badge>}
                  {emp.department && <span className="text-xs text-muted-foreground">{emp.department}</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {emp.salary_type === "hourly" ? `${fmtCurrency(emp.hourly_rate)}/hora` : fmtCurrency(emp.hourly_rate) + "/mes"}
                  {emp.email ? ` · ${emp.email}` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => { setEditingEmp(emp); setEmpFormOpen(true); }}>
                  <Edit className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </TabsContent>

        {/* ── Payroll ── */}
        <TabsContent value="payroll" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{payrollPeriods.length} períodos</p>
            <Button size="sm" onClick={handleCreatePayrollPeriod} disabled={generatingPayroll}>
              {generatingPayroll ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <Banknote className="w-4 h-4 mr-1.5" />}
              Generar liquidación {viewMonth}
            </Button>
          </div>
          {payrollPeriods.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Banknote className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Sin liquidaciones generadas</p>
            </div>
          ) : payrollPeriods.map(pp => (
            <div key={pp.id} className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold capitalize">{pp.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(pp.period_start + "T00:00:00"), "dd/MM")} → {format(new Date(pp.period_end + "T00:00:00"), "dd/MM/yyyy")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{fmtCurrency(pp.total_gross)}</p>
                  <Badge className={`text-xs ${pp.status === "paid" ? "bg-emerald-500/15 text-emerald-400" : pp.status === "closed" ? "bg-blue-500/15 text-blue-400" : "bg-amber-500/15 text-amber-400"}`}>
                    {pp.status === "open" ? "Abierto" : pp.status === "closed" ? "Cerrado" : "Pagado"}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <EmpForm open={empFormOpen} employee={editingEmp} orgId={orgId}
        onClose={() => { setEmpFormOpen(false); setEditingEmp(null); }} onSaved={loadAll} />

      <TSForm open={tsFormOpen} ts={editingTs} employees={employees} orgId={orgId}
        onClose={() => { setTsFormOpen(false); setEditingTs(null); }} onSaved={loadAll} />
    </div>
  );
}
