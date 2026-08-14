import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Star, Gift, Crown, Users, TrendingUp, Plus, Pencil, Trash2,
  Award, Coins, ArrowUpRight, ArrowDownRight, RefreshCcw, ChevronRight,
  ShoppingBag, Zap, Trophy, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import LoyaltyPointsTab from "@/components/loyalty/LoyaltyPointsTab";

/* ─────────────────────────── types ─────────────────────────── */
interface LoyaltyProgram {
  id: string;
  name: string;
  description: string | null;
  points_per_peso: number;
  min_redemption: number;
  expiry_days: number | null;
  is_active: boolean;
  terms: string | null;
}

interface LoyaltyTier {
  id: string;
  name: string;
  min_points: number;
  max_points: number | null;
  multiplier: number;
  color: string;
  icon: string;
  benefits: string[] | null;
  sort_order: number;
}

interface LoyaltyReward {
  id: string;
  name: string;
  description: string | null;
  reward_type: string;
  points_cost: number;
  discount_value: number | null;
  stock_limit: number | null;
  redeemed_count: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
}

interface LoyaltyMember {
  id: string;
  customer_id: string;
  current_points: number;
  lifetime_points: number;
  tier_id: string | null;
  enrolled_at: string;
  last_activity: string | null;
  customers: { name: string; email: string | null } | null;
  loyalty_tiers: { name: string; color: string; icon: string } | null;
}

interface LoyaltyTransaction {
  id: string;
  member_id: string;
  transaction_type: string;
  points: number;
  balance_after: number;
  description: string;
  created_at: string;
  loyalty_members: { customers: { name: string } | null } | null;
}

/* ─────────────────────────── configs ─────────────────────────── */
const REWARD_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  discount_pct:   { label: "Descuento %",      icon: <Zap className="w-4 h-4" />,        color: "bg-yellow-500/15 text-yellow-400" },
  discount_fixed: { label: "Descuento $",       icon: <Coins className="w-4 h-4" />,      color: "bg-emerald-500/15 text-emerald-400" },
  free_product:   { label: "Producto gratis",   icon: <Gift className="w-4 h-4" />,       color: "bg-purple-500/15 text-purple-400" },
  gift_card:      { label: "Gift Card",         icon: <ShoppingBag className="w-4 h-4" />,color: "bg-blue-500/15 text-blue-400" },
  experience:     { label: "Experiencia",       icon: <Trophy className="w-4 h-4" />,     color: "bg-pink-500/15 text-pink-400" },
  other:          { label: "Otro",              icon: <Award className="w-4 h-4" />,      color: "bg-muted/40 text-muted-foreground" },
};

const TXN_TYPE_CONFIG: Record<string, { label: string; color: string; sign: string }> = {
  earn:    { label: "Acumulado", color: "text-green-600",  sign: "+" },
  redeem:  { label: "Canje",     color: "text-orange-500", sign: "-" },
  adjust:  { label: "Ajuste",    color: "text-blue-600",   sign: "±" },
  expire:  { label: "Expiró",    color: "text-red-500",    sign: "-" },
  bonus:   { label: "Bonus",     color: "text-purple-600", sign: "+" },
};

const TABS = ["Puntos", "Programa", "Tiers", "Recompensas", "Miembros", "Transacciones"] as const;
type Tab = typeof TABS[number];

/* ─────────────────────────── default tiers seed ─────────────────────────── */
const DEFAULT_TIERS = [
  { name: "Bronce",    min_points: 0,    max_points: 999,    multiplier: 1.0, color: "#92400e", icon: "🥉" },
  { name: "Plata",     min_points: 1000, max_points: 4999,   multiplier: 1.5, color: "#6b7280", icon: "🥈" },
  { name: "Oro",       min_points: 5000, max_points: 14999,  multiplier: 2.0, color: "#d97706", icon: "🥇" },
  { name: "Platino",   min_points: 15000,max_points: null,   multiplier: 3.0, color: "#7c3aed", icon: "💎" },
];

export default function LoyaltyAdvancedPage() {
  usePageTitle("Fidelidad");
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = usePersistedState<Tab>(
    orgViewKey("loyalty.tab", orgId),
    "Puntos",
  );
  const [program, setProgram] = useState<LoyaltyProgram | null>(null);
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [members, setMembers] = useState<LoyaltyMember[]>([]);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  /* dialogs */
  const [showTierDialog, setShowTierDialog] = useState(false);
  const [showRewardDialog, setShowRewardDialog] = useState(false);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [editingTier, setEditingTier] = useState<LoyaltyTier | null>(null);
  const [editingReward, setEditingReward] = useState<LoyaltyReward | null>(null);
  const [selectedMember, setSelectedMember] = useState<LoyaltyMember | null>(null);

  /* forms */
  const [progForm, setProgForm] = useState({ name: "", description: "", points_per_peso: "1", min_redemption: "100", expiry_days: "", is_active: true, terms: "" });
  const [tierForm, setTierForm] = useState({ name: "", min_points: "0", max_points: "", multiplier: "1", color: "#3b82f6", icon: "⭐", benefits: "" });
  const [rewardForm, setRewardForm] = useState({ name: "", description: "", reward_type: "discount_pct", points_cost: "", discount_value: "", stock_limit: "", is_active: true, valid_from: "", valid_to: "" });
  const [adjustForm, setAdjustForm] = useState({ transaction_type: "adjust", points: "", description: "" });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [pr, tr, rr, mr, txr] = await Promise.allSettled([
      supabase.from("loyalty_programs").select("*").eq("org_id", orgId).single(),
      supabase.from("loyalty_tiers").select("*").eq("org_id", orgId).order("min_points"),
      supabase.from("loyalty_rewards").select("*").eq("org_id", orgId).order("points_cost"),
      supabase.from("loyalty_members").select("*, customers(name,email), loyalty_tiers(name,color,icon)").eq("org_id", orgId).order("current_points", { ascending: false }),
      supabase.from("loyalty_transactions").select("*, loyalty_members(customers(name))").eq("org_id", orgId).order("created_at", { ascending: false }).limit(100),
    ]);
    if (pr.status === "fulfilled" && pr.value.data) {
      const p = pr.value.data as LoyaltyProgram;
      setProgram(p);
      setProgForm({ name: p.name, description: p.description ?? "", points_per_peso: String(p.points_per_peso), min_redemption: String(p.min_redemption), expiry_days: p.expiry_days ? String(p.expiry_days) : "", is_active: p.is_active, terms: p.terms ?? "" });
    }
    if (tr.status === "fulfilled" && tr.value.data) setTiers(tr.value.data as LoyaltyTier[]);
    if (rr.status === "fulfilled" && rr.value.data) setRewards(rr.value.data as LoyaltyReward[]);
    if (mr.status === "fulfilled" && mr.value.data) setMembers(mr.value.data as LoyaltyMember[]);
    if (txr.status === "fulfilled" && txr.value.data) setTransactions(txr.value.data as LoyaltyTransaction[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  /* ── Program ── */
  async function saveProgram() {
    if (!orgId) return;
    const payload = {
      org_id: orgId, name: progForm.name, description: progForm.description || null,
      points_per_peso: parseFloat(progForm.points_per_peso) || 1,
      min_redemption: parseInt(progForm.min_redemption) || 100,
      expiry_days: progForm.expiry_days ? parseInt(progForm.expiry_days) : null,
      is_active: progForm.is_active, terms: progForm.terms || null,
    };
    const { error } = program
      ? await supabase.from("loyalty_programs").update(payload).eq("id", program.id)
      : await supabase.from("loyalty_programs").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Programa guardado");
    load();
  }

  async function seedTiers() {
    if (!orgId) return;
    const rows = DEFAULT_TIERS.map((t, i) => ({ ...t, org_id: orgId, sort_order: i }));
    const { error } = await supabase.from("loyalty_tiers").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success("Tiers cargados");
    load();
  }

  /* ── Tier CRUD ── */
  function openNewTier() {
    setEditingTier(null);
    setTierForm({ name: "", min_points: "0", max_points: "", multiplier: "1", color: "#3b82f6", icon: "⭐", benefits: "" });
    setShowTierDialog(true);
  }
  function openEditTier(t: LoyaltyTier) {
    setEditingTier(t);
    setTierForm({ name: t.name, min_points: String(t.min_points), max_points: t.max_points ? String(t.max_points) : "", multiplier: String(t.multiplier), color: t.color, icon: t.icon, benefits: (t.benefits ?? []).join(", ") });
    setShowTierDialog(true);
  }
  async function saveTier() {
    if (!orgId || !tierForm.name.trim()) return;
    const payload = {
      org_id: orgId, name: tierForm.name, min_points: parseInt(tierForm.min_points) || 0,
      max_points: tierForm.max_points ? parseInt(tierForm.max_points) : null,
      multiplier: parseFloat(tierForm.multiplier) || 1,
      color: tierForm.color, icon: tierForm.icon,
      benefits: tierForm.benefits ? tierForm.benefits.split(",").map(b => b.trim()).filter(Boolean) : null,
      sort_order: editingTier ? editingTier.sort_order : tiers.length,
    };
    if (editingTier) {
      const { error } = await supabase.from("loyalty_tiers").update(payload).eq("id", editingTier.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("loyalty_tiers").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Tier guardado");
    setShowTierDialog(false);
    load();
  }

  /* ── Reward CRUD ── */
  function openNewReward() {
    setEditingReward(null);
    setRewardForm({ name: "", description: "", reward_type: "discount_pct", points_cost: "", discount_value: "", stock_limit: "", is_active: true, valid_from: "", valid_to: "" });
    setShowRewardDialog(true);
  }
  function openEditReward(r: LoyaltyReward) {
    setEditingReward(r);
    setRewardForm({ name: r.name, description: r.description ?? "", reward_type: r.reward_type, points_cost: String(r.points_cost), discount_value: r.discount_value ? String(r.discount_value) : "", stock_limit: r.stock_limit ? String(r.stock_limit) : "", is_active: r.is_active, valid_from: r.valid_from ?? "", valid_to: r.valid_to ?? "" });
    setShowRewardDialog(true);
  }
  async function saveReward() {
    if (!orgId || !rewardForm.name.trim()) return;
    const payload = {
      org_id: orgId, name: rewardForm.name, description: rewardForm.description || null,
      reward_type: rewardForm.reward_type, points_cost: parseInt(rewardForm.points_cost) || 0,
      discount_value: rewardForm.discount_value ? parseFloat(rewardForm.discount_value) : null,
      stock_limit: rewardForm.stock_limit ? parseInt(rewardForm.stock_limit) : null,
      is_active: rewardForm.is_active,
      valid_from: rewardForm.valid_from || null, valid_to: rewardForm.valid_to || null,
    };
    if (editingReward) {
      const { error } = await supabase.from("loyalty_rewards").update(payload).eq("id", editingReward.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("loyalty_rewards").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Recompensa guardada");
    setShowRewardDialog(false);
    load();
  }

  /* ── Adjust points ── */
  async function applyAdjustment() {
    if (!orgId || !selectedMember) return;
    const pts = parseInt(adjustForm.points);
    if (!pts || !adjustForm.description.trim()) return;
    const isNeg = ["redeem","expire"].includes(adjustForm.transaction_type);
    const finalPts = isNeg ? -Math.abs(pts) : Math.abs(pts);
    const { error } = await supabase.from("loyalty_transactions").insert({
      org_id: orgId, member_id: selectedMember.id,
      transaction_type: adjustForm.transaction_type,
      points: finalPts,
      balance_after: selectedMember.current_points + finalPts,
      description: adjustForm.description,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Puntos ajustados");
    setShowAdjustDialog(false);
    load();
  }

  /* ── KPI stats ── */
  const totalMembers = members.length;
  const totalPointsOutstanding = members.reduce((s, m) => s + m.current_points, 0);
  const avgPoints = totalMembers > 0 ? Math.round(totalPointsOutstanding / totalMembers) : 0;
  const totalRedeemTxns = transactions.filter(t => t.transaction_type === "redeem").length;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Crown}
        title="Programa de Fidelidad"
        description="Puntos, tiers, recompensas y canjes avanzados"
        actions={
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs hover:bg-muted/50 transition-colors">
            <RefreshCcw className="w-3.5 h-3.5" /> Actualizar
          </button>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Miembros" value={totalMembers.toLocaleString("es-AR")} sub="en el programa" icon={Users} color="blue" />
        <KPICard label="Puntos vigentes" value={totalPointsOutstanding.toLocaleString("es-AR")} sub="puntos acumulados" icon={Coins} color="warning" />
        <KPICard label="Promedio / miembro" value={avgPoints.toLocaleString("es-AR")} sub="puntos por cliente" icon={TrendingUp} color="success" />
        <KPICard label="Canjes totales" value={totalRedeemTxns.toLocaleString("es-AR")} sub="redenciones históricas" icon={Gift} color="purple" />
      </div>

      {/* tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === t ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Puntos (clásico) — rendered independently of the advanced-program fetch ── */}
      {activeTab === "Puntos" && <LoyaltyPointsTab />}

      {activeTab !== "Puntos" && (loading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Cargando programa de fidelidad…</span>
        </div>
      ) : (
        <>
          {/* ── Programa ── */}
          {activeTab === "Programa" && (
            <div className="bg-card rounded-xl border border-border/50 p-6 max-w-xl space-y-4">
              <h2 className="font-semibold text-foreground flex items-center gap-2"><Star className="w-4 h-4 text-yellow-500" /> Configuración del Programa</h2>
              <div><Label>Nombre del programa</Label><Input value={progForm.name} onChange={e => setProgForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Descripción</Label><Input value={progForm.description} onChange={e => setProgForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Puntos por peso ($1 ARS)</Label><Input type="number" step="0.01" value={progForm.points_per_peso} onChange={e => setProgForm(p => ({ ...p, points_per_peso: e.target.value }))} /></div>
                <div><Label>Mínimo para canje (pts)</Label><Input type="number" value={progForm.min_redemption} onChange={e => setProgForm(p => ({ ...p, min_redemption: e.target.value }))} /></div>
              </div>
              <div><Label>Vencimiento de puntos (días, vacío = no expiran)</Label><Input type="number" value={progForm.expiry_days} onChange={e => setProgForm(p => ({ ...p, expiry_days: e.target.value }))} /></div>
              <div><Label>Términos y condiciones</Label><textarea rows={3} value={progForm.terms} onChange={e => setProgForm(p => ({ ...p, terms: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm resize-none" /></div>
              <div className="flex items-center gap-3">
                <Switch checked={progForm.is_active} onCheckedChange={v => setProgForm(p => ({ ...p, is_active: v }))} />
                <Label>Programa activo</Label>
              </div>
              <Button onClick={saveProgram}>{program ? "Guardar cambios" : "Crear programa"}</Button>
            </div>
          )}

          {/* ── Tiers ── */}
          {activeTab === "Tiers" && (
            <div className="space-y-4">
              <div className="flex justify-end gap-2">
                {tiers.length === 0 && <Button variant="outline" size="sm" onClick={seedTiers}><RefreshCcw className="w-4 h-4 mr-1" /> Cargar tiers default</Button>}
                <Button size="sm" onClick={openNewTier}><Plus className="w-4 h-4 mr-1" /> Nuevo Tier</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {tiers.map(t => {
                  const memberCount = members.filter(m => m.tier_id === t.id).length;
                  return (
                    <div key={t.id} className="bg-card rounded-xl border border-border/50 p-5 space-y-3 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl" style={{ backgroundColor: t.color }} />
                      <div className="pl-2 flex items-start justify-between">
                        <div>
                          <span className="text-2xl">{t.icon}</span>
                          <p className="font-bold text-foreground mt-1">{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.min_points.toLocaleString()} – {t.max_points ? t.max_points.toLocaleString() : "∞"} pts</p>
                        </div>
                        <button onClick={() => openEditTier(t)} className="text-muted-foreground/60 hover:text-muted-foreground"><Pencil className="w-4 h-4" /></button>
                      </div>
                      <div className="flex items-center gap-3 pl-2">
                        <div className="bg-muted/20 rounded px-3 py-1 text-sm font-semibold" style={{ color: t.color }}>×{t.multiplier}</div>
                        <span className="text-xs text-muted-foreground">{memberCount} miembros</span>
                      </div>
                      {t.benefits && t.benefits.length > 0 && (
                        <ul className="pl-2 space-y-0.5">
                          {t.benefits.map((b, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-center gap-1"><ChevronRight className="w-3 h-3" />{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
                {tiers.length === 0 && <p className="col-span-4 text-center py-12 text-muted-foreground/60">Sin tiers configurados</p>}
              </div>
            </div>
          )}

          {/* ── Recompensas ── */}
          {activeTab === "Recompensas" && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button size="sm" onClick={openNewReward}><Plus className="w-4 h-4 mr-1" /> Nueva Recompensa</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rewards.map(r => {
                  const cfg = REWARD_TYPE_CONFIG[r.reward_type] ?? REWARD_TYPE_CONFIG.other;
                  const remaining = r.stock_limit ? r.stock_limit - r.redeemed_count : null;
                  return (
                    <div key={r.id} className={`bg-card rounded-xl border border-border/50 p-4 space-y-2 ${!r.is_active ? "opacity-60" : ""}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`${cfg.color} p-1.5 rounded`}>{cfg.icon}</span>
                          <div>
                            <p className="font-semibold text-foreground">{r.name}</p>
                            <Badge className={`${cfg.color} text-xs mt-0.5`}>{cfg.label}</Badge>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => openEditReward(r)} className="p-1 rounded hover:bg-muted/40 text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => supabase.from("loyalty_rewards").delete().eq("id", r.id).then(load)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="font-bold text-yellow-600 flex items-center gap-1"><Coins className="w-3.5 h-3.5" />{r.points_cost.toLocaleString("es-AR")} pts</span>
                        {r.discount_value && <span className="text-muted-foreground">{r.reward_type === "discount_pct" ? `${r.discount_value}% off` : `$${r.discount_value}`}</span>}
                      </div>
                      {remaining !== null && (
                        <p className="text-xs text-muted-foreground">Stock: {remaining} restantes / {r.redeemed_count} canjeados</p>
                      )}
                      {r.valid_to && <p className="text-xs text-muted-foreground/60">Válido hasta: {r.valid_to}</p>}
                    </div>
                  );
                })}
                {rewards.length === 0 && <p className="col-span-3 text-center py-12 text-muted-foreground/60">Sin recompensas configuradas</p>}
              </div>
            </div>
          )}

          {/* ── Miembros ── */}
          {activeTab === "Miembros" && (
            <div className="bg-card rounded-xl border border-border/50 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    {["Cliente", "Tier", "Puntos actuales", "Puntos lifetime", "Últ. actividad", ""].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.map(m => {
                    const tier = m.loyalty_tiers;
                    return (
                      <tr key={m.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{m.customers?.name ?? "—"}</p>
                          <p className="text-xs text-muted-foreground/60">{m.customers?.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          {tier ? (
                            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: tier.color }}>
                              {tier.icon} {tier.name}
                            </span>
                          ) : <span className="text-muted-foreground/60 text-xs">Sin tier</span>}
                        </td>
                        <td className="px-4 py-3 font-semibold text-yellow-600">
                          <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5" />{m.current_points.toLocaleString("es-AR")}</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{m.lifetime_points.toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3 text-muted-foreground/60 text-xs">
                          {m.last_activity ? new Date(m.last_activity).toLocaleDateString("es-AR") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="outline" size="sm" onClick={() => { setSelectedMember(m); setAdjustForm({ transaction_type: "adjust", points: "", description: "" }); setShowAdjustDialog(true); }}>
                            Ajustar pts
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {members.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-12 text-muted-foreground/60">Sin miembros registrados</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Transacciones ── */}
          {activeTab === "Transacciones" && (
            <div className="bg-card rounded-xl border border-border/50 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    {["Fecha", "Cliente", "Tipo", "Puntos", "Saldo posterior", "Descripción"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transactions.map(t => {
                    const cfg = TXN_TYPE_CONFIG[t.transaction_type] ?? { label: t.transaction_type, color: "text-muted-foreground", sign: "" };
                    const isPos = t.points >= 0;
                    return (
                      <tr key={t.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 text-muted-foreground">{new Date(t.created_at).toLocaleDateString("es-AR")}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{(t.loyalty_members as LoyaltyTransaction["loyalty_members"])?.customers?.name ?? "—"}</td>
                        <td className="px-4 py-3"><span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span></td>
                        <td className={`px-4 py-3 font-semibold ${isPos ? "text-green-600" : "text-red-500"}`}>
                          <span className="flex items-center gap-1">
                            {isPos ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            {cfg.sign}{Math.abs(t.points).toLocaleString("es-AR")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{t.balance_after.toLocaleString("es-AR")}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{t.description}</td>
                      </tr>
                    );
                  })}
                  {transactions.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-12 text-muted-foreground/60">Sin transacciones registradas</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ))}

      {/* ── Tier Dialog ── */}
      <Dialog open={showTierDialog} onOpenChange={setShowTierDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingTier ? "Editar Tier" : "Nuevo Tier"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre *</Label><Input value={tierForm.name} onChange={e => setTierForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Ícono (emoji)</Label><Input value={tierForm.icon} onChange={e => setTierForm(p => ({ ...p, icon: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Puntos mín.</Label><Input type="number" value={tierForm.min_points} onChange={e => setTierForm(p => ({ ...p, min_points: e.target.value }))} /></div>
              <div><Label>Puntos máx. (vacío = ∞)</Label><Input type="number" value={tierForm.max_points} onChange={e => setTierForm(p => ({ ...p, max_points: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Multiplicador de puntos</Label><Input type="number" step="0.1" value={tierForm.multiplier} onChange={e => setTierForm(p => ({ ...p, multiplier: e.target.value }))} /></div>
              <div><Label>Color</Label><input type="color" value={tierForm.color} onChange={e => setTierForm(p => ({ ...p, color: e.target.value }))} className="h-10 w-full rounded border cursor-pointer" /></div>
            </div>
            <div><Label>Beneficios (separados por coma)</Label><Input value={tierForm.benefits} onChange={e => setTierForm(p => ({ ...p, benefits: e.target.value }))} placeholder="Envío gratis, Acceso prioritario, ..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTierDialog(false)}>Cancelar</Button>
            <Button onClick={saveTier}>{editingTier ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reward Dialog ── */}
      <Dialog open={showRewardDialog} onOpenChange={setShowRewardDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingReward ? "Editar Recompensa" : "Nueva Recompensa"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre *</Label><Input value={rewardForm.name} onChange={e => setRewardForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Descripción</Label><Input value={rewardForm.description} onChange={e => setRewardForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={rewardForm.reward_type} onValueChange={v => setRewardForm(p => ({ ...p, reward_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(REWARD_TYPE_CONFIG).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Costo en puntos *</Label><Input type="number" value={rewardForm.points_cost} onChange={e => setRewardForm(p => ({ ...p, points_cost: e.target.value }))} /></div>
            </div>
            {["discount_pct","discount_fixed","gift_card"].includes(rewardForm.reward_type) && (
              <div><Label>Valor del descuento</Label><Input type="number" value={rewardForm.discount_value} onChange={e => setRewardForm(p => ({ ...p, discount_value: e.target.value }))} /></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Stock máximo (vacío = sin límite)</Label><Input type="number" value={rewardForm.stock_limit} onChange={e => setRewardForm(p => ({ ...p, stock_limit: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Válido desde</Label><Input type="date" value={rewardForm.valid_from} onChange={e => setRewardForm(p => ({ ...p, valid_from: e.target.value }))} /></div>
              <div><Label>Válido hasta</Label><Input type="date" value={rewardForm.valid_to} onChange={e => setRewardForm(p => ({ ...p, valid_to: e.target.value }))} /></div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={rewardForm.is_active} onCheckedChange={v => setRewardForm(p => ({ ...p, is_active: v }))} />
              <Label>Recompensa activa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRewardDialog(false)}>Cancelar</Button>
            <Button onClick={saveReward}>{editingReward ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Adjust Points Dialog ── */}
      <Dialog open={showAdjustDialog} onOpenChange={setShowAdjustDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar Puntos — {selectedMember?.customers?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Puntos actuales: <strong className="text-yellow-600">{selectedMember?.current_points.toLocaleString("es-AR")}</strong></p>
            <div>
              <Label>Tipo de transacción</Label>
              <Select value={adjustForm.transaction_type} onValueChange={v => setAdjustForm(p => ({ ...p, transaction_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="earn">Acumular</SelectItem>
                  <SelectItem value="redeem">Canjear</SelectItem>
                  <SelectItem value="bonus">Bonus</SelectItem>
                  <SelectItem value="adjust">Ajuste manual</SelectItem>
                  <SelectItem value="expire">Expirar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Puntos (valor absoluto)</Label><Input type="number" value={adjustForm.points} onChange={e => setAdjustForm(p => ({ ...p, points: e.target.value }))} /></div>
            <div><Label>Descripción *</Label><Input value={adjustForm.description} onChange={e => setAdjustForm(p => ({ ...p, description: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjustDialog(false)}>Cancelar</Button>
            <Button onClick={applyAdjustment}><Award className="w-4 h-4 mr-1" /> Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
