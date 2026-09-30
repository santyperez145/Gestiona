import { useState, useEffect, useMemo } from "react";
import { roleLabel } from "@/lib/roleLabels";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { calcMonthPeriod } from "@/lib/businessCalc";
import {
  configureSellerCommission,
  generateSellerCommission,
  settleSellerCommission,
} from "@/lib/sellerCommissionsDB";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, DollarSign, Check, TrendingUp, Percent, Plus, Settings, FileSpreadsheet,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

type SellerMember = {
  user_id: string;
  role: string;
  commission_percent: number;
  commission_enabled: boolean;
  profile?: { full_name?: string; email?: string };
};

type SellerPayout = {
  id: string;
  user_id: string;
  seller_name: string;
  period_start: string;
  period_end: string;
  sales_total_ars: number;
  commission_percent: number;
  commission_ars: number;
  status: "pending" | "paid";
  paid_at: string | null;
  payment_reference: string | null;
  payment_method: string | null;
  expense_id: string | null;
  ledger_entry_id: string | null;
  notes: string | null;
};

const MONTHS: string[] = [];
const now = new Date();
for (let i = -6; i <= 0; i++) {
  const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
  MONTHS.push(d.toISOString().slice(0, 7));
}

export default function SellerCommissionsPage() {
  usePageTitle("Comisiones");
  const { activeOrg } = useOrg();
  const [members, setMembers] = useState<SellerMember[]>([]);
  const [payouts, setPayouts] = useState<SellerPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(now.toISOString().slice(0, 7));
  const [showConfig, setShowConfig] = useState(false);
  const [configMember, setConfigMember] = useState<SellerMember | null>(null);
  const [configPercent, setConfigPercent] = useState("10");
  const [configEnabled, setConfigEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState<SellerPayout | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("transferencia");

  const humanError = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return message.replace(/^.*?:\s*/, "").replace(/_/g, " ").trim() || fallback;
  };

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: mems }, { data: pays }, { data: profiles }] = await Promise.all([
      supabase.from("memberships").select("user_id, role, commission_percent, commission_enabled").eq("org_id", activeOrg.id),
      supabase.from("seller_payouts").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("profiles").select("user_id, full_name:display_name"),
    ]);

    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p: any) => { profileMap[p.user_id] = p; });

    setMembers((mems || []).map(m => ({ ...m, profile: profileMap[m.user_id] })));
    setPayouts((pays || []) as SellerPayout[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const openConfig = (m: SellerMember) => {
    setConfigMember(m);
    setConfigPercent(String(m.commission_percent || 10));
    setConfigEnabled(m.commission_enabled !== false);
    setShowConfig(true);
  };

  const saveConfig = async () => {
    if (!configMember || !activeOrg) return;
    setSaving(true);
    try {
      await configureSellerCommission({
        orgId: activeOrg.id,
        userId: configMember.user_id,
        enabled: configEnabled,
        percent: Number(configPercent),
      });
      toast.success("Comisión actualizada");
      setShowConfig(false);
      await load();
    } catch (error) {
      toast.error(humanError(error, "No pudimos guardar la configuración"));
    } finally {
      setSaving(false);
    }
  };

  const generatePayout = async (member: SellerMember) => {
    if (!activeOrg || !member.commission_enabled || !member.commission_percent) return;
    setGenerating(true);
    try {
      const { periodStart, periodEnd } = calcMonthPeriod(selectedPeriod);

      const payout = await generateSellerCommission({
        orgId: activeOrg.id,
        userId: member.user_id,
        periodStart,
        periodEnd,
      });
      toast.success(`Liquidación calculada: ${formatARS(Number(payout.commission_ars))} para ${payout.seller_name}`);
      await load();
    } catch (error) {
      toast.error(humanError(error, "No pudimos calcular la liquidación"));
    } finally {
      setGenerating(false);
    }
  };

  const openPayment = (payout: SellerPayout) => {
    setPaying(payout);
    setPaymentReference("");
    setPaymentMethod("transferencia");
  };

  const confirmPayment = async () => {
    if (!paying || paymentReference.trim().length < 3) return;
    setSaving(true);
    try {
      await settleSellerCommission({
        payoutId: paying.id,
        paymentReference: paymentReference.trim(),
        paymentMethod,
      });
      toast.success("Pago confirmado y registrado en Finance");
      setPaying(null);
      await load();
    } catch (error) {
      toast.error(humanError(error, "No pudimos confirmar el pago"));
    } finally {
      setSaving(false);
    }
  };

  const activeMembers = members.filter(m => m.role !== "viewer");
  const pendingPayouts = payouts.filter(p => p.status === "pending");
  const pendingTotal = pendingPayouts.reduce((s, p) => s + Number(p.commission_ars), 0);

  const periodPayouts = useMemo(() => {
    return payouts.filter(p => p.period_start.slice(0, 7) === selectedPeriod);
  }, [payouts, selectedPeriod]);

  const sellerName = (m: SellerMember) => m.profile?.full_name || m.profile?.email || m.user_id.slice(0, 8);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Users}
        title="Comisiones de Vendedores"
        description="Configurá y liquidá comisiones por ventas de tu equipo"
        badge={pendingTotal > 0 ? { label: `${formatARS(pendingTotal)} pendiente`, variant: "warning" } : undefined}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KPICard label="Vendedores activos" value={activeMembers.filter(m => m.commission_enabled).length} icon={Users} color="primary"
          sub="con comisión configurada" />
        <KPICard label="Comisiones pendientes" value={formatARS(pendingTotal)} icon={DollarSign}
          color={pendingTotal > 0 ? "warning" : "success"} sub={`${pendingPayouts.length} liquidaciones`} />
        <KPICard label="Total liquidado" value={formatARS(payouts.filter(p => p.status === "paid").reduce((s, p) => s + Number(p.commission_ars), 0))} icon={TrendingUp} color="success" sub="histórico" />
      </div>

      {/* Team commission config */}
      <div className="bg-card border border-border/60 rounded-xl p-5">
        <h2 className="font-semibold text-sm mb-4 flex items-center gap-2"><Settings className="w-4 h-4 text-primary" />Equipo y comisiones</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : activeMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin miembros en el equipo.</p>
        ) : (
          <div className="space-y-2">
            {activeMembers.map(m => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border/40">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{sellerName(m)}</p>
                  <p className="text-xs text-muted-foreground">{roleLabel(m.role)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {m.commission_enabled ? (
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                      <Percent className="w-3 h-3" />{m.commission_percent}%
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin comisión</span>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openConfig(m)}>
                    Configurar
                  </Button>
                  {m.commission_enabled && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
                      onClick={() => generatePayout(m)}
                      disabled={generating}
                    >
                      <Plus className="w-3 h-3 mr-1" />Liquidar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Period selector + liquidations */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium">Liquidaciones de</span>
        <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
          <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map(m => (
              <SelectItem key={m} value={m}>
                {new Date(m + "-01").toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{periodPayouts.length} liquidaciones</span>
        <Button variant="outline" size="sm" onClick={() => {
          const bom = '﻿';
          const headers = ['Vendedor', 'Período inicio', 'Período fin', 'Ventas ARS', 'Comisión %', 'Comisión ARS', 'Estado', 'Pagada el'];
          const rows = periodPayouts.map(p => [
            p.seller_name,
            p.period_start,
            p.period_end,
            Number(p.sales_total_ars).toFixed(2),
            p.commission_percent,
            Number(p.commission_ars).toFixed(2),
            p.status === 'paid' ? 'Pagada' : 'Pendiente',
            p.paid_at ? new Date(p.paid_at).toLocaleDateString('es-AR') : '',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
          const csv = bom + [headers.join(','), ...rows].join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
          a.download = `comisiones-${selectedPeriod}.csv`;
          a.click();
          toast.success('Liquidaciones exportadas');
        }}>
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />CSV
        </Button>
      </div>

      {periodPayouts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Sin liquidaciones para este período
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm table-compact-mobile">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Vendedor</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Período</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Ventas</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">%</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Comisión</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Estado</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {periodPayouts.map(p => (
                <tr key={p.id} className="border-b border-border/40 hover:bg-muted/20">
                  <td className="px-3 py-2.5 font-medium text-xs">{p.seller_name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(p.period_start + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} –{" "}
                    {new Date(p.period_end + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{formatARS(Number(p.sales_total_ars))}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.commission_percent}%</td>
                  <td className="px-3 py-2.5 font-mono font-semibold text-xs text-primary">{formatARS(Number(p.commission_ars))}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 font-semibold ${p.status === "paid" ? "bg-emerald-500/15 text-emerald-400" : "bg-yellow-500/15 text-yellow-400"}`}>
                      {p.status === "paid" ? <><Check className="w-2.5 h-2.5" />Pagada</> : "Pendiente"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.status === "pending" && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => openPayment(p)}>
                        <Check className="w-3 h-3 mr-1" />Confirmar pago
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Config dialog */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="bg-card border-border/60 max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Configurar comisión</DialogTitle>
          </DialogHeader>
          {configMember && (
            <div className="space-y-4">
              <p className="text-sm font-medium">{sellerName(configMember)}</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={configEnabled} onChange={e => setConfigEnabled(e.target.checked)} className="rounded" />
                <span className="text-sm">Habilitar comisión para este vendedor</span>
              </label>
              {configEnabled && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Porcentaje de comisión (%)</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={configPercent}
                    onChange={e => setConfigPercent(e.target.value)}
                    placeholder="10"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Se aplica sobre el total de ventas del período</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button className="flex-1 gradient-gold text-primary-foreground font-semibold" onClick={saveConfig} disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="outline" onClick={() => setShowConfig(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paying)} onOpenChange={open => !open && setPaying(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar pago de comisión</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Confirmá únicamente después de realizar la transferencia. Nerqia registrará el gasto y su asiento contable con esta evidencia.
            </p>
            {paying && (
              <div className="rounded-[8px] border border-border/70 bg-muted/30 p-3 text-sm">
                <span className="font-medium">{paying.seller_name}</span>
                <span className="float-right font-mono font-semibold">{formatARS(Number(paying.commission_ars))}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="seller-payment-method">Medio de pago</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="seller-payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia bancaria</SelectItem>
                  <SelectItem value="mercadopago">Mercado Pago</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="otro">Otro medio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seller-payment-reference">Referencia o comprobante</Label>
              <Input
                id="seller-payment-reference"
                value={paymentReference}
                onChange={event => setPaymentReference(event.target.value)}
                placeholder="Número de operación"
                maxLength={160}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPaying(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={confirmPayment} disabled={saving || paymentReference.trim().length < 3}>
              {saving ? "Confirmando…" : "Confirmar pago"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
