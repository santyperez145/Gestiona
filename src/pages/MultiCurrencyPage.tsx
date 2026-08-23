import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PageHeader from "@/components/shared/PageHeader";
import {
  DollarSign, TrendingUp, TrendingDown, RefreshCw, Plus, ArrowRight,
  Clock, AlertTriangle, BarChart3, Settings, Globe, Zap
} from "lucide-react";
import CurrencyHistoryTab from "@/components/currency/CurrencyHistoryTab";

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

interface RateInfo {
  rate: number;
  change: number;
  updated: string;
}

interface ExposureRow {
  currency: string;
  receivables: number;
  payables: number;
  spot: number;
}

interface MCTransaction {
  id: string;
  entity_type: string;
  base_currency: string;
  transaction_currency: string;
  base_amount: number;
  transaction_amount: number;
  exchange_rate: number;
  rate_type: string;
  created_at: string;
}

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
  usePageTitle("Multi-Divisa & FX");
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"rates" | "converter" | "exposure" | "transactions" | "history">("rates");
  const [selectedRate, setSelectedRate] = useState("blue");
  const [convFrom, setConvFrom] = useState("USD");
  const [convTo, setConvTo] = useState("ARS");
  const [convAmount, setConvAmount] = useState("100");
  const [showAddRate, setShowAddRate] = useState(false);
  const [newRate, setNewRate] = useState({ currency_from: "USD", currency_to: "ARS", rate: "", rate_type: "custom" });
  const [rates, setRates] = useState<Record<string, RateInfo>>({});
  const [sparklineData, setSparklineData] = useState<Record<string, number[]>>({});
  const [exposure, setExposure] = useState<ExposureRow[]>([]);
  const [transactions, setTransactions] = useState<MCTransaction[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [otherRates, setOtherRates] = useState<Array<{ code: string; rate: number; change: number; spark: number[] }>>([]);

  useEffect(() => {
    if (!orgId) return;
    setLoadingData(true);

    // Fetch latest exchange rates for USD/ARS per rate_type
    supabase
      .from("fx_rates")
      .select("rate_type, rate, valid_from, currency_from, currency_to")
      .eq("currency_to", "ARS")
      .or(`org_id.eq.${orgId},org_id.is.null`)
      .order("valid_from", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!data) return;
        const usdRows = data.filter(r => r.currency_from === "USD");
        const byType: Record<string, RateInfo> = {};
        const sparkMap: Record<string, number[]> = {};
        for (const rt of RATE_TYPES) {
          const rows = usdRows.filter(r => r.rate_type === rt.id);
          if (rows.length > 0) {
            const latest = rows[0];
            const prev = rows[1];
            const change = prev ? parseFloat((Number(latest.rate) - Number(prev.rate)).toFixed(2)) : 0;
            const now = new Date();
            const validFrom = new Date(latest.valid_from);
            const diffMs = now.getTime() - validFrom.getTime();
            const diffMin = Math.round(diffMs / 60000);
            const updated = diffMin < 60 ? `hace ${diffMin} min` : `hace ${Math.round(diffMin / 60)}h`;
            byType[rt.id] = { rate: Number(latest.rate), change, updated };
            sparkMap[rt.id] = rows.slice(0, 7).map(r => Number(r.rate)).reverse();
          }
        }
        setRates(byType);
        setSparklineData(sparkMap);

        // Build "other currencies vs ARS" table (non-USD)
        const otherCodes = Object.keys(CURRENCIES_INFO).filter(c => c !== "USD" && c !== "ARS");
        const otherArr = otherCodes.map(code => {
          const rows = data.filter(r => r.currency_from === code);
          if (rows.length === 0) return null;
          const latest = rows[0];
          const prev = rows[1];
          const change = prev ? parseFloat((Number(latest.rate) - Number(prev.rate)).toFixed(2)) : 0;
          const spark = rows.slice(0, 7).map(r => Number(r.rate)).reverse();
          return { code, rate: Number(latest.rate), change, spark };
        }).filter((r): r is { code: string; rate: number; change: number; spark: number[] } => r !== null);
        setOtherRates(otherArr);
      });

    // Fetch FX exposure
    supabase
      .from("fx_exposure")
      .select("currency_code, receivables_fc, payables_fc, spot_rate")
      .eq("org_id", orgId)
      .order("snapshot_date", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!data) return;
        // Take latest snapshot per currency
        const seen = new Set<string>();
        const rows: ExposureRow[] = [];
        for (const r of data) {
          if (!seen.has(r.currency_code)) {
            seen.add(r.currency_code);
            rows.push({
              currency: r.currency_code,
              receivables: Number(r.receivables_fc),
              payables: Number(r.payables_fc),
              spot: Number(r.spot_rate),
            });
          }
        }
        setExposure(rows);
      });

    // Fetch recent multi-currency transactions
    supabase
      .from("multi_currency_transactions")
      .select("id, entity_type, base_currency, transaction_currency, base_amount, transaction_amount, exchange_rate, rate_type, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (data) setTransactions(data as MCTransaction[]);
        setLoadingData(false);
      });
  }, [orgId]);

  // Conversion result — use loaded rate or fallback to 1
  const selectedRateData = rates[selectedRate] ?? { rate: 1, change: 0, updated: "—" };
  const convResult = convFrom === "USD" && convTo === "ARS"
    ? Number(convAmount) * selectedRateData.rate
    : convFrom === "ARS" && convTo === "USD"
    ? Number(convAmount) / selectedRateData.rate
    : Number(convAmount);

  const addRate = async () => {
    if (!orgId || !newRate.rate) return;
    const { error } = await supabase.from("fx_rates").insert({
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
    { id: "history",      label: "Historial de Cotización" },
  ];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Globe}
        title="Multi-Divisa & FX"
        description="Tipos de cambio en tiempo real, conversor y exposición FX"
        actions={
          <div className="flex items-center flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => toast.info("Tasas actualizadas")}>
              <RefreshCw className="w-3 h-3" />Actualizar tasas
            </Button>
            <Button size="sm" onClick={() => setShowAddRate(true)} className="gap-1.5 gradient-gold text-primary-foreground">
              <Plus className="w-3.5 h-3.5" />Tasa manual
            </Button>
          </div>
        }
      />

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
              {RATE_TYPES.filter(rt => rates[rt.id]).map(rt => (
                <RateCard key={rt.id} type={rt.id} data={rates[rt.id]}
                  sparkData={sparklineData[rt.id] ?? []} selected={selectedRate === rt.id}
                  onClick={() => setSelectedRate(rt.id)} />
              ))}
              {!loadingData && Object.keys(rates).length === 0 && (
                <p className="col-span-4 text-sm text-muted-foreground text-center py-4">Sin tipos de cambio registrados. Agregá una tasa manual.</p>
              )}
            </div>
          </div>

          {/* Other pairs */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Otras divisas vs ARS</h3>
            <div className="bg-card border border-border/40 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Divisa", "Nombre", "Tipo Cambio", "Variación", "Trend"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {otherRates.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-4 text-xs text-muted-foreground text-center">Sin datos de otras divisas</td></tr>
                  )}
                  {otherRates.map(r => {
                    const c = CURRENCIES_INFO[r.code];
                    if (!c) return null;
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
                  <Select value={convFrom} onValueChange={setConvFrom}>
                    <SelectTrigger className="h-10 w-28 font-semibold" aria-label="Moneda de origen"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(CURRENCIES_INFO).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
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
                  <Select value={convTo} onValueChange={setConvTo}>
                    <SelectTrigger className="h-10 w-28 font-semibold" aria-label="Moneda de destino"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(CURRENCIES_INFO).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
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
                  {exposure.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-4 text-xs text-muted-foreground text-center">Sin datos de exposición FX</td></tr>
                  )}
                  {exposure.map(e => {
                    const net = e.receivables - e.payables;
                    const netARS = net * e.spot;
                    const info = CURRENCIES_INFO[e.currency];
                    if (!info) return null;
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
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">Sin transacciones multi-divisa registradas</td>
                  </tr>
                ) : transactions.map(t => (
                  <tr key={t.id} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="px-4 py-3"><Badge className="text-xs bg-muted text-muted-foreground border-0">{t.entity_type}</Badge></td>
                    <td className="px-4 py-3 text-xs font-medium">—</td>
                    <td className="px-4 py-3 text-xs font-mono">{t.transaction_currency} → {t.base_currency}</td>
                    <td className="px-4 py-3 text-xs">{t.transaction_currency === "USD" ? "US$" : "$"}{t.transaction_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs">
                      <div>
                        <span className="font-mono">{t.exchange_rate.toLocaleString("es-AR")}</span>
                        <Badge className={`ml-1.5 text-[9px] ${RATE_TYPES.find(r => r.id === t.rate_type)?.color} bg-muted border-0`}>{t.rate_type}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">${t.base_amount.toLocaleString("es-AR")}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString("es-AR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── History tab — ported from the old /tipo-cambio page ─── */}
      {tab === "history" && <CurrencyHistoryTab />}

      {/* ─── Add rate dialog ─── */}
      <Dialog open={showAddRate} onOpenChange={setShowAddRate}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Agregar tipo de cambio</DialogTitle>
          </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">De</label>
                  <Select value={newRate.currency_from} onValueChange={currency_from => setNewRate(p => ({ ...p, currency_from }))}>
                    <SelectTrigger className="h-9 w-full" aria-label="Moneda de origen"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(CURRENCIES_INFO).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">A</label>
                  <Select value={newRate.currency_to} onValueChange={currency_to => setNewRate(p => ({ ...p, currency_to }))}>
                    <SelectTrigger className="h-9 w-full" aria-label="Moneda de destino"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(CURRENCIES_INFO).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de cotización</label>
                <Select value={newRate.rate_type} onValueChange={rate_type => setNewRate(p => ({ ...p, rate_type }))}>
                  <SelectTrigger className="h-9 w-full" aria-label="Tipo de cotización"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RATE_TYPES.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Tasa</label>
                <Input type="number" value={newRate.rate} onChange={e => setNewRate(p => ({ ...p, rate: e.target.value }))} placeholder="1285.00" className="h-9 font-mono" step="0.01" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddRate(false)}>Cancelar</Button>
              <Button onClick={addRate} disabled={!newRate.rate} className="gradient-gold text-primary-foreground">Guardar Tasa</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
