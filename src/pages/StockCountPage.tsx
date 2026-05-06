import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ClipboardList, CheckCircle2, AlertTriangle, RefreshCw,
  Loader2, Download, Search, ChevronUp, ChevronDown,
  PackageCheck, TrendingDown, TrendingUp, Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  stock: number;
  cost_usd: number;
  image_url?: string | null;
}

interface CountRow {
  product: Product;
  counted: string; // text input — empty = not counted yet
}

type SortKey = "name" | "diff" | "system";

const CAT_LABELS: Record<string, string> = {
  perfume_arabe: "Árabe",
  perfume_diseñador: "Diseñador",
  vaper: "Vaper",
  electronico: "Electrónico",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StockCountPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<CountRow[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category,stock,cost_usd,image_url")
        .eq("org_id", activeOrg.id)
        .order("name");
      if (error) throw error;
      setRows(((data || []) as Product[]).map(p => ({ product: p, counted: "" })));
      setConfirmedAt(null);
    } catch {
      toast.error("Error al cargar productos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const cats = useMemo(() => {
    const set = new Set(rows.map(r => r.product.category).filter(Boolean));
    return ["all", ...Array.from(set)];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows
      .filter(r =>
        (catFilter === "all" || r.product.category === catFilter) &&
        (!q || r.product.name.toLowerCase().includes(q))
      )
      .sort((a, b) => {
        let av: number | string, bv: number | string;
        if (sortKey === "name") { av = a.product.name; bv = b.product.name; }
        else if (sortKey === "system") { av = a.product.stock; bv = b.product.stock; }
        else {
          const aCount = a.counted !== "" ? Number(a.counted) : a.product.stock;
          const bCount = b.counted !== "" ? Number(b.counted) : b.product.stock;
          av = aCount - a.product.stock; bv = bCount - b.product.stock;
        }
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string, "es") : (bv as string).localeCompare(av, "es");
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });
  }, [rows, search, catFilter, sortKey, sortDir]);

  const stats = useMemo(() => {
    let counted = 0, surplus = 0, shortage = 0, missing = 0, totalDiffCost = 0;
    rows.forEach(r => {
      if (r.counted === "") { missing++; return; }
      const diff = Number(r.counted) - r.product.stock;
      counted++;
      if (diff > 0) surplus++;
      else if (diff < 0) shortage++;
      totalDiffCost += diff * (r.product.cost_usd || 0);
    });
    return { counted, missing, surplus, shortage, totalDiffCost };
  }, [rows]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const setCount = (id: string, value: string) => {
    setRows(prev => prev.map(r => r.product.id === id ? { ...r, counted: value } : r));
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "diff" ? "asc" : "asc"); }
  };

  const handleConfirm = async () => {
    const changed = rows.filter(r => r.counted !== "" && Number(r.counted) !== r.product.stock);
    if (changed.length === 0) { toast.info("No hay diferencias para confirmar"); return; }
    if (!confirm(`¿Confirmar ajuste de stock para ${changed.length} producto(s)?`)) return;
    setSaving(true);
    try {
      await Promise.all(changed.map(r =>
        supabase.from("products").update({ stock: Number(r.counted) }).eq("id", r.product.id)
      ));
      // Record adjustment in stock_history if the table exists (best-effort)
      const note = `Toma física ${new Date().toLocaleDateString("es-AR")}`;
      await Promise.allSettled(changed.map(r =>
        supabase.from("stock_history" as any).insert({
          org_id: activeOrg!.id,
          product_id: r.product.id,
          product_name: r.product.name,
          change: Number(r.counted) - r.product.stock,
          reason: note,
          new_stock: Number(r.counted),
        })
      ));
      setConfirmedAt(new Date().toLocaleString("es-AR"));
      // Reload with updated stocks
      await load();
      toast.success(`Ajustados ${changed.length} productos`);
    } catch {
      toast.error("Error al guardar ajustes");
    } finally {
      setSaving(false);
    }
  };

  const exportCSV = () => {
    const header = "Producto,Categoría,Sistema,Contado,Diferencia,Costo USD unitario,Impacto USD";
    const rowsData = rows.map(r => {
      const counted = r.counted !== "" ? Number(r.counted) : r.product.stock;
      const diff = counted - r.product.stock;
      return [
        r.product.name,
        CAT_LABELS[r.product.category] || r.product.category,
        r.product.stock,
        r.counted !== "" ? r.counted : "(no contado)",
        diff,
        r.product.cost_usd || 0,
        (diff * (r.product.cost_usd || 0)).toFixed(2),
      ].join(",");
    });
    const blob = new Blob([[header, ...rowsData].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `toma-fisica-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Focus next input on Enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === "Enter") {
      const nextId = filtered[idx + 1]?.product.id;
      if (nextId) inputRefs.current[nextId]?.focus();
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />) : null;

  // ─── Render ───────────────────────────────────────────────────────────────

  const changedCount = rows.filter(r => r.counted !== "" && Number(r.counted) !== r.product.stock).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-primary" />
          Toma Física de Inventario
        </h1>
        <p className="text-muted-foreground text-sm">
          Ingresá el stock real de cada producto. Confirmá para actualizar las diferencias.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {cats.map(c => (
            <Button
              key={c}
              variant={catFilter === c ? "default" : "outline"}
              size="sm"
              onClick={() => setCatFilter(c)}
              className="h-8 text-xs"
            >
              {c === "all" ? "Todo" : (CAT_LABELS[c] || c)}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={loading}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Recargar
          </Button>
          <Button
            size="sm"
            disabled={changedCount === 0 || saving}
            onClick={handleConfirm}
            className="gap-1"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            Confirmar ({changedCount})
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: "Contados", value: stats.counted, icon: CheckCircle2, color: "text-emerald-400" },
            { label: "Sin contar", value: stats.missing, icon: Minus, color: "text-muted-foreground" },
            { label: "Sobrantes", value: stats.surplus, icon: TrendingUp, color: "text-green-400" },
            { label: "Faltantes", value: stats.shortage, icon: TrendingDown, color: "text-red-400" },
          ].map(s => (
            <Card key={s.label} className="border-border bg-card/60">
              <CardContent className="p-3 flex items-center gap-2">
                <s.icon className={`w-5 h-5 ${s.color} shrink-0`} />
                <div>
                  <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Card className="border-border bg-card/60">
            <CardContent className="p-3">
              <div className={`text-xl font-bold ${stats.totalDiffCost < 0 ? "text-red-400" : stats.totalDiffCost > 0 ? "text-green-400" : ""}`}>
                {stats.totalDiffCost >= 0 ? "+" : ""}{stats.totalDiffCost.toFixed(0)} USD
              </div>
              <div className="text-xs text-muted-foreground">Impacto costo neto</div>
            </CardContent>
          </Card>
        </div>
      )}

      {confirmedAt && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-4 py-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Toma confirmada el {confirmedAt}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando productos...
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th
                  className="text-left px-4 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground"
                  onClick={() => toggleSort("name")}
                >
                  Producto <SortIcon k="name" />
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Categoría</th>
                <th
                  className="text-right px-3 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground"
                  onClick={() => toggleSort("system")}
                >
                  Sistema <SortIcon k="system" />
                </th>
                <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">Contado</th>
                <th
                  className="text-right px-3 py-2.5 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground"
                  onClick={() => toggleSort("diff")}
                >
                  Diferencia <SortIcon k="diff" />
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Impacto USD</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    No se encontraron productos.
                  </td>
                </tr>
              )}
              {filtered.map((row, idx) => {
                const counted = row.counted !== "" ? Number(row.counted) : null;
                const diff = counted !== null ? counted - row.product.stock : null;
                const diffColor = diff === null
                  ? ""
                  : diff > 0
                    ? "text-green-400"
                    : diff < 0
                      ? "text-red-400"
                      : "text-muted-foreground";
                const rowBg = diff !== null && diff !== 0 ? (diff > 0 ? "bg-green-950/10" : "bg-red-950/10") : "";

                return (
                  <tr key={row.product.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${rowBg}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{row.product.name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                      {CAT_LABELS[row.product.category] || row.product.category}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{row.product.stock}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Input
                        ref={el => { inputRefs.current[row.product.id] = el; }}
                        type="number"
                        min={0}
                        value={row.counted}
                        onChange={e => setCount(row.product.id, e.target.value)}
                        onKeyDown={e => handleKeyDown(e, idx)}
                        placeholder="—"
                        className="w-20 h-7 text-right text-sm font-mono ml-auto"
                      />
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono font-semibold ${diffColor}`}>
                      {diff === null ? "—" : diff === 0 ? <span className="text-muted-foreground">±0</span> : (diff > 0 ? `+${diff}` : diff)}
                    </td>
                    <td className={`px-4 py-2.5 text-right hidden lg:table-cell ${diffColor}`}>
                      {diff === null || diff === 0
                        ? "—"
                        : `${diff > 0 ? "+" : ""}${(diff * (row.product.cost_usd || 0)).toFixed(2)} USD`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {!loading && (
        <p className="text-xs text-muted-foreground text-center">
          Presioná <kbd className="px-1 py-0.5 rounded border border-border text-xs">Enter</kbd> en cada campo para pasar al siguiente.
          Los cambios no se aplican hasta confirmar.
        </p>
      )}
    </div>
  );
}
