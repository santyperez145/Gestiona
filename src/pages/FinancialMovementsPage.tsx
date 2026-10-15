/**
 * FinancialMovementsPage — todo el dinero que entró y salió del negocio.
 *
 * 2026-10-15 (funciones incoherentes): leía sólo `financial_movements` (1 fila
 * en toda la plataforma) y comparaba la dirección con 'income'/'expense'
 * cuando la base guarda 'in'/'out': los totales daban siempre $0. Ahora lee
 * `movimientos_de_dinero` (ventas cobradas, cobros de cuenta corriente,
 * reintegros, pagos a proveedores, gastos y compras) y muestra:
 *   - Running balance (cash + bank balances)
 *   - Direction color-coding (income=green, expense=red)
 *   - Source-type badge (venta / compra / gasto)
 *   - Filter by direction, sourceType, date range
 *   - Full-text search on description + counterparty
 *   - Export to CSV
 *   - Summary KPIs: total income, total expenses, net balance
 */
import { hoyAR, fechaLocal } from "@/lib/fechaAR";
import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import FinancePageHeader from "@/components/finance/FinancePageHeader";
import FinanceKPICard from "@/components/finance/FinanceKPICard";
import FinanceEmptyState from "@/components/finance/FinanceEmptyState";
import PaymentSettlementsPanel from "@/components/finance/PaymentSettlementsPanel";
import BankReconciliationPanel from "@/components/finance/BankReconciliationPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import { plural } from "@/lib/plural";
import { nombreDelMedio } from "@/lib/mediosDePago";
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw, Download,
  Search, ArrowUpCircle, ArrowDownCircle, Filter, X,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─── Types ────────────────────────────────────────────────────────────────────
type Movement = {
  id: string;
  direction: "in" | "out";
  source_type: string;
  source_id: string | null;
  amount_ars: number;
  description: string;
  counterparty: string | null;
  payment_method: string;
  happened_at: string;
};
const esIngreso = (m: Pick<Movement, "direction">) => m.direction === "in";
const TOPE = 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SOURCE_LABELS: Record<string, string> = {
  sale: "Venta",
  debt_payment: "Cobro de cuenta corriente",
  return: "Devolución",
  supplier_payment: "Proveedor",
  expense: "Gasto",
  manual: "Manual",
  cash_open: "Apertura de caja",
  cash_close: "Cierre de caja",
  influencer_payment: "Pago a creador",
};;

const SOURCE_COLORS: Record<string, string> = {
  sale: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  purchase: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  expense: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  adjustment: "bg-primary/15 text-primary border-primary/30",
};

function formatDate(iso: string) {
  return fechaLocal(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadCSV(movements: Movement[]) {
  const header = "Fecha,Tipo,Fuente,Descripcion,Contraparte,Metodo de pago,Monto ARS\n";
  const rows = movements.map(m => [
    fechaLocal(m.happened_at).toLocaleDateString("es-AR"),
    esIngreso(m) ? "Ingreso" : "Egreso",
    SOURCE_LABELS[m.source_type] ?? m.source_type,
    `"${m.description.replace(/"/g, '""')}"`,
    `"${(m.counterparty ?? "").replace(/"/g, '""')}"`,
    nombreDelMedio(m.payment_method),
    esIngreso(m) ? m.amount_ars : -m.amount_ars,
  ].join(",")).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `movimientos_${hoyAR()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function FinancialMovementsPage() {
  usePageTitle("Entradas y salidas");
  const { activeOrg } = useOrg();
  const { user } = useAuth();

  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");
  const [alcanzoTope, setAlcanzoTope] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      let q = supabase
        .from("movimientos_de_dinero" as never)
        .select("id, direction, source_type, source_id, amount_ars, description, counterparty, payment_method, happened_at")
        .eq("org_id", activeOrg.id)
        .order("happened_at", { ascending: false })
        .limit(TOPE);

      if (dateFrom) q = q.gte("happened_at", dateFrom);
      if (dateTo)   q = q.lte("happened_at", dateTo + "T23:59:59");

      const { data, error } = await q;
      if (error) throw error;
      const filas = ((data || []) as unknown as Movement[]).map(m => ({ ...m, amount_ars: Number(m.amount_ars) || 0, description: m.description ?? "" }));
      setMovements(filas);
      setAlcanzoTope(filas.length >= TOPE);
    } catch (e: any) {
      toast.error("No se pudieron cargar los movimientos", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg, dateFrom, dateTo]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = movements;
    if (dirFilter !== "all") list = list.filter(m => m.direction === dirFilter);
    if (typeFilter !== "all") list = list.filter(m => m.source_type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.description.toLowerCase().includes(q) ||
        (m.counterparty ?? "").toLowerCase().includes(q) ||
        nombreDelMedio(m.payment_method).toLowerCase().includes(q)
      );
    }
    return list;
  }, [movements, dirFilter, typeFilter, search]);

  // KPIs
  const totalIncome  = useMemo(() => filtered.filter(esIngreso).reduce((s, m) => s + m.amount_ars, 0), [filtered]);
  const totalExpense = useMemo(() => filtered.filter(m => !esIngreso(m)).reduce((s, m) => s + m.amount_ars, 0), [filtered]);
  const netBalance   = totalIncome - totalExpense;

  // Running balance (oldest first)
  const withRunning = useMemo(() => {
    const sorted = [...filtered].reverse();
    let running = 0;
    return sorted.map(m => {
      running += esIngreso(m) ? m.amount_ars : -m.amount_ars;
      return { ...m, running };
    }).reverse();
  }, [filtered]);

  const hasFilters = dirFilter !== "all" || typeFilter !== "all" || search || dateFrom || dateTo;
  const clearFilters = () => { setDirFilter("all"); setTypeFilter("all"); setSearch(""); setDateFrom(""); setDateTo(""); };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Wallet}
        title="Entradas y salidas"
        description="Todo el dinero que entró y salió: ventas cobradas, cobros de cuenta corriente, devoluciones, proveedores y gastos"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadCSV(filtered)} disabled={filtered.length === 0}>
              <Download className="w-4 h-4 mr-1.5" />
              CSV
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          label="Total ingresos"
          value={formatARS(totalIncome)}
          icon={TrendingUp}
          color="success"
          sub={`${plural(filtered.filter(esIngreso).length, "movimiento")}`}
        />
        <KPICard
          label="Total egresos"
          value={formatARS(totalExpense)}
          icon={TrendingDown}
          color="destructive"
          sub={`${plural(filtered.filter(m => !esIngreso(m)).length, "movimiento")}`}
        />
        <KPICard
          label="Balance neto"
          value={formatARS(netBalance)}
          icon={Wallet}
          color={netBalance >= 0 ? "primary" : "destructive"}
          sub={filtered.length + " registros totales"}
        />
      </div>

      {/* Qué te queda realmente de cada cobro digital */}
      <PaymentSettlementsPanel />

      {/* F5.4 — El banco contra el libro */}
      <BankReconciliationPanel />

      {alcanzoTope && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-muted-foreground" role="status">
          Se muestran los {TOPE.toLocaleString("es-AR")} movimientos más recientes: elegí un rango de fechas para ver el resto y para que los totales sean del período completo.
        </p>
      )}

      {/* Filters */}
      <div className="bg-card border border-border/60 rounded-xl p-4 shadow-card">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground mb-1 block">Buscar</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder="Descripción, contraparte…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Direction */}
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Dirección</label>
            <Select value={dirFilter} onValueChange={(v: any) => setDirFilter(v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="in">Ingresos</SelectItem>
                <SelectItem value="out">Egresos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Type */}
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Fuente</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([valor, nombre]) => <SelectItem key={valor} value={valor}>{nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Date from */}
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Desde</label>
            <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>

          {/* Date to */}
          <div className="w-36">
            <label className="text-xs text-muted-foreground mb-1 block">Hasta</label>
            <Input type="date" className="h-9 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-end h-9">
              <X className="w-4 h-4 mr-1" />Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border/60 rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 opacity-40" />
            Cargando movimientos…
          </div>
        ) : withRunning.length === 0 ? (
          <div className="text-center py-20">
            <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
            <p className="text-base text-muted-foreground font-medium">Sin movimientos registrados</p>
            <p className="text-sm text-muted-foreground mt-1">
              Los movimientos se generan automáticamente al registrar ventas, compras y gastos.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Descripción</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Contraparte</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Método</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monto</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Saldo acum.</th>
                </tr>
              </thead>
              <tbody>
                {withRunning.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                      {formatDate(m.happened_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${SOURCE_COLORS[m.source_type] ?? "bg-muted text-muted-foreground"}`}>
                        {SOURCE_LABELS[m.source_type] ?? m.source_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="flex items-center gap-2">
                        {esIngreso(m)
                          ? <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className="truncate font-medium">{m.description}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-[140px] truncate">
                      {m.counterparty ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell text-xs">
                      {m.payment_method === "sin_dato" ? "Sin dato" : nombreDelMedio(m.payment_method)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${esIngreso(m) ? "text-emerald-400" : "text-red-400"}`}>
                      {esIngreso(m) ? "+" : "−"}{formatARS(m.amount_ars)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs hidden lg:table-cell ${m.running >= 0 ? "text-muted-foreground" : "text-red-400"}`}>
                      {formatARS(m.running)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 border-t border-border font-semibold">
                  <td colSpan={5} className="px-4 py-3 text-xs text-muted-foreground">
                    {filtered.length} movimientos filtrados
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${netBalance >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {netBalance >= 0 ? "+" : "−"}{formatARS(Math.abs(netBalance))}
                  </td>
                  <td className="hidden lg:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
