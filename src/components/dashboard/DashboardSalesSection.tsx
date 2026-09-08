import { Link } from "react-router-dom";
import { ArrowUpRight, CircleDollarSign, ReceiptText } from "lucide-react";
import CommerceTopProducts from "@/components/commerce/CommerceTopProducts";
import { formatARS } from "@/lib/supabaseStore";

type TopProduct = {
  name: string;
  qty: number;
  revenue: number;
};

type RecentSale = {
  id: string;
  product_name?: string | null;
  customer_name?: string | null;
  total_ars?: number | string | null;
  profit_ars?: number | string | null;
  paid?: boolean | null;
};

interface DashboardSalesSectionProps {
  topProducts: TopProduct[];
  recentSales: RecentSale[];
}

export default function DashboardSalesSection({ topProducts, recentSales }: DashboardSalesSectionProps) {
  return (
    <section id="dashboard-sales" aria-labelledby="dashboard-sales-title" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <h2 id="dashboard-sales-title" className="sr-only">Rendimiento de ventas</h2>
        <CommerceTopProducts
          products={topProducts.map(product => ({
            id: product.name,
            name: product.name,
            sales: product.qty,
            revenue: product.revenue,
          }))}
          title="Productos con mayor facturacion"
          limit={5}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Ultimas ventas</h3>
          </div>
          <Link to="/ventas" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Ver todas <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentSales.length > 0 ? (
          <div className="divide-y divide-border">
            {recentSales.map(sale => {
              const profit = Number(sale.profit_ars ?? 0);
              return (
                <div key={sale.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 hover:bg-muted/30">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{sale.product_name || "Producto sin nombre"}</p>
                    <p className="truncate text-xs text-muted-foreground">{sale.customer_name || "Venta sin cliente asignado"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{formatARS(Number(sale.total_ars ?? 0))}</p>
                    <p className={`flex items-center justify-end gap-1 text-[11px] ${profit >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>
                      <CircleDollarSign className="h-3 w-3" /> {formatARS(profit)}
                      <span className="text-muted-foreground">·</span>
                      <span className={sale.paid ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                        {sale.paid ? "Cobrada" : "Pendiente"}
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">Todavia no hay ventas en este periodo</p>
            <p className="mt-1 text-xs text-muted-foreground">Cuando registres una venta, aparecera aca sin recargar la pagina.</p>
          </div>
        )}
      </div>
    </section>
  );
}
