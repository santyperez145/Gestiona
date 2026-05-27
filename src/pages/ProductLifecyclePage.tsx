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
import { Progress } from "@/components/ui/progress";
import {
  Package, TrendingUp, TrendingDown, Star, AlertTriangle,
  Plus, ChevronRight, BarChart3, Clock, Shield, Layers,
  ArrowRight
} from "lucide-react";

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

const STAGE_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  concept:      { label: "Concepto",       color: "bg-gray-100 text-gray-700",    order: 1 },
  development:  { label: "Desarrollo",     color: "bg-blue-100 text-blue-700",    order: 2 },
  testing:      { label: "Testing",        color: "bg-indigo-100 text-indigo-700", order: 3 },
  launch:       { label: "Lanzamiento",    color: "bg-purple-100 text-purple-700", order: 4 },
  growth:       { label: "Crecimiento",    color: "bg-green-100 text-green-700",  order: 5 },
  maturity:     { label: "Madurez",        color: "bg-yellow-100 text-yellow-800", order: 6 },
  decline:      { label: "Declive",        color: "bg-orange-100 text-orange-700", order: 7 },
  eol:          { label: "Fin de Vida",    color: "bg-red-100 text-red-700",      order: 8 },
  discontinued: { label: "Descontinuado", color: "bg-gray-200 text-gray-600",    order: 9 },
};

const BCG_CONFIG: Record<string, { label: string; icon: string; desc: string; color: string }> = {
  star:          { label: "Estrella ⭐",    icon: "⭐", desc: "Alta cuota + alto crecimiento",    color: "bg-yellow-50 border-yellow-300" },
  cash_cow:      { label: "Vaca lechera 🐄", icon: "🐄", desc: "Alta cuota + bajo crecimiento",   color: "bg-green-50 border-green-300" },
  question_mark: { label: "Interrogante ❓", icon: "❓", desc: "Baja cuota + alto crecimiento",   color: "bg-blue-50 border-blue-300" },
  dog:           { label: "Perro 🐕",       icon: "🐕", desc: "Baja cuota + bajo crecimiento",   color: "bg-gray-50 border-gray-300" },
};

const MOCK_PRODUCTS: PLMProduct[] = [
  { id: "p1", internal_code: "PLM-001", name: "Notebook Lenovo IdeaPad", lifecycle_stage: "maturity", version: "3.2.0", launch_date: "2024-01-15", eol_date: null, quality_score: 92, market_share_pct: 28, revenue_ltm: 4_200_000, margin_pct: 32, bcg_quadrant: "cash_cow" },
  { id: "p2", internal_code: "PLM-002", name: "Auriculares Sony WH-1000XM5", lifecycle_stage: "growth", version: "2.0.0", launch_date: "2025-06-01", eol_date: null, quality_score: 96, market_share_pct: 15, revenue_ltm: 2_800_000, margin_pct: 45, bcg_quadrant: "star" },
  { id: "p3", internal_code: "PLM-003", name: "Monitor LG 27 IPS", lifecycle_stage: "decline", version: "1.5.0", launch_date: "2022-08-01", eol_date: "2027-01-01", quality_score: 78, market_share_pct: 8, revenue_ltm: 1_200_000, margin_pct: 12, bcg_quadrant: "dog" },
  { id: "p4", internal_code: "PLM-004", name: "Smartwatch Pro X", lifecycle_stage: "development", version: "0.9.0-beta", launch_date: null, eol_date: null, quality_score: 65, market_share_pct: 0, revenue_ltm: 0, margin_pct: 0, bcg_quadrant: "question_mark" },
  { id: "p5", internal_code: "PLM-005", name: "Mouse Logitech MX Master 3", lifecycle_stage: "growth", version: "1.0.0", launch_date: "2025-11-01", eol_date: null, quality_score: 89, market_share_pct: 12, revenue_ltm: 1_900_000, margin_pct: 38, bcg_quadrant: "star" },
];

const LIFECYCLE_STAGES = ["concept","development","testing","launch","growth","maturity","decline","eol","discontinued"];

export default function ProductLifecyclePage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"products" | "bcg" | "quality" | "roadmap">("products");
  const [products] = useState<PLMProduct[]>(MOCK_PRODUCTS);
  const [selected, setSelected] = useState<PLMProduct | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [showNew, setShowNew] = useState(false);

  const filtered = products.filter(p => stageFilter === "all" || p.lifecycle_stage === stageFilter);

  const advanceStage = (product: PLMProduct) => {
    const idx = LIFECYCLE_STAGES.indexOf(product.lifecycle_stage);
    if (idx < LIFECYCLE_STAGES.length - 2) {
      toast.success(`${product.name} avanzó a: ${STAGE_CONFIG[LIFECYCLE_STAGES[idx + 1]]?.label}`);
    }
  };

  // BCG data
  const bcgGroups: Record<string, PLMProduct[]> = { star: [], cash_cow: [], question_mark: [], dog: [] };
  products.forEach(p => { if (bcgGroups[p.bcg_quadrant]) bcgGroups[p.bcg_quadrant].push(p); });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="w-6 h-6 text-primary" /> Ciclo de Vida de Producto</h1>
          <p className="text-muted-foreground text-sm mt-1">PLM: etapas, versiones, calidad y matriz BCG</p>
        </div>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Nuevo Producto</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Agregar Producto al PLM</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div><Label>Código Interno</Label><Input placeholder="PLM-006" /></div>
              <div><Label>Nombre</Label><Input placeholder="Nombre del producto" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Etapa Inicial</Label>
                  <Select defaultValue="concept">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STAGE_CONFIG).slice(0, 6).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Versión</Label><Input defaultValue="1.0.0" /></div>
              </div>
              <Button className="w-full" onClick={() => { toast.success("Producto agregado al PLM"); setShowNew(false); }}>Agregar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stage summary */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {Object.entries(STAGE_CONFIG).slice(0, 7).map(([stage, cfg]) => {
          const count = products.filter(p => p.lifecycle_stage === stage).length;
          return (
            <button
              key={stage}
              onClick={() => setStageFilter(stage === stageFilter ? "all" : stage)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${stage === stageFilter ? "border-primary bg-primary text-primary-foreground" : cfg.color + " border-transparent"}`}
            >
              {cfg.label} {count > 0 && <span className="ml-1">({count})</span>}
            </button>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="products">Productos</TabsTrigger>
          <TabsTrigger value="bcg">Matriz BCG</TabsTrigger>
          <TabsTrigger value="quality">Calidad</TabsTrigger>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
        </TabsList>

        {/* PRODUCTS */}
        <TabsContent value="products" className="space-y-3">
          {filtered.map(product => (
            <Card key={product.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(product)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="text-2xl">{BCG_CONFIG[product.bcg_quadrant]?.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{product.internal_code}</span>
                    <span className="font-semibold">{product.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_CONFIG[product.lifecycle_stage]?.color}`}>
                      {STAGE_CONFIG[product.lifecycle_stage]?.label}
                    </span>
                    <span className="text-xs text-muted-foreground">v{product.version}</span>
                    {product.eol_date && <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">EOL: {product.eol_date}</Badge>}
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                    {product.revenue_ltm > 0 && <span>Revenue LTM: ${(product.revenue_ltm / 1_000_000).toFixed(1)}M</span>}
                    {product.market_share_pct > 0 && <span>Market share: {product.market_share_pct}%</span>}
                    {product.margin_pct > 0 && <span>Margen: {product.margin_pct}%</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">Calidad: {product.quality_score}/100</p>
                  <Progress value={product.quality_score} className="h-2 w-24" />
                </div>
                {!["eol","discontinued"].includes(product.lifecycle_stage) && (
                  <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); advanceStage(product); }}>
                    Avanzar <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* BCG MATRIX */}
        <TabsContent value="bcg">
          <div className="grid grid-cols-2 gap-4">
            {(["star","question_mark","cash_cow","dog"] as const).map(quadrant => {
              const cfg = BCG_CONFIG[quadrant];
              return (
                <Card key={quadrant} className={`border-2 ${cfg.color}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{cfg.label}</CardTitle>
                    <p className="text-xs text-muted-foreground">{cfg.desc}</p>
                  </CardHeader>
                  <CardContent>
                    {bcgGroups[quadrant].length === 0
                      ? <p className="text-xs text-muted-foreground italic">Sin productos</p>
                      : bcgGroups[quadrant].map(p => (
                        <div key={p.id} className="mb-2 last:mb-0">
                          <p className="font-medium text-sm">{p.name}</p>
                          <div className="flex gap-2 text-xs text-muted-foreground">
                            {p.market_share_pct > 0 && <span>Share: {p.market_share_pct}%</span>}
                            {p.revenue_ltm > 0 && <span>${(p.revenue_ltm / 1_000_000).toFixed(1)}M</span>}
                          </div>
                        </div>
                      ))
                    }
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Ejes: Cuota de mercado relativa (X) × Tasa de crecimiento del mercado (Y)
          </p>
        </TabsContent>

        {/* QUALITY */}
        <TabsContent value="quality" className="space-y-4">
          {products.map(p => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm">{p.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STAGE_CONFIG[p.lifecycle_stage]?.color}`}>{STAGE_CONFIG[p.lifecycle_stage]?.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={p.quality_score} className="flex-1 h-3" />
                    <span className={`text-sm font-bold ${p.quality_score >= 90 ? "text-green-600" : p.quality_score >= 70 ? "text-yellow-600" : "text-red-600"}`}>{p.quality_score}</span>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => toast.info("Iniciando auditoría de calidad...")}>
                  <Shield className="w-3 h-3 mr-1" />Auditar
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ROADMAP */}
        <TabsContent value="roadmap">
          <Card>
            <CardHeader><CardTitle className="text-sm">Pipeline de Desarrollo</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-6">
                {["concept","development","testing","launch"].map(stage => {
                  const stageProducts = products.filter(p => p.lifecycle_stage === stage);
                  if (stageProducts.length === 0) return null;
                  return (
                    <div key={stage}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-3 h-3 rounded-full ${stage === "concept" ? "bg-gray-400" : stage === "development" ? "bg-blue-500" : stage === "testing" ? "bg-indigo-500" : "bg-purple-500"}`} />
                        <span className="font-semibold text-sm">{STAGE_CONFIG[stage]?.label}</span>
                        <span className="text-xs text-muted-foreground">({stageProducts.length} productos)</span>
                      </div>
                      {stageProducts.map(p => (
                        <div key={p.id} className="ml-5 py-2 border-l-2 border-muted pl-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{p.name}</span>
                            <span className="text-xs text-muted-foreground">v{p.version}</span>
                          </div>
                          <Progress value={p.quality_score} className="h-1 w-32 mt-1" />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Product detail */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <Card className="w-full max-w-md" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <span className="font-mono text-xs text-muted-foreground">{selected.internal_code} · v{selected.version}</span>
                <CardTitle className="text-base">{selected.name}</CardTitle>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setSelected(null)}>✕</Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Etapa</p><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_CONFIG[selected.lifecycle_stage]?.color}`}>{STAGE_CONFIG[selected.lifecycle_stage]?.label}</span></div>
                <div><p className="text-xs text-muted-foreground">BCG</p><span>{BCG_CONFIG[selected.bcg_quadrant]?.label}</span></div>
                <div><p className="text-xs text-muted-foreground">Revenue LTM</p><p className="font-bold">${(selected.revenue_ltm / 1_000_000).toFixed(2)}M</p></div>
                <div><p className="text-xs text-muted-foreground">Margen</p><p className="font-bold">{selected.margin_pct}%</p></div>
                <div><p className="text-xs text-muted-foreground">Lanzamiento</p><p>{selected.launch_date ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">EOL</p><p>{selected.eol_date ?? "Sin definir"}</p></div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1"><span>Calidad</span><span className="font-bold">{selected.quality_score}/100</span></div>
                <Progress value={selected.quality_score} className="h-3" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
