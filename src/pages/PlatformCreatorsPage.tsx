/**
 * PlatformCreatorsPage — paridad Go-Marz en el panel de plataforma.
 *
 * Visión transversal de Creator Marketing: creadores registrados, retiros por
 * org con datos de cobro, KPI de pasivo circulante y liquidaciones pagadas.
 * Los montos son read-only: la plata la decide cada marca desde su panel;
 * plataforma audita y advierte estancadas sin exponer datos personales.
 */
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle, ArrowRight, Check, Sparkles, Users, Wallet, X,
} from "lucide-react";
import { usePlatformAccess } from "@/lib/usePermissions";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import WorkspaceState from "@/components/shared/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const money = (v: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const WITHDRAWAL_STATES: Record<string, string> = {
  pending: "En revisión", approved: "Aprobado", paid: "Pagado", rejected: "Rechazado",
};

interface WithdrawalRow {
  id: string;
  org_id: string;
  influencer_id: string;
  amount_ars: number;
  status: string;
  notes: string | null;
  created_at: string;
  processed_at: string | null;
}

interface CreatorRow {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  status: string | null;
  commission_percent: number | null;
  total_generated_ars: number | null;
  referral_code: string | null;
}

interface ModerationRow {
  user_id: string; display_name: string; public_slug: string; category: string | null;
  city: string | null; country_code: string; profile_public: boolean; discoverable: boolean;
  moderation_status: string; moderation_notes: string | null; updated_at: string;
}

export default function PlatformCreatorsPage() {
  const navigate = useNavigate();
  const { canPlatform } = usePlatformAccess();
  const autorizado = canPlatform("superadmin", "finance");
  const [rejecting, setRejecting] = useState<ModerationRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [moderating, setModerating] = useState<string | null>(null);

  // service_role vía RLS de staff de plataforma: retiros de todas las orgs.
  const withdrawals = useQuery({
    queryKey: ["platform-creator-withdrawals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("influencer_withdrawal_requests" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as WithdrawalRow[];
    },
    refetchOnWindowFocus: false,
  });

  const creators = useQuery({
    queryKey: ["platform-creators"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("influencers")
        .select("id, org_id, name, email, status, commission_percent, total_generated_ars, referral_code")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as CreatorRow[];
    },
    refetchOnWindowFocus: false,
  });

  const orgNames = useQuery({
    queryKey: ["platform-org-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id, name");
      if (error) throw error;
      return new Map((data ?? []).map((o: { id: string; name: string }) => [o.id, o.name]));
    },
    refetchOnWindowFocus: false,
  });

  const moderation = useQuery({
    queryKey: ["platform-creator-moderation"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("platform_creator_moderation_queue");
      if (error) throw error;
      return (data ?? []) as ModerationRow[];
    },
    enabled: autorizado,
    refetchOnWindowFocus: false,
  });

  const moderate = async (row: ModerationRow, decision: "approved" | "rejected", notes?: string) => {
    setModerating(row.user_id);
    const { error } = await (supabase as any).rpc("platform_moderate_creator_profile", { p_user_id: row.user_id, p_decision: decision, p_notes: notes ?? null });
    setModerating(null);
    if (error) { toast.error(error.message || "No se pudo moderar el perfil"); return; }
    toast.success(decision === "approved" ? "Perfil aprobado" : "Perfil devuelto al creador");
    setRejecting(null); setRejectReason("");
    await moderation.refetch();
  };

  const rows = useMemo(() => withdrawals.data ?? [], [withdrawals.data]);
  const kpis = useMemo(() => {
    const pendientes = rows.filter(r => r.status === "pending");
    const pagados = rows.filter(r => r.status === "paid");
    return {
      pendientesCount: pendientes.length,
      pendientesMonto: pendientes.reduce((s, r) => s + Number(r.amount_ars), 0),
      pagadoMonto: pagados.reduce((s, r) => s + Number(r.amount_ars), 0),
      creadores: (creators.data ?? []).length,
    };
  }, [rows, creators.data]);

  const estancadas = useMemo(
    () => rows.filter(r => {
      if (r.status !== "pending") return false;
      const dias = (Date.now() - new Date(r.created_at).getTime()) / 86_400_000;
      return dias > 7;
    }),
    [rows],
  );

  if (!autorizado) return <Navigate to="/platform" replace />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Sparkles}
        eyebrow="Nerqia · Plataforma"
        title="Creadores & Retiros"
      />

      {withdrawals.isPending || creators.isPending ? (
        <WorkspaceState kind="initial-loading" title="Cargando creadores y retiros…" />
      ) : withdrawals.isError ? (
        <WorkspaceState kind="error-recoverable" title="No pudimos cargar los retiros" actionLabel="Reintentar" onAction={() => void withdrawals.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard icon={Wallet} label="Retiros pendientes" value={money(kpis.pendientesMonto)} sub={`${kpis.pendientesCount} solicitud${kpis.pendientesCount === 1 ? "" : "es"} en revisión`} color="warning" />
            <KPICard icon={Check} label="Liquidado a creadores" value={money(kpis.pagadoMonto)} sub="Total pagado histórico" color="primary" />
            <KPICard icon={Users} label="Creadores registrados" value={String(kpis.creadores)} sub="En todas las organizaciones" color="blue" />
            <KPICard icon={AlertTriangle} label="Estancadas >7 días" value={String(estancadas.length)} sub={estancadas.length ? "Revisar con la marca" : "Todo al día"} color={estancadas.length ? "destructive" : "primary"} />
          </div>

          {estancadas.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {estancadas.length} solicitudes sin resolver hace más de 7 días</div>
              <p className="mt-1 text-xs">El creador queda bloqueado de su saldo hasta que la marca decida. Revisá junto al soporte.</p>
            </div>
          )}

          <section className="border-y border-border py-5">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Moderación del directorio</h2><p className="text-xs text-muted-foreground">Consentimiento del creador confirmado; revisá presentación y categoría antes de publicar.</p></div><Badge variant="outline">{(moderation.data ?? []).filter(row => row.moderation_status === "pending").length} pendientes</Badge></div>
            {moderation.isPending ? <WorkspaceState kind="initial-loading" title="Cargando perfiles…" /> : !(moderation.data ?? []).some(row => row.moderation_status === "pending") ? <p className="py-4 text-sm text-muted-foreground">No hay perfiles esperando revisión.</p> : <div className="divide-y divide-border">{(moderation.data ?? []).filter(row => row.moderation_status === "pending").map(row => <div key={row.user_id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-center"><div><p className="font-medium">{row.display_name}</p><p className="text-xs text-muted-foreground">nerqia.app/influencer/{row.public_slug}</p></div><p className="text-sm">{[row.category, row.city, row.country_code].filter(Boolean).join(" · ")}</p><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Rechazar" onClick={() => { setRejecting(row); setRejectReason(""); }}><X className="h-4 w-4 text-destructive" /></Button><Button size="sm" onClick={() => void moderate(row, "approved")} disabled={moderating === row.user_id}><Check className="mr-2 h-4 w-4" />Aprobar</Button></div></div>)}</div>}
          </section>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/20 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-4">Marca</th>
                  <th className="p-4">Creador</th>
                  <th className="p-4">Datos de cobro</th>
                  <th className="p-4">Fecha</th>
                  <th className="p-4 text-right">Monto</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4 text-right">Ir a la marca</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(w => (
                  <tr key={w.id} className="hover:bg-muted/10">
                    <td className="p-4 font-medium">{orgNames.data?.get(w.org_id) ?? "Organización"}</td>
                    <td className="p-4">{creators.data?.find(c => c.id === w.influencer_id)?.name ?? "Creador"}</td>
                    <td className="p-4 text-xs text-muted-foreground max-w-[220px] break-words">{w.notes || "Sin datos"}</td>
                    <td className="p-4 text-xs">{fmtDate(w.created_at)}</td>
                    <td className="p-4 text-right font-semibold tabular-nums">{money(Number(w.amount_ars))}</td>
                    <td className="p-4"><Badge variant={w.status === "paid" ? "default" : w.status === "rejected" ? "destructive" : "outline"}>{WITHDRAWAL_STATES[w.status] ?? w.status}</Badge></td>
                    <td className="p-4 text-right">
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate("/influencer-marketing/pagos?vista=retiros")}>
                        Ver pagos <ArrowRight className="ml-1 h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Sin solicitudes de retiro todavía.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog open={Boolean(rejecting)} onOpenChange={open => { if (!open && !moderating) setRejecting(null); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Solicitar cambios</DialogTitle><DialogDescription>El perfil dejará de estar visible hasta que el creador corrija y vuelva a enviarlo.</DialogDescription></DialogHeader><div className="grid gap-2"><Label htmlFor="creator-reject-reason">Motivo</Label><Textarea id="creator-reject-reason" value={rejectReason} onChange={event => setRejectReason(event.target.value)} placeholder="Explicá qué debe corregir" /></div><DialogFooter><Button variant="outline" onClick={() => setRejecting(null)}>Cancelar</Button><Button variant="destructive" disabled={!rejecting || rejectReason.trim().length < 3 || Boolean(moderating)} onClick={() => rejecting && void moderate(rejecting, "rejected", rejectReason.trim())}>Solicitar cambios</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
