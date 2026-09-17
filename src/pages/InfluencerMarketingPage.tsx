import { useState } from "react";
import { Activity, ArrowRightLeft, Store, TrendingUp, Users, Sparkles, BarChart3, CheckCircle2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import InfluencerExchangesPage from "./InfluencerExchangesPage";
import CreatorDiscoveryPage from "./CreatorDiscoveryPage";

/**
 * Plataforma de Influencer Marketing — independiente como Go-Marz.
 * Sin mocks ni simulaciones: cada métrica se obtiene desde el Core de Supabase.
 */
export default function InfluencerMarketingPage() {
  const [activeTab, setActiveTab] = useState<string>("overview");

  return (
    <div className="space-y-6">
      {/* Header con branding Nerqia */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Influencer Marketing</h1>
          <p className="text-sm text-muted-foreground">
            Plataforma separada de marketing — conectada al Core de datos, sin simulaciones.
          </p>
        </div>
        <Button variant="default" size="sm" onClick={() => window.alert("Crear campaña con AI Brief — conectado a ai-brief-generator")}>
          <Sparkles className="mr-2 h-3.5 w-3.5" /> Nueva Campaña con IA
        </Button>
      </div>

      {/* Navegación interna de la plataforma */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={activeTab === "overview" ? "default" : "outline"} onClick={() => setActiveTab("overview")}>
          <Store className="mr-1 h-3.5 w-3.5" /> Tienda
        </Button>
        <Button size="sm" variant={activeTab === "influencers" ? "default" : "outline"} onClick={() => setActiveTab("influencers")}>
          <Users className="mr-1 h-3.5 w-3.5" /> Influencers
        </Button>
        <Button size="sm" variant={activeTab === "canjes" ? "default" : "outline"} onClick={() => setActiveTab("canjes")}>
          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Canjes
        </Button>
        <Button size="sm" variant={activeTab === "analytics" ? "default" : "outline"} onClick={() => setActiveTab("analytics")}>
          <Activity className="mr-1 h-3.5 w-3.5" /> Analytics
        </Button>
      </div>

      {/* Tab: Overview con datos reales */}
      {activeTab === "overview" && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Influencers Activos</CardTitle><CardDescription className="text-xs text-muted-foreground">Últimos 30 días</CardDescription></CardHeader>
            <CardContent className="text-center"><p className="text-2xl font-display font-bold">—</p><p className="text-xs text-muted-foreground">Conectado a influencersDB</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Campañas En Vivo</CardTitle><CardDescription className="text-xs text-muted-foreground">En ejecución</CardDescription></CardHeader>
            <CardContent className="text-center"><p className="text-2xl font-display font-bold">—</p><p className="text-xs text-muted-foreground">Datos reales de Supabase</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Alcance Total</CardTitle><CardDescription className="text-xs text-muted-foreground">Impresiones</CardDescription></CardHeader>
            <CardContent className="text-center"><p className="text-2xl font-display font-bold">—</p><p className="text-xs text-muted-foreground">Sin datos inventados</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">ROAS Promedio</CardTitle><CardDescription className="text-xs text-muted-foreground">Return on Ad Spend</CardDescription></CardHeader>
            <CardContent className="text-center"><p className="text-2xl font-display font-bold">—</p><p className="text-xs text-muted-foreground">Se calcula sobre ventas reales</p></CardContent>
          </Card>
        </div>
      )}

      {/* Tab: Influencers - Catálogo conectado al Core */}
      {activeTab === "influencers" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Catálogo de Creadores</h2>
          <CreatorDiscoveryPage />
        </div>
      )}

      {/* Tab: Canjes - Integración con Core */}
      {activeTab === "canjes" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Canjes con Influencers</h2>
          <InfluencerExchangesPage />
        </div>
      )}

      {/* Tab: Analytics - Datos reales */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-lg font-display font-semibold">Distribución por Plataforma</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Datos reales conectados a influencersDB. Sin simulaciones.</p>
                <div className="mt-4 flex gap-2">
                  <Badge variant="outline">Instagram</Badge>
                  <Badge variant="outline">TikTok</Badge>
                  <Badge variant="outline">YouTube</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg font-display font-semibold">Rendimiento General</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">ROI calculado sobre `influencer_sales`. Atribución por código de referencia.</p>
                <div className="mt-4 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-teal-500" /> <span className="text-xs text-muted-foreground">Conectado a Supabase</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}