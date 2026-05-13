import { useState, useEffect, useMemo } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getSettingsDB, formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, Plus, Copy, Check, TrendingUp, Gift, Settings2, ToggleLeft, ToggleRight, FileSpreadsheet } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";

type Referral = {
  id: string;
  referrer_name: string;
  referred_name: string;
  referral_code: string;
  bonus_ars: number;
  bonus_points: number;
  status: "pending" | "credited" | "cancelled";
  created_at: string;
};

type ReferralSettings = {
  referral_enabled: boolean;
  referral_bonus_ars: number;
  referral_bonus_points: number;
};

function generateCode(name: string): string {
  const base = name.split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${base}${rand}`;
}

export default function ReferralsPage() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [settings, setSettings] = useState<ReferralSettings>({ referral_enabled: false, referral_bonus_ars: 500, referral_bonus_points: 5 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [referrer, setReferrer] = useState("");
  const [referred, setReferred] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!activeOrg || !user) return;
    setLoading(true);
    const [{ data: refs }, sett] = await Promise.all([
      supabase.from("customer_referrals").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
      getSettingsDB(user.id),
    ]);
    setReferrals((refs || []) as Referral[]);
    setSettings({
      referral_enabled: sett?.referral_enabled ?? false,
      referral_bonus_ars: sett?.referral_bonus_ars ?? 500,
      referral_bonus_points: sett?.referral_bonus_points ?? 5,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg, user]);

  const saveSettings = async (updates: Partial<ReferralSettings>) => {
    if (!activeOrg) return;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await supabase.from("settings").update(updates).eq("org_id", activeOrg.id);
    toast.success("Configuración guardada");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!referrer.trim() || !referred.trim()) { toast.error("Completá referidor y referido"); return; }
    if (!activeOrg) return;
    setSaving(true);
    try {
      const finalCode = code.trim() || generateCode(referrer);
      const { error } = await supabase.from("customer_referrals").insert({
        org_id: activeOrg.id,
        referrer_name: referrer.trim(),
        referred_name: referred.trim(),
        referral_code: finalCode,
        bonus_ars: settings.referral_bonus_ars,
        bonus_points: settings.referral_bonus_points,
        status: "pending",
      });
      if (error) throw error;
      toast.success("Referido registrado");
      setReferrer(""); setReferred(""); setCode("");
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error al registrar referido");
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: Referral["status"]) => {
    await supabase.from("customer_referrals").update({ status }).eq("id", id);
    await load();
    toast.success(status === "credited" ? "Bono acreditado" : "Cancelado");
  };

  const copyCode = (ref: Referral) => {
    navigator.clipboard.writeText(ref.referral_code);
    setCopiedId(ref.id);
    toast.success("Código copiado");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const stats = useMemo(() => ({
    total: referrals.length,
    credited: referrals.filter(r => r.status === "credited").length,
    pending: referrals.filter(r => r.status === "pending").length,
    totalBonusARS: referrals.filter(r => r.status === "credited").reduce((s, r) => s + Number(r.bonus_ars), 0),
  }), [referrals]);

  const topReferrers = useMemo(() => {
    const map: Record<string, number> = {};
    referrals.filter(r => r.status === "credited").forEach(r => {
      map[r.referrer_name] = (map[r.referrer_name] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [referrals]);

  const STATUS_STYLES: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    credited: "bg-success/15 text-success",
    cancelled: "bg-muted text-muted-foreground",
  };
  const STATUS_LABELS: Record<string, string> = { pending: "Pendiente", credited: "Acreditado", cancelled: "Cancelado" };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Programa de Referidos"
        description="Incentivá a tus clientes a traer nuevos compradores"
        badge={settings.referral_enabled ? { label: "Activo", variant: "success" } : { label: "Inactivo", variant: "default" }}
        actions={
          <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" />Registrar referido
          </Button>
        }
      />

      {/* Settings panel */}
      <div className="mb-6 bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2"><Settings2 className="w-4 h-4 text-primary" />Configuración del programa</h2>
          <button
            onClick={() => saveSettings({ referral_enabled: !settings.referral_enabled })}
            className="flex items-center gap-2 text-sm"
          >
            {settings.referral_enabled
              ? <><ToggleRight className="w-6 h-6 text-success" /><span className="text-success font-medium">Activo</span></>
              : <><ToggleLeft className="w-6 h-6 text-muted-foreground" /><span className="text-muted-foreground">Inactivo</span></>}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Bono ARS por referido exitoso</label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                value={settings.referral_bonus_ars}
                onChange={e => setSettings(s => ({ ...s, referral_bonus_ars: Number(e.target.value) }))}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={() => saveSettings({ referral_bonus_ars: settings.referral_bonus_ars })}>
                <Check className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Puntos de fidelidad por referido</label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                value={settings.referral_bonus_points}
                onChange={e => setSettings(s => ({ ...s, referral_bonus_points: Number(e.target.value) }))}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={() => saveSettings({ referral_bonus_points: settings.referral_bonus_points })}>
                <Check className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total referidos", value: stats.total, icon: Users, color: "text-primary" },
          { label: "Acreditados", value: stats.credited, icon: Check, color: "text-success" },
          { label: "Pendientes", value: stats.pending, icon: Gift, color: "text-warning" },
          { label: "Bonos entregados", value: formatARS(stats.totalBonusARS), icon: TrendingUp, color: "text-primary" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</span>
            </div>
            <p className="text-xl font-bold">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top referrers */}
        {topReferrers.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />Top referidores</h3>
            <div className="space-y-2">
              {topReferrers.map(([name, count], i) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-yellow-500/20 text-yellow-400" : i === 1 ? "bg-muted text-muted-foreground" : "bg-muted/50 text-muted-foreground"}`}>
                      {i + 1}
                    </span>
                    <span className="truncate max-w-[120px]">{name}</span>
                  </div>
                  <span className="font-mono text-xs">{count} ref.</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Referrals list */}
        <div className={`bg-card border border-border rounded-xl overflow-hidden ${topReferrers.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{referrals.length} referidos</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
              const bom = '﻿';
              const headers = ['Fecha', 'Referidor', 'Nuevo cliente', 'Código', 'Estado', 'Bono ARS', 'Puntos'];
              const rows = referrals.map(r => [
                new Date(r.created_at).toLocaleDateString('es-AR'),
                r.referrer_name,
                r.referred_name,
                r.referral_code,
                STATUS_LABELS[r.status] || r.status,
                Number(r.bonus_ars).toFixed(2),
                r.bonus_points,
              ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
              const csv = bom + [headers.join(','), ...rows].join('\n');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
              a.download = `referidos-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              toast.success('Referidos exportados');
            }}>
              <FileSpreadsheet className="w-3 h-3 mr-1" />CSV
            </Button>
          </div>
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Cargando…</div>
          ) : referrals.length === 0 ? (
            <div className="p-8 text-center">
              <Gift className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
              <p className="text-muted-foreground text-sm">Sin referidos registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Referidor</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Nuevo cliente</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Código</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Estado</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Bono</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((ref) => (
                    <tr key={ref.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2.5 font-medium">{ref.referrer_name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{ref.referred_name}</td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => copyCode(ref)}
                          className="flex items-center gap-1 font-mono bg-muted/50 hover:bg-muted rounded px-1.5 py-0.5 transition-colors"
                        >
                          {ref.referral_code}
                          {copiedId === ref.id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[ref.status]}`}>
                          {STATUS_LABELS[ref.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono">{formatARS(ref.bonus_ars)}</td>
                      <td className="px-3 py-2.5">
                        {ref.status === "pending" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => updateStatus(ref.id, "credited")}>Acreditar</Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-destructive" onClick={() => updateStatus(ref.id, "cancelled")}>✕</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Registrar referido</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Cliente que refirió *</label>
              <Input value={referrer} onChange={e => { setReferrer(e.target.value); if (!code) setCode(generateCode(e.target.value)); }} placeholder="Nombre del cliente referidor" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nuevo cliente *</label>
              <Input value={referred} onChange={e => setReferred(e.target.value)} placeholder="Nombre del nuevo cliente" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Código de referido (auto-generado)</label>
              <Input value={code} onChange={e => setCode(e.target.value)} placeholder="Ej: juan1234" className="font-mono" />
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
              Bono automático: <strong className="text-foreground">{formatARS(settings.referral_bonus_ars)}</strong> + <strong className="text-foreground">{settings.referral_bonus_points} puntos</strong> al acreditar
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
                {saving ? "Guardando…" : "Registrar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
