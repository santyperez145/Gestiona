import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useOrg } from "@/lib/orgContext";
import { orgViewKey, readPersistedValue, usePersistedState, writePersistedValue } from "@/hooks/usePersistedState";
import WorkspaceViewTabs from "@/components/shared/WorkspaceViewTabs";
import { BarChart3, Gauge, Layers, TrendingUp, Loader2, CircleDollarSign } from "lucide-react";

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
const ProfitView = lazy(() => import("@/components/analytics/ProfitView"));

type Vista = "resumen" | "rentabilidad" | "tableros" | "cohortes" | "pronostico";
function parseVista(value: string | null): Vista | null {
  return ["resumen", "rentabilidad", "tableros", "cohortes", "pronostico"].includes(value) ? value as Vista : null;
}

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

  const [storedVista, setVista] = usePersistedState<Vista>(
    orgViewKey("analytics.view", activeOrg?.id),
    "resumen",
  );

  // Los redirects de las rutas viejas llegan con ?vista=. La URL gana cuando
  // alguien pidió una vista explícita; sin ?vista= manda la persistida.
  const [params, setParams] = useSearchParams();
  const vista = parseVista(params.get("vista")) || parseVista(storedVista) || "resumen";
  useEffect(() => {
    const v = params.get("vista");
    const legacyKey = orgViewKey("analytics.tab", activeOrg?.id);
    const legacyMargin = activeOrg && readPersistedValue<string>(legacyKey, "trend") === "margen-canal";
    if (legacyMargin) writePersistedValue(legacyKey, "trend");
    if (legacyMargin && (!v || v === "resumen")) {
      setVista("rentabilidad");
      setParams(previous => { const next = new URLSearchParams(previous); next.set("vista", "rentabilidad"); return next; }, { replace: true });
    } else if (v === "resumen" || v === "rentabilidad" || v === "tableros" || v === "cohortes" || v === "pronostico") setVista(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id, params]);

  return (
    <div className="workspace-page space-y-6 pb-12">
      <WorkspaceViewTabs
        ariaLabel="Vistas de Analytics"
        activeTab={vista}
        onChange={(tab) => {
          setVista(tab as Vista);
          setParams(previous => { const next = new URLSearchParams(previous); next.set("vista", tab); return next; }, { replace: true });
        }}
        tabs={[
          { id: "resumen", label: "Resumen", icon: BarChart3 },
          { id: "rentabilidad", label: "Rentabilidad", icon: CircleDollarSign },
          { id: "tableros", label: "Tableros y KPIs", icon: Gauge },
          { id: "cohortes", label: "Cohortes y BI", icon: Layers },
          { id: "pronostico", label: "Pronóstico", icon: TrendingUp },
        ]}
      />

      <Suspense fallback={<CargandoVista />}>
        {vista === "resumen" && <ResumenView />}
        {vista === "rentabilidad" && <ProfitView />}
        {vista === "tableros" && <TablerosView />}
        {vista === "cohortes" && <CohortesView />}
        {vista === "pronostico" && <PronosticoView />}
      </Suspense>
    </div>
  );
}
