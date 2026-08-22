import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Crown, Building2, Users, DollarSign, Headphones, Server, Megaphone,
  Percent, ArrowLeft, LogOut, TrendingUp, BarChart3, FileText, Cable,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { usePlatformAccess } from '@/lib/usePermissions';

/**
 * Chrome de la superficie de PLATAFORMA — deliberadamente distinta del panel
 * de organización (acento violeta en vez de dorado, rail de control propio).
 * El objetivo es que sea imposible confundir "estoy operando MI
 * negocio" con "estoy operando la plataforma de todos los negocios".
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Crown;
  group: 'workspace' | 'operations' | 'monetization' | 'governance';
  /** Roles de plataforma que pueden ver la sección; vacío = todos los staff */
  roles?: Array<'superadmin' | 'support' | 'finance'>;
}

const NAV: NavItem[] = [
  { to: '/platform', label: 'Resumen', icon: Crown, group: 'workspace' },
  { to: '/platform/orgs', label: 'Organizaciones', icon: Building2, group: 'workspace' },
  { to: '/platform/usuarios', label: 'Usuarios', icon: Users, group: 'workspace' },
  { to: '/platform/metricas', label: 'Métricas', icon: BarChart3, group: 'operations' },
  { to: '/platform/integraciones', label: 'Integraciones', icon: Cable, group: 'operations' },
  { to: '/platform/operaciones', label: 'Operaciones', icon: ShieldCheck, group: 'operations' },
  { to: '/platform/sistema', label: 'Sistema', icon: Server, group: 'operations' },
  { to: '/platform/planes', label: 'Planes', icon: DollarSign, group: 'monetization', roles: ['finance'] },
  { to: '/platform/negocio', label: 'Negocio', icon: TrendingUp, group: 'monetization', roles: ['finance'] },
  { to: '/platform/comisiones', label: 'Comisiones', icon: Percent, group: 'monetization', roles: ['finance'] },
  { to: '/platform/afip', label: 'AFIP', icon: FileText, group: 'governance', roles: ['superadmin'] },
  { to: '/platform/soporte', label: 'Soporte', icon: Headphones, group: 'governance', roles: ['support'] },
  { to: '/platform/anuncios', label: 'Anuncios', icon: Megaphone, group: 'governance', roles: ['superadmin'] },
];

const NAV_GROUPS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'operations', label: 'Operaciones' },
  { id: 'monetization', label: 'Ingresos' },
  { id: 'governance', label: 'Gobierno' },
] as const;

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
  const grouped = NAV_GROUPS
    .map(group => ({ ...group, items: visible.filter(item => item.group === group.id) }))
    .filter(group => group.items.length > 0);

  return (
    <div className="platform-surface workspace-platform min-h-screen bg-background">
      {/* ── Barra de identidad de plataforma ──────────────────────────── */}
      <header
        className="workspace-platform-topbar workspace-platform__topbar sticky top-0 z-40 border-b border-violet-500/25 topbar-surface"
      >
        <div className="platform-topbar-inner px-4 sm:px-6 h-14 flex items-center gap-3">
          <div className="platform-topbar__identity flex items-center gap-2 min-w-0">
            <div className="platform-brand-mark w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0">
              <Crown className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <span className="platform-brand-title block font-display font-semibold text-[13px] tracking-tight truncate">
                Plataforma Gestiona
              </span>
              <span className="platform-brand-subtitle hidden sm:block text-[9px] uppercase tracking-[0.14em]">Control operativo</span>
            </div>
            {platformRole && (
              <span className="platform-role-badge text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded-[4px] shrink-0">
                {ROLE_LABEL[platformRole] || platformRole}
              </span>
            )}
          </div>

          <div className="platform-topbar__context hidden lg:flex items-center gap-2 min-w-0">
            <span className="platform-topbar__context-dot" aria-hidden="true" />
            <span className="platform-topbar__context-label">Consola central</span>
            <span className="platform-topbar__context-detail truncate">Organizaciones, ingresos y gobierno</span>
          </div>

          <div className="flex-1" />

          {/* Volver al tenant — solo si el staff tiene una org propia */}
          <div className="platform-topbar__actions flex items-center gap-2">
            {memberships.length > 0 && (
            <Link
              to="/"
              className="platform-topbar-action flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[11px] font-medium transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Volver a mi negocio
            </Link>
            )}
            <button
              onClick={() => supabase.auth.signOut()}
              className="platform-topbar-action flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[11px] transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>

        {/* ── Nav de secciones ────────────────────────────────────────── */}
      </header>

      <div className="platform-workspace-shell workspace-platform__body">
        <nav className="platform-sidebar workspace-platform__rail" aria-label="Secciones de plataforma">
          <p className="platform-sidebar__label">Control de plataforma</p>
          {grouped.map(group => (
            <div key={group.id} className="platform-sidebar__group">
              <p className="platform-sidebar__group-label">{group.label}</p>
              {group.items.map(({ to, label, icon: Icon }) => {
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
            </div>
          ))}
        </nav>

        <main className="workspace-platform-main workspace-platform__main">
          <div className="workspace-page workspace-route-surface">{children}</div>
        </main>
      </div>

      <footer className="workspace-platform__footer px-6 py-4 border-t border-border/30 mt-8">
        <p className="text-[10px] text-muted-foreground/40 font-mono">
          {user?.email} · superficie de plataforma · las acciones quedan auditadas en admin_audit_logs
        </p>
      </footer>
    </div>
  );
}
