import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, FileStack, LayoutDashboard, LogOut, Landmark, ShoppingCart, Wallet, BookOpen } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import OrgSwitcher from '@/components/shared/OrgSwitcher';
import ThemeToggle from '@/components/shared/ThemeToggle';
import BrandLogo from '@/components/shared/BrandLogo';

const NAV = [
  { to: '/finance', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/finance/documentos', label: 'Documentos', icon: FileStack, end: false },
];

/** Puentes al Core: no son páginas de Finance; evitan clonar Mendel en dos lados. */
const CORE_BRIDGES = [
  { to: '/gastos', label: 'Gastos', icon: Wallet },
  { to: '/ordenes-compra', label: 'Compras', icon: ShoppingCart },
  { to: '/libro', label: 'Libro', icon: BookOpen },
  { to: '/banco', label: 'Banco', icon: Landmark },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();
  const { activeOrg } = useOrg();
  const navigate = useNavigate();

  const logout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="finance-shell min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="finance-sidebar border-b border-border lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <Link to="/finance" className="flex min-w-0 items-center gap-2.5">
            <BrandLogo compact decorative eager markClassName="h-8 w-8" />
            <span className="min-w-0">
              <span className="block text-[14px] font-display font-bold tracking-tight">Nerqia Finance</span>
              <span className="block text-[9px] uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Margen y documentos</span>
            </span>
          </Link>
          <div className="lg:hidden"><ThemeToggle /></div>
        </div>

        <div className="finance-nav flex items-center gap-1 overflow-x-auto p-3 lg:block lg:space-y-0.5 lg:p-3">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `finance-nav-link flex shrink-0 items-center gap-2 px-2.5 py-2 text-[13px] font-medium ${
                isActive ? 'is-active' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <item.icon className="h-3.5 w-3.5" /> {item.label}
            </NavLink>
          ))}
          <p className="mt-4 hidden px-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 lg:block">
            En el Core
          </p>
          {CORE_BRIDGES.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className="flex shrink-0 items-center gap-2 px-2.5 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <item.icon className="h-3.5 w-3.5" /> {item.label}
            </Link>
          ))}
        </div>

        <div className="hidden lg:absolute lg:inset-x-0 lg:bottom-0 lg:block lg:border-t lg:border-border lg:p-3">
          <div className="mb-2 border border-border bg-muted/25 p-1.5">
            <OrgSwitcher />
          </div>
          <Link to="/" className="mb-0.5 flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Nerqia Business
          </Link>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground hover:bg-destructive/8 hover:text-destructive">
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
          <p className="mt-1 truncate px-2.5 font-mono text-[9px] text-muted-foreground/60">{user?.email}</p>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="finance-topbar sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-border bg-background/94 px-6 backdrop-blur lg:flex">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Finance</p>
            <p className="text-xs text-muted-foreground">{activeOrg?.name || 'Sin organización'}</p>
          </div>
          <div className="flex items-center gap-2"><ThemeToggle /></div>
        </header>
        <div className="finance-content mx-auto max-w-[1220px] p-4 sm:p-6 lg:p-8">
          <div className="workspace-page workspace-route-surface">{children}</div>
        </div>
      </main>
    </div>
  );
}
