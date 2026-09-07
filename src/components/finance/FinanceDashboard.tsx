/**
 * FinanceDashboard — Dashboard de control de gastos para Finance
 *
 * KPIs principales:
 * - Gastos del mes
 * - Deudas pendientes
 * - Presupuesto disponible
 * - Cash flow
 * - Margen neto
 *
 * Widgets de acción:
 * - Solicitudes pendientes
 * - Aprobaciones requeridas
 * - Presupuestos excedidos
 * - Conciliación pendiente
 *
 * IA para optimización financiera:
 * - Predicción de cash flow
 * - Detección de anomalías en gastos
 * - Recomendaciones de optimización
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Wallet, FileText, AlertTriangle, CheckCircle, Clock, Landmark, DollarSign, ArrowRight, Zap, Sparkles } from "lucide-react";
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
            {change}% vs mes anterior
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

export default function FinanceDashboard() {
  return (
    <div className="space-y-6">
      {/* KPIs de Finance */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KPICard
          title="Gastos del mes"
          value="$12.5k"
          change={-8}
          icon={Wallet}
          trend="down"
        />
        <KPICard
          title="Deudas pendientes"
          value="$8.2k"
          change={5}
          icon={FileText}
          trend="up"
        />
        <KPICard
          title="Presupuesto disponible"
          value="$15.8k"
          change={12}
          icon={CheckCircle}
          trend="up"
        />
        <KPICard
          title="Cash flow"
          value="+$3.2k"
          change={15}
          icon={Landmark}
          trend="up"
        />
        <KPICard
          title="Margen neto"
          value="28%"
          change={-2}
          icon={DollarSign}
          trend="down"
        />
      </div>

      {/* Widgets de Acción */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionWidget
          title="Solicitudes pendientes"
          description="Solicitudes de gasto pendientes de aprobación"
          count={7}
          actionLabel="Aprobar"
          icon={Clock}
          priority="high"
        />
        <ActionWidget
          title="Presupuestos excedidos"
          description="Centros de costo que excedieron el presupuesto"
          count={3}
          actionLabel="Revisar"
          icon={AlertTriangle}
          priority="high"
        />
        <ActionWidget
          title="Conciliación pendiente"
          description="Movimientos bancarios pendientes de conciliación"
          count={15}
          actionLabel="Conciliar"
          icon={Landmark}
          priority="medium"
        />
        <ActionWidget
          title="Facturas por vencer"
          description="Facturas que vencen en los próximos 7 días"
          count={8}
          actionLabel="Pagar"
          icon={FileText}
          priority="medium"
        />
      </div>

      {/* Insights de Finance con IA */}
      <Card className="border-teal-500/20 bg-gradient-to-br from-teal-50/50 to-background dark:from-teal-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <span className="flex items-center gap-2">
              Insights Financieros
              <Badge variant="secondary" className="text-[10px] bg-teal-500/10 text-teal-700 dark:text-teal-300">
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
                <p className="text-sm font-medium">Predicción de cash flow: +15% para Q4 basado en historial</p>
                <p className="text-xs text-muted-foreground mt-1">IA proyecta flujo de caja positivo. Buen momento para inversión en inventario de temporada alta</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Ver Proyección
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
              <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Anomalía detectada: Gasto recurrente +25% vs mes anterior</p>
                <p className="text-xs text-muted-foreground mt-1">IA identificó patrón inusual en centro de costo "Servicios". Revisa suscripción de software</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Investigar
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
              <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Oportunidad de optimización: Consolidar pagos reduce 8% en comisiones</p>
                <p className="text-xs text-muted-foreground mt-1">IA analizó patterns de pago. Sugerencia de consolidar pagos en fechas específicas</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Aplicar Optimización
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
              <div className="h-2 w-2 rounded-full bg-purple-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Deuda técnica detectada: Centro de costo X tiene deuda creciente</p>
                <p className="text-xs text-muted-foreground mt-1">IA detectó patrón de deuda creciente sin correspondencia en revenue. Revisa presupuesto</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Revisar Presupuesto
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
              <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">Optimización de impuestos: Aplicar deducciones reduces 5% IVA</p>
                <p className="text-xs text-muted-foreground mt-1">IA analizó patterns de gastos. Sugerencia de aplicar deducciones fiscales</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs">
                  Ver Deducciones
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
