import { useOrg } from "@/lib/orgContext";
import { AlertTriangle, Clock, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInfluencerProductAccess } from "@/hooks/useInfluencerProductAccess";

/**
 * Gate de acceso al producto Influencer Marketing.
 *
 * El RPC decide entitlement, membresía y permiso del módulo. Esta barrera
 * mejora la UX; RLS sigue siendo la autoridad de cada tabla.
 */
export default function InfluencerMarketingGate({ children }: { children: React.ReactNode }) {
  const { activeOrg } = useOrg();
  const { access, loading, requesting, error, refresh, requestAccess } = useInfluencerProductAccess();

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando acceso a Influencer Marketing...
      </div>
    );
  }

  if (error || !access) {
    return (
      <div className="mx-auto max-w-xl rounded-[12px] border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <h1 className="text-base font-semibold">No se pudo verificar el acceso</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error || "El producto no devolvió un estado válido."}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refresh()}>Reintentar</Button>
          </div>
        </div>
      </div>
    );
  }

  if (access.allowed) return <>{children}</>;

  return (
    <div className="mx-auto max-w-xl rounded-[12px] border border-border bg-card p-6 text-center">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
        {access.status === "requested" ? <Clock className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
      </div>
      <h1 className="text-base font-semibold">
        {access.status === "requested" ? "Solicitud en revisión" : "Activá Nerqia Influencers"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {access.status === "requested"
          ? "La plataforma recibió la solicitud. Te avisaremos cuando el producto esté habilitado."
          : access.blocker === "module_permission_denied"
            ? `Tu cuenta no tiene permiso para gestionar creadores en ${activeOrg?.name || "esta organización"}.`
            : "Centralizá matching, briefs, colaboraciones, aprobaciones, contratos, pagos y resultados."}
      </p>
      {access.canRequest && (
        <Button className="mt-4" size="sm" onClick={() => void requestAccess()} disabled={requesting}>
          {requesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Solicitar acceso
        </Button>
      )}
    </div>
  );
}
