/* Rediseño CommerceChannelPerformance: paleta token, sin IDs expuestos */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, ShoppingBag, Store, Globe } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ChannelData {
  name: string;
  sales: number;
  orders: number;
  revenue: number;
  color?: string;
  icon: "online" | "pos" | "marketplace";
}

interface CommerceChannelPerformanceProps {
  channels: ChannelData[];
  title?: string;
}

const channelIcons = { online: Globe, pos: Store, marketplace: ShoppingBag };
const channelColors = {
  online: "hsl(var(--primary))",
  pos: "hsl(142 76% 36%)",
  marketplace: "hsl(38 92% 50%)",
};

export default function CommerceChannelPerformance({
  channels,
  title = "Rendimiento por canal",
}: CommerceChannelPerformanceProps) {
  const totalRevenue = channels.reduce((sum, c) => sum + c.revenue, 0);
  const totalOrders = channels.reduce((sum, c) => sum + c.orders, 0);

  const barData = channels.map((c) => ({
    name: c.name,
    revenue: c.revenue,
    orders: c.orders,
    color: c.color || channelColors[c.icon],
  }));

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total pedidos</p>
            <p className="text-lg font-bold tabular-nums">{totalOrders.toLocaleString("es-AR")}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical" barCategoryGap={8} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <XAxis type="number" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" fontSize={11} tickLine={false} axisLine={false} width={90} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [`$${value.toLocaleString("es-AR")}`, "Ingresos"]}
                />
                <Bar dataKey="revenue" radius={[0, 6, 6, 0]} barSize={20}>
                  {barData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {channels.map((channel) => {
            const Icon = channelIcons[channel.icon];
            const percentage = totalRevenue > 0 ? (channel.revenue / totalRevenue) * 100 : 0;
            return (
              <div key={channel.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${channel.color || channelColors[channel.icon]}15` }}>
                      <Icon className="h-4 w-4" style={{ color: channel.color || channelColors[channel.icon] }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{channel.name}</p>
                      <p className="text-xs text-muted-foreground">{channel.orders.toLocaleString("es-AR")} pedidos</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="font-semibold tabular-nums">${channel.revenue.toLocaleString("es-AR")}</p>
                    <Badge variant="secondary" className="text-xs mt-1">
                      {percentage.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${percentage}%`, backgroundColor: channel.color || channelColors[channel.icon] }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
