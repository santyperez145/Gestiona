import type { LucideIcon } from "lucide-react";
import { ExternalLink, Image, Package, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CommerceDashboardHeaderProps {
  icon: LucideIcon;
  title: string;
  greeting: string;
  description: string;
  actions?: React.ReactNode;
  storeLink?: string;
  liveStats?: {
    todaySales: string;
    orderCount: number;
    periodCustomers: number;
    /** Métricas de migración de catálogo */
    migratedImages?: number;
    pendingImages?: number;
    failedImages?: number;
    lastMigrationAt?: string;
    /** Métricas de pipeline pedido-pago-fulfillment */
    ordersToday?: number;
    pendingFulfillment?: number;
    overdueFulfillment?: number;
  };
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Hace un momento";
  if (diffHours < 24) return `Hace ${diffHours}h`;
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays}d`;
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

export default function CommerceDashboardHeader({
  icon: Icon,
  title,
  greeting,
  description,
  actions,
  storeLink,
  liveStats,
}: CommerceDashboardHeaderProps) {
  const hasMigrationData = liveStats && (
    (liveStats.migratedImages ?? 0) > 0 ||
    (liveStats.pendingImages ?? 0) > 0 ||
    (liveStats.failedImages ?? 0) > 0
  );

  const hasFulfillmentData = liveStats && (
    (liveStats.pendingFulfillment ?? 0) > 0 ||
    (liveStats.overdueFulfillment ?? 0) > 0 ||
    (liveStats.ordersToday ?? 0) > 0
  );

  return (
    <header className="mb-4 overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="h-1 bg-primary" />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-primary">{title}</p>
                <h1 className="truncate text-xl font-bold sm:text-2xl">{greeting}</h1>
              </div>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
            {storeLink && (
              <Button asChild size="sm" className="self-start xl:self-end">
                <Link to={storeLink}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Abrir tienda
                </Link>
              </Button>
            )}
          </div>
        </div>

        {liveStats && (
          <>
            {/* Stats principales: ventas, pedidos, clientes */}
            <div className="mt-4 grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="py-3 sm:pr-4">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Ventas de hoy</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{liveStats.todaySales}</p>
              </div>
              <div className="py-3 sm:px-4">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Pedidos de hoy</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{liveStats.orderCount}</p>
              </div>
              <div className="py-3 sm:pl-4">
                <p className="text-[10px] font-medium uppercase text-muted-foreground">Clientes del periodo</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{liveStats.periodCustomers}</p>
              </div>
            </div>

            {/* Migración de catálogo */}
            {hasMigrationData && (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4" data-section="migration">
                <div className="mb-3 flex items-center gap-2">
                  <Image className="h-4 w-4 text-primary" />
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">Migración de catálogo</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20">
                    <p className="text-[10px] font-medium uppercase text-emerald-400">Migradas</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-emerald-400">{liveStats.migratedImages ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-yellow-500/10 p-3 border border-yellow-500/20">
                    <p className="text-[10px] font-medium uppercase text-yellow-400">Pendientes</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-yellow-400">{liveStats.pendingImages ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-red-500/10 p-3 border border-red-500/20">
                    <p className="text-[10px] font-medium uppercase text-red-400">Fallidas</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-red-400">{liveStats.failedImages ?? 0}</p>
                  </div>
                </div>
                {liveStats.lastMigrationAt && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>Última corrida: {formatRelativeTime(liveStats.lastMigrationAt)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Pipeline fulfillment */}
            {hasFulfillmentData && (
              <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4" data-section="fulfillment">
                <div className="mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-400" />
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-blue-400">Pipeline de pedidos</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className={cn(
                    "rounded-lg p-3 border",
                    liveStats.ordersToday && liveStats.ordersToday > 0
                      ? "bg-emerald-500/10 border-emerald-500/20"
                      : "bg-muted/30 border-border/50"
                  )}>
                    <p className="text-[10px] font-medium uppercase text-muted-foreground">Pedidos hoy</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">{liveStats.ordersToday ?? 0}</p>
                  </div>
                  <div className={cn(
                    "rounded-lg p-3 border",
                    (liveStats.pendingFulfillment ?? 0) > 0
                      ? "bg-yellow-500/10 border-yellow-500/20"
                      : "bg-muted/30 border-border/50"
                  )}>
                    <div className="flex items-center gap-1">
                      <p className="text-[10px] font-medium uppercase text-yellow-400">Por despachar</p>
                      {(liveStats.pendingFulfillment ?? 0) > 0 && (
                        <CheckCircle2 className="h-3 w-3 text-yellow-400" />
                      )}
                    </div>
                    <p className="mt-1 text-lg font-bold tabular-nums text-yellow-400">{liveStats.pendingFulfillment ?? 0}</p>
                  </div>
                  <div className={cn(
                    "rounded-lg p-3 border",
                    (liveStats.overdueFulfillment ?? 0) > 0
                      ? "bg-red-500/10 border-red-500/20"
                      : "bg-muted/30 border-border/50"
                  )}>
                    <div className="flex items-center gap-1">
                      <p className="text-[10px] font-medium uppercase text-red-400">Atrasados (SLA)</p>
                      {(liveStats.overdueFulfillment ?? 0) > 0 && (
                        <AlertTriangle className="h-3 w-3 text-red-400" />
                      )}
                    </div>
                    <p className="mt-1 text-lg font-bold tabular-nums text-red-400">{liveStats.overdueFulfillment ?? 0}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </header>
  );
}