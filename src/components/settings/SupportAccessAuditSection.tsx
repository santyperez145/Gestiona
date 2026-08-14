import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { isMissingRelation } from "@/lib/publicDataSource";
import { Button } from "@/components/ui/button";

type SupportAccess = {
  id: string;
  created_at: string;
  staff_email: string | null;
  event: string;
};

/** D6/F8: sólo los dueños pueden ver la proyección mínima del log de soporte. */
export function SupportAccessAuditSection() {
  const { activeOrg, activeRole } = useOrg();
  const [entries, setEntries] = useState<SupportAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg || activeRole !== "owner") return;
    setLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("organization_support_accesses")
      .select("id, created_at, staff_email, event")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[soporte] no se pudo leer el registro de accesos:", error.message);
      setEntries([]);
      setErrorMessage(isMissingRelation(error)
        ? "El registro de soporte todavía no está disponible en esta instalación."
        : "No se pudo leer el registro. No se interpreta como que no haya habido accesos.");
    } else {
      setEntries((data ?? []) as SupportAccess[]);
    }
    setLoading(false);
  }, [activeOrg, activeRole]);

  useEffect(() => { void load(); }, [load]);

  if (!activeOrg || activeRole !== "owner") return null;

  return (
    <div className="settings-panel settings-panel--system bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />Registro de soporte
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Solo los dueños ven cuándo el staff generó un enlace de acceso para una cuenta de este negocio.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 mb-3">
        Se registra la generación del enlace, no si alguien lo abrió. Los enlaces y los datos de la persona destinataria no se muestran.
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground py-2">Cargando registro…</p>
      ) : errorMessage ? (
        <p className="text-xs text-destructive py-2">{errorMessage}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No hay enlaces de soporte registrados para esta organización.</p>
      ) : (
        <div className="space-y-2 max-h-[280px] overflow-y-auto">
          {entries.map(entry => (
            <div key={entry.id} className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
              <p className="text-sm font-medium">Soporte generó un enlace de acceso</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {new Date(entry.created_at).toLocaleString("es-AR")}
                {entry.staff_email ? ` · ${entry.staff_email}` : " · Staff de plataforma"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
