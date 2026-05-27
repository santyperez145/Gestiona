import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Trophy, Star, Zap, Flame, Target, Medal, Crown, Award,
  TrendingUp, Users, Calendar, ChevronUp, Sparkles
} from "lucide-react";

interface Profile {
  user_id: string;
  name: string;
  email: string;
  total_xp: number;
  current_level: number;
  current_streak: number;
  badges_earned: string[];
  rank_position: number;
  stats: { sales_count: number; revenue_total: number; new_customers: number };
}

interface GameBadge {
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  xp_reward: number;
  threshold: number;
  condition_type: string;
  unlocked: boolean;
}

interface Challenge {
  id: string;
  name: string;
  description: string;
  metric: string;
  target_value: number;
  current_value: number;
  start_date: string;
  end_date: string;
  xp_reward: number;
  is_active: boolean;
}

const LEVEL_NAMES = ["Novato", "Vendedor", "Pro", "Experto", "Élite", "Leyenda", "Maestro", "Campeón"];
const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3000];
const RARITY_COLORS: Record<string, string> = {
  common:    "bg-gray-100 border-gray-300 text-gray-700",
  uncommon:  "bg-green-100 border-green-300 text-green-700",
  rare:      "bg-blue-100 border-blue-400 text-blue-700",
  epic:      "bg-purple-100 border-purple-400 text-purple-700",
  legendary: "bg-yellow-100 border-yellow-500 text-yellow-800",
};

const MOCK_PROFILES: Profile[] = [
  { user_id: "u1", name: "Martín González", email: "martin@empresa.com", total_xp: 2450, current_level: 6, current_streak: 12, badges_earned: ["first_sale","sales_10","streak_7","big_ticket"], rank_position: 1, stats: { sales_count: 187, revenue_total: 3_200_000, new_customers: 34 } },
  { user_id: "u2", name: "Laura Rodríguez", email: "laura@empresa.com", total_xp: 1820, current_level: 5, current_streak: 5, badges_earned: ["first_sale","sales_10","new_customers_50"], rank_position: 2, stats: { sales_count: 145, revenue_total: 2_100_000, new_customers: 52 } },
  { user_id: "u3", name: "Carlos Méndez", email: "carlos@empresa.com", total_xp: 980, current_level: 4, current_streak: 2, badges_earned: ["first_sale","sales_10"], rank_position: 3, stats: { sales_count: 89, revenue_total: 1_400_000, new_customers: 18 } },
  { user_id: "u4", name: "Ana Fernández", email: "ana@empresa.com", total_xp: 420, current_level: 2, current_streak: 0, badges_earned: ["first_sale"], rank_position: 4, stats: { sales_count: 34, revenue_total: 580_000, new_customers: 8 } },
];

const MOCK_BADGES: GameBadge[] = [
  { code: "first_sale",       name: "Primera Venta",       description: "Realizaste tu primera venta",           icon: "🎯", category: "achievement", rarity: "common",    xp_reward: 50,   threshold: 1,       condition_type: "sales_count",   unlocked: true },
  { code: "sales_10",         name: "10 Ventas",            description: "Alcanzaste 10 ventas",                  icon: "🔟", category: "achievement", rarity: "common",    xp_reward: 100,  threshold: 10,      condition_type: "sales_count",   unlocked: true },
  { code: "sales_100",        name: "100 Ventas",           description: "Cerraste 100 ventas",                   icon: "💯", category: "achievement", rarity: "rare",      xp_reward: 500,  threshold: 100,     condition_type: "sales_count",   unlocked: false },
  { code: "streak_7",         name: "Racha Semanal",        description: "7 días consecutivos con ventas",        icon: "🔥", category: "streak",      rarity: "uncommon",  xp_reward: 150,  threshold: 7,       condition_type: "streak_days",   unlocked: true },
  { code: "streak_30",        name: "Mes Perfecto",         description: "30 días consecutivos con ventas",       icon: "🌟", category: "streak",      rarity: "epic",      xp_reward: 500,  threshold: 30,      condition_type: "streak_days",   unlocked: false },
  { code: "revenue_1m",       name: "Club del Millón",      description: "Superaste $1.000.000 en ventas",        icon: "💰", category: "revenue",     rarity: "epic",      xp_reward: 750,  threshold: 1000000, condition_type: "revenue_total", unlocked: false },
  { code: "new_customers_50", name: "Conquistador",         description: "Conseguiste 50 clientes nuevos",        icon: "👑", category: "customer",    rarity: "rare",      xp_reward: 300,  threshold: 50,      condition_type: "new_customers", unlocked: true },
  { code: "big_ticket",       name: "Ticket Grande",        description: "Venta individual por más de $50.000",   icon: "🏆", category: "achievement", rarity: "uncommon",  xp_reward: 200,  threshold: 50000,   condition_type: "single_sale",   unlocked: true },
  { code: "upsell_master",    name: "Maestro del Upsell",   description: "25 upsells concretados",                icon: "📈", category: "achievement", rarity: "rare",      xp_reward: 250,  threshold: 25,      condition_type: "upsells",       unlocked: false },
  { code: "legend",           name: "Leyenda",              description: "Alcanzaste el nivel Leyenda",            icon: "🦅", category: "special",     rarity: "legendary", xp_reward: 1000, threshold: 1000,    condition_type: "sales_count",   unlocked: false },
];

const MOCK_CHALLENGES: Challenge[] = [
  { id: "ch1", name: "Sprint de Mayo", description: "Cierra 30 ventas antes del 31/05", metric: "sales_count", target_value: 30, current_value: 21, start_date: "2026-05-01", end_date: "2026-05-31", xp_reward: 300, is_active: true },
  { id: "ch2", name: "Nuevos Clientes Q2", description: "Consigue 20 clientes nuevos en Q2", metric: "new_customers", target_value: 20, current_value: 13, start_date: "2026-04-01", end_date: "2026-06-30", xp_reward: 400, is_active: true },
  { id: "ch3", name: "Revenue Record", description: "Alcanza $5M en ventas grupales", metric: "revenue", target_value: 5_000_000, current_value: 3_200_000, start_date: "2026-05-01", end_date: "2026-05-31", xp_reward: 500, is_active: true },
];

function XPBar({ xp, level }: { xp: number; level: number }) {
  const currentThreshold = LEVEL_THRESHOLDS[level] ?? 0;
  const nextThreshold = LEVEL_THRESHOLDS[level + 1] ?? LEVEL_THRESHOLDS[level];
  const progress = nextThreshold > currentThreshold
    ? ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100
    : 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{LEVEL_NAMES[level]}</span>
        <span>{xp} / {nextThreshold} XP</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">Siguiente: {LEVEL_NAMES[level + 1] ?? "Máximo"}</p>
    </div>
  );
}

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-orange-400" />;
  return <span className="text-sm font-bold text-muted-foreground">#{rank}</span>;
}

export default function SalesGamificationPage() {
  const { orgId } = useOrganization();
  const { user } = useAuth();
  const [tab, setTab] = useState<"leaderboard" | "badges" | "challenges" | "myprofile">("leaderboard");
  const [profiles] = useState<Profile[]>(MOCK_PROFILES);
  const [challenges] = useState<Challenge[]>(MOCK_CHALLENGES);
  const [badgeFilter, setBadgeFilter] = useState<string>("all");

  const myProfile = profiles[2]; // Carlos Méndez as "me"

  const filteredBadges = MOCK_BADGES.filter(b => badgeFilter === "all" || b.category === badgeFilter);

  const simulateXP = () => {
    toast.success("¡+25 XP ganados! Racha activa 🔥", { description: "Venta registrada: $15.000" });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-500" /> Gamificación de Ventas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Leaderboard, logros, desafíos y ranking del equipo</p>
        </div>
        <Button onClick={simulateXP} className="gap-2">
          <Sparkles className="w-4 h-4" />Simular Venta
        </Button>
      </div>

      {/* My mini profile */}
      <Card className="bg-gradient-to-r from-primary/10 to-purple-500/10 border-primary/20">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary">
            {myProfile.name.slice(0, 1)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold">{myProfile.name}</span>
              <Badge className="bg-primary/20 text-primary border-0 text-xs">Nivel {myProfile.current_level} — {LEVEL_NAMES[myProfile.current_level]}</Badge>
              {myProfile.current_streak > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-orange-600">
                  <Flame className="w-3 h-3" />{myProfile.current_streak} días de racha
                </span>
              )}
            </div>
            <div className="mt-2 max-w-xs">
              <XPBar xp={myProfile.total_xp} level={myProfile.current_level} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-primary">{myProfile.total_xp}</p>
            <p className="text-xs text-muted-foreground">XP Total</p>
            <p className="text-sm font-medium mt-1">#{myProfile.rank_position} del equipo</p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="leaderboard"><Trophy className="w-3.5 h-3.5 mr-1" />Ranking</TabsTrigger>
          <TabsTrigger value="badges"><Star className="w-3.5 h-3.5 mr-1" />Logros</TabsTrigger>
          <TabsTrigger value="challenges"><Target className="w-3.5 h-3.5 mr-1" />Desafíos</TabsTrigger>
          <TabsTrigger value="myprofile"><Award className="w-3.5 h-3.5 mr-1" />Mi Perfil</TabsTrigger>
        </TabsList>

        {/* LEADERBOARD */}
        <TabsContent value="leaderboard" className="space-y-3">
          {profiles.map((p, i) => (
            <Card key={p.user_id} className={p.user_id === myProfile.user_id ? "border-primary/50 bg-primary/5" : ""}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-8 flex items-center justify-center">
                  <RankMedal rank={p.rank_position} />
                </div>
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                  {p.name.slice(0, 1)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {p.user_id === myProfile.user_id && <Badge className="text-xs bg-primary text-primary-foreground">Tú</Badge>}
                    <span className="text-xs text-muted-foreground">Nivel {p.current_level} · {LEVEL_NAMES[p.current_level]}</span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{p.stats.sales_count} ventas</span>
                    <span>${(p.stats.revenue_total / 1_000_000).toFixed(1)}M revenue</span>
                    <span>{p.stats.new_customers} nuevos clientes</span>
                    {p.current_streak > 0 && <span className="text-orange-600 flex items-center gap-0.5"><Flame className="w-3 h-3" />{p.current_streak}d racha</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-primary">{p.total_xp.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">XP</p>
                </div>
                <div className="flex gap-1 flex-wrap max-w-20">
                  {p.badges_earned.slice(0, 3).map(b => {
                    const badge = MOCK_BADGES.find(x => x.code === b);
                    return badge ? <span key={b} title={badge.name}>{badge.icon}</span> : null;
                  })}
                  {p.badges_earned.length > 3 && <span className="text-xs text-muted-foreground">+{p.badges_earned.length - 3}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* BADGES */}
        <TabsContent value="badges" className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {["all", "achievement", "streak", "revenue", "customer", "special"].map(cat => (
              <button
                key={cat}
                onClick={() => setBadgeFilter(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${badgeFilter === cat ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}
              >
                {cat === "all" ? "Todos" : cat === "achievement" ? "Logros" : cat === "streak" ? "Rachas" : cat === "revenue" ? "Revenue" : cat === "customer" ? "Clientes" : "Especiales"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {filteredBadges.map(badge => (
              <Card key={badge.code} className={`${!badge.unlocked ? "opacity-40 grayscale" : ""} border ${RARITY_COLORS[badge.rarity]}`}>
                <CardContent className="p-4 text-center">
                  <span className="text-3xl">{badge.icon}</span>
                  <p className="font-semibold text-sm mt-2">{badge.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{badge.description}</p>
                  <div className="flex items-center justify-center gap-1 mt-2">
                    <Zap className="w-3 h-3 text-yellow-500" />
                    <span className="text-xs font-medium">+{badge.xp_reward} XP</span>
                  </div>
                  <Badge variant="outline" className={`text-xs mt-2 ${RARITY_COLORS[badge.rarity]}`}>
                    {badge.rarity === "common" ? "Común" : badge.rarity === "uncommon" ? "Poco común" : badge.rarity === "rare" ? "Raro" : badge.rarity === "epic" ? "Épico" : "Legendario"}
                  </Badge>
                  {badge.unlocked && <p className="text-xs text-green-600 font-medium mt-1">✓ Desbloqueado</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* CHALLENGES */}
        <TabsContent value="challenges" className="space-y-4">
          {challenges.map(ch => {
            const pct = Math.min((ch.current_value / ch.target_value) * 100, 100);
            const daysLeft = Math.max(0, Math.ceil((new Date(ch.end_date).getTime() - Date.now()) / 86400000));
            return (
              <Card key={ch.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        <Target className="w-4 h-4 text-primary" />{ch.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">{ch.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-yellow-500" />
                        <span className="text-sm font-bold">+{ch.xp_reward} XP</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{daysLeft} días restantes</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>
                        {ch.metric === "revenue" ? `$${(ch.current_value / 1_000_000).toFixed(1)}M / $${(ch.target_value / 1_000_000).toFixed(1)}M` : `${ch.current_value} / ${ch.target_value}`}
                      </span>
                      <span className="font-medium">{pct.toFixed(0)}%</span>
                    </div>
                    <Progress value={pct} className="h-3" />
                  </div>
                  {pct >= 100 && (
                    <div className="mt-2 text-center text-sm font-medium text-green-600">
                      🎉 ¡Desafío completado!
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* MY PROFILE */}
        <TabsContent value="myprofile" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-primary">{myProfile.stats.sales_count}</p><p className="text-xs text-muted-foreground mt-1">Ventas Totales</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">${(myProfile.stats.revenue_total / 1_000_000).toFixed(1)}M</p><p className="text-xs text-muted-foreground mt-1">Revenue Total</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-orange-500">{myProfile.current_streak}</p><p className="text-xs text-muted-foreground mt-1">Días de Racha</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-yellow-500">{myProfile.badges_earned.length}</p><p className="text-xs text-muted-foreground mt-1">Logros Ganados</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Progreso de Nivel</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-3xl font-bold text-primary">
                  {myProfile.current_level}
                </div>
                <div className="flex-1">
                  <XPBar xp={myProfile.total_xp} level={myProfile.current_level} />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {LEVEL_NAMES.map((name, i) => (
                  <div key={i} className={`text-center p-2 rounded-lg text-xs ${i <= myProfile.current_level ? "bg-primary/10 text-primary font-semibold" : "bg-muted text-muted-foreground"}`}>
                    <p className="font-bold">{i}</p>
                    <p>{name}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Mis Logros</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-3 flex-wrap">
                {myProfile.badges_earned.map(code => {
                  const badge = MOCK_BADGES.find(b => b.code === code);
                  return badge ? (
                    <div key={code} className={`text-center p-2 rounded-lg border ${RARITY_COLORS[badge.rarity]}`} title={badge.description}>
                      <span className="text-2xl">{badge.icon}</span>
                      <p className="text-xs mt-1 font-medium">{badge.name}</p>
                    </div>
                  ) : null;
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
