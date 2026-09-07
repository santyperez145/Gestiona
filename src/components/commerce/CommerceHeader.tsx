/**
 * CommerceHeader — Header específico para Commerce (puerta de adquisición)
 *
 * Sólo aparece en rutas de Commerce: /tienda-online, /pedidos-online, /envios, etc.
 * Expresa claramente que Commerce es la puerta de adquisición, no la operación.
 *
 * Principios:
 * - Foco en conversión (pedidos, catálogo, analytics)
 * - CTAs de acción visibles
 * - Separación clara de Business
 */
import { Link, useLocation } from "react-router-dom";
import { Search, Settings, MessageCircle, ShoppingCart, LayoutDashboard, Package, BarChart3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const COMMERCE_TABS = [
  { to: "/tienda-online", label: "Mi Tienda", icon: LayoutDashboard },
  { to: "/pedidos-online", label: "Pedidos", icon: Package },
  { to: "/productos", label: "Catálogo", icon: ShoppingCart },
  { to: "/ia-commerce", label: "IA Tienda", icon: Sparkles },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

const COMMERCE_ROUTES = new Set([
  "/tienda-online",
  "/pedidos-online",
  "/envios",
  "/links-de-pago",
  "/cupones",
  "/promociones",
  "/productos",
  "/analytics",
]);

export default function CommerceHeader() {
  const { pathname } = useLocation();

  // Sólo mostrar en rutas de Commerce
  const isCommerceRoute = COMMERCE_ROUTES.has(pathname) || pathname.startsWith("/tienda-online/") || pathname.startsWith("/pedidos-online/");
  if (!isCommerceRoute) return null;

  const activeTab = COMMERCE_TABS.find(tab => pathname === tab.to || pathname.startsWith(tab.to + "/"));

  return (
    <div className="commerce-header border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Brand y Tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Commerce</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {COMMERCE_TABS.map((tab) => {
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
              placeholder="Buscar pedidos, productos..."
              className="h-9 w-64 pl-9 bg-muted/50 border-0"
            />
          </div>

          <Button variant="ghost" size="sm" className="h-9 w-9 p-0">
            <Settings className="h-4 w-4" />
          </Button>

          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 relative">
            <MessageCircle className="h-4 w-4" />
            <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]">
              3
            </Badge>
          </Button>

          <Button size="sm" className="h-9 gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nuevo Pedido</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
