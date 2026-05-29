import { useState, useEffect } from "react";
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
  Users2, Plus, Pencil, Trash2, FileText, CheckCircle2, DollarSign,
  ChevronDown, ChevronRight, Download, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface Employee {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  cuil: string | null;
  position: string;
  department: string | null;
  hire_date: string;
  base_salary: number;
  salary_type: string;
  status: string;
  bank_name: string | null;
  bank_cbu: string | null;
  notes: string | null;
}

interface PayrollPeriod {
  id: string;
  name: string;
  year: number;
  month: number;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  paid_at: string | null;
}

interface PayrollItem {
  id: string;
  period_id: string;
  employee_id: string;
  base_salary: number;
  overtime_hours: number;
  overtime_amount: number;
  bonus: number;
  commission: number;
  extra_income: number;
  gross_total: number;
  jubilacion: number;
  obra_social: number;
  sindical: number;
  advance: number;
  other_deductions: number;
  total_deductions: number;
  net_salary: number;
  worked_days: number;
  absent_days: number;
  notes: string | null;
}

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const SALARY_TYPES: Record<string, string> = { monthly: "Mensual", hourly: "Por hora", daily: "Por día", commission: "Comisión" };
const EMP_STATUS: Record<string, { label: string; color: string }> = {
  active:    { label: "Activo",    color: "bg-emerald-500/15 text-emerald-400" },
  inactive:  { label: "Inactivo",  color: "bg-muted/50 text-muted-foreground" },
  suspended: { label: "Suspendido",color: "bg-yellow-500/15 text-yellow-400" },
};
const PERIOD_STATUS: Record<string, { label: string; color: string }> = {
  open:   { label: "Abierto", color: "bg-blue-500/15 text-blue-400" },
  closed: { label: "Cerrado", color: "bg-yellow-500/15 text-yellow-400" },
  paid:   { label: "Pagado",  color: "bg-emerald-500/15 text-emerald-400" },
};

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
}

const EMPTY_EMP = {
  full_name: "", email: "", phone: "", dni: "", cuil: "", position: "vendedor",
  department: "", hire_date: new Date().toISOString().substring(0,10),
  base_salary: "", salary_type: "monthly", status: "active", bank_name: "", bank_cbu: "", notes: "",
};

export default function EmployeePayrollPage() {
  usePageTitle("Empleados & Liquidación");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("employees");

  const [empOpen, setEmpOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  const [empForm, setEmpForm] = useState(EMPTY_EMP);
  const [periodForm, setPeriodForm] = useState({
    year: new Date().getFullYear(), month: new Date().getMonth() + 1,
  });
  const [itemForm, setItemForm] = useState({
    employee_id: "", base_salary: "", overtime_hours: "0", overtime_amount: "0",
    bonus: "0", commission: "0", extra_income: "0",
    jubilacion: "", obra_social: "", sindical: "0", advance: "0", other_deductions: "0",
    worked_days: "30", absent_days: "0", notes: "",
  });

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [empRes, perRes, itemRes] = await Promise.all([
      supabase.from("employees").select("*").eq("org_id", orgId).order("full_name"),
      supabase.from("payroll_periods").select("*").eq("org_id", orgId).order("year", { ascending: false }).order("month", { ascending: false }),
      supabase.from("payroll_items").select("*").eq("org_id", orgId),
    ]);
    setEmployees((empRes.data || []) as Employee[]);
    setPeriods((perRes.data || []) as PayrollPeriod[]);
    setItems((itemRes.data || []) as PayrollItem[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function saveEmployee() {
    if (!empForm.full_name.trim() || !empForm.base_salary) { toast.error("Nombre y sueldo requeridos"); return; }
    const payload = {
      org_id: orgId, full_name: empForm.full_name.trim(), email: empForm.email || null,
      phone: empForm.phone || null, dni: empForm.dni || null, cuil: empForm.cuil || null,
      position: empForm.position, department: empForm.department || null,
      hire_date: empForm.hire_date, base_salary: Number(empForm.base_salary),
      salary_type: empForm.salary_type, status: empForm.status,
      bank_name: empForm.bank_name || null, bank_cbu: empForm.bank_cbu || null,
      notes: empForm.notes || null,
    };
    if (editingEmp) {
      const { error } = await supabase.from("employees").update(payload).eq("id", editingEmp.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Empleado actualizado");
    } else {
      const { error } = await supabase.from("employees").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Empleado creado");
    }
    setEmpOpen(false); setEditingEmp(null); setEmpForm(EMPTY_EMP);
    loadData();
  }

  async function deleteEmployee(id: string) {
    if (!confirm("¿Eliminar empleado?")) return;
    await supabase.from("employees").delete().eq("id", id);
    toast.success("Empleado eliminado");
    loadData();
  }

  async function createPeriod() {
    const yr = periodForm.year, mo = periodForm.month;
    const name = `${MONTHS[mo - 1]} ${yr}`;
    const firstDay = new Date(yr, mo - 1, 1);
    const lastDay = new Date(yr, mo, 0);
    const { error } = await supabase.from("payroll_periods").insert({
      org_id: orgId, name, year: yr, month: mo,
      start_date: firstDay.toISOString().substring(0,10),
      end_date: lastDay.toISOString().substring(0,10),
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Período ${name} creado`);
    setPeriodOpen(false);
    loadData();
  }

  async function closePeriod(id: string) {
    await supabase.from("payroll_periods").update({ status: "closed" }).eq("id", id);
    toast.success("Período cerrado");
    loadData();
  }

  async function markPeriodPaid(id: string) {
    await supabase.from("payroll_periods").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", id);
    toast.success("Período marcado como pagado");
    loadData();
  }

  async function saveItem() {
    if (!selectedPeriod || !itemForm.employee_id || !itemForm.base_salary) {
      toast.error("Empleado y sueldo base requeridos"); return;
    }
    const base = Number(itemForm.base_salary);
    const jub = itemForm.jubilacion ? Number(itemForm.jubilacion) : Math.round(base * 0.11 * 100) / 100;
    const os = itemForm.obra_social ? Number(itemForm.obra_social) : Math.round(base * 0.03 * 100) / 100;

    const { error } = await supabase.from("payroll_items").upsert({
      org_id: orgId, period_id: selectedPeriod.id, employee_id: itemForm.employee_id,
      base_salary: base, overtime_hours: Number(itemForm.overtime_hours),
      overtime_amount: Number(itemForm.overtime_amount), bonus: Number(itemForm.bonus),
      commission: Number(itemForm.commission), extra_income: Number(itemForm.extra_income),
      jubilacion: jub, obra_social: os, sindical: Number(itemForm.sindical),
      advance: Number(itemForm.advance), other_deductions: Number(itemForm.other_deductions),
      worked_days: Number(itemForm.worked_days), absent_days: Number(itemForm.absent_days),
      notes: itemForm.notes || null,
    }, { onConflict: "period_id,employee_id" });
    if (error) { toast.error(error.message); return; }
    toast.success("Recibo guardado");
    setItemOpen(false);
    setItemForm({ employee_id: "", base_salary: "", overtime_hours: "0", overtime_amount: "0", bonus: "0", commission: "0", extra_income: "0", jubilacion: "", obra_social: "", sindical: "0", advance: "0", other_deductions: "0", worked_days: "30", absent_days: "0", notes: "" });
    loadData();
  }

  function openAddItem(period: PayrollPeriod) {
    setSelectedPeriod(period);
    setItemForm(p => ({ ...p, employee_id: "" }));
    setItemOpen(true);
  }

  function openEditItem(period: PayrollPeriod, item: PayrollItem) {
    setSelectedPeriod(period);
    setItemForm({
      employee_id: item.employee_id, base_salary: String(item.base_salary),
      overtime_hours: String(item.overtime_hours), overtime_amount: String(item.overtime_amount),
      bonus: String(item.bonus), commission: String(item.commission), extra_income: String(item.extra_income),
      jubilacion: String(item.jubilacion), obra_social: String(item.obra_social),
      sindical: String(item.sindical), advance: String(item.advance), other_deductions: String(item.other_deductions),
      worked_days: String(item.worked_days), absent_days: String(item.absent_days), notes: item.notes || "",
    });
    setItemOpen(true);
  }

  const activeEmployees = employees.filter(e => e.status === "active").length;
  const totalMonthlyPayroll = employees.filter(e => e.status === "active" && e.salary_type === "monthly").reduce((s, e) => s + e.base_salary, 0);
  const latestPeriod = periods[0];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Users2}
        title="Empleados & Liquidación"
        description="Gestioná tu equipo, calculá haberes, descuentos y generá recibos de sueldo"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPeriodOpen(true)}>
              <FileText className="w-4 h-4 mr-1" /> Nuevo período
            </Button>
            <Button onClick={() => { setEditingEmp(null); setEmpForm(EMPTY_EMP); setEmpOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Empleado
            </Button>
          </div>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Empleados activos" value={activeEmployees} sub="en nómina" icon={Users2} color="primary" />
        <KPICard label="Masa salarial" value={fmt(totalMonthlyPayroll)} sub="sueldos mensuales" icon={DollarSign} color="success" />
        <KPICard label="Períodos" value={periods.length} sub="liquidaciones" icon={FileText} color="blue" />
        <KPICard label="Último período" value={latestPeriod ? fmt(latestPeriod.total_net) : "—"} sub={latestPeriod ? "neto liquidado" : "sin períodos"} icon={CheckCircle2} color={latestPeriod ? "success" : "warning"} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="employees">Empleados ({employees.length})</TabsTrigger>
            <TabsTrigger value="payroll">Liquidaciones ({periods.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="employees" className="pt-3">
            {employees.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sin empleados. Agregá tu equipo.</p>
              </div>
            ) : (
              <div className="space-y-2 pb-12">
                {employees.map(emp => {
                  const st = EMP_STATUS[emp.status];
                  return (
                    <div key={emp.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card p-3">
                      <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0 font-bold text-primary text-sm">
                        {emp.full_name.split(" ").map(n => n[0]).join("").substring(0,2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{emp.full_name}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{emp.position}{emp.department ? ` · ${emp.department}` : ""}</p>
                      </div>
                      <div className="text-right shrink-0 hidden sm:block">
                        <p className="font-semibold text-sm">{fmt(emp.base_salary)}</p>
                        <p className="text-xs text-muted-foreground">{SALARY_TYPES[emp.salary_type]}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => { setEditingEmp(emp); setEmpForm({ full_name: emp.full_name, email: emp.email || "", phone: emp.phone || "", dni: emp.dni || "", cuil: emp.cuil || "", position: emp.position, department: emp.department || "", hire_date: emp.hire_date, base_salary: String(emp.base_salary), salary_type: emp.salary_type, status: emp.status, bank_name: emp.bank_name || "", bank_cbu: emp.bank_cbu || "", notes: emp.notes || "" }); setEmpOpen(true); }}
                          className="text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteEmployee(emp.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="payroll" className="pt-3 space-y-3">
            {periods.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin períodos de liquidación. Creá uno.</p>
            ) : periods.map(period => {
              const periodItems = items.filter(i => i.period_id === period.id);
              const ps = PERIOD_STATUS[period.status];
              const isExpanded = expandedPeriod === period.id;
              return (
                <div key={period.id} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                  <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/20"
                    onClick={() => setExpandedPeriod(isExpanded ? null : period.id)}>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{period.name}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ps.color}`}>{ps.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{periodItems.length} empleados liquidados</p>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <p className="font-semibold">{fmt(period.total_net)}</p>
                      <p className="text-xs text-muted-foreground">Bruto: {fmt(period.total_gross)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                      {period.status === "open" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAddItem(period)}>
                            <Plus className="w-3 h-3 mr-1" /> Recibo
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => closePeriod(period.id)}>Cerrar</Button>
                        </>
                      )}
                      {period.status === "closed" && (
                        <Button size="sm" className="h-7 text-xs" onClick={() => markPeriodPaid(period.id)}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Pagado
                        </Button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/30">
                      {periodItems.length === 0 ? (
                        <p className="text-center py-4 text-muted-foreground text-xs">Sin recibos. Agregá uno.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-muted/10">
                            <tr className="text-xs text-muted-foreground">
                              <th className="text-left px-3 py-2">Empleado</th>
                              <th className="text-right px-3 py-2">Bruto</th>
                              <th className="text-right px-3 py-2 hidden sm:table-cell">Desc.</th>
                              <th className="text-right px-3 py-2">Neto</th>
                              <th className="px-3 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {periodItems.map(item => {
                              const emp = employees.find(e => e.id === item.employee_id);
                              return (
                                <tr key={item.id} className="border-t border-border/20 hover:bg-muted/10">
                                  <td className="px-3 py-2 font-medium">{emp?.full_name || "—"}</td>
                                  <td className="px-3 py-2 text-right font-mono">{fmt(item.gross_total)}</td>
                                  <td className="px-3 py-2 text-right font-mono hidden sm:table-cell text-destructive">-{fmt(item.total_deductions)}</td>
                                  <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-400">{fmt(item.net_salary)}</td>
                                  <td className="px-3 py-2 text-right">
                                    <button onClick={() => openEditItem(period, item)} className="text-muted-foreground hover:text-primary">
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      )}

      {/* Employee dialog */}
      <Dialog open={empOpen} onOpenChange={v => { setEmpOpen(v); if (!v) setEditingEmp(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingEmp ? "Editar empleado" : "Nuevo empleado"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre completo *</Label>
                <Input value={empForm.full_name} onChange={e => setEmpForm(p => ({ ...p, full_name: e.target.value }))} placeholder="Juan Pérez..." />
              </div>
              <div><Label>Cargo</Label>
                <Input value={empForm.position} onChange={e => setEmpForm(p => ({ ...p, position: e.target.value }))} placeholder="Vendedor, Encargado..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label>
                <Input type="email" value={empForm.email} onChange={e => setEmpForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div><Label>Teléfono</Label>
                <Input value={empForm.phone} onChange={e => setEmpForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>DNI</Label>
                <Input value={empForm.dni} onChange={e => setEmpForm(p => ({ ...p, dni: e.target.value }))} placeholder="20123456" />
              </div>
              <div><Label>CUIL</Label>
                <Input value={empForm.cuil} onChange={e => setEmpForm(p => ({ ...p, cuil: e.target.value }))} placeholder="20-20123456-3" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Sueldo base *</Label>
                <Input type="number" min="0" value={empForm.base_salary} onChange={e => setEmpForm(p => ({ ...p, base_salary: e.target.value }))} placeholder="$0" />
              </div>
              <div><Label>Tipo</Label>
                <Select value={empForm.salary_type} onValueChange={v => setEmpForm(p => ({ ...p, salary_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SALARY_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Estado</Label>
                <Select value={empForm.status} onValueChange={v => setEmpForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(EMP_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fecha de ingreso</Label>
                <Input type="date" value={empForm.hire_date} onChange={e => setEmpForm(p => ({ ...p, hire_date: e.target.value }))} />
              </div>
              <div><Label>Departamento</Label>
                <Input value={empForm.department} onChange={e => setEmpForm(p => ({ ...p, department: e.target.value }))} placeholder="Ventas, Admin..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Banco</Label>
                <Input value={empForm.bank_name} onChange={e => setEmpForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="Santander..." />
              </div>
              <div><Label>CBU</Label>
                <Input value={empForm.bank_cbu} onChange={e => setEmpForm(p => ({ ...p, bank_cbu: e.target.value }))} placeholder="0000000..." />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEmpOpen(false); setEditingEmp(null); }}>Cancelar</Button>
            <Button onClick={saveEmployee}>{editingEmp ? "Guardar" : "Crear empleado"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Period dialog */}
      <Dialog open={periodOpen} onOpenChange={setPeriodOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nuevo período de liquidación</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Año</Label>
                <Input type="number" min="2020" max="2030" value={periodForm.year} onChange={e => setPeriodForm(p => ({ ...p, year: Number(e.target.value) }))} />
              </div>
              <div><Label>Mes</Label>
                <Select value={String(periodForm.month)} onValueChange={v => setPeriodForm(p => ({ ...p, month: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeriodOpen(false)}>Cancelar</Button>
            <Button onClick={createPeriod}>Crear período</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payroll item dialog */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Recibo de sueldo — {selectedPeriod?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Empleado *</Label>
              <Select value={itemForm.employee_id} onValueChange={v => {
                const emp = employees.find(e => e.id === v);
                setItemForm(p => ({ ...p, employee_id: v, base_salary: emp ? String(emp.base_salary) : p.base_salary }));
              }}>
                <SelectTrigger><SelectValue placeholder="Seleccioná empleado..." /></SelectTrigger>
                <SelectContent>{employees.filter(e => e.status !== "inactive").map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-xs font-semibold text-emerald-400 mb-2">HABERES</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Sueldo base *</Label>
                  <Input type="number" min="0" value={itemForm.base_salary} onChange={e => setItemForm(p => ({ ...p, base_salary: e.target.value }))} />
                </div>
                <div><Label>Horas extra</Label>
                  <Input type="number" min="0" value={itemForm.overtime_hours} onChange={e => setItemForm(p => ({ ...p, overtime_hours: e.target.value }))} />
                </div>
                <div><Label>Monto horas extra</Label>
                  <Input type="number" min="0" value={itemForm.overtime_amount} onChange={e => setItemForm(p => ({ ...p, overtime_amount: e.target.value }))} />
                </div>
                <div><Label>Bonificación</Label>
                  <Input type="number" min="0" value={itemForm.bonus} onChange={e => setItemForm(p => ({ ...p, bonus: e.target.value }))} />
                </div>
                <div><Label>Comisiones</Label>
                  <Input type="number" min="0" value={itemForm.commission} onChange={e => setItemForm(p => ({ ...p, commission: e.target.value }))} />
                </div>
                <div><Label>Otros ingresos</Label>
                  <Input type="number" min="0" value={itemForm.extra_income} onChange={e => setItemForm(p => ({ ...p, extra_income: e.target.value }))} />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-destructive mb-2">DEDUCCIONES</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Jubilación (11%)</Label>
                  <Input type="number" min="0" value={itemForm.jubilacion} onChange={e => setItemForm(p => ({ ...p, jubilacion: e.target.value }))} placeholder="Auto" />
                </div>
                <div><Label>Obra social (3%)</Label>
                  <Input type="number" min="0" value={itemForm.obra_social} onChange={e => setItemForm(p => ({ ...p, obra_social: e.target.value }))} placeholder="Auto" />
                </div>
                <div><Label>Sindical</Label>
                  <Input type="number" min="0" value={itemForm.sindical} onChange={e => setItemForm(p => ({ ...p, sindical: e.target.value }))} />
                </div>
                <div><Label>Adelanto</Label>
                  <Input type="number" min="0" value={itemForm.advance} onChange={e => setItemForm(p => ({ ...p, advance: e.target.value }))} />
                </div>
                <div><Label>Otras deducciones</Label>
                  <Input type="number" min="0" value={itemForm.other_deductions} onChange={e => setItemForm(p => ({ ...p, other_deductions: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Días trabajados</Label>
                <Input type="number" min="0" max="31" value={itemForm.worked_days} onChange={e => setItemForm(p => ({ ...p, worked_days: e.target.value }))} />
              </div>
              <div><Label>Ausencias</Label>
                <Input type="number" min="0" max="31" value={itemForm.absent_days} onChange={e => setItemForm(p => ({ ...p, absent_days: e.target.value }))} />
              </div>
            </div>

            {/* Live preview */}
            {itemForm.base_salary && (
              <div className="rounded-lg bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bruto:</span>
                  <span className="font-semibold">{fmt([itemForm.base_salary, itemForm.overtime_amount, itemForm.bonus, itemForm.commission, itemForm.extra_income].reduce((s, v) => s + Number(v || 0), 0))}</span>
                </div>
                <div className="flex justify-between text-destructive">
                  <span>Descuentos:</span>
                  <span>-{fmt([itemForm.jubilacion || String(Math.round(Number(itemForm.base_salary) * 0.11)), itemForm.obra_social || String(Math.round(Number(itemForm.base_salary) * 0.03)), itemForm.sindical, itemForm.advance, itemForm.other_deductions].reduce((s, v) => s + Number(v || 0), 0))}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemOpen(false)}>Cancelar</Button>
            <Button onClick={saveItem}>Guardar recibo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
