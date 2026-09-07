/**
 * BusinessDashboard — Dashboard operativo para Business
 *
 * KPIs principales:
 * - Ventas hoy
 * - Stock total
 * - Stock crítico
 * - Clientes nuevos
 * - Margen bruto
 *
 * Widgets de acción:
 * - Ventas por canal
 * - Stock por ubicación
 * - Alertas de stock
 * - Reposiciones recomendadas
 * - IA insights (opcional)
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Package, ShoppingCart, Users, DollarSign, AlertTriangle, RefreshCw, Truck, BarChart3, ArrowRight } from "lucide-react";
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

export default function BusinessDashboard() {
  return (
    <div className="space-y-6">
      {/* KPIs Operativos */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KPICard
          title="Ventas hoy"
          value={28}
          change={12}
          icon={ShoppingCart}
          trend="up"
        />
        <KPICard
          title="Stock total"
          value="1,250"
          change={-3}
          icon={Package}
          trend="down"
        />
        <KPICard
          title="Stock crítico"
          value={8}
          change={0}
          icon={AlertTriangle}
          trend="neutral"
        />
        <KPICard
          title="Clientes nuevos"
          value={5}
          change={25}
          icon={Users}
          trend="up"
        />
        <KPICard
          title="Margen bruto"
          value="42%"
          change={5}
          icon={DollarSign}
          trend="up"
        />
      </div>

      {/* Widgets de Acción */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionWidget
          title="Stock por agotar"
          description="Productos sin stock que afectan ventas"
          count={8}
          actionLabel="Reponer"
          icon={AlertTriangle}
          priority="high"
        />
        <ActionWidget
          title="Reposiciones pendientes"
          description="Órdenes de compra pendientes de recepción"
          count={5}
          actionLabel="Recibir"
          icon={Truck}
          priority="high"
        />
        <ActionWidget
          title="Transferencias de stock"
          description="Movimientos de stock entre ubicaciones"
          count={3}
          actionLabel="Ver"
          icon={RefreshCw}
          priority="medium"
        />
        <ActionWidget
          title="Reposiciones recomendadas"
          description="Sugerencias de compra basadas en forecast"
          count={12}
          actionLabel="Ver"
          icon={BarChart3}
          priority="low"
        />
      </div>

      {/* Insights Operativos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Insights Operativos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">El producto "X" rota 3x más rápido que el promedio</p>
                <p className="text-xs text-muted-foreground mt-1">Considera aumentar stock de seguridad</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">La sucursal norte tiene 20% más stock que el sur</p>
                <p className="text-xs text-muted-foreground mt-1">Considera transferir stock para balancear</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="h-2 w-2 rounded-full bg-blue-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">El proveedor "A" tiene 95% de on-time delivery</p>
                <p className="text-xs text-muted-foreground mt-1">Prioriza este proveedor para reposiciones críticas</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
