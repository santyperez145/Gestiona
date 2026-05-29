import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Progress } from "@/components/ui/progress";
import {
  Package, TrendingUp, TrendingDown, Star, AlertTriangle,
  Plus, ChevronRight, BarChart3, Clock, Shield, Layers,
  ArrowRight, Loader2, LayoutGrid, List, Filter, Calendar,
  Zap, Target, Flag, Activity, CheckCircle2, CircleDot,
  ArrowUpRight, RefreshCw, Eye
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface PLMProduct {
  id: string;
  internal_code: string;
  name: string;
  lifecycle_stage: string;
  version: string;
  launch_date: string | null;
  eol_date: string | null;
  quality_score: number;
  market_share_pct: number;
  revenue_ltm: number;
  margin_pct: number;
  bcg_quadrant: "star" | "cash_cow" | "question_mark" | "dog";
}

// ─── Stage Config ─────────────────────────────────────────────────────────────
const STAGE_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  concept:      { label: "Concepto",       color: "bg-muted text-muted-foreground",           order: 1 },
  development:  { label: "Desarrollo",     color: "bg-blue-500/15 text-blue-400",             order: 2 },
  testing:      { label: "Testing",        color: "bg-indigo-500/15 text-indigo-400",          order: 3 },
  launch:       { label: "Lanzamiento",    color: "bg-purple-500/15 text-purple-400",          order: 4 },
  growth:       { label: "Crecimiento",    color: "bg-emerald-500/15 text-emerald-400",        order: 5 },
  maturity:     { label: "Madurez",        color: "bg-yellow-500/15 text-yellow-400",          order: 6 },
  decline:      { label: "Declive",        color: "bg-orange-500/15 text-orange-400",          order: 7 },
  eol:          { label: "Fin de Vida",    color: "bg-destructive/15 text-destructive",        order: 8 },
  discontinued: { label: "Descontinuado", color: "bg-muted/80 text-muted-foreground",          order: 9 },
};

// ─── BCG Config ───────────────────────────────────────────────────────────────
const BCG_CONFIG: Record<string, { label: string; icon: string; desc: string; color: string }> = {
  star:          { label: "Estrella",      icon: "⭐", desc: "Alta cuota + alto crecimiento",  color: "bg-yellow-500/10 border-yellow-500/30" },
  cash_cow:      { label: "Vaca lechera",  icon: "🐄", desc: "Alta cuota + bajo crecimiento", color: "bg-emerald-500/10 border-emerald-500/30" },
  question_mark: { label: "Interrogante",  icon: "❓", desc: "Baja cuota + alto crecimiento", color: "bg-blue-500/10 border-blue-500/30" },
  dog:           { label: "Perro",         icon: "🐕", desc: "Baja cuota + bajo crecimiento", color: "bg-muted border-border" },
};

// ─── Priority System ──────────────────────────────────────────────────────────
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/20",
  high:     "bg-orange-500/15 text-orange-400 border-orange-500/20",
  medium:   "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  low:      "bg-muted/40 text-muted-foreground border-border/30",
};
const PRIORITY_LABELS: Record<string, string> = {
  critical: "Crítico",
  high:     "Alto",
  medium:   "Medio",
  low:      "Bajo",
};
const PRIORITY_ICONS: Record<string, string> = {
  critical: "🔴", high: "🟠", medium: "🟡", low: "⚪",
};

function getProductPriority(p: PLMProduct): string {
  if (p.quality_score < 40 || ["decline", "eol"].includes(p.lifecycle_stage)) return "critical";
  if (p.margin_pct >= 25 || p.revenue_ltm > 1_000_000) return "high";
  if (p.margin_pct >= 10) return "medium";
  return "low";
}

// ─── Roadmap Kanban Columns ────────────────────────────────────────────────────
const ROADMAP_COLUMNS = [
  {
    key: "backlog",
    label: "Backlog",
    stages: ["concept"],
    icon: "🎯",
    headerClass: "bg-muted/20 border border-border/30 text-muted-foreground",
    dotClass: "bg-muted-foreground/50",
  },
  {
    key: "dev",
    label: "En Desarrollo",
    stages: ["development"],
    icon: "🔨",
    headerClass: "bg-blue-500/10 border border-blue-500/20 text-blue-400",
    dotClass: "bg-blue-400",
  },
  {
    key: "qa",
    label: "QA / Testing",
    stages: ["testing"],
    icon: "🔬",
    headerClass: "bg-indigo-500/10 border border-indigo-500/20 text-indigo-400",
    dotClass: "bg-indigo-400",
  },
  {
    key: "launch",
    label: "Lanzamiento",
    stages: ["launch"],
    icon: "🚀",
    headerClass: "bg-purple-500/10 border border-purple-500/20 text-purple-400",
    dotClass: "bg-purple-400",
  },
  {
    key: "live",
    label: "En Vivo",
    stages: ["growth", "maturity"],
    icon: "✅",
    headerClass: "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400",
    dotClass: "bg-emerald-400",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function computeBcg(market_share_pct: number, margin_pct: number): PLMProduct["bcg_quadrant"] {
  if (market_share_pct >= 20 && margin_pct >= 15) return "star";
  if (market_share_pct >= 20 && margin_pct < 15)  return "cash_cow";
  if (market_share_pct < 20  && margin_pct >= 15) return "question_mark";
  return "dog";
}

const LIFECYCLE_STAGES = ["concept","development","testing","launch","growth","maturity","decline","eol","discontinued"];

// ─── Component ────────────────────────────────────────────────────────────────
export default function ProductLifecyclePage() {
  usePageTitle("Ciclo de Vida de Producto");
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"products" | "bcg" | "quality" | "roadmap">("products");
  const [products, setProducts] = useState<PLMProduct[]>([]);
  const [selected, setSelected] = useState<PLMProduct | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [roadmapView, setRoadmapView] = useState<"kanban" | "list">("kanban");
  const [roadmapPriority, setRoadmapPriority] = useState("all");
  const [roadmapStageFilter, setRoadmapStageFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    supabase
      .from("plm_products")
      .select("id, internal_code, name, lifecycle_stage, version, launch_date, eol_date, quality_score, market_share_pct, revenue_ltm, margin_pct")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { toast.error("Error cargando productos PLM"); }
        setProducts((data ?? []).map((p: any) => ({
          ...p,
          bcg_quadrant: computeBcg(p.market_share_pct, p.margin_pct),
        })));
        setLoading(false);
      });
  }, [orgId]);

  const filtered = products.filter(p => stageFilter === "all" || p.lifecycle_stage === stageFilter);

  const kpis = useMemo(() => ({
    total: products.length,
    inDevelopment: products.filter(p => ["concept","development","testing"].includes(p.lifecycle_stage)).length,
    active: products.filter(p => ["launch","growth","maturity"].includes(p.lifecycle_stage)).length,
    endOfLife: products.filter(p => ["decline","eol","discontinued"].includes(p.lifecycle_stage)).length,
    avgQuality: products.length > 0 ? Math.round(products.reduce((s,p) => s + p.quality_score, 0) / products.length) : 0,
    highPriority: products.filter(p => ["critical","high"].includes(getProductPriority(p))).length,
  }), [products]);

  const roadmapKpis = useMemo(() => ({
    inPipeline: products.filter(p => ["concept","development","testing","launch"].includes(p.lifecycle_stage)).length,
    inDev: products.filter(p => p.lifecycle_stage === "development").length,
    highPriority: products.filter(p => ["critical","high"].includes(getProductPriority(p)) && ["concept","development","testing","launch"].includes(p.lifecycle_stage)).length,
    readyToLaunch: products.filter(p => p.lifecycle_stage === "launch").length,
    totalRevenue: products.reduce((s, p) => s + (p.revenue_ltm || 0), 0),
  }), [products]);

  const advanceStage = (product: PLMProduct) => {
    const idx = LIFECYCLE_STAGES.indexOf(product.lifecycle_stage);
    if (idx < LIFECYCLE_STAGES.length - 2) {
      toast.success(`${product.name} avanzó a: ${STAGE_CONFIG[LIFECYCLE_STAGES[idx + 1]]?.label}`);
    }
  };

  const bcgGroups: Record<string, PLMProduct[]> = { star: [], cash_cow: [], question_mark: [], dog: [] };
  products.forEach(p => { if (bcgGroups[p.bcg_quadrant]) bcgGroups[p.bcg_quadrant].push(p); });

  // Roadmap filtered products
  const roadmapFiltered = useMemo(() => {
    return products.filter(p => {
      const matchPriority = roadmapPriority === "all" || getProductPriority(p) === roadmapPriority;
      const matchStage = roadmapStageFilter === "all" || p.lifecycle_stage === roadmapStageFilter;
      return matchPriority && matchStage;
    });
  }, [products, roadmapPriority, roadmapStageFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Layers}
        title="Ciclo de Vida de Producto (PLM)"
        description="Gestión completa del pipeline de productos: etapas, versiones, calidad y roadmap estratégico"
        actions={
          <Dialog open={showNew} onOpenChange={setShowNew}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" />Nuevo Producto</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Agregar Producto al PLM</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <div><Label>Código Interno</Label><Input placeholder="PLM-006" className="mt-1" /></div>
                <div><Label>Nombre</Label><Input placeholder="Nombre del producto" className="mt-1" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Etapa Inicial</Label>
                    <Select defaultValue="concept">
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(STAGE_CONFIG).slice(0, 6).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Versión</Label><Input defaultValue="1.0.0" className="mt-1" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Margen estimado (%)</Label><Input type="number" placeholder="25" className="mt-1" /></div>
                  <div><Label>Fecha de Lanzamiento</Label><Input type="date" className="mt-1" /></div>
                </div>
                <Button className="w-full" onClick={() => { toast.success("Producto agregado al PLM"); setShowNew(false); }}>
                  Agregar al Pipeline
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="Total PLM" value={kpis.total} icon={Package} color="primary" />
        <KPICard label="En Pipeline" value={kpis.inDevelopment} icon={Activity} color="blue" />
        <KPICard label="Activos" value={kpis.active} icon={CheckCircle2} color="success" />
        <KPICard label="Fin de Vida" value={kpis.endOfLife} icon={TrendingDown} color={kpis.endOfLife > 0 ? "warning" : "success"} />
        <KPICard label="Calidad Prom." value={`${kpis.avgQuality}%`} icon={Target} color={kpis.avgQuality >= 70 ? "success" : "warning"} />
        <KPICard label="Prioridad Alta" value={kpis.highPriority} icon={Flag} color={kpis.highPriority > 0 ? "destructive" : "success"} />
      </div>

      {/* Stage filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setStageFilter("all")}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${stageFilter === "all" ? "border-primary bg-primary/15 text-primary" : "border-border/40 text-muted-foreground hover:border-border"}`}
        >
          Todos ({products.length})
        </button>
        {Object.entries(STAGE_CONFIG).map(([stage, cfg]) => {
          const count = products.filter(p => p.lifecycle_stage === stage).length;
          if (count === 0) return null;
          return (
            <button
              key={stage}
              onClick={() => setStageFilter(stage === stageFilter ? "all" : stage)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${stage === stageFilter ? "border-primary bg-primary/15 text-primary" : cfg.color + " border-transparent"}`}
            >
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="products" className="gap-1.5"><Package className="w-3.5 h-3.5" />Productos</TabsTrigger>
          <TabsTrigger value="bcg" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Matriz BCG</TabsTrigger>
          <TabsTrigger value="quality" className="gap-1.5"><Shield className="w-3.5 h-3.5" />Calidad</TabsTrigger>
          <TabsTrigger value="roadmap" className="gap-1.5"><Flag className="w-3.5 h-3.5" />Roadmap</TabsTrigger>
        </TabsList>

        {/* ── PRODUCTS TAB ──────────────────────────────────────────── */}
        <TabsContent value="products" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No hay productos en esta etapa</p>
            </div>
          ) : filtered.map(product => (
            <Card key={product.id} className="cursor-pointer hover:border-primary/40 transition-all group" onClick={() => setSelected(product)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                  <div className="text-2xl shrink-0">{BCG_CONFIG[product.bcg_quadrant]?.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{product.internal_code}</span>
                      <span className="font-semibold truncate">{product.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_CONFIG[product.lifecycle_stage]?.color}`}>
                        {STAGE_CONFIG[product.lifecycle_stage]?.label}
                      </span>
                      <span className="text-xs text-muted-foreground">v{product.version}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium border ${PRIORITY_COLORS[getProductPriority(product)]}`}>
                        {PRIORITY_ICONS[getProductPriority(product)]} {PRIORITY_LABELS[getProductPriority(product)]}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                      {product.revenue_ltm > 0 && <span>Revenue: ${(product.revenue_ltm / 1_000_000).toFixed(1)}M</span>}
                      {product.market_share_pct > 0 && <span>Market share: {product.market_share_pct}%</span>}
                      {product.margin_pct > 0 && <span>Margen: {product.margin_pct}%</span>}
                      {product.launch_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(product.launch_date).toLocaleDateString('es-AR')}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs text-muted-foreground mb-1">Calidad {product.quality_score}/100</p>
                    <Progress value={product.quality_score} className="h-2 w-28" />
                  </div>
                  {!["eol","discontinued"].includes(product.lifecycle_stage) && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={e => { e.stopPropagation(); advanceStage(product); }}>
                      Avanzar <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  )}
                </div>
                <div className="sm:hidden mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Calidad {product.quality_score}/100</p>
                  <Progress value={product.quality_score} className="h-2 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ── BCG MATRIX TAB ─────────────────────────────────────────── */}
        <TabsContent value="bcg" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(["star","question_mark","cash_cow","dog"] as const).map(quadrant => {
              const cfg = BCG_CONFIG[quadrant];
              const group = bcgGroups[quadrant];
              return (
                <Card key={quadrant} className={`border-2 ${cfg.color}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className="text-lg">{cfg.icon}</span>{cfg.label}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{cfg.desc}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{group.length} productos</span>
                      {group.length > 0 && (
                        <span className="text-xs text-muted-foreground">·  ${(group.reduce((s,p) => s + p.revenue_ltm, 0) / 1_000_000).toFixed(1)}M revenue</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {group.length === 0
                      ? <p className="text-xs text-muted-foreground/60 italic py-2">Sin productos en este cuadrante</p>
                      : group.map(p => (
                          <div key={p.id} className="mb-3 last:mb-0 p-2 rounded-lg bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => setSelected(p)}>
                            <div className="flex items-center justify-between mb-1">
                              <p className="font-medium text-sm">{p.name}</p>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STAGE_CONFIG[p.lifecycle_stage]?.color}`}>
                                {STAGE_CONFIG[p.lifecycle_stage]?.label}
                              </span>
                            </div>
                            <div className="flex gap-3 text-xs text-muted-foreground">
                              {p.market_share_pct > 0 && <span>Share: {p.market_share_pct}%</span>}
                              {p.revenue_ltm > 0 && <span>${(p.revenue_ltm / 1_000_000).toFixed(1)}M</span>}
                              {p.margin_pct > 0 && <span>{p.margin_pct}% margen</span>}
                            </div>
                            <Progress value={p.quality_score} className="h-1 mt-1.5" />
                          </div>
                        ))
                    }
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Cuadrantes definidos por cuota de mercado relativa (≥20%) y margen (≥15%)
          </p>
        </TabsContent>

        {/* ── QUALITY TAB ───────────────────────────────────────────── */}
        <TabsContent value="quality" className="space-y-3 mt-4">
          {products.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No hay productos registrados</p>
            </div>
          ) : (
            <>
              {/* Quality distribution */}
              <div className="grid grid-cols-3 gap-3 mb-2">
                {[
                  { label: "Excelente (≥90)", count: products.filter(p => p.quality_score >= 90).length, color: "text-emerald-400" },
                  { label: "Bueno (70–89)", count: products.filter(p => p.quality_score >= 70 && p.quality_score < 90).length, color: "text-yellow-400" },
                  { label: "Crítico (<70)", count: products.filter(p => p.quality_score < 70).length, color: "text-red-400" },
                ].map(q => (
                  <div key={q.label} className="bg-card border border-border/40 rounded-xl p-3 text-center">
                    <p className={`text-xl font-bold ${q.color}`}>{q.count}</p>
                    <p className="text-xs text-muted-foreground">{q.label}</p>
                  </div>
                ))}
              </div>
              {[...products].sort((a, b) => b.quality_score - a.quality_score).map(p => (
                <Card key={p.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className="font-semibold text-sm">{p.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${STAGE_CONFIG[p.lifecycle_stage]?.color}`}>
                            {STAGE_CONFIG[p.lifecycle_stage]?.label}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">{p.internal_code}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Progress value={p.quality_score} className="flex-1 h-3" />
                          <span className={`text-sm font-bold shrink-0 ${p.quality_score >= 90 ? "text-emerald-400" : p.quality_score >= 70 ? "text-yellow-400" : "text-destructive"}`}>
                            {p.quality_score}/100
                          </span>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => toast.info(`Iniciando auditoría de calidad para ${p.name}...`)}>
                        <Shield className="w-3 h-3 mr-1" />Auditar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* ── ROADMAP TAB ───────────────────────────────────────────── */}
        <TabsContent value="roadmap" className="space-y-5 mt-4">

          {/* Roadmap KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-card border border-border/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-primary" />
                <p className="text-xs text-muted-foreground uppercase tracking-wide">En Pipeline</p>
              </div>
              <p className="text-2xl font-bold">{roadmapKpis.inPipeline}</p>
              <p className="text-xs text-muted-foreground">productos en desarrollo</p>
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4 text-blue-400" />
                <p className="text-xs text-muted-foreground uppercase tracking-wide">En Desarrollo</p>
              </div>
              <p className="text-2xl font-bold text-blue-400">{roadmapKpis.inDev}</p>
              <p className="text-xs text-muted-foreground">actualmente codificando</p>
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Flag className="w-4 h-4 text-orange-400" />
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Prioridad Alta</p>
              </div>
              <p className="text-2xl font-bold text-orange-400">{roadmapKpis.highPriority}</p>
              <p className="text-xs text-muted-foreground">crítico o alto</p>
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-4 h-4 text-purple-400" />
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Prox. Lanzamiento</p>
              </div>
              <p className="text-2xl font-bold text-purple-400">{roadmapKpis.readyToLaunch}</p>
              <p className="text-xs text-muted-foreground">listos para salir</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* View Toggle */}
            <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 w-fit">
              <button
                onClick={() => setRoadmapView("kanban")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-all ${roadmapView === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />Kanban
              </button>
              <button
                onClick={() => setRoadmapView("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-all ${roadmapView === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <List className="w-3.5 h-3.5" />Lista
              </button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {[
                { key: "all", label: "Todas las prioridades" },
                { key: "critical", label: "🔴 Crítico" },
                { key: "high", label: "🟠 Alto" },
                { key: "medium", label: "🟡 Medio" },
                { key: "low", label: "⚪ Bajo" },
              ].map(p => (
                <button
                  key={p.key}
                  onClick={() => setRoadmapPriority(p.key)}
                  className={`px-2.5 py-1 text-xs rounded-full font-medium transition-all border ${roadmapPriority === p.key ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground hover:border-border"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── KANBAN VIEW ─── */}
          {roadmapView === "kanban" && (
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-4 min-w-max lg:min-w-0 lg:grid lg:grid-cols-5">
                {ROADMAP_COLUMNS.map(col => {
                  const colProducts = roadmapFiltered.filter(p => col.stages.includes(p.lifecycle_stage));
                  return (
                    <div key={col.key} className="w-[240px] lg:w-auto flex-shrink-0">
                      {/* Column Header */}
                      <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-xl ${col.headerClass}`}>
                        <span className="text-base leading-none">{col.icon}</span>
                        <span className="font-semibold text-xs uppercase tracking-wide flex-1">{col.label}</span>
                        <span className="text-xs font-bold bg-black/20 rounded-full px-2 py-0.5 min-w-[22px] text-center">
                          {colProducts.length}
                        </span>
                      </div>

                      {/* Cards */}
                      <div className="space-y-2">
                        {colProducts.length === 0 ? (
                          <div className="border border-dashed border-border/30 rounded-xl p-4 text-center">
                            <p className="text-xs text-muted-foreground/50">Sin items</p>
                          </div>
                        ) : colProducts.map(p => {
                          const priority = getProductPriority(p);
                          return (
                            <div
                              key={p.id}
                              onClick={() => setSelected(p)}
                              className="bg-card border border-border/40 rounded-xl p-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all group"
                            >
                              {/* Priority indicator */}
                              <div className="flex items-start justify-between gap-1.5 mb-2">
                                <span className="font-medium text-xs leading-snug line-clamp-2 flex-1">{p.name}</span>
                                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${PRIORITY_COLORS[priority]}`}>
                                  {PRIORITY_ICONS[priority]}
                                </span>
                              </div>

                              {/* Code + version */}
                              <div className="flex items-center gap-1 mb-2">
                                <span className="text-[10px] text-muted-foreground font-mono">{p.internal_code}</span>
                                <span className="text-[10px] text-muted-foreground/60">·</span>
                                <span className="text-[10px] text-muted-foreground">v{p.version}</span>
                              </div>

                              {/* Quality bar */}
                              <div className="flex items-center gap-1.5 mb-2">
                                <Progress value={p.quality_score} className="h-1 flex-1" />
                                <span className={`text-[10px] font-medium shrink-0 ${p.quality_score >= 70 ? "text-emerald-400" : p.quality_score >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                                  {p.quality_score}%
                                </span>
                              </div>

                              {/* Footer */}
                              <div className="flex items-center justify-between gap-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${BCG_CONFIG[p.bcg_quadrant]?.color.split(' ')[0]} text-foreground`}>
                                  {BCG_CONFIG[p.bcg_quadrant]?.icon} {BCG_CONFIG[p.bcg_quadrant]?.label}
                                </span>
                                <div className="flex items-center gap-1.5 ml-auto">
                                  {p.revenue_ltm > 0 && (
                                    <span className="text-[10px] text-emerald-400 font-medium">${(p.revenue_ltm / 1_000_000).toFixed(1)}M</span>
                                  )}
                                  {p.launch_date && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                      <Calendar className="w-2.5 h-2.5" />
                                      {new Date(p.launch_date).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Margin badge */}
                              {p.margin_pct > 0 && (
                                <div className="mt-1.5 pt-1.5 border-t border-border/20">
                                  <span className="text-[10px] text-muted-foreground">Margen: <span className={p.margin_pct >= 20 ? "text-emerald-400 font-medium" : "text-yellow-400"}>{p.margin_pct}%</span></span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── LIST VIEW ─── */}
          {roadmapView === "list" && (
            <div className="overflow-x-auto rounded-xl border border-border/40">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Producto</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Etapa</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Prioridad</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Calidad</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">BCG</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Revenue LTM</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Margen</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Lanzamiento</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {roadmapFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                        No hay productos con los filtros aplicados
                      </td>
                    </tr>
                  ) : [...roadmapFiltered]
                    .sort((a, b) => (STAGE_CONFIG[a.lifecycle_stage]?.order ?? 0) - (STAGE_CONFIG[b.lifecycle_stage]?.order ?? 0))
                    .map(p => {
                      const priority = getProductPriority(p);
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-border/20 hover:bg-muted/20 cursor-pointer transition-colors"
                          onClick={() => setSelected(p)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{p.internal_code} · v{p.version}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STAGE_CONFIG[p.lifecycle_stage]?.color}`}>
                              {STAGE_CONFIG[p.lifecycle_stage]?.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border whitespace-nowrap ${PRIORITY_COLORS[priority]}`}>
                              {PRIORITY_ICONS[priority]} {PRIORITY_LABELS[priority]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Progress value={p.quality_score} className="h-1.5 w-16" />
                              <span className={`text-xs font-medium shrink-0 ${p.quality_score >= 70 ? "text-emerald-400" : "text-red-400"}`}>{p.quality_score}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-base">{BCG_CONFIG[p.bcg_quadrant]?.icon}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                            {p.revenue_ltm > 0 ? <span className="text-emerald-400">${(p.revenue_ltm / 1_000_000).toFixed(1)}M</span> : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {p.margin_pct > 0
                              ? <span className={p.margin_pct >= 20 ? "text-emerald-400 font-medium" : "text-yellow-400"}>{p.margin_pct}%</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                            {p.launch_date ? new Date(p.launch_date).toLocaleDateString('es-AR') : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => { e.stopPropagation(); setSelected(p); }}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state for roadmap */}
          {products.length === 0 && (
            <div className="text-center py-16 border border-dashed border-border/40 rounded-2xl">
              <Flag className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="font-semibold text-muted-foreground mb-1">Pipeline vacío</h3>
              <p className="text-sm text-muted-foreground/60 mb-4">Agregá productos al PLM para visualizar el roadmap</p>
              <Button onClick={() => setShowNew(true)} className="gap-2"><Plus className="w-4 h-4" />Agregar primer producto</Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Product Detail Modal ─────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <Card className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <span className="font-mono text-xs text-muted-foreground">{selected.internal_code} · v{selected.version}</span>
                <CardTitle className="text-base mt-0.5">{selected.name}</CardTitle>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_CONFIG[selected.lifecycle_stage]?.color}`}>
                    {STAGE_CONFIG[selected.lifecycle_stage]?.label}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${PRIORITY_COLORS[getProductPriority(selected)]}`}>
                    {PRIORITY_ICONS[getProductPriority(selected)]} {PRIORITY_LABELS[getProductPriority(selected)]}
                  </span>
                </div>
              </div>
              <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setSelected(null)}>✕</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-muted/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">BCG</p>
                  <p className="font-medium">{BCG_CONFIG[selected.bcg_quadrant]?.icon} {BCG_CONFIG[selected.bcg_quadrant]?.label}</p>
                  <p className="text-xs text-muted-foreground">{BCG_CONFIG[selected.bcg_quadrant]?.desc}</p>
                </div>
                <div className="bg-muted/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Revenue LTM</p>
                  <p className="font-bold text-emerald-400">{selected.revenue_ltm > 0 ? `$${(selected.revenue_ltm / 1_000_000).toFixed(2)}M` : "—"}</p>
                </div>
                <div className="bg-muted/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Margen</p>
                  <p className="font-bold">{selected.margin_pct > 0 ? `${selected.margin_pct}%` : "—"}</p>
                </div>
                <div className="bg-muted/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Market Share</p>
                  <p className="font-bold">{selected.market_share_pct > 0 ? `${selected.market_share_pct}%` : "—"}</p>
                </div>
                <div className="bg-muted/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Lanzamiento</p>
                  <p className="font-medium">{selected.launch_date ? new Date(selected.launch_date).toLocaleDateString('es-AR') : "Por definir"}</p>
                </div>
                <div className="bg-muted/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">EOL</p>
                  <p className="font-medium">{selected.eol_date ? new Date(selected.eol_date).toLocaleDateString('es-AR') : "Sin definir"}</p>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Puntuación de Calidad</span>
                  <span className={`font-bold ${selected.quality_score >= 90 ? "text-emerald-400" : selected.quality_score >= 70 ? "text-yellow-400" : "text-destructive"}`}>
                    {selected.quality_score}/100
                  </span>
                </div>
                <Progress value={selected.quality_score} className="h-3" />
                <p className="text-xs text-muted-foreground mt-1">
                  {selected.quality_score >= 90 ? "Calidad excelente — listo para producción" :
                   selected.quality_score >= 70 ? "Calidad buena — mejoras menores pendientes" :
                   "Calidad crítica — requiere atención inmediata"}
                </p>
              </div>
              {!["eol","discontinued"].includes(selected.lifecycle_stage) && (
                <Button className="w-full gap-2" onClick={() => { advanceStage(selected); setSelected(null); }}>
                  Avanzar a próxima etapa <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
