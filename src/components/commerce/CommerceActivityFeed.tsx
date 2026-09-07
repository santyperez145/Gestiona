/**
 * CommerceActivityFeed — Feed de actividad reciente para el dashboard de Commerce
 *
 * Diseño moderno con timeline de eventos y animaciones
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, ShoppingCart, Package, Users, DollarSign, TrendingUp } from "lucide-react";

interface ActivityItem {
  id: string;
  type: "sale" | "product" | "customer" | "payment" | "stock";
  title: string;
  description: string;
  timestamp: string;
  amount?: number;
  status?: "success" | "warning" | "error";
}

interface CommerceActivityFeedProps {
  activities: ActivityItem[];
  title?: string;
  limit?: number;
}

const typeIcons = {
  sale: ShoppingCart,
  product: Package,
  customer: Users,
  payment: DollarSign,
  stock: TrendingUp,
};

const statusColors = {
  success: "text-emerald-600 bg-emerald-500/10",
  warning: "text-yellow-600 bg-yellow-500/10",
  error: "text-destructive bg-destructive/10",
};

export default function CommerceActivityFeed({
  activities,
  title = "Actividad Reciente",
  limit = 10,
}: CommerceActivityFeedProps) {
  const displayActivities = activities.slice(0, limit);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {displayActivities.map((activity) => {
            const Icon = typeIcons[activity.type];
            return (
              <div
                key={activity.id}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
              >
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{activity.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{activity.description}</p>
                    </div>
                    {activity.amount && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        ${activity.amount.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">{activity.timestamp}</span>
                    {activity.status && (
                      <Badge className={`text-xs ${statusColors[activity.status]}`}>
                        {activity.status}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
