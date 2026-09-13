/**
 * PlatformHeader — Header específico para Platform (control plane)
 *
 * Sólo aparece en rutas de Platform: /platform, /platform/orgs, etc.
 * Expresa claramente que Platform es el control plane, no el panel del comercio.
 *
 * Principios:
 * - Foco en control de plataforma (ATM, métricas, operaciones)
 * - CTAs de acción sistémicas (merchants, health, alerts)
 * - Separación clara de tenant
 */
import { Link, useLocation } from "react-router-dom";
import { Search, Settings, Crown, Building2, BarChart3, ShieldCheck, Headphones, Mail, Megaphone, Users, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PLATFORM_TABS = [
  { to: "/platform", label: "Resumen", icon: Crown },
  { to: "/platform/orgs", label: "Organizaciones", icon: Building2 },
  { to: "/platform/metricas", label: "Métricas", icon: BarChart3 },
  { to: "/platform/operaciones", label: "Operaciones", icon: ShieldCheck },
] as const;

const PLATFORM_ROUTES = new Set([
  "/platform", "/platform/orgs", "/platform/usuarios", "/platform/metricas",
  "/platform/integraciones", "/platform/operaciones", "/platform/sistema",
  "/platform/mensajeria", "/platform/planes", "/platform/negocio",
  "/platform/comisiones", "/platform/afip", "/platform/soporte", "/platform/anuncios",
]);

export default function PlatformHeader() {
  const { pathname } = useLocation();

  // Sólo mostrar en rutas de Platform
  const isPlatformRoute = PLATFORM_ROUTES.has(pathname) || pathname.startsWith("/platform/");
  if (!isPlatformRoute) return null;

  const activeTab = PLATFORM_TABS.find(tab => pathname === tab.to || pathname.startsWith(tab.to + "/"));

  return (
    <div className="platform-header border-b border-border bg-card/80 dark:bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/70">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Brand y Tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold text-sm text-foreground">Platform</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {PLATFORM_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab?.to === tab.to;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
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
              placeholder="Buscar organizaciones, métricas..."
              className="h-9 w-64 pl-9 bg-muted border-border/60"
            />
          </div>

<Button variant="outline" size="sm" className="h-9 w-9 p-0 text-slate-700 dark:text-slate-300">
                <Settings className="h-4 w-4" />
              </Button>

              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-slate-700 dark:text-slate-300 relative">
                <Bell className="h-4 w-4" />
                <Badge className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-destructive">
                  5
                </Badge>
              </Button>

              <Button size="sm" className="h-9 gap-2 bg-slate-700 hover:bg-slate-800 text-white dark:bg-slate-600 dark:hover:bg-slate-700">
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">Nuevo Merchant</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
