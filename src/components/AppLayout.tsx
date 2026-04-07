import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings, TrendingUp, Menu, X, Megaphone, Brain, LogOut, Users, Crown, ChevronsLeft, ChevronsRight, Search, Gift } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/productos", label: "Productos", icon: Package },
  { to: "/compras", label: "Compras", icon: ShoppingCart },
  { to: "/ventas", label: "Ventas", icon: DollarSign },
  { to: "/deudas", label: "Deudas", icon: AlertCircle },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/reportes", label: "Reportes", icon: TrendingUp },
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/canjes", label: "Canjes", icon: Gift },
  { to: "/ia", label: "IA Insights", icon: Brain },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const config = useBusinessConfig();

  useEffect(() => {
    if (!user) return;
    supabase.from('user_roles').select('role').eq('user_id', user.id)
      .then(({ data }) => setIsAdmin(data?.some(r => r.role === 'admin') || false));
  }, [user]);

  const handleLogout = async () => {
    await signOut();
    toast.success("Sesión cerrada");
  };

  const allNavItems = [...navItems, ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: Crown }] : [])];

  return (
    <div className="flex min-h-screen">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0
        transform transition-all duration-200
        ${collapsed ? 'w-16' : 'w-64'}
        ${mobileOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className={`p-4 ${collapsed ? 'px-2' : 'p-6'} border-b border-sidebar-border flex items-center justify-between`}>
          <div className="flex items-center gap-3 min-w-0">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt="Logo" className="w-8 h-8 rounded-lg object-cover shrink-0" />
            ) : (
              <span className="text-lg">✦</span>
            )}
            {!collapsed && (
              <div className="min-w-0">
                <h1 className="font-display text-lg font-bold text-primary tracking-wide truncate">{config.businessName}</h1>
                <p className="text-xs text-sidebar-foreground mt-0.5">Sistema de Gestión v6.0</p>
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" className="lg:hidden shrink-0" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {allNavItems.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  collapsed ? 'justify-center px-2' : ''
                } ${
                  active ? "bg-sidebar-accent text-primary shadow-gold" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle - desktop only */}
        <div className="hidden lg:block px-2 py-1 border-t border-sidebar-border">
          <Button variant="ghost" size="sm" className="w-full justify-center text-muted-foreground" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </Button>
        </div>

        <div className={`p-4 ${collapsed ? 'px-2' : ''} border-t border-sidebar-border space-y-2`}>
          {!collapsed && (
            <>
              <div className="text-xs text-muted-foreground truncate px-1">{user?.email}</div>
              <div className="text-[10px] text-muted-foreground/50 px-1">{config.businessName} · v7.0</div>
            </>
          )}
          <Button
            variant="ghost" size="sm"
            className={`w-full ${collapsed ? 'justify-center' : 'justify-start'} text-muted-foreground hover:text-destructive`}
            onClick={handleLogout}
            title={collapsed ? 'Cerrar sesión' : undefined}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span className="ml-2">Cerrar sesión</span>}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto w-full">
        <div className="lg:hidden sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          {config.logoUrl ? (
            <img src={config.logoUrl} alt="Logo" className="w-6 h-6 rounded object-cover" />
          ) : (
            <span className="text-sm">✦</span>
          )}
          <span className="font-display font-bold text-primary truncate flex-1">{config.businessName}</span>
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
          >
            <Search className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="p-4 md:p-8 max-w-7xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
