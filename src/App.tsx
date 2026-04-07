import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
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
import CustomersPage from "@/pages/CustomersPage";
import AuthPage from "@/pages/AuthPage";
import AdminPage from "@/pages/AdminPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import NotFound from "./pages/NotFound";
import CommandPalette from "@/components/shared/CommandPalette";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">Cargando Exentry Imports...</p>
      </div>
    </div>
  );
  if (!user) return <AuthPage />;

  return (
    <AppLayout>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/productos" element={<ProductsPage />} />
        <Route path="/compras" element={<PurchasesPage />} />
        <Route path="/ventas" element={<SalesPage />} />
        <Route path="/deudas" element={<DebtsPage />} />
        <Route path="/clientes" element={<CustomersPage />} />
        <Route path="/reportes" element={<ReportsPage />} />
        <Route path="/marketing" element={<MarketingPage />} />
        <Route path="/ia" element={<AIInsightsPage />} />
        <Route path="/ajustes" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
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
        <BrowserRouter>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
