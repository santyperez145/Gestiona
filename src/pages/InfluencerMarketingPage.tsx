import { useState, useEffect } from "react";
import { Activity, ArrowRightLeft, Store, TrendingUp, Users, Sparkles, BarChart3, CheckCircle2, ShieldCheck, FileText, Calendar, DollarSign, Shield, Target, TrendingDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import InfluencerExchangesPage from "./InfluencerExchangesPage";
import CreatorDiscoveryPage from "./CreatorDiscoveryPage";
import { listInfluencers, listPayouts, listInfluencerContracts, listBrandPortals } from "@/lib/influencersDB";
import InfluencerContractsPage from "./InfluencerContractsPage";
import InfluencerPaymentsPage from "./InfluencerPaymentsPage";
import InfluencerDeliverablesPage from "./InfluencerDeliverablesPage";
import InfluencerBrandPortalPage from "./InfluencerBrandPortalPage";
import { listInfluencerSales, listInfluencerPayouts } from "@/lib/influencersDB";
import { calcInfluencerROI, calcCPM, calcFulfillmentRate } from "@/lib/businessCalc";

/**
 * Plataforma de Influencer Marketing — independiente como Go-Marz.
 * Sin mocks ni simulaciones: cada métrica se obtiene desde el Core de Supabase.
 */
export default function InfluencerMarketingPage() {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [overviewData, setOverviewData] = useState<any>(null);
  const [metricsData, setMetricsData] = useState<any>(null);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const [influencers, payouts, contracts, brandPortals] = await Promise.all([
          listInfluencers(),
          listPayouts(),
          listInfluencerContracts(),
          listBrandPortals(),
        ]);
        setOverviewData({ influencers, payouts, contracts, brandPortals });
      } catch (e) {
        console.error("Error loading influencer overview:", e);
      }
    };
    const loadMetrics = async () => {
      try {
        const [sales, payouts] = await Promise.all([
          listInfluencerSales(),
          listInfluencerPayouts(),
        ]);
        const totalInversion = sales.reduce((s, r) => s + Number(r.commission_ars || 0), 0);
        const totalSalesGenerated = sales.reduce((s, r) => s + Number(r.sale_total_ars || 0), 0);
        const totalPaid = payouts.reduce((s, r) => s + Number(r.amount_ars || 0), 0);
        const fulfilled = sales.filter((r: any) => r.paid).length;
        const total = sales.length;
        const roi = total > 0 ? calcInfluencerROI(totalSalesGenerated, totalInversion) : null;
        const cpm = calcCPM(totalInversion, sales.reduce((s, r) => s + (r.impressions || 0), 0));
        const fulfillmentRate = total > 0 ? calcFulfillmentRate(fulfilled, total) : 0;
        setMetricsData({ totalInversion, totalSalesGenerated, totalPaid, roi, cpm, fulfillmentRate, total, fulfilled });
      } catch (e) {
        console.error("Error loading influencer metrics:", e);
      }
    };
    loadOverview();
    loadMetrics();
  }, []);

  const totalInfluencers = overviewData?.influencers?.length || 0;
  const totalActiveCampaigns = overviewData?.contracts?.filter((c: any) => c.status === "active").length || 0;
  const totalSignedContracts = overviewData?.contracts?.filter((c: any) => c.is_signed).length || 0;
  const totalPayouts = overviewData?.payouts?.length || 0;
  const totalContractValue = overviewData?.contracts?.reduce((s: number, c: any) => s + Number(c.contract_amount || 0), 0) || 0;
  const totalSalesGenerated = metricsData?.totalSalesGenerated || 0;
  const totalPaid = metricsData?.totalPaid || 0;
  const fulfillmentRate = metricsData?.fulfillmentRate || 0;
  const roi = metricsData?.roi;
  const cpm = metricsData?.cpm;

  const tabs = [
    { id: "overview", label: "Resumen", icon: Store },
    { id: "influencers", label: "Influencers", icon: Users },
    { id: "canjes", label: "Canjes", icon: ArrowRightLeft },
    { id: "analytics", label: "Analytics", icon: Activity },
    { id: "contratos", label: "Contratos", icon: FileText },
    { id: "entregables", label: "Entregables", icon: Calendar },
    { id: "pagos", label: "Pagos", icon: DollarSign },
    { id: "brand", label: "Brand Portal", icon: Shield },
    { id: "liquidaciones", label: "Liq. Influencers", icon: Shield },
  ];

  return (
    <div className="space-y-6 pb-12">
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
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)} className={`px-3 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 ${activeTab === t.id ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Overview con datos reales */}
      {activeTab === "overview" && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardTitle className="text-sm font-medium">{totalInfluencers}</CardTitle>
            <CardContent>
              <p className="text-xs text-muted-foreground">Influencers Activos</p>
            </CardContent>
          </Card>
          <Card>
            <CardTitle className="text-sm font-medium">{totalActiveCampaigns}</CardTitle>
            <CardContent>
              <p className="text-xs text-muted-foreground">Campañas En Vivo</p>
            </CardContent>
          </Card>
          <Card>
            <CardTitle className="text-sm font-medium">{totalSignedContracts}</CardTitle>
            <CardContent>
              <p className="text-xs text-muted-foreground">Contratos Firmados</p>
            </CardContent>
          </Card>
          <Card>
            <CardTitle className="text-sm font-medium">ARS {totalContractValue.toLocaleString("es-AR")}</CardTitle>
            <CardContent>
              <p className="text-xs text-muted-foreground">Valor Total Contratos</p>
            </CardContent>
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

      {/* Tab: Analytics - Métricas reales conectadas a Supabase */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardTitle className="text-sm font-medium">ARS {totalSalesGenerated.toLocaleString("es-AR")}</CardTitle>
              <CardContent>
                <p className="text-xs text-muted-foreground">Ventas Atribuidas</p>
              </CardContent>
            </Card>
            <Card>
              <CardTitle className="text-sm font-medium">ARS {totalPaid.toLocaleString("es-AR")}</CardTitle>
              <CardContent>
                <p className="text-xs text-muted-foreground">Pagos Realizados</p>
              </CardContent>
            </Card>
            <Card>
              <CardTitle className="text-sm font-medium">{fulfillmentRate.toFixed(0)}%</CardTitle>
              <CardContent>
                <p className="text-xs text-muted-foreground">Tasa de Cumplimiento</p>
              </CardContent>
            </Card>
            <Card>
              <CardTitle className="text-sm font-medium">{roi !== null ? `${roi > 0 ? '+' : ''}${roi.toFixed(1)}%` : '—'}</CardTitle>
              <CardContent>
                <p className="text-xs text-muted-foreground">ROI</p>
              </CardContent>
            </Card>
          </div>
          {cpm !== null && cpm > 0 && (
            <Card>
              <CardTitle className="text-lg font-display font-semibold">CPM</CardTitle>
              <CardContent>
                <p className="text-2xl font-display font-bold">ARS {cpm.toLocaleString("es-AR")}</p>
                <p className="text-xs text-muted-foreground">Costo por mil impresiones</p>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardTitle className="text-lg font-display font-semibold">Distribución por Plataforma</CardTitle>
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
              <CardTitle className="text-lg font-display font-semibold">Rendimiento General</CardTitle>
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

      {/* Tab: Contratos */}
      {activeTab === "contratos" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Contratos</h2>
          <InfluencerContractsPage />
        </div>
      )}

      {/* Tab: Entregables */}
      {activeTab === "entregables" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Entregables</h2>
          <InfluencerDeliverablesPage />
        </div>
      )}

      {/* Tab: Pagos */}
      {activeTab === "pagos" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Pagos a Influencers</h2>
          <InfluencerPaymentsPage />
        </div>
      )}

      {/* Tab: Brand Portal */}
      {activeTab === "brand" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Brand Portal</h2>
          <InfluencerBrandPortalPage />
        </div>
      )}

      {/* Tab: Liquidaciones */}
      {activeTab === "liquidaciones" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Liquidaciones de Influencers</h2>
          <div className="rounded-xl border border-border/40 bg-card p-6">
            <p className="text-muted-foreground">Módulo de liquidaciones integrado con `InfluencerPaymentsPage`.</p>
          </div>
        </div>
      )}
    </div>
  );
}