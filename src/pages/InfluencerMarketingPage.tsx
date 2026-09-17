import { useState } from "react";
import { Activity, ArrowRightLeft, Store, TrendingUp, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import InfluencerExchangesPage from "./InfluencerExchangesPage";
import CreatorDiscoveryPage from "./CreatorDiscoveryPage";

export default function InfluencerMarketingPage() {
  const [activeTab, setActiveTab] = useState<string>("overview");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-display font-bold">Influencer Marketing</h1>
        <div className="flex flex-wrap gap-2 sm:gap-4">
          <Button variant="outline" size="sm" onClick={() => setActiveTab("overview")} className={activeTab === "overview" ? "bg-muted" : ""}>
            <Store className="mr-1 h-3.5 w-3.5" /> Tienda
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveTab("influencers")} className={activeTab === "influencers" ? "bg-muted" : ""}>
            <Users className="mr-1 h-3.5 w-3.5" /> Influencers
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveTab("canjes")} className={activeTab === "canjes" ? "bg-muted" : ""}>
            <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Canjes
          </Button>
          <Button variant="outline" size="sm" onClick={() => setActiveTab("analytics")} className={activeTab === "analytics" ? "bg-muted" : ""}>
            <Activity className="mr-1 h-3.5 w-3.5" /> Analytics
          </Button>
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Influencers Activos</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Últimos 30 días</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">—</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">Conectado a influencersDB</CardFooter>
          </Card>
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Campañas En Vivo</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">En ejecución</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">—</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">Sin datos inventados</CardFooter>
          </Card>
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Alcance Total</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Impresiones</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">—</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">Desde Supabase</CardFooter>
          </Card>
          <Card className="h-[120px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">ROAS Promedio</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Return on Ad Spend</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-display font-bold">—</p>
            </CardContent>
            <CardFooter className="pt-2 text-xs text-muted-foreground">Se calcula sobre ventas reales</CardFooter>
          </Card>
        </div>
      )}

      {activeTab === "influencers" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Influencers — Discovery</h2>
          <CreatorDiscoveryPage />
        </div>
      )}

      {activeTab === "canjes" && (
        <div className="space-y-4">
          <h2 className="text-xl font-display font-semibold">Canjes con influencers</h2>
          <InfluencerExchangesPage />
        </div>
      )}

      {activeTab === "analytics" && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-lg font-display font-semibold">Rendimiento General</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">Sin datos inventados: conectar métricas reales desde Supabase cuando existan filas.</p></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}