import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useOrg } from "@/lib/orgContext";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import WorkspaceViewTabs from "@/components/shared/WorkspaceViewTabs";
import { Sparkles, Brain, Loader2 } from "lucide-react";

// Workspace de Inteligencia.
//
// ⚠️ Hasta el 2026-08-27 había DOS páginas genéricas de IA: Insights (/ia) y
// Asistente (/chat-ia), cada una con entrada propia en el sidebar. La
// consolidación las vuelve vistas de una sola. Los copilotos con contexto de
// dominio no viven acá: viven en su dominio.

const HallazgosView = lazy(() => import("@/components/intelligence/HallazgosView"));
const AsistenteView = lazy(() => import("@/components/intelligence/AsistenteView"));

type Vista = "hallazgos" | "asistente";

function CargandoVista() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      <span className="text-sm">Cargando la vista…</span>
    </div>
  );
}

export default function IntelligencePage() {
  usePageTitle("Inteligencia");
  const { activeOrg } = useOrg();

  const [vista, setVista] = usePersistedState<Vista>(
    orgViewKey("intelligence.view", activeOrg?.id),
    "hallazgos",
  );

  const [params] = useSearchParams();
  useEffect(() => {
    const v = params.get("vista");
    if (v === "hallazgos" || v === "asistente") setVista(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <div className="workspace-page space-y-6 pb-12">
      <WorkspaceViewTabs
        ariaLabel="Vistas de Inteligencia"
        activeTab={vista}
        onChange={(tab) => setVista(tab as Vista)}
        tabs={[
          { id: "hallazgos", label: "Hallazgos", icon: Sparkles },
          { id: "asistente", label: "Asistente", icon: Brain },
        ]}
      />

      <Suspense fallback={<CargandoVista />}>
        {vista === "hallazgos" && <HallazgosView />}
        {vista === "asistente" && <AsistenteView />}
      </Suspense>
    </div>
  );
}
