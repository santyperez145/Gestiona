/**
 * FinancialMovementsPage — Real-time general ledger.
 *
 * Shows every financial_movements record (sales income, purchase expenses,
 * general expenses) in a chronological ledger with:
 *   - Running balance (cash + bank balances)
 *   - Direction color-coding (income=green, expense=red)
 *   - Source-type badge (venta / compra / gasto)
 *   - Filter by direction, sourceType, date range
 *   - Full-text search on description + counterparty
 *   - Export to CSV
 *   - Summary KPIs: total income, total expenses, net balance
 */
import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw, Download,
  Search, ArrowUpCircle, ArrowDownCircle, Filter, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Movement = {
  id: string;
  direction: string;        // 'income' | 'expense'
  source_type: string;      // 'sale' | 'purchase' | 'expense' | 'adjustment'
  source_id: string | null;
  amount_ars: number;
  description: string;
  counterparty: string | null;
  payment_method: string;
  channel: string;
  affects_cash: boolean;
  affects_bank: boolean;
  happened_at: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SOURCE_LABELS: Record<string, string> = {
  sale: "Venta",
  purchase: "Compra",
  expense: "Gasto",
  adjustment: "Ajuste",
};

const SOURCE_COLORS: Record<string, string> = {
  sale: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  purchase: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  expense: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  adjustment: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
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
    new Date(m.happened_at).toLocaleDateString("es-AR"),
    m.direction === "income" ? "Ingreso" : "Egreso",
    SOURCE_LABELS[m.source_type] ?? m.source_type,
    `"${m.description.replace(/"/g, '""')}"`,
    `"${(m.counterparty ?? "").replace(/"/g, '""')}"`,
    m.payment_method,
    m.direction === "income" ? m.amount_ars : -m.amount_ars,
  ].join(",")).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `movimientos_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function FinancialMovementsPage() {
  usePageTitle("Libro Mayor");
  const { activeOrg } = useOrg();
  const { user } = useAuth();

  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [dirFilter, setDirFilter] = useState<"all" | "income" | "expense">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      let q = supabase
        .from("financial_movements")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("happened_at", { ascending: false })
        .limit(500);

      if (dateFrom) q = q.gte("happened_at", dateFrom);
      if (dateTo)   q = q.lte("happened_at", dateTo + "T23:59:59");

      const { data, error } = await q;
      if (error) throw error;
      setMovements((data || []) as Movement[]);
    } catch (e: any) {
      toast.error("Error al cargar movimientos: " + e.message);
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
        m.payment_method.toLowerCase().includes(q)
      );
    }
    return list;
  }, [movements, dirFilter, typeFilter, search]);

  // KPIs
  const totalIncome  = useMemo(() => filtered.filter(m => m.direction === "income").reduce((s, m) => s + m.amount_ars, 0), [filtered]);
  const totalExpense = useMemo(() => filtered.filter(m => m.direction === "expense").reduce((s, m) => s + m.amount_ars, 0), [filtered]);
  const netBalance   = totalIncome - totalExpense;

  // Running balance (oldest first)
  const withRunning = useMemo(() => {
    const sorted = [...filtered].reverse();
    let running = 0;
    return sorted.map(m => {
      running += m.direction === "income" ? m.amount_ars : -m.amount_ars;
      return { ...m, running };
    }).reverse();
  }, [filtered]);

  const hasFilters = dirFilter !== "all" || typeFilter !== "all" || search || dateFrom || dateTo;
  const clearFilters = () => { setDirFilter("all"); setTypeFilter("all"); setSearch(""); setDateFrom(""); setDateTo(""); };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Wallet}
        title="Movimientos financieros"
        description="Libro mayor de todos los ingresos y egresos del negocio"
        actions={
          <div className="flex gap-2">
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
          sub={`${filtered.filter(m => m.direction === "income").length} movimientos`}
        />
        <KPICard
          label="Total egresos"
          value={formatARS(totalExpense)}
          icon={TrendingDown}
          color="destructive"
          sub={`${filtered.filter(m => m.direction === "expense").length} movimientos`}
        />
        <KPICard
          label="Balance neto"
          value={formatARS(netBalance)}
          icon={Wallet}
          color={netBalance >= 0 ? "primary" : "destructive"}
          sub={filtered.length + " registros totales"}
        />
      </div>

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
                <SelectItem value="income">Ingresos</SelectItem>
                <SelectItem value="expense">Egresos</SelectItem>
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
                <SelectItem value="sale">Ventas</SelectItem>
                <SelectItem value="purchase">Compras</SelectItem>
                <SelectItem value="expense">Gastos</SelectItem>
                <SelectItem value="adjustment">Ajustes</SelectItem>
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
                        {m.direction === "income"
                          ? <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          : <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className="truncate font-medium">{m.description}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-[140px] truncate">
                      {m.counterparty ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell capitalize text-xs">
                      {m.payment_method ?? "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${m.direction === "income" ? "text-emerald-400" : "text-red-400"}`}>
                      {m.direction === "income" ? "+" : "−"}{formatARS(m.amount_ars)}
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
