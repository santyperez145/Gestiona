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
    <div className="finance-shell min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="finance-sidebar border-b border-border/70 bg-card text-foreground shadow-[0_12px_30px_-26px_hsl(var(--foreground)/0.35)] lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between border-b border-border/70 px-4 lg:px-5">
          <Link to="/finance" className="flex items-center gap-2.5">
            <BrandLogo compact decorative eager markClassName="h-8 w-8" />
            <span>
              <span className="block text-sm font-semibold tracking-tight">Nerqia Finance</span>
              <span className="block text-[9px] uppercase tracking-[0.18em] text-teal-700/70 dark:text-teal-300/70">Control documental</span>
            </span>
          </Link>
          <div className="lg:hidden"><ThemeToggle /></div>
        </div>

        <div className="finance-nav flex items-center gap-2 overflow-x-auto p-3 lg:block lg:space-y-1 lg:p-4">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-[7px] border px-3 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-teal-500/25 bg-teal-500/10 text-teal-800 dark:text-teal-200'
                  : 'border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              <item.icon className="h-3.5 w-3.5" /> {item.label}
            </NavLink>
          ))}
          <p className="mt-3 hidden px-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80 lg:block">
            En el Core
          </p>
          {CORE_BRIDGES.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className="flex shrink-0 items-center gap-2 rounded-[7px] border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <item.icon className="h-3.5 w-3.5" /> {item.label}
            </Link>
          ))}
        </div>

        <div className="hidden lg:absolute lg:inset-x-0 lg:bottom-0 lg:block lg:border-t lg:border-border/70 lg:p-4">
          <div className="mb-3 rounded-[8px] border border-border/70 bg-muted/35 p-2">
            <OrgSwitcher />
          </div>
          <Link to="/" className="mb-1 flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Nerqia Business
          </Link>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300">
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
          <p className="mt-2 truncate px-2.5 font-mono text-[9px] text-muted-foreground/65">{user?.email}</p>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="finance-topbar sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-border/70 bg-background/90 px-6 backdrop-blur lg:flex">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-teal-600 dark:text-teal-300">Finance</p>
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
