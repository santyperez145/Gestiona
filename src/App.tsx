import { lazy, Suspense } from "react";
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { OrgProvider, useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import AppLayout from "@/components/AppLayout";
import { ShieldAlert, BookOpen } from "lucide-react";

// ── Eager (needed for first paint / public routes) ──────────────────────────
import AuthPage from "@/pages/AuthPage";
import LandingPage from "@/pages/LandingPage";

// ── Lazy-loaded pages (split per route) ────────────────────────────────────
const Dashboard              = lazy(() => import("@/pages/Dashboard"));
const ProductsPage           = lazy(() => import("@/pages/ProductsPage"));
const PurchasesPage          = lazy(() => import("@/pages/PurchasesPage"));
const SalesPage              = lazy(() => import("@/pages/SalesPage"));
const DebtsPage              = lazy(() => import("@/pages/DebtsPage"));
const ReportsPage            = lazy(() => import("@/pages/ReportsPage"));
const SettingsPage           = lazy(() => import("@/pages/SettingsPage"));
const MarketingPage          = lazy(() => import("@/pages/MarketingPage"));
const AIInsightsPage         = lazy(() => import("@/pages/AIInsightsPage"));
const AIChatPage             = lazy(() => import("@/pages/AIChatPage"));
const AutomationFlowsPage    = lazy(() => import("@/pages/AutomationFlowsPage"));
const LocationsPage          = lazy(() => import("@/pages/LocationsPage"));
const ReferralsPage          = lazy(() => import("@/pages/ReferralsPage"));
const MarketingTemplatesPage = lazy(() => import("@/pages/MarketingTemplatesPage"));
const ExpensesPage           = lazy(() => import("@/pages/ExpensesPage"));
const CustomersPage          = lazy(() => import("@/pages/CustomersPage"));
const InfluencerExchangesPage= lazy(() => import("@/pages/InfluencerExchangesPage"));
const InfluencersPage        = lazy(() => import("@/pages/InfluencersPage"));
const SettlementsPage        = lazy(() => import("@/pages/SettlementsPage"));
const BrandKnowledgePage     = lazy(() => import("@/pages/BrandKnowledgePage"));
const CombosBannersPage      = lazy(() => import("@/pages/CombosBannersPage"));
const CatalogPage            = lazy(() => import("@/pages/CatalogPage"));
const TiendanubeExportPage   = lazy(() => import("@/pages/TiendanubeExportPage"));
const AdminPage              = lazy(() => import("@/pages/AdminPage"));
const ResetPasswordPage      = lazy(() => import("@/pages/ResetPasswordPage"));
const PublicCatalogPage      = lazy(() => import("@/pages/PublicCatalogPage"));
const PublicPaymentPage      = lazy(() => import("@/pages/PublicPaymentPage"));
const PricingPage            = lazy(() => import("@/pages/PricingPage"));
const PrivacyPage            = lazy(() => import("@/pages/PrivacyPage"));
const TermsPage              = lazy(() => import("@/pages/TermsPage"));
const OnboardingPage         = lazy(() => import("@/pages/OnboardingPage"));
const TeamPage               = lazy(() => import("@/pages/TeamPage"));
const InvitationAcceptPage   = lazy(() => import("@/pages/InvitationAcceptPage"));
const PlatformAdminPage      = lazy(() => import("@/pages/PlatformAdminPage"));
const AnalyticsPage          = lazy(() => import("@/pages/AnalyticsPage"));
const InvoicesPage           = lazy(() => import("@/pages/InvoicesPage"));
const POSPage                = lazy(() => import("@/pages/POSPage"));
const CashSessionPage        = lazy(() => import("@/pages/CashSessionPage"));
const IntegrationsPage       = lazy(() => import("@/pages/IntegrationsPage"));
const ProveedoresPage        = lazy(() => import("@/pages/ProveedoresPage"));
const PresupuestosPage       = lazy(() => import("@/pages/PresupuestosPage"));
const DevolucionesPage       = lazy(() => import("@/pages/DevolucionesPage"));
const CuotasPage             = lazy(() => import("@/pages/CuotasPage"));
const ChequesPage            = lazy(() => import("@/pages/ChequesPage"));
const SellerCommissionsPage  = lazy(() => import("@/pages/SellerCommissionsPage"));
const TasksPage              = lazy(() => import("@/pages/TasksPage"));
const AutoRestockPage        = lazy(() => import("@/pages/AutoRestockPage"));
const StockCountPage         = lazy(() => import("@/pages/StockCountPage"));
const KardexPage             = lazy(() => import("@/pages/KardexPage"));
const EmailCampaignsPage     = lazy(() => import("@/pages/EmailCampaignsPage"));
const WhatsAppCampaignsPage  = lazy(() => import("@/pages/WhatsAppCampaignsPage"));
const PaymentLinksPage       = lazy(() => import("@/pages/PaymentLinksPage"));
const TeamChatPage           = lazy(() => import("@/pages/TeamChatPage"));
const BankReconciliationPage = lazy(() => import("@/pages/BankReconciliationPage"));
const SalesPipelinePage      = lazy(() => import("@/pages/SalesPipelinePage"));
const LoyaltyPage              = lazy(() => import("@/pages/LoyaltyPage"));
const ProfilePage              = lazy(() => import("@/pages/ProfilePage"));
const AlertsPage               = lazy(() => import("@/pages/AlertsPage"));
const FinancialMovementsPage   = lazy(() => import("@/pages/FinancialMovementsPage"));
const ActivityFeedPage         = lazy(() => import("@/pages/ActivityFeedPage"));
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

function ProtectedRoutes() {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading, isAdmin, isVendedor, isViewer } = useUserRole();
  const { activeOrg, isPlatformAdmin } = useOrg();
  const { pathname } = useLocation();

  if (authLoading || roleLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">Cargando Gestiona...</p>
      </div>
    </div>
  );
  // Root path shows landing page for unauthenticated visitors
  if (!user && pathname === '/') return <LandingPage />;
  if (!user) return <AuthPage />;
  if (isViewer) return <ViewerGate />;

  // Force onboarding for fresh orgs — check DB field first, localStorage as fallback
  const onboarded = activeOrg
    ? (activeOrg.onboarding_completed || localStorage.getItem(`gestiona.onboarded.${activeOrg.id}`))
    : '1';
  const onOnboardingRoute = window.location.pathname === '/onboarding';
  if (activeOrg && !onboarded && !onOnboardingRoute) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <AppLayout>
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/ventas" element={<SalesPage />} />
          <Route path="/clientes" element={<CustomersPage />} />
          {/* Vendedor + admin */}
          <Route path="/caja" element={<POSPage />} />

          {/* Admin-only routes */}
          {isAdmin && (
            <>
              <Route path="/productos" element={<ProductsPage />} />
              <Route path="/compras" element={<PurchasesPage />} />
              <Route path="/deudas" element={<DebtsPage />} />
              <Route path="/reportes" element={<ReportsPage />} />
              <Route path="/marketing" element={<MarketingPage />} />
              <Route path="/canjes" element={<InfluencerExchangesPage />} />
              <Route path="/influencers" element={<InfluencersPage />} />
              <Route path="/liquidaciones" element={<SettlementsPage />} />
              <Route path="/marca-ia" element={<BrandKnowledgePage />} />
              <Route path="/combos-banners" element={<CombosBannersPage />} />
              <Route path="/catalogo" element={<CatalogPage />} />
              <Route path="/tiendanube" element={<TiendanubeExportPage />} />
              <Route path="/ia" element={<AIInsightsPage />} />
              <Route path="/chat-ia" element={<AIChatPage />} />
              <Route path="/automatizaciones" element={<AutomationFlowsPage />} />
              <Route path="/sucursales" element={<LocationsPage />} />
              <Route path="/referidos" element={<ReferralsPage />} />
              <Route path="/templates" element={<MarketingTemplatesPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/facturas" element={<InvoicesPage />} />
              <Route path="/caja/turno" element={<CashSessionPage />} />
              <Route path="/gastos" element={<ExpensesPage />} />
              <Route path="/proveedores" element={<ProveedoresPage />} />
              <Route path="/presupuestos" element={<PresupuestosPage />} />
              <Route path="/devoluciones" element={<DevolucionesPage />} />
              <Route path="/cuotas" element={<CuotasPage />} />
              <Route path="/cheques" element={<ChequesPage />} />
              <Route path="/comisiones" element={<SellerCommissionsPage />} />
              <Route path="/tareas" element={<TasksPage />} />
              <Route path="/restock" element={<AutoRestockPage />} />
              <Route path="/toma-fisica" element={<StockCountPage />} />
              <Route path="/kardex" element={<KardexPage />} />
              <Route path="/email-campaigns" element={<EmailCampaignsPage />} />
              <Route path="/whatsapp-campaigns" element={<WhatsAppCampaignsPage />} />
              <Route path="/links-de-pago" element={<PaymentLinksPage />} />
              <Route path="/chat-equipo" element={<TeamChatPage />} />
              <Route path="/banco" element={<BankReconciliationPage />} />
              <Route path="/movimientos" element={<FinancialMovementsPage />} />
              <Route path="/pipeline" element={<SalesPipelinePage />} />
              <Route path="/fidelidad" element={<LoyaltyPage />} />
              <Route path="/alertas" element={<AlertsPage />} />
              <Route path="/actividad" element={<ActivityFeedPage />} />
              <Route path="/integraciones" element={<IntegrationsPage />} />
              <Route path="/ajustes" element={<SettingsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/equipo" element={<TeamPage />} />
              <Route path="/perfil" element={<ProfilePage />} />
            </>
          )}

          {/* Platform-admin only */}
          {isPlatformAdmin && (
            <Route path="/platform/admin" element={<PlatformAdminPage />} />
          )}

          {/* Redirect vendedor from admin routes */}
          {isVendedor && (
            <Route path="*" element={<Navigate to="/" replace />} />
          )}

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}

const CHUNK_RELOAD_KEY = 'chunk_reload_once';

const isChunkError = (err: unknown) => {
  const msg = (err as any)?.message ?? '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('MIME type')
  );
};

const App = () => (
  <Sentry.ErrorBoundary fallback={({ error }) => {
    if (isChunkError(error)) {
      // New deploy wiped old chunks — reload once to get fresh index.html
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        return null;
      }
      // Already reloaded once — show update prompt instead of blank screen
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8 text-center">
          <div>
            <h1 className="text-xl font-bold mb-2">Nueva versión disponible</h1>
            <p className="text-muted-foreground text-sm mb-4">La app se actualizó. Recargá para continuar.</p>
            <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
              onClick={() => { sessionStorage.removeItem(CHUNK_RELOAD_KEY); window.location.reload(); }}>
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
                <Route path="/landing" element={<Navigate to="/" replace />} />
                <Route path="/login" element={<AuthPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/precios" element={<PricingPage />} />
                <Route path="/privacidad" element={<PrivacyPage />} />
                <Route path="/terminos" element={<TermsPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/catalogo/:userId" element={<PublicCatalogPage />} />
                <Route path="/pagar/:linkId" element={<PublicPaymentPage />} />
                <Route path="/invitacion/:token" element={<InvitationAcceptPage />} />
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
);

export default App;
