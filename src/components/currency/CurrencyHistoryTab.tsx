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
  DollarSign, TrendingUp, TrendingDown, RefreshCw, Plus,
  Zap, ArrowUpRight, ArrowDownRight, Info, Package, Loader2,
} from "lucide-react";

interface ExchangeRate {
  id: string;
  date: string;
  usd_ars: number;
  eur_ars: number;
  brl_ars: number;
  source: string;
  notes: string | null;
  created_at: string;
}

interface PriceUpdate {
  id: string;
  name: string;
  rate_before: number;
  rate_after: number;
  pct_change: number;
  products_updated: number;
  applied_at: string;
}

function fmtRate(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(n);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual", api: "API automática", bcra: "BCRA oficial", dolar_blue: "Dólar blue",
};

export default function CurrencyHistoryTab() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [updates, setUpdates] = useState<PriceUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tab, setTab] = useState("rates");
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // New rate form
  const [newRate, setNewRate] = useState({
    date: new Date().toISOString().substring(0, 10),
    usd_ars: "", eur_ars: "", brl_ars: "", source: "manual", notes: "",
  });

  // Bulk update form
  const [bulkForm, setBulkForm] = useState({
    name: "", rate_before: "", rate_after: "", margin_type: "fixed_pct", margin_value: "0",
    apply_to: "all", category: "",
  });

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [ratesData, updatesData] = await Promise.all([
      supabase.from("exchange_rates").select("*").eq("org_id", orgId).order("date", { ascending: false }).limit(60),
      supabase.from("currency_price_updates").select("*").eq("org_id", orgId).order("applied_at", { ascending: false }).limit(20),
    ]);
    setRates(ratesData.data || []);
    setUpdates((updatesData.data || []) as PriceUpdate[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function fetchLiveRates() {
    setFetching(true);
    try {
      // Using exchangerate-api.com free tier (no key needed for some endpoints)
      // Fallback: bluelytics.com.ar for Argentina blue rate
      const [officialRes, blueRes] = await Promise.allSettled([
        fetch("https://api.exchangerate-api.com/v4/latest/USD"),
        fetch("https://api.bluelytics.com.ar/v2/latest"),
      ]);

      let usd_ars = 0, eur_ars = 0, brl_ars = 0;
      let source = "api";

      if (officialRes.status === "fulfilled") {
        const data = await officialRes.value.json();
        if (data.rates) {
          usd_ars = data.rates.ARS || 0;
          eur_ars = usd_ars / (data.rates.EUR || 1);
          brl_ars = usd_ars / (data.rates.BRL || 1) * usd_ars;
        }
      }

      if (blueRes.status === "fulfilled") {
        const blue = await blueRes.value.json();
        if (blue.blue?.value_sell) {
          usd_ars = blue.blue.value_sell;
          source = "dolar_blue";
        }
      }

      if (usd_ars > 0) {
        setNewRate(p => ({
          ...p, usd_ars: String(usd_ars.toFixed(2)),
          eur_ars: String(eur_ars.toFixed(2)), brl_ars: String(brl_ars.toFixed(2)),
          source,
        }));
        setAddOpen(true);
        toast.success(`Cotización obtenida: $${usd_ars.toFixed(2)} ARS/USD`);
      } else {
        toast.error("No se pudo obtener la cotización. Ingresala manualmente.");
        setAddOpen(true);
      }
    } catch {
      toast.error("Error al consultar cotización");
      setAddOpen(true);
    }
    setFetching(false);
  }

  async function saveRate() {
    if (!newRate.usd_ars) { toast.error("Tipo USD→ARS requerido"); return; }
    const { error } = await supabase.from("exchange_rates").upsert({
      org_id: orgId, date: newRate.date, base_currency: "USD",
      usd_ars: Number(newRate.usd_ars), eur_ars: Number(newRate.eur_ars),
      brl_ars: Number(newRate.brl_ars), source: newRate.source,
      notes: newRate.notes || null,
    }, { onConflict: "org_id,date,base_currency,source" });
    if (error) { toast.error(error.message); return; }
    toast.success("Cotización guardada");
    setAddOpen(false);
    loadData();
  }

  async function applyBulkUpdate() {
    const before = Number(bulkForm.rate_before);
    const after = Number(bulkForm.rate_after);
    if (!bulkForm.name.trim() || !before || !after) {
      toast.error("Nombre y cotizaciones son requeridos"); return;
    }
    const pctChange = ((after - before) / before) * 100;
    // Calculate multiplier: if rate went up 20%, increase prices by 20% (or custom margin)
    const multiplier = bulkForm.margin_type === "fixed_pct"
      ? 1 + Number(bulkForm.margin_value) / 100
      : after / before;

    // Update products
    let query = supabase.from("products").select("id, sale_price_ars").eq("org_id", orgId);
    if (bulkForm.apply_to === "category" && bulkForm.category) {
      query = query.eq("category", bulkForm.category);
    }
    const { data: prods } = await query;
    if (!prods || prods.length === 0) { toast.error("Sin productos para actualizar"); return; }

    // Batch update prices
    const updates = prods.map(p => ({ id: p.id, sale_price_ars: Math.ceil((Number(p.sale_price_ars) || 0) * multiplier) }));
    let count = 0;
    for (const u of updates) {
      const { error } = await supabase.from("products").update({ sale_price_ars: u.sale_price_ars }).eq("id", u.id);
      if (!error) count++;
    }

    // Log the update
    await supabase.from("currency_price_updates").insert({
      org_id: orgId, name: bulkForm.name.trim(),
      rate_before: before, rate_after: after,
      products_updated: count, margin_type: bulkForm.margin_type,
      margin_value: Number(bulkForm.margin_value),
    });

    toast.success(`Actualización aplicada: ${count} productos actualizados (+${pctChange.toFixed(1)}%)`);
    setBulkOpen(false);
    loadData();
  }

  const latest = rates[0];
  const previous = rates[1];
  const usdChange = latest && previous ? ((latest.usd_ars - previous.usd_ars) / previous.usd_ars) * 100 : 0;

  // Mini sparkline data
  const sparkData = rates.slice(0, 14).reverse();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-primary" /> Historial de cotización & actualización de precios</p>
          <p className="text-xs text-muted-foreground mt-0.5">Registrá cotizaciones y actualizá precios masivamente con el dólar.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchLiveRates} disabled={fetching}>
            <Zap className="w-4 h-4 mr-1" />
            {fetching ? "Consultando..." : "Cotización en vivo"}
          </Button>
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Manual
          </Button>
          <Button onClick={() => setBulkOpen(true)} disabled={rates.length === 0}>
            <Package className="w-4 h-4 mr-1" /> Actualizar precios
          </Button>
        </div>
      </div>

      {/* Live rate cards */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "USD → ARS", value: fmtRate(latest.usd_ars), change: usdChange, currency: "🇺🇸" },
            { label: "EUR → ARS", value: latest.eur_ars > 0 ? fmtRate(latest.eur_ars) : "—", change: null, currency: "🇪🇺" },
            { label: "BRL → ARS", value: latest.brl_ars > 0 ? fmtRate(latest.brl_ars) : "—", change: null, currency: "🇧🇷" },
            { label: "Fuente", value: SOURCE_LABELS[latest.source], change: null, currency: "📅", sub: fmtDate(latest.date) },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-border/50 bg-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <span>{k.currency}</span>
                <span className="text-xs text-muted-foreground">{k.label}</span>
              </div>
              <p className="text-xl font-bold">{k.value}</p>
              {k.change !== null && (
                <p className={`text-xs flex items-center gap-1 mt-0.5 ${k.change >= 0 ? "text-destructive" : "text-emerald-400"}`}>
                  {k.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {Math.abs(k.change).toFixed(2)}% vs anterior
                </p>
              )}
              {k.sub && <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Sparkline */}
      {sparkData.length > 1 && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <p className="text-sm font-medium mb-3">Historial USD/ARS (últimos {sparkData.length} registros)</p>
          <div className="flex items-end gap-1 h-16">
            {sparkData.map((r, i) => {
              const min = Math.min(...sparkData.map(x => x.usd_ars));
              const max = Math.max(...sparkData.map(x => x.usd_ars));
              const range = max - min || 1;
              const h = ((r.usd_ars - min) / range) * 52 + 12;
              const isLast = i === sparkData.length - 1;
              return (
                <div key={r.id} className="flex-1 flex flex-col items-center gap-1 relative group">
                  <div
                    className={`w-full rounded-t-sm transition-all ${isLast ? "bg-primary" : "bg-primary/40 group-hover:bg-primary/60"}`}
                    style={{ height: h }}
                  />
                  <span className="text-[9px] text-muted-foreground/60 hidden group-hover:block absolute -bottom-4 whitespace-nowrap">
                    {fmtRate(r.usd_ars)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{fmtDate(sparkData[0].date)}</span>
            <span>{fmtDate(sparkData[sparkData.length - 1].date)}</span>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rates">Historial de cotizaciones ({rates.length})</TabsTrigger>
          <TabsTrigger value="updates">Actualizaciones de precios ({updates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="rates" className="pt-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="rounded-xl border border-border/50 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/50 bg-muted/20">
                  <tr className="text-muted-foreground text-xs">
                    <th className="text-left px-3 py-2.5">Fecha</th>
                    <th className="text-right px-3 py-2.5">USD → ARS</th>
                    <th className="text-right px-3 py-2.5 hidden md:table-cell">EUR → ARS</th>
                    <th className="text-right px-3 py-2.5 hidden md:table-cell">Var. %</th>
                    <th className="text-left px-3 py-2.5">Fuente</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r, i) => {
                    const prev = rates[i + 1];
                    const chg = prev ? ((r.usd_ars - prev.usd_ars) / prev.usd_ars) * 100 : null;
                    return (
                      <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="px-3 py-2">{fmtDate(r.date)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{fmtRate(r.usd_ars)}</td>
                        <td className="px-3 py-2 text-right font-mono hidden md:table-cell">{r.eur_ars > 0 ? fmtRate(r.eur_ars) : "—"}</td>
                        <td className="px-3 py-2 text-right hidden md:table-cell">
                          {chg !== null && (
                            <span className={`text-xs font-medium flex items-center justify-end gap-0.5 ${chg > 0 ? "text-destructive" : chg < 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                              {chg > 0 ? "▲" : chg < 0 ? "▼" : "→"} {Math.abs(chg).toFixed(2)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{SOURCE_LABELS[r.source]}</td>
                      </tr>
                    );
                  })}
                  {rates.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Sin cotizaciones registradas.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="updates" className="pt-2">
          <div className="space-y-2 pb-12">
            {updates.map(u => (
              <div key={u.id} className="rounded-xl border border-border/50 bg-card p-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtRate(u.rate_before)} → {fmtRate(u.rate_after)} ·{" "}
                    <span className={u.pct_change >= 0 ? "text-destructive" : "text-emerald-400"}>
                      {u.pct_change >= 0 ? "+" : ""}{u.pct_change.toFixed(2)}%
                    </span>
                    {" "}· {u.products_updated} productos
                  </p>
                </div>
                <p className="text-xs text-muted-foreground shrink-0">{fmtDate(u.applied_at)}</p>
              </div>
            ))}
            {updates.length === 0 && (
              <p className="text-center py-8 text-muted-foreground text-sm">Sin actualizaciones masivas aplicadas.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add rate dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar cotización</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fecha</Label>
                <Input type="date" value={newRate.date} onChange={e => setNewRate(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div><Label>Fuente</Label>
                <Select value={newRate.source} onValueChange={v => setNewRate(p => ({ ...p, source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>USD → ARS *</Label>
                <Input type="number" min="0" step="0.01" value={newRate.usd_ars}
                  onChange={e => setNewRate(p => ({ ...p, usd_ars: e.target.value }))} />
              </div>
              <div><Label>EUR → ARS</Label>
                <Input type="number" min="0" step="0.01" value={newRate.eur_ars}
                  onChange={e => setNewRate(p => ({ ...p, eur_ars: e.target.value }))} />
              </div>
              <div><Label>BRL → ARS</Label>
                <Input type="number" min="0" step="0.01" value={newRate.brl_ars}
                  onChange={e => setNewRate(p => ({ ...p, brl_ars: e.target.value }))} />
              </div>
            </div>
            <div><Label>Notas</Label>
              <Input value={newRate.notes} onChange={e => setNewRate(p => ({ ...p, notes: e.target.value }))} placeholder="Blue paralelo, BNA, Banco..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={saveRate}>Guardar cotización</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk price update dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Actualización masiva de precios</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/8 p-3 flex gap-2 text-xs text-yellow-500">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>Esto modificará el precio de tus productos. Se registrará en el historial.</p>
            </div>
            <div><Label>Nombre de la actualización *</Label>
              <Input value={bulkForm.name} onChange={e => setBulkForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Suba dólar junio 2026..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cotización anterior</Label>
                <Input type="number" min="0" value={bulkForm.rate_before}
                  onChange={e => setBulkForm(p => ({ ...p, rate_before: e.target.value }))}
                  placeholder={latest ? String(rates[1]?.usd_ars || "") : ""} />
              </div>
              <div><Label>Cotización nueva</Label>
                <Input type="number" min="0" value={bulkForm.rate_after}
                  onChange={e => setBulkForm(p => ({ ...p, rate_after: e.target.value }))}
                  placeholder={latest ? String(latest.usd_ars) : ""} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Método</Label>
                <Select value={bulkForm.margin_type} onValueChange={v => setBulkForm(p => ({ ...p, margin_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_pct">% fijo adicional</SelectItem>
                    <SelectItem value="keep_margin">Seguir cotización</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {bulkForm.margin_type === "fixed_pct" && (
                <div><Label>% adicional</Label>
                  <Input type="number" min="0" value={bulkForm.margin_value}
                    onChange={e => setBulkForm(p => ({ ...p, margin_value: e.target.value }))}
                    placeholder="0 = solo cotización" />
                </div>
              )}
            </div>
            {bulkForm.rate_before && bulkForm.rate_after && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p>Variación: <strong className="text-destructive">
                  +{(((Number(bulkForm.rate_after) - Number(bulkForm.rate_before)) / Number(bulkForm.rate_before)) * 100 + Number(bulkForm.margin_value)).toFixed(1)}%
                </strong> en precios</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancelar</Button>
            <Button onClick={applyBulkUpdate} className="bg-destructive hover:bg-destructive/90">Aplicar actualización</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
