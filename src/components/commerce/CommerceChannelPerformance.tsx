/**
 * CommerceChannelPerformance — Rendimiento por canal para el dashboard de Commerce
 *
 * Diseño moderno con comparación de canales de venta
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, ShoppingBag, Store, Globe } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ChannelData {
  name: string;
  sales: number;
  orders: number;
  revenue: number;
  color: string;
  icon: "online" | "pos" | "marketplace";
}

interface CommerceChannelPerformanceProps {
  channels: ChannelData[];
  title?: string;
}

const channelIcons = {
  online: Globe,
  pos: Store,
  marketplace: ShoppingBag,
};

const channelColors = {
  online: "hsl(var(--primary))",
  pos: "hsl(142, 76%, 36%)",
  marketplace: "hsl(38, 92%, 50%)",
};

export default function CommerceChannelPerformance({
  channels,
  title = "Rendimiento por Canal",
}: CommerceChannelPerformanceProps) {
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
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold">{totalOrders} pedidos</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {channels.map((channel) => {
            const Icon = channelIcons[channel.icon];
            const percentage = totalRevenue > 0 ? (channel.revenue / totalRevenue) * 100 : 0;

            return (
              <div key={channel.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: `${channel.color}15` }}
                    >
                      <Icon className="h-4 w-4" style={{ color: channel.color }} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{channel.name}</p>
                      <p className="text-xs text-muted-foreground">{channel.orders} pedidos</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${channel.revenue.toLocaleString()}</p>
                    <Badge variant="secondary" className="text-xs mt-1">
                      {percentage.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: channel.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
