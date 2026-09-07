/**
 * CommerceConversionDashboard — Dashboard de conversión para Commerce
 *
 * KPIs principales:
 * - Pedidos hoy
 * - Conversion rate
 * - Carritos abandonados
 * - Time to first order
 * - Revenue 7 días
 *
 * Widgets de acción:
 * - Pedidos en cola (actionable)
 * - Stock crítico que afecta ventas
 * - Alertas de checkout
 * - Recomendaciones de IA para conversión (optimización de pricing, timing, producto)
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Package, ShoppingCart, Clock, DollarSign, AlertTriangle, Sparkles, ArrowRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
}

function KPICard({ title, value, change, icon: Icon, trend = "neutral" }: KPICardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {change !== undefined && (
          <div className={cn(
            "flex items-center text-xs mt-1",
            trend === "up" ? "text-emerald-600" : trend === "down" ? "text-destructive" : "text-muted-foreground"
          )}>
            {trend === "up" && <ArrowUpRight className="h-3 w-3 mr-1" />}
            {trend === "down" && <ArrowDownRight className="h-3 w-3 mr-1" />}
            {change}% vs ayer
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ActionWidgetProps {
  title: string;
  description: string;
  count: number;
  actionLabel: string;
  icon: React.ElementType;
  priority?: "high" | "medium" | "low";
}

function ActionWidget({ title, description, count, actionLabel, icon: Icon, priority = "medium" }: ActionWidgetProps) {
  const priorityColors = {
    high: "bg-destructive/10 text-destructive border-destructive/20",
    medium: "bg-amber-500/10 text-amber-700 border-amber-500/25",
    low: "bg-blue-500/10 text-blue-700 border-blue-500/25",
  };

  return (
    <Card className={cn("border-l-4", priority === "high" ? "border-l-destructive" : priority === "medium" ? "border-l-amber-500" : "border-l-blue-500")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          <Badge variant="secondary" className={cn("text-[10px]", priorityColors[priority])}>
            {priority === "high" ? "Urgente" : priority === "medium" ? "Atención" : "Info"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{description}</p>
        <div className="flex items-center justify-between">
          <span className="text-2xl font-bold">{count}</span>
          <Button size="sm" variant="outline" className="h-7">
            {actionLabel}
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CommerceConversionDashboard() {
  return (
    <div className="space-y-6">
      {/* KPIs de Conversión */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KPICard
          title="Pedidos hoy"
          value={12}
          change={15}
          icon={ShoppingCart}
          trend="up"
        />
        <KPICard
          title="Conversion rate"
          value="3.2%"
          change={0.5}
          icon={TrendingUp}
          trend="up"
        />
        <KPICard
          title="Carritos abandonados"
          value={8}
          change={-10}
          icon={Package}
          trend="down"
        />
        <KPICard
          title="Time to first order"
          value="2.5h"
          change={-15}
          icon={Clock}
          trend="up"
        />
        <KPICard
          title="Revenue 7 días"
          value="$45.2k"
          change={22}
          icon={DollarSign}
          trend="up"
        />
      </div>

      {/* Widgets de Acción */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionWidget
          title="Pedidos en cola"
          description="Pedidos pendientes de aprobación de pago"
          count={5}
          actionLabel="Revisar"
          icon={ShoppingCart}
          priority="high"
        />
        <ActionWidget
          title="Stock crítico"
          description="Productos sin stock que afectan ventas"
          count={3}
          actionLabel="Reponer"
          icon={AlertTriangle}
          priority="high"
        />
        <ActionWidget
          title="Alertas de checkout"
          description="Errores en checkout que bloquean ventas"
          count={2}
          actionLabel="Investigar"
          icon={AlertTriangle}
          priority="medium"
        />
        <ActionWidget
          title="Recomendaciones IA"
          description="Oportunidades de conversión detectadas"
          count={7}
          actionLabel="Ver"
          icon={Sparkles}
          priority="low"
        />
      </div>

      {/* Insights de Conversión con IA */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="flex items-center gap-2">
              Insights de Conversión
              <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                <Zap className="h-3 w-3 mr-1" />
                IA Activa
              </Badge>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
              <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">El producto "X" tiene 3x más conversión los viernes a las 14:00</p>
                <p className="text-xs text-muted-foreground mt-1">IA detectó patrón de compra. Considera promoverlo en ese horario con pricing dinámico +5%</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Aplicar Recomendación
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
              <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">El abandono de carrito aumenta 40% después de las 20:00</p>
                <p className="text-xs text-muted-foreground mt-1">IA sugiere email de recuperación 30 minutos antes. Considera checkout express para compras nocturnas</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Configurar Recuperación
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
              <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Pricing óptimo para categoría A: +8% vs precio actual</p>
                <p className="text-xs text-muted-foreground mt-1">IA analizó demanda vs competencia. Sugerencia de pricing dinámico para maximizar margen sin perder conversión</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Ver Análisis de Pricing
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
