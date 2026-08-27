import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useOrg } from "@/lib/orgContext";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import WorkspaceViewTabs from "@/components/shared/WorkspaceViewTabs";
import { BarChart3, Gauge, Layers, TrendingUp, Loader2 } from "lucide-react";

// Workspace de Analytics.
//
// ⚠️ Hasta el 2026-08-27 esto eran CUATRO páginas del sidebar —Analytics,
// KPIs (/kpi-dashboard), Reportes avanzados (/bi-reportes) y Proyección de
// ventas (/forecast)— compitiendo por ser el centro analítico, cada una
// cargando sus propios datos. La consolidación las vuelve vistas de un solo
// workspace; cada una carga con `lazy()` y sólo la activa consulta.
//
// 📌 Lo que este paso NO hace: unificar la definición de cada métrica en un
// registro (ANA-001, el KPI Registry) ni reducir ReportsPage a
// exportaciones. Primero una URL, después una autoridad — el mismo orden que
// Planificación de inventario.

const ResumenView = lazy(() => import("@/components/analytics/ResumenView"));
const TablerosView = lazy(() => import("@/components/analytics/TablerosView"));
const CohortesView = lazy(() => import("@/components/analytics/CohortesView"));
const PronosticoView = lazy(() => import("@/components/analytics/PronosticoView"));

type Vista = "resumen" | "tableros" | "cohortes" | "pronostico";

function CargandoVista() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      <span className="text-sm">Cargando la vista…</span>
    </div>
  );
}

export default function AnalyticsPage() {
  usePageTitle("Analytics");
  const { activeOrg } = useOrg();

  const [vista, setVista] = usePersistedState<Vista>(
    orgViewKey("analytics.view", activeOrg?.id),
    "resumen",
  );

  // Los redirects de las rutas viejas llegan con ?vista=. La URL gana cuando
  // alguien pidió una vista explícita; sin ?vista= manda la persistida.
  const [params] = useSearchParams();
  useEffect(() => {
    const v = params.get("vista");
    if (v === "resumen" || v === "tableros" || v === "cohortes" || v === "pronostico") setVista(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <div className="workspace-page space-y-6 pb-12">
      <WorkspaceViewTabs
        ariaLabel="Vistas de Analytics"
        activeTab={vista}
        onChange={(tab) => setVista(tab as Vista)}
        tabs={[
          { id: "resumen", label: "Resumen", icon: BarChart3 },
          { id: "tableros", label: "Tableros y KPIs", icon: Gauge },
          { id: "cohortes", label: "Cohortes y BI", icon: Layers },
          { id: "pronostico", label: "Pronóstico", icon: TrendingUp },
        ]}
      />

      <Suspense fallback={<CargandoVista />}>
        {vista === "resumen" && <ResumenView />}
        {vista === "tableros" && <TablerosView />}
        {vista === "cohortes" && <CohortesView />}
        {vista === "pronostico" && <PronosticoView />}
      </Suspense>
    </div>
  );
}
