import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, getAuditLogsDB, getSellerGoalsDB, upsertSellerGoalDB } from "@/lib/supabaseStore";
import {
  Shield, Users, TrendingUp, DollarSign, Package, Crown, UserPlus,
  BarChart3, ClipboardList, Target, Activity, Award, Loader2,
  AlertTriangle, CheckCircle2, Clock, ChevronUp, ChevronDown,
  Eye, Search, Filter, Medal, TrendingDown, Download, RefreshCcw,
  AlertCircle, ZapOff, Info, User, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import ActivityFeedTab from "@/components/admin/ActivityFeedTab";
import PermissionsTab from "@/components/admin/PermissionsTab";

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(150 60% 40%)',
  'hsl(200 60% 50%)',
  'hsl(0 70% 50%)',
  'hsl(280 60% 50%)',
  'hsl(45 80% 55%)',
];

type VendorStats = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  totalSales: number;
  totalRevenue: number;
  totalProfit: number;
  totalProducts: number;
  avgTicket: number;
  saleCount: number;
  lastSale: string | null;
};

export default function AdminPage() {
  usePageTitle("Administración");
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "overview";
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<VendorStats[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [sellerGoals, setSellerGoals] = useState<any[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    checkAdminAndLoad();
  }, [user]);

  const checkAdminAndLoad = async () => {
    if (!user) return;
    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const admin = roleData?.some(r => r.role === "admin") || false;
    setIsAdmin(admin);
    if (admin) {
      await loadVendorData();
      getAuditLogsDB(100).then(setAuditLogs).catch(() => {});
      getSellerGoalsDB(user.id).then(setSellerGoals).catch(() => {});
    }
    setLoading(false);
  };

  const loadVendorData = async () => {
    const { data: profiles } = await supabase.from("profiles").select("*");
    if (!profiles) return;
    const { data: roles } = await supabase.from("user_roles").select("*");
    const { data: allSales } = await supabase.from("sales").select("*").order("date", { ascending: false });
    const { data: allProducts } = await supabase.from("products").select("user_id, id");

    const vendorMap: Record<string, VendorStats> = {};
    for (const p of profiles) {
      const userRoles = roles?.filter(r => r.user_id === p.user_id) || [];
      const role = userRoles.map(r => r.role).join(", ") || "viewer";
      const userSales = (allSales || []).filter(s => s.user_id === p.user_id);
      const userProducts = (allProducts || []).filter(pr => pr.user_id === p.user_id);
      const totalRevenue = userSales.reduce((sum, s) => sum + Number(s.total_ars), 0);
      const totalProfit = userSales.reduce((sum, s) => sum + Number(s.profit_ars), 0);

      vendorMap[p.user_id] = {
        userId: p.user_id,
        email: p.display_name || p.user_id,
        displayName: p.display_name || "Sin nombre",
        role,
        totalSales: userSales.length,
        totalRevenue,
        totalProfit,
        totalProducts: userProducts.length,
        avgTicket: userSales.length > 0 ? totalRevenue / userSales.length : 0,
        saleCount: userSales.length,
        lastSale: userSales[0]?.date || null,
      };
    }
    setVendors(Object.values(vendorMap));
  };

  const totals = useMemo(() => ({
    revenue: vendors.reduce((s, v) => s + v.totalRevenue, 0),
    profit: vendors.reduce((s, v) => s + v.totalProfit, 0),
    sales: vendors.reduce((s, v) => s + v.totalSales, 0),
    vendors: vendors.length,
    avgTicket: vendors.reduce((s,v) => s + v.avgTicket, 0) / Math.max(1, vendors.filter(v=>v.totalSales>0).length),
    margin: vendors.reduce((s, v) => s + v.totalRevenue, 0) > 0
      ? (vendors.reduce((s, v) => s + v.totalProfit, 0) / vendors.reduce((s, v) => s + v.totalRevenue, 0)) * 100
      : 0,
  }), [vendors]);

  const topVendors = useMemo(() =>
    [...vendors].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 10),
    [vendors]
  );

  const chartData = useMemo(() =>
    topVendors.map(v => ({
      name: v.displayName.slice(0, 12),
      ventas: v.totalRevenue,
      ganancia: v.totalProfit,
    })),
    [topVendors]
  );

  const roleDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    vendors.forEach(v => { const r = v.role || "viewer"; counts[r] = (counts[r] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [vendors]);

  // Weekly sales trend from audit logs
  const weeklyTrend = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("es-AR", { weekday: "short" });
      days[key] = 0;
    }
    auditLogs.forEach(log => {
      if (log.action === "create" && log.entity_type === "sale") {
        const d = new Date(log.created_at);
        const key = d.toLocaleDateString("es-AR", { weekday: "short" });
        if (key in days) days[key]++;
      }
    });
    return Object.entries(days).map(([day, count]) => ({ day, count }));
  }, [auditLogs]);

  const filteredVendors = useMemo(() =>
    vendors.filter(v =>
      vendorSearch === "" ||
      v.displayName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
      v.email.toLowerCase().includes(vendorSearch.toLowerCase())
    ),
    [vendors, vendorSearch]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-display font-bold mb-2">Acceso Restringido</h2>
        <p className="text-muted-foreground text-sm">Solo los administradores pueden acceder a este panel.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Crown}
        title="Panel de Administración"
        description="Rendimiento de vendedores, metas, auditoría y gestión del equipo"
        actions={<AssignRoleDialog onDone={loadVendorData} />}
      />

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="Vendedores" value={totals.vendors} icon={Users} color="primary" sub="registrados" />
        <KPICard label="Transacciones" value={totals.sales} icon={BarChart3} color="blue" sub="totales" />
        <KPICard label="Facturación" value={formatARS(totals.revenue)} icon={DollarSign} color="success" sub="ingresos" />
        <KPICard label="Ganancia" value={formatARS(totals.profit)} icon={TrendingUp} color="success" sub="neta" />
        <KPICard label="Margen" value={`${totals.margin.toFixed(1)}%`} icon={Activity} color={totals.margin >= 20 ? "success" : "warning"} sub="promedio" />
        <KPICard label="Ticket Prom." value={formatARS(totals.avgTicket)} icon={Award} color="purple" sub="por venta" />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <Tabs
        className="workspace-tabs-layout workspace-admin-tabs w-full"
        defaultValue={initialTab}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams);
          if (v === "overview") next.delete("tab"); else next.set("tab", v);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList className="workspace-tabs-nav overflow-x-auto">
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" />Rendimiento</TabsTrigger>
          <TabsTrigger value="team" className="gap-1.5"><Users className="w-3.5 h-3.5" />Equipo</TabsTrigger>
          <TabsTrigger value="permissions" className="gap-1.5"><Shield className="w-3.5 h-3.5" />Permisos</TabsTrigger>
          <TabsTrigger value="goals" className="gap-1.5"><Target className="w-3.5 h-3.5" />Metas</TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5"><ClipboardList className="w-3.5 h-3.5" />Auditoría</TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5"><Activity className="w-3.5 h-3.5" />Actividad</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW TAB ─────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Bar chart */}
            <div className="lg:col-span-2 bg-card border border-border/40 rounded-xl p-5">
              <h3 className="font-semibold text-sm mb-1">Facturación por Vendedor</h3>
              <p className="text-xs text-muted-foreground mb-4">Top 10 — Ventas vs Ganancia</p>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v: number) => formatARS(v)}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar dataKey="ventas" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} name="Ventas" />
                    <Bar dataKey="ganancia" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} name="Ganancia" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">Sin datos de ventas</div>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-4 pb-12">
              {/* Role distribution */}
              <div className="bg-card border border-border/40 rounded-xl p-5">
                <h3 className="font-semibold text-sm mb-1">Distribución de Roles</h3>
                <p className="text-xs text-muted-foreground mb-3">{vendors.length} usuarios registrados</p>
                {roleDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={roleDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} innerRadius={30}>
                        {roleDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[140px] text-muted-foreground text-xs">Sin datos</div>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {roleDistribution.map((r, i) => (
                    <div key={r.name} className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-muted-foreground capitalize">{r.name}: <strong className="text-foreground">{r.value}</strong></span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Weekly trend */}
              <div className="bg-card border border-border/40 rounded-xl p-5">
                <h3 className="font-semibold text-sm mb-1">Actividad (7 días)</h3>
                <p className="text-xs text-muted-foreground mb-3">Transacciones por día</p>
                <ResponsiveContainer width="100%" height={90}>
                  <LineChart data={weeklyTrend}>
                    <Line type="monotone" dataKey="count" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3, fill: CHART_COLORS[0] }} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Top performers leaderboard */}
          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40">
              <h3 className="font-semibold">Top Vendedores</h3>
              <p className="text-xs text-muted-foreground">Ordenados por facturación total</p>
            </div>
            <div className="divide-y divide-border/20">
              {topVendors.slice(0, 5).map((v, i) => {
                const maxRev = topVendors[0]?.totalRevenue || 1;
                return (
                  <div key={v.userId} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/20 transition-colors">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      i === 0 ? "bg-yellow-500/20 text-yellow-400" :
                      i === 1 ? "bg-zinc-400/20 text-zinc-400" :
                      i === 2 ? "bg-orange-600/20 text-orange-400" :
                      "bg-muted/40 text-muted-foreground"
                    }`}>
                      {i < 3 ? ["🥇","🥈","🥉"][i] : i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{v.displayName}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <Progress value={(v.totalRevenue / maxRev) * 100} className="h-1.5 flex-1 max-w-[120px]" />
                        <span className="text-xs text-muted-foreground">{v.totalSales} ventas</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-sm text-emerald-400">{formatARS(v.totalRevenue)}</p>
                      <p className="text-xs text-muted-foreground">ganancia: {formatARS(v.totalProfit)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ── TEAM TAB ─────────────────────────────────────────────── */}
        <TabsContent value="team" className="space-y-4 mt-4">
          {/* Search */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar vendedor..."
                value={vendorSearch}
                onChange={e => setVendorSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <span className="text-sm text-muted-foreground">{filteredVendors.length} usuarios</span>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vendedor</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rol</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Productos</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ventas</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Facturación</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ganancia</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket Prom.</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Última Venta</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                        No se encontraron vendedores
                      </td>
                    </tr>
                  ) : filteredVendors.map(v => (
                    <tr key={v.userId} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {v.displayName.charAt(0).toUpperCase()}
                          </div>
                          <p className="font-medium">{v.displayName}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          v.role.includes("admin") ? "bg-yellow-500/15 text-yellow-400" :
                          v.role.includes("vendedor") ? "bg-blue-500/15 text-blue-400" :
                          "bg-muted/40 text-muted-foreground"
                        }`}>{v.role || "viewer"}</span>
                      </td>
                      <td className="px-4 py-3 text-right">{v.totalProducts}</td>
                      <td className="px-4 py-3 text-right">{v.totalSales}</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-400">{formatARS(v.totalRevenue)}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-medium">{formatARS(v.totalProfit)}</td>
                      <td className="px-4 py-3 text-right">{formatARS(v.avgTicket)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {v.lastSale ? new Date(v.lastSale).toLocaleDateString("es-AR") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredVendors.map(v => (
              <div key={v.userId} className="bg-card border border-border/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary">
                      {v.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{v.displayName}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        v.role.includes("admin") ? "bg-yellow-500/15 text-yellow-400" :
                        v.role.includes("vendedor") ? "bg-blue-500/15 text-blue-400" :
                        "bg-muted/40 text-muted-foreground"
                      }`}>{v.role || "viewer"}</span>
                    </div>
                  </div>
                  <p className="font-semibold text-sm text-emerald-400">{formatARS(v.totalRevenue)}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-muted/20 rounded-lg p-2 text-center">
                    <p className="font-bold">{v.totalSales}</p>
                    <p className="text-muted-foreground">Ventas</p>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-2 text-center">
                    <p className="font-bold text-emerald-400">{formatARS(v.totalProfit)}</p>
                    <p className="text-muted-foreground">Ganancia</p>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-2 text-center">
                    <p className="font-bold">{v.totalProducts}</p>
                    <p className="text-muted-foreground">Productos</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── PERMISSIONS TAB ──────────────────────────────────────── */}
        <TabsContent value="permissions" className="mt-4">
          <PermissionsTab />
        </TabsContent>

        {/* ── GOALS TAB ────────────────────────────────────────────── */}
        <TabsContent value="goals" className="mt-4">
          <SellerGoalsTab
            vendors={vendors}
            goals={sellerGoals}
            ownerId={user!.id}
            onUpdate={() => getSellerGoalsDB(user!.id).then(setSellerGoals)}
          />
        </TabsContent>

        {/* ── AUDIT TAB ────────────────────────────────────────────── */}
        <TabsContent value="audit" className="mt-4">
          <SystemAuditLogTab />
        </TabsContent>

        {/* ── ACTIVITY TAB ─────────────────────────────────────────── */}
        <TabsContent value="activity" className="mt-4">
          <ActivityFeedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── System Audit Log Tab ──────────────────────────────────────────────────────
// Full-featured audit trail — ported from the former standalone AuditLogPage
// (`/auditoria`, now redirected to `/admin?tab=audit`).
interface AuditLogRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  ip_address: string | null;
  severity: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditSummaryRow {
  entity_type: string;
  action: string;
  event_count: number;
  unique_users: number;
  last_event: string;
}

const AUDIT_SEVERITY_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  debug:    { label: "Debug",    color: "bg-muted/50 text-muted-foreground",      icon: <Info className="w-3 h-3" /> },
  info:     { label: "Info",     color: "bg-blue-500/15 text-blue-400",           icon: <Info className="w-3 h-3" /> },
  warning:  { label: "Advertencia", color: "bg-yellow-500/15 text-yellow-400",    icon: <AlertTriangle className="w-3 h-3" /> },
  error:    { label: "Error",    color: "bg-red-500/15 text-red-400",             icon: <AlertCircle className="w-3 h-3" /> },
  critical: { label: "Crítico",  color: "bg-red-500/25 text-red-300",             icon: <ZapOff className="w-3 h-3" /> },
};

const AUDIT_ACTION_COLOR: Record<string, string> = {
  create: "text-emerald-400", update: "text-blue-400", delete: "text-red-400",
  login: "text-purple-400", logout: "text-muted-foreground", export: "text-orange-400",
};

function getAuditActionColor(action: string) {
  const verb = action.split(".")[1] ?? action.split("_")[0];
  return AUDIT_ACTION_COLOR[verb] ?? "text-muted-foreground";
}

const AUDIT_ENTITY_ICONS: Record<string, string> = {
  sale: "💰", product: "📦", expense: "💸", client: "👤", invoice: "🧾",
  user: "🔐", setting: "⚙️", import: "📥", export: "📤",
};

const AUDIT_TABS = ["Línea de tiempo", "Resumen", "Exportar"] as const;
type AuditTab = typeof AUDIT_TABS[number];

function SystemAuditLogTab() {
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = useState<AuditTab>("Línea de tiempo");
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [summary, setSummary] = useState<AuditSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [filterTo, setFilterTo] = useState(new Date().toISOString().slice(0, 10));

  const [selectedLog, setSelectedLog] = useState<AuditLogRow | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);

    let q = supabase.from("audit_logs")
      .select("*", { count: "exact" })
      .eq("org_id", orgId)
      .gte("created_at", filterFrom)
      .lte("created_at", filterTo + "T23:59:59")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterSeverity !== "all") q = q.eq("severity", filterSeverity);
    if (filterEntity !== "all") q = q.eq("entity_type", filterEntity);
    if (search) q = q.or(`action.ilike.%${search}%,entity_label.ilike.%${search}%,user_email.ilike.%${search}%`);

    const { data, count, error } = await q;
    if (!error && data) {
      setLogs(data as AuditLogRow[]);
      setTotal(count ?? 0);
    }

    const { data: sumData } = await supabase.rpc("get_audit_summary", {
      p_org_id: orgId, p_from: filterFrom + "T00:00:00Z", p_to: filterTo + "T23:59:59Z",
    });
    if (sumData) setSummary(sumData as AuditSummaryRow[]);

    setLoading(false);
  }, [orgId, page, filterSeverity, filterEntity, search, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  const entityTypes = Array.from(new Set(logs.map(l => l.entity_type)));

  function exportCSV() {
    const headers = ["Fecha", "Email", "Acción", "Entidad", "Referencia", "Severidad", "IP"];
    const rows = logs.map(l => [
      new Date(l.created_at).toLocaleString("es-AR"),
      l.user_email ?? "", l.action, l.entity_type,
      l.entity_label ?? "", l.severity, l.ip_address ?? ""
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `audit_${filterFrom}_${filterTo}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />Traza de Auditoría del Sistema
          </h3>
          <p className="text-xs text-muted-foreground">{total.toLocaleString("es-AR")} eventos registrados en el período</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCcw className="w-4 h-4 mr-1" /> Actualizar</Button>
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="w-4 h-4 mr-1" /> CSV</Button>
        </div>
      </div>

      {/* Stats chips */}
      <div className="flex gap-3 flex-wrap">
        {Object.entries(AUDIT_SEVERITY_CONFIG).map(([sev, cfg]) => {
          const count = logs.filter(l => l.severity === sev).length;
          if (count === 0) return null;
          return (
            <button key={sev} onClick={() => setFilterSeverity(filterSeverity === sev ? "all" : sev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterSeverity === sev ? cfg.color + " border-current" : "bg-card text-muted-foreground hover:border-border"}`}>
              {cfg.icon}{cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit border border-border/40">
        {AUDIT_TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap bg-card border border-border/40 rounded-xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
          <Input placeholder="Buscar acción, entidad, email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-64" />
        </div>
        <div className="flex gap-2">
          <Input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="w-40" />
          <span className="self-center text-muted-foreground/70">→</span>
          <Input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="w-40" />
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Severidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {Object.entries(AUDIT_SEVERITY_CONFIG).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterEntity} onValueChange={setFilterEntity}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Entidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {entityTypes.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterSeverity("all"); setFilterEntity("all"); }}><Filter className="w-4 h-4 mr-1" /> Limpiar</Button>
      </div>

      {loading ? <div className="text-center py-16 text-muted-foreground/70">Cargando…</div> : (
        <>
          {activeTab === "Línea de tiempo" && (
            <>
              <div className="space-y-2">
                {logs.map(l => {
                  const sev = AUDIT_SEVERITY_CONFIG[l.severity] ?? AUDIT_SEVERITY_CONFIG.info;
                  const icon = AUDIT_ENTITY_ICONS[l.entity_type.split(".")[0]] ?? "📋";
                  return (
                    <div key={l.id} className="bg-card border rounded-xl px-4 py-3 flex items-start gap-3 hover:shadow-sm transition-shadow cursor-pointer group"
                      onClick={() => setSelectedLog(l)}>
                      <span className="text-xl mt-0.5">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-mono text-sm font-medium ${getAuditActionColor(l.action)}`}>{l.action}</span>
                          {l.entity_label && <span className="text-sm text-muted-foreground truncate">— {l.entity_label}</span>}
                          <Badge className={`${sev.color} flex items-center gap-1 text-xs ml-auto`}>{sev.icon}{sev.label}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground/70 flex-wrap">
                          {l.user_email && <span className="flex items-center gap-1"><User className="w-3 h-3" />{l.user_email}</span>}
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(l.created_at).toLocaleString("es-AR")}</span>
                          {l.ip_address && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{l.ip_address}</span>}
                          {l.tags && l.tags.length > 0 && l.tags.map(tag => <span key={tag} className="bg-muted/40 px-1.5 py-0.5 rounded">{tag}</span>)}
                        </div>
                      </div>
                      <Eye className="w-4 h-4 text-gray-300 group-hover:text-blue-400 shrink-0 mt-1" />
                    </div>
                  );
                })}
                {logs.length === 0 && (
                  <div className="text-center py-16 text-muted-foreground/70">
                    <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Sin eventos en el período seleccionado</p>
                  </div>
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                  <span className="text-sm text-muted-foreground">Pág. {page + 1} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
                </div>
              )}
            </>
          )}

          {activeTab === "Resumen" && (
            <div className="bg-card rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>{["Entidad","Acción","Total eventos","Usuarios únicos","Último evento"].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {summary.map((s, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-foreground">{AUDIT_ENTITY_ICONS[s.entity_type] ?? "📋"} {s.entity_type}</td>
                      <td className={`px-4 py-3 font-mono text-sm ${getAuditActionColor(s.action)}`}>{s.action}</td>
                      <td className="px-4 py-3 font-semibold">{s.event_count.toLocaleString("es-AR")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.unique_users}</td>
                      <td className="px-4 py-3 text-muted-foreground/70 text-xs">{new Date(s.last_event).toLocaleString("es-AR")}</td>
                    </tr>
                  ))}
                  {summary.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground/70">Sin datos</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "Exportar" && (
            <div className="bg-card rounded-xl border p-8 max-w-md space-y-4">
              <h2 className="font-semibold text-foreground">Exportar registros de auditoría</h2>
              <p className="text-sm text-muted-foreground">Descargá todos los eventos filtrados actualmente en formato CSV.</p>
              <div className="bg-muted/20 rounded-lg p-4 text-sm space-y-1 text-muted-foreground">
                <p>Período: <strong>{filterFrom} → {filterTo}</strong></p>
                <p>Eventos: <strong>{total.toLocaleString("es-AR")}</strong></p>
                <p>Severidad: <strong>{filterSeverity === "all" ? "Todas" : filterSeverity}</strong></p>
              </div>
              <Button onClick={exportCSV} className="w-full"><Download className="w-4 h-4 mr-2" /> Descargar CSV</Button>
            </div>
          )}
        </>
      )}

      {/* Detail modal */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        {selectedLog && (
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono text-base">
                <span className="text-xl">{AUDIT_ENTITY_ICONS[selectedLog.entity_type] ?? "📋"}</span>
                {selectedLog.action}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/20 rounded p-3">
                  <p className="text-xs text-muted-foreground/70 mb-1">Usuario</p>
                  <p className="font-medium">{selectedLog.user_email ?? "Sistema"}</p>
                  <p className="text-xs text-muted-foreground/70">{selectedLog.user_role}</p>
                </div>
                <div className="bg-muted/20 rounded p-3">
                  <p className="text-xs text-muted-foreground/70 mb-1">Entidad</p>
                  <p className="font-medium">{selectedLog.entity_type}</p>
                  <p className="text-xs text-muted-foreground/70">{selectedLog.entity_label ?? selectedLog.entity_id}</p>
                </div>
                <div className="bg-muted/20 rounded p-3">
                  <p className="text-xs text-muted-foreground/70 mb-1">Fecha y hora</p>
                  <p className="font-medium">{new Date(selectedLog.created_at).toLocaleString("es-AR")}</p>
                </div>
                <div className="bg-muted/20 rounded p-3">
                  <p className="text-xs text-muted-foreground/70 mb-1">IP / Severidad</p>
                  <p className="font-medium">{selectedLog.ip_address ?? "—"}</p>
                  <Badge className={`${AUDIT_SEVERITY_CONFIG[selectedLog.severity]?.color} text-xs mt-1`}>{selectedLog.severity}</Badge>
                </div>
              </div>
              {selectedLog.diff && Object.keys(selectedLog.diff).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground/70 mb-2">Cambios detectados</p>
                  <div className="bg-muted/20 rounded p-3 space-y-1.5 font-mono text-xs">
                    {Object.entries(selectedLog.diff).map(([key, val]) => {
                      const v = val as { from: unknown; to: unknown };
                      return (
                        <div key={key} className="flex gap-2 items-start">
                          <span className="text-muted-foreground shrink-0 w-24 truncate">{key}:</span>
                          <span className="text-red-400 line-through">{JSON.stringify(v.from)}</span>
                          <span className="text-muted-foreground/70">→</span>
                          <span className="text-emerald-400">{JSON.stringify(v.to)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground/70 mb-2">Metadata</p>
                  <pre className="bg-muted/20 rounded p-3 text-xs overflow-auto max-h-40">{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

// ─── Assign Role Dialog ────────────────────────────────────────────────────────
function AssignRoleDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "vendedor" | "viewer">("vendedor");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from("profiles").select("*").then(({ data }) => setProfiles(data || []));
  }, [open]);

  const handleAssign = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await supabase.from("user_roles").delete().eq("user_id", selectedUser);
      const { error } = await supabase.from("user_roles").insert({ user_id: selectedUser, role: selectedRole });
      if (error) throw error;
      toast.success(`Rol "${selectedRole}" asignado correctamente`);
      setOpen(false);
      onDone();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2"><UserPlus className="w-4 h-4" />Asignar Rol</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Asignar Rol a Usuario</DialogTitle></DialogHeader>
        <div className="space-y-4 pb-12">
          <div>
            <label className="text-sm text-muted-foreground">Usuario</label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar usuario..." /></SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.display_name || p.user_id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Rol</label>
            <Select value={selectedRole} onValueChange={v => setSelectedRole(v as "admin" | "vendedor" | "viewer")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">🔑 Administrador</SelectItem>
                <SelectItem value="vendedor">💼 Vendedor</SelectItem>
                <SelectItem value="viewer">👁 Viewer (solo lectura)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAssign} disabled={saving || !selectedUser} className="w-full gradient-gold text-primary-foreground font-semibold">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Asignando...</> : "Asignar Rol"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Seller Goals Tab ──────────────────────────────────────────────────────────
function SellerGoalsTab({ vendors, goals, ownerId, onUpdate }: {
  vendors: VendorStats[];
  goals: any[];
  ownerId: string;
  onUpdate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState("");
  const [targetArs, setTargetArs] = useState("");
  const [commissionPct, setCommissionPct] = useState("5");
  const [saving, setSaving] = useState(false);

  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";
  const sellers = vendors.filter(v => v.role.includes("vendedor") || v.role.includes("admin"));

  const handleSave = async () => {
    if (!selectedVendor || !targetArs) return;
    setSaving(true);
    try {
      const vendor = vendors.find(v => v.userId === selectedVendor);
      const totalSales = vendor?.totalRevenue || 0;
      const commission = totalSales * (parseFloat(commissionPct) / 100);
      await upsertSellerGoalDB({
        user_id: selectedVendor,
        owner_id: ownerId,
        month: currentMonth,
        target_ars: parseFloat(targetArs),
        commission_percent: parseFloat(commissionPct),
        total_sales_ars: totalSales,
        total_commission_ars: commission,
      });
      toast.success("Meta asignada correctamente");
      setOpen(false);
      onUpdate();
    } catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  const currentGoals = goals
    .filter(g => g.month === currentMonth)
    .map(g => ({ ...g, vendor: vendors.find(v => v.userId === g.user_id) }));

  return (
    <div className="space-y-4 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />Metas del Mes Actual
          </h3>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 gradient-gold text-primary-foreground">
              <Target className="w-3.5 h-3.5" />Asignar Meta
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Asignar Meta Mensual</DialogTitle></DialogHeader>
            <div className="space-y-4 pb-12">
              <div>
                <label className="text-sm text-muted-foreground">Vendedor</label>
                <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {sellers.map(s => <SelectItem key={s.userId} value={s.userId}>{s.displayName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Meta mensual (ARS)</label>
                <Input type="number" value={targetArs} onChange={e => setTargetArs(e.target.value)} placeholder="500000" className="mt-1" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Comisión (%)</label>
                <Input type="number" value={commissionPct} onChange={e => setCommissionPct(e.target.value)} placeholder="5" className="mt-1" />
              </div>
              <Button onClick={handleSave} disabled={saving || !selectedVendor || !targetArs} className="w-full gradient-gold text-primary-foreground font-semibold">
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : "Guardar Meta"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {currentGoals.length === 0 ? (
        <div className="bg-card border border-dashed border-border/40 rounded-xl p-10 text-center">
          <Target className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">Sin metas asignadas</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Asigná metas mensuales a los vendedores para hacer seguimiento</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentGoals.map(g => {
            const progress = g.target_ars > 0 ? Math.min((g.total_sales_ars / g.target_ars) * 100, 100) : 0;
            const commission = g.total_sales_ars * (g.commission_percent / 100);
            const isAchieved = progress >= 100;
            return (
              <div key={g.id} className="bg-card border border-border/40 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
                        {(g.vendor?.displayName || "V").charAt(0)}
                      </div>
                      <p className="font-semibold text-sm">{g.vendor?.displayName || "Vendedor"}</p>
                    </div>
                    <p className="text-xs text-muted-foreground ml-10">{g.commission_percent}% de comisión</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-2xl font-bold ${isAchieved ? "text-emerald-400" : progress >= 70 ? "text-yellow-400" : "text-primary"}`}>
                      {progress.toFixed(0)}%
                    </p>
                    {isAchieved && <span className="text-xs text-emerald-400 font-medium">✓ Alcanzada</span>}
                  </div>
                </div>
                <Progress value={progress} className={`h-2.5 mb-3 ${isAchieved ? "[&>div]:bg-emerald-500" : ""}`} />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-muted/20 rounded-lg p-2 text-center">
                    <p className="text-muted-foreground mb-0.5">Vendido</p>
                    <p className="font-semibold">{formatARS(g.total_sales_ars)}</p>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-2 text-center">
                    <p className="text-muted-foreground mb-0.5">Meta</p>
                    <p className="font-semibold">{formatARS(g.target_ars)}</p>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-2 text-center">
                    <p className="text-muted-foreground mb-0.5">Comisión</p>
                    <p className="font-semibold text-emerald-400">{formatARS(commission)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
