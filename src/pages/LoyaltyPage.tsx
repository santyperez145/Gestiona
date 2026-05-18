import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Star, Gift, Plus, Minus, Loader2, Search, Settings2, Trophy, ShoppingBag, Sliders, FileSpreadsheet, Tag, AlertCircle } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";

// ─── Tier system ──────────────────────────────────────────────────────────────

const TIERS = [
  { name: "Bronce", min: 0, max: 99, color: "text-orange-400", bg: "bg-orange-500/15", barColor: "bg-orange-400" },
  { name: "Plata", min: 100, max: 499, color: "text-slate-300", bg: "bg-slate-500/15", barColor: "bg-slate-400" },
  { name: "Oro", min: 500, max: 999, color: "text-yellow-400", bg: "bg-yellow-500/15", barColor: "bg-yellow-400" },
  { name: "Platino", min: 1000, max: Infinity, color: "text-purple-400", bg: "bg-purple-500/15", barColor: "bg-purple-400" },
];

function getTier(pts: number) {
  return TIERS.findLast(t => pts >= t.min) ?? TIERS[0];
}

function getNextTier(pts: number) {
  return TIERS.find(t => pts < t.min) ?? null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoyaltyEntry {
  id: string;
  customer_name: string;
  delta: number;
  reason: string | null;
  created_at: string;
}

interface CustomerBalance {
  customer_name: string;
  balance: number;
  totalEarned: number;
  totalRedeemed: number;
  lastActivity: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoyaltyPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [entries, setEntries] = useState<LoyaltyEntry[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState(1200);

  // Settings form
  const [enabled, setEnabled] = useState(false);
  const [pointsPer1000, setPointsPer1000] = useState("1");
  const [pointValueArs, setPointValueArs] = useState("100");
  const [savingSettings, setSavingSettings] = useState(false);

  // Manual adjustment
  const [adjCustomer, setAdjCustomer] = useState("");
  const [adjDelta, setAdjDelta] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  // Product redemption
  const [redeemProductId, setRedeemProductId] = useState("");
  const [redeemCustomer, setRedeemCustomer] = useState("");
  const [redeemSaving, setRedeemSaving] = useState(false);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const [{ data: pts }, { data: sett }, { data: prods }] = await Promise.all([
        supabase.from("loyalty_points").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("settings").select("loyalty_enabled,loyalty_points_per_1000,loyalty_points_value_ars,exchange_rate").eq("org_id", activeOrg.id).single(),
        supabase.from("products").select("id,name,sale_price_ars,total_cost_usd,cost_usd,stock,image_url").eq("org_id", activeOrg.id).gt("stock", 0).order("name"),
      ]);
      setEntries((pts || []) as LoyaltyEntry[]);
      setProducts(prods || []);
      if (sett) {
        setSettings(sett);
        setEnabled(!!sett.loyalty_enabled);
        setPointsPer1000(String(sett.loyalty_points_per_1000 ?? 1));
        setPointValueArs(String(sett.loyalty_points_value_ars ?? 100));
        if (sett.exchange_rate) setExchangeRate(Number(sett.exchange_rate));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  // Aggregate balances per customer
  const balances = useMemo(() => {
    const map: Record<string, CustomerBalance> = {};
    entries.forEach(e => {
      if (!map[e.customer_name]) {
        map[e.customer_name] = { customer_name: e.customer_name, balance: 0, totalEarned: 0, totalRedeemed: 0, lastActivity: e.created_at };
      }
      const c = map[e.customer_name];
      c.balance += e.delta;
      if (e.delta > 0) c.totalEarned += e.delta;
      else c.totalRedeemed += Math.abs(e.delta);
      if (e.created_at > c.lastActivity) c.lastActivity = e.created_at;
    });
    return Object.values(map).sort((a, b) => b.balance - a.balance);
  }, [entries]);

  const filtered = useMemo(() => {
    if (!search) return balances;
    return balances.filter(b => b.customer_name.toLowerCase().includes(search.toLowerCase()));
  }, [balances, search]);

  const totalPointsOutstanding = balances.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const totalValueOutstanding = totalPointsOutstanding * Number(pointValueArs || 100);

  const handleSaveSettings = async () => {
    if (!activeOrg) return;
    setSavingSettings(true);
    try {
      await supabase.from("settings").update({
        loyalty_enabled: enabled,
        loyalty_points_per_1000: Number(pointsPer1000) || 1,
        loyalty_points_value_ars: Number(pointValueArs) || 100,
      }).eq("org_id", activeOrg.id);
      toast.success("Configuración guardada");
      await load();
    } catch { toast.error("Error al guardar"); }
    finally { setSavingSettings(false); }
  };

  const handleManualAdjust = async () => {
    if (!activeOrg || !user || !adjCustomer.trim() || !adjDelta) { toast.error("Completá todos los campos"); return; }
    const delta = Number(adjDelta);
    if (isNaN(delta) || delta === 0) { toast.error("Ingresá un número distinto de 0"); return; }
    setAdjusting(true);
    try {
      await supabase.from("loyalty_points").insert({
        org_id: activeOrg.id,
        customer_name: adjCustomer.trim(),
        delta,
        reason: adjReason.trim() || "manual",
      });
      toast.success(`${delta > 0 ? "+" : ""}${delta} puntos a ${adjCustomer}`);
      setAdjCustomer(""); setAdjDelta(""); setAdjReason("");
      await load();
    } catch { toast.error("Error al ajustar puntos"); }
    finally { setAdjusting(false); }
  };

  const handleRedeem = async () => {
    if (!activeOrg || !user || !redeemProductId || !redeemCustomer.trim()) {
      toast.error("Seleccioná un producto y un cliente");
      return;
    }
    const prod = products.find(p => p.id === redeemProductId);
    if (!prod) return;
    const costARS = Number(prod.total_cost_usd || prod.cost_usd || 0) * exchangeRate;
    if (costARS <= 0) { toast.error("Este producto no tiene precio de costo registrado"); return; }
    const ptVal = Number(pointValueArs) || 100;
    const ptsNeeded = Math.ceil(costARS / ptVal);
    const customerBalance = balances.find(b => b.customer_name.toLowerCase() === redeemCustomer.trim().toLowerCase());
    if (customerBalance && customerBalance.balance < ptsNeeded) {
      toast.error(`El cliente tiene ${customerBalance.balance} pts pero necesita ${ptsNeeded} pts`);
      return;
    }
    setRedeemSaving(true);
    try {
      await supabase.from("loyalty_points").insert({
        org_id: activeOrg.id,
        customer_name: redeemCustomer.trim(),
        delta: -ptsNeeded,
        reason: "redeem",
      });
      toast.success(`Canje registrado: −${ptsNeeded} puntos a ${redeemCustomer.trim()} por "${prod.name}"`);
      setRedeemProductId("");
      setRedeemCustomer("");
      await load();
    } catch { toast.error("Error al registrar canje"); }
    finally { setRedeemSaving(false); }
  };

  const selectedHistory = useMemo(() => {
    if (!selected) return [];
    return entries.filter(e => e.customer_name === selected);
  }, [entries, selected]);

  const selectedBalance = balances.find(b => b.customer_name === selected);

  const ptVal = Number(pointValueArs) || 100;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <PageHeader
        icon={Star}
        title="Programa de Fidelidad"
        description={`Puntos por compra · ${totalPointsOutstanding.toLocaleString("es-AR")} puntos activos`}
        badge={
          enabled
            ? { label: "Activo ✓", variant: "success" }
            : { label: "Inactivo", variant: "default" }
        }
      />

      {/* Settings */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2 text-sm"><Settings2 className="w-4 h-4" />Configuración</h2>
          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="loyalty-toggle">Activo</Label>
            <Switch id="loyalty-toggle" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Puntos por cada $1.000 de compra</Label>
            <Input type="number" value={pointsPer1000} onChange={e => setPointsPer1000(e.target.value)} className="bg-muted" min={1} />
            <p className="text-[10px] text-muted-foreground">Ej: 1 punto por cada $1.000 = $100k de compra = 100 puntos</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Valor de cada punto en ARS (al canjear)</Label>
            <Input type="number" value={pointValueArs} onChange={e => setPointValueArs(e.target.value)} className="bg-muted" min={1} />
            <p className="text-[10px] text-muted-foreground">Ej: 1 punto = ${pointValueArs} de descuento</p>
          </div>
        </div>
        {Number(pointsPer1000) > 0 && Number(pointValueArs) > 0 && (
          <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground">
            Ejemplo: cliente que gasta {formatARS(100_000)} acumula {Math.floor(100_000 / 1_000) * Number(pointsPer1000)} puntos → descuento de {formatARS(Math.floor(100_000 / 1_000) * Number(pointsPer1000) * Number(pointValueArs))}
          </div>
        )}
        {enabled && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
            <Star className="w-3.5 h-3.5 shrink-0" />
            Los puntos se otorgan <strong>automáticamente</strong> al registrar cada venta — no hace falta ingresarlos a mano.
          </div>
        )}
        <Button className="gradient-gold text-primary-foreground" onClick={handleSaveSettings} disabled={savingSettings}>
          {savingSettings && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
          Guardar configuración
        </Button>
      </div>

      {/* Manual adjustment */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Gift className="w-4 h-4" />Ajuste manual de puntos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Cliente</Label>
            <Input value={adjCustomer} onChange={e => setAdjCustomer(e.target.value)} placeholder="Nombre del cliente" className="bg-muted" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Puntos (positivo = sumar, negativo = restar)</Label>
            <Input type="number" value={adjDelta} onChange={e => setAdjDelta(e.target.value)} placeholder="Ej: +50 o -20" className="bg-muted" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Motivo</Label>
            <Input value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="Ej: canje, regalo, corrección" className="bg-muted" />
          </div>
        </div>
        <Button onClick={handleManualAdjust} disabled={adjusting} variant="outline" className="gap-1.5">
          {adjusting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Aplicar ajuste
        </Button>
      </div>

      {/* Product Redemption — cost-price based */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-yellow-400" />
          <h2 className="font-semibold text-sm">Canjear producto por puntos</h2>
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">puntos calculados al precio de costo</span>
        </div>
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>Los puntos descontados se calculan sobre el <strong>precio de costo</strong> del producto (no el precio de venta), para no regalar el margen del negocio.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Producto a canjear</Label>
            <Select value={redeemProductId} onValueChange={setRedeemProductId}>
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder="Seleccionar producto…" />
              </SelectTrigger>
              <SelectContent>
                {products.map(p => {
                  const costARS = Number(p.total_cost_usd || p.cost_usd || 0) * exchangeRate;
                  const ptsNeeded = costARS > 0 ? Math.ceil(costARS / (Number(pointValueArs) || 100)) : null;
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <span>{p.name}</span>
                        {ptsNeeded !== null && (
                          <span className="text-xs text-yellow-400 font-bold ml-1">{ptsNeeded.toLocaleString("es-AR")} pts</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {redeemProductId && (() => {
              const prod = products.find(p => p.id === redeemProductId);
              if (!prod) return null;
              const costARS = Number(prod.total_cost_usd || prod.cost_usd || 0) * exchangeRate;
              const ptVal = Number(pointValueArs) || 100;
              const ptsNeeded = costARS > 0 ? Math.ceil(costARS / ptVal) : 0;
              const ptsSalePrice = Math.ceil(Number(prod.sale_price_ars) / ptVal);
              return (
                <div className="bg-muted/30 rounded-lg px-3 py-2 text-[11px] space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Costo del negocio:</span><span className="font-semibold">{formatARS(costARS)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Precio venta:</span><span className="text-muted-foreground">{formatARS(Number(prod.sale_price_ars))}</span></div>
                  <div className="flex justify-between border-t border-border/40 pt-1 mt-1"><span className="font-medium">Pts a descontar (costo):</span><span className="font-bold text-yellow-400">{ptsNeeded.toLocaleString("es-AR")}</span></div>
                  <div className="flex justify-between text-muted-foreground/70"><span>Si fuera al precio de venta:</span><span>{ptsSalePrice.toLocaleString("es-AR")} pts</span></div>
                  <div className="flex justify-between text-emerald-400"><span>Ahorro para el negocio:</span><span className="font-semibold">{(ptsSalePrice - ptsNeeded).toLocaleString("es-AR")} pts</span></div>
                </div>
              );
            })()}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cliente que canjea</Label>
            <Input value={redeemCustomer} onChange={e => setRedeemCustomer(e.target.value)} placeholder="Nombre del cliente" className="bg-muted" list="redeem-customer-list" />
            <datalist id="redeem-customer-list">
              {balances.map(b => <option key={b.customer_name} value={b.customer_name} />)}
            </datalist>
            {redeemCustomer && (() => {
              const bal = balances.find(b => b.customer_name.toLowerCase() === redeemCustomer.trim().toLowerCase());
              if (!bal) return <p className="text-[10px] text-muted-foreground">Cliente sin historial de puntos aún</p>;
              const prod = products.find(p => p.id === redeemProductId);
              const costARS = prod ? Number(prod.total_cost_usd || prod.cost_usd || 0) * exchangeRate : 0;
              const ptVal = Number(pointValueArs) || 100;
              const ptsNeeded = costARS > 0 ? Math.ceil(costARS / ptVal) : 0;
              const canAfford = bal.balance >= ptsNeeded && ptsNeeded > 0;
              return (
                <div className={`rounded-lg px-3 py-2 text-[11px] ${canAfford ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-muted/30'}`}>
                  <p>Saldo actual: <span className={`font-bold ${canAfford ? 'text-emerald-400' : 'text-yellow-400'}`}>{bal.balance.toLocaleString("es-AR")} pts</span></p>
                  {ptsNeeded > 0 && (
                    <p className={canAfford ? 'text-emerald-300' : 'text-destructive'}>
                      {canAfford ? `✓ Puede canjear · Quedan ${(bal.balance - ptsNeeded).toLocaleString("es-AR")} pts` : `✗ Faltan ${(ptsNeeded - bal.balance).toLocaleString("es-AR")} pts`}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
        <Button onClick={handleRedeem} disabled={redeemSaving || !redeemProductId || !redeemCustomer.trim()} className="gradient-gold text-primary-foreground gap-1.5">
          {redeemSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
          Registrar canje
        </Button>
      </div>

      {/* Leaderboard + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Balances list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <h2 className="font-semibold text-sm">Ranking de clientes</h2>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
              const bom = '﻿';
              const headers = ['Cliente', 'Tier', 'Balance puntos', 'Valor ARS', 'Puntos ganados', 'Puntos canjeados', 'Última actividad'];
              const rows = filtered.map(b => {
                const tier = getTier(b.balance);
                return [
                  b.customer_name,
                  tier.name,
                  b.balance,
                  (b.balance * ptVal).toFixed(2),
                  b.totalEarned,
                  b.totalRedeemed,
                  new Date(b.lastActivity).toLocaleDateString('es-AR'),
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
              });
              const csv = bom + [headers.join(','), ...rows].join('\n');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
              a.download = `fidelidad-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              toast.success('Exportado');
            }}>
              <FileSpreadsheet className="w-3 h-3 mr-1" />CSV
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Buscar cliente…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-muted h-8 text-sm" />
          </div>
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Sin movimientos de puntos aún</p>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {filtered.map((b, idx) => (
                <button
                  key={b.customer_name}
                  onClick={() => setSelected(selected === b.customer_name ? null : b.customer_name)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                    selected === b.customer_name
                      ? "border-primary/60 bg-primary/5"
                      : "border-border bg-card hover:border-primary/30"
                  }`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    idx === 0 ? "bg-yellow-500/20 text-yellow-400" :
                    idx === 1 ? "bg-muted text-muted-foreground" :
                    idx === 2 ? "bg-orange-500/20 text-orange-400" :
                    "bg-muted/50 text-muted-foreground/60"
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{b.customer_name}</p>
                      {(() => { const t = getTier(b.balance); return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${t.bg} ${t.color}`}>{t.name}</span>; })()}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{b.totalEarned} ganados · {b.totalRedeemed} canjeados</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold ${b.balance > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
                      {b.balance.toLocaleString("es-AR")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{formatARS(b.balance * ptVal)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* History detail */}
        <div className="lg:col-span-2">
          {selected && selectedBalance ? (
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{selected}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedBalance.balance.toLocaleString("es-AR")} puntos · {formatARS(selectedBalance.balance * ptVal)} disponibles
                  </p>
                </div>
                {(() => {
                  const t = getTier(selectedBalance.balance);
                  return <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${t.bg} ${t.color}`}>{t.name}</span>;
                })()}
              </div>
              {/* Tier progress */}
              {(() => {
                const next = getNextTier(selectedBalance.balance);
                const current = getTier(selectedBalance.balance);
                if (!next) return <p className="text-xs text-purple-400 font-medium">¡Nivel máximo alcanzado! 🏆</p>;
                const progress = selectedBalance.balance - current.min;
                const range = next.min - current.min;
                const pct = Math.min(100, (progress / range) * 100);
                return (
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Progreso hacia {next.name}</span>
                      <span>{next.min - selectedBalance.balance} pts para subir</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${current.barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {selectedHistory.map(e => (
                  <div key={e.id} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      e.delta > 0 ? "bg-green-500/20" : "bg-red-500/20"
                    }`}>
                      {e.delta > 0 ? <Plus className="w-3.5 h-3.5 text-green-400" /> : <Minus className="w-3.5 h-3.5 text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {e.reason === "sale" && <ShoppingBag className="w-3 h-3 text-muted-foreground shrink-0" />}
                        {(e.reason === "manual" || !e.reason) && <Sliders className="w-3 h-3 text-muted-foreground shrink-0" />}
                        {e.reason === "redeem" && <Gift className="w-3 h-3 text-muted-foreground shrink-0" />}
                        <p className="text-xs font-medium">
                          {e.reason === "sale" ? "Venta automática" : e.reason === "redeem" ? "Canje" : e.reason === "manual" ? "Ajuste manual" : e.reason || "—"}
                        </p>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{new Date(e.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</p>
                    </div>
                    <span className={`text-sm font-bold font-mono ${e.delta > 0 ? "text-green-400" : "text-red-400"}`}>
                      {e.delta > 0 ? "+" : ""}{e.delta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full py-16 text-muted-foreground">
              <div className="text-center">
                <Star className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Seleccioná un cliente para ver su historial</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
