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
import { PermissionsProvider } from "@/lib/permissionsContext";
import { supabase } from "@/integrations/supabase/client";
import { hardReload } from "@/lib/hardReload";
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
const LocationsPage          = lazy(() => import("@/pages/LocationsPage"));
const ReferralsPage          = lazy(() => import("@/pages/ReferralsPage"));
const ExpensesPage           = lazy(() => import("@/pages/ExpensesPage"));
const CustomersPage          = lazy(() => import("@/pages/CustomersPage"));
const InfluencerExchangesPage= lazy(() => import("@/pages/InfluencerExchangesPage"));
const InfluencersPage        = lazy(() => import("@/pages/InfluencersPage"));
const CatalogPage            = lazy(() => import("@/pages/CatalogPage"));
const AdminPage              = lazy(() => import("@/pages/AdminPage"));
const ResetPasswordPage      = lazy(() => import("@/pages/ResetPasswordPage"));
const PublicCatalogPage      = lazy(() => import("@/pages/PublicCatalogPage"));
const StorefrontPage         = lazy(() => import("@/pages/StorefrontPage"));
const PublicPaymentPage      = lazy(() => import("@/pages/PublicPaymentPage"));
const InfluencerPortalPage   = lazy(() => import("@/pages/InfluencerPortalPage"));
const PricingPage            = lazy(() => import("@/pages/PricingPage"));
const PrivacyPage            = lazy(() => import("@/pages/PrivacyPage"));
const TermsPage              = lazy(() => import("@/pages/TermsPage"));
const ServiceStatusPage      = lazy(() => import("@/pages/ServiceStatusPage"));
const OnboardingPage         = lazy(() => import("@/pages/OnboardingPage"));
const TeamPage               = lazy(() => import("@/pages/TeamPage"));
const InvitationAcceptPage   = lazy(() => import("@/pages/InvitationAcceptPage"));
const PlatformAdminPage      = lazy(() => import("@/pages/PlatformAdminPage"));
const PlatformMetricsPage   = lazy(() => import("@/pages/PlatformMetricsPage"));
const PlatformCommissionsPage = lazy(() => import("@/pages/PlatformCommissionsPage"));
const PlatformBusinessPage = lazy(() => import("@/pages/PlatformBusinessPage"));
const PlatformAnnouncementsPage = lazy(() => import("@/pages/PlatformAnnouncementsPage"));
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
const KardexPage             = lazy(() => import("@/pages/KardexPage"));
const EmailCampaignsPage     = lazy(() => import("@/pages/EmailCampaignsPage"));
const WhatsAppCampaignsPage  = lazy(() => import("@/pages/WhatsAppCampaignsPage"));
const PaymentLinksPage       = lazy(() => import("@/pages/PaymentLinksPage"));
const BankReconciliationPage = lazy(() => import("@/pages/BankReconciliationPage"));
const ProfilePage              = lazy(() => import("@/pages/ProfilePage"));
const FinancialMovementsPage   = lazy(() => import("@/pages/FinancialMovementsPage"));
const LibroPage                = lazy(() => import("@/pages/LibroPage"));
const FollowUpPage             = lazy(() => import("@/pages/FollowUpPage"));
const CouponsPage              = lazy(() => import("@/pages/CouponsPage"));
const CalendarPage             = lazy(() => import("@/pages/CalendarPage"));
const CustomerRFMPage          = lazy(() => import("@/pages/CustomerRFMPage"));
const SalesForecastPage        = lazy(() => import("@/pages/SalesForecastPage"));
const ProductBundlesPage       = lazy(() => import("@/pages/ProductBundlesPage"));
const InventoryTransfersPage   = lazy(() => import("@/pages/InventoryTransfersPage"));
const PromotionsPage           = lazy(() => import("@/pages/PromotionsPage"));
const SubscriptionsPage        = lazy(() => import("@/pages/SubscriptionsPage"));
const PriceListsPage           = lazy(() => import("@/pages/PriceListsPage"));
const WalletPage               = lazy(() => import("@/pages/WalletPage"));
const MiPlanPage               = lazy(() => import("@/pages/MiPlanPage"));
const AffiliateProgramPage     = lazy(() => import("@/pages/AffiliateProgramPage"));
const InventoryForecastPage    = lazy(() => import("@/pages/InventoryForecastPage"));
const PurchaseOrdersPage       = lazy(() => import("@/pages/PurchaseOrdersPage"));
const DeliveryTrackingPage     = lazy(() => import("@/pages/DeliveryTrackingPage"));
const SocialPlannerPage        = lazy(() => import("@/pages/SocialPlannerPage"));
const BatchLotPage             = lazy(() => import("@/pages/BatchLotPage"));
const TaxManagementPage        = lazy(() => import("@/pages/TaxManagementPage"));
const CashFlowPage             = lazy(() => import("@/pages/CashFlowPage"));
const KPIDashboardPage         = lazy(() => import("@/pages/KPIDashboardPage"));
const LoyaltyAdvancedPage      = lazy(() => import("@/pages/LoyaltyAdvancedPage"));
const SmartInventoryPage       = lazy(() => import("@/pages/SmartInventoryPage"));
const AIChatAdvancedPage       = lazy(() => import("@/pages/AIChatAdvancedPage"));
const AFIPPage                 = lazy(() => import("@/pages/AFIPPage"));
const BIReportsPage            = lazy(() => import("@/pages/BIReportsPage"));
const EcommerceStorePage       = lazy(() => import("@/pages/EcommerceStorePage"));
const MultiCurrencyPage        = lazy(() => import("@/pages/MultiCurrencyPage"));
const AdvancedCRMPage          = lazy(() => import("@/pages/AdvancedCRMPage"));
const InventoryValuationPage   = lazy(() => import("@/pages/InventoryValuationPage"));
const SmartAlertsPage          = lazy(() => import("@/pages/SmartAlertsPage"));
const PLDashboardPage          = lazy(() => import("@/pages/PLDashboardPage"));
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
          <Route path="orgs" element={<PlatformAdminPage section="orgs" />} />
          <Route path="usuarios" element={<PlatformAdminPage section="users" />} />
          <Route path="metricas" element={<PlatformMetricsPage />} />
          <Route path="planes" element={<PlatformAdminPage section="plans" />} />
          <Route path="negocio" element={<PlatformBusinessPage />} />
          <Route path="comisiones" element={<PlatformCommissionsPage />} />
          <Route path="soporte" element={<PlatformAdminPage section="support" />} />
          <Route path="anuncios" element={<PlatformAnnouncementsPage />} />
          <Route path="sistema" element={<PlatformAdminPage section="system" />} />
          {/* Ruta vieja */}
          <Route path="admin" element={<Navigate to="/platform" replace />} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Routes>
      </Suspense>
    </PlatformLayout>
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
              <Route path="/liquidaciones" element={<Navigate to="/canjes" replace />} />
              <Route path="/marca-ia" element={<Navigate to="/marketing" replace />} />
              <Route path="/combos-banners" element={<Navigate to="/marketing" replace />} />
              <Route path="/catalogo" element={<CatalogPage />} />
              <Route path="/ia" element={<AIInsightsPage />} />
              <Route path="/chat-ia" element={<AIChatAdvancedPage />} />
              <Route path="/automatizaciones" element={<Navigate to="/marketing" replace />} />
              <Route path="/sucursales" element={<LocationsPage />} />
              <Route path="/referidos" element={<ReferralsPage />} />
              <Route path="/templates" element={<Navigate to="/marketing" replace />} />
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
              <Route path="/toma-fisica" element={<Navigate to="/kardex" replace />} />
              <Route path="/kardex" element={<KardexPage />} />
              <Route path="/email-campaigns" element={<EmailCampaignsPage />} />
              <Route path="/whatsapp-campaigns" element={<WhatsAppCampaignsPage />} />
              <Route path="/links-de-pago" element={<PaymentLinksPage />} />
              <Route path="/banco" element={<BankReconciliationPage />} />
              <Route path="/movimientos" element={<FinancialMovementsPage />} />
              <Route path="/libro" element={<LibroPage />} />
              <Route path="/pipeline" element={<Navigate to="/crm-avanzado" replace />} />
              <Route path="/fidelidad" element={<LoyaltyAdvancedPage />} />
              <Route path="/alertas" element={<SmartAlertsPage />} />
              <Route path="/actividad" element={<Navigate to="/admin?tab=activity" replace />} />
              <Route path="/inventario-aging" element={<Navigate to="/valuacion-inventario" replace />} />
              <Route path="/seguimiento" element={<FollowUpPage />} />
              <Route path="/cupones" element={<CouponsPage />} />
              <Route path="/calendario" element={<CalendarPage />} />
              <Route path="/rfm" element={<CustomerRFMPage />} />
              <Route path="/forecast" element={<SalesForecastPage />} />
              <Route path="/secuencias-email" element={<Navigate to="/email-campaigns" replace />} />
              <Route path="/lead-scoring" element={<Navigate to="/rfm" replace />} />
              <Route path="/bundles" element={<ProductBundlesPage />} />
              <Route path="/transferencias" element={<InventoryTransfersPage />} />
              <Route path="/promociones" element={<PromotionsPage />} />
              <Route path="/webhooks" element={<Navigate to="/integraciones?tab=webhooks" replace />} />
              <Route path="/suscripciones" element={<SubscriptionsPage />} />
              <Route path="/recomendaciones-ia" element={<Navigate to="/" replace />} />
              <Route path="/listas-precios" element={<PriceListsPage />} />
              <Route path="/billetera" element={<WalletPage />} />
              <Route path="/mi-plan" element={<MiPlanPage />} />
              <Route path="/afiliados" element={<AffiliateProgramPage />} />
              <Route path="/forecast-inventario" element={<InventoryForecastPage />} />
              <Route path="/segmentos" element={<Navigate to="/rfm" replace />} />
              <Route path="/ordenes-compra" element={<PurchaseOrdersPage />} />
              <Route path="/envios" element={<DeliveryTrackingPage />} />
              <Route path="/cotizaciones-proveedor" element={<Navigate to="/ordenes-compra" replace />} />
              <Route path="/tipo-cambio" element={<Navigate to="/multi-divisa" replace />} />
              <Route path="/planner-social" element={<SocialPlannerPage />} />
              <Route path="/lotes" element={<BatchLotPage />} />
              <Route path="/impuestos" element={<TaxManagementPage />} />
              <Route path="/multi-deposito" element={<Navigate to="/sucursales" replace />} />
              <Route path="/solicitudes-compra" element={<Navigate to="/ordenes-compra" replace />} />
              <Route path="/cash-flow" element={<CashFlowPage />} />
              <Route path="/kpi-dashboard" element={<KPIDashboardPage />} />
              <Route path="/fidelidad-avanzada" element={<Navigate to="/fidelidad" replace />} />
              <Route path="/auditoria" element={<Navigate to="/admin?tab=audit" replace />} />
              <Route path="/api-keys" element={<Navigate to="/integraciones?tab=apikeys" replace />} />
              <Route path="/devoluciones-rma" element={<Navigate to="/devoluciones" replace />} />
              <Route path="/inventario-inteligente" element={<SmartInventoryPage />} />
              <Route path="/chat-ia-avanzado" element={<Navigate to="/chat-ia" replace />} />
              <Route path="/afip" element={<AFIPPage />} />
              <Route path="/bi-reportes" element={<BIReportsPage />} />
              <Route path="/tienda-online" element={<EcommerceStorePage />} />
              <Route path="/multi-divisa" element={<MultiCurrencyPage />} />
              <Route path="/analytics-ia" element={<Navigate to="/analytics" replace />} />
              <Route path="/crm-avanzado" element={<AdvancedCRMPage />} />
              <Route path="/escenarios-financieros" element={<Navigate to="/pl-dashboard" replace />} />
              <Route path="/franquicias" element={<Navigate to="/sucursales" replace />} />
              <Route path="/valuacion-inventario" element={<InventoryValuationPage />} />
              <Route path="/alertas-inteligentes" element={<Navigate to="/alertas" replace />} />
              <Route path="/pl-dashboard" element={<PLDashboardPage />} />
              <Route path="/integraciones" element={<IntegrationsPage />} />
              <Route path="/ajustes" element={<SettingsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/equipo" element={<TeamPage />} />
              <Route path="/perfil" element={<ProfilePage />} />
            </>
          )}

          {/* Redirect vendedor from admin routes */}
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

const CHUNK_RELOAD_KEY = 'chunk_reload_once';

/**
 * Un chunk que no carga casi siempre significa que el service worker está
 * sirviendo un index.html viejo que apunta a archivos que ya no existen
 * (deploy nuevo). Recargar sin más vuelve a leer ese mismo caché → loop
 * infinito de "Nueva versión disponible". Por eso primero borramos las
 * caches y desregistramos el SW, y recién ahí recargamos.
 */
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
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="gestiona-theme">
  <Sentry.ErrorBoundary fallback={({ error }) => {
    if (isChunkError(error)) {
      // Deploy nuevo: los chunks viejos ya no existen. Limpiamos caches + SW
      // y recargamos (una sola vez por sesión).
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        hardReload();
        return null;
      }
      // Si aun así falla, el botón vuelve a hacer la limpieza completa.
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8 text-center">
          <div>
            <h1 className="text-xl font-bold mb-2">Nueva versión disponible</h1>
            <p className="text-muted-foreground text-sm mb-4">La app se actualizó. Recargá para continuar.</p>
            <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
              onClick={() => { sessionStorage.removeItem(CHUNK_RELOAD_KEY); hardReload(); }}>
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
                <Route path="/estado" element={<ServiceStatusPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/catalogo/:userId" element={<PublicCatalogPage />} />
                <Route path="/tienda/:slug/*" element={<StorefrontPage />} />
                <Route path="/pagar/:linkId" element={<PublicPaymentPage />} />
                <Route path="/portal-influencer/:token" element={<InfluencerPortalPage />} />
                <Route path="/invitacion/:token" element={<InvitationAcceptPage />} />
                <Route path="/platform/*" element={<PlatformRoutes />} />
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
