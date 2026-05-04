import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings, TrendingUp, Menu, X, Megaphone, Brain, LogOut, Users, Crown, ChevronsLeft, ChevronsRight, Search, Gift, BookOpen, Wallet, Receipt, Sparkles, Zap, AlertTriangle, X as XIcon, BarChart3, FileText, ScanLine, Banknote, Plug, Truck, ClipboardList, RotateCcw, UserCircle, PackageOpen, ListChecks, Mail, Landmark, Kanban, Star } from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/lib/useUserRole";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { useEntitlements } from "@/lib/useEntitlements";
import { toast } from "sonner";
import NotificationBell from "@/components/shared/NotificationBell";
import OrgSwitcher from "@/components/shared/OrgSwitcher";

const allNavItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ['admin', 'vendedor'], section: 'principal' },
  { to: "/caja", label: "Caja / POS", icon: ScanLine, roles: ['admin', 'vendedor'], section: 'principal' },
  { to: "/caja/turno", label: "Turno de Caja", icon: Banknote, roles: ['admin'], section: 'principal' },
  { to: "/productos", label: "Productos", icon: Package, roles: ['admin'], section: 'inventario' },
  { to: "/compras", label: "Compras", icon: ShoppingCart, roles: ['admin'], section: 'inventario' },
  { to: "/restock", label: "Auto-Restock", icon: PackageOpen, roles: ['admin'], section: 'inventario' },
  { to: "/toma-fisica", label: "Toma Física", icon: ListChecks, roles: ['admin'], section: 'inventario' },
  { to: "/ventas", label: "Ventas", icon: DollarSign, roles: ['admin', 'vendedor'], section: 'ventas' },
  { to: "/deudas", label: "Deudas", icon: AlertCircle, roles: ['admin'], section: 'ventas' },
  { to: "/clientes", label: "Clientes", icon: Users, roles: ['admin', 'vendedor'], section: 'ventas' },
  { to: "/pipeline", label: "Pipeline", icon: Kanban, roles: ['admin', 'vendedor'], section: 'ventas' },
  { to: "/fidelidad", label: "Fidelidad", icon: Star, roles: ['admin'], section: 'ventas' },
  { to: "/gastos", label: "Gastos", icon: Wallet, roles: ['admin'], section: 'finanzas' },
  { to: "/proveedores", label: "Proveedores", icon: Truck, roles: ['admin'], section: 'finanzas' },
  { to: "/banco", label: "Banco / Conciliación", icon: Landmark, roles: ['admin'], section: 'finanzas' },
  { to: "/presupuestos", label: "Presupuestos", icon: ClipboardList, roles: ['admin'], section: 'ventas' },
  { to: "/devoluciones", label: "Devoluciones", icon: RotateCcw, roles: ['admin'], section: 'ventas' },
  { to: "/reportes", label: "Reportes", icon: TrendingUp, roles: ['admin'], section: 'analytics' },
  { to: "/analytics", label: "Analytics", icon: BarChart3, roles: ['admin'], section: 'analytics' },
  { to: "/marketing", label: "Marketing", icon: Megaphone, roles: ['admin'], section: 'analytics' },
  { to: "/email-campaigns", label: "Email Marketing", icon: Mail, roles: ['admin'], section: 'analytics' },
  { to: "/influencers", label: "Influencers", icon: Gift, roles: ['admin'], section: 'analytics' },
  { to: "/facturas", label: "Facturas", icon: FileText, roles: ['admin'], section: 'analytics' },
  { to: "/liquidaciones", label: "Liquidaciones", icon: Receipt, roles: ['admin'], section: 'analytics' },
  { to: "/canjes", label: "Canjes", icon: Gift, roles: ['admin'], section: 'analytics' },
  { to: "/combos-banners", label: "Combos & Banners", icon: Sparkles, roles: ['admin'], section: 'analytics' },
  { to: "/catalogo", label: "Catálogo", icon: BookOpen, roles: ['admin'], section: 'analytics' },
  { to: "/ia", label: "IA Insights", icon: Brain, roles: ['admin'], section: 'analytics' },
  { to: "/chat-ia", label: "Chat IA", icon: Sparkles, roles: ['admin'], section: 'analytics' },
  { to: "/marca-ia", label: "Marcas IA", icon: Brain, roles: ['admin'], section: 'analytics' },
  { to: "/integraciones", label: "Integraciones", icon: Plug, roles: ['admin'], section: 'config' },
  { to: "/equipo", label: "Equipo", icon: Users, roles: ['admin'], section: 'config' },
  { to: "/ajustes", label: "Ajustes", icon: Settings, roles: ['admin'], section: 'config' },
  { to: "/perfil", label: "Mi Perfil", icon: UserCircle, roles: ['admin', 'vendedor'], section: 'config' },
  { to: "/admin", label: "Admin", icon: Crown, roles: ['admin'], section: 'config' },
];

const SECTION_LABELS: Record<string, string> = {
  principal: '',
  inventario: 'Inventario',
  ventas: 'Ventas',
  finanzas: 'Finanzas',
  analytics: 'Analytics',
  config: 'Sistema',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const { role } = useUserRole();
  const { isPlatformAdmin } = useOrg();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const config = useBusinessConfig();
  const { subscription, isTrialing, trialDaysLeft } = useEntitlements();

  const navItems = useMemo(() => {
    return allNavItems.filter(item => item.roles.includes(role));
  }, [role]);

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
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 gradient-sidebar border-r border-sidebar-border flex flex-col shrink-0
        transform transition-all duration-300 ease-out h-screen
        ${collapsed ? 'w-[68px]' : 'w-[260px]'}
        ${mobileOpen ? 'translate-x-0 w-[260px]' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo Header */}
        <div className={`${collapsed ? 'px-3 py-4' : 'px-5 py-5'} border-b border-sidebar-border flex items-center justify-between`}>
          <div className="flex items-center gap-3 min-w-0">
            {config.logoUrl ? (
              <div className="relative shrink-0">
                <img src={config.logoUrl} alt="Logo" className="w-9 h-9 rounded-xl object-cover ring-2 ring-primary/20" />
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-sidebar" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl gradient-gold flex items-center justify-center shrink-0 shadow-gold">
                <span className="text-primary-foreground font-bold text-sm">E</span>
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0 animate-fade-in">
                <h1 className="text-lg font-bold text-primary tracking-wide truncate font-mono text-center border-0 border-none">{config.businessName}</h1>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium border mt-0.5 ${roleBadgeClass}`}>
                  {roleLabel}
                </span>
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" className="lg:hidden shrink-0 text-sidebar-foreground" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto scrollbar-hide">
          {groupedNav.map((group, gi) => (
            <div key={group.section}>
              {group.label && !collapsed && (
                <div className={`px-3 ${gi > 0 ? 'pt-4 mt-1' : 'pt-1'} pb-1.5`}>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">{group.label}</span>
                </div>
              )}
              {gi > 0 && collapsed && <div className="my-2 mx-2 border-t border-sidebar-border/50" />}
              {group.items.map(({ to, label, icon: Icon }) => {
                const active = pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? label : undefined}
                    className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                      collapsed ? 'justify-center px-2' : ''
                    } ${
                      active 
                        ? "bg-primary/10 text-primary" 
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    {/* Active indicator bar */}
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary shadow-gold" />
                    )}
                    <div className={`shrink-0 ${active ? '' : 'group-hover:scale-110 transition-transform duration-200'}`}>
                      <Icon className="w-[18px] h-[18px]" />
                    </div>
                    {!collapsed && <span>{label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="hidden lg:block px-2 py-1.5 border-t border-sidebar-border/50">
          <Button variant="ghost" size="sm" className="w-full justify-center text-muted-foreground/60 hover:text-muted-foreground h-8" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Footer */}
        <div className={`${collapsed ? 'px-2 py-3' : 'px-4 py-4'} border-t border-sidebar-border space-y-2`}>
          <OrgSwitcher collapsed={collapsed} />
          <NotificationBell collapsed={collapsed} />
          {isPlatformAdmin && (
            <Link
              to="/platform/admin"
              title={collapsed ? 'Platform Admin' : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors w-full ${
                collapsed ? 'justify-center' : ''
              } ${
                pathname === '/platform/admin'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground/60 hover:bg-sidebar-accent hover:text-primary'
              }`}
            >
              <Crown className="w-3.5 h-3.5 shrink-0" />
              {!collapsed && <span>Platform Admin</span>}
            </Link>
          )}
          {!collapsed && (
            <div className="px-1 pt-1">
              <p className="text-[11px] text-muted-foreground/70 truncate">{user?.email}</p>
              <p className="text-[10px] text-muted-foreground/40 mt-0.5">{config.businessName} · v8.5</p>
            </div>
          )}
          <Button
            variant="ghost" size="sm"
            className={`w-full ${collapsed ? 'justify-center' : 'justify-start'} text-muted-foreground/60 hover:text-destructive h-8`}
            onClick={handleLogout}
            title={collapsed ? 'Cerrar sesión' : undefined}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span className="ml-2 text-[13px]">Cerrar sesión</span>}
          </Button>
        </div>
      </aside>

      <main className={`flex-1 overflow-auto w-full transition-all duration-300 ${collapsed ? 'lg:ml-[68px]' : 'lg:ml-[260px]'}`}>
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 glass border-b border-border/50 px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)} className="h-8 w-8 p-0">
            <Menu className="w-5 h-5" />
          </Button>
          {config.logoUrl ? (
            <img src={config.logoUrl} alt="Logo" className="w-6 h-6 rounded-lg object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-lg gradient-gold flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-[10px]">E</span>
            </div>
          )}
          <span className="font-display font-bold text-primary truncate flex-1 text-sm">{config.businessName}</span>
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <Search className="w-4 h-4 text-muted-foreground" />
          </button>
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

        <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
