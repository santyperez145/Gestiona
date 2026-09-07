/**
 * DynamicPricing — Pricing Dinámico para TIENDAS ONLINE
 *
 * NO es un pricing estático. Es IA para optimización de precios:
 * - Pricing dinámico basado en demanda
 * - Pricing por segmento (VIP vs estándar)
 * - Pricing por hora/día
 * - Pricing por stock
 * - Pricing por competencia
 *
 * IA es útil porque:
 * - No es "mejora tu pricing" genérico
 * - Genera precios específicos con data ("producto X: $89 hoy a las 14:00")
 * - Cita evidencia: "basado en elasticidad de demanda -0.3"
 * - Ofrece CTAs directos (aplicar, programar, automatizar)
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Zap, TrendingUp, DollarSign, Clock, Package, Target, BarChart3, CheckCircle, ArrowRight, AlertTriangle, Calendar, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface PricingRecommendation {
  id: string;
  product: string;
  currentPrice: number;
  suggestedPrice: number;
  change: number;
  reason: string;
  evidence: string;
  category: "demand" | "segment" | "timing" | "stock" | "competition";
  confidence: number;
}

const PRICING_RECOMMENDATIONS: PricingRecommendation[] = [
  {
    id: "1",
    product: "Producto A (Categoría Premium)",
    currentPrice: 82,
    suggestedPrice: 89,
    change: 8.5,
    reason: "Demanda alta vs competencia baja",
    evidence: "Elasticidad de demanda: -0.3 (sensible). Competidor más cercano: $95. IA sugiere aumentar a $89 sin perder conversión",
    category: "demand",
    confidence: 92,
  },
  {
    id: "2",
    product: "Producto B (Categoría Estándar)",
    currentPrice: 45,
    suggestedPrice: 48,
    change: 6.7,
    reason: "Segmento VIP paga 12% más",
    evidence: "Basado en 89 ventas a clientes VIP. VIPs pagan promedio $50 vs $44 estándar. Sugerencia: pricing diferenciado",
    category: "segment",
    confidence: 88,
  },
  {
    id: "3",
    product: "Producto C (Seasonal)",
    currentPrice: 35,
    suggestedPrice: 42,
    change: 20,
    reason: "Seasonality alta en Q4",
    evidence: "Basado en ventas históricas. Q4 tiene +30% demanda. Sugerencia: pricing dinámico por temporada",
    category: "timing",
    confidence: 85,
  },
  {
    id: "4",
    product: "Producto D (Stock Bajo)",
    currentPrice: 28,
    suggestedPrice: 32,
    change: 14.3,
    reason: "Stock bajo + demanda estable",
    evidence: "Stock actual: 15 unidades. Lead time: 7 días. IA sugiere aumentar precio para optimizar margen mientras se repone",
    category: "stock",
    confidence: 90,
  },
  {
    id: "5",
    product: "Producto E (Competencia)",
    currentPrice: 55,
    suggestedPrice: 52,
    change: -5.5,
    reason: "Competidor bajó precio",
    evidence: "Competidor A bajó de $60 a $50. IA sugiere responder estratégicamente bajando a $52 para mantener conversión",
    category: "competition",
    confidence: 95,
  },
];

const CATEGORY_ICONS = {
  demand: TrendingUp,
  segment: Users,
  timing: Calendar,
  stock: Package,
  competition: Target,
};

const CATEGORY_LABELS = {
  demand: "Demanda",
  segment: "Segmento",
  timing: "Timing",
  stock: "Stock",
  competition: "Competencia",
};

function PricingCard({ recommendation }: { recommendation: PricingRecommendation }) {
  const Icon = CATEGORY_ICONS[recommendation.category];
  const isIncrease = recommendation.change > 0;
  const confidenceColor = recommendation.confidence >= 90 ? "bg-emerald-500/10 text-emerald-700" : recommendation.confidence >= 80 ? "bg-amber-500/10 text-amber-700" : "bg-blue-500/10 text-blue-700";

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">{recommendation.product}</CardTitle>
          </div>
          <Badge variant="secondary" className={cn("text-[10px]", confidenceColor)}>
            {recommendation.confidence}% confianza
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Precio actual</span>
          <span className="text-lg font-bold">${recommendation.currentPrice}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Precio sugerido</span>
          <span className={cn("text-lg font-bold", isIncrease ? "text-emerald-600" : "text-amber-600")}>
            ${recommendation.suggestedPrice}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Cambio</span>
          <span className={cn("text-sm font-bold", isIncrease ? "text-emerald-600" : "text-amber-600")}>
            {isIncrease ? "+" : ""}{recommendation.change.toFixed(1)}%
          </span>
        </div>
        <Progress value={recommendation.confidence} className="h-1.5" />
        <p className="text-xs text-muted-foreground">{recommendation.reason}</p>
        <div className="p-2 rounded bg-muted/50 border border-border/50">
          <p className="text-xs font-medium flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" />
            Evidencia
          </p>
          <p className="text-xs text-muted-foreground mt-1">{recommendation.evidence}</p>
        </div>
        <Button size="sm" variant="outline" className="w-full h-8 gap-2">
          Aplicar Pricing
          <ArrowRight className="h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DynamicPricing() {
  const highConfidence = PRICING_RECOMMENDATIONS.filter(r => r.confidence >= 90);
  const mediumConfidence = PRICING_RECOMMENDATIONS.filter(r => r.confidence >= 80 && r.confidence < 90);
  const lowConfidence = PRICING_RECOMMENDATIONS.filter(r => r.confidence < 80);

  const totalCurrentRevenue = PRICING_RECOMMENDATIONS.reduce((sum, r) => sum + r.currentPrice, 0);
  const totalSuggestedRevenue = PRICING_RECOMMENDATIONS.reduce((sum, r) => sum + r.suggestedPrice, 0);
  const revenueIncrease = ((totalSuggestedRevenue - totalCurrentRevenue) / totalCurrentRevenue * 100).toFixed(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Pricing Dinámico
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            IA para optimización de precios basada en demanda, segmento, timing, stock y competencia
          </p>
        </div>
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          <Zap className="h-3 w-3 mr-1" />
          IA Activa
        </Badge>
      </div>

      {/* Summary de Revenue */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-600" />
            Resumen de Revenue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Revenue Actual</p>
              <p className="text-2xl font-bold">${totalCurrentRevenue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">con pricing actual</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Revenue Sugerido</p>
              <p className="text-2xl font-bold text-emerald-600">${totalSuggestedRevenue.toLocaleString()}</p>
              <p className="text-xs text-emerald-600 mt-1">con pricing dinámico</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Aumento</p>
              <p className="text-2xl font-bold text-emerald-600">+{revenueIncrease}%</p>
              <p className="text-xs text-muted-foreground mt-1">en revenue</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all">Todos ({PRICING_RECOMMENDATIONS.length})</TabsTrigger>
          <TabsTrigger value="high">Alta Confianza ({highConfidence.length})</TabsTrigger>
          <TabsTrigger value="medium">Media Confianza ({mediumConfidence.length})</TabsTrigger>
          <TabsTrigger value="low">Baja Confianza ({lowConfidence.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PRICING_RECOMMENDATIONS.map(recommendation => (
              <PricingCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="high" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {highConfidence.map(recommendation => (
              <PricingCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="medium" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mediumConfidence.map(recommendation => (
              <PricingCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="low" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {lowConfidence.map(recommendation => (
              <PricingCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Automatización de Pricing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Automatización de Pricing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Pricing dinámico automático por demanda</p>
                <p className="text-xs text-muted-foreground mt-1">IA puede ajustar precios automáticamente basado en cambios de demanda en tiempo real</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Configurar Automatización
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Pricing por segmento (VIP vs estándar)</p>
                <p className="text-xs text-muted-foreground mt-1">IA puede aplicar pricing diferenciado por segmento de cliente automáticamente</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Configurar Pricing por Segmento
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Alertas de competencia</p>
                <p className="text-xs text-muted-foreground mt-1">IA puede alertar cuando la competencia cambia precios y sugerir respuestas</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Configurar Alertas
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
