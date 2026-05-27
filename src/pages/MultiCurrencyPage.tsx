import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign, TrendingUp, TrendingDown, RefreshCw, Plus, ArrowRight,
  Clock, AlertTriangle, BarChart3, Settings, Globe, Zap
} from "lucide-react";

const CURRENCIES_INFO: Record<string, { name: string; symbol: string; flag: string }> = {
  ARS: { name: "Peso Argentino",   symbol: "$",   flag: "🇦🇷" },
  USD: { name: "Dólar",            symbol: "US$", flag: "🇺🇸" },
  EUR: { name: "Euro",             symbol: "€",   flag: "🇪🇺" },
  BRL: { name: "Real Brasileño",   symbol: "R$",  flag: "🇧🇷" },
  UYU: { name: "Peso Uruguayo",    symbol: "$U",  flag: "🇺🇾" },
  CLP: { name: "Peso Chileno",     symbol: "$",   flag: "🇨🇱" },
};

const RATE_TYPES = [
  { id: "oficial", label: "Oficial BCRA", color: "text-blue-400" },
  { id: "blue",    label: "Blue",         color: "text-purple-400" },
  { id: "mep",     label: "MEP",          color: "text-emerald-400" },
  { id: "ccl",     label: "CCL",          color: "text-yellow-400" },
];

// Mock current rates USD/ARS
const MOCK_RATES = {
  oficial: { rate: 938.50,  change: 2.15,  updated: "hace 30 min" },
  blue:    { rate: 1285.00, change: -5.00, updated: "hace 5 min" },
  mep:     { rate: 1278.00, change: 1.50,  updated: "hace 15 min" },
  ccl:     { rate: 1290.00, change: 3.00,  updated: "hace 10 min" },
};

// Sparkline data points (last 7 days)
const SPARKLINE_DATA: Record<string, number[]> = {
  oficial: [920, 923, 927, 930, 934, 936, 938.5],
  blue:    [1260, 1270, 1275, 1280, 1290, 1290, 1285],
  mep:     [1252, 1260, 1265, 1270, 1278, 1276, 1278],
  ccl:     [1265, 1272, 1280, 1284, 1288, 1287, 1290],
};

// Mock FX exposure
const MOCK_EXPOSURE = [
  { currency: "USD", receivables: 15000, payables: 8000, spot: 1285 },
  { currency: "EUR", receivables: 5000,  payables: 2000, spot: 1401 },
  { currency: "BRL", receivables: 22000, payables: 5000, spot: 236  },
];

// Mock recent transactions
const MOCK_TRANSACTIONS = [
  { id: "t1", type: "sale",     entity: "Venta #4521", from: "USD", to: "ARS", amount_fc: 500,  amount_bc: 642500,  rate: 1285, rate_type: "blue", date: "2026-05-27" },
  { id: "t2", type: "purchase", entity: "Compra #891", from: "ARS", to: "USD", amount_fc: 938500, amount_bc: 1000, rate: 938.5, rate_type: "oficial", date: "2026-05-26" },
  { id: "t3", type: "expense",  entity: "Servicio Cloud", from: "USD", to: "ARS", amount_fc: 120, amount_bc: 154200, rate: 1285, rate_type: "blue", date: "2026-05-26" },
];

function MiniSparkline({ data, color = "#f59e0b" }: { data: number[]; color?: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80, h = 24;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function RateCard({ type, data, sparkData, selected, onClick }: any) {
  const up = data.change >= 0;
  return (
    <button onClick={onClick}
      className={`bg-card border rounded-xl p-4 text-left transition-all w-full ${selected ? "border-primary/60 bg-primary/5" : "border-border/40 hover:border-primary/30"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-semibold ${RATE_TYPES.find(r => r.id === type)?.color}`}>{RATE_TYPES.find(r => r.id === type)?.label}</span>
        <div className="flex items-center gap-1 text-xs">
          {up ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
          <span className={up ? "text-emerald-400" : "text-red-400"}>{up ? "+" : ""}{data.change}</span>
        </div>
      </div>
      <p className="text-2xl font-bold font-display">${data.rate.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{data.updated}</span>
        <MiniSparkline data={sparkData} color={up ? "#10b981" : "#ef4444"} />
      </div>
    </button>
  );
}

export default function MultiCurrencyPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"rates" | "converter" | "exposure" | "transactions">("rates");
  const [selectedRate, setSelectedRate] = useState("blue");
  const [convFrom, setConvFrom] = useState("USD");
  const [convTo, setConvTo] = useState("ARS");
  const [convAmount, setConvAmount] = useState("100");
  const [showAddRate, setShowAddRate] = useState(false);
  const [newRate, setNewRate] = useState({ currency_from: "USD", currency_to: "ARS", rate: "", rate_type: "custom" });

  // Conversion result
  const selectedRateData = MOCK_RATES[selectedRate as keyof typeof MOCK_RATES];
  const convResult = convFrom === "USD" && convTo === "ARS"
    ? Number(convAmount) * selectedRateData.rate
    : convFrom === "ARS" && convTo === "USD"
    ? Number(convAmount) / selectedRateData.rate
    : Number(convAmount);

  const addRate = async () => {
    if (!orgId || !newRate.rate) return;
    const { error } = await supabase.from("exchange_rates").insert({
      org_id: orgId, currency_from: newRate.currency_from,
      currency_to: newRate.currency_to, rate: Number(newRate.rate),
      rate_type: newRate.rate_type, source: "manual",
    });
    if (error) { toast.error("Error al guardar tipo de cambio"); return; }
    toast.success("Tipo de cambio guardado");
    setShowAddRate(false);
    setNewRate({ currency_from: "USD", currency_to: "ARS", rate: "", rate_type: "custom" });
  };

  const TABS = [
    { id: "rates",        label: "Tipos de Cambio" },
    { id: "converter",    label: "Conversor" },
    { id: "exposure",     label: "Exposición FX" },
    { id: "transactions", label: "Transacciones" },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Globe className="w-4 h-4 text-blue-400" />
            </div>
            <h1 className="text-2xl font-display font-bold">Multi-Divisa & FX</h1>
          </div>
          <p className="text-sm text-muted-foreground">Tipos de cambio en tiempo real, conversor y exposición FX</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => toast.info("Tasas actualizadas")}>
            <RefreshCw className="w-3 h-3" />Actualizar tasas
          </Button>
          <Button size="sm" onClick={() => setShowAddRate(true)} className="gap-1.5 gradient-gold text-primary-foreground">
            <Plus className="w-3.5 h-3.5" />Tasa manual
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Rates tab ─── */}
      {tab === "rates" && (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">USD / ARS — Cotizaciones</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {RATE_TYPES.map(rt => (
                <RateCard key={rt.id} type={rt.id} data={MOCK_RATES[rt.id as keyof typeof MOCK_RATES]}
                  sparkData={SPARKLINE_DATA[rt.id]} selected={selectedRate === rt.id}
                  onClick={() => setSelectedRate(rt.id)} />
              ))}
            </div>
          </div>

          {/* Other pairs */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Otras divisas vs ARS</h3>
            <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Divisa", "Nombre", "Tipo Cambio", "Variación", "Trend"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { code: "EUR", rate: 1021.50, change: 5.20,  spark: [990, 998, 1005, 1010, 1015, 1019, 1021.5] },
                    { code: "BRL", rate: 163.40,  change: -1.10, spark: [165, 164.5, 164, 163.8, 163.5, 163.6, 163.4] },
                    { code: "UYU", rate: 23.80,   change: 0.15,  spark: [23.5, 23.6, 23.65, 23.7, 23.75, 23.78, 23.8] },
                    { code: "CLP", rate: 0.97,    change: 0.02,  spark: [0.94, 0.95, 0.95, 0.96, 0.96, 0.97, 0.97] },
                  ].map(r => {
                    const c = CURRENCIES_INFO[r.code];
                    const up = r.change >= 0;
                    return (
                      <tr key={r.code} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><span>{c.flag}</span><span className="font-mono font-bold text-xs">{r.code}</span></div></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{c.name}</td>
                        <td className="px-4 py-3 font-semibold text-sm">${r.rate.toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-xs ${up ? "text-emerald-400" : "text-red-400"}`}>
                            {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {up ? "+" : ""}{r.change}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <MiniSparkline data={r.spark} color={up ? "#10b981" : "#ef4444"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Converter tab ─── */}
      {tab === "converter" && (
        <div className="max-w-md space-y-5">
          <div className="bg-card border border-border/40 rounded-xl p-6 space-y-5">
            <h3 className="font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />Conversor de Divisas</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">De</label>
                <div className="flex gap-2">
                  <select value={convFrom} onChange={e => setConvFrom(e.target.value)}
                    className="w-28 h-10 rounded-lg border border-input bg-background px-3 text-sm font-semibold">
                    {Object.keys(CURRENCIES_INFO).map(c => <option key={c}>{c}</option>)}
                  </select>
                  <Input type="number" value={convAmount} onChange={e => setConvAmount(e.target.value)} className="h-10 flex-1 text-lg font-bold" placeholder="0" />
                </div>
              </div>

              <div className="flex items-center justify-center">
                <button onClick={() => { setConvFrom(convTo); setConvTo(convFrom); }}
                  className="w-9 h-9 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center hover:bg-primary/20 transition-colors">
                  <ArrowRight className="w-4 h-4 text-primary rotate-90" />
                </button>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">A</label>
                <div className="flex gap-2">
                  <select value={convTo} onChange={e => setConvTo(e.target.value)}
                    className="w-28 h-10 rounded-lg border border-input bg-background px-3 text-sm font-semibold">
                    {Object.keys(CURRENCIES_INFO).map(c => <option key={c}>{c}</option>)}
                  </select>
                  <div className="flex-1 h-10 rounded-lg border border-primary/30 bg-primary/5 flex items-center px-3">
                    <span className="text-lg font-bold text-primary">{convResult.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Cotización a usar</label>
              <div className="flex gap-2">
                {RATE_TYPES.map(rt => (
                  <button key={rt.id} onClick={() => setSelectedRate(rt.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${selectedRate === rt.id ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground"}`}>
                    {rt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Tasa aplicada</span><span className="font-mono">{selectedRateData.rate.toLocaleString("es-AR")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><span className={RATE_TYPES.find(r => r.id === selectedRate)?.color}>{RATE_TYPES.find(r => r.id === selectedRate)?.label}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Actualizado</span><span>{selectedRateData.updated}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Exposure tab ─── */}
      {tab === "exposure" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40">
              <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Exposición FX Neta</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Cuentas por cobrar vs pagar en moneda extranjera</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Divisa", "Por Cobrar (ME)", "Por Pagar (ME)", "Neto (ME)", "Spot", "Neto (ARS)", "Riesgo"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MOCK_EXPOSURE.map(e => {
                    const net = e.receivables - e.payables;
                    const netARS = net * e.spot;
                    const info = CURRENCIES_INFO[e.currency];
                    return (
                      <tr key={e.currency} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><span>{info.flag}</span><span className="font-mono font-bold text-xs">{e.currency}</span></div></td>
                        <td className="px-4 py-3 text-xs text-emerald-400">{info.symbol}{e.receivables.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-red-400">{info.symbol}{e.payables.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs font-semibold">{info.symbol}{net.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs font-mono">{e.spot.toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3 text-sm font-bold">${netARS.toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-xs ${Math.abs(netARS) > 10000000 ? "bg-red-500/15 text-red-400 border-0" : Math.abs(netARS) > 5000000 ? "bg-yellow-500/15 text-yellow-400 border-0" : "bg-emerald-500/15 text-emerald-400 border-0"}`}>
                            {Math.abs(netARS) > 10000000 ? "Alto" : Math.abs(netARS) > 5000000 ? "Medio" : "Bajo"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Transactions tab ─── */}
      {tab === "transactions" && (
        <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["Tipo", "Entidad", "Divisa", "Monto ME", "Tipo Cambio", "Monto ARS", "Fecha"].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MOCK_TRANSACTIONS.map(t => (
                  <tr key={t.id} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="px-4 py-3"><Badge className="text-xs bg-muted text-muted-foreground border-0">{t.type}</Badge></td>
                    <td className="px-4 py-3 text-xs font-medium">{t.entity}</td>
                    <td className="px-4 py-3 text-xs font-mono">{t.from} → {t.to}</td>
                    <td className="px-4 py-3 text-xs">{t.from === "USD" ? "US$" : "$"}{t.amount_fc.toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs">
                      <div>
                        <span className="font-mono">{t.rate.toLocaleString("es-AR")}</span>
                        <Badge className={`ml-1.5 text-[9px] ${RATE_TYPES.find(r => r.id === t.rate_type)?.color} bg-muted border-0`}>{t.rate_type}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">${t.amount_bc.toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Add rate dialog ─── */}
      {showAddRate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold">Agregar Tipo de Cambio</h3>
              <button onClick={() => setShowAddRate(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">De</label>
                  <select value={newRate.currency_from} onChange={e => setNewRate(p => ({ ...p, currency_from: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {Object.keys(CURRENCIES_INFO).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">A</label>
                  <select value={newRate.currency_to} onChange={e => setNewRate(p => ({ ...p, currency_to: e.target.value }))}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                    {Object.keys(CURRENCIES_INFO).map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de cotización</label>
                <select value={newRate.rate_type} onChange={e => setNewRate(p => ({ ...p, rate_type: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {RATE_TYPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  <option value="custom">Personalizado</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Tasa</label>
                <Input type="number" value={newRate.rate} onChange={e => setNewRate(p => ({ ...p, rate: e.target.value }))} placeholder="1285.00" className="h-9 font-mono" step="0.01" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowAddRate(false)}>Cancelar</Button>
              <Button onClick={addRate} disabled={!newRate.rate} className="gradient-gold text-primary-foreground">Guardar Tasa</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
