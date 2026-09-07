/**
 * CommerceDashboardHeader — Header moderno para el dashboard de Commerce
 *
 * Enfocado en tienda online con vista tecnológica y profesional
 */
import { LucideIcon } from "lucide-react";
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
    conversionRate: number;
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
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-primary to-cyan-500 p-6 md:p-8 text-white shadow-2xl">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0id2hpdGUiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white,transparent)]" />
      </div>

      <div className="relative">
        {/* Status badge */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-xs font-medium">Tienda Online Activa</span>
          </div>
          {liveStats && (
            <Badge className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20">
              {liveStats.orderCount} pedidos hoy
            </Badge>
          )}
        </div>

        {/* Main header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20">
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold font-display">{greeting}</h1>
                <p className="text-sm text-white/80 mt-1">{title}</p>
              </div>
            </div>
            <p className="text-sm text-white/70 max-w-2xl mt-3">{description}</p>
          </div>

          <div className="flex flex-col gap-2">
            {storeLink && (
              <Button
                asChild
                className="bg-white text-primary hover:bg-white/90 font-semibold shadow-lg"
              >
                <a href={storeLink} target="_blank" rel="noopener noreferrer">
                  <Icon className="h-4 w-4 mr-2" />
                  Ver Tienda
                </a>
              </Button>
            )}
            {actions && <div className="flex gap-2">{actions}</div>}
          </div>
        </div>

        {/* Live stats bar */}
        {liveStats && (
          <div className="mt-6 pt-6 border-t border-white/20">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Ventas Hoy</p>
                <p className="text-xl font-bold">{liveStats.todaySales}</p>
              </div>
              <div>
                <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Pedidos</p>
                <p className="text-xl font-bold">{liveStats.orderCount}</p>
              </div>
              <div>
                <p className="text-xs text-white/60 uppercase tracking-wider mb-1">Conversión</p>
                <p className="text-xl font-bold">{liveStats.conversionRate.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
