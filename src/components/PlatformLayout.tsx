import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Crown, Building2, Users, DollarSign, Headphones, Server,
  Percent, ArrowLeft, LogOut, TrendingUp,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { usePlatformAccess } from '@/lib/usePermissions';

/**
 * Chrome de la superficie de PLATAFORMA — deliberadamente distinta del panel
 * de organización (acento violeta en vez de dorado, nav horizontal en vez de
 * sidebar). El objetivo es que sea imposible confundir "estoy operando MI
 * negocio" con "estoy operando la plataforma de todos los negocios".
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Crown;
  /** Roles de plataforma que pueden ver la sección; vacío = todos los staff */
  roles?: Array<'support' | 'finance'>;
}

const NAV: NavItem[] = [
  { to: '/platform', label: 'Resumen', icon: Crown },
  { to: '/platform/orgs', label: 'Organizaciones', icon: Building2 },
  { to: '/platform/usuarios', label: 'Usuarios', icon: Users },
  { to: '/platform/planes', label: 'Planes', icon: DollarSign, roles: ['finance'] },
  { to: '/platform/negocio', label: 'Negocio', icon: TrendingUp, roles: ['finance'] },
  { to: '/platform/comisiones', label: 'Comisiones', icon: Percent, roles: ['finance'] },
  { to: '/platform/soporte', label: 'Soporte', icon: Headphones, roles: ['support'] },
  { to: '/platform/sistema', label: 'Sistema', icon: Server },
];

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin',
  support: 'Soporte',
  finance: 'Finanzas',
};

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { memberships } = useOrg();
  const { platformRole, canPlatform } = usePlatformAccess();

  const visible = NAV.filter(item => !item.roles || canPlatform(...item.roles));

  return (
    <div className="platform-surface workspace-platform min-h-screen bg-background">
      {/* ── Barra de identidad de plataforma ──────────────────────────── */}
      <header
        className="workspace-platform-topbar sticky top-0 z-40 border-b border-violet-500/25 topbar-surface"
      >
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-[6px] bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
              <Crown className="w-3.5 h-3.5 text-violet-300" />
            </div>
            <div className="min-w-0">
              <span className="block font-display font-semibold text-[13px] tracking-tight text-violet-100 truncate">
                Plataforma Gestiona
              </span>
              <span className="hidden sm:block text-[9px] uppercase tracking-[0.14em] text-violet-300/50">Control operativo</span>
            </div>
            {platformRole && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded-[4px] bg-violet-500/15 text-violet-300 border border-violet-500/25 shrink-0">
                {ROLE_LABEL[platformRole] || platformRole}
              </span>
            )}
          </div>

          <div className="flex-1" />

          {/* Volver al tenant — solo si el staff tiene una org propia */}
          {memberships.length > 0 && (
            <Link
              to="/"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[11px] font-medium text-violet-200/70 hover:text-violet-100 hover:bg-violet-500/10 transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Volver a mi negocio
            </Link>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[11px] text-violet-200/50 hover:text-destructive hover:bg-destructive/10 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>

        {/* ── Nav de secciones ────────────────────────────────────────── */}
      </header>

      <div className="platform-workspace-shell">
        <nav className="platform-sidebar" aria-label="Secciones de plataforma">
          <p className="platform-sidebar__label">Control de plataforma</p>
          {visible.map(({ to, label, icon: Icon }) => {
            const active = to === '/platform' ? pathname === '/platform' : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`platform-sidebar__link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <main className="workspace-platform-main">{children}</main>
      </div>

      <footer className="px-6 py-4 border-t border-border/30 mt-8">
        <p className="text-[10px] text-muted-foreground/40 font-mono">
          {user?.email} · superficie de plataforma · las acciones quedan auditadas en admin_audit_logs
        </p>
      </footer>
    </div>
  );
}
