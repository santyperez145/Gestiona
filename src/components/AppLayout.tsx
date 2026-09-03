import { Link, useLocation, useNavigate } from "react-router-dom";
import { PAGE_GUIDES } from "@/data/pageGuides";
import { LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings, TrendingUp, Menu, X, Megaphone, Brain, LogOut, Users, Crown, ChevronsLeft, ChevronsRight, Search, Gift, BookOpen, Wallet, Receipt, Sparkles, ShoppingBag, ScanLine, History, Kanban, Star, CreditCard, FileText, Zap, Truck, Landmark, ClipboardList, RotateCcw, BarChart3, Mail, Plug, UserCircle, CheckSquare, AlertTriangle, X as XIcon, MessageCircle, RefreshCw, Bell, Tag, Calendar, Layers, ArrowRightLeft, UserPlus, Trophy, Share2, ScanBarcode, Users2, Scale, Globe, Warehouse, LineChart, Shield, ChevronRight } from "lucide-react";
import { lazy, Suspense, useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/lib/useUserRole";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { useEntitlements } from "@/lib/useEntitlements";
import { useCambioDePrecio } from "@/lib/useCambioDePrecio";
import { formatARS } from "@/lib/supabaseStore";
import { useRealtimeKPIs } from "@/hooks/useRealtimeKPIs";
import { useStockAlerts } from "@/hooks/useStockAlerts";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";
import { useIdleDetector } from "@/hooks/useIdleDetector";
import { useIsTablet } from "@/hooks/useMediaQuery";
import { toast } from "sonner";
import NotificationBell from "@/components/shared/NotificationBell";
import PlatformAnnouncementBanner from "@/components/shared/PlatformAnnouncementBanner";
import OrgSwitcher from "@/components/shared/OrgSwitcher";
import PageGuide from "@/components/shared/PageGuide";
import PresenceAvatars from "@/components/shared/PresenceAvatars";
import ThemeToggle from "@/components/shared/ThemeToggle";
import BrandLogo from "@/components/shared/BrandLogo";
import { usePermissionsResolver } from "@/lib/permissionsContext";
import { moduleForRoute } from "@/lib/moduleMap";
import { NAV_ITEMS, NAV_GROUPS, grupoDeRuta } from "@/lib/navigation";

import { plural } from "@/lib/plural";

const CommandPalette = lazy(() => import("@/components/shared/CommandPalette"));

/**
 * La navegación vive en `src/lib/navigation.ts`.
 *
 * Antes eran 67 items declarados acá adentro, en 8 secciones que arrancaban
 * TODAS abiertas y con el mismo peso visual. Mirando los datos reales, diez
 * módulos sostienen el negocio y veinticuatro están en cero: darle a
 * "Multi-Divisa FX" el mismo tamaño que a "Productos" enseña a ignorar el menú.
 *
 * Ahora seis destinos quedan siempre a la vista y el resto vive en grupos que
 * abren de a uno. Ningún destino se perdió — los 67 siguen, y todos se alcanzan
 * además con Ctrl+K.
 */
const allNavItems = NAV_ITEMS.map(i => ({ ...i, section: i.group }));

const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  NAV_GROUPS.map(g => [g.id, g.label]),
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { role } = useUserRole();
  const { isPlatformAdmin, activeOrg } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Tablet (768–1023px) always shows the icon-only rail, regardless of the
  // user's lg+ collapse toggle — see effectiveCollapsed below.
  const isTablet = useIsTablet();
  const effectiveCollapsed = collapsed || isTablet;

  // ── Collapsible sidebar sections ─────────────────────────────────────────
  const getActiveSectionForPath = (path: string) => {
    const item = allNavItems.find(i => i.to === path);
    return item?.section ?? 'diario';
  };
  /**
   * Los grupos que el usuario abrió a mano.
   *
   * Existe para distinguirlos de los que se abren solos al navegar. Sin esa
   * distinción, la versión anterior auto-abría el grupo de cada página y no
   * cerraba ninguno: bastaba una semana de uso para volver a tener los siete
   * abiertos, o sea al menú de 67 renglones que esto viene a arreglar.
   *
   * La regla queda en una línea: **el grupo de la página actual siempre está
   * abierto; los demás, sólo si vos los abriste.**
   */
  const [fijados, setFijados] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('gestiona.sidebar.expanded.v3');
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });

  const toggleSection = (section: string) => {
    setFijados(prev => {
      const next = new Set(prev);
      if (next.has(section)) { next.delete(section); } else { next.add(section); }
      try { localStorage.setItem('gestiona.sidebar.expanded.v3', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const expandedSections = useMemo(() => {
    const activo = getActiveSectionForPath(pathname);
    return new Set([...fijados, activo]);
  }, [fijados, pathname]);
  const config = useBusinessConfig();
  const { subscription, isTrialing, trialDaysLeft, motivoDeCorte, diasDeGracia } = useEntitlements();
  const { cambio: cambioDePrecio } = useCambioDePrecio();

  // ── Global real-time KPI subscriptions ──────────────────────────────────
  // Toasts for new sales and stock alerts fire automatically from this hook.
  useRealtimeKPIs(activeOrg?.id);
  useStockAlerts({ orgId: activeOrg?.id, threshold: 5 });
  // ── PWA install prompt + offline detector ────────────────────────────────
  const { canInstall, install, dismiss: dismissInstall } = usePWAInstall();
  const { online } = useOnlineStatus(); // fires toasts on online/offline changes automatically

  // ── BroadcastChannel — cross-tab sync ────────────────────────────────────
  // When another tab saves a product/customer/sale, notify the user.
  useBroadcastChannel("gestiona-sync", (msg) => {
    if (msg.type === "product_saved") {
      toast.info(`Producto actualizado en otra pestaña`, { duration: 3000, description: String(msg.name || "") });
    } else if (msg.type === "sale_created") {
      toast.info(`Nueva venta registrada en otra pestaña`, { duration: 3000 });
    }
  });

  // ── Idle session lock — auto-blur after 30 min of inactivity ─────────────
  const [idleLocked, setIdleLocked] = useState(false);
  useIdleDetector({
    idleMs: 30 * 60 * 1000, // 30 minutes
    onIdle: () => setIdleLocked(true),
    onActive: () => setIdleLocked(false),
  });

  // ── Global keyboard shortcuts for quick navigation ────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Alt+2 es "vender ahora": el vendedor de mostrador sigue en POS;
      // quien eligió tienda (o todavía explora) entra por Commerce.
      const venderHoy = role === "vendedor" || activeOrg?.onboarding_goal === "pos"
        ? "/caja"
        : "/tienda-online";
      const routes: Record<string, string> = {
        "1": "/", "2": venderHoy, "3": "/productos", "4": "/ventas", "5": "/clientes",
        "6": "/tareas", "7": "/movimientos", "8": "/analytics", "9": "/integraciones",
      };
      if (routes[e.key]) { e.preventDefault(); navigate(routes[e.key]); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, role, activeOrg?.onboarding_goal]);

  // Además del rol, se respeta `can_view` por módulo (Admin → Permisos):
  // sin esto los toggles de la mayoría de los módulos no hacían nada.
  const { forModule } = usePermissionsResolver();
  const navItems = useMemo(() => {
    return allNavItems.filter(item => {
      if (!item.roles.includes(role)) return false;
      const mod = moduleForRoute(item.to, item.section);
      return !mod || forModule(mod).canView;
    });
  }, [role, forModule]);

  // Pages with "Nuevo" guide tips that haven't been seen yet
  const unseenNewPages = useMemo(() => {
    try {
      const seen = new Set<string>(JSON.parse(localStorage.getItem("gestiona.guide.seen") || "[]"));
      return new Set(
        Object.entries(PAGE_GUIDES)
          .filter(([path, g]) => !seen.has(path) && g.tips.some(t => t.tag === "Nuevo"))
          .map(([path]) => path)
      );
    } catch { return new Set<string>(); }
  }, [pathname]); // re-check when user navigates

  // Group nav items by section
  const groupedNav = useMemo(() => {
    // El orden de NAV_ITEMS no puede crear dos bloques con el mismo grupo.
    // Pasó al insertar "Mi plan" (Sistema) entre Cobranzas y Finanzas: el
    // algoritmo anterior asumía contigüidad, renderizaba Sistema dos veces y
    // React advertía claves duplicadas. NAV_GROUPS es la autoridad de orden.
    return NAV_GROUPS
      .map(group => ({
        section: group.id,
        label: group.label,
        items: navItems.filter(item => item.section === group.id),
      }))
      .filter(group => group.items.length > 0);
  }, [navItems]);

  const handleLogout = async () => {
    await signOut();
    toast.success("Sesión cerrada");
  };

  const currentNavItem = allNavItems.find(item => item.to === pathname);
  const currentPageLabel = currentNavItem?.label ?? (pathname === '/' ? 'Resumen' : 'Gestiona');
  const currentSectionLabel = currentNavItem ? SECTION_LABELS[currentNavItem.section] : 'Operacion';

  const roleLabel = role === 'admin' ? 'Administrador' : role === 'vendedor' ? 'Vendedor' : 'Viewer';
  const roleBadgeClass = role === 'admin'
    ? 'bg-primary/15 text-primary border-primary/20'
    : role === 'vendedor'
    ? 'bg-violet-500/15 text-violet-400 border-violet-500/20'
    : 'bg-muted text-muted-foreground border-border';

  return (
    <div className="workspace-shell flex min-h-screen">
      {/* ── Idle session lock overlay ────────────────────────────── */}
      <Dialog open={idleLocked}>
        <DialogContent
          size="sm"
          hideClose
          overlayClassName="z-[190]"
          className="z-[200] text-center"
          onEscapeKeyDown={event => event.preventDefault()}
          onPointerDownOutside={event => event.preventDefault()}
        >
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-primary" />
            </div>
            <DialogTitle>Sesión bloqueada</DialogTitle>
            <DialogDescription className="mt-2 mb-6">
              La sesion se bloqueo por inactividad. Hace clic para continuar.
            </DialogDescription>
            <Button className="w-full gradient-gold text-primary-foreground font-semibold" onClick={() => setIdleLocked(false)}>
              Continuar
            </Button>
        </DialogContent>
      </Dialog>

      {mobileOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`workspace-sidebar workspace-sidebar__rail
        fixed inset-y-0 left-0 z-50 gradient-sidebar border-r border-sidebar-border flex flex-col shrink-0
        transform transition-all duration-300 ease-out h-screen
        w-[270px] md:w-[248px] ${effectiveCollapsed ? 'md:w-[78px]' : 'md:w-[248px]'} ${collapsed ? 'lg:w-[78px]' : 'lg:w-[248px]'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
      `}>
        {/* ── Logo / Brand Header ──────────────────────────────────── */}
        <div className={`workspace-sidebar__brand ${effectiveCollapsed ? 'px-3 py-4' : 'px-4 py-4'} border-b border-sidebar-border/60 flex items-center justify-between`}>
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo compact decorative eager markClassName="h-8 w-8" />
            {!effectiveCollapsed && (
              <div className="min-w-0 animate-fade-in">
                <p className="text-[13px] font-display font-bold text-foreground/90 truncate tracking-tight leading-none">
                  Gestiona
                </p>
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[9px] text-muted-foreground" title={config.businessName}>{config.businessName}</span>
                  <span className={`inline-flex shrink-0 items-center rounded-[4px] border px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-wide ${roleBadgeClass}`}>{roleLabel}</span>
                </div>
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" className="md:hidden shrink-0 text-sidebar-foreground h-7 w-7 p-0" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <nav className="workspace-sidebar__nav flex-1 px-2 py-2.5 overflow-y-auto scrollbar-hide">
          {groupedNav.map((group, gi) => {
            const isExpanded = group.section === 'diario' || effectiveCollapsed || expandedSections.has(group.section);
            return (
            <div key={group.section} className={gi > 0 ? 'mt-1' : ''}>
              {/* Section label — clickable to collapse/expand */}
              {group.label && !effectiveCollapsed && (
                <button
                  onClick={() => toggleSection(group.section)}
                  className={`w-full flex items-center justify-between px-2.5 ${gi > 0 ? 'pt-4 pb-1.5' : 'pb-1.5'} group/sec hover:opacity-100`}
                >
                  <span className="nav-section-label group-hover/sec:text-foreground/60 transition-colors">{group.label}</span>
                  <ChevronRight className={`w-3 h-3 text-muted-foreground/30 group-hover/sec:text-muted-foreground/60 transition-all duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
              )}
              {gi > 0 && effectiveCollapsed && (
                <div className="my-2 mx-3 border-t border-sidebar-border/40" />
              )}
              {/* Nav items — hidden when section is collapsed */}
              {isExpanded && (
                <div className="space-y-[2px]">
                  {group.items.map(({ to, label, icon: Icon }) => {
                    const active = pathname === to;
                    const hasNew = unseenNewPages.has(to);
                    return (
                      <Link
                        key={to}
                        to={to}
                        onClick={() => setMobileOpen(false)}
                        title={effectiveCollapsed ? label : undefined}
                        className={`workspace-nav-link group relative flex items-center gap-2.5 py-[7px] rounded-[7px] text-[13px] font-medium transition-all duration-150 ${
                          effectiveCollapsed ? 'justify-center px-0' : 'px-2.5'
                        } ${
                          active
                            ? "workspace-nav-link-active bg-gradient-to-r from-primary/14 to-primary/3 text-primary"
                            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
                        }`}
                      >
                        {/* Active left bar — glowing */}
                        {active && (
                              <div className="absolute left-0 top-[18%] bottom-[18%] w-[3px] rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.55)]" />
                        )}

                        {/* Icon */}
                        <div className={`relative shrink-0 transition-transform duration-150 ${active ? '' : 'group-hover:scale-105'}`}>
                          <Icon className={`w-[17px] h-[17px] ${active ? 'opacity-100' : 'opacity-70 group-hover:opacity-90'}`} />
                          {hasNew && !active && (
                            <span className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-primary">
                              <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
                            </span>
                          )}
                        </div>

                        {/* Label */}
                        {!effectiveCollapsed && (
                          <span className="flex-1 truncate">{label}</span>
                        )}

                        {/* "new" badge */}
                        {!effectiveCollapsed && hasNew && !active && (
                          <span className="text-[8px] font-bold px-1 py-px rounded-[3px] bg-primary/15 text-primary uppercase tracking-wider shrink-0">
                            new
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}
        </nav>

        {/* ── Collapse toggle ──────────────────────────────────────── */}
        <div className="hidden lg:block px-2 py-1 border-t border-sidebar-border/40">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center h-7 rounded-[6px] text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-sidebar-accent/50 transition-all duration-150"
          >
            {collapsed ? <ChevronsRight className="w-3.5 h-3.5" /> : <ChevronsLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className={`workspace-sidebar__footer ${effectiveCollapsed ? 'px-2 py-3' : 'px-3 py-3'} border-t border-sidebar-border/60 space-y-1.5`}>
          <OrgSwitcher collapsed={effectiveCollapsed} />
          <NotificationBell collapsed={effectiveCollapsed} />
          <ThemeToggle collapsed={effectiveCollapsed} />
          {role === 'admin' && forModule('finance').canView && (
            <Link
              to="/finance"
              title={effectiveCollapsed ? 'Gestiona Finance' : undefined}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-[12px] font-medium transition-all duration-150 w-full border border-transparent ${
                effectiveCollapsed ? 'justify-center' : ''
              } text-teal-600/80 hover:bg-teal-500/10 hover:text-teal-700 hover:border-teal-500/25 dark:text-teal-300/70 dark:hover:text-teal-200`}
            >
              <Receipt className="w-3.5 h-3.5 shrink-0" />
              {!effectiveCollapsed && <span>Gestiona Finance</span>}
            </Link>
          )}
          {isPlatformAdmin && (
            <Link
              to="/platform"
              title={effectiveCollapsed ? 'Panel de plataforma' : undefined}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-[12px] font-medium transition-all duration-150 w-full border border-transparent ${
                effectiveCollapsed ? 'justify-center' : ''
              } text-violet-300/60 hover:bg-violet-500/10 hover:text-violet-200 hover:border-violet-500/25`}
            >
              <Crown className="w-3.5 h-3.5 shrink-0" />
              {!effectiveCollapsed && <span>Panel de plataforma</span>}
            </Link>
          )}
          {!effectiveCollapsed && (
            <div className="px-1 py-1">
              <p className="text-[11px] text-muted-foreground/55 truncate font-mono">{user?.email}</p>
              <p className="text-[9px] text-muted-foreground/30 mt-0.5 uppercase tracking-widest font-mono">v10.0</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={effectiveCollapsed ? 'Cerrar sesión' : undefined}
            className={`w-full flex items-center ${effectiveCollapsed ? 'justify-center' : 'justify-start gap-2 px-2.5'} py-1.5 rounded-[7px] text-[12px] text-muted-foreground/50 hover:text-destructive hover:bg-destructive/8 transition-all duration-150`}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!effectiveCollapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      <main className={`workspace-main flex-1 overflow-auto w-full min-h-screen bg-background transition-all duration-300 ${effectiveCollapsed ? 'md:ml-[78px]' : 'md:ml-[248px]'} ${collapsed ? 'lg:ml-[78px]' : 'lg:ml-[248px]'}`}>
        {/* Desktop command bar: a stable orientation point across every module. */}
        <header className="workspace-topbar hidden md:flex sticky top-0 z-30 h-14 items-center gap-4 border-b border-border/70 px-6 topbar-surface">
          <div className="workspace-topbar__context min-w-0 flex-1">
            <div className="workspace-topbar__workspace flex items-center gap-2">
              <span className="workspace-topbar__workspace-dot" aria-hidden="true" />
              <span className="workspace-topbar__workspace-label">Workspace operativo</span>
              <span className="workspace-topbar__workspace-name truncate">{config.businessName}</span>
            </div>
            <div className="workspace-topbar__breadcrumb flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/65">
              <span>{currentSectionLabel}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
              <span className="truncate text-foreground/80">{currentPageLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            className="workspace-command-search hidden lg:flex h-8 w-[220px] items-center gap-2 rounded-[7px] border border-border/80 bg-card/70 px-2.5 text-left text-[11px] text-muted-foreground/70 transition-colors hover:border-primary/45 hover:text-foreground"
            aria-label="Buscar en Gestiona"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">Buscar en Gestiona</span>
            <kbd className="rounded-[4px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">Ctrl K</kbd>
          </button>

          <div className={`workspace-topbar__status hidden xl:flex items-center gap-2 text-[11px] ${online ? 'text-muted-foreground/75' : 'text-destructive'}`}>
            <span className={`status-dot ${online ? 'bg-emerald-500' : 'bg-destructive'}`} />
            {online ? 'Operativo' : 'Sin conexion'}
          </div>
          <Link
            to="/ventas"
            className="workspace-primary-action workspace-topbar__cta inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[11px] font-semibold text-primary-foreground shadow-gold transition-all hover:brightness-105"
          >
            <DollarSign className="h-3.5 w-3.5" />
            Nueva venta
          </Link>
          <PresenceAvatars maxVisible={3} size={24} className="hidden lg:flex" />
        </header>
        {/* Mobile-only header — hidden from md upward, where the icon rail is always visible */}
        <div className="workspace-mobile-bar workspace-mobile-bar__inner md:hidden sticky top-0 z-30 border-b border-border/30 px-4 h-12 flex items-center gap-3"
          style={{ background: 'hsl(var(--sidebar-background) / 0.92)', backdropFilter: 'blur(16px) saturate(160%)' }}>
          <button
            onClick={() => setMobileOpen(true)}
            className="flex items-center justify-center w-7 h-7 rounded-[6px] border border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border/70 transition-all"
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Brand */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <BrandLogo compact eager markClassName="h-5 w-5" />
            <span className="font-display font-semibold text-[13px] text-foreground/80 truncate tracking-tight">
              {config.businessName}
            </span>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Presence avatars — who's online in the org */}
            <PresenceAvatars maxVisible={3} size={22} className="hidden sm:flex" />

            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="flex items-center justify-center w-7 h-7 rounded-[6px] text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-all"
              aria-label="Buscar"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <div className="md:hidden">
              <NotificationBell />
            </div>
          </div>
        </div>
        {/* Plataforma → comercios: no se muestra en la tienda pública ni en /platform. */}
        <PlatformAnnouncementBanner enabled={Boolean(activeOrg)} />

        {/* ── Cambio de precio programado ──────────────────────────────────
            Va ANTES de los avisos de suscripción y **no se puede descartar**:
            es información que cambia lo que le van a cobrar, y esconderla
            detrás de una X sería vaciar el aviso de sentido. Desaparece sola
            cuando el cambio se aplica. */}
        {cambioDePrecio && (
          <div className={`border-b px-4 py-2.5 flex items-center gap-3 ${
            cambioDePrecio.sube
              ? 'bg-warning/10 border-warning/20 text-warning'
              : 'bg-teal-500/10 border-teal-500/20 text-teal-700 dark:text-teal-300'
          }`}>
            <Tag className="w-4 h-4 shrink-0" />
            <p className="text-sm flex-1">
              <span className="font-semibold">
                {cambioDePrecio.sube ? 'Tu suscripción cambia de precio.' : 'Tu suscripción baja de precio.'}
              </span>{' '}
              {cambioDePrecio.precio_anterior != null && (
                <>Pasa de {formatARS(cambioDePrecio.precio_anterior)} a </>
              )}
              {cambioDePrecio.precio_anterior == null && <>Pasa a </>}
              <span className="font-semibold">{formatARS(cambioDePrecio.precio_nuevo)}</span>
              {cambioDePrecio.ciclo === 'anual' ? ' por año' : ' por mes'}
              {cambioDePrecio.dias_para_que_rija > 0
                ? ` en ${cambioDePrecio.dias_para_que_rija} ${cambioDePrecio.dias_para_que_rija === 1 ? 'día' : 'días'}.`
                : ' desde hoy.'}
              {cambioDePrecio.motivo ? ` ${cambioDePrecio.motivo}` : ''}
            </p>
            <Link to="/mi-plan">
              <Button size="sm" variant="outline" className="h-7 text-xs shrink-0">Ver mi plan</Button>
            </Link>
          </div>
        )}

        {/* Trial / subscription status banners */}
        {!bannerDismissed && (() => {
          /**
           * ── El aviso dice qué pasó de verdad ─────────────────────────────
           *
           * ⚠️ Antes, cualquier `past_due` mostraba «Pago fallido. Actualizá
           * tu método de pago». Pero `past_due` es también el estado con el
           * que **nace** toda suscripción: `mp-subscribe` la guarda así, sin
           * `current_period_end`, y la activa el webhook cuando MercadoPago
           * confirma el primer cobro. Al comercio que acababa de poner la
           * tarjeta se le acusaba de no haber pagado.
           *
           * Se distinguen tres cosas distintas que se veían iguales:
           * confirmación en curso, pago pendiente con gracia, y beneficios ya
           * apagados.
           */
          const nuncaSeCobro = subscription?.status === 'past_due'
            && !subscription?.current_period_end;

          if (nuncaSeCobro) return (
            <div className="bg-primary/8 border-b border-primary/20 px-4 py-2.5 flex items-center gap-3">
              <Zap className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm flex-1">
                <span className="font-semibold">Estamos confirmando tu suscripción con MercadoPago.</span>{' '}
                Puede tardar unos minutos. No hace falta que hagas nada.
              </p>
              <Link to="/mi-plan"><Button size="sm" variant="outline" className="h-7 text-xs shrink-0">Ver mi plan</Button></Link>
              <button onClick={() => setBannerDismissed(true)} className="text-muted-foreground/60 hover:text-muted-foreground shrink-0"><XIcon className="w-4 h-4" /></button>
            </div>
          );

          if (motivoDeCorte) return (
            <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2.5 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-sm flex-1 text-destructive">
                <span className="font-semibold">
                  {motivoDeCorte === 'impago' ? 'Tu suscripción tiene un pago pendiente.'
                    : motivoDeCorte === 'pausado' ? 'Tu suscripción está pausada.'
                    : 'Tu suscripción está cancelada.'}
                </span>{' '}
                Se apagaron los extras del plan. Tus datos, ventas y stock siguen intactos.
              </p>
              <Link to="/mi-plan"><Button size="sm" variant="destructive" className="h-7 text-xs shrink-0">Regularizar</Button></Link>
              <button onClick={() => setBannerDismissed(true)} className="text-destructive/60 hover:text-destructive shrink-0"><XIcon className="w-4 h-4" /></button>
            </div>
          );

          if (subscription?.status === 'past_due') return (
            <div className="bg-warning/10 border-b border-warning/20 px-4 py-2.5 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <p className="text-sm flex-1 text-warning">
                <span className="font-semibold">Pago pendiente.</span>{' '}
                {diasDeGracia === 1
                  ? 'Te queda 1 día antes de que se apaguen los extras del plan.'
                  : `Te quedan ${plural(diasDeGracia, "día")} antes de que se apaguen los extras del plan.`}
              </p>
              <Link to="/mi-plan"><Button size="sm" className="h-7 text-xs shrink-0 bg-warning hover:bg-warning/90 text-warning-foreground">Actualizar pago</Button></Link>
              <button onClick={() => setBannerDismissed(true)} className="text-warning/60 hover:text-warning shrink-0"><XIcon className="w-4 h-4" /></button>
            </div>
          );
          // `canceled` y `paused` ya los cubre la rama de `motivoDeCorte`:
          // tener un segundo cartel para lo mismo es cómo terminan
          // contradiciéndose dos mensajes sobre el mismo estado.
          if (isTrialing && trialDaysLeft <= 7) return (
            <div className="bg-primary/8 border-b border-primary/20 px-4 py-2.5 flex items-center gap-3">
              <Zap className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm flex-1">
                {trialDaysLeft === 0
                  ? <><span className="font-semibold text-destructive">Tu trial venció hoy.</span> Elegí un plan para seguir usando el sistema.</>
                  : <><span className="font-semibold">Trial: {trialDaysLeft} {trialDaysLeft === 1 ? 'día' : 'días'} restantes.</span> Elegí un plan antes de que expire.</>
                }
              </p>
              <Link to="/pricing"><Button size="sm" className="h-7 text-xs gradient-gold text-primary-foreground shrink-0">Ver planes</Button></Link>
              <button onClick={() => setBannerDismissed(true)} className="text-muted-foreground/60 hover:text-muted-foreground shrink-0"><XIcon className="w-4 h-4" /></button>
            </div>
          );
          return null;
        })()}

        {/* PWA install banner */}
        {canInstall && (
          <div className="bg-primary/8 border-b border-primary/20 px-4 py-2.5 flex items-center gap-3">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <p className="text-sm flex-1">
              <span className="font-semibold">Instalá Gestiona</span> como app en tu dispositivo — acceso rápido sin abrir el navegador.
            </p>
            <Button size="sm" className="h-7 text-xs gradient-gold text-primary-foreground shrink-0" onClick={install}>
              Instalar app
            </Button>
            <button onClick={dismissInstall} className="text-muted-foreground/60 hover:text-muted-foreground shrink-0">
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="workspace-content p-4 md:p-6 lg:p-8 max-w-[1380px] mx-auto animate-fade-in">
          <div className="workspace-page workspace-route-surface">
            {children}
          </div>
        </div>
        {/* Floating page guide — rendered per-route, no-op if no guide exists */}
        <PageGuide />
      </main>

      {/* ── Global command palette — Ctrl+K anywhere ──────────────── */}
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </div>
  );
}
