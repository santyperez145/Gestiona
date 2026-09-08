import type { LucideIcon } from "lucide-react";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

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
  };
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
        )}
      </div>
    </header>
  );
}
