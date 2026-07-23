import { Link, useLocation, useNavigate } from "react-router-dom";
import { PAGE_GUIDES } from "@/data/pageGuides";
import { LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings, TrendingUp, TrendingDown, Menu, X, Megaphone, Brain, LogOut, Users, Crown, ChevronsLeft, ChevronsRight, Search, Gift, BookOpen, Wallet, Receipt, Sparkles, ShoppingBag, ScanLine, Banknote, PackageOpen, ListChecks, History, Kanban, Star, CreditCard, FileText, Zap, Truck, Landmark, ClipboardList, RotateCcw, BarChart3, Mail, MapPin, Plug, UserCircle, CheckSquare, AlertTriangle, X as XIcon, MessageCircle, RefreshCw, Activity, Target, Bell, Percent, Tag, Calendar, Headphones, Wrench, Layers, ArrowRightLeft, Timer, UserPlus, Clock, QrCode, Ticket, CalendarClock, FileDown, Trophy, ShieldCheck, FormInput, BellRing, PiggyBank, Share2, ScanBarcode, ChefHat, Building2, FolderKanban, Users2, PackageSearch, Scale, Car, Trash2, Globe, Warehouse, FolderOpen, LineChart, Shield, Code2, Map, Eye, Leaf, ChevronRight } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/lib/useUserRole";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { useEntitlements } from "@/lib/useEntitlements";
import { useRealtimeKPIs } from "@/hooks/useRealtimeKPIs";
import { useStockAlerts } from "@/hooks/useStockAlerts";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";
import { useIdleDetector } from "@/hooks/useIdleDetector";
import { toast } from "sonner";
import NotificationBell from "@/components/shared/NotificationBell";
import OrgSwitcher from "@/components/shared/OrgSwitcher";
import PageGuide from "@/components/shared/PageGuide";
import PresenceAvatars from "@/components/shared/PresenceAvatars";
import CommandPalette from "@/components/shared/CommandPalette";

const allNavItems = [
  // ── Principal ───────────────────────────────────────────────────────────────
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ['admin', 'vendedor'], section: 'principal' },
  { to: "/caja", label: "Caja / POS", icon: ScanLine, roles: ['admin', 'vendedor'], section: 'principal' },
  { to: "/tareas", label: "Tareas", icon: CheckSquare, roles: ['admin', 'vendedor'], section: 'principal' },
  { to: "/seguimiento", label: "Seguimiento", icon: Bell, roles: ['admin', 'vendedor'], section: 'principal' },
  { to: "/calendario", label: "Calendario", icon: Calendar, roles: ['admin', 'vendedor'], section: 'principal' },
  // ── Inventario ──────────────────────────────────────────────────────────────
  { to: "/productos", label: "Productos", icon: Package, roles: ['admin'], section: 'inventario' },
  { to: "/bundles", label: "Bundles / Kits", icon: Layers, roles: ['admin'], section: 'inventario' },
  { to: "/compras", label: "Compras", icon: ShoppingCart, roles: ['admin'], section: 'inventario' },
  { to: "/ordenes-compra", label: "Órdenes de Compra", icon: ClipboardList, roles: ['admin'], section: 'inventario' },
  { to: "/restock", label: "Auto-Reposición", icon: RefreshCw, roles: ['admin'], section: 'inventario' },
  { to: "/transferencias", label: "Transferencias", icon: ArrowRightLeft, roles: ['admin'], section: 'inventario' },
  // ── Ventas & CRM ────────────────────────────────────────────────────────────
  { to: "/ventas", label: "Ventas", icon: DollarSign, roles: ['admin', 'vendedor'], section: 'ventas' },
  { to: "/clientes", label: "Clientes / CRM", icon: Users, roles: ['admin', 'vendedor'], section: 'ventas' },
  { to: "/presupuestos", label: "Presupuestos", icon: ClipboardList, roles: ['admin'], section: 'ventas' },
  { to: "/deudas", label: "Deudas", icon: AlertCircle, roles: ['admin'], section: 'ventas' },
  { to: "/devoluciones", label: "Devoluciones", icon: RotateCcw, roles: ['admin'], section: 'ventas' },
  { to: "/fidelidad", label: "Fidelidad", icon: Star, roles: ['admin'], section: 'ventas' },
  { to: "/rfm", label: "Segmentación RFM", icon: Users, roles: ['admin'], section: 'ventas' },
  { to: "/segmentos", label: "Segmentos Dinámicos", icon: Layers, roles: ['admin'], section: 'ventas' },
  { to: "/envios", label: "Seguimiento de Envíos", icon: Truck, roles: ['admin', 'vendedor'], section: 'ventas' },
  { to: "/cupones", label: "Cupones", icon: Tag, roles: ['admin'], section: 'ventas' },
  // ── Finanzas ────────────────────────────────────────────────────────────────
  { to: "/gastos", label: "Gastos", icon: Wallet, roles: ['admin'], section: 'finanzas' },
  { to: "/proveedores", label: "Proveedores", icon: Truck, roles: ['admin'], section: 'finanzas' },
  { to: "/banco", label: "Banco / Conciliación", icon: Landmark, roles: ['admin'], section: 'finanzas' },
  { to: "/movimientos", label: "Libro Mayor", icon: BookOpen, roles: ['admin'], section: 'finanzas' },
  { to: "/cuotas", label: "Cuotas", icon: CreditCard, roles: ['admin'], section: 'finanzas' },
  { to: "/cheques", label: "Cheques", icon: FileText, roles: ['admin'], section: 'finanzas' },
  { to: "/comisiones", label: "Comisiones", icon: Receipt, roles: ['admin'], section: 'finanzas' },
  { to: "/facturas", label: "Facturas", icon: FileText, roles: ['admin'], section: 'finanzas' },
  // ── Analytics ───────────────────────────────────────────────────────────────
  { to: "/reportes", label: "Reportes", icon: TrendingUp, roles: ['admin'], section: 'analytics' },
  { to: "/analytics", label: "Analytics", icon: BarChart3, roles: ['admin'], section: 'analytics' },
  { to: "/actividad", label: "Feed de Actividad", icon: Activity, roles: ['admin'], section: 'analytics' },
  { to: "/forecast", label: "Forecast de Ventas", icon: TrendingUp, roles: ['admin'], section: 'analytics' },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle, roles: ['admin'], section: 'analytics' },
  // ── Marketing ───────────────────────────────────────────────────────────────
  { to: "/marketing", label: "Marketing", icon: Megaphone, roles: ['admin'], section: 'marketing' },
  { to: "/promociones", label: "Flash Sales / Promo", icon: Zap, roles: ['admin'], section: 'marketing' },
  { to: "/canjes", label: "Canjes & Influencers", icon: Gift, roles: ['admin'], section: 'marketing' },
  { to: "/email-campaigns", label: "Email Marketing", icon: Mail, roles: ['admin'], section: 'marketing' },
  { to: "/secuencias-email", label: "Drip Sequences", icon: Zap, roles: ['admin'], section: 'marketing' },
  { to: "/whatsapp-campaigns", label: "WhatsApp Masivo", icon: MessageCircle, roles: ['admin'], section: 'marketing' },
  { to: "/links-de-pago", label: "Links de Pago", icon: CreditCard, roles: ['admin'], section: 'finanzas' },
  { to: "/catalogo", label: "Catálogo Online", icon: BookOpen, roles: ['admin'], section: 'marketing' },
  // ── IA ──────────────────────────────────────────────────────────────────────
  { to: "/lead-scoring", label: "AI Lead Scoring", icon: Brain, roles: ['admin'], section: 'ia' },
  { to: "/recomendaciones-ia", label: "AI Recomendador", icon: Sparkles, roles: ['admin'], section: 'ia' },
  { to: "/chat-ia", label: "Chat IA", icon: Brain, roles: ['admin'], section: 'ia' },
  { to: "/automatizaciones", label: "Automatizaciones", icon: Zap, roles: ['admin'], section: 'ia' },
  // ── Sistema ─────────────────────────────────────────────────────────────────
  { to: "/suscripciones", label: "Suscripciones", icon: CreditCard, roles: ['admin'], section: 'finanzas' },
  { to: "/listas-precios", label: "Listas de Precios", icon: Tag, roles: ['admin'], section: 'inventario' },
  { to: "/forecast-inventario", label: "Forecast Inventario", icon: TrendingUp, roles: ['admin'], section: 'inventario' },
  { to: "/afiliados", label: "Programa Afiliados", icon: UserPlus, roles: ['admin'], section: 'marketing' },
  { to: "/cash-flow", label: "Cash Flow", icon: BarChart3, roles: ['admin'], section: 'finanzas' },
  { to: "/planner-social", label: "Planner Social", icon: Share2, roles: ['admin'], section: 'marketing' },
  { to: "/lotes", label: "Lotes & Vencimientos", icon: ScanBarcode, roles: ['admin'], section: 'inventario' },
  { to: "/impuestos", label: "Gestión Impositiva", icon: Scale, roles: ['admin'], section: 'finanzas' },
  { to: "/kpi-dashboard", label: "KPI Dashboard", icon: LineChart, roles: ['admin'], section: 'analytics' },
  { to: "/devoluciones-rma", label: "Portal Devoluciones RMA", icon: RotateCcw, roles: ['admin'], section: 'ventas' },
  { to: "/inventario-inteligente", label: "Inventario Inteligente IA", icon: Brain, roles: ['admin'], section: 'inventario' },
  { to: "/afip", label: "AFIP / Fact. Electrónica", icon: Shield, roles: ['admin'], section: 'finanzas' },
  { to: "/bi-reportes", label: "BI & Reports Avanzados", icon: BarChart3, roles: ['admin'], section: 'analytics' },
  { to: "/tienda-online", label: "Tienda Online", icon: ShoppingBag, roles: ['admin'], section: 'ventas' },
  { to: "/multi-divisa", label: "Multi-Divisa FX", icon: DollarSign, roles: ['admin'], section: 'finanzas' },
  { to: "/motor-precios", label: "Motor de Precios", icon: Tag, roles: ['admin'], section: 'inventario' },
  { to: "/analytics-ia", label: "Analytics Predictivo IA", icon: Brain, roles: ['admin'], section: 'ia' },
  { to: "/crm-avanzado", label: "CRM / Pipeline", icon: Kanban, roles: ['admin'], section: 'ventas' },
  { to: "/sucursales", label: "Sucursales & Depósitos", icon: Warehouse, roles: ['admin'], section: 'inventario' },
  { to: "/valuacion-inventario", label: "Valuación de Inventario", icon: Layers, roles: ['admin'], section: 'inventario' },
  { to: "/pl-dashboard", label: "Dashboard P&L", icon: TrendingUp, roles: ['admin'], section: 'finanzas' },
  { to: "/integraciones", label: "Integraciones & API", icon: Plug, roles: ['admin'], section: 'config' },
  { to: "/equipo", label: "Equipo", icon: Users, roles: ['admin'], section: 'config' },
  { to: "/ajustes", label: "Ajustes", icon: Settings, roles: ['admin'], section: 'config' },
  { to: "/perfil", label: "Mi Perfil", icon: UserCircle, roles: ['admin', 'vendedor'], section: 'config' },
  { to: "/admin", label: "Admin", icon: Crown, roles: ['admin'], section: 'config' },
];

const SECTION_LABELS: Record<string, string> = {
  principal: '',
  inventario: 'Inventario',
  ventas: 'Ventas & CRM',
  finanzas: 'Finanzas',
  analytics: 'Analytics',
  marketing: 'Marketing',
  ia: 'Inteligencia Artificial',
  config: 'Sistema',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { role } = useUserRole();
  const { isPlatformAdmin, activeOrg } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // ── Collapsible sidebar sections ─────────────────────────────────────────
  const ALL_SECTIONS = Object.keys(SECTION_LABELS);
  const getActiveSectionForPath = (path: string) => {
    const item = allNavItems.find(i => i.to === path);
    return item?.section ?? 'principal';
  };
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    // Restore from localStorage; default = ALL sections expanded
    try {
      const saved = localStorage.getItem('gestiona.sidebar.expanded');
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* ignore */ }
    return new Set(ALL_SECTIONS);
  });
  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) { next.delete(section); } else { next.add(section); }
      // Persist to localStorage
      try { localStorage.setItem('gestiona.sidebar.expanded', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  // Auto-expand the section of the newly active route (never auto-collapse)
  useEffect(() => {
    const section = getActiveSectionForPath(pathname);
    setExpandedSections(prev => {
      if (prev.has(section)) return prev;
      const next = new Set([...prev, section]);
      try { localStorage.setItem('gestiona.sidebar.expanded', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [pathname]);
  const config = useBusinessConfig();
  const { subscription, isTrialing, trialDaysLeft } = useEntitlements();

  // ── Global real-time KPI subscriptions ──────────────────────────────────
  // Toasts for new sales and stock alerts fire automatically from this hook.
  useRealtimeKPIs(activeOrg?.id);
  useStockAlerts({ orgId: activeOrg?.id, threshold: 5 });
  // ── PWA install prompt + offline detector ────────────────────────────────
  const { canInstall, install, dismiss: dismissInstall } = usePWAInstall();
  useOnlineStatus(); // fires toasts on online/offline changes automatically

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
      // Alt+1 → Dashboard, Alt+2 → POS, Alt+3 → Productos, Alt+4 → Ventas, Alt+5 → Clientes
      const routes: Record<string, string> = {
        "1": "/", "2": "/caja", "3": "/productos", "4": "/ventas", "5": "/clientes",
        "6": "/tareas", "7": "/movimientos", "8": "/analitica", "9": "/integraciones",
      };
      if (routes[e.key]) { e.preventDefault(); navigate(routes[e.key]); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  const navItems = useMemo(() => {
    return allNavItems.filter(item => item.roles.includes(role));
  }, [role]);

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
    const groups: { section: string; label: string; items: typeof navItems }[] = [];
    let currentSection = '';
    navItems.forEach(item => {
      if (item.section !== currentSection) {
        currentSection = item.section;
        groups.push({ section: item.section, label: SECTION_LABELS[item.section] || '', items: [] });
      }
      groups[groups.length - 1].items.push(item);
    });
    return groups;
  }, [navItems]);

  const handleLogout = async () => {
    await signOut();
    toast.success("Sesión cerrada");
  };

  const roleLabel = role === 'admin' ? 'Administrador' : role === 'vendedor' ? 'Vendedor' : 'Viewer';
  const roleBadgeClass = role === 'admin' 
    ? 'bg-primary/15 text-primary border-primary/20' 
    : role === 'vendedor' 
    ? 'bg-blue-500/15 text-blue-400 border-blue-500/20' 
    : 'bg-muted text-muted-foreground border-border';

  return (
    <div className="flex min-h-screen">
      {/* ── Idle session lock overlay ────────────────────────────── */}
      {idleLocked && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="bg-card border border-border/60 rounded-2xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl animate-fade-in">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-lg font-display font-bold mb-2">Sesion bloqueada</h2>
            <p className="text-sm text-muted-foreground mb-6">
              La sesion se bloqueo por inactividad. Hace clic para continuar.
            </p>
            <Button className="w-full gradient-gold text-primary-foreground font-semibold" onClick={() => setIdleLocked(false)}>
              Continuar
            </Button>
          </div>
        </div>
      )}

      {mobileOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 gradient-sidebar border-r border-sidebar-border flex flex-col shrink-0
        transform transition-all duration-300 ease-out h-screen
        ${collapsed ? 'w-[68px]' : 'w-[240px]'}
        ${mobileOpen ? 'translate-x-0 w-[240px]' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* ── Logo / Brand Header ──────────────────────────────────── */}
        <div className={`${collapsed ? 'px-3 py-4' : 'px-4 py-4'} border-b border-sidebar-border/60 flex items-center justify-between`}>
          <div className="flex items-center gap-3 min-w-0">
            {config.logoUrl ? (
              <div className="relative shrink-0">
                <img src={config.logoUrl} alt="Logo" className="w-8 h-8 rounded-[8px] object-cover ring-1 ring-primary/25" />
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-[1.5px] border-sidebar" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-[8px] gradient-gold flex items-center justify-center shrink-0 shadow-[0_2px_12px_-2px_hsl(38_82%_52%/0.5)]">
                <span className="text-primary-foreground font-bold text-[13px]">E</span>
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0 animate-fade-in">
                <p className="text-[13px] font-display font-bold text-foreground/90 truncate tracking-tight leading-none">
                  {config.businessName}
                </p>
                <span className={`inline-flex items-center px-1.5 py-[2px] rounded-[4px] text-[9px] font-semibold border mt-1 uppercase tracking-wide ${roleBadgeClass}`}>
                  {roleLabel}
                </span>
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" className="lg:hidden shrink-0 text-sidebar-foreground h-7 w-7 p-0" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <nav className="flex-1 px-2 py-2.5 overflow-y-auto scrollbar-hide">
          {groupedNav.map((group, gi) => {
            const isExpanded = group.section === 'principal' || collapsed || expandedSections.has(group.section);
            return (
            <div key={group.section} className={gi > 0 ? 'mt-1' : ''}>
              {/* Section label — clickable to collapse/expand */}
              {group.label && !collapsed && (
                <button
                  onClick={() => toggleSection(group.section)}
                  className={`w-full flex items-center justify-between px-2.5 ${gi > 0 ? 'pt-4 pb-1.5' : 'pb-1.5'} group/sec hover:opacity-100`}
                >
                  <span className="nav-section-label group-hover/sec:text-foreground/60 transition-colors">{group.label}</span>
                  <ChevronRight className={`w-3 h-3 text-muted-foreground/30 group-hover/sec:text-muted-foreground/60 transition-all duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
              )}
              {gi > 0 && collapsed && (
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
                        title={collapsed ? label : undefined}
                        className={`group relative flex items-center gap-2.5 py-[7px] rounded-[7px] text-[13px] font-medium transition-all duration-150 ${
                          collapsed ? 'justify-center px-0' : 'px-2.5'
                        } ${
                          active
                            ? "bg-gradient-to-r from-primary/14 to-primary/3 text-primary"
                            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
                        }`}
                      >
                        {/* Active left bar — glowing */}
                        {active && (
                          <div className="absolute left-0 top-[18%] bottom-[18%] w-[3px] rounded-r-full bg-primary shadow-[0_0_8px_hsl(38_82%_52%/0.7)]" />
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
                        {!collapsed && (
                          <span className="flex-1 truncate">{label}</span>
                        )}

                        {/* "new" badge */}
                        {!collapsed && hasNew && !active && (
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
        <div className={`${collapsed ? 'px-2 py-3' : 'px-3 py-3'} border-t border-sidebar-border/60 space-y-1.5`}>
          <OrgSwitcher collapsed={collapsed} />
          <NotificationBell collapsed={collapsed} />
          {isPlatformAdmin && (
            <Link
              to="/platform/admin"
              title={collapsed ? 'Platform Admin' : undefined}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-[12px] font-medium transition-all duration-150 w-full ${
                collapsed ? 'justify-center' : ''
              } ${
                pathname === '/platform/admin'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground/50 hover:bg-sidebar-accent/60 hover:text-primary'
              }`}
            >
              <Crown className="w-3.5 h-3.5 shrink-0" />
              {!collapsed && <span>Platform Admin</span>}
            </Link>
          )}
          {!collapsed && (
            <div className="px-1 py-1">
              <p className="text-[11px] text-muted-foreground/55 truncate font-mono">{user?.email}</p>
              <p className="text-[9px] text-muted-foreground/30 mt-0.5 uppercase tracking-widest">v8.5</p>
            </div>
          )}
          {!collapsed && (
            <div className="px-1 pb-1 flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground/25 uppercase tracking-widest font-mono">build</span>
              <span className="text-[9px] font-bold text-primary/50 font-mono">v9.0 · 132nav</span>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Cerrar sesión' : undefined}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-start gap-2 px-2.5'} py-1.5 rounded-[7px] text-[12px] text-muted-foreground/50 hover:text-destructive hover:bg-destructive/8 transition-all duration-150`}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      <main className={`flex-1 overflow-auto w-full transition-all duration-300 ${collapsed ? 'lg:ml-[68px]' : 'lg:ml-[240px]'}`}>
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 border-b border-border/30 px-4 h-12 flex items-center gap-3"
          style={{ background: 'hsl(228 32% 3% / 0.92)', backdropFilter: 'blur(16px) saturate(160%)' }}>
          <button
            onClick={() => setMobileOpen(true)}
            className="flex items-center justify-center w-7 h-7 rounded-[6px] border border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border/70 transition-all"
          >
            <Menu className="w-4 h-4" />
          </button>

          {/* Brand */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt="Logo" className="w-5 h-5 rounded-[4px] object-cover ring-1 ring-primary/20" />
            ) : (
              <div className="w-5 h-5 rounded-[4px] gradient-gold flex items-center justify-center shrink-0">
                <span className="text-primary-foreground font-black text-[9px]">E</span>
              </div>
            )}
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
            <div className="lg:hidden">
              <NotificationBell />
            </div>
          </div>
        </div>
        {/* Trial / subscription status banners */}
        {!bannerDismissed && (() => {
          if (subscription?.status === 'past_due') return (
            <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2.5 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-sm flex-1 text-destructive">
                <span className="font-semibold">Pago fallido.</span> Actualizá tu método de pago para no perder el acceso.
              </p>
              <Link to="/ajustes"><Button size="sm" variant="destructive" className="h-7 text-xs shrink-0">Actualizar pago</Button></Link>
              <button onClick={() => setBannerDismissed(true)} className="text-destructive/60 hover:text-destructive shrink-0"><XIcon className="w-4 h-4" /></button>
            </div>
          );
          if (subscription?.status === 'canceled') return (
            <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2.5 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
              <p className="text-sm flex-1 text-yellow-500">
                <span className="font-semibold">Suscripción cancelada.</span> Reactivá tu plan para seguir usando Gestiona.
              </p>
              <Link to="/pricing"><Button size="sm" className="h-7 text-xs shrink-0 bg-yellow-500 hover:bg-yellow-600 text-black">Reactivar</Button></Link>
              <button onClick={() => setBannerDismissed(true)} className="text-yellow-500/60 hover:text-yellow-500 shrink-0"><XIcon className="w-4 h-4" /></button>
            </div>
          );
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

        <div className="p-4 md:p-6 lg:p-8 max-w-[1380px] mx-auto animate-fade-in">
          {children}
        </div>
        {/* Floating page guide — rendered per-route, no-op if no guide exists */}
        <PageGuide />
      </main>

      {/* ── Global command palette — Ctrl+K anywhere ──────────────── */}
      <CommandPalette />
    </div>
  );
}
