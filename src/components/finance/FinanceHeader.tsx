/**
 * FinanceHeader — Header específico para Finance (control de gastos)
 *
 * Sólo aparece en rutas de Finance: /deudas, /presupuestos, /facturas, etc.
 * Expresa claramente que Finance es el control de gastos, no facturación del Business Core.
 *
 * Principios:
 * - Foco en control de gastos (deudas, presupuestos, conciliación)
 * - CTAs de acción financieras (aprobar, conciliar, pagar)
 * - Separación clara de Business Core
 */
import { Link, useLocation } from "react-router-dom";
import { Search, Settings, FileText, Wallet, Landmark, TrendingUp, Plus, Receipt, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const FINANCE_TABS = [
  { to: "/deudas", label: "Cobranzas", icon: Wallet },
  { to: "/facturas", label: "Facturas", icon: FileText },
  { to: "/ia-finance", label: "IA Finance", icon: Sparkles },
  { to: "/billetera", label: "Billetera", icon: Receipt },
  { to: "/banco", label: "Conciliación", icon: Landmark },
  { to: "/cash-flow", label: "Flujo de Caja", icon: TrendingUp },
] as const;

const FINANCE_ROUTES = new Set([
  "/deudas", "/presupuestos", "/cuotas", "/facturas", "/devoluciones",
  "/billetera", "/movimientos", "/cash-flow", "/pl-dashboard",
  "/banco", "/gastos", "/comisiones", "/impuestos", "/afip",
  "/multi-divisa", "/cheques", "/suscripciones", "/libro",
]);

export default function FinanceHeader() {
  const { pathname } = useLocation();

  // Sólo mostrar en rutas de Finance
  const isFinanceRoute = FINANCE_ROUTES.has(pathname) || pathname.startsWith("/deudas") || pathname.startsWith("/facturas") || pathname.startsWith("/billetera");
  if (!isFinanceRoute) return null;

  const activeTab = FINANCE_TABS.find(tab => pathname === tab.to || pathname.startsWith(tab.to + "/"));

  return (
    <div className="finance-header border-b border-teal-500/20 bg-teal-50/50 dark:bg-teal-950/10 backdrop-blur supports-[backdrop-filter]:bg-teal-50/60">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Brand y Tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <span className="font-semibold text-sm text-teal-900 dark:text-teal-100">Finance</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {FINANCE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab?.to === tab.to;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-teal-500/10 text-teal-700 dark:text-teal-300"
                      : "text-teal-700/70 dark:text-teal-400/70 hover:bg-teal-500/10 hover:text-teal-800 dark:hover:text-teal-200"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Search y Actions */}
        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar facturas, gastos..."
              className="h-9 w-64 pl-9 bg-teal-50/50 border-teal-200/50 dark:bg-teal-950/50 dark:border-teal-800/50"
            />
          </div>

          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-teal-700 dark:text-teal-300">
            <Settings className="h-4 w-4" />
          </Button>

          <Button size="sm" className="h-9 gap-2 bg-teal-600 hover:bg-teal-700 text-white">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Registrar Gasto</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
