import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: mems }, { data: pays }, { data: profiles }] = await Promise.all([
      supabase.from("memberships").select("user_id, role, commission_percent, commission_enabled").eq("org_id", activeOrg.id),
      supabase.from("seller_payouts").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("profiles").select("user_id, full_name, email"),
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
    const { error } = await supabase
      .from("memberships")
      .update({ commission_percent: Number(configPercent), commission_enabled: configEnabled })
      .eq("user_id", configMember.user_id)
      .eq("org_id", activeOrg.id);
    setSaving(false);
    if (error) { toast.error("Error al guardar configuración"); return; }
    toast.success("Comisión actualizada");
    setShowConfig(false);
    await load();
  };

  const generatePayout = async (member: SellerMember) => {
    if (!activeOrg || !member.commission_enabled || !member.commission_percent) return;
    setGenerating(true);
    try {
      const [year, month] = selectedPeriod.split("-").map(Number);
      const periodStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
      const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);

      // Get sales for this seller in the period
      const { data: sales } = await supabase
        .from("sales")
        .select("total_ars")
        .eq("org_id", activeOrg.id)
        .eq("user_id", member.user_id)
        .gte("date", `${periodStart}T00:00:00`)
        .lte("date", `${periodEnd}T23:59:59`);

      const salesTotal = (sales || []).reduce((s, r) => s + Number(r.total_ars || 0), 0);
      const commissionARS = Math.round(salesTotal * (member.commission_percent / 100));

      if (salesTotal === 0) { toast.error("Sin ventas registradas para este vendedor en el período"); return; }

      const sellerName = member.profile?.full_name || member.profile?.email || member.user_id.slice(0, 8);

      const { error } = await supabase.from("seller_payouts").insert({
        org_id: activeOrg.id,
        user_id: member.user_id,
        seller_name: sellerName,
        period_start: periodStart,
        period_end: periodEnd,
        sales_total_ars: salesTotal,
        commission_percent: member.commission_percent,
        commission_ars: commissionARS,
        status: "pending",
      });

      if (error) throw error;
      toast.success(`Liquidación generada: ${formatARS(commissionARS)} para ${sellerName}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error al generar liquidación");
    } finally {
      setGenerating(false);
    }
  };

  const markPaid = async (payout: SellerPayout) => {
    await supabase.from("seller_payouts").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payout.id);
    await load();
    toast.success("Liquidación marcada como pagada");
  };

  const activeMembers = members.filter(m => m.role !== "viewer");
  const pendingPayouts = payouts.filter(p => p.status === "pending");
  const pendingTotal = pendingPayouts.reduce((s, p) => s + Number(p.commission_ars), 0);

  const periodPayouts = useMemo(() => {
    return payouts.filter(p => p.period_start.slice(0, 7) === selectedPeriod);
  }, [payouts, selectedPeriod]);

  const sellerName = (m: SellerMember) => m.profile?.full_name || m.profile?.email || m.user_id.slice(0, 8);

  return (
    <div className="space-y-6">
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
      <div className="bg-card border border-border/60 rounded-xl p-5 mb-6">
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
                  <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
                </div>
                <div className="flex items-center gap-3">
                  {m.commission_enabled ? (
                    <span className="text-xs font-semibold text-success flex items-center gap-1">
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
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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
                    <span className={`inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 font-semibold ${p.status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                      {p.status === "paid" ? <><Check className="w-2.5 h-2.5" />Pagada</> : "Pendiente"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.status === "pending" && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => markPaid(p)}>
                        <Check className="w-3 h-3 mr-1" />Pagar
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
    </div>
  );
}
