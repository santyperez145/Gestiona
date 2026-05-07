import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FileText, Plus, Check, Clock, AlertTriangle, DollarSign,
  Banknote, XCircle, CalendarDays, TrendingUp,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

type Cheque = {
  id: string;
  type: "received" | "issued";
  customer_name: string | null;
  bank_name: string | null;
  check_number: string | null;
  amount_ars: number;
  issue_date: string | null;
  due_date: string;
  status: "pending" | "deposited" | "cleared" | "bounced" | "cancelled";
  deposited_at: string | null;
  notes: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:    { label: "Pendiente",  color: "bg-warning/15 text-warning" },
  deposited:  { label: "Depositado", color: "bg-blue-500/15 text-blue-400" },
  cleared:    { label: "Acreditado", color: "bg-success/15 text-success" },
  bounced:    { label: "Rebotado",   color: "bg-destructive/15 text-destructive" },
  cancelled:  { label: "Cancelado",  color: "bg-muted/50 text-muted-foreground" },
};

const EMPTY_FORM = {
  type: "received" as "received" | "issued",
  customer_name: "",
  bank_name: "",
  check_number: "",
  amount_ars: "",
  issue_date: "",
  due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  notes: "",
};

export default function ChequesPage() {
  const { activeOrg } = useOrg();
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("cheques")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("due_date");
    setCheques((data || []) as Cheque[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const setField = (k: keyof typeof EMPTY_FORM, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount_ars || !form.due_date || !activeOrg) { toast.error("Completá monto y fecha de vencimiento"); return; }
    const amount = Number(form.amount_ars);
    if (amount <= 0) { toast.error("El monto debe ser mayor a 0"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("cheques").insert({
        org_id: activeOrg.id,
        type: form.type,
        customer_name: form.customer_name.trim() || null,
        bank_name: form.bank_name.trim() || null,
        check_number: form.check_number.trim() || null,
        amount_ars: amount,
        issue_date: form.issue_date || null,
        due_date: form.due_date,
        notes: form.notes.trim() || null,
        status: "pending",
      });
      if (error) throw error;
      toast.success("Cheque registrado");
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error al registrar cheque");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (cheque: Cheque, status: Cheque["status"]) => {
    const update: any = { status };
    if (status === "deposited" || status === "cleared") {
      update.deposited_at = new Date().toISOString().slice(0, 10);
    }
    await supabase.from("cheques").update(update).eq("id", cheque.id);
    await load();
    toast.success(`Cheque marcado como ${STATUS_CONFIG[status].label}`);
  };

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    return cheques.filter(c => {
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (filterType !== "all" && c.type !== filterType) return false;
      return true;
    });
  }, [cheques, filterStatus, filterType]);

  const pending = cheques.filter(c => c.status === "pending" && c.type === "received");
  const overdue = pending.filter(c => c.due_date < today);
  const upcoming30 = pending.filter(c => c.due_date >= today);
  const pendingTotal = pending.reduce((s, c) => s + Number(c.amount_ars), 0);
  const overdueTotal = overdue.reduce((s, c) => s + Number(c.amount_ars), 0);
  const upcoming30Total = upcoming30.reduce((s, c) => s + Number(c.amount_ars), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileText}
        title="Cheques Diferidos"
        description="Seguimiento de cheques recibidos y emitidos"
        badge={
          overdue.length > 0
            ? { label: `${overdue.length} vencido${overdue.length > 1 ? "s" : ""}`, variant: "destructive" }
            : undefined
        }
        actions={
          <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />Registrar cheque
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Pendiente total" value={formatARS(pendingTotal)} icon={DollarSign} color="primary"
          sub={`${pending.length} cheque${pending.length !== 1 ? "s" : ""}`} />
        <KPICard label="Vencidos" value={formatARS(overdueTotal)} icon={AlertTriangle}
          color={overdue.length > 0 ? "destructive" : "success"}
          sub={`${overdue.length} cheque${overdue.length !== 1 ? "s" : ""}`} />
        <KPICard label="Por vencer" value={formatARS(upcoming30Total)} icon={CalendarDays} color="success"
          sub={`${upcoming30.length} en los próximos días`} />
        <KPICard label="Total registrados" value={cheques.length} icon={TrendingUp} color="warning" sub="cheques históricos" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-8 w-40 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="received">Recibidos</SelectItem>
            <SelectItem value="issued">Emitidos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground self-center">{filtered.length} cheque{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando cheques…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-muted-foreground">Sin cheques para los filtros seleccionados</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Tipo</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Vencimiento</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">De / Para</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Banco / Nro.</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Monto</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Estado</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const isOverdue = c.status === "pending" && c.due_date < today;
                return (
                  <tr key={c.id} className={`border-b border-border/40 transition-colors ${isOverdue ? "bg-destructive/5" : "hover:bg-muted/20"}`}>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 font-semibold ${c.type === "received" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                        {c.type === "received" ? <><Banknote className="w-2.5 h-2.5" />Recibido</> : <><FileText className="w-2.5 h-2.5" />Emitido</>}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-xs whitespace-nowrap ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {new Date(c.due_date + "T12:00:00").toLocaleDateString("es-AR")}
                      {isOverdue && <span className="ml-1">⚠️</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-medium">{c.customer_name || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {c.bank_name || "—"}{c.check_number ? ` #${c.check_number}` : ""}
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-xs">{formatARS(Number(c.amount_ars))}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 font-semibold ${STATUS_CONFIG[c.status]?.color || "bg-muted text-muted-foreground"}`}>
                        {STATUS_CONFIG[c.status]?.label || c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {c.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => updateStatus(c, "deposited")}>
                            <Check className="w-3 h-3 mr-1" />Depositar
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => updateStatus(c, "bounced")}>
                            <XCircle className="w-3 h-3 mr-1" />Rebotó
                          </Button>
                        </div>
                      )}
                      {c.status === "deposited" && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => updateStatus(c, "cleared")}>
                          <Check className="w-3 h-3 mr-1" />Acreditado
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Registrar cheque</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
              <Select value={form.type} onValueChange={v => setField("type", v as "received" | "issued")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">Recibido (de cliente)</SelectItem>
                  <SelectItem value="issued">Emitido (a proveedor)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {form.type === "received" ? "Cliente" : "Proveedor"}
              </label>
              <Input value={form.customer_name} onChange={e => setField("customer_name", e.target.value)} placeholder="Nombre" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Banco</label>
                <Input value={form.bank_name} onChange={e => setField("bank_name", e.target.value)} placeholder="Banco Galicia" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nro. cheque</label>
                <Input value={form.check_number} onChange={e => setField("check_number", e.target.value)} placeholder="12345678" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Monto ARS *</label>
                <Input type="number" min="1" value={form.amount_ars} onChange={e => setField("amount_ars", e.target.value)} placeholder="100000" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fecha emisión</label>
                <Input type="date" value={form.issue_date} onChange={e => setField("issue_date", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fecha de vencimiento *</label>
              <Input type="date" value={form.due_date} onChange={e => setField("due_date", e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
              <Input value={form.notes} onChange={e => setField("notes", e.target.value)} placeholder="Opcional" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
                {saving ? "Registrando…" : "Registrar cheque"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
