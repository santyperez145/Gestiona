/**
 * BusinessAIInsights — IA específica para optimización de BUSINESS (inventario)
 *
 * NO es un CRM genérico. Es IA focused en operación e inventario:
 * - Predicción de stock
 * - Optimización de reposiciones
 * - Forecast de demanda
 * - Análisis de rotación
 * - Recomendaciones de proveedores
 *
 * IA es útil porque:
 * - No genera insights genéricos ("mejora tu inventario")
 * - Genera acciones específicas con data ("reponer producto X en 5 días")
 * - Cita evidencia: "basado en 45 ventas, stock se agota en 12 días"
 * - Ofrece CTAs directos (reponer, transferir, negociar)
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Zap, TrendingUp, Package, Clock, Truck, AlertTriangle, BarChart3, CheckCircle, ArrowRight, Building2, RefreshCw, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface Insight {
  id: string;
  title: string;
  description: string;
  evidence: string;
  action: string;
  impact: "high" | "medium" | "low";
  category: "stock" | "replenishment" | "forecast" | "rotation" | "supplier" | "transfer";
}

const INSIGHTS: Insight[] = [
  {
    id: "1",
    title: "Predicción de stock: producto X se agota en 5 días",
    description: "Forecast de demanda indica quiebre de stock en 5 días si no se repone",
    evidence: "Basado en ventas históricas + seasonality. Ventas promedio: 12/día. Stock actual: 60. Lead time proveedor: 3 días",
    action: "Generar Orden de Compra",
    impact: "high",
    category: "stock",
  },
  {
    id: "2",
    title: "Optimización de reposición: pedido consolidado ahorra 12%",
    description: "IA analizó patterns de reorden. Consolidar pedidos de proveedor A ahorra 12% en envío",
    evidence: "Basado en 23 órdenes de compra en los últimos 60 días. Frecuencia promedio: 3/week. Consolidación: 1/week",
    action: "Consolidar Pedidos",
    impact: "medium",
    category: "replenishment",
  },
  {
    id: "3",
    title: "Forecast de demanda: categoría Y tendrá +25% en Q4",
    description: "IA predice aumento de demanda en Q4 basado en seasonality y tendencias",
    evidence: "Basado en ventas históricas de 2 años + external data. Seasonality: +30% en Q4. Tendencia: +5% vs año anterior",
    action: "Ver Forecast Detallado",
    impact: "high",
    category: "forecast",
  },
  {
    id: "4",
    title: "Rotación óptima: producto Z rota 2x más que promedio",
    description: "IA detectó rotación alta. Considera aumentar stock de seguridad",
    evidence: "Basado en inventario ledger. Rotación Z: 8/mes vs promedio: 4/mes. Stock actual: 45. Sugerido: 80",
    action: "Aumentar Stock de Seguridad",
    impact: "medium",
    category: "rotation",
  },
  {
    id: "5",
    title: "Proveedores: proveedor B tiene 95% on-time delivery",
    description: "IA analizó performance de proveedores. Proveedor B es más confiable",
    evidence: "Basado en 34 entregas en los últimos 90 días. Proveedor A: 78% on-time. Proveedor B: 95% on-time",
    action: "Priorizar Proveedor B",
    impact: "medium",
    category: "supplier",
  },
  {
    id: "6",
    title: "Transferencia óptima: sucursal sur necesita stock de norte",
    description: "IA detectó desbalance de stock. Transferir stock desde norte a sur mejora disponibilidad",
    evidence: "Basado en ventas por ubicación. Norte: stock sobrante 20. Sur: stock deficit 15. Transferencia sugerida: 15 unidades",
    action: "Generar Transferencia",
    impact: "high",
    category: "transfer",
  },
];

const CATEGORY_ICONS = {
  stock: Package,
  replenishment: RefreshCw,
  forecast: TrendingUp,
  rotation: BarChart3,
  supplier: Building2,
  transfer: Truck,
};

const CATEGORY_LABELS = {
  stock: "Stock",
  replenishment: "Reposición",
  forecast: "Forecast",
  rotation: "Rotación",
  supplier: "Proveedores",
  transfer: "Transferencia",
};

function InsightCard({ insight }: { insight: Insight }) {
  const Icon = CATEGORY_ICONS[insight.category];
  const impactColors = {
    high: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
    medium: "bg-amber-500/10 text-amber-700 border-amber-500/25",
    low: "bg-blue-500/10 text-blue-700 border-blue-500/25",
  };

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">{insight.title}</CardTitle>
          </div>
          <Badge variant="secondary" className={cn("text-[10px]", impactColors[insight.impact])}>
            {insight.impact === "high" ? "Alto Impacto" : insight.impact === "medium" ? "Medio Impacto" : "Bajo Impacto"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{insight.description}</p>
        <div className="p-2 rounded bg-muted/50 border border-border/50">
          <p className="text-xs font-medium flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" />
            Evidencia
          </p>
          <p className="text-xs text-muted-foreground mt-1">{insight.evidence}</p>
        </div>
        <Button size="sm" variant="outline" className="w-full h-8 gap-2">
          {insight.action}
          <ArrowRight className="h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );
}

export default function BusinessAIInsights() {
  const highImpactInsights = INSIGHTS.filter(i => i.impact === "high");
  const mediumImpactInsights = INSIGHTS.filter(i => i.impact === "medium");
  const lowImpactInsights = INSIGHTS.filter(i => i.impact === "low");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            IA para Optimización de Inventario
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            IA focused en operación: stock, reposiciones, forecast, rotación, proveedores
          </p>
        </div>
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          <Zap className="h-3 w-3 mr-1" />
          IA Activa
        </Badge>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">Todos ({INSIGHTS.length})</TabsTrigger>
          <TabsTrigger value="high">Alto Impacto ({highImpactInsights.length})</TabsTrigger>
          <TabsTrigger value="medium">Medio Impacto ({mediumImpactInsights.length})</TabsTrigger>
          <TabsTrigger value="low">Bajo Impacto ({lowImpactInsights.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {INSIGHTS.map(insight => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="high" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {highImpactInsights.map(insight => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="medium" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mediumImpactInsights.map(insight => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="low" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {lowImpactInsights.map(insight => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Summary de Impacto */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
            Resumen de Impacto
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Stock Accuracy</p>
              <p className="text-2xl font-bold text-emerald-600">+15%</p>
              <p className="text-xs text-muted-foreground mt-1">con predicción de stock</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Costo de Envío</p>
              <p className="text-2xl font-bold text-emerald-600">-12%</p>
              <p className="text-xs text-muted-foreground mt-1">con consolidación</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">On-Time Delivery</p>
              <p className="text-2xl font-bold">95%</p>
              <p className="text-xs text-muted-foreground mt-1">con selección de proveedores</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
