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
import { toast } from "sonner";
import { Star, Gift, Plus, Minus, Loader2, Search, Settings2, Trophy } from "lucide-react";

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

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const [{ data: pts }, { data: sett }] = await Promise.all([
        supabase.from("loyalty_points" as any).select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("settings").select("loyalty_enabled,loyalty_points_per_1000,loyalty_points_value_ars").eq("org_id", activeOrg.id).single(),
      ]);
      setEntries((pts || []) as LoyaltyEntry[]);
      if (sett) {
        setSettings(sett);
        setEnabled(!!sett.loyalty_enabled);
        setPointsPer1000(String(sett.loyalty_points_per_1000 ?? 1));
        setPointValueArs(String(sett.loyalty_points_value_ars ?? 100));
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
      await supabase.from("loyalty_points" as any).insert({
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="w-6 h-6 text-yellow-400" />
            Programa de Fidelidad
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Puntos por compra · {totalPointsOutstanding.toLocaleString("es-AR")} puntos activos · valor estimado {formatARS(totalValueOutstanding)}
          </p>
        </div>
      </div>

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

      {/* Leaderboard + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Balances list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <h2 className="font-semibold text-sm">Ranking de clientes</h2>
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
                    <p className="text-sm font-medium truncate">{b.customer_name}</p>
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
                <Badge className={`text-xs ${selectedBalance.balance > 0 ? "bg-yellow-500/20 text-yellow-400" : "bg-muted text-muted-foreground"}`}>
                  {selectedBalance.balance > 0 ? `${selectedBalance.balance} pts` : "Sin puntos"}
                </Badge>
              </div>

              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {selectedHistory.map(e => (
                  <div key={e.id} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      e.delta > 0 ? "bg-green-500/20" : "bg-red-500/20"
                    }`}>
                      {e.delta > 0 ? <Plus className="w-3.5 h-3.5 text-green-400" /> : <Minus className="w-3.5 h-3.5 text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{e.reason || "—"}</p>
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
