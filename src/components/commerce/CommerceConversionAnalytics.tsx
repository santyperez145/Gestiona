/**
 * CommerceConversionAnalytics — Analytics de conversión para Commerce
 *
 * Features:
 * - Funnel de conversión
 * - Cohortes de conversión
 * - Attribution por source
 * - Heatmap de abandono
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Users, ShoppingCart, DollarSign, Clock, ArrowRight, Globe, Mail, Share2, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface FunnelStep {
  label: string;
  count: number;
  percentage: number;
  icon: React.ElementType;
}

const FUNNEL_STEPS: FunnelStep[] = [
  { label: "Visitas", count: 1250, percentage: 100, icon: Globe },
  { label: "View Producto", count: 875, percentage: 70, icon: ShoppingCart },
  { label: "Add to Cart", count: 350, percentage: 28, icon: ShoppingCart },
  { label: "Checkout Iniciado", count: 280, percentage: 22, icon: DollarSign },
  { label: "Pedido Completado", count: 168, percentage: 13, icon: TrendingUp },
];

interface CohortData {
  cohort: string;
  size: number;
  conversion: number;
  retention: number[];
}

const COHORT_DATA: CohortData[] = [
  { cohort: "Semana 1", size: 45, conversion: 12, retention: [100, 75, 60, 50, 45] },
  { cohort: "Semana 2", size: 52, conversion: 15, retention: [100, 80, 65, 55, 48] },
  { cohort: "Semana 3", size: 38, conversion: 10, retention: [100, 70, 55, 45, 40] },
  { cohort: "Semana 4", size: 41, conversion: 11, retention: [100, 72, 58, 48, 42] },
];

interface AttributionSource {
  source: string;
  icon: React.ElementType;
  visits: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
}

const ATTRIBUTION_SOURCES: AttributionSource[] = [
  { source: "Directo", icon: Globe, visits: 450, conversions: 67, revenue: 12300, conversionRate: 14.9 },
  { source: "Email", icon: Mail, visits: 320, conversions: 48, revenue: 8900, conversionRate: 15.0 },
  { source: "Social", icon: Share2, visits: 280, conversions: 28, revenue: 5200, conversionRate: 10.0 },
  { source: "SEO", icon: Search, visits: 200, conversions: 25, revenue: 4600, conversionRate: 12.5 },
];

export default function CommerceConversionAnalytics() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="funnel" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="cohorts">Cohortes</TabsTrigger>
          <TabsTrigger value="attribution">Attribution</TabsTrigger>
        </TabsList>

        {/* Funnel de Conversión */}
        <TabsContent value="funnel" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Funnel de Conversión
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {FUNNEL_STEPS.map((step, index) => {
                const Icon = step.icon;
                const dropRate = index > 0 ? ((FUNNEL_STEPS[index - 1].count - step.count) / FUNNEL_STEPS[index - 1].count * 100).toFixed(1) : "0";
                return (
                  <div key={step.label} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{step.label}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-bold">{step.count.toLocaleString()}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {step.percentage}%
                        </Badge>
                        {index > 0 && (
                          <Badge variant="outline" className="text-[10px] text-destructive">
                            -{dropRate}%
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Progress value={step.percentage} className="h-2" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Heatmap de Abandono */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Heatmap de Abandono
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-muted-foreground">{day}</div>
                ))}
                {["00:00", "06:00", "12:00", "18:00"].map((time) => (
                  <>
                    <div key={time} className="text-center text-xs font-medium text-muted-foreground">{time}</div>
                    {Array.from({ length: 7 }).map((_, i) => {
                      const intensity = Math.random();
                      const bgColor = intensity > 0.7 ? "bg-destructive/80" : intensity > 0.4 ? "bg-amber-500/60" : "bg-emerald-500/40";
                      return (
                        <div
                          key={`${time}-${i}`}
                          className={cn("h-8 rounded", bgColor)}
                          title={`Abandono: ${(intensity * 100).toFixed(0)}%`}
                        />
                      );
                    })}
                  </>
                ))}
              </div>
              <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-emerald-500/40" />
                  <span>Bajo</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-amber-500/60" />
                  <span>Medio</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-destructive/80" />
                  <span>Alto</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cohortes de Conversión */}
        <TabsContent value="cohorts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Cohortes de Conversión
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">Cohorte</th>
                      <th className="text-right py-2 px-3 font-medium">Tamaño</th>
                      <th className="text-right py-2 px-3 font-medium">Conversión</th>
                      <th className="text-center py-2 px-3 font-medium">Semana 1</th>
                      <th className="text-center py-2 px-3 font-medium">Semana 2</th>
                      <th className="text-center py-2 px-3 font-medium">Semana 3</th>
                      <th className="text-center py-2 px-3 font-medium">Semana 4</th>
                      <th className="text-center py-2 px-3 font-medium">Semana 5</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COHORT_DATA.map((cohort) => (
                      <tr key={cohort.cohort} className="border-b border-border/50">
                        <td className="py-2 px-3 font-medium">{cohort.cohort}</td>
                        <td className="text-right py-2 px-3">{cohort.size}</td>
                        <td className="text-right py-2 px-3">
                          <Badge variant="secondary" className="text-[10px]">
                            {cohort.conversion}%
                          </Badge>
                        </td>
                        {cohort.retention.map((retention, i) => (
                          <td key={i} className="text-center py-2 px-3">
                            <div className="flex items-center justify-center gap-1">
                              <Progress value={retention} className="w-12 h-1.5" />
                              <span className="text-xs text-muted-foreground">{retention}%</span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attribution por Source */}
        <TabsContent value="attribution" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" />
                Attribution por Source
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ATTRIBUTION_SOURCES.map((source) => {
                const Icon = source.icon;
                return (
                  <div key={source.source} className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{source.source}</p>
                        <p className="text-xs text-muted-foreground">{source.visits.toLocaleString()} visitas</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-sm font-bold">{source.conversions}</p>
                        <p className="text-xs text-muted-foreground">conversiones</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">${source.revenue.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">revenue</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {source.conversionRate.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* IA Attribution Insights */}
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                IA Attribution Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Email tiene 2.5x más conversión que Directo</p>
                    <p className="text-xs text-muted-foreground mt-1">IA analizó attribution first-touch vs last-touch. Considera invertir más en email</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                  <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Social convierte menos pero tiene mayor ticket promedio</p>
                    <p className="text-xs text-muted-foreground mt-1">IA detectó que Social trae clientes de mayor valor. Considera retargeting</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                  <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">SEO tiene 40% de tráfico pero solo 10% de conversiones</p>
                    <p className="text-xs text-muted-foreground mt-1">IA sugiere optimizar landing pages de SEO para mejorar conversión</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
