/**
 * CommerceInventoryAlerts — Alertas de inventario para el dashboard de Commerce
 *
 * Semántica por tokens: warning = agotado/bajo, destructive = sin stock,
 * success = stock en orden. Sin hex sueltos ni sombras pesadas.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Package, TrendingDown, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Product {
  id: string;
  name: string;
  stock: number;
  minStock?: number;
  status: "low" | "out" | "critical";
}

interface CommerceInventoryAlertsProps {
  products: Product[];
  title?: string;
  onRestock?: (productId: string) => void;
}

export default function CommerceInventoryAlerts({
  products,
  title = "Alertas de Inventario",
  onRestock,
}: CommerceInventoryAlertsProps) {
  const lowStock = products.filter(p => p.status === "low");
  const outStock = products.filter(p => p.status === "out");
  const critical = products.filter(p => p.status === "critical");

  const allAlerts = [...critical, ...outStock, ...lowStock].slice(0, 5);

  if (allAlerts.length === 0) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-success/10">
              <Package className="h-6 w-6 text-success" />
            </div>
            <div>
              <p className="font-semibold text-success">Stock en orden</p>
              <p className="text-sm text-muted-foreground mt-1">No hay alertas de inventario</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusStyles = (status: string) => {
    switch (status) {
      case "critical":
        return {
          card: "bg-destructive/10 border-destructive/30",
          iconBg: "bg-destructive/20",
          iconColor: "text-destructive",
          label: "Sin stock",
        };
      case "out":
        return {
          card: "bg-warning/10 border-warning/30",
          iconBg: "bg-warning/20",
          iconColor: "text-warning",
          label: "Agotado",
        };
      case "low":
        return {
          card: "bg-warning/10 border-warning/30",
          iconBg: "bg-warning/20",
          iconColor: "text-warning",
          label: "Stock bajo",
        };
      default:
        return {
          card: "bg-muted border-border",
          iconBg: "bg-muted",
          iconColor: "text-muted-foreground",
          label: "Normal",
        };
    }
  };

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {title}
          </CardTitle>
          <Badge variant="destructive" className="text-xs">
            {allAlerts.length} alertas
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {allAlerts.map((product) => {
            const styles = getStatusStyles(product.status);
            return (
              <div
                key={product.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${styles.card}`}
              >
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-full ${styles.iconBg}`}>
                    <AlertCircle className={`h-4 w-4 ${styles.iconColor}`} />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.status === "critical" ? "Sin stock" : `${product.stock} unidades`}
                    </p>
                  </div>
                </div>
                {onRestock && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => onRestock(product.id)}
                  >
                    <TrendingDown className="h-3 w-3 mr-1" />
                    Reponer
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}