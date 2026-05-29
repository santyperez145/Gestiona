import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Trophy, Star, Zap, Plus, Edit2, Trash2, RefreshCw,
  Award, TrendingUp, Users, Crown, Gift, Target,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ── Types ─────────────────────────────────────────────────────────────────────
interface BadgeDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  condition_type: string;
  condition_value: number;
  points: number;
  active: boolean;
}

interface StaffPoints {
  id: string;
  user_id: string;
  staff_name: string;
  total_points: number;
  level: number;
}

interface BadgeAward {
  id: string;
  badge_id: string;
  user_id: string;
  staff_name: string;
  message: string | null;
  points_earned: number;
  created_at: string;
  badge_definitions?: { name: string; icon: string; color: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  performance: "Rendimiento", streak: "Rachas", milestone: "Hitos",
  special: "Especial", team: "Equipo",
};
const CATEGORY_ICONS: Record<string, typeof Trophy> = {
  performance: TrendingUp, streak: Zap, milestone: Target,
  special: Gift, team: Users,
};
const CONDITION_LABELS: Record<string, string> = {
  manual: "Manual", sales_count: "N° de ventas",
  sales_amount: "Monto vendido", tickets_closed: "Tickets cerrados",
  streak_days: "Racha de días",
};

function getLevelName(level: number) {
  if (level >= 20) return "Leyenda";
  if (level >= 15) return "Diamante";
  if (level >= 10) return "Platino";
  if (level >= 7)  return "Oro";
  if (level >= 4)  return "Plata";
  return "Bronce";
}
function getLevelColor(level: number) {
  if (level >= 20) return "from-yellow-400 to-yellow-600";
  if (level >= 15) return "from-cyan-400 to-cyan-600";
  if (level >= 10) return "from-purple-400 to-purple-600";
  if (level >= 7)  return "from-yellow-300 to-yellow-500";
  if (level >= 4)  return "from-slate-400 to-slate-500";
  return "from-orange-500 to-orange-700";
}

// Default badges to seed for a new org
const DEFAULT_BADGES = [
  { name: "Primera Venta", description: "Realizó su primera venta", icon: "🎯", color: "#10b981", category: "milestone", condition_type: "sales_count", condition_value: 1, points: 10 },
  { name: "Vendedor del Día", description: "Mejor vendedor del día", icon: "⭐", color: "#f59e0b", category: "performance", condition_type: "manual", condition_value: 0, points: 25 },
  { name: "Racha Semanal", description: "7 días consecutivos activo", icon: "🔥", color: "#ef4444", category: "streak", condition_type: "streak_days", condition_value: 7, points: 50 },
  { name: "100 Ventas", description: "Superó las 100 ventas", icon: "💯", color: "#6366f1", category: "milestone", condition_type: "sales_count", condition_value: 100, points: 100 },
  { name: "Team Player", description: "Reconocimiento especial de equipo", icon: "🤝", color: "#0ea5e9", category: "team", condition_type: "manual", condition_value: 0, points: 30 },
  { name: "Mes Récord", description: "Mejor mes en la historia del negocio", icon: "🏆", color: "#a855f7", category: "performance", condition_type: "manual", condition_value: 0, points: 200 },
];

// ── Badge Form ────────────────────────────────────────────────────────────────
const blankBadge = () => ({
  name: "", description: "", icon: "🏆", color: "#6366f1",
  category: "performance", condition_type: "manual", condition_value: 0, points: 10, active: true,
});

function BadgeForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: BadgeDef | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankBadge());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    setF(editing ? {
      name: editing.name, description: editing.description, icon: editing.icon,
      color: editing.color, category: editing.category, condition_type: editing.condition_type,
      condition_value: editing.condition_value, points: editing.points, active: editing.active,
    } : blankBadge());
  }, [editing, open]);

  async function save() {
    if (!f.name.trim()) { toast.error("Nombre requerido"); return; }
    setSaving(true);
    const { error } = editing
      ? await supabase.from("badge_definitions").update({ ...f, org_id: orgId }).eq("id", editing.id)
      : await supabase.from("badge_definitions").insert({ ...f, org_id: orgId });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Badge guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "Editar badge" : "Nuevo badge"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1"><Label>Nombre *</Label>
              <Input value={f.name} onChange={e => upd("name", e.target.value)} />
            </div>
            <div className="w-20"><Label>Emoji</Label>
              <Input value={f.icon} onChange={e => upd("icon", e.target.value)} className="text-center text-xl" />
            </div>
          </div>
          <div><Label>Descripción</Label>
            <Textarea value={f.description} onChange={e => upd("description", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Categoría</Label>
              <Select value={f.category} onValueChange={v => upd("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Color</Label>
              <Input type="color" value={f.color} onChange={e => upd("color", e.target.value)} className="h-10 p-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Condición</Label>
              <Select value={f.condition_type} onValueChange={v => upd("condition_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Valor mínimo</Label>
              <Input type="number" min="0" value={f.condition_value} onChange={e => upd("condition_value", Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Puntos que otorga</Label>
              <Input type="number" min="1" value={f.points} onChange={e => upd("points", Number(e.target.value))} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="badge-active" checked={f.active} onChange={e => upd("active", e.target.checked)} className="w-4 h-4" />
              <label htmlFor="badge-active" className="text-sm">Activo</label>
            </div>
          </div>
          {/* Preview */}
          <div className="flex items-center gap-3 p-3 rounded-xl border border-border/50">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
              style={{ backgroundColor: f.color + "22", border: `2px solid ${f.color}50` }}>
              {f.icon}
            </div>
            <div>
              <p className="font-semibold">{f.name || "Badge de ejemplo"}</p>
              <p className="text-xs text-muted-foreground">{f.description || "Descripción del badge"}</p>
              <p className="text-xs font-bold mt-0.5" style={{ color: f.color }}>+{f.points} pts</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Award Form ────────────────────────────────────────────────────────────────
function AwardForm({ open, onClose, badges, staffList, orgId, awardedBy, onSaved }: {
  open: boolean; onClose: () => void;
  badges: BadgeDef[]; staffList: { user_id: string; name: string }[];
  orgId: string; awardedBy: string; onSaved: () => void;
}) {
  const [f, setF] = useState({ badge_id: "", user_id: "", staff_name: "", message: "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.badge_id || !f.user_id) { toast.error("Badge y usuario requeridos"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("award_badge", {
      p_badge_id: f.badge_id, p_user_id: f.user_id, p_org_id: orgId,
      p_staff_name: f.staff_name, p_awarded_by: awardedBy,
      p_message: f.message || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("🏆 Badge otorgado!");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Otorgar badge</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Badge</Label>
            <Select value={f.badge_id} onValueChange={v => setF(p => ({ ...p, badge_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar badge..." /></SelectTrigger>
              <SelectContent>
                {badges.filter(b => b.active).map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.icon} {b.name} (+{b.points}pts)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Miembro del equipo</Label>
            {staffList.length > 0 ? (
              <Select value={f.user_id} onValueChange={v => {
                const staff = staffList.find(s => s.user_id === v);
                setF(p => ({ ...p, user_id: v, staff_name: staff?.name || "" }));
              }}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {staffList.map(s => <SelectItem key={s.user_id} value={s.user_id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-2 pb-12">
                <Input placeholder="User ID..." value={f.user_id} onChange={e => setF(p => ({ ...p, user_id: e.target.value }))} />
                <Input placeholder="Nombre del staff..." value={f.staff_name} onChange={e => setF(p => ({ ...p, staff_name: e.target.value }))} />
              </div>
            )}
          </div>
          <div><Label>Mensaje (opcional)</Label>
            <Textarea value={f.message} onChange={e => setF(p => ({ ...p, message: e.target.value }))}
              placeholder="¡Excelente trabajo esta semana!..." rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Otorgando..." : "Otorgar 🏆"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function GamificationPage() {
  usePageTitle("Gamificación");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const orgId = activeOrg?.id ?? "";
  const [badges, setBadges] = useState<BadgeDef[]>([]);
  const [leaderboard, setLeaderboard] = useState<StaffPoints[]>([]);
  const [awards, setAwards] = useState<BadgeAward[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("ranking");
  const [badgeFormOpen, setBadgeFormOpen] = useState(false);
  const [editingBadge, setEditingBadge] = useState<BadgeDef | null>(null);
  const [awardFormOpen, setAwardFormOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [badgesData, lbData, awardsData] = await Promise.all([
      supabase.from("badge_definitions").select("*").eq("org_id", orgId).order("points", { ascending: false }),
      supabase.from("staff_points").select("*").eq("org_id", orgId).order("total_points", { ascending: false }),
      supabase.from("staff_badge_awards").select("*, badge_definitions(name, icon, color)")
        .eq("org_id", orgId).order("created_at", { ascending: false }).limit(50),
    ]);
    setBadges((badgesData.data || []) as BadgeDef[]);
    setLeaderboard(lbData.data || []);
    setAwards((awardsData.data || []) as BadgeAward[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function seedDefaults() {
    setSeeding(true);
    const { error } = await supabase.from("badge_definitions").insert(
      DEFAULT_BADGES.map(b => ({ ...b, org_id: orgId }))
    );
    setSeeding(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Badges de ejemplo creados");
    loadData();
  }

  async function deleteBadge(id: string) {
    if (!confirm("¿Eliminar este badge?")) return;
    await supabase.from("badge_definitions").delete().eq("id", id);
    toast.success("Badge eliminado");
    loadData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span className="text-sm">Cargando gamificación...</span>
      </div>
    );
  }

  const totalPoints = leaderboard.reduce((s, l) => s + l.total_points, 0);
  const avgLevel = leaderboard.length > 0
    ? (leaderboard.reduce((a, s) => a + s.level, 0) / leaderboard.length).toFixed(1)
    : "—";

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Trophy}
        title="Gamificación"
        description="Puntos, insignias y rankings del equipo"
        actions={
          <div className="flex gap-2">
            {badges.length === 0 && (
              <Button variant="outline" onClick={seedDefaults} disabled={seeding}>
                {seeding ? "Creando..." : "Crear badges de ejemplo"}
              </Button>
            )}
            <Button variant="outline" onClick={() => { setAwardFormOpen(true); }}>
              <Award className="w-4 h-4 mr-1" /> Otorgar badge
            </Button>
            <Button onClick={() => { setEditingBadge(null); setBadgeFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Nueva Insignia
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Puntos totales del equipo"
          value={totalPoints}
          icon={TrendingUp}
          color="primary"
        />
        <KPICard
          label="Insignias activas"
          value={badges.filter(b => b.active).length}
          icon={Star}
          color="success"
        />
        <KPICard
          label="Premios otorgados"
          value={awards.length}
          icon={Trophy}
          color="warning"
        />
        <KPICard
          label="Nivel promedio"
          value={avgLevel}
          icon={Crown}
          color="blue"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="ranking">Ranking</TabsTrigger>
          <TabsTrigger value="insignias">Insignias ({badges.length})</TabsTrigger>
          <TabsTrigger value="premios">Premios</TabsTrigger>
        </TabsList>

        {/* Leaderboard */}
        <TabsContent value="ranking" className="space-y-3 pt-2">
          {leaderboard.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              El ranking se construye al otorgar badges al equipo.
            </div>
          ) : (
            <div className="space-y-2 pb-12">
              {leaderboard.map((sp, i) => {
                const levelName = getLevelName(sp.level);
                const levelClass = getLevelColor(sp.level);
                const maxPts = leaderboard[0]?.total_points || 1;
                return (
                  <div key={sp.id} className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4">
                    {/* Rank */}
                    <div className="w-8 text-center shrink-0">
                      {i === 0 ? <span className="text-2xl">🥇</span>
                       : i === 1 ? <span className="text-2xl">🥈</span>
                       : i === 2 ? <span className="text-2xl">🥉</span>
                       : <span className="text-lg font-bold text-muted-foreground">{i + 1}</span>}
                    </div>
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${levelClass} flex items-center justify-center text-white font-bold text-sm shrink-0`}>
                      {sp.staff_name.charAt(0).toUpperCase()}
                    </div>
                    {/* Name & level */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold truncate">{sp.staff_name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold text-white bg-gradient-to-r ${levelClass}`}>
                          {levelName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${(sp.total_points / maxPts) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">Nv.{sp.level}</span>
                      </div>
                    </div>
                    {/* Points */}
                    <div className="text-right shrink-0">
                      <p className="text-xl font-bold text-primary">{sp.total_points}</p>
                      <p className="text-xs text-muted-foreground">puntos</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Badges catalog */}
        <TabsContent value="insignias" className="space-y-3 pt-2">
          {badges.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Sin badges. Creá uno o cargá los de ejemplo.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {badges.map(badge => {
                const CatIcon = CATEGORY_ICONS[badge.category] || Star;
                return (
                  <div key={badge.id} className={`rounded-xl border p-4 transition-all ${badge.active ? "border-border/50 bg-card" : "border-border/20 opacity-50"}`}>
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                        style={{ backgroundColor: badge.color + "22", border: `2px solid ${badge.color}40` }}>
                        {badge.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">{badge.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{badge.description}</p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingBadge(badge); setBadgeFormOpen(true); }}>
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteBadge(badge.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs flex items-center gap-1 text-muted-foreground">
                            <CatIcon className="w-3 h-3" />{CATEGORY_LABELS[badge.category]}
                          </span>
                          <span className="text-xs font-bold" style={{ color: badge.color }}>+{badge.points}pts</span>
                          <span className="text-xs text-muted-foreground">{CONDITION_LABELS[badge.condition_type]}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Activity feed */}
        <TabsContent value="premios" className="space-y-2 pt-2">
          {awards.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Sin badges otorgados aún.</div>
          ) : (
            awards.map(aw => {
              const bd = aw.badge_definitions;
              return (
                <div key={aw.id} className="flex items-start gap-3 rounded-xl border border-border/40 bg-card p-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: bd ? bd.color + "22" : "#6366f122", border: `2px solid ${bd ? bd.color + "40" : "#6366f140"}` }}>
                    {bd?.icon || "🏆"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-semibold">{aw.staff_name}</span>
                      <span className="text-muted-foreground"> recibió </span>
                      <span className="font-semibold">{bd?.name || "Badge"}</span>
                    </p>
                    {aw.message && <p className="text-xs text-muted-foreground italic mt-0.5">"{aw.message}"</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(aw.created_at).toLocaleDateString("es-AR")} · +{aw.points_earned}pts
                    </p>
                  </div>
                  <span className="text-sm font-bold shrink-0" style={{ color: bd?.color }}>+{aw.points_earned}pts</span>
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      <BadgeForm open={badgeFormOpen} onClose={() => setBadgeFormOpen(false)}
        editing={editingBadge} orgId={orgId} onSaved={loadData} />
      <AwardForm open={awardFormOpen} onClose={() => setAwardFormOpen(false)}
        badges={badges} staffList={leaderboard.map(l => ({ user_id: l.user_id, name: l.staff_name }))}
        orgId={orgId} awardedBy={user?.id || ""} onSaved={loadData} />
    </div>
  );
}
