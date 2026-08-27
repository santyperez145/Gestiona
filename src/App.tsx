import { lazy, Suspense, useState, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { OrgProvider, useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import AppLayout from "@/components/AppLayout";
import MfaGate from "@/components/auth/MfaGate";
import ModuleGuard from "@/components/auth/ModuleGuard";
import PlatformLayout from "@/components/PlatformLayout";
import FinanceLayout from "@/components/finance-product/FinanceLayout";
import FinanceProductGate from "@/components/finance-product/FinanceProductGate";
import { PermissionsProvider } from "@/lib/permissionsContext";
import {
  businessRoutes, businessAliases, publicPages, publicAliases,
} from "@/app/routeManifest";
import { supabase } from "@/integrations/supabase/client";
import {
  forceStaleBuildRecovery,
  isStaleBuildError,
  recoverFromStaleBuild,
} from "@/lib/staleBuildRecovery";
import { ShieldAlert, BookOpen } from "lucide-react";

// ── Eager (needed for first paint / public routes) ──────────────────────────
import AuthPage from "@/pages/AuthPage";
import LandingPage from "@/pages/LandingPage";

// ── Lazy-loaded pages (split per route) ────────────────────────────────────
const PublicCatalogPage      = lazy(() => import("@/pages/PublicCatalogPage"));
const StorefrontPage         = lazy(() => import("@/pages/StorefrontPage"));
const PublicPaymentPage      = lazy(() => import("@/pages/PublicPaymentPage"));
const InfluencerPortalPage   = lazy(() => import("@/pages/InfluencerPortalPage"));
const InvitationAcceptPage   = lazy(() => import("@/pages/InvitationAcceptPage"));
const PlatformAdminPage      = lazy(() => import("@/pages/PlatformAdminPage"));
const PlatformMerchantPage  = lazy(() => import("@/pages/PlatformMerchantPage"));
const PlatformMetricsPage   = lazy(() => import("@/pages/PlatformMetricsPage"));
const PlatformIntegrationsPage = lazy(() => import("@/pages/PlatformIntegrationsPage"));
const PlatformOperationsPage = lazy(() => import("@/pages/PlatformOperationsPage"));
const PlatformCommissionsPage = lazy(() => import("@/pages/PlatformCommissionsPage"));
const PlatformBusinessPage = lazy(() => import("@/pages/PlatformBusinessPage"));
const PlatformAfipPage = lazy(() => import("@/pages/PlatformAfipPage"));
const PlatformAnnouncementsPage = lazy(() => import("@/pages/PlatformAnnouncementsPage"));
const PlatformMessagingPage = lazy(() => import("@/pages/PlatformMessagingPage"));
const FinanceOverviewPage     = lazy(() => import("@/pages/FinanceOverviewPage"));
const FinanceDocumentsPage    = lazy(() => import("@/pages/FinanceDocumentsPage"));
const NotFound                 = lazy(() => import("@/pages/NotFound"));

const CommandPalette         = lazy(() => import("@/components/shared/CommandPalette"));

// ── Page-level loading fallback ─────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-muted-foreground text-xs">Cargando...</p>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 1000 * 60 * 2, // 2 min before considering data stale
      retry: 1,
    },
  },
});

function ViewerGate() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(40, 72%, 52%, 0.06) 0%, hsl(225, 22%, 6%) 50%), hsl(225, 22%, 6%)' }}
    >
      <div className="text-center max-w-md animate-fade-in-up">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-muted border border-border mb-6">
          <ShieldAlert className="w-9 h-9 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-display font-bold mb-3">Esperando aprobación</h1>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Tu cuenta fue registrada pero aún no tenés acceso al sistema. Contactá al administrador para que te asigne un rol.
        </p>
        <a
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl gradient-gold text-primary-foreground font-semibold text-sm shadow-gold hover:shadow-lg transition-shadow"
        >
          <BookOpen className="w-4 h-4" /> Ver catálogo público
        </a>
      </div>
    </div>
  );
}

function AppLoader({ label = 'Cargando Gestiona...' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">{label}</p>
      </div>
    </div>
  );
}

/**
 * Superficie de PLATAFORMA — separada del tenant a propósito.
 *
 * Vive fuera de `ProtectedRoutes`: no pasa por el gate de onboarding, no usa el
 * sidebar de la organización y no depende de tener una org activa. El acceso lo
 * gobierna `platform_admins`, nada más. El enforcement real está en la Edge
 * Function `platform-admin-action` y en RLS — esto sólo decide qué se dibuja.
 */
function PlatformRoutes() {
  const { user, loading: authLoading } = useAuth();
  const { platformRole, loading: orgLoading } = useOrg();

  if (authLoading || orgLoading) return <AppLoader label="Verificando acceso de plataforma..." />;
  if (!user) return <AuthPage />;
  if (!platformRole) return <Navigate to="/" replace />;

  return (
    // 2FA sin excepciones para el staff de plataforma: desde acá se leen todos
    // los tenants y se borran organizaciones. Es la cuenta más valiosa del
    // sistema para un atacante, así que no depende de la config de ninguna org.
    <MfaGate isAdmin orgRequiresMfa>
    <PlatformLayout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<PlatformAdminPage section="overview" />} />
          <Route path="orgs/:orgId" element={<PlatformMerchantPage />} />
          <Route path="orgs" element={<PlatformAdminPage section="orgs" />} />
          <Route path="usuarios" element={<PlatformAdminPage section="users" />} />
          <Route path="metricas" element={<PlatformMetricsPage />} />
          <Route path="integraciones" element={<PlatformIntegrationsPage />} />
          <Route path="operaciones" element={<PlatformOperationsPage />} />
          <Route path="planes" element={<PlatformAdminPage section="plans" />} />
          <Route path="negocio" element={<PlatformBusinessPage />} />
          <Route path="comisiones" element={<PlatformCommissionsPage />} />
          <Route path="afip" element={<PlatformAfipPage />} />
          <Route path="soporte" element={<PlatformAdminPage section="support" />} />
          <Route path="anuncios" element={<PlatformAnnouncementsPage />} />
          <Route path="sistema" element={<PlatformAdminPage section="system" />} />
          <Route path="mensajeria" element={<PlatformMessagingPage />} />
          {/* Ruta vieja */}
          <Route path="admin" element={<Navigate to="/platform" replace />} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Routes>
      </Suspense>
    </PlatformLayout>
    </MfaGate>
  );
}

/**
 * Superficie de PRODUCTO Finance.
 *
 * Comparte la sesión y la organización con Business, pero no su onboarding ni
 * su chrome. El RPC `product_surface_access` vuelve a exigir membresía,
 * entitlement `finance` y permiso `finance.view`; este gate sólo representa el
 * resultado y nunca es la autoridad.
 */
function FinanceRoutes() {
  const { user, loading: authLoading } = useAuth();
  const { activeOrg, activeRole, platformRole, loading: orgLoading } = useOrg();
  const [orgRequiresMfa, setOrgRequiresMfa] = useState(false);
  const [mfaPolicyLoading, setMfaPolicyLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg?.id) { setOrgRequiresMfa(false); setMfaPolicyLoading(false); return; }
    setMfaPolicyLoading(true);
    supabase.from('settings').select('mfa_required').eq('org_id', activeOrg.id).maybeSingle()
      .then(
        ({ data }) => { setOrgRequiresMfa(Boolean(data?.mfa_required)); setMfaPolicyLoading(false); },
        () => { setOrgRequiresMfa(false); setMfaPolicyLoading(false); },
      );
  }, [activeOrg?.id]);

  if (authLoading || orgLoading || mfaPolicyLoading) return <AppLoader label="Verificando acceso a Finance..." />;
  if (!user) return <AuthPage />;
  if (!activeOrg || !activeRole) {
    return platformRole ? <Navigate to="/platform" replace /> : <ViewerGate />;
  }

  return (
    <MfaGate isAdmin={activeRole === 'owner' || activeRole === 'admin'} orgRequiresMfa={orgRequiresMfa}>
      <PermissionsProvider>
        <FinanceLayout>
          <FinanceProductGate>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route index element={<FinanceOverviewPage />} />
                <Route path="documentos" element={<FinanceDocumentsPage />} />
                <Route path="*" element={<Navigate to="/finance" replace />} />
              </Routes>
            </Suspense>
          </FinanceProductGate>
        </FinanceLayout>
      </PermissionsProvider>
    </MfaGate>
  );
}

function ProtectedRoutes() {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading, isAdmin, isVendedor, isViewer } = useUserRole();
  const { activeOrg, isPlatformAdmin } = useOrg();
  const { pathname } = useLocation();
  // Enforcement de 2FA por organización (settings.mfa_required).
  const [orgRequiresMfa, setOrgRequiresMfa] = useState(false);
  useEffect(() => {
    if (!activeOrg?.id) { setOrgRequiresMfa(false); return; }
    supabase.from('settings').select('mfa_required').eq('org_id', activeOrg.id).maybeSingle()
      .then(({ data }) => setOrgRequiresMfa(!!data?.mfa_required), () => {});
  }, [activeOrg?.id]);

  if (authLoading || roleLoading) return <AppLoader />;
  // Root path shows landing page for unauthenticated visitors
  if (!user && pathname === '/') return <LandingPage />;
  if (!user) return <AuthPage />;
  if (isViewer) {
    // El staff de plataforma ya no hereda rol de admin en el tenant. Si no tiene
    // membresía propia, su lugar es la superficie de plataforma, no el ViewerGate.
    if (isPlatformAdmin) return <Navigate to="/platform" replace />;
    return <ViewerGate />;
  }

  // Force onboarding for fresh orgs — check DB field first, localStorage as fallback
  const onboarded = activeOrg
    ? (activeOrg.onboarding_completed || localStorage.getItem(`gestiona.onboarded.${activeOrg.id}`))
    : '1';
  const onOnboardingRoute = window.location.pathname === '/onboarding';
  if (activeOrg && !onboarded && !onOnboardingRoute) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <MfaGate isAdmin={isAdmin} orgRequiresMfa={!!orgRequiresMfa}>
    <PermissionsProvider>
    <AppLayout>
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
      <Suspense fallback={<PageLoader />}>
        <ModuleGuard>
        {/* Las rutas salen del Route Manifest, no de una lista a mano.
            Antes el reparto admin/vendedor vivía acá Y en el manifest, y ya
            había divergido en 5 rutas: /tareas, /seguimiento, /calendario,
            /envios y /perfil figuraban en el menú de un vendedor y no se
            montaban, así que el clic lo rebotaba al dashboard. */}
        <Routes>
          {businessRoutes(role).map(r => (
            <Route key={r.id} path={r.path} element={<r.component />} />
          ))}

          {/* URLs viejas: siguen vivas en bookmarks y mails. El destino puede
              llevar query (`/admin?tab=audit`), así que se conserva entero. */}
          {businessAliases().map(([desde, hacia]) => (
            <Route key={desde} path={desde} element={<Navigate to={hacia} replace />} />
          ))}

          {/* Un vendedor que escribe una URL de admin vuelve al inicio en vez
              de ver un 404 que parece una falla del sistema. */}
          {isVendedor && (
            <Route path="*" element={<Navigate to="/" replace />} />
          )}

          <Route path="*" element={<NotFound />} />
        </Routes>
        </ModuleGuard>
      </Suspense>
    </AppLayout>
    </PermissionsProvider>
    </MfaGate>
  );
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="gestiona-theme">
  <Sentry.ErrorBoundary fallback={({ error }) => {
    if (isStaleBuildError(error)) {
      // Deploy nuevo: los chunks viejos ya no existen. Limpiamos caches + SW
      // y recargamos. La guardia temporal corta loops sin bloquear el deploy
      // siguiente durante toda la sesión.
      if (recoverFromStaleBuild()) return null;

      // Si el intento acaba de fallar, el botón permite una salida manual.
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8 text-center">
          <div>
            <h1 className="text-xl font-bold mb-2">Nueva versión disponible</h1>
            <p className="text-muted-foreground text-sm mb-4">La app se actualizó. Vamos a limpiar la versión anterior para continuar.</p>
            <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
              onClick={forceStaleBuildRecovery}>
              Actualizar ahora
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8 text-center">
        <div>
          <h1 className="text-xl font-bold mb-2">Algo salió mal</h1>
          <p className="text-muted-foreground text-sm mb-4">El error fue reportado automáticamente.</p>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      </div>
    );
  }}>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <OrgProvider>
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* `/login` no sale del manifest: AuthPage no es lazy —es la
                    primera pantalla y cargarla en dos pasos se ve peor. */}
                <Route path="/login" element={<AuthPage />} />
                {publicPages().map(r => (
                  <Route key={r.id} path={r.path} element={<r.component />} />
                ))}
                {publicAliases().map(([desde, hacia]) => (
                  <Route key={desde} path={desde} element={<Navigate to={hacia} replace />} />
                ))}

                {/* A mano: llevan parámetros, que el manifest todavía no modela. */}
                <Route path="/catalogo/:userId" element={<PublicCatalogPage />} />
                <Route path="/tienda/:slug/*" element={<StorefrontPage />} />
                <Route path="/pagar/:linkId" element={<PublicPaymentPage />} />
                <Route path="/portal-influencer/:token" element={<InfluencerPortalPage />} />
                <Route path="/invitacion/:token" element={<InvitationAcceptPage />} />
                <Route path="/platform/*" element={<PlatformRoutes />} />
                <Route path="/finance/*" element={<FinanceRoutes />} />
                <Route path="/app/*" element={<ProtectedRoutes />} />
                <Route path="/*" element={<ProtectedRoutes />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </OrgProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </Sentry.ErrorBoundary>
  </ThemeProvider>
);

export default App;
