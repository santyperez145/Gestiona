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
const SellerGoalsPage          = lazy(() => import("@/pages/SellerGoalsPage"));
const InventoryAgingPage       = lazy(() => import("@/pages/InventoryAgingPage"));
const FollowUpPage             = lazy(() => import("@/pages/FollowUpPage"));
const PricingIntelligencePage  = lazy(() => import("@/pages/PricingIntelligencePage"));
const TeamPerformancePage      = lazy(() => import("@/pages/TeamPerformancePage"));
const CouponsPage              = lazy(() => import("@/pages/CouponsPage"));
const CalendarPage             = lazy(() => import("@/pages/CalendarPage"));
const CustomerRFMPage          = lazy(() => import("@/pages/CustomerRFMPage"));
const SalesForecastPage        = lazy(() => import("@/pages/SalesForecastPage"));
const SupportPage              = lazy(() => import("@/pages/SupportPage"));
const DripSequencesPage        = lazy(() => import("@/pages/DripSequencesPage"));
const CustomFieldsPage         = lazy(() => import("@/pages/CustomFieldsPage"));
const KnowledgeBasePage        = lazy(() => import("@/pages/KnowledgeBasePage"));
const NPSSurveysPage           = lazy(() => import("@/pages/NPSSurveysPage"));
const AILeadScoringPage        = lazy(() => import("@/pages/AILeadScoringPage"));
const ChurnPredictionPage      = lazy(() => import("@/pages/ChurnPredictionPage"));
const ServiceOrdersPage        = lazy(() => import("@/pages/ServiceOrdersPage"));
const ProductBundlesPage       = lazy(() => import("@/pages/ProductBundlesPage"));
const ContractsPage            = lazy(() => import("@/pages/ContractsPage"));
const InventoryTransfersPage   = lazy(() => import("@/pages/InventoryTransfersPage"));
const PromotionsPage           = lazy(() => import("@/pages/PromotionsPage"));
const WebhooksPage             = lazy(() => import("@/pages/WebhooksPage"));
const SubscriptionsPage        = lazy(() => import("@/pages/SubscriptionsPage"));
const AIProductRecommenderPage = lazy(() => import("@/pages/AIProductRecommenderPage"));
const SLARulesPage             = lazy(() => import("@/pages/SLARulesPage"));
const PriceListsPage           = lazy(() => import("@/pages/PriceListsPage"));
const AffiliateProgramPage     = lazy(() => import("@/pages/AffiliateProgramPage"));
const InventoryForecastPage    = lazy(() => import("@/pages/InventoryForecastPage"));
const CustomerSegmentsPage     = lazy(() => import("@/pages/CustomerSegmentsPage"));
const PurchaseOrdersPage       = lazy(() => import("@/pages/PurchaseOrdersPage"));
const TimesheetsPage           = lazy(() => import("@/pages/TimesheetsPage"));
const QRGeneratorPage          = lazy(() => import("@/pages/QRGeneratorPage"));
const EventTicketingPage       = lazy(() => import("@/pages/EventTicketingPage"));
const AppointmentBookingPage   = lazy(() => import("@/pages/AppointmentBookingPage"));
const DigitalProductsPage      = lazy(() => import("@/pages/DigitalProductsPage"));
const DeliveryTrackingPage     = lazy(() => import("@/pages/DeliveryTrackingPage"));
const SupplierQuotesPage       = lazy(() => import("@/pages/SupplierQuotesPage"));
const GamificationPage         = lazy(() => import("@/pages/GamificationPage"));
const WarrantyClaimsPage       = lazy(() => import("@/pages/WarrantyClaimsPage"));
const FormsBuilderPage         = lazy(() => import("@/pages/FormsBuilderPage"));
const NotificationRulesPage    = lazy(() => import("@/pages/NotificationRulesPage"));
const CurrencyTrackerPage      = lazy(() => import("@/pages/CurrencyTrackerPage"));
const BudgetPlannerPage        = lazy(() => import("@/pages/BudgetPlannerPage"));
const SocialPlannerPage        = lazy(() => import("@/pages/SocialPlannerPage"));
const BatchLotPage             = lazy(() => import("@/pages/BatchLotPage"));
const RecipesPage              = lazy(() => import("@/pages/RecipesPage"));
const RentalPage               = lazy(() => import("@/pages/RentalPage"));
const MarketplaceListingsPage  = lazy(() => import("@/pages/MarketplaceListingsPage"));
const EmployeePayrollPage      = lazy(() => import("@/pages/EmployeePayrollPage"));
const ProjectManagementPage    = lazy(() => import("@/pages/ProjectManagementPage"));
const GiftCardsPage            = lazy(() => import("@/pages/GiftCardsPage"));
const DropshippingPage         = lazy(() => import("@/pages/DropshippingPage"));
const TaxManagementPage        = lazy(() => import("@/pages/TaxManagementPage"));
const FleetPage                = lazy(() => import("@/pages/FleetPage"));
const WasteControlPage         = lazy(() => import("@/pages/WasteControlPage"));
const FixedAssetsPage          = lazy(() => import("@/pages/FixedAssetsPage"));
const CustomerPortalPage       = lazy(() => import("@/pages/CustomerPortalPage"));
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
              <Route path="/metas" element={<SellerGoalsPage />} />
              <Route path="/inventario-aging" element={<InventoryAgingPage />} />
              <Route path="/seguimiento" element={<FollowUpPage />} />
              <Route path="/precios-inteligentes" element={<PricingIntelligencePage />} />
              <Route path="/rendimiento-equipo" element={<TeamPerformancePage />} />
              <Route path="/cupones" element={<CouponsPage />} />
              <Route path="/calendario" element={<CalendarPage />} />
              <Route path="/rfm" element={<CustomerRFMPage />} />
              <Route path="/forecast" element={<SalesForecastPage />} />
              <Route path="/soporte" element={<SupportPage />} />
              <Route path="/secuencias-email" element={<DripSequencesPage />} />
              <Route path="/campos-personalizados" element={<CustomFieldsPage />} />
              <Route path="/base-conocimiento" element={<KnowledgeBasePage />} />
              <Route path="/encuestas-nps" element={<NPSSurveysPage />} />
              <Route path="/lead-scoring" element={<AILeadScoringPage />} />
              <Route path="/churn" element={<ChurnPredictionPage />} />
              <Route path="/ordenes-servicio" element={<ServiceOrdersPage />} />
              <Route path="/bundles" element={<ProductBundlesPage />} />
              <Route path="/contratos" element={<ContractsPage />} />
              <Route path="/transferencias" element={<InventoryTransfersPage />} />
              <Route path="/promociones" element={<PromotionsPage />} />
              <Route path="/webhooks" element={<WebhooksPage />} />
              <Route path="/suscripciones" element={<SubscriptionsPage />} />
              <Route path="/recomendaciones-ia" element={<AIProductRecommenderPage />} />
              <Route path="/sla" element={<SLARulesPage />} />
              <Route path="/listas-precios" element={<PriceListsPage />} />
              <Route path="/afiliados" element={<AffiliateProgramPage />} />
              <Route path="/forecast-inventario" element={<InventoryForecastPage />} />
              <Route path="/segmentos" element={<CustomerSegmentsPage />} />
              <Route path="/ordenes-compra" element={<PurchaseOrdersPage />} />
              <Route path="/fichajes" element={<TimesheetsPage />} />
              <Route path="/qr-generator" element={<QRGeneratorPage />} />
              <Route path="/eventos" element={<EventTicketingPage />} />
              <Route path="/turnos" element={<AppointmentBookingPage />} />
              <Route path="/productos-digitales" element={<DigitalProductsPage />} />
              <Route path="/envios" element={<DeliveryTrackingPage />} />
              <Route path="/cotizaciones-proveedor" element={<SupplierQuotesPage />} />
              <Route path="/gamificacion" element={<GamificationPage />} />
              <Route path="/garantias" element={<WarrantyClaimsPage />} />
              <Route path="/formularios" element={<FormsBuilderPage />} />
              <Route path="/reglas-notificacion" element={<NotificationRulesPage />} />
              <Route path="/tipo-cambio" element={<CurrencyTrackerPage />} />
              <Route path="/presupuesto" element={<BudgetPlannerPage />} />
              <Route path="/planner-social" element={<SocialPlannerPage />} />
              <Route path="/lotes" element={<BatchLotPage />} />
              <Route path="/recetas" element={<RecipesPage />} />
              <Route path="/alquileres" element={<RentalPage />} />
              <Route path="/marketplace" element={<MarketplaceListingsPage />} />
              <Route path="/sueldos" element={<EmployeePayrollPage />} />
              <Route path="/proyectos" element={<ProjectManagementPage />} />
              <Route path="/tarjetas-regalo" element={<GiftCardsPage />} />
              <Route path="/dropshipping" element={<DropshippingPage />} />
              <Route path="/impuestos" element={<TaxManagementPage />} />
              <Route path="/flota" element={<FleetPage />} />
              <Route path="/mermas" element={<WasteControlPage />} />
              <Route path="/activos-fijos" element={<FixedAssetsPage />} />
              <Route path="/portal-clientes" element={<CustomerPortalPage />} />
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
