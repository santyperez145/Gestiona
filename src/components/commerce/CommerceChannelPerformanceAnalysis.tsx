/**
 * CommerceChannelPerformanceAnalysis — Análisis de rendimiento de canales para el dashboard de Commerce
 *
 * Diseño moderno con análisis de rendimiento por canal de venta
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ShoppingBag, Store, Globe, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface ChannelPerformance {
  name: string;
  type: "online" | "pos" | "marketplace" | "social";
  sales: number;
  orders: number;
  revenue: number;
  growth?: number;
  status: "excellent" | "good" | "warning" | "critical";
}

interface CommerceChannelPerformanceAnalysisProps {
  channels: ChannelPerformance[];
  title?: string;
}

const typeIcons = {
  online: Globe,
  pos: Store,
  marketplace: ShoppingBag,
  social: Smartphone,
};

const statusColors = {
  excellent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  good: "text-green-600 bg-green-500/10 border-green-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
};

export default function CommerceChannelPerformanceAnalysis({
  channels,
  title = "Análisis de Rendimiento por Canal",
}: CommerceChannelPerformanceAnalysisProps) {
  const totalRevenue = channels.reduce((sum, c) => sum + c.revenue, 0);
  const totalOrders = channels.reduce((sum, c) => sum + c.orders, 0);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total ingresos</p>
            <p className="text-lg font-bold">${totalRevenue.toLocaleString()}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {channels.map((channel, index) => {
            const Icon = typeIcons[channel.type];
            const statusClass = statusColors[channel.status];
            const revenueShare = totalRevenue > 0 ? (channel.revenue / totalRevenue) * 100 : 0;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${statusClass.split(' ')[0]}`}>
                      <Icon className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{channel.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                          {channel.status === "excellent" ? "Excelente" : channel.status === "good" ? "Bueno" : channel.status === "warning" ? "Advertencia" : "Crítico"}
                        </Badge>
                        {channel.growth !== undefined && (
                          <Badge variant="outline" className="text-xs">
                            {channel.growth > 0 ? "+" : ""}
                            {channel.growth}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${channel.revenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{channel.orders} pedidos</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {revenueShare.toFixed(1)}% del total
                    </span>
                    <span className="font-semibold">${channel.revenue.toLocaleString()}</span>
                  </div>
                  <Progress value={revenueShare} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
