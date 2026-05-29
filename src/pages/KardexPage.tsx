import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowDownCircle, ArrowUpCircle, BarChart3, RefreshCw, Search,
  Loader2, Download, SlidersHorizontal, Package, PlusCircle,
  MinusCircle, ClipboardList, TrendingDown, TrendingUp, History,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { usePageTitle } from "@/hooks/usePageTitle";

// ─── Types ────────────────────────────────────────────────────────────────────

type MovementType =
  | "purchase" | "sale" | "return_in" | "return_out"
  | "adjustment_in" | "adjustment_out" | "transfer_in" | "transfer_out"
  | "physical_count" | "initial";

interface StockMovement {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  movement_type: MovementType;
  quantity: number;
  stock_before: number;
  stock_after: number;
  reference_type: string | null;
  reference_id: string | null;
  unit_cost_usd: number | null;
  unit_price_ars: number | null;
  notes: string | null;
  created_at: string;
}

interface Product {
  id: string;
  name: string;
  stock: number;
}

interface KardexSummaryRow {
  product_id: string;
  product_name: string;
  current_stock: number;
  total_movements: number;
  total_in: number;
  total_out: number;
  last_movement_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<MovementType, { label: string; color: string; icon: React.ReactNode }> = {
  purchase:        { label: "Compra",           color: "bg-blue-500/15 text-blue-400 border-blue-500/30",    icon: <ArrowDownCircle className="w-3.5 h-3.5" /> },
  sale:            { label: "Venta",            color: "bg-red-500/15 text-red-400 border-red-500/30",       icon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
  return_in:       { label: "Dev. Entrada",     color: "bg-green-500/15 text-green-400 border-green-500/30", icon: <ArrowDownCircle className="w-3.5 h-3.5" /> },
  return_out:      { label: "Dev. Salida",      color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
  adjustment_in:   { label: "Ajuste (+)",       color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <PlusCircle className="w-3.5 h-3.5" /> },
  adjustment_out:  { label: "Ajuste (−)",       color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: <MinusCircle className="w-3.5 h-3.5" /> },
  transfer_in:     { label: "Transferencia (+)", color: "bg-purple-500/15 text-purple-400 border-purple-500/30", icon: <ArrowDownCircle className="w-3.5 h-3.5" /> },
  transfer_out:    { label: "Transferencia (−)", color: "bg-pink-500/15 text-pink-400 border-pink-500/30",    icon: <ArrowUpCircle className="w-3.5 h-3.5" /> },
  physical_count:  { label: "Toma Física",      color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",    icon: <ClipboardList className="w-3.5 h-3.5" /> },
  initial:         { label: "Stock Inicial",    color: "bg-gray-500/15 text-gray-400 border-gray-500/30",    icon: <Package className="w-3.5 h-3.5" /> },
};

function MovTypeBadge({ type }: { type: MovementType }) {
  const m = TYPE_META[type] ?? TYPE_META.initial;
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-medium border ${m.color}`}>
      {m.icon}{m.label}
    </Badge>
  );
}

const DATE_PRESETS = [
  { label: "Hoy",        days: 0 },
  { label: "7 días",     days: 7 },
  { label: "30 días",    days: 30 },
  { label: "90 días",    days: 90 },
  { label: "Todo",       days: -1 },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function KardexPage() {
  usePageTitle("Kardex");
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  // Data state
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [summary, setSummary] = useState<KardexSummaryRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<number>(30);
  const [tab, setTab] = useState<"movimientos" | "resumen">("movimientos");

  // Adjust dialog
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────────────────

  async function loadData() {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      // Products list
      const { data: prods } = await supabase
        .from("products")
        .select("id, name, stock")
        .eq("org_id", activeOrg.id)
        .order("name");
      setProducts(prods ?? []);

      // Summary view
      const { data: sumData } = await supabase
        .from("kardex_summary")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("total_movements", { ascending: false });
      setSummary(sumData ?? []);

      // Movements
      let query = supabase
        .from("stock_movements")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(500);

      if (datePreset >= 0) {
        const from = startOfDay(subDays(new Date(), datePreset)).toISOString();
        query = query.gte("created_at", from);
      }

      const { data: movData } = await query;
      setMovements(movData ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [activeOrg?.id, datePreset]);

  // ── Filters ───────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return movements.filter(m => {
      const matchSearch = !search || m.product_name.toLowerCase().includes(search.toLowerCase());
      const matchType   = typeFilter === "all" || m.movement_type === typeFilter;
      const matchProd   = productFilter === "all" || m.product_id === productFilter;
      return matchSearch && matchType && matchProd;
    });
  }, [movements, search, typeFilter, productFilter]);

  // ── Summary stats ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalIn  = filtered.filter(m => m.quantity > 0).reduce((a, m) => a + m.quantity, 0);
    const totalOut = filtered.filter(m => m.quantity < 0).reduce((a, m) => a + Math.abs(m.quantity), 0);
    const adjustments = filtered.filter(m => m.movement_type.startsWith("adjustment")).length;
    return { totalIn, totalOut, adjustments, total: filtered.length };
  }, [filtered]);

  // ── Manual adjustment ─────────────────────────────────────────────────────────

  async function handleAdjust() {
    if (!adjustProduct || !adjustQty || !user || !activeOrg) return;
    const newStock = parseInt(adjustQty, 10);
    if (isNaN(newStock) || newStock < 0) { toast.error("Cantidad inválida"); return; }
    setAdjustSaving(true);
    try {
      const { error } = await supabase.rpc("adjust_stock", {
        p_org_id: activeOrg.id,
        p_product_id: adjustProduct.id,
        p_variant_id: null,
        p_new_stock: newStock,
        p_notes: adjustNotes || null,
        p_created_by: user.id,
      });
      if (error) throw error;
      toast.success(`Stock de "${adjustProduct.name}" ajustado a ${newStock}`);
      setShowAdjust(false);
      setAdjustProduct(null);
      setAdjustQty("");
      setAdjustNotes("");
      await loadData();
    } catch (e: any) {
      toast.error(e.message ?? "Error al ajustar stock");
    } finally {
      setAdjustSaving(false);
    }
  }

  // ── Export CSV ────────────────────────────────────────────────────────────────

  function exportCSV() {
    const headers = ["Fecha", "Producto", "Variante", "Tipo", "Cantidad", "Stock Antes", "Stock Después", "Notas"];
    const rows = filtered.map(m => [
      format(new Date(m.created_at), "dd/MM/yyyy HH:mm"),
      m.product_name,
      m.variant_name ?? "",
      TYPE_META[m.movement_type]?.label ?? m.movement_type,
      m.quantity > 0 ? `+${m.quantity}` : String(m.quantity),
      String(m.stock_before),
      String(m.stock_after),
      m.notes ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `kardex-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <PageHeader
        icon={History}
        title="Kardex de Stock"
        description="Historial completo de movimientos de inventario"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
            <Button
              size="sm"
              onClick={() => { setAdjustProduct(null); setAdjustQty(""); setAdjustNotes(""); setShowAdjust(true); }}
            >
              <SlidersHorizontal className="w-4 h-4 mr-1" /> Ajuste
            </Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Total movimientos" value={stats.total} icon={ClipboardList} color="primary" />
        <KPICard label="Entradas" value={`+${stats.totalIn}`} icon={TrendingUp} color="success" />
        <KPICard label="Salidas" value={`−${stats.totalOut}`} icon={TrendingDown} color="destructive" />
        <KPICard label="Ajustes manuales" value={stats.adjustments} icon={SlidersHorizontal} color="warning" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-0">
        {(["movimientos", "resumen"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "movimientos" ? "Movimientos" : "Resumen por Producto"}
          </button>
        ))}
      </div>

      {/* Filters (movimientos tab) */}
      {tab === "movimientos" && (
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {Object.entries(TYPE_META).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Producto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los productos</SelectItem>
              {products.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-1">
            {DATE_PRESETS.map(d => (
              <Button
                key={d.days}
                size="sm"
                variant={datePreset === d.days ? "default" : "outline"}
                onClick={() => setDatePreset(d.days)}
                className="text-xs px-2.5"
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : tab === "movimientos" ? (
        /* ── Movements Table ── */
        <Card>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <History className="w-10 h-10 opacity-30" />
                <p>Sin movimientos para los filtros seleccionados</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-compact-mobile">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="py-3 px-4 text-left">Fecha</th>
                      <th className="py-3 px-4 text-left">Producto</th>
                      <th className="py-3 px-4 text-left">Tipo</th>
                      <th className="py-3 px-4 text-right">Cantidad</th>
                      <th className="py-3 px-4 text-right">Antes</th>
                      <th className="py-3 px-4 text-right">Después</th>
                      <th className="py-3 px-4 text-left">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m, i) => (
                      <tr
                        key={m.id}
                        className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                          i % 2 === 0 ? "" : "bg-muted/10"
                        }`}
                      >
                        <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                          {format(new Date(m.created_at), "dd/MM/yy HH:mm", { locale: es })}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-medium">{m.product_name}</span>
                          {m.variant_name && (
                            <span className="text-muted-foreground text-xs ml-1">· {m.variant_name}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <MovTypeBadge type={m.movement_type} />
                        </td>
                        <td className={`py-2.5 px-4 text-right font-mono font-semibold ${
                          m.quantity > 0 ? "text-green-400" : "text-red-400"
                        }`}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="py-2.5 px-4 text-right text-muted-foreground font-mono">{m.stock_before}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-medium">{m.stock_after}</td>
                        <td className="py-2.5 px-4 text-muted-foreground text-xs max-w-[180px] truncate">
                          {m.notes ?? (m.reference_type ? `Ref: ${m.reference_type}` : "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* ── Summary Table ── */
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Resumen por producto
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {summary.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <Package className="w-10 h-10 opacity-30" />
                <p>Sin datos de movimientos aún</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-compact-mobile">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="py-3 px-4 text-left">Producto</th>
                      <th className="py-3 px-4 text-right">Stock Actual</th>
                      <th className="py-3 px-4 text-right">Entradas</th>
                      <th className="py-3 px-4 text-right">Salidas</th>
                      <th className="py-3 px-4 text-right">Movimientos</th>
                      <th className="py-3 px-4 text-left">Último Mov.</th>
                      <th className="py-3 px-4 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s, i) => {
                      const prod = products.find(p => p.id === s.product_id);
                      return (
                        <tr
                          key={s.product_id}
                          className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                            i % 2 === 0 ? "" : "bg-muted/10"
                          }`}
                        >
                          <td className="py-2.5 px-4 font-medium">{s.product_name}</td>
                          <td className={`py-2.5 px-4 text-right font-mono font-semibold ${
                            (s.current_stock ?? 0) <= 0 ? "text-red-400" :
                            (s.current_stock ?? 0) <= 5 ? "text-yellow-400" : "text-green-400"
                          }`}>
                            {s.current_stock ?? 0}
                          </td>
                          <td className="py-2.5 px-4 text-right text-green-400 font-mono">+{s.total_in}</td>
                          <td className="py-2.5 px-4 text-right text-red-400 font-mono">−{s.total_out}</td>
                          <td className="py-2.5 px-4 text-right text-muted-foreground">{s.total_movements}</td>
                          <td className="py-2.5 px-4 text-muted-foreground text-xs">
                            {s.last_movement_at
                              ? format(new Date(s.last_movement_at), "dd/MM/yy", { locale: es })
                              : "—"}
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {prod && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setAdjustProduct(prod);
                                  setAdjustQty(String(prod.stock));
                                  setAdjustNotes("");
                                  setShowAdjust(true);
                                }}
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5 mr-1" /> Ajustar
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
          </CardContent>
        </Card>
      )}

      {/* ── Adjust Dialog ── */}
      <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" /> Ajuste Manual de Stock
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Product selector (when opened from button, pre-selected; from header button, user picks) */}
            {!adjustProduct && (
              <div>
                <Label>Producto *</Label>
                <Select onValueChange={v => {
                  const p = products.find(x => x.id === v) ?? null;
                  setAdjustProduct(p);
                  setAdjustQty(p ? String(p.stock) : "");
                }}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Seleccioná un producto" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} (stock: {p.stock})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {adjustProduct && (
              <div className="rounded-lg bg-muted/30 border border-border p-3">
                <p className="text-sm font-medium">{adjustProduct.name}</p>
                <p className="text-xs text-muted-foreground">Stock actual: <span className="font-mono font-semibold text-foreground">{adjustProduct.stock}</span></p>
              </div>
            )}

            <div>
              <Label htmlFor="adj-qty">Nuevo stock total *</Label>
              <Input
                id="adj-qty"
                type="number"
                min="0"
                className="mt-1.5 font-mono"
                placeholder="0"
                value={adjustQty}
                onChange={e => setAdjustQty(e.target.value)}
              />
              {adjustProduct && adjustQty !== "" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Diferencia:{" "}
                  <span className={
                    parseInt(adjustQty) - adjustProduct.stock > 0
                      ? "text-green-400 font-semibold"
                      : parseInt(adjustQty) - adjustProduct.stock < 0
                        ? "text-red-400 font-semibold"
                        : "text-muted-foreground"
                  }>
                    {parseInt(adjustQty) - adjustProduct.stock > 0 ? "+" : ""}
                    {parseInt(adjustQty) - adjustProduct.stock}
                  </span>
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="adj-notes">Motivo del ajuste</Label>
              <Textarea
                id="adj-notes"
                className="mt-1.5 resize-none"
                placeholder="Ej: Toma física, rotura, pérdida…"
                rows={2}
                value={adjustNotes}
                onChange={e => setAdjustNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjust(false)}>Cancelar</Button>
            <Button
              onClick={handleAdjust}
              disabled={!adjustProduct || !adjustQty || adjustSaving}
            >
              {adjustSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <SlidersHorizontal className="w-4 h-4 mr-2" />}
              Aplicar Ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
