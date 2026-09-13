/* Rediseño CommerceTopProducts: token palette, sin UUID visibles, tabla responsive con leyenda */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Package, DollarSign, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
  title = "Productos más vendidos",
  limit = 5,
}: CommerceTopProductsProps) {
  const topProducts = products.slice(0, limit);
  const maxRevenue = topProducts[0]?.revenue || 1;
  const totalRevenue = topProducts.reduce((s, p) => s + p.revenue, 0);

  if (topProducts.length === 0) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">{title}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">Sin productos registrados.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <p className="text-xs text-muted-foreground">${totalRevenue.toLocaleString("es-AR")} total</p>
        </div>
      </CardHeader>
      <CardContent>
        {/* Mobile card list; desktop table-like rows */}
        <div className="space-y-2" role="list" aria-label="Top productos">
          {topProducts.map((product, index) => (
            <div
              key={product.id}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors border border-border/30"
              role="listitem"
            >
              {/* Ranking */}
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary font-bold text-xs shrink-0" aria-label={`Posición ${index + 1}`}>
                {index + 1}
              </div>
              {/* Product info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{product.name}</p>
                  {product.trend !== undefined && product.trend > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      +{product.trend}%
                    </Badge>
                  )}
                  {product.trend !== undefined && product.trend < 0 && (
                    <Badge variant="secondary" className="text-xs">
                      <ArrowDown className="h-3 w-3 mr-1" />
                      {product.trend}%
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{product.sales.toLocaleString("es-AR")} ventas</span>
                  <span className={cn("font-semibold inline-flex items-center gap-1", index === 0 ? "text-primary" : "text-foreground")}>
                    <DollarSign className="h-3 w-3" />${product.revenue.toLocaleString("es-AR")}
                  </span>
                </div>
              </div>
              {/* Revenue bar */}
              <div className="hidden sm:flex flex-col items-end gap-1 w-28">
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 rounded-full" style={{ width: `${(product.revenue / maxRevenue) * 100}%` }} />
                </div>
                {index === 0 && <ArrowUp className="w-3 h-3 text-primary" />}
              </div>
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/30 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary/60" />Barra = % del total</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary" />Ranking #1</span>
        </div>
      </CardContent>
    </Card>
  );
}
