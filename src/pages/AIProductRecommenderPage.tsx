import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sparkles,
  RefreshCw,
  Search,
  Package,
  TrendingUp,
  ShoppingBag,
  ArrowRight,
  BarChart3,
  Zap,
  Target,
  Plus,
  Trash2,
  Edit,
  Brain,
  CheckCircle,
  AlertCircle,
  Download,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string | null;
  image_url?: string | null;
}

interface Cooccurrence {
  product_a_id: string;
  product_b_id: string;
  cooccurrence_count: number;
  last_seen_at: string;
}

interface RecommendationRule {
  id: string;
  org_id: string;
  name: string;
  rule_type: "cross_sell" | "upsell" | "bundle" | "new_arrivals" | "seasonal";
  trigger_product_id: string | null;
  recommended_product_id: string | null;
  position: number;
  active: boolean;
  created_at: string;
  trigger_product?: Product;
  recommended_product?: Product;
}

interface RecommendationEvent {
  id: string;
  event_type: "impression" | "click" | "purchase";
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RULE_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType; description: string }
> = {
  cross_sell: { label: "Cross-sell", color: "bg-blue-500/15 text-blue-400", icon: ArrowRight, description: "Productos complementarios" },
  upsell: { label: "Upsell", color: "bg-violet-500/15 text-violet-400", icon: TrendingUp, description: "Versión superior" },
  bundle: { label: "Bundle", color: "bg-amber-500/15 text-amber-400", icon: ShoppingBag, description: "Paquete combinado" },
  new_arrivals: { label: "Novedades", color: "bg-emerald-500/15 text-emerald-400", icon: Sparkles, description: "Productos nuevos" },
  seasonal: { label: "Estacional", color: "bg-orange-500/15 text-orange-400", icon: Target, description: "Temporada actual" },
};

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

// ─── Rule Form ────────────────────────────────────────────────────────────────

interface RuleFormProps {
  open: boolean;
  rule: RecommendationRule | null;
  products: Product[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function RuleForm({ open, rule, products, orgId, onClose, onSaved }: RuleFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState("cross_sell");
  const [triggerId, setTriggerId] = useState("none");
  const [recommendedId, setRecommendedId] = useState("none");
  const [position, setPosition] = useState("0");

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setRuleType(rule.rule_type);
      setTriggerId(rule.trigger_product_id ?? "none");
      setRecommendedId(rule.recommended_product_id ?? "none");
      setPosition(String(rule.position));
    } else {
      setName(""); setRuleType("cross_sell"); setTriggerId("none"); setRecommendedId("none"); setPosition("0");
    }
  }, [rule, open]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nombre requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId,
      name: name.trim(),
      rule_type: ruleType,
      trigger_product_id: triggerId === "none" ? null : triggerId,
      recommended_product_id: recommendedId === "none" ? null : recommendedId,
      position: parseInt(position) || 0,
    };
    const { error } = rule
      ? await supabase.from("recommendation_rules").update(payload).eq("id", rule.id)
      : await supabase.from("recommendation_rules").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error al guardar"); return; }
    toast.success(rule ? "Regla actualizada" : "Regla creada");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar regla" : "Nueva regla de recomendación"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nombre *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Accesorios para celulares" />
          </div>
          <div>
            <Label>Tipo de recomendación</Label>
            <Select value={ruleType} onValueChange={setRuleType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(RULE_TYPE_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label} — {v.description}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Producto trigger (cuando el cliente ve/compra...)</Label>
            <Select value={triggerId} onValueChange={setTriggerId}>
              <SelectTrigger><SelectValue placeholder="Cualquier producto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Cualquier producto</SelectItem>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Producto recomendado</Label>
            <Select value={recommendedId} onValueChange={setRecommendedId}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin especificar</SelectItem>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} — {fmtCurrency(p.price)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Posición (orden de display)</Label>
            <Input type="number" value={position} onChange={e => setPosition(e.target.value)} min="0" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {rule ? "Guardar" : "Crear regla"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AIProductRecommenderPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [products, setProducts] = useState<Product[]>([]);
  const [rules, setRules] = useState<RecommendationRule[]>([]);
  const [cooccurrences, setCooccurrences] = useState<Cooccurrence[]>([]);
  const [events, setEvents] = useState<RecommendationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RecommendationRule | null>(null);
  const [searchProduct, setSearchProduct] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"ai" | "manual" | "analytics">("ai");

  const loadAll = async () => {
    if (!orgId) return;
    setLoading(true);
    const [prodRes, ruleRes, coRes, evRes] = await Promise.all([
      supabase.from("products").select("id,name,price,stock,category,image_url").eq("org_id", orgId).order("name"),
      supabase.from("recommendation_rules").select("*").eq("org_id", orgId).order("position"),
      supabase.from("product_cooccurrences").select("*").eq("org_id", orgId).order("cooccurrence_count", { ascending: false }).limit(500),
      supabase.from("recommendation_events").select("id,event_type,created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1000),
    ]);
    setProducts(prodRes.data ?? []);
    setRules(ruleRes.data ?? []);
    setCooccurrences(coRes.data ?? []);
    setEvents(evRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [orgId]);

  // Enrich rules with product data
  const enrichedRules = useMemo(() => {
    return rules.map(r => ({
      ...r,
      trigger_product: products.find(p => p.id === r.trigger_product_id),
      recommended_product: products.find(p => p.id === r.recommended_product_id),
    }));
  }, [rules, products]);

  // AI recommendations from co-occurrences for selected product
  const aiRecs = useMemo(() => {
    if (!selectedProductId) return [];
    return cooccurrences
      .filter(c => c.product_a_id === selectedProductId || c.product_b_id === selectedProductId)
      .map(c => {
        const recId = c.product_a_id === selectedProductId ? c.product_b_id : c.product_a_id;
        const product = products.find(p => p.id === recId);
        return { product, score: c.cooccurrence_count, last_seen_at: c.last_seen_at };
      })
      .filter(r => r.product)
      .slice(0, 10);
  }, [selectedProductId, cooccurrences, products]);

  // Analytics
  const analytics = useMemo(() => {
    const impressions = events.filter(e => e.event_type === "impression").length;
    const clicks = events.filter(e => e.event_type === "click").length;
    const purchases = events.filter(e => e.event_type === "purchase").length;
    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : "0.0";
    const cvr = clicks > 0 ? ((purchases / clicks) * 100).toFixed(1) : "0.0";
    return { impressions, clicks, purchases, ctr, cvr };
  }, [events]);

  const filteredProducts = useMemo(() => {
    if (!searchProduct) return products.slice(0, 20);
    return products.filter(p => p.name.toLowerCase().includes(searchProduct.toLowerCase())).slice(0, 20);
  }, [products, searchProduct]);

  const handleRebuildCooccurrences = async () => {
    setRebuilding(true);
    const { error } = await supabase.rpc("rebuild_cooccurrences", { p_org_id: orgId });
    setRebuilding(false);
    if (error) { toast.error("Error al reconstruir: " + error.message); return; }
    toast.success("Co-ocurrencias actualizadas con historial de ventas");
    loadAll();
  };

  const handleToggleRule = async (rule: RecommendationRule) => {
    const { error } = await supabase.from("recommendation_rules").update({ active: !rule.active }).eq("id", rule.id);
    if (error) { toast.error("Error"); return; }
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
  };

  const handleDeleteRule = async (rule: RecommendationRule) => {
    if (!confirm("¿Eliminar esta regla?")) return;
    await supabase.from("recommendation_rules").delete().eq("id", rule.id);
    setRules(prev => prev.filter(r => r.id !== rule.id));
    toast.success("Regla eliminada");
  };

  const exportCSV = () => {
    const rows = [
      ["Trigger", "Recomendado", "Co-ocurrencias", "Última vez"],
      ...cooccurrences.slice(0, 200).map(c => {
        const pa = products.find(p => p.id === c.product_a_id)?.name ?? c.product_a_id;
        const pb = products.find(p => p.id === c.product_b_id)?.name ?? c.product_b_id;
        return [pa, pb, c.cooccurrence_count, c.last_seen_at];
      }),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "cooccurrencias.csv"; a.click();
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            AI Recomendador de Productos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Cross-sell & upsell basado en co-ocurrencias de ventas + reglas manuales
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4 mr-1.5" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleRebuildCooccurrences} disabled={rebuilding}>
            {rebuilding ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <Zap className="w-4 h-4 mr-1.5" />}
            Recalcular IA
          </Button>
          <Button size="sm" onClick={() => { setEditingRule(null); setRuleDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Nueva regla
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: "Pares detectados", value: cooccurrences.length, icon: Brain, color: "text-primary" },
          { label: "Reglas activas", value: enrichedRules.filter(r => r.active).length, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Impresiones", value: analytics.impressions, icon: BarChart3, color: "text-blue-400" },
          { label: "CTR", value: `${analytics.ctr}%`, icon: Target, color: "text-amber-400" },
          { label: "Conversión", value: `${analytics.cvr}%`, icon: TrendingUp, color: "text-violet-400" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className={`w-4 h-4 ${k.color}`} />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-2xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["ai", "manual", "analytics"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "ai" ? "🤖 Recomendaciones IA" : tab === "manual" ? "📋 Reglas manuales" : "📊 Analytics"}
          </button>
        ))}
      </div>

      {/* ── AI Tab ── */}
      {activeTab === "ai" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Product selector */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Seleccioná un producto para ver recomendaciones</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar producto..."
                value={searchProduct}
                onChange={e => setSearchProduct(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {filteredProducts.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProductId(p.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all hover:bg-muted/30 ${
                    selectedProductId === p.id ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtCurrency(p.price)} · Stock: {p.stock}</p>
                  </div>
                  {selectedProductId === p.id && <CheckCircle className="w-4 h-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Recommendations panel */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {selectedProductId
                ? `Recomendaciones para "${products.find(p => p.id === selectedProductId)?.name ?? ""}"`
                : "Seleccioná un producto"}
            </h3>
            {!selectedProductId ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                <Brain className="w-10 h-10 mb-2 opacity-30" />
                <p>Elegí un producto para ver con qué se combina más</p>
              </div>
            ) : aiRecs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                <AlertCircle className="w-8 h-8 mb-2 opacity-30" />
                <p>Sin datos de co-ocurrencia aún</p>
                <p className="text-xs mt-1">Hacé clic en "Recalcular IA" para procesar el historial de ventas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {aiRecs.map((rec, i) => {
                  const maxScore = aiRecs[0]?.score ?? 1;
                  const pct = Math.round((rec.score / maxScore) * 100);
                  return (
                    <div key={rec.product?.id} className="p-3 rounded-lg border border-border bg-card/50 flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{rec.product?.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 bg-muted rounded-full h-1.5">
                            <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">{rec.score}x juntos</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold">{fmtCurrency(rec.product?.price ?? 0)}</p>
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(rec.last_seen_at), { addSuffix: true, locale: es })}</p>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground text-center pt-1">
                  Basado en análisis de {cooccurrences.length} pares de co-ocurrencia de ventas históricas
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Manual Rules Tab ── */}
      {activeTab === "manual" && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-12"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : enrichedRules.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin reglas manuales</p>
              <p className="text-sm">Creá reglas de cross-sell y upsell personalizadas</p>
            </div>
          ) : enrichedRules.map(rule => {
            const tc = RULE_TYPE_CONFIG[rule.rule_type] ?? RULE_TYPE_CONFIG.cross_sell;
            const RuleIcon = tc.icon;
            return (
              <div key={rule.id} className={`flex items-center gap-3 p-4 rounded-lg border bg-card/50 transition-all ${!rule.active ? "opacity-50" : ""}`}>
                <div className={`p-2 rounded-lg ${tc.color.replace("text-", "bg-").replace("-400", "-500/10")}`}>
                  <RuleIcon className={`w-4 h-4 ${tc.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{rule.name}</span>
                    <Badge className={`text-xs ${tc.color}`}>{tc.label}</Badge>
                    {!rule.active && <Badge className="text-xs bg-gray-500/15 text-gray-400">Inactiva</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rule.trigger_product
                      ? `Cuando compra: ${rule.trigger_product.name}`
                      : "Para cualquier compra"}
                    {rule.recommended_product ? ` → Recomendar: ${rule.recommended_product.name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => handleToggleRule(rule)}>
                    {rule.active ? "Desactivar" : "Activar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingRule(rule as any); setRuleDialogOpen(true); }}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeleteRule(rule)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-card p-5 text-center">
              <p className="text-4xl font-bold text-blue-400">{analytics.impressions.toLocaleString("es-AR")}</p>
              <p className="text-sm text-muted-foreground mt-1">Impresiones totales</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 text-center">
              <p className="text-4xl font-bold text-amber-400">{analytics.ctr}%</p>
              <p className="text-sm text-muted-foreground mt-1">Click-Through Rate</p>
              <p className="text-xs text-muted-foreground">{analytics.clicks} clics</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 text-center">
              <p className="text-4xl font-bold text-emerald-400">{analytics.cvr}%</p>
              <p className="text-sm text-muted-foreground mt-1">Tasa de conversión</p>
              <p className="text-xs text-muted-foreground">{analytics.purchases} compras</p>
            </div>
          </div>

          {/* Top co-occurrences table */}
          <div>
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Top pares de productos más vendidos juntos
            </h3>
            {cooccurrences.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Hacé clic en "Recalcular IA" para analizar el historial de ventas
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">#</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Producto A</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Producto B</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Veces juntos</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Última vez</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cooccurrences.slice(0, 20).map((c, i) => {
                      const pa = products.find(p => p.id === c.product_a_id)?.name ?? "—";
                      const pb = products.find(p => p.id === c.product_b_id)?.name ?? "—";
                      return (
                        <tr key={c.product_a_id + c.product_b_id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium truncate max-w-48">{pa}</td>
                          <td className="px-4 py-2.5 text-muted-foreground truncate max-w-48">{pb}</td>
                          <td className="px-4 py-2.5 text-right font-bold">{c.cooccurrence_count}x</td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(c.last_seen_at), { addSuffix: true, locale: es })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <RuleForm
        open={ruleDialogOpen}
        rule={editingRule}
        products={products}
        orgId={orgId}
        onClose={() => { setRuleDialogOpen(false); setEditingRule(null); }}
        onSaved={loadAll}
      />
    </div>
  );
}
