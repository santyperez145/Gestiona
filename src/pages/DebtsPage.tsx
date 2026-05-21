import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { getDebtsDB, addDebtPaymentDB, deleteDebtDB, formatARS, formatDateAR } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, DollarSign, AlertCircle, Clock, CheckCircle2, TrendingDown, TrendingUp, Users, Search, MessageCircle, FileSpreadsheet, Square, CheckSquare, Calendar, BarChart2, CalendarDays, ListChecks } from "lucide-react";
import { updateDebtDB } from "@/lib/supabaseStore";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

const DEFAULT_DEBT_TEMPLATE = "Hola {{nombre}}! 👋 Te recordamos que tenés una deuda pendiente de {{monto}}. Cuando puedas, coordenemos el pago. ¡Muchas gracias!";

function getWaDebtTemplate(orgId?: string): string {
  try {
    const key = `gestiona.wa_templates.${orgId || 'default'}`;
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    return saved.debt || DEFAULT_DEBT_TEMPLATE;
  } catch { return DEFAULT_DEBT_TEMPLATE; }
}

function buildDebtMsg(d: any, template: string): string {
  const name = d.customer_name ? d.customer_name.split(" ")[0] : "cliente";
  const amount = formatARS(Number(d.remaining_ars));
  return template.replace(/\{\{nombre\}\}/g, name).replace(/\{\{monto\}\}/g, amount);
}

function waDebtLink(d: any, orgId?: string) {
  const msg = buildDebtMsg(d, getWaDebtTemplate(orgId));
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export default function DebtsPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [debts, setDebts] = useState<any[]>([]);
  const [payingDebt, setPayingDebt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pending" | "paid" | "cobros" | "aging" | "payments">("pending");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  // Payment plan
  const [planningDebt, setPlanningDebt] = useState<any>(null);
  const [planInstallments, setPlanInstallments] = useState("3");
  const [planStart, setPlanStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [planFreq, setPlanFreq] = useState<"weekly" | "biweekly" | "monthly">("monthly");
  const plansKey = `gestiona.debt_plans.${activeOrg?.id || 'default'}`;
  const [savedPlans, setSavedPlans] = useState<Record<string, { installments: { date: string; amount: number; paid: boolean }[] }>>(() => {
    try { return JSON.parse(localStorage.getItem(`gestiona.debt_plans.${localStorage.getItem('gestiona.activeOrgId') || 'default'}`) || '{}'); }
    catch { return {}; }
  });

  const reload = async () => {
    if (user) { setDebts(await getDebtsDB(user.id)); setLoading(false); }
  };
  useEffect(() => { reload(); }, [user]);

  const filtered = useMemo(() => {
    return debts.filter(d => {
      if (search && !d.customer_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (!dateFrom) return true;
      const dt = new Date(d.date);
      if (dt < dateFrom) return false;
      if (dateTo) { const end = new Date(dateTo); end.setHours(23, 59, 59, 999); if (dt > end) return false; }
      return true;
    });
  }, [debts, search, dateFrom, dateTo]);

  const pending = filtered.filter(d => d.status !== "paid");
  const paid = filtered.filter(d => d.status === "paid");
  const totalPending = pending.reduce((s, d) => s + Number(d.remaining_ars), 0);
  const totalPaid = paid.reduce((s, d) => s + Number(d.amount_ars), 0);
  const partialCount = pending.filter(d => d.status === "partial").length;
  const uniqueDebtors = new Set(pending.map(d => d.customer_name)).size;

  const handleDelete = async (d: any) => {
    await deleteDebtDB(d.id);
    if (user) await logAudit(user.id, "delete", "debt", d.id, { customer: d.customer_name, amount: d.amount_ars });
    reload();
    toast.success("Deuda eliminada");
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    if (ids.every(id => selectedIds.has(id))) {
      setSelectedIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    }
  };

  const bulkMarkPaid = async () => {
    const toMark = pending.filter(d => selectedIds.has(d.id));
    if (!toMark.length) return;
    setBulkLoading(true);
    try {
      await Promise.all(toMark.map(d => updateDebtDB(d.id, { status: "paid", paid_ars: Number(d.amount_ars), remaining_ars: 0 })));
      toast.success(`${toMark.length} deuda${toMark.length !== 1 ? "s" : ""} marcada${toMark.length !== 1 ? "s" : ""} como pagada${toMark.length !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      reload();
    } catch {
      toast.error("Error al marcar deudas");
    } finally {
      setBulkLoading(false);
    }
  };

  if (loading) return <TableSkeleton rows={5} cols={7} />;

  const shown = tab === "paid" ? paid : pending;

  return (
    <div>
      <PageHeader
        icon={AlertCircle}
        title="Deudas"
        description="Control de cuentas corrientes de clientes"
        badge={pending.length > 0 ? { label: `${pending.length} pendientes`, variant: "destructive" } : { label: "Al día ✓", variant: "success" }}
        actions={
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard label="Total pendiente" value={formatARS(totalPending)} icon={TrendingDown} color="destructive"
          sub={`${pending.length} deuda${pending.length !== 1 ? "s" : ""}`} />
        <KPICard label="Deudores" value={uniqueDebtors} icon={Users} color="warning"
          sub={`${partialCount} pago${partialCount !== 1 ? "s" : ""} parcial${partialCount !== 1 ? "es" : ""}`} />
        <KPICard label="Cobrado" value={formatARS(totalPaid)} icon={CheckCircle2} color="success"
          sub={`${paid.length} deuda${paid.length !== 1 ? "s" : ""} saldadas`} />
        <KPICard label="Prom. por deudor" value={uniqueDebtors > 0 ? formatARS(totalPending / uniqueDebtors) : "$0"} icon={DollarSign} color="primary"
          sub="deuda promedio" />
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 border border-border w-fit mb-5">
        {([
          { id: 'pending' as const, label: 'Pendientes', icon: AlertCircle, count: pending.length },
          { id: 'cobros' as const, label: 'Próximos cobros', icon: Calendar, count: (() => { const today = new Date(); today.setHours(0,0,0,0); const nw = new Date(today); nw.setDate(nw.getDate()+7); return pending.filter(d => { if (!d.due_date) return false; const dd = new Date(d.due_date+"T12:00:00"); return dd >= today && dd <= nw; }).length; })() },
          { id: 'aging' as const, label: 'Aging', icon: BarChart2, count: 0 },
          { id: 'payments' as const, label: 'Historial', icon: DollarSign, count: paid.length },
          { id: 'paid' as const, label: 'Cobradas', icon: CheckCircle2, count: paid.length },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-card border border-border shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t.label}</span>
            {t.count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${tab === t.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Próximos cobros esta semana */}
      {tab === "cobros" && pending.length > 0 && (() => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);
        const upcoming = pending.filter(d => {
          if (!d.due_date) return false;
          const dd = new Date(d.due_date + "T12:00:00");
          return dd >= today && dd <= nextWeek;
        }).sort((a, b) => a.due_date.localeCompare(b.due_date));
        if (!upcoming.length) return null;
        const upTotal = upcoming.reduce((s, d) => s + Number(d.remaining_ars), 0);
        return (
          <div className="mb-5 bg-card border border-primary/20 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />Cobros próximos 7 días · {formatARS(upTotal)}
              </h3>
              <span className="text-[10px] text-muted-foreground">{upcoming.length} vencimiento{upcoming.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-1.5">
              {upcoming.map(d => {
                const dueDate = new Date(d.due_date + "T12:00:00");
                const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      <span className="text-xs font-medium truncate">{d.customer_name || "Sin nombre"}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">{daysUntil === 0 ? "Hoy" : daysUntil === 1 ? "Mañana" : `En ${daysUntil}d`}</span>
                      <span className="text-xs font-bold text-primary">{formatARS(Number(d.remaining_ars))}</span>
                      <a href={waDebtLink(d, activeOrg?.id)} target="_blank" rel="noopener noreferrer"
                        className="p-1 rounded bg-success/10 hover:bg-success/20 text-success transition-colors" title="Recordatorio WhatsApp">
                        <MessageCircle className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 30-day projection */}
      {tab === "cobros" && (() => {
        const today = new Date(); today.setHours(0,0,0,0);
        const next30 = new Date(today); next30.setDate(next30.getDate() + 30);
        const buckets = [
          { label: "Hoy", days: 0, max: 0 },
          { label: "1–7 días", days: 1, max: 7 },
          { label: "8–15 días", days: 8, max: 15 },
          { label: "16–30 días", days: 16, max: 30 },
        ];
        const rows = buckets.map(b => {
          const items = pending.filter(d => {
            if (!d.due_date) return false;
            const dd = new Date(d.due_date + "T12:00:00");
            const diffDays = Math.floor((dd.getTime() - today.getTime()) / 86400000);
            return diffDays >= b.days && diffDays <= b.max;
          });
          return { ...b, count: items.length, total: items.reduce((s, d) => s + Number(d.remaining_ars), 0) };
        }).filter(r => r.count > 0);
        if (rows.length === 0) return null;
        const grandTotal = rows.reduce((s, r) => s + r.total, 0);
        const maxVal = Math.max(...rows.map(r => r.total), 1);
        return (
          <div className="mb-5 bg-card border border-success/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-success" />
              <h3 className="text-sm font-semibold">Proyección de cobros — próximos 30 días</h3>
              <span className="ml-auto text-sm font-bold text-success">{formatARS(grandTotal)}</span>
            </div>
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.label} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-muted-foreground">{r.label}</span>
                  <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                    <div className="h-full rounded-full bg-success/60" style={{ width: `${(r.total / maxVal) * 100}%` }} />
                  </div>
                  <span className="w-24 text-right font-mono shrink-0">{formatARS(r.total)}</span>
                  <span className="w-12 text-right text-muted-foreground shrink-0">{r.count} deuda{r.count !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Cobros vacío */}
      {tab === "cobros" && (() => {
        const today = new Date(); today.setHours(0,0,0,0);
        const nw = new Date(today); nw.setDate(nw.getDate()+7);
        const cnt = pending.filter(d => { if (!d.due_date) return false; const dd = new Date(d.due_date+"T12:00:00"); return dd >= today && dd <= nw; }).length;
        if (cnt > 0) return null;
        return <EmptyState icon={Calendar} title="Sin cobros próximos" description="No hay deudas con vencimiento en los próximos 7 días." />;
      })()}

      {/* Aging de deudas a cobrar */}
      {tab === "aging" && pending.length > 0 && (() => {
        const now = Date.now();
        const agingBuckets = [
          { label: "Corriente (0–30d)", max: 30, color: "bg-blue-500/70", textColor: "text-blue-400" },
          { label: "31–60 días", min: 31, max: 60, color: "bg-yellow-500/70", textColor: "text-yellow-400" },
          { label: "61–90 días", min: 61, max: 90, color: "bg-orange-500/70", textColor: "text-orange-400" },
          { label: ">90 días", min: 91, color: "bg-red-500/70", textColor: "text-red-400" },
        ] as { label: string; min?: number; max?: number; color: string; textColor: string }[];
        const bucketed = agingBuckets.map(b => {
          const items = pending.filter(d => {
            const age = Math.floor((now - new Date(d.date).getTime()) / 86400000);
            return age >= (b.min ?? 0) && age <= (b.max ?? Infinity);
          });
          return { ...b, count: items.length, total: items.reduce((s, d) => s + Number(d.remaining_ars), 0) };
        }).filter(b => b.count > 0);
        if (bucketed.length === 0) return null;
        const grandTotal = bucketed.reduce((s, b) => s + b.total, 0);
        return (
          <div className="mb-5 bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Aging de cuentas a cobrar</h3>
              {(() => {
                const over30 = pending.filter(d => {
                  const age = Math.floor((now - new Date(d.date).getTime()) / 86400000);
                  return age >= 31 && d.phone;
                });
                if (over30.length === 0) return null;
                const template = getWaDebtTemplate(activeOrg?.id);
                return (
                  <button
                    className="flex items-center gap-1.5 text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-lg px-2.5 py-1.5 transition-colors"
                    onClick={() => {
                      const msgs = over30.map(d => buildDebtMsg(d, template));
                      navigator.clipboard.writeText(msgs.join("\n\n---\n\n"));
                      toast.success(`${over30.length} mensajes copiados al portapapeles`);
                      // Open WhatsApp for first debtor
                      if (over30[0]?.phone) {
                        window.open(`https://wa.me/${over30[0].phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(buildDebtMsg(over30[0], template))}`, "_blank");
                      }
                    }}
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Recordar &gt;30d ({over30.length})
                  </button>
                );
              })()}
            </div>
            <div className="space-y-2">
              {bucketed.map(b => {
                const pct = grandTotal > 0 ? (b.total / grandTotal) * 100 : 0;
                return (
                  <div key={b.label}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={`font-medium ${b.textColor}`}>{b.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">{b.count} deuda{b.count !== 1 ? "s" : ""}</span>
                        <span className="font-semibold font-mono">{formatARS(b.total)}</span>
                        <span className="text-muted-foreground w-10 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${b.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Historial de pagos */}
      {tab === "payments" && (() => {
        const paidSorted = [...paid].sort((a, b) => {
          const da = a.updated_at || a.date;
          const db = b.updated_at || b.date;
          return new Date(db).getTime() - new Date(da).getTime();
        });
        // Group by month
        const byMonth: Record<string, typeof paidSorted> = {};
        paidSorted.forEach(d => {
          const key = (d.updated_at || d.date || '').slice(0, 7);
          if (!byMonth[key]) byMonth[key] = [];
          byMonth[key].push(d);
        });
        const monthTotal = (items: typeof paidSorted) => items.reduce((s, d) => s + Number(d.amount_ars), 0);
        const grandTotal = paidSorted.reduce((s, d) => s + Number(d.amount_ars), 0);
        if (paidSorted.length === 0) {
          return <p className="text-sm text-muted-foreground text-center py-12">No hay cobros registrados aún.</p>;
        }
        return (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{paidSorted.length} cobros · total: <span className="font-semibold text-success">{formatARS(grandTotal)}</span></p>
            </div>
            {Object.entries(byMonth).map(([month, items]) => {
              const [y, m] = month.split('-');
              const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
              return (
                <div key={month} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">{label}</span>
                    <span className="text-xs font-semibold text-success">{formatARS(monthTotal(items))}</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {items.map(d => (
                      <div key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/20 transition-colors">
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{d.customer_name}</p>
                          {d.description && <p className="text-xs text-muted-foreground truncate">{d.description}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-semibold text-success">{formatARS(Number(d.amount_ars))}</p>
                          <p className="text-[10px] text-muted-foreground">{formatDateAR(d.updated_at || d.date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Search + CSV — only for table tabs */}
      {(tab === "pending" || tab === "paid") && (
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>
        <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => {
          const bom = '﻿';
          const headers = ['Fecha', 'Cliente', 'Descripción', 'Total ARS', 'Pagado ARS', 'Resta ARS', 'Estado'];
          const rows = shown.map(d => [
            formatDateAR(d.date),
            d.customer_name || '',
            d.description || '',
            Number(d.amount_ars).toFixed(2),
            Number(d.paid_ars).toFixed(2),
            Number(d.remaining_ars).toFixed(2),
            d.status === 'paid' ? 'Pagada' : d.status === 'partial' ? 'Parcial' : 'Pendiente',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
          const csv = bom + [headers.join(','), ...rows].join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
          a.download = `deudas-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          toast.success('Deudas exportadas');
        }}>
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />CSV
        </Button>
      </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && tab === "pending" && (
        <div className="flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl px-4 py-2.5 mb-4">
          <span className="text-sm font-medium text-primary">{selectedIds.size} seleccionada{selectedIds.size !== 1 ? "s" : ""}</span>
          <Button size="sm" className="h-7 text-xs bg-success text-success-foreground ml-auto" disabled={bulkLoading} onClick={bulkMarkPaid}>
            {bulkLoading ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" /></> : <CheckCircle2 className="w-3 h-3 mr-1" />}
            Marcar como pagadas
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={() => {
            const selected = pending.filter(d => selectedIds.has(d.id));
            const template = getWaDebtTemplate(activeOrg?.id);
            const msg = selected.map(d => buildDebtMsg(d, template)).join('\n\n---\n\n');
            navigator.clipboard?.writeText(msg).then(() => toast.success(`${selected.length} mensajes copiados al portapapeles`)).catch(() => {
              const firstDebt = selected[0];
              if (firstDebt) window.open(waDebtLink(firstDebt, activeOrg?.id), '_blank');
            });
          }}>
            <MessageCircle className="w-3 h-3 mr-1" />WhatsApp masivo
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>Limpiar</Button>
        </div>
      )}

      {/* Payment Dialog */}
      <Dialog open={!!payingDebt} onOpenChange={v => { if (!v) setPayingDebt(null); }}>
        <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Registrar Pago</DialogTitle></DialogHeader>
          {payingDebt && <PaymentForm debt={payingDebt} userId={user!.id} onSave={() => { setPayingDebt(null); reload(); }} />}
        </DialogContent>
      </Dialog>

      {/* Payment Plan Dialog */}
      <Dialog open={!!planningDebt} onOpenChange={v => { if (!v) setPlanningDebt(null); }}>
        <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><ListChecks className="w-5 h-5 text-primary" />Plan de pago en cuotas</DialogTitle></DialogHeader>
          {planningDebt && (() => {
            const remaining = Number(planningDebt.remaining_ars);
            const n = Math.max(1, Math.min(36, Number(planInstallments) || 3));
            const amtPerInstall = remaining / n;
            // Generate installment dates
            const dates: string[] = [];
            for (let i = 0; i < n; i++) {
              const d = new Date(planStart);
              if (planFreq === 'weekly') d.setDate(d.getDate() + i * 7);
              else if (planFreq === 'biweekly') d.setDate(d.getDate() + i * 14);
              else d.setMonth(d.getMonth() + i);
              dates.push(d.toISOString().slice(0, 10));
            }
            const existingPlan = savedPlans[planningDebt.id];
            const savePlan = () => {
              const plan = {
                installments: dates.map((date, idx) => ({
                  date,
                  amount: Math.round(amtPerInstall),
                  paid: existingPlan?.installments[idx]?.paid || false,
                })),
              };
              const next = { ...savedPlans, [planningDebt.id]: plan };
              setSavedPlans(next);
              localStorage.setItem(plansKey, JSON.stringify(next));
              toast.success(`Plan de ${n} cuotas guardado`);
              setPlanningDebt(null);
            };
            const toggleInstallmentPaid = (idx: number) => {
              if (!existingPlan) return;
              const updated = { ...existingPlan, installments: existingPlan.installments.map((inst: any, i: number) => i === idx ? { ...inst, paid: !inst.paid } : inst) };
              const next = { ...savedPlans, [planningDebt.id]: updated };
              setSavedPlans(next);
              localStorage.setItem(plansKey, JSON.stringify(next));
            };
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted rounded-xl">
                  <div>
                    <p className="font-semibold text-sm">{planningDebt.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{planningDebt.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-destructive">{formatARS(remaining)}</p>
                    <p className="text-[10px] text-muted-foreground">a distribuir</p>
                  </div>
                </div>

                {/* Config */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Cuotas</label>
                    <Input type="number" min={1} max={36} value={planInstallments} onChange={e => setPlanInstallments(e.target.value)} className="bg-muted border-border text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Frecuencia</label>
                    <Select value={planFreq} onValueChange={(v: "weekly" | "biweekly" | "monthly") => setPlanFreq(v)}>
                      <SelectTrigger className="bg-muted border-border text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="biweekly">Quincenal</SelectItem>
                        <SelectItem value="monthly">Mensual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Primera cuota</label>
                    <input type="date" value={planStart} onChange={e => setPlanStart(e.target.value)} className="w-full h-9 px-3 rounded-md border border-border bg-muted text-sm text-foreground" />
                  </div>
                </div>

                {/* Preview schedule */}
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-semibold">Cronograma de cuotas</span>
                    <span className="text-xs text-primary font-bold">{formatARS(Math.round(amtPerInstall))} / cuota</span>
                  </div>
                  <div className="divide-y divide-border max-h-52 overflow-y-auto">
                    {dates.map((date, idx) => {
                      const isPaid = existingPlan?.installments[idx]?.paid || false;
                      const isOverdue = !isPaid && date < new Date().toISOString().slice(0, 10);
                      return (
                        <div key={idx} className="flex items-center justify-between px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleInstallmentPaid(idx)}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${isPaid ? 'border-success bg-success/20 text-success' : 'border-border hover:border-primary/50'}`}
                              title={isPaid ? "Marcar sin pagar" : "Marcar pagado"}
                            >
                              {isPaid && <CheckCircle2 className="w-3 h-3" />}
                            </button>
                            <span className={`text-xs ${isPaid ? 'line-through text-muted-foreground' : isOverdue ? 'text-destructive font-medium' : ''}`}>
                              Cuota {idx + 1} — {new Date(date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                              {isOverdue && <span className="ml-1 text-[10px]">⚠ vencida</span>}
                            </span>
                          </div>
                          <span className={`text-xs font-semibold ${isPaid ? 'text-success' : ''}`}>{formatARS(Math.round(amtPerInstall))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1 gradient-gold text-primary-foreground font-semibold" onClick={savePlan}>
                    <CalendarDays className="w-4 h-4 mr-2" />Guardar plan
                  </Button>
                  {existingPlan && (
                    <Button variant="outline" className="text-destructive border-destructive/30" onClick={() => {
                      const next = { ...savedPlans }; delete next[planningDebt.id];
                      setSavedPlans(next); localStorage.setItem(plansKey, JSON.stringify(next));
                      toast.success("Plan eliminado"); setPlanningDebt(null);
                    }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Empty state — only for table tabs */}
      {(tab === "pending" || tab === "paid") && !shown.length && (
        tab === "pending"
          ? <EmptyState icon={CheckCircle2} title="¡Sin deudas pendientes!" description="Todos tus clientes están al día." />
          : <EmptyState icon={Clock} title="Sin deudas cobradas" description="Acá aparecerán las deudas que se salden." />
      )}

      {/* Desktop table — only for pending/paid tabs */}
      {(tab === "pending" || tab === "paid") && shown.length > 0 && (
        <>
          <div className="hidden md:block bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {tab === "pending" && (
                    <th className="px-4 py-3 w-8">
                      <button onClick={() => toggleSelectAll(pending.map(d => d.id))} className="text-muted-foreground hover:text-foreground">
                        {pending.length > 0 && pending.every(d => selectedIds.has(d.id))
                          ? <CheckSquare className="w-4 h-4 text-primary" />
                          : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                  )}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Descripción</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                  {tab === "pending" && <>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pagado</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resta</th>
                  </>}
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                  {tab === "pending" && <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acc.</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map(d => (
                  <tr key={d.id} className={`hover:bg-muted/20 transition-colors group ${selectedIds.has(d.id) ? "bg-primary/5" : ""}`}>
                    {tab === "pending" && (
                      <td className="px-4 py-3 w-8">
                        <button onClick={() => toggleSelect(d.id)} className="text-muted-foreground hover:text-foreground">
                          {selectedIds.has(d.id)
                            ? <CheckSquare className="w-4 h-4 text-primary" />
                            : <Square className="w-4 h-4" />}
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatDateAR(d.date)}</td>
                    <td className="px-4 py-3 font-semibold">{d.customer_name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-[180px] truncate hidden lg:table-cell">{d.description}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatARS(Number(d.amount_ars))}</td>
                    {tab === "pending" && <>
                      <td className="px-4 py-3 text-right text-success font-medium">{formatARS(Number(d.paid_ars))}</td>
                      <td className="px-4 py-3 text-right font-bold text-destructive text-base">{formatARS(Number(d.remaining_ars))}</td>
                    </>}
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        d.status === "paid" ? "bg-success/15 text-success" :
                        d.status === "partial" ? "bg-warning/15 text-warning" :
                        "bg-destructive/15 text-destructive"
                      }`}>
                        {d.status === "paid" ? "✓ Pagada" : d.status === "partial" ? "Parcial" : "Pendiente"}
                      </span>
                    </td>
                    {tab === "pending" && (
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs border-success/30 text-success hover:bg-success/10" onClick={() => setPayingDebt(d)}>
                            <DollarSign className="w-3.5 h-3.5 mr-1" />Cobrar
                          </Button>
                          <Button size="sm" variant="outline"
                            className={`h-7 px-2 text-xs ${savedPlans[d.id] ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
                            title="Plan de pago en cuotas"
                            onClick={() => { setPlanningDebt(d); setPlanInstallments("3"); setPlanStart(new Date().toISOString().slice(0, 10)); }}>
                            <ListChecks className="w-3.5 h-3.5 mr-1" />{savedPlans[d.id] ? 'Plan ✓' : 'Plan'}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                            title="Enviar recordatorio por WhatsApp"
                            onClick={() => window.open(waDebtLink(d, activeOrg?.id), "_blank")}>
                            <MessageCircle className="w-3.5 h-3.5" />
                          </Button>
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                            title="¿Eliminar deuda?"
                            description={`Se eliminará la deuda de ${d.customer_name} por ${formatARS(Number(d.amount_ars))}.`}
                            confirmText="Eliminar"
                            onConfirm={() => handleDelete(d)}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {shown.map(d => (
              <div key={d.id} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold">{d.customer_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDateAR(d.date)} {d.description ? `· ${d.description}` : ""}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
                    d.status === "paid" ? "bg-success/15 text-success" :
                    d.status === "partial" ? "bg-warning/15 text-warning" :
                    "bg-destructive/15 text-destructive"
                  }`}>
                    {d.status === "paid" ? "✓ Pagada" : d.status === "partial" ? "Parcial" : "Pendiente"}
                  </span>
                </div>
                {tab === "pending" && (
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3 bg-muted/30 rounded-lg p-2.5">
                    <div className="text-center"><p className="text-muted-foreground mb-0.5">Total</p><p className="font-medium">{formatARS(Number(d.amount_ars))}</p></div>
                    <div className="text-center"><p className="text-muted-foreground mb-0.5">Pagado</p><p className="font-medium text-success">{formatARS(Number(d.paid_ars))}</p></div>
                    <div className="text-center"><p className="text-muted-foreground mb-0.5">Resta</p><p className="font-bold text-destructive">{formatARS(Number(d.remaining_ars))}</p></div>
                  </div>
                )}
                {tab === "pending" && (
                  <>
                  {savedPlans[d.id] && (() => {
                    const plan = savedPlans[d.id];
                    const paidCount = plan.installments.filter((i: any) => i.paid).length;
                    const total = plan.installments.length;
                    return (
                      <div className="mb-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${(paidCount / total) * 100}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{paidCount}/{total} cuotas</span>
                      </div>
                    );
                  })()}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-8 text-xs gradient-gold text-primary-foreground" onClick={() => setPayingDebt(d)}>
                      <DollarSign className="w-3.5 h-3.5 mr-1.5" />Registrar pago
                    </Button>
                    <Button size="sm" variant="outline"
                      className={`h-8 w-8 p-0 ${savedPlans[d.id] ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}
                      title="Plan de cuotas"
                      onClick={() => { setPlanningDebt(d); setPlanInstallments("3"); setPlanStart(new Date().toISOString().slice(0, 10)); }}>
                      <ListChecks className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0 border-green-500/30 text-green-400 hover:bg-green-500/10"
                      title="Recordatorio WhatsApp"
                      onClick={() => window.open(waDebtLink(d, activeOrg?.id), "_blank")}>
                      <MessageCircle className="w-3.5 h-3.5" />
                    </Button>
                    <ConfirmDialog
                      trigger={<Button size="sm" variant="outline" className="h-8 w-8 p-0 border-destructive/30"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                      title="¿Eliminar deuda?"
                      confirmText="Eliminar"
                      onConfirm={() => handleDelete(d)}
                    />
                  </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PaymentForm({ debt, userId, onSave }: { debt: any; userId: string; onSave: () => void }) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payment = parseFloat(amount) || 0;
    if (payment <= 0) { toast.error("Ingresá un monto válido"); return; }
    if (payment > Number(debt.remaining_ars)) { toast.error("El pago excede la deuda restante"); return; }
    setSaving(true);
    const result = await addDebtPaymentDB(debt.id, payment, { paymentMethod, userId });
    await logAudit(userId, "update", "debt", debt.id, { customer: debt.customer_name, payment, paymentMethod, newStatus: result.newStatus });
    toast.success(result.newRemaining <= 0 ? "¡Deuda saldada completamente! 🎉" : `Pago parcial registrado. Resta ${formatARS(result.newRemaining)}`);
    setSaving(false);
    onSave();
  };

  const pct = debt.amount_ars > 0 ? Math.round((Number(debt.paid_ars) / Number(debt.amount_ars)) * 100) : 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Summary card */}
      <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold">{debt.customer_name}</span>
          <span className="text-xs text-muted-foreground">{debt.description}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total deuda</span>
          <span>{formatARS(Number(debt.amount_ars))}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Ya pagado</span>
          <span className="text-success">{formatARS(Number(debt.paid_ars))}</span>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-1.5 mt-1">
          <div className="bg-success h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between font-bold pt-1 border-t border-border">
          <span>Resta pagar</span>
          <span className="text-destructive text-lg">{formatARS(Number(debt.remaining_ars))}</span>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Monto del pago (ARS)</label>
        <Input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}
          placeholder={`Máx: ${formatARS(Number(debt.remaining_ars))}`} className="bg-muted border-border" />
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Medio de cobro</label>
        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="efectivo">💵 Efectivo</SelectItem>
            <SelectItem value="transferencia">🏦 Transferencia</SelectItem>
            <SelectItem value="debito">💳 Débito</SelectItem>
            <SelectItem value="credito">💳 Crédito</SelectItem>
            <SelectItem value="mercadopago">📱 Mercado Pago</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving} className="flex-1 gradient-gold text-primary-foreground font-semibold">
          {saving ? "Guardando..." : "Registrar Pago"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setAmount(String(debt.remaining_ars))} className="shrink-0">
          Todo
        </Button>
      </div>
    </form>
  );
}
