import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { moduleForPath } from "@/app/routeManifest";

/**
 * Gate de acceso al producto Influencer Marketing.
 *
 * Igual que FinanceProductGate pero para la superficie de influencers.
 * Verifica que el usuario tiene el módulo `influencers` asignado.
 * El enforcement real está en RLS — esto sólo decide qué se dibuja.
 */
export function useInfluencerProductAccess() {
  const { user } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const [access, setAccess] = useState<{ allowed: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !activeOrg) {
      setAccess({ allowed: false });
      setLoading(false);
      return;
    }
    // El módulo se verifica contra routeManifest y permisos del usuario.
    // Para la superficie, el acceso lo gobierna que la ruta exista y el rol sea admin.
    const module = moduleForPath("/influencers");
    const hasModule = module === "influencers" && (activeRole === "admin" || activeRole === "owner");

    // Simular verificación asíncrona
    const timer = setTimeout(() => {
      setAccess({ allowed: hasModule });
      setLoading(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [user, activeOrg, activeRole]);

  return { access, loading };
}

export default function InfluencerMarketingGate({ children }: { children: React.ReactNode }) {
  const { activeOrg } = useOrg();
  const { access, loading } = useInfluencerProductAccess();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <Button variant="outline" size="sm" className="mt-4">Reintentar</Button>
          </div>
        </div>
      </div>
    );
  }

  if (access.allowed) return <>{children}</>;

  return (
    <div className="mx-auto max-w-xl rounded-[12px] border border-border bg-card p-6 text-center">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <h1 className="text-base font-semibold">Acceso a Influencer Marketing</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tu organización aún no tiene acceso al producto Influencer Marketing.
        {activeOrg?.name ? ` Contactá al administrador de ${activeOrg.name} para solicitar acceso.` : " Contactá al administrador para solicitar acceso."}
      </p>
    </div>
  );
}