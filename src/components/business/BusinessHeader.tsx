/**
 * BusinessHeader — Header específico para Business (operación central)
 *
 * Sólo aparece en rutas de Business: /caja, /ventas, /compras, /productos, etc.
 * Expresa claramente que Business es la operación central, no la adquisición.
 *
 * Principios:
 * - Foco en operación (POS, inventario, clientes, compras)
 * - CTAs de acción operativas (vender, reponer, comprar)
 * - Separación clara de Commerce
 */
import { Link, useLocation } from "react-router-dom";
import { Search, Settings, ScanLine, Package, Users, ShoppingCart, BarChart3, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const BUSINESS_TABS = [
  { to: "/caja", label: "POS", icon: ScanLine },
  { to: "/ventas", label: "Ventas", icon: ShoppingCart },
  { to: "/productos", label: "Productos", icon: Package },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/compras", label: "Compras", icon: RotateCcw },
] as const;

const BUSINESS_ROUTES = new Set([
  "/caja", "/ventas", "/compras", "/ordenes-compra", "/proveedores", "/planificacion",
  "/kardex", "/transferencias", "/sucursales", "/lotes", "/bundles", "/listas-precios",
  "/valuacion-inventario", "/productos", "/clientes",
]);

export default function BusinessHeader() {
  const { pathname } = useLocation();

  // Sólo mostrar en rutas de Business
  const isBusinessRoute = BUSINESS_ROUTES.has(pathname) || pathname.startsWith("/caja") || pathname.startsWith("/ventas") || pathname.startsWith("/compras");
  if (!isBusinessRoute) return null;

  const activeTab = BUSINESS_TABS.find(tab => pathname === tab.to || pathname.startsWith(tab.to + "/"));

  return (
    <div className="business-header border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Brand y Tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Business</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {BUSINESS_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab?.to === tab.to;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
              placeholder="Buscar productos, clientes..."
              className="h-9 w-64 pl-9 bg-muted/50 border-0"
            />
          </div>

          <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
            <Settings className="h-4 w-4" />
          </Button>

          <Button size="sm" className="h-9 gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva Venta</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
