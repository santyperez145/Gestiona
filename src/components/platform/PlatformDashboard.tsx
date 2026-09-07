/**
 * PlatformDashboard — Dashboard de ATM para control plane
 *
 * KPIs principales:
 * - Active Transacting Merchants (ATM)
 * - GMV total
 * - GMV por merchant
 * - Pay penetration
 * - Churn rate
 *
 * Widgets de acción:
 * - Top merchants
 * - Risk alerts
 * - System health
 * - Operations metrics
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Building2, DollarSign, Users, AlertTriangle, Activity, Shield, Globe, ArrowRight } from "lucide-react";
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

interface MerchantRow {
  id: string;
  name: string;
  gmv: number;
  orders: number;
  status: "active" | "trialing" | "at_risk";
  growth: number;
}

const TOP_MERCHANTS: MerchantRow[] = [
  { id: "1", name: "Tienda Central", gmv: 12500, orders: 45, status: "active", growth: 15 },
  { id: "2", name: "Electro Norte", gmv: 8900, orders: 32, status: "active", growth: 22 },
  { id: "3", name: "Perfumería Bella", gmv: 6700, orders: 28, status: "trialing", growth: 8 },
  { id: "4", name: "Ferretería El constructor", gmv: 5200, orders: 19, status: "at_risk", growth: -5 },
  { id: "5", name: "Modas Urbanas", gmv: 4100, orders: 15, status: "active", growth: 12 },
];

export default function PlatformDashboard() {
  return (
    <div className="space-y-6">
      {/* KPIs de ATM */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KPICard
          title="Active Transacting Merchants"
          value={42}
          change={18}
          icon={Building2}
          trend="up"
        />
        <KPICard
          title="GMV Total"
          value="$284.5k"
          change={25}
          icon={DollarSign}
          trend="up"
        />
        <KPICard
          title="GMV por Merchant"
          value="$6.8k"
          change={8}
          icon={TrendingUp}
          trend="up"
        />
        <KPICard
          title="Pay Penetration"
          value="68%"
          change={12}
          icon={Activity}
          trend="up"
        />
        <KPICard
          title="Churn Rate"
          value="3.2%"
          change={-15}
          icon={Users}
          trend="down"
        />
      </div>

      {/* Top Merchants */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-700 dark:text-slate-300" />
            Top Merchants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {TOP_MERCHANTS.map((merchant, index) => (
              <div key={merchant.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-medium">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{merchant.name}</p>
                    <p className="text-xs text-muted-foreground">{merchant.orders} pedidos</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold">${merchant.gmv.toLocaleString()}</p>
                    <p className={cn("text-xs", merchant.growth >= 0 ? "text-emerald-600" : "text-destructive")}>
                      {merchant.growth >= 0 ? "+" : ""}{merchant.growth}%
                    </p>
                  </div>
                  <Badge variant="secondary" className={cn(
                    "text-[10px]",
                    merchant.status === "active" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/25" :
                    merchant.status === "trialing" ? "bg-blue-500/10 text-blue-700 border-blue-500/25" :
                    "bg-amber-500/10 text-amber-700 border-amber-500/25"
                  )}>
                    {merchant.status === "active" ? "Activo" : merchant.status === "trialing" ? "Trial" : "Riesgo"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Health y Risk Alerts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-600" />
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Uptime</span>
              <span className="text-sm font-bold text-emerald-600">99.9%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Response Time</span>
              <span className="text-sm font-bold">245ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Error Rate</span>
              <span className="text-sm font-bold text-emerald-600">0.02%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Users</span>
              <span className="text-sm font-bold">156</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Risk Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/50">
              <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">4 merchants con pago vencido</p>
                <p className="text-xs text-muted-foreground mt-1">Considera campañas de recuperación</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/50">
              <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">2 merchants con stock crítico</p>
                <p className="text-xs text-muted-foreground mt-1">Ofrece reposición prioritaria</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/50">
              <div className="h-2 w-2 rounded-full bg-amber-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium">1 merchant con alta tasa de rechazo</p>
                <p className="text-xs text-muted-foreground mt-1">Revisa configuración de pagos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Operations Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-700 dark:text-slate-300" />
            Operations Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Support Tickets</p>
              <p className="text-2xl font-bold">23</p>
              <p className="text-xs text-muted-foreground mt-1">12 pendientes, 11 resueltos hoy</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Avg Response Time</p>
              <p className="text-2xl font-bold">1.8h</p>
              <p className="text-xs text-emerald-600 mt-1">-15% vs semana anterior</p>
            </div>
            <div className="p-4 rounded-lg border border-border/50">
              <p className="text-sm text-muted-foreground mb-1">Onboarding Completion</p>
              <p className="text-2xl font-bold">85%</p>
              <p className="text-xs text-emerald-600 mt-1">+5% vs mes anterior</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
