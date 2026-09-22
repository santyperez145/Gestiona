import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, LogOut, Users, Sparkles, Target, Gift, BarChart3, TrendingUp } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { influencerMarketingProductRoutes } from '@/app/routeManifest';
import OrgSwitcher from '@/components/shared/OrgSwitcher';
import ThemeToggle from '@/components/shared/ThemeToggle';
import BrandLogo from '@/components/shared/BrandLogo';
import { usePermissionsResolver } from '@/lib/permissionsContext';

const NAV = influencerMarketingProductRoutes().flatMap(route => route.nav ? [{
  to: route.path,
  label: route.nav.label,
  icon: route.nav.icon,
  end: route.path === '/influencer-marketing',
  module: route.module,
}] : []).sort((a, b) => Number(b.end) - Number(a.end));

const CORE_BRIDGES = [
  { to: '/marketing', label: 'Marketing de tienda', icon: Sparkles, module: 'marketing' },
  { to: '/productos', label: 'Catálogo', icon: Gift, module: 'products' },
];

export default function InfluencerMarketingLayout({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();
  const { activeOrg } = useOrg();
  const navigate = useNavigate();
  const { forModule } = usePermissionsResolver();

  const logout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="influencer-shell min-h-screen bg-card text-foreground lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="influencer-sidebar flex flex-col border-b border-border lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <Link to="/influencer-marketing" className="flex min-w-0 items-center gap-2.5">
            <BrandLogo compact decorative eager markClassName="h-8 w-8" />
            <span className="min-w-0">
              <span className="block text-[14px] font-display font-bold">Nerqia Influencers</span>
              <span className="block text-[9px] uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Marketing de creadores</span>
            </span>
          </Link>
          <div className="lg:hidden"><ThemeToggle /></div>
        </div>

        <nav aria-label="Influencers" className="influencer-nav flex items-center gap-1 overflow-x-auto p-3 lg:block lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:space-y-0.5 lg:p-3">
          {NAV.filter(item => forModule(item.module ?? '').canView).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `influencer-nav-link flex shrink-0 items-center gap-2 px-2.5 py-2 text-[13px] font-medium ${
                isActive ? 'rounded-md bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <item.icon className="h-3.5 w-3.5" /> {item.label}
            </NavLink>
          ))}
          <p className="mt-4 hidden px-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 lg:block">En el Core</p>
          {CORE_BRIDGES.filter(item => forModule(item.module).canView).map(item => (
            <Link
              key={item.to}
              to={item.to}
              className="flex shrink-0 items-center gap-2 px-2.5 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <item.icon className="h-3.5 w-3.5" /> {item.label}
            </Link>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <div className="mb-2 border border-border bg-muted/25 p-1.5"><OrgSwitcher /></div>
          <Link to="/" className="mb-0.5 flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Nerqia Business
          </Link>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground hover:bg-destructive/8 hover:text-destructive">
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
          <p className="mt-1 truncate px-2.5 font-mono text-[9px] text-muted-foreground/60">{user?.email}</p>
        </div>
      </aside>

      <main className="min-w-0 bg-background">
        <header className="influencer-topbar sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-border bg-background/94 px-6 backdrop-blur lg:flex">
          <div>
            <p className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">Marketing de creadores</p>
            <p className="text-xs text-muted-foreground">{activeOrg?.name || 'Sin organización'}</p>
          </div>
          <div className="flex items-center gap-2"><ThemeToggle /></div>
        </header>
        <div className="influencer-content mx-auto max-w-[1220px] p-4 sm:p-6 lg:p-8">
          <div className="workspace-page workspace-route-surface">{children}</div>
        </div>
      </main>
    </div>
  );
}
