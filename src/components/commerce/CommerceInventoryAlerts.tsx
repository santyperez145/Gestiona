/**
 * CommerceInventoryAlerts — Alertas de inventario para el dashboard de Commerce
 *
 * Diseño moderno con alertas de stock bajo y productos agotados
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
      <Card className="border-border/50 shadow-lg">
        <CardContent className="p-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-emerald-500/10">
              <Package className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-emerald-600">Stock en orden</p>
              <p className="text-sm text-muted-foreground mt-1">No hay alertas de inventario</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {title}
          </CardTitle>
          <Badge variant="destructive" className="text-xs">
            {allAlerts.length} alertas
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {allAlerts.map((product) => (
            <div
              key={product.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                product.status === "critical"
                  ? "bg-destructive/10 border-destructive/30"
                  : product.status === "out"
                  ? "bg-orange-500/10 border-orange-500/30"
                  : "bg-yellow-500/10 border-yellow-500/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`p-2 rounded-full ${
                    product.status === "critical"
                      ? "bg-destructive/20"
                      : product.status === "out"
                      ? "bg-orange-500/20"
                      : "bg-yellow-500/20"
                  }`}
                >
                  <AlertCircle
                    className={`h-4 w-4 ${
                      product.status === "critical"
                        ? "text-destructive"
                        : product.status === "out"
                        ? "text-orange-600"
                        : "text-yellow-600"
                    }`}
                  />
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
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
