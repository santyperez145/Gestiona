import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import KPICard from "@/components/shared/KPICard";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  Landmark, Plus, CheckCircle2, AlertTriangle, Upload,
  Loader2, Trash2, RefreshCw, TrendingUp, TrendingDown,
  ChevronDown, ChevronUp, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BankTx {
  id: string;
  org_id: string;
  date: string;
  description: string;
  amount_ars: number; // positive = credit, negative = debit
  type: "credit" | "debit";
  matched: boolean;
  match_ref?: string | null;
  account: string;
  notes?: string | null;
  created_at: string;
}

interface Sale {
  id: string;
  date: string;
  customer_name: string;
  total_ars: number;
  method: string;
}

interface Expense {
  id: string;
  date: string;
  description: string;
  amount: number;
}

interface DebtPayment {
  id: string;
  updated_at: string;
  customer_name: string;
  amount_ars: number;
  description: string;
}

interface SupplierPayment {
  id: string;
  paid_at: string;
  amount_ars: number;
  method: string;
  supplier_name: string;
}

const TX_EMPTY = {
  date: new Date().toISOString().slice(0, 10),
  description: "",
  amount_ars: "",
  type: "credit" as "credit" | "debit",
  account: "Cuenta Principal",
  notes: "",
};

// ─── CSV Parser (simple bank statement format) ────────────────────────────────

function parseBankCSV(text: string): Omit<BankTx, "id" | "org_id" | "matched" | "created_at">[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const rows: Omit<BankTx, "id" | "org_id" | "matched" | "created_at">[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 3) continue;
    const [date, description, amountStr] = cols;
    const amount = parseFloat(amountStr.replace(/[^0-9.-]/g, ""));
    if (isNaN(amount)) continue;
    rows.push({
      date: date || new Date().toISOString().slice(0, 10),
      description: description || "Sin descripción",
      amount_ars: Math.abs(amount),
      type: amount >= 0 ? "credit" : "debit",
      account: cols[3] || "Cuenta Principal",
      notes: null,
    });
  }
  return rows;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BankReconciliationPage() {
  usePageTitle("Banco / Conciliación");
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [txs, setTxs] = useState<BankTx[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(TX_EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [matchOpen, setMatchOpen] = useState<string | null>(null);
  const [filterMatched, setFilterMatched] = useState<"all" | "unmatched" | "matched">("all");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const [{ data: bankTxs }, { data: salesData }, { data: expData }, { data: debtData }, { data: suppPayData }] = await Promise.all([
        supabase.from("bank_transactions").select("*").eq("org_id", activeOrg.id).order("date", { ascending: false }),
        supabase.from("sales").select("id,date,customer_name,total_ars,method").eq("org_id", activeOrg.id).gte("date", dateFrom).lte("date", dateTo + "T23:59:59"),
        supabase.from("expenses").select("id,date,description,amount").eq("org_id", activeOrg.id).gte("date", dateFrom).lte("date", dateTo),
        supabase.from("debts").select("id,updated_at,customer_name,amount_ars,description").eq("org_id", activeOrg.id).eq("status", "paid").gte("updated_at", dateFrom).lte("updated_at", dateTo + "T23:59:59"),
        supabase.from("supplier_payments").select("id,paid_at,amount_ars,method,supplier_debt_id,supplier_debts(supplier_name)").eq("org_id", activeOrg.id).gte("paid_at", dateFrom).lte("paid_at", dateTo + "T23:59:59"),
      ]);
      setTxs((bankTxs || []) as BankTx[]);
      setSales((salesData || []) as Sale[]);
      setExpenses((expData || []) as Expense[]);
      setDebtPayments((debtData || []).map(d => ({
        id: d.id,
        updated_at: d.updated_at,
        customer_name: d.customer_name,
        amount_ars: d.amount_ars,
        description: d.description,
      })));
      setSupplierPayments((suppPayData || []).map(p => ({
        id: p.id,
        paid_at: p.paid_at,
        amount_ars: p.amount_ars,
        method: p.method,
        supplier_name: (p.supplier_debts as { supplier_name?: string } | null)?.supplier_name || "Proveedor",
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  // ── Filtered ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return txs
      .filter(t => t.date >= dateFrom && t.date <= dateTo)
      .filter(t =>
        filterMatched === "all" ? true :
        filterMatched === "matched" ? t.matched :
        !t.matched
      );
  }, [txs, dateFrom, dateTo, filterMatched]);

  const stats = useMemo(() => {
    const credits = filtered.filter(t => t.type === "credit").reduce((s, t) => s + t.amount_ars, 0);
    const debits = filtered.filter(t => t.type === "debit").reduce((s, t) => s + t.amount_ars, 0);
    const matched = filtered.filter(t => t.matched).length;
    const unmatched = filtered.filter(t => !t.matched).length;
    return { credits, debits, net: credits - debits, matched, unmatched };
  }, [filtered]);

  // ── Create tx ────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!activeOrg) return;
    if (!form.description || !form.amount_ars || !form.date) { toast.error("Completá todos los campos"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("bank_transactions").insert({
        org_id: activeOrg.id,
        date: form.date,
        description: form.description,
        amount_ars: Number(form.amount_ars),
        type: form.type,
        matched: false,
        account: form.account || "Cuenta Principal",
        notes: form.notes || null,
      });
      if (error) throw error;
      toast.success("Movimiento registrado");
      setOpen(false); setForm(TX_EMPTY); load();
    } catch { toast.error("Error al guardar"); }
    finally { setSaving(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este movimiento?")) return;
    setDeleting(id);
    try {
      await supabase.from("bank_transactions").delete().eq("id", id);
      setTxs(prev => prev.filter(t => t.id !== id));
    } finally { setDeleting(null); }
  };

  // ── Match ─────────────────────────────────────────────────────────────────────

  const handleMatch = async (txId: string, ref: string) => {
    await supabase.from("bank_transactions").update({ matched: true, match_ref: ref }).eq("id", txId);
    setTxs(prev => prev.map(t => t.id === txId ? { ...t, matched: true, match_ref: ref } : t));
    setMatchOpen(null);
    toast.success("Movimiento conciliado");
  };

  // ── Auto-match ────────────────────────────────────────────────────────────────

  const handleAutoMatch = async () => {
    let matched = 0;
    for (const tx of filtered.filter(t => !t.matched)) {
      if (tx.type === "credit") {
        // Try sales first
        const sale = sales.find(s => Math.abs(s.total_ars - tx.amount_ars) < 1 && s.date.slice(0, 10) === tx.date);
        if (sale) { await handleMatch(tx.id, `Venta ${sale.customer_name} ${sale.id.slice(0, 8)}`); matched++; continue; }
        // Try debt payments (cobros de deuda)
        const debt = debtPayments.find(d => Math.abs(d.amount_ars - tx.amount_ars) < 1 && d.updated_at?.slice(0, 10) === tx.date);
        if (debt) { await handleMatch(tx.id, `Cobro deuda: ${debt.customer_name}`); matched++; continue; }
      } else {
        // Try expenses
        const exp = expenses.find(e => Math.abs(e.amount - tx.amount_ars) < 1 && e.date === tx.date);
        if (exp) { await handleMatch(tx.id, `Gasto: ${exp.description}`); matched++; continue; }
        // Try supplier payments
        const sp = supplierPayments.find(p => Math.abs(p.amount_ars - tx.amount_ars) < 1 && p.paid_at.slice(0, 10) === tx.date);
        if (sp) { await handleMatch(tx.id, `Pago proveedor: ${sp.supplier_name}`); matched++; continue; }
      }
    }
    if (matched > 0) toast.success(`${matched} movimiento(s) conciliados automáticamente`);
    else toast.info("No se encontraron coincidencias automáticas");
  };

  // ── CSV import ────────────────────────────────────────────────────────────────

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeOrg) return;
    const text = await file.text();
    const rows = parseBankCSV(text);
    if (rows.length === 0) { toast.error("No se pudieron leer movimientos del CSV"); return; }
    try {
      const { error } = await supabase.from("bank_transactions").insert(
        rows.map(r => ({ ...r, org_id: activeOrg.id, matched: false }))
      );
      if (error) throw error;
      toast.success(`${rows.length} movimientos importados`);
      load();
    } catch { toast.error("Error al importar"); }
    e.target.value = "";
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const matchTx = txs.find(t => t.id === matchOpen);
  const matchCandidates: { id: string; label: string; sublabel: string; amount: number; ref: string }[] = matchTx
    ? [
        ...(matchTx.type === "credit" ? sales : [])
          .filter(s => Math.abs(s.total_ars - matchTx.amount_ars) <= matchTx.amount_ars * 0.15)
          .map(s => ({ id: s.id, label: `Venta — ${s.customer_name}`, sublabel: s.date?.slice(0, 10), amount: s.total_ars, ref: `Venta ${s.customer_name} ${s.id.slice(0, 8)}` })),
        ...(matchTx.type === "credit" ? debtPayments : [])
          .filter(d => Math.abs(d.amount_ars - matchTx.amount_ars) <= matchTx.amount_ars * 0.15)
          .map(d => ({ id: d.id, label: `Cobro deuda — ${d.customer_name}`, sublabel: d.updated_at?.slice(0, 10), amount: d.amount_ars, ref: `Cobro deuda: ${d.customer_name}` })),
        ...(matchTx.type === "debit" ? expenses : [])
          .filter(e => Math.abs(e.amount - matchTx.amount_ars) <= matchTx.amount_ars * 0.15)
          .map(e => ({ id: e.id, label: `Gasto — ${e.description}`, sublabel: e.date, amount: e.amount, ref: `Gasto: ${e.description}` })),
        ...(matchTx.type === "debit" ? supplierPayments : [])
          .filter(p => Math.abs(p.amount_ars - matchTx.amount_ars) <= matchTx.amount_ars * 0.15)
          .map(p => ({ id: p.id, label: `Pago proveedor — ${p.supplier_name}`, sublabel: p.paid_at.slice(0, 10), amount: p.amount_ars, ref: `Pago proveedor: ${p.supplier_name}` })),
      ]
    : [];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <PageHeader
        icon={Landmark}
        title="Conciliación Bancaria"
        description="Reconciliá movimientos bancarios con ventas y gastos del sistema"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleAutoMatch}>
              <RefreshCw className="w-4 h-4 mr-1" /> Auto-conciliar
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-1" /> Importar CSV
            </Button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Cargar movimiento
            </Button>
          </div>
        }
      />

      {/* Date range + filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 pb-12">
          <Label className="text-xs text-muted-foreground">Desde</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 w-36" />
        </div>
        <div className="space-y-1 pb-12">
          <Label className="text-xs text-muted-foreground">Hasta</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 w-36" />
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Filtrar"}
        </Button>
        <div className="flex gap-1 ml-auto">
          {(["all", "unmatched", "matched"] as const).map(f => (
            <Button key={f} size="sm" variant={filterMatched === f ? "default" : "outline"} onClick={() => setFilterMatched(f)} className="h-8 text-xs">
              {f === "all" ? "Todos" : f === "unmatched" ? "Sin conciliar" : "Conciliados"}
            </Button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Ingresos" value={formatARS(stats.credits)} icon={TrendingUp} color="success" sub="créditos del período" />
        <KPICard label="Egresos" value={formatARS(stats.debits)} icon={TrendingDown} color="destructive" sub="débitos del período" />
        <KPICard label="Balance neto" value={formatARS(stats.net)} icon={Landmark} color={stats.net >= 0 ? "success" : "destructive"} sub="créditos − débitos" />
        <KPICard label="Sin conciliar" value={stats.unmatched} icon={AlertTriangle} color={stats.unmatched > 0 ? "warning" : "success"} sub={`${stats.matched} conciliados`} />
      </div>

      {/* CSV format hint */}
      <p className="text-xs text-muted-foreground">
        Formato CSV para importar: <code>fecha,descripción,monto (positivo=ingreso / negativo=egreso),cuenta</code>
      </p>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Landmark className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay movimientos en el período seleccionado.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
        <div className="table-wrap">
          <table className="w-full text-sm table-compact-mobile">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Fecha</th>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Descripción</th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Monto</th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Estado</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => (
                <tr key={tx.id} className={`border-b border-border/50 hover:bg-muted/10 ${tx.matched ? "" : "bg-yellow-950/5"}`}>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{tx.date}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{tx.description}</div>
                    {tx.match_ref && <div className="text-xs text-muted-foreground">{tx.match_ref}</div>}
                    {tx.notes && <div className="text-xs text-muted-foreground italic">{tx.notes}</div>}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${tx.type === "credit" ? "text-emerald-400" : "text-red-400"}`}>
                    {tx.type === "credit" ? "+" : "-"}{formatARS(tx.amount_ars)}
                  </td>
                  <td className="px-3 py-2.5 text-center hidden md:table-cell">
                    {tx.matched
                      ? <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">Conciliado</Badge>
                      : <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Pendiente</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-1">
                      {!tx.matched && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMatchOpen(tx.id)}>
                          Conciliar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        disabled={deleting === tx.id}
                        onClick={() => handleDelete(tx.id)}>
                        {deleting === tx.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cargar movimiento bancario</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fecha</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as "credit" | "debit" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">Ingreso (+)</SelectItem>
                    <SelectItem value="debit">Egreso (−)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ej: Transferencia de cliente" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Monto (ARS)</Label>
                <Input type="number" min={0} value={form.amount_ars} onChange={e => setForm(f => ({ ...f, amount_ars: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Cuenta</Label>
                <Input value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))} placeholder="Cuenta Principal" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual match dialog */}
      <Dialog open={!!matchOpen} onOpenChange={v => !v && setMatchOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conciliar movimiento</DialogTitle>
          </DialogHeader>
          {matchTx && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-border p-3 text-sm">
                <div className="font-medium">{matchTx.description}</div>
                <div className={`font-bold ${matchTx.type === "credit" ? "text-emerald-400" : "text-red-400"}`}>
                  {matchTx.type === "credit" ? "+" : "-"}{formatARS(matchTx.amount_ars)}
                </div>
              </div>
              <div className="space-y-2 pb-12">
                <Label className="text-xs text-muted-foreground">Posibles coincidencias (±10%)</Label>
                {matchCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No se encontraron coincidencias (±15%).</p>
                ) : (
                  matchCandidates.slice(0, 6).map(c => (
                    <button
                      key={c.id}
                      className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted/30 text-sm flex justify-between items-center gap-2"
                      onClick={() => handleMatch(matchTx.id, c.ref)}
                    >
                      <div>
                        <div className="font-medium">{c.label}</div>
                        <div className="text-xs text-muted-foreground">{c.sublabel}</div>
                      </div>
                      <div className="font-mono font-semibold">{formatARS(c.amount)}</div>
                    </button>
                  ))
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleMatch(matchTx.id, "Conciliado manualmente")}
                >
                  Marcar como conciliado (manual)
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
