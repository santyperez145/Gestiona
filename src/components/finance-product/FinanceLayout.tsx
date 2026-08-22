import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, FileStack, LayoutDashboard, LogOut, ReceiptText } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import OrgSwitcher from '@/components/shared/OrgSwitcher';
import ThemeToggle from '@/components/shared/ThemeToggle';

const NAV = [
  { to: '/finance', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/finance/documentos', label: 'Documentos', icon: FileStack, end: false },
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
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="border-b border-teal-500/15 bg-slate-950 text-slate-100 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4 lg:px-5">
          <Link to="/finance" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-teal-400/25 bg-teal-400/10 text-teal-300">
              <ReceiptText className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">Gestiona Finance</span>
              <span className="block text-[9px] uppercase tracking-[0.18em] text-teal-300/70">Control documental</span>
            </span>
          </Link>
          <div className="lg:hidden"><ThemeToggle /></div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto p-3 lg:block lg:space-y-1 lg:p-4">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-[7px] border px-3 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-teal-400/25 bg-teal-400/10 text-teal-200'
                  : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`}
            >
              <item.icon className="h-3.5 w-3.5" /> {item.label}
            </NavLink>
          ))}
        </div>

        <div className="hidden lg:absolute lg:inset-x-0 lg:bottom-0 lg:block lg:border-t lg:border-white/10 lg:p-4">
          <div className="mb-3 rounded-[8px] border border-white/10 bg-white/[0.03] p-2">
            <OrgSwitcher />
          </div>
          <Link to="/" className="mb-1 flex items-center gap-2 rounded-[7px] px-2.5 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-100">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Gestiona Business
          </Link>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-xs text-slate-500 hover:bg-red-500/10 hover:text-red-300">
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
          <p className="mt-2 truncate px-2.5 font-mono text-[9px] text-slate-600">{user?.email}</p>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-border/70 bg-background/90 px-6 backdrop-blur lg:flex">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-teal-600 dark:text-teal-300">Finance</p>
            <p className="text-xs text-muted-foreground">{activeOrg?.name || 'Sin organización'}</p>
          </div>
          <div className="flex items-center gap-2"><ThemeToggle /></div>
        </header>
        <div className="mx-auto max-w-[1220px] p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
