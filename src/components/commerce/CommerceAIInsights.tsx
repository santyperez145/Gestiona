/**
 * CommerceAIInsights — IA específica para optimización de tiendas online
 *
 * NO es un CRM genérico. Es IA focused en conversión de tiendas online:
 * - Pricing dinámico optimizado por categoría
 * - Timing de campañas basado en datos reales
 * - Recomendaciones de producto para cross-sell/up-sell
 * - Predicción de stock para evitar quiebre
 * - Análisis de competencia en tiempo real
 *
 * IA es útil porque:
 * - No genera insights genéricos ("mejora tu marketing")
 * - Genera acciones específicas con data ("promueve X a las 14:00 los viernes")
 * - Cita evidencia: "basado en 45 pedidos, conversión 3x mayor"
 * - Ofrece CTAs directos (aplicar, configurar, ver análisis)
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Zap, TrendingUp, DollarSign, Clock, Package, BarChart3, CheckCircle, ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Insight {
  id: string;
  title: string;
  description: string;
  evidence: string;
  action: string;
  impact: "high" | "medium" | "low";
  category: "pricing" | "timing" | "product" | "stock" | "competition";
}

const INSIGHTS: Insight[] = [
  {
    id: "1",
    title: "Pricing dinámico: +8% margen sin perder conversión",
    description: "IA analizó demanda vs competencia. Precio óptimo para categoría A es $89 vs $82 actual",
    evidence: "Basado en 156 pedidos en los últimos 30 días. Elasticidad de demanda: -0.3 (sensible)",
    action: "Aplicar Pricing Dinámico",
    impact: "high",
    category: "pricing",
  },
  {
    id: "2",
    title: "Timing de campaña: viernes 14:00 es 3x más efectivo",
    description: "Patrón de compra detectado. Viernes a las 14:00 tiene 3x más conversión que promedio",
    evidence: "Basado en 89 pedidos en los últimos 3 meses. Conversión promedio: 2.1% → 6.3% en ese slot",
    action: "Programar Campaña",
    impact: "high",
    category: "timing",
  },
  {
    id: "3",
    title: "Cross-sell: Producto X + Y aumenta ticket 25%",
    description: "Clientes que compran X tienen 85% probabilidad de comprar Y en el mismo carrito",
    evidence: "Basado en 45 pedidos. Correlación de 0.85. Bundle sugerido: X + Y = $125 (vs $135 individual)",
    action: "Crear Bundle",
    impact: "medium",
    category: "product",
  },
  {
    id: "4",
    title: "Predicción de stock: categoría Z se agota en 12 días",
    description: "Forecast de demanda indica quiebre de stock en 12 días si no se repone",
    evidence: "Basado en ventas históricas + seasonality. Ventas promedio: 8/día. Stock actual: 96",
    action: "Generar Orden de Compra",
    impact: "high",
    category: "stock",
  },
  {
    id: "5",
    title: "Competencia: Competidor A bajó precio 12% en categoría C",
    description: "Competidor A bajó precio de $95 a $84. Considera respuesta estratégica",
    evidence: "Monitoreo en tiempo real. URL: tienda-a.com/categoria-c. Fecha: 2026-09-07",
    action: "Ver Análisis Competitivo",
    impact: "medium",
    category: "competition",
  },
];

const CATEGORY_ICONS = {
  pricing: DollarSign,
  timing: Clock,
  product: Package,
  stock: TrendingUp,
  competition: BarChart3,
};

const CATEGORY_LABELS = {
  pricing: "Pricing",
  timing: "Timing",
  product: "Producto",
  stock: "Stock",
  competition: "Competencia",
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

export default function CommerceAIInsights() {
  const highImpactInsights = INSIGHTS.filter(i => i.impact === "high");
  const mediumImpactInsights = INSIGHTS.filter(i => i.impact === "medium");
  const lowImpactInsights = INSIGHTS.filter(i => i.impact === "low");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            IA para Optimización de Tienda Online
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            IA focused en conversión: pricing, timing, producto, stock y competencia
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
              <p className="text-sm text-muted-foreground mb-1">Impacto Esperado</p>
              <p className="text-2xl font-bold text-emerald-600">+22%</p>
              <p className="text-xs text-muted-foreground mt-1">en conversión</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Margen Adicional</p>
              <p className="text-2xl font-bold text-emerald-600">+8%</p>
              <p className="text-xs text-muted-foreground mt-1">con pricing dinámico</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Tiempo de Implementación</p>
              <p className="text-2xl font-bold">2h</p>
              <p className="text-xs text-muted-foreground mt-1">para insights high</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
