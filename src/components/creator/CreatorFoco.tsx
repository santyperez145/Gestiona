import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CreatorCampaign } from "@/lib/creatorContext";

/**
 * Bandeja FOCO del creador — patrón Shopify Sidekick Pulse traducido.
 *
 * ≤5 acciones accionables derivadas de los datos reales de la bandeja, no un
 * feed infinito. Cada oportunidad se puede clickear y hace scroll a la
 * campaña correspondiente: señal → acción, sin pantalla nueva que duplicar.
 */

export type FocoKind = "responder" | "entregar" | "venciendo" | "feedback";

interface FocoItem {
  id: string;
  kind: FocoKind;
  label: string;
  detail: string;
}

const KIND_META: Record<FocoKind, { label: string; tone: "warning" | "blue" | "destructive" }> = {
  responder: { label: "Responder", tone: "warning" },
  entregar: { label: "Entregar", tone: "blue" },
  venciendo: { label: "Vence pronto", tone: "destructive" },
  feedback: { label: "Feedback nuevo", tone: "blue" },
};

const KIND_ICON: Record<FocoKind, string> = {
  responder: "✉️",
  entregar: "📤",
  venciendo: "⏰",
  feedback: "💬",
};

/** Días hasta el vencimiento; null si no tiene fecha. */
function diasHasta(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const diff = new Date(dueDate).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

/** Deriva las ≤5 oportunidades del creador desde sus campañas reales. */
export function deriveCreatorFoco(campaigns: CreatorCampaign[]): FocoItem[] {
  const items: FocoItem[] = [];

  for (const c of campaigns) {
    const invitation = c.invitation_status?.toLowerCase();
    const entregado = Boolean(c.deliverable_url);
    const dias = diasHasta(c.due_date);

    // 1. Invitación pendiente de responder — lo más urgente: bloquea a la marca.
    if (invitation === "pending" || (!invitation && c.status === "activa" && !entregado)) {
      items.push({ id: `r-${c.id}`, kind: "responder", label: c.title, detail: c.org_name ?? "Marca" });
      continue;
    }
    // 2. Aceptada pero sin entregar.
    if (invitation === "accepted" && !entregado) {
      if (dias !== null && dias <= 3) {
        items.push({ id: `v-${c.id}`, kind: "venciendo", label: c.title, detail: dias <= 0 ? "Vence hoy" : `Vence en ${dias} día${dias === 1 ? "" : "s"}` });
      } else {
        items.push({ id: `e-${c.id}`, kind: "entregar", label: c.title, detail: c.org_name ?? "Marca" });
      }
      continue;
    }
    // 3. Entregado pero con feedback sin resolver (corrección pedida).
    if (entregado && c.review_notes && c.deliverable_status !== "completado") {
      items.push({ id: `f-${c.id}`, kind: "feedback", label: c.title, detail: "La marca pidió cambios" });
    }
  }

  return items.slice(0, 5);
}

interface CreatorFocoProps {
  campaigns: CreatorCampaign[];
  onNavigate: (campaignId: string) => void;
}

export function CreatorFoco({ campaigns, onNavigate }: CreatorFocoProps) {
  const foco = deriveCreatorFoco(campaigns);

  if (foco.length === 0) return null;

  return (
    <section
      aria-label="Foco del creador"
      className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-primary" /> Tu foco de hoy
        </h2>
        <Badge variant="secondary" className="text-[10px]">{foco.length} accionables</Badge>
      </div>
      <ul className="space-y-1.5">
        {foco.map(item => {
          const meta = KIND_META[item.kind];
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onNavigate(item.id.slice(2))}
                data-foco-kind={item.kind}
                className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/30"
              >
                <span aria-hidden="true">{KIND_ICON[item.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{item.detail}</span>
                </span>
                <Badge variant={meta.tone} className="shrink-0 text-[10px]">{meta.label}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}