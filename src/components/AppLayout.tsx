import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, ShoppingCart, DollarSign, AlertCircle, Settings, TrendingUp, Menu, X, Megaphone, Brain, LogOut, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
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
  { to: "/ia", label: "IA Insights", icon: Brain },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await signOut();
    toast.success("Sesión cerrada");
  };

  return (
    <div className="flex min-h-screen">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0
        transform transition-transform duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 border-b border-sidebar-border flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold text-primary tracking-wide">✦ Exentry Imports</h1>
            <p className="text-xs text-sidebar-foreground mt-1">Sistema de Gestión v3.0</p>
          </div>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active ? "bg-sidebar-accent text-primary shadow-gold" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border space-y-2">
          <div className="text-xs text-muted-foreground truncate px-1">{user?.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground hover:text-destructive" onClick={handleLogout}>
            <LogOut className="w-3.5 h-3.5 mr-2" />Cerrar sesión
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto w-full">
        <div className="lg:hidden sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <span className="font-display font-bold text-primary">✦ Exentry</span>
        </div>
        <div className="p-4 md:p-8 max-w-7xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
