import { useState } from "react";
import { useOrg } from "@/lib/orgContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, ScrollText } from "lucide-react";
import WorkspaceState from "@/components/shared/WorkspaceState";

const money = (v: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);

interface PolicyRow {
  id: string;
  version: number;
  category: string | null;
  cost_center: string | null;
  max_amount_ars: number;
  approver_role: string;
  active: boolean;
  created_at: string;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });

export function useActiveRole() {
  const { activeRole } = useOrg();
  return activeRole;
}

export default function FinancePolicyPanel() {
  const { activeOrg, activeRole } = useOrg();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [approverRole, setApproverRole] = useState<"admin" | "owner">("owner");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const esOwner = activeRole === "owner";

  const policies = useQuery({
    queryKey: ["finance-approval-policies", activeOrg?.id],
    enabled: Boolean(activeOrg?.id),
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("finance_list_approval_policies", {
        p_org_id: activeOrg!.id,
      });
      if (error) throw error;
      return (data ?? []) as PolicyRow[];
    },
  });

  const guardar = async () => {
    if (!activeOrg || !maxAmount || Number(maxAmount) <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await (supabase as any).rpc("finance_set_approval_policy", {
        p_org_id: activeOrg.id,
        p_category: category.trim() || null,
        p_cost_center: costCenter.trim() || null,
        p_max_amount_ars: Number(maxAmount),
        p_approver_role: approverRole,
      });
      if (rpcError) throw rpcError;
      setNotice(`Política v${policies.data?.[0]?.version ? policies.data[0].version + 1 : 1} guardada: la próxima versión queda activa`);
      setCategory("");
      setCostCenter("");
      setMaxAmount("");
      void policies.refetch();
      void queryClient.invalidateQueries({ queryKey: ["finance-approval-policies"] });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const activas = (policies.data ?? []).filter((p) => p.active);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-display font-bold">Política de aprobación (F5.2)</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Define quién aprueba cada gasto según monto y categoría. La versión más específica que cubra el monto es la que rige; las solicitudes en USD exigen al owner.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!activeOrg ? (
          <WorkspaceState kind="initial-loading" title="Cargando organización…" />
        ) : policies.isPending ? (
          <WorkspaceState kind="initial-loading" title="Cargando política vigente…" />
        ) : policies.isError ? (
          <WorkspaceState kind="error-recoverable" title="No pudimos cargar la política" actionLabel="Reintentar" onAction={() => void policies.refetch()} />
        ) : (
          <>
            {activas.length === 0 ? (
              <p className="text-xs rounded-md bg-muted/40 p-3 text-muted-foreground">
                Sin política definida: aprueban owner y admin (o quien tenga permiso de edición de gastos) con el comportamiento previo. Creá la primera versión para activar el escalamiento.
              </p>
            ) : (
              <div className="space-y-2">
                {activas.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                    <div>
                      <p className="font-medium">
                        Hasta {money(Number(p.max_amount_ars))} · aprueba {p.approver_role === "owner" ? "el owner" : "admin u owner"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Alcance: {p.category ? `categoría ${p.category}` : "todas las categorías"} · {p.cost_center ? `centro ${p.cost_center}` : "todos los centros"} · v{p.version}
                      </p>
                    </div>
                    <Badge variant="secondary">vigente</Badge>
                  </div>
                ))}
              </div>
            )}

            {activeRole === "owner" ? (
              <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="policy-category">Categoría (vacía = todas)</Label>
                  <Input id="policy-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej. marketing" className="h-8 text-sm" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="policy-center">Centro de costo (vacío = todos)</Label>
                  <Input id="policy-center" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="Ej. sucursal centro" className="h-8 text-sm" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="policy-max">Tope ARS</Label>
                  <Input id="policy-max" type="number" min="0.01" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="50000" className="h-8 text-sm" />
                </div>
                <div className="grid gap-2">
                  <Label>Rol mínimo que aprueba</Label>
                  <Select value={approverRole} onValueChange={(v) => setApproverRole(v as "admin" | "owner")}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
                <div className="sm:col-span-2">
                  <Button size="sm" onClick={guardar} disabled={saving || !maxAmount || Number(maxAmount) <= 0}>
                    {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-2 h-3.5 w-3.5" />}
                    Guardar nueva versión
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sólo el dueño define la política de aprobación.</p>
            )}

            {(policies.data ?? []).some((p) => !p.active) && (
              <details className="text-xs text-muted-foreground">
                <summary className="flex cursor-pointer items-center gap-1 font-medium">
                  <ScrollText className="h-3 w-3" /> Historial de versiones ({(policies.data ?? []).filter((p) => !p.active).length})
                </summary>
                <div className="mt-2 space-y-1">
                  {(policies.data ?? []).filter((p) => !p.active).map((p) => (
                    <p key={p.id}>
                      v{p.version} · {money(Number(p.max_amount_ars))} · {p.approver_role} · {fmtDate(p.created_at)} · inactiva
                    </p>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}