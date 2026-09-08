import { Link } from "react-router-dom";
import { ArrowUpRight, Users } from "lucide-react";
import CommerceChannelPerformance from "@/components/commerce/CommerceChannelPerformance";
import { formatARS } from "@/lib/supabaseStore";

type TopCustomer = {
  name: string;
  count: number;
  total: number;
};

type SalesChannel = {
  source: string;
  revenue: number;
  orders: number;
  units: number;
};

interface DashboardCustomersSectionProps {
  topCustomers: TopCustomer[];
  monthGrossProfit: number;
  salesByChannel: SalesChannel[];
}

const CHANNEL_LABELS: Record<string, string> = {
  ecommerce: "Tienda online",
  online: "Tienda online",
  storefront: "Tienda online",
  pos: "Punto de venta",
  mercadolibre: "Mercado Libre",
  tiendanube: "Tiendanube",
  manual: "Venta manual",
};

function channelIcon(source: string): "online" | "pos" | "marketplace" {
  if (["ecommerce", "online", "storefront", "tiendanube"].includes(source)) return "online";
  if (source === "pos" || source === "manual") return "pos";
  return "marketplace";
}

export default function DashboardCustomersSection({
  topCustomers,
  monthGrossProfit,
  salesByChannel,
}: DashboardCustomersSectionProps) {
  const colors = ["hsl(var(--primary))", "hsl(153 60% 35%)", "hsl(36 90% 48%)", "hsl(204 72% 45%)"];

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Clientes y canales">
      <div className="rounded-lg border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Clientes principales</h3>
              <p className="text-[11px] text-muted-foreground">Margen bruto del mes: {formatARS(monthGrossProfit)}</p>
            </div>
          </div>
          <Link to="/clientes" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Ver clientes <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {topCustomers.length > 0 ? (
          <div className="divide-y divide-border">
            {topCustomers.map((customer, index) => (
              <div key={`${customer.name}-${index}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{customer.name}</p>
                  <p className="text-xs text-muted-foreground">{customer.count} {customer.count === 1 ? "compra" : "compras"}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatARS(customer.total)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No hay clientes con compras en este mes.</p>
        )}
      </div>

      <CommerceChannelPerformance
        title="Ventas por canal"
        channels={salesByChannel.map((channel, index) => ({
          name: CHANNEL_LABELS[channel.source] || channel.source,
          sales: channel.units,
          orders: channel.orders,
          revenue: channel.revenue,
          color: colors[index % colors.length],
          icon: channelIcon(channel.source),
        }))}
      />
    </section>
  );
}
