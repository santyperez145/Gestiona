import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { OrgProvider, useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import ProductsPage from "@/pages/ProductsPage";
import PurchasesPage from "@/pages/PurchasesPage";
import SalesPage from "@/pages/SalesPage";
import DebtsPage from "@/pages/DebtsPage";
import ReportsPage from "@/pages/ReportsPage";
import SettingsPage from "@/pages/SettingsPage";
import MarketingPage from "@/pages/MarketingPage";
import AIInsightsPage from "@/pages/AIInsightsPage";
import ExpensesPage from "@/pages/ExpensesPage";
import CustomersPage from "@/pages/CustomersPage";
import InfluencerExchangesPage from "@/pages/InfluencerExchangesPage";
import CatalogPage from "@/pages/CatalogPage";
import AuthPage from "@/pages/AuthPage";
import AdminPage from "@/pages/AdminPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import PublicCatalogPage from "@/pages/PublicCatalogPage";
import LandingPage from "@/pages/LandingPage";
import PricingPage from "@/pages/PricingPage";
import OnboardingPage from "@/pages/OnboardingPage";
import TeamPage from "@/pages/TeamPage";
import InvitationAcceptPage from "@/pages/InvitationAcceptPage";
import PlatformAdminPage from "@/pages/PlatformAdminPage";
import NotFound from "./pages/NotFound";
import CommandPalette from "@/components/shared/CommandPalette";
import { ShieldAlert, BookOpen } from "lucide-react";
import { useOrg } from "@/lib/orgContext";

const queryClient = new QueryClient();

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

  if (authLoading || roleLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">Cargando Gestiona...</p>
      </div>
    </div>
  );
  if (!user) return <AuthPage />;
  if (isViewer) return <ViewerGate />;

  // Force onboarding for fresh orgs
  const onboarded = activeOrg ? localStorage.getItem(`gestiona.onboarded.${activeOrg.id}`) : '1';
  const onOnboardingRoute = window.location.pathname === '/onboarding';
  if (activeOrg && !onboarded && !onOnboardingRoute) {
    return <Navigate to="/onboarding" replace />;
  }

  // Vendedor: restricted routes
  const vendedorRoutes = ['/', '/ventas', '/clientes'];

  return (
    <AppLayout>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/ventas" element={<SalesPage />} />
        <Route path="/clientes" element={<CustomersPage />} />
        
        {/* Admin-only routes */}
        {isAdmin && (
          <>
            <Route path="/productos" element={<ProductsPage />} />
            <Route path="/compras" element={<PurchasesPage />} />
            <Route path="/deudas" element={<DebtsPage />} />
            <Route path="/reportes" element={<ReportsPage />} />
            <Route path="/marketing" element={<MarketingPage />} />
            <Route path="/canjes" element={<InfluencerExchangesPage />} />
            <Route path="/catalogo" element={<CatalogPage />} />
            <Route path="/ia" element={<AIInsightsPage />} />
            <Route path="/gastos" element={<ExpensesPage />} />
            <Route path="/ajustes" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/equipo" element={<TeamPage />} />
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
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <OrgProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/landing" element={<LandingPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/catalogo/:userId" element={<PublicCatalogPage />} />
              <Route path="/invitacion/:token" element={<InvitationAcceptPage />} />
              <Route path="/app/*" element={<ProtectedRoutes />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </BrowserRouter>
        </OrgProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
