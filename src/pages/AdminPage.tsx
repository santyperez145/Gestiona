import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, formatUSD, getAuditLogsDB } from "@/lib/supabaseStore";
import { Shield, Users, TrendingUp, DollarSign, Package, Crown, UserPlus, BarChart3, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { toast } from "sonner";

const COLORS = ['hsl(40, 70%, 50%)', 'hsl(150, 60%, 40%)', 'hsl(200, 60%, 50%)', 'hsl(0, 70%, 50%)', 'hsl(280, 60%, 50%)'];

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
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<VendorStats[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [period, setPeriod] = useState('all');
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'audit'>('overview');

  useEffect(() => {
    if (!user) return;
    checkAdminAndLoad();
  }, [user]);

  const checkAdminAndLoad = async () => {
    if (!user) return;
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    const admin = roleData?.some(r => r.role === 'admin') || false;
    setIsAdmin(admin);
    if (admin) {
      await loadVendorData();
      getAuditLogsDB(50).then(setAuditLogs).catch(() => {});
    }
    setLoading(false);
  };

  const loadVendorData = async () => {
    // Get all profiles
    const { data: profiles } = await supabase.from('profiles').select('*');
    if (!profiles) return;

    // Get all roles
    const { data: roles } = await supabase.from('user_roles').select('*');

    // Get all sales
    const { data: allSales } = await supabase.from('sales').select('*').order('date', { ascending: false });

    // Get products count per user
    const { data: allProducts } = await supabase.from('products').select('user_id, id');

    const vendorMap: Record<string, VendorStats> = {};
    
    for (const p of profiles) {
      const userRoles = roles?.filter(r => r.user_id === p.user_id) || [];
      const role = userRoles.map(r => r.role).join(', ') || 'viewer';
      const userSales = (allSales || []).filter(s => s.user_id === p.user_id);
      const userProducts = (allProducts || []).filter(pr => pr.user_id === p.user_id);
      
      const totalRevenue = userSales.reduce((sum, s) => sum + Number(s.total_ars), 0);
      const totalProfit = userSales.reduce((sum, s) => sum + Number(s.profit_ars), 0);

      vendorMap[p.user_id] = {
        userId: p.user_id,
        email: p.display_name || p.user_id,
        displayName: p.display_name || 'Sin nombre',
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

  const totals = useMemo(() => {
    return {
      revenue: vendors.reduce((s, v) => s + v.totalRevenue, 0),
      profit: vendors.reduce((s, v) => s + v.totalProfit, 0),
      sales: vendors.reduce((s, v) => s + v.totalSales, 0),
      vendors: vendors.length,
    };
  }, [vendors]);

  const chartData = useMemo(() => {
    return vendors
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10)
      .map(v => ({
        name: v.displayName.slice(0, 15),
        ventas: v.totalRevenue,
        ganancia: v.totalProfit,
      }));
  }, [vendors]);

  const roleDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    vendors.forEach(v => {
      const r = v.role || 'vendedor';
      counts[r] = (counts[r] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [vendors]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <Shield className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-display font-bold mb-2">Acceso Restringido</h1>
        <p className="text-muted-foreground">Solo los administradores pueden acceder a este panel.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <Crown className="w-6 h-6 text-primary" />Panel de Administración
          </h1>
          <p className="text-muted-foreground text-sm">Gestión de vendedores y rendimiento global</p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-muted rounded-lg p-0.5">
            <Button variant={activeTab === 'overview' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('overview')}>Rendimiento</Button>
            <Button variant={activeTab === 'audit' ? 'default' : 'ghost'} size="sm" onClick={() => setActiveTab('audit')} className="gap-1"><ClipboardList className="w-3.5 h-3.5" />Auditoría</Button>
          </div>
          <AssignRoleDialog onDone={loadVendorData} />
        </div>
      </div>

      {activeTab === 'overview' && (<>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Vendedores', value: totals.vendors, icon: Users, sub: 'Registrados' },
          { label: 'Ventas Totales', value: totals.sales, icon: BarChart3, sub: 'Transacciones' },
          { label: 'Facturación', value: formatARS(totals.revenue), icon: DollarSign, sub: 'Total' },
          { label: 'Ganancia', value: formatARS(totals.profit), icon: TrendingUp, sub: 'Neta' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">{kpi.label}</span>
              <kpi.icon className="w-4 h-4 text-primary" />
            </div>
            <p className="text-xl font-bold">{kpi.value}</p>
            <p className="text-xs text-muted-foreground">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4">
          <h3 className="font-display font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-4">Rendimiento por Vendedor</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(40, 10%, 60%)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(40, 10%, 60%)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatARS(v)} contentStyle={{ background: 'hsl(220, 20%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8 }} />
                <Bar dataKey="ventas" fill={COLORS[0]} radius={[4, 4, 0, 0]} name="Ventas" />
                <Bar dataKey="ganancia" fill={COLORS[1]} radius={[4, 4, 0, 0]} name="Ganancia" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-center py-10">Sin datos aún</p>
          )}
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-display font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-4">Distribución de Roles</h3>
          {roleDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={roleDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                  {roleDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'hsl(220, 20%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-center py-10">Sin datos</p>
          )}
        </div>
      </div>

      {/* Vendors table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-display font-semibold">Vendedores ({vendors.length})</h3>
        </div>

        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3 font-medium">Vendedor</th>
                <th className="text-left p-3 font-medium">Rol</th>
                <th className="text-right p-3 font-medium">Productos</th>
                <th className="text-right p-3 font-medium">Ventas</th>
                <th className="text-right p-3 font-medium">Facturación</th>
                <th className="text-right p-3 font-medium">Ganancia</th>
                <th className="text-right p-3 font-medium">Ticket Prom.</th>
                <th className="text-left p-3 font-medium">Última Venta</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map(v => (
                <tr key={v.userId} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="p-3">
                    <p className="font-medium">{v.displayName}</p>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      v.role.includes('admin') ? 'bg-yellow-500/20 text-yellow-400' : v.role.includes('vendedor') ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-500/20 text-zinc-400'
                    }`}>{v.role || 'viewer'}</span>
                  </td>
                  <td className="p-3 text-right">{v.totalProducts}</td>
                  <td className="p-3 text-right">{v.totalSales}</td>
                  <td className="p-3 text-right font-medium">{formatARS(v.totalRevenue)}</td>
                  <td className="p-3 text-right text-success font-medium">{formatARS(v.totalProfit)}</td>
                  <td className="p-3 text-right">{formatARS(v.avgTicket)}</td>
                  <td className="p-3 text-muted-foreground text-sm">{v.lastSale ? new Date(v.lastSale).toLocaleDateString('es-AR') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-border">
          {vendors.map(v => (
            <div key={v.userId} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{v.displayName}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    v.role.includes('admin') ? 'bg-yellow-500/20 text-yellow-400' : v.role.includes('vendedor') ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-500/20 text-zinc-400'
                  }`}>{v.role || 'viewer'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Ventas:</span> <span className="font-medium">{v.totalSales}</span></div>
                <div><span className="text-muted-foreground">Productos:</span> <span className="font-medium">{v.totalProducts}</span></div>
                <div><span className="text-muted-foreground">Facturación:</span> <span className="font-medium">{formatARS(v.totalRevenue)}</span></div>
                <div><span className="text-muted-foreground">Ganancia:</span> <span className="text-success font-medium">{formatARS(v.totalProfit)}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>
      </>)}

      {/* Audit Log Tab */}
      {activeTab === 'audit' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-display font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4 text-primary" />Actividad Reciente ({auditLogs.length})</h3>
          </div>
          <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
            {auditLogs.length === 0 ? (
              <p className="text-center text-muted-foreground py-10 text-sm">No hay actividad registrada</p>
            ) : auditLogs.map(log => {
              const details = typeof log.details === 'object' ? log.details : {};
              return (
                <div key={log.id} className="p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        log.action === 'delete' ? 'bg-destructive/20 text-destructive' :
                        log.action === 'create' ? 'bg-success/20 text-success' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>{log.action}</span>
                      <span className="text-xs font-medium">{log.entity_type}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{new Date(log.created_at).toLocaleString('es-AR')}</span>
                  </div>
                  {details && Object.keys(details).length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">
                      {Object.entries(details).map(([k, v]) => `${k}: ${typeof v === 'number' ? formatARS(v as number) : v}`).join(' · ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignRoleDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'vendedor' | 'viewer'>('vendedor');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from('profiles').select('*').then(({ data }) => setProfiles(data || []));
  }, [open]);

  const handleAssign = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      // Delete existing role first, then insert new one
      await supabase.from('user_roles').delete().eq('user_id', selectedUser);
      const { error } = await supabase.from('user_roles').insert({ user_id: selectedUser, role: selectedRole });
      if (error) throw error;
      toast.success(`Rol ${selectedRole} asignado correctamente`);
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
        <Button variant="outline" size="sm"><UserPlus className="w-4 h-4 mr-2" />Asignar Rol</Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader><DialogTitle className="font-display">Asignar Rol a Usuario</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Usuario</label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar usuario..." /></SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.display_name || p.user_id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Rol</label>
            <Select value={selectedRole} onValueChange={v => setSelectedRole(v as any)}>
              <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="vendedor">Vendedor</SelectItem>
                <SelectItem value="viewer">Viewer (sin acceso)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAssign} disabled={saving || !selectedUser} className="w-full gradient-gold text-primary-foreground font-semibold">
            {saving ? 'Asignando...' : 'Asignar Rol'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
