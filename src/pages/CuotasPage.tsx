import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CreditCard, Plus, Check, CalendarDays, TrendingUp, AlertTriangle, DollarSign } from "lucide-react";

type Installment = {
  id: string;
  sale_id: string;
  installment_number: number;
  amount_ars: number;
  due_date: string;
  paid: boolean;
  paid_at: string | null;
  sale?: {
    product_name: string;
    customer_name: string | null;
    total_ars: number;
    installments: number;
  };
};

const EMPTY_FORM = {
  product_name: "",
  customer_name: "",
  total_ars: "",
  installments: "3",
  first_date: new Date().toISOString().slice(0, 10),
};

export default function CuotasPage() {
  const { activeOrg } = useOrg();
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("installment_schedule" as any)
      .select("*, sale:sale_id(product_name, customer_name, total_ars, installments)")
      .eq("org_id", activeOrg.id)
      .order("due_date");
    setInstallments((data || []) as Installment[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const setField = (k: keyof typeof EMPTY_FORM, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.product_name.trim() || !form.total_ars || !activeOrg) { toast.error("Completá los campos requeridos"); return; }
    const total = Number(form.total_ars);
    const n = Number(form.installments);
    if (total <= 0 || n < 2) { toast.error("El monto y el número de cuotas deben ser válidos"); return; }
    setSaving(true);
    try {
      // Create a pseudo-sale record just to link installments
      const { data: saleData, error: saleErr } = await supabase.from("sales" as any).insert({
        org_id: activeOrg.id,
        product_name: form.product_name.trim(),
        customer_name: form.customer_name.trim() || null,
        total_ars: total,
        quantity: 1,
        unit_price_ars: total,
        profit_ars: 0,
        profit_usd: 0,
        paid: false,
        payment_method: "credito",
        installments: n,
        installment_amount_ars: total / n,
        first_installment_date: form.first_date,
        date: new Date().toISOString(),
        user_id: (await supabase.auth.getUser()).data.user?.id,
      }).select("id").single();

      if (saleErr || !saleData) throw saleErr || new Error("Error al crear venta");

      const saleId = (saleData as any).id;
      const amountPerCuota = Math.round((total / n) * 100) / 100;

      const schedule = Array.from({ length: n }, (_, i) => {
        const d = new Date(form.first_date);
        d.setMonth(d.getMonth() + i);
        return {
          org_id: activeOrg.id,
          sale_id: saleId,
          installment_number: i + 1,
          amount_ars: amountPerCuota,
          due_date: d.toISOString().slice(0, 10),
          paid: false,
        };
      });

      const { error } = await supabase.from("installment_schedule" as any).insert(schedule);
      if (error) throw error;

      toast.success(`Venta en ${n} cuotas de ${formatARS(amountPerCuota)} registrada`);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error al registrar cuotas");
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (inst: Installment) => {
    await supabase.from("installment_schedule" as any).update({ paid: true, paid_at: new Date().toISOString() }).eq("id", inst.id);
    await load();
    toast.success(`Cuota ${inst.installment_number} marcada como cobrada`);
  };

  const filtered = useMemo(() => {
    if (!filterMonth) return installments;
    return installments.filter(i => i.due_date.startsWith(filterMonth));
  }, [installments, filterMonth]);

  const today = new Date().toISOString().slice(0, 10);
  const pending = installments.filter(i => !i.paid);
  const overdue = pending.filter(i => i.due_date < today);
  const upcoming = pending.filter(i => i.due_date >= today);
  const pendingTotal = pending.reduce((s, i) => s + Number(i.amount_ars), 0);
  const overdueTotal = overdue.reduce((s, i) => s + Number(i.amount_ars), 0);
  const monthTotal = filtered.reduce((s, i) => s + Number(i.amount_ars), 0);
  const monthCollected = filtered.filter(i => i.paid).reduce((s, i) => s + Number(i.amount_ars), 0);

  // Generate month options
  const months: string[] = [];
  const now = new Date();
  for (let i = -2; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(d.toISOString().slice(0, 7));
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-primary" />Cuotas
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Seguimiento de ventas en cuotas y cobros esperados</p>
        </div>
        <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4 mr-2" />Registrar venta en cuotas
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5"><DollarSign className="w-4 h-4 text-primary" /><span className="text-[10px] text-muted-foreground uppercase">Pendiente total</span></div>
          <p className="text-xl font-bold">{formatARS(pendingTotal)}</p>
          <p className="text-xs text-muted-foreground">{pending.length} cuotas</p>
        </div>
        <div className="bg-card border border-destructive/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5"><AlertTriangle className="w-4 h-4 text-destructive" /><span className="text-[10px] text-muted-foreground uppercase">Vencidas</span></div>
          <p className="text-xl font-bold text-destructive">{formatARS(overdueTotal)}</p>
          <p className="text-xs text-muted-foreground">{overdue.length} cuotas</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5"><TrendingUp className="w-4 h-4 text-success" /><span className="text-[10px] text-muted-foreground uppercase">Mes seleccionado</span></div>
          <p className="text-xl font-bold">{formatARS(monthTotal)}</p>
          <p className="text-xs text-muted-foreground">{formatARS(monthCollected)} cobrado</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5"><CalendarDays className="w-4 h-4 text-warning" /><span className="text-[10px] text-muted-foreground uppercase">Próximas</span></div>
          <p className="text-xl font-bold">{upcoming.length}</p>
          <p className="text-xs text-muted-foreground">cuotas por cobrar</p>
        </div>
      </div>

      {/* Month filter */}
      <div className="flex items-center gap-2 mb-5">
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <Select value={filterMonth} onValueChange={setFilterMonth}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map(m => (
              <SelectItem key={m} value={m}>
                {new Date(m + "-01").toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} cuotas</span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando cuotas…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <CreditCard className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-muted-foreground">Sin cuotas para este período</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Vencimiento</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Producto</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Cliente</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Cuota</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Monto</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Estado</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inst) => {
                const isOverdue = !inst.paid && inst.due_date < today;
                return (
                  <tr key={inst.id} className={`border-b border-border/40 transition-colors ${isOverdue ? "bg-destructive/5" : "hover:bg-muted/20"}`}>
                    <td className={`px-3 py-2.5 whitespace-nowrap text-xs ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {new Date(inst.due_date + "T12:00:00").toLocaleDateString("es-AR")}
                      {isOverdue && <span className="ml-1">⚠️</span>}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-xs max-w-[140px] truncate">{inst.sale?.product_name || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{inst.sale?.customer_name || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{inst.installment_number}/{inst.sale?.installments || "?"}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-xs">{formatARS(Number(inst.amount_ars))}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 font-semibold ${inst.paid ? "bg-success/15 text-success" : isOverdue ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}>
                        {inst.paid ? <><Check className="w-2.5 h-2.5" />Cobrada</> : isOverdue ? "Vencida" : "Pendiente"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {!inst.paid && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => markPaid(inst)}>
                          <Check className="w-3 h-3 mr-1" />Cobrar
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

      {/* Create installment sale dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Registrar venta en cuotas</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Producto / descripción *</label>
              <Input value={form.product_name} onChange={e => setField("product_name", e.target.value)} placeholder="Ej: Lattafa Asad 100ml" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Cliente</label>
              <Input value={form.customer_name} onChange={e => setField("customer_name", e.target.value)} placeholder="Nombre del cliente" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Total ARS *</label>
                <Input type="number" min="1" value={form.total_ars} onChange={e => setField("total_ars", e.target.value)} placeholder="50000" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cuotas</label>
                <Select value={form.installments} onValueChange={v => setField("installments", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2, 3, 4, 6, 9, 12, 18, 24].map(n => <SelectItem key={n} value={String(n)}>{n} cuotas</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Primera cuota</label>
              <Input type="date" value={form.first_date} onChange={e => setField("first_date", e.target.value)} />
            </div>
            {form.total_ars && Number(form.total_ars) > 0 && (
              <div className="bg-muted/30 rounded-lg p-3 text-sm">
                <span className="text-muted-foreground">Cuota mensual: </span>
                <span className="font-bold text-primary">{formatARS(Number(form.total_ars) / Number(form.installments))}</span>
                <span className="text-muted-foreground"> × {form.installments} meses</span>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
                {saving ? "Registrando…" : "Registrar cuotas"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
