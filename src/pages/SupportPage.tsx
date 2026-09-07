import { BookOpen, Headphones, ShieldCheck, TimerReset } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import SupportWorkspace from "@/components/support/SupportWorkspace";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useOrg } from "@/lib/orgContext";

export default function SupportPage() {
  usePageTitle("Soporte");
  const { activeOrg } = useOrg();

  return (
    <div className="workspace-page space-y-5">
      <PageHeader
        icon={Headphones}
        eyebrow="Nerqia · Ayuda"
        title="Soporte"
        description="Canal seguro con el equipo: estado, responsable e historial en tu organización."
        badge={{ label: "Canal seguro", variant: "success" }}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <TimerReset className="mb-2 h-5 w-5 text-primary" />
          <p className="text-sm font-semibold">Seguimiento continuo</p>
          <p className="mt-1 text-xs text-muted-foreground">Estado, responsable e historial en una sola conversación.</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <ShieldCheck className="mb-2 h-5 w-5 text-primary" />
          <p className="text-sm font-semibold">Sin compartir accesos</p>
          <p className="mt-1 text-xs text-muted-foreground">Soporte no necesita tu contraseña y el diagnóstico requiere consentimiento.</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <BookOpen className="mb-2 h-5 w-5 text-primary" />
          <p className="text-sm font-semibold">Contexto del negocio</p>
          <p className="mt-1 text-xs text-muted-foreground">Cada consulta queda vinculada al comercio correcto, nunca a otra cuenta.</p>
        </div>
      </div>

      {activeOrg ? (
        <SupportWorkspace audience="merchant" orgId={activeOrg.id} />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Seleccioná una organización para contactar a soporte.
        </div>
      )}
    </div>
  );
}
