import { useState } from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Eye, TrendingUp, TrendingDown, AlertTriangle, Plus,
  Globe, Bell, BarChart3, Shield, Target, Zap, ExternalLink
} from "lucide-react";

interface Competitor {
  id: string;
  name: string;
  website: string;
  category: string;
  market_share_pct: number;
  revenue_est: number;
  founded_year: number;
  is_tracked: boolean;
  avg_price: number;
  tags: string[];
}

interface Signal {
  id: string;
  competitor_id: string;
  competitor_name: string;
  signal_type: string;
  title: string;
  description: string;
  impact: string;
  sentiment: string;
  detected_at: string;
  is_read: boolean;
}

interface SwotItem {
  quadrant: "strength" | "weakness" | "opportunity" | "threat";
  item: string;
  impact_score: number;
  evidence?: string;
}

const IMPACT_COLORS: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-800",
  low:    "bg-green-100 text-green-700",
};

const SENTIMENT_ICONS: Record<string, string> = {
  positive: "📈",
  negative: "📉",
  neutral:  "➡️",
};

const SIGNAL_ICONS: Record<string, string> = {
  price_change: "💲",
  new_product:  "📦",
  promotion:    "🎁",
  news:         "📰",
  review:       "⭐",
  social:       "📱",
  funding:      "💰",
  expansion:    "🏢",
};

const MOCK_COMPETITORS: Competitor[] = [
  { id: "c1", name: "VendeMás Pro", website: "vendemaspro.com", category: "direct", market_share_pct: 18, revenue_est: 50_000_000, founded_year: 2020, is_tracked: true, avg_price: 12_500, tags: ["SaaS", "PyMEs", "Argentina"] },
  { id: "c2", name: "GestiónAR", website: "gestionar.ar", category: "direct", market_share_pct: 12, revenue_est: 30_000_000, founded_year: 2019, is_tracked: true, avg_price: 9_000, tags: ["ERP", "Argentina"] },
  { id: "c3", name: "Odoo (Local)", website: "odoo.com", category: "indirect", market_share_pct: 8, revenue_est: null as unknown as number, founded_year: 2005, is_tracked: true, avg_price: 25_000, tags: ["ERP", "Internacional"] },
  { id: "c4", name: "Tiendanube Gestor", website: "tiendanube.com", category: "substitute", market_share_pct: 5, revenue_est: null as unknown as number, founded_year: 2011, is_tracked: false, avg_price: 8_000, tags: ["Ecommerce", "PyMEs"] },
];

const MOCK_SIGNALS: Signal[] = [
  { id: "s1", competitor_id: "c1", competitor_name: "VendeMás Pro", signal_type: "price_change", title: "Bajaron precio 15%", description: "Plan Starter bajó de $14.900 a $12.600", impact: "high", sentiment: "negative", detected_at: "2026-05-26T10:00:00Z", is_read: false },
  { id: "s2", competitor_id: "c1", competitor_name: "VendeMás Pro", signal_type: "new_product", title: "Lanzaron módulo de AFIP", description: "Integración CAE directa desde facturación", impact: "high", sentiment: "negative", detected_at: "2026-05-25T14:00:00Z", is_read: false },
  { id: "s3", competitor_id: "c2", competitor_name: "GestiónAR", signal_type: "funding", title: "Ronda Serie A de USD 2M", description: "Inversión de fondo local para expansión a Chile", impact: "medium", sentiment: "negative", detected_at: "2026-05-22T09:00:00Z", is_read: true },
  { id: "s4", competitor_id: "c3", competitor_name: "Odoo (Local)", signal_type: "promotion", title: "Promo 3 meses gratis", description: "Campaña de migración desde ERP legacy", impact: "medium", sentiment: "negative", detected_at: "2026-05-20T11:00:00Z", is_read: true },
];

const MOCK_SWOT: SwotItem[] = [
  { quadrant: "strength", item: "UX/UI moderno vs competidores legacy", impact_score: 9, evidence: "NPS 72 vs industria 45" },
  { quadrant: "strength", item: "Stack tecnológico superior (realtime, PWA)", impact_score: 8 },
  { quadrant: "strength", item: "Precio competitivo con más features", impact_score: 7 },
  { quadrant: "weakness", item: "Sin módulo AFIP CAE nativo", impact_score: 8, evidence: "Top feedback en soporte" },
  { quadrant: "weakness", item: "Menos integraciones con proveedores locales", impact_score: 6 },
  { quadrant: "opportunity", item: "Mercado de franquicias no atendido", impact_score: 8 },
  { quadrant: "opportunity", item: "Expansión a Chile y Uruguay", impact_score: 7 },
  { quadrant: "opportunity", item: "API pública para desarrolladores", impact_score: 6 },
  { quadrant: "threat", item: "VendeMás bajó precio agresivamente", impact_score: 9 },
  { quadrant: "threat", item: "Grandes players internacionales (SAP B1)", impact_score: 7 },
  { quadrant: "threat", item: "Consolidación del mercado (M&A)", impact_score: 5 },
];

const OUR_AVG_PRICE = 15_000;

function PriceGapBar({ ourPrice, theirPrice }: { ourPrice: number; theirPrice: number }) {
  const gap = ((ourPrice - theirPrice) / theirPrice) * 100;
  const isHigher = gap > 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`font-medium ${isHigher ? "text-orange-600" : "text-green-600"}`}>
        {isHigher ? "+" : ""}{gap.toFixed(1)}% vs nosotros
      </span>
      {isHigher ? <TrendingUp className="w-3 h-3 text-orange-600" /> : <TrendingDown className="w-3 h-3 text-green-600" />}
    </div>
  );
}

const SWOT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  strength:    { label: "Fortalezas",   color: "text-green-700",  bg: "bg-green-50 border-green-200" },
  weakness:    { label: "Debilidades",  color: "text-red-700",    bg: "bg-red-50 border-red-200" },
  opportunity: { label: "Oportunidades", color: "text-blue-700",  bg: "bg-blue-50 border-blue-200" },
  threat:      { label: "Amenazas",     color: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
};

export default function CompetitorIntelligencePage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"overview" | "signals" | "pricing" | "swot">("overview");
  const [competitors] = useState<Competitor[]>(MOCK_COMPETITORS);
  const [signals, setSignals] = useState<Signal[]>(MOCK_SIGNALS);
  const [showAdd, setShowAdd] = useState(false);
  const [filterImpact, setFilterImpact] = useState("all");

  const unread = signals.filter(s => !s.is_read).length;
  const filteredSignals = signals.filter(s => filterImpact === "all" || s.impact === filterImpact);

  const markRead = (id: string) => setSignals(prev => prev.map(s => s.id === id ? { ...s, is_read: true } : s));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Eye className="w-6 h-6 text-primary" /> Inteligencia Competitiva
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Monitoreo de precios, señales de mercado y análisis SWOT</p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <Badge className="bg-red-500 text-white">{unread} alertas nuevas</Badge>
          )}
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Agregar Competidor</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuevo Competidor</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div><Label>Nombre</Label><Input placeholder="Nombre de la empresa" /></div>
                <div><Label>Sitio Web</Label><Input placeholder="empresa.com" /></div>
                <div><Label>Tipo</Label>
                  <Select defaultValue="direct">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="direct">Competidor Directo</SelectItem>
                      <SelectItem value="indirect">Competidor Indirecto</SelectItem>
                      <SelectItem value="substitute">Sustituto</SelectItem>
                      <SelectItem value="potential">Potencial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Precio Promedio (ARS)</Label><Input type="number" placeholder="10000" /></div>
                <Button className="w-full" onClick={() => { toast.success("Competidor agregado"); setShowAdd(false); }}>Agregar</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="overview">Competidores</TabsTrigger>
          <TabsTrigger value="signals" className="relative">
            Señales
            {unread > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full" />}
          </TabsTrigger>
          <TabsTrigger value="pricing">Precios</TabsTrigger>
          <TabsTrigger value="swot">SWOT</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-3">
          {competitors.map(c => (
            <Card key={c.id}>
              <CardContent className="p-4 flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center font-bold text-sm text-muted-foreground">
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{c.name}</span>
                    <Badge variant="outline" className="text-xs capitalize">{c.category}</Badge>
                    {c.tags.map(t => <span key={t} className="text-xs bg-muted px-1.5 py-0.5 rounded">{t}</span>)}
                    {!c.is_tracked && <Badge variant="secondary" className="text-xs">No rastreado</Badge>}
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{c.website}</span>
                    <span>Market share: ~{c.market_share_pct}%</span>
                    {c.revenue_est && <span>Revenue: ${(c.revenue_est / 1_000_000).toFixed(0)}M</span>}
                    <span>Fundada: {c.founded_year}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">${c.avg_price.toLocaleString()}/mes</p>
                  <PriceGapBar ourPrice={OUR_AVG_PRICE} theirPrice={c.avg_price} />
                </div>
                <Button size="sm" variant="outline" onClick={() => window.open(`https://${c.website}`, "_blank")}>
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* SIGNALS */}
        <TabsContent value="signals" className="space-y-4">
          <div className="flex gap-2">
            <Select value={filterImpact} onValueChange={setFilterImpact}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="high">Alto impacto</SelectItem>
                <SelectItem value="medium">Medio</SelectItem>
                <SelectItem value="low">Bajo</SelectItem>
              </SelectContent>
            </Select>
            {unread > 0 && (
              <Button variant="outline" size="sm" onClick={() => setSignals(prev => prev.map(s => ({ ...s, is_read: true })))}>
                Marcar todos como leídos
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {filteredSignals.map(signal => (
              <Card key={signal.id} className={signal.is_read ? "opacity-60" : "border-primary/30"}>
                <CardContent className="p-4 flex items-start gap-3">
                  <span className="text-2xl">{SIGNAL_ICONS[signal.signal_type] ?? "📌"}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{signal.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${IMPACT_COLORS[signal.impact]}`}>{signal.impact}</span>
                      <span>{SENTIMENT_ICONS[signal.sentiment]}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{signal.competitor_name} · {new Date(signal.detected_at).toLocaleDateString("es-AR")}</p>
                    <p className="text-sm mt-1">{signal.description}</p>
                  </div>
                  {!signal.is_read && (
                    <Button size="sm" variant="ghost" onClick={() => markRead(signal.id)}>✓</Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* PRICING */}
        <TabsContent value="pricing">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />Comparativa de Precios</CardTitle></CardHeader>
            <CardContent>
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-sm font-semibold">Nosotros: ${OUR_AVG_PRICE.toLocaleString()}/mes</span>
                </div>
              </div>
              {competitors.filter(c => c.is_tracked).map(c => {
                const max = Math.max(OUR_AVG_PRICE, ...competitors.map(x => x.avg_price));
                return (
                  <div key={c.id} className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{c.name}</span>
                      <div className="flex items-center gap-3">
                        <span>${c.avg_price.toLocaleString()}</span>
                        <PriceGapBar ourPrice={OUR_AVG_PRICE} theirPrice={c.avg_price} />
                      </div>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden relative">
                      <div className="h-full bg-muted-foreground/30 rounded-full" style={{ width: `${(c.avg_price / max) * 100}%` }} />
                      <div className="absolute top-0 h-full border-l-2 border-primary border-dashed" style={{ left: `${(OUR_AVG_PRICE / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground mt-4">La línea punteada indica nuestro precio promedio</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SWOT */}
        <TabsContent value="swot">
          <div className="grid grid-cols-2 gap-4">
            {(["strength", "weakness", "opportunity", "threat"] as const).map(q => {
              const cfg = SWOT_CONFIG[q];
              const items = MOCK_SWOT.filter(s => s.quadrant === q).sort((a, b) => b.impact_score - a.impact_score);
              return (
                <Card key={q} className={`border ${cfg.bg}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm ${cfg.color}`}>{cfg.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <div className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                          {item.impact_score}
                        </div>
                        <div>
                          <p>{item.item}</p>
                          {item.evidence && <p className="text-xs text-muted-foreground">{item.evidence}</p>}
                        </div>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => toast.info("Agregar ítem al SWOT")}>
                      <Plus className="w-3 h-3 mr-1" />Agregar
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
