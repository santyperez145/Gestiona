import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";
import {
  ClipboardList, CheckCircle2, AlertTriangle, RefreshCw,
  Loader2, Download, Search, ChevronUp, ChevronDown,
  PackageCheck, TrendingDown, TrendingUp, Minus, ScanLine, Zap,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
// ─── Barcode scanner hook ─────────────────────────────────────────────────────

function useBarcodeScanner(onDetected: (code: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readerRef = useRef<any>(null);
  const [scanning, setScanning] = useState(false);

  const start = useCallback(async () => {
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      setScanning(true);
      await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (result) { onDetected(result.getText()); stop(); }
      });
    } catch { setScanning(false); }
  }, [onDetected]);

  const stop = useCallback(() => {
    readerRef.current?.reset();
    readerRef.current = null;
    setScanning(false);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  return { videoRef, scanning, start, stop };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  stock: number;
  cost_usd: number;
  image_url?: string | null;
  barcode?: string | null;
  sku?: string | null;
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
  usePageTitle("Conteo de Stock");
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
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // Barcode scan handler: find product by barcode/sku/name, increment its count
  const handleBarcodeScan = useCallback((code: string) => {
    const found = rows.find(r =>
      r.product.barcode === code ||
      r.product.sku === code ||
      r.product.name.toLowerCase() === code.toLowerCase()
    );
    if (!found) {
      // Try partial match by name
      const partial = rows.find(r => r.product.name.toLowerCase().includes(code.toLowerCase()));
      if (!partial) { toast.error(`Código "${code}" no encontrado`); return; }
      const id = partial.product.id;
      setRows(prev => prev.map(r => r.product.id === id
        ? { ...r, counted: String((r.counted === '' ? r.product.stock : Number(r.counted)) + 1) }
        : r
      ));
      setHighlightedId(id);
      setScanCount(n => n + 1);
      setTimeout(() => {
        rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inputRefs.current[id]?.focus();
        setHighlightedId(null);
      }, 150);
      toast.success(`${partial.product.name} +1`);
      return;
    }
    const id = found.product.id;
    setRows(prev => prev.map(r => r.product.id === id
      ? { ...r, counted: String((r.counted === '' ? r.product.stock : Number(r.counted)) + 1) }
      : r
    ));
    setHighlightedId(id);
    setScanCount(n => n + 1);
    setTimeout(() => {
      rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inputRefs.current[id]?.focus();
      setHighlightedId(null);
    }, 150);
    toast.success(`${found.product.name} +1`);
  }, [rows]);

  const { videoRef: scanVideoRef, scanning: scannerOpen, start: startScan, stop: stopScan } = useBarcodeScanner(handleBarcodeScan);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category,stock,cost_usd,image_url,barcode,sku")
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
        supabase.from("stock_history").insert({
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
    <div className="p-6 space-y-6 pb-12">
      {/* Header */}
      <PageHeader
        icon={ClipboardList}
        title="Toma Física de Inventario"
        description="Ingresá el stock real de cada producto. Confirmá para actualizar las diferencias."
      />

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
        <div className="flex gap-2 ml-auto flex-wrap">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={loading}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Recargar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={startScan}
            disabled={loading || scannerOpen}
            className="gap-1 border-primary/40 text-primary hover:bg-primary/10"
          >
            <ScanLine className="w-4 h-4" />
            Escanear
            {scanCount > 0 && (
              <span className="ml-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {scanCount}
              </span>
            )}
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard label="Contados" value={stats.counted} icon={CheckCircle2} color="success" />
          <KPICard label="Sin contar" value={stats.missing} icon={Minus} color="primary" />
          <KPICard label="Sobrantes" value={stats.surplus} icon={TrendingUp} color="success" />
          <KPICard label="Faltantes" value={stats.shortage} icon={TrendingDown} color="destructive" />
          <KPICard
            label="Impacto costo neto"
            value={`${stats.totalDiffCost >= 0 ? "+" : ""}${stats.totalDiffCost.toFixed(0)} USD`}
            icon={stats.totalDiffCost < 0 ? TrendingDown : TrendingUp}
            color={stats.totalDiffCost < 0 ? "destructive" : "success"}
          />
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

                const isHighlighted = highlightedId === row.product.id;

                return (
                  <tr
                    key={row.product.id}
                    ref={el => { rowRefs.current[row.product.id] = el; }}
                    className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${rowBg} ${isHighlighted ? "ring-2 ring-inset ring-primary/60 bg-primary/10" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{row.product.name}</div>
                      {!row.product.barcode && !row.product.sku && (
                        <span className="text-[9px] text-muted-foreground/50 font-mono">sin código</span>
                      )}
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

      {/* ── Scanner overlay ───────────────────────────────────────────────── */}
      {scannerOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center gap-4">
          <div className="relative w-full max-w-sm rounded-2xl overflow-hidden border-2 border-primary/60 shadow-2xl">
            <video ref={scanVideoRef} className="w-full aspect-video object-cover" autoPlay playsInline muted />
            {/* Animated scan line */}
            <div
              className="absolute left-0 right-0 h-0.5 bg-primary/80 shadow-[0_0_8px_2px_var(--primary)]"
              style={{ animation: "scanline 2s linear infinite", top: "50%" }}
            />
            {/* Corner brackets */}
            <div className="absolute inset-4 pointer-events-none">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl-md" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr-md" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl-md" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br-md" />
            </div>
          </div>
          <p className="text-white/70 text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary animate-pulse" />
            Apuntá la cámara al código de barras
          </p>
          {scanCount > 0 && (
            <p className="text-primary font-semibold text-sm">{scanCount} ítem{scanCount !== 1 ? "s" : ""} escaneado{scanCount !== 1 ? "s" : ""}</p>
          )}
          <Button variant="outline" onClick={stopScan} className="border-white/30 text-white hover:bg-white/10">
            Cancelar
          </Button>
        </div>
      )}

      <style>{`
        @keyframes scanline {
          0%   { top: 20%; }
          50%  { top: 80%; }
          100% { top: 20%; }
        }
      `}</style>
    </div>
  );
}
