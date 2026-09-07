/**
 * CommerceTopProducts — Tabla de productos más vendidos para el dashboard de Commerce
 *
 * Diseño moderno con tabla responsive y animaciones
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Package, DollarSign } from "lucide-react";

interface Product {
  id: string;
  name: string;
  sales: number;
  revenue: number;
  image?: string;
  trend?: number;
}

interface CommerceTopProductsProps {
  products: Product[];
  title?: string;
  limit?: number;
}

export default function CommerceTopProducts({
  products,
  title = "Productos Más Vendidos",
  limit = 5,
}: CommerceTopProductsProps) {
  const topProducts = products.slice(0, limit);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {topProducts.map((product, index) => (
            <div
              key={product.id}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
            >
              {/* Ranking */}
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
                {index + 1}
              </div>

              {/* Product info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{product.name}</p>
                  {product.trend !== undefined && product.trend > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      +{product.trend}%
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-xs text-muted-foreground">{product.sales} ventas</p>
                  <p className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    ${product.revenue.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Revenue bar */}
              <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-cyan-500"
                  style={{
                    width: `${(product.revenue / topProducts[0].revenue) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
