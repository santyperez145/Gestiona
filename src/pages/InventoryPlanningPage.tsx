import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useOrg } from "@/lib/orgContext";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import WorkspaceViewTabs from "@/components/shared/WorkspaceViewTabs";
import { PackageOpen, TrendingUp, Brain, Loader2 } from "lucide-react";

// Workspace de planificación de inventario.
//
// ⚠️ Hasta el 2026-08-27 esto eran TRES páginas del sidebar —Reposición
// automática (/restock), Proyección de stock (/forecast-inventario) e
// Inventario con IA (/inventario-inteligente)— cada una con su propia
// implementación de velocidad de venta, safety stock y punto de reposición.
// Tres motores para la misma pregunta («¿qué compro y cuándo?») pueden dar
// tres respuestas distintas para el mismo producto según qué página se abra.
//
// La consolidación las vuelve vistas de un solo workspace. 📌 **Lo que este
// paso NO hace:** unificar los tres cálculos en una autoridad server-side
// (INV-001, el planning engine). Mover y reescribir en el mismo paso deja sin
// saber cuál de los dos cambios rompió qué — primero una URL, después una
// autoridad. Mientras tanto, verlas juntas hace visible la divergencia en vez
// de esconderla en tres URLs.
//
// Cada vista carga con `lazy()`: sólo la activa consulta y pesa. Sus
// PageHeaders propios se conservan porque cada una tiene acciones reales
// (umbral de días, horizonte, período).

const ReposicionView = lazy(() => import("@/components/inventory/ReposicionView"));
const ForecastView = lazy(() => import("@/components/inventory/ForecastView"));
const AnalisisView = lazy(() => import("@/components/inventory/AnalisisView"));

type Vista = "reposicion" | "forecast" | "analisis";

function CargandoVista() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      <span className="text-sm">Cargando la vista…</span>
    </div>
  );
}

export default function InventoryPlanningPage() {
  usePageTitle("Planificación de inventario");
  const { activeOrg } = useOrg();

  const [vista, setVista] = usePersistedState<Vista>(
    orgViewKey("inventory-planning.view", activeOrg?.id),
    "reposicion",
  );

  // Los redirects de las tres rutas viejas llegan con ?vista=. La URL gana
  // cuando alguien pidió una vista explícita; sin ?vista= manda la persistida.
  const [params] = useSearchParams();
  useEffect(() => {
    const v = params.get("vista");
    if (v === "reposicion" || v === "forecast" || v === "analisis") setVista(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <div className="workspace-page space-y-6 pb-12">
      <WorkspaceViewTabs
        ariaLabel="Vistas de planificación de inventario"
        activeTab={vista}
        onChange={(tab) => setVista(tab as Vista)}
        tabs={[
          { id: "reposicion", label: "Reposición", icon: PackageOpen },
          { id: "forecast", label: "Proyección", icon: TrendingUp },
          { id: "analisis", label: "Análisis ABC", icon: Brain },
        ]}
      />

      <Suspense fallback={<CargandoVista />}>
        {vista === "reposicion" && <ReposicionView />}
        {vista === "forecast" && <ForecastView />}
        {vista === "analisis" && <AnalisisView />}
      </Suspense>
    </div>
  );
}
