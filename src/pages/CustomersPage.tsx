import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getSalesDB, getDebtsDB, getSettingsDB, formatARS } from "@/lib/supabaseStore";
import { Users, TrendingUp, ShoppingBag, Star, Crown, AlertCircle, ArrowUpDown, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

type CustomerData = {
  name: string;
  totalSpent: number;
  totalProfit: number;
  purchaseCount: number;
  totalUnits: number;
  avgTicket: number;
  lastPurchase: string;
  firstPurchase: string;
  daysSinceLastPurchase: number;
  frequency: number; // avg days between purchases
  pendingDebt: number;
  products: Record<string, { qty: number; revenue: number }>;
  segment: string;
  segmentColor: string;
};

function getSegment(c: CustomerData): { label: string; color: string } {
  const now = Date.now();
  const daysSince = c.daysSinceLastPurchase;
  const isRecent = daysSince <= 30;
  const isFrequent = c.purchaseCount >= 5 || c.frequency <= 15;
  const isHighValue = c.totalSpent >= 100000;

  if (isHighValue && isFrequent && isRecent) return { label: "VIP", color: "bg-yellow-500/20 text-yellow-400" };
  if (isHighValue && isRecent) return { label: "Premium", color: "bg-purple-500/20 text-purple-400" };
  if (isFrequent && isRecent) return { label: "Frecuente", color: "bg-blue-500/20 text-blue-400" };
  if (isRecent) return { label: "Activo", color: "bg-green-500/20 text-green-400" };
  if (daysSince <= 60) return { label: "En riesgo", color: "bg-orange-500/20 text-orange-400" };
  if (daysSince <= 90) return { label: "Dormido", color: "bg-red-500/20 text-red-300" };
  return { label: "Perdido", color: "bg-muted text-muted-foreground" };
}

const SEGMENT_COLORS: Record<string, string> = {
  VIP: "hsl(45, 90%, 50%)", Premium: "hsl(280, 60%, 55%)", Frecuente: "hsl(210, 70%, 55%)",
  Activo: "hsl(150, 60%, 45%)", "En riesgo": "hsl(30, 80%, 55%)", Dormido: "hsl(0, 60%, 50%)", Perdido: "hsl(220, 10%, 45%)",
};

export default function CustomersPage() {
  const { user } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"totalSpent" | "purchaseCount" | "lastPurchase" | "avgTicket">("totalSpent");
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [s, d] = await Promise.all([getSalesDB(user.id), getDebtsDB(user.id)]);
      setSales(s);
      setDebts(d);
      setLoading(false);
    })();
  }, [user]);

  const customers = useMemo(() => {
    const map: Record<string, CustomerData> = {};
    const now = Date.now();

    sales.forEach((s: any) => {
      const name = s.customer_name || "Cliente anónimo";
      if (!map[name]) {
        map[name] = {
          name, totalSpent: 0, totalProfit: 0, purchaseCount: 0, totalUnits: 0, avgTicket: 0,
          lastPurchase: s.date, firstPurchase: s.date, daysSinceLastPurchase: 0,
          frequency: 0, pendingDebt: 0, products: {}, segment: "", segmentColor: "",
        };
      }
      const c = map[name];
      c.totalSpent += Number(s.total_ars);
      c.totalProfit += Number(s.profit_ars);
      c.purchaseCount++;
      c.totalUnits += s.quantity;
      if (new Date(s.date) > new Date(c.lastPurchase)) c.lastPurchase = s.date;
      if (new Date(s.date) < new Date(c.firstPurchase)) c.firstPurchase = s.date;

      const pName = s.product_name;
      if (!c.products[pName]) c.products[pName] = { qty: 0, revenue: 0 };
      c.products[pName].qty += s.quantity;
      c.products[pName].revenue += Number(s.total_ars);
    });

    debts.filter(d => d.status !== 'paid').forEach((d: any) => {
      const name = d.customer_name || "Cliente anónimo";
      if (map[name]) map[name].pendingDebt += Number(d.remaining_ars);
    });

    return Object.values(map).map(c => {
      c.avgTicket = c.purchaseCount > 0 ? c.totalSpent / c.purchaseCount : 0;
      c.daysSinceLastPurchase = Math.floor((now - new Date(c.lastPurchase).getTime()) / 86400000);
      const spanDays = Math.max(1, (new Date(c.lastPurchase).getTime() - new Date(c.firstPurchase).getTime()) / 86400000);
      c.frequency = c.purchaseCount > 1 ? Math.round(spanDays / (c.purchaseCount - 1)) : 999;
      const seg = getSegment(c);
      c.segment = seg.label;
      c.segmentColor = seg.color;
      return c;
    });
  }, [sales, debts]);

  const filtered = useMemo(() => {
    let list = customers;
    if (search) list = list.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    if (segmentFilter !== "all") list = list.filter(c => c.segment === segmentFilter);
    list.sort((a, b) => {
      if (sortBy === "lastPurchase") return new Date(b.lastPurchase).getTime() - new Date(a.lastPurchase).getTime();
      return (b as any)[sortBy] - (a as any)[sortBy];
    });
    return list;
  }, [customers, search, segmentFilter, sortBy]);

  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    customers.forEach(c => { counts[c.segment] = (counts[c.segment] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [customers]);

  const selected = selectedCustomer ? customers.find(c => c.name === selectedCustomer) : null;

  const tooltipStyle = { background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8, color: 'hsl(40, 20%, 92%)' };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const totalDebt = customers.reduce((s, c) => s + c.pendingDebt, 0);
  const avgTicketGlobal = customers.length ? totalRevenue / customers.reduce((s, c) => s + c.purchaseCount, 0) : 0;

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Clientes / CRM</h1>
          <p className="text-muted-foreground text-sm">{customers.length} clientes · {formatARS(totalRevenue)} facturado</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Clientes", value: customers.length, icon: Users, color: "text-primary" },
          { label: "Ticket Promedio", value: formatARS(avgTicketGlobal), icon: ShoppingBag, color: "text-accent" },
          { label: "VIP / Premium", value: customers.filter(c => c.segment === "VIP" || c.segment === "Premium").length, icon: Crown, color: "text-yellow-400" },
          { label: "Deuda Total", value: formatARS(totalDebt), icon: AlertCircle, color: "text-destructive" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3 md:p-4 shadow-card">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider">{k.label}</span>
              <k.icon className={`w-3.5 h-3.5 ${k.color}`} />
            </div>
            <p className="text-lg md:text-xl font-bold font-display">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Segmentation Chart */}
      {segmentCounts.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 mb-6 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Segmentación Automática</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {segmentCounts.map(s => (
              <button
                key={s.name}
                onClick={() => setSegmentFilter(segmentFilter === s.name ? "all" : s.name)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${segmentFilter === s.name ? 'ring-2 ring-primary' : ''}`}
                style={{ background: `${SEGMENT_COLORS[s.name]}22`, color: SEGMENT_COLORS[s.name] }}
              >
                {s.name} ({s.value})
              </button>
            ))}
            {segmentFilter !== "all" && (
              <button onClick={() => setSegmentFilter("all")} className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                Todos
              </button>
            )}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={segmentCounts} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} width={80} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Clientes">
                {segmentCounts.map((s, i) => <Cell key={i} fill={SEGMENT_COLORS[s.name] || 'hsl(220, 10%, 45%)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input placeholder="Buscar cliente..." value={search} onChange={e => setSearch(e.target.value)} className="bg-muted border-border sm:max-w-xs" />
        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
          <SelectTrigger className="bg-muted border-border w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="totalSpent">Mayor facturación</SelectItem>
            <SelectItem value="purchaseCount">Más compras</SelectItem>
            <SelectItem value="avgTicket">Mayor ticket</SelectItem>
            <SelectItem value="lastPurchase">Más reciente</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Customer List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>{search || segmentFilter !== "all" ? "Sin resultados" : "Registrá ventas con nombre de cliente para ver el CRM"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => (
            <div
              key={c.name}
              onClick={() => setSelectedCustomer(selectedCustomer === c.name ? null : c.name)}
              className={`bg-card border rounded-lg p-4 shadow-card cursor-pointer transition-all hover:border-primary/30 ${selectedCustomer === c.name ? 'border-primary' : 'border-border'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.purchaseCount} compras · Última: {new Date(c.lastPurchase).toLocaleDateString('es-AR')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.segmentColor}`}>{c.segment}</span>
                  {c.pendingDebt > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-destructive/20 text-destructive">Debe {formatARS(c.pendingDebt)}</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><span className="text-muted-foreground">Facturado:</span> <span className="font-medium">{formatARS(c.totalSpent)}</span></div>
                <div><span className="text-muted-foreground">Ganancia:</span> <span className="font-medium text-success">{formatARS(c.totalProfit)}</span></div>
                <div><span className="text-muted-foreground">Ticket prom.:</span> <span className="font-medium">{formatARS(c.avgTicket)}</span></div>
                <div><span className="text-muted-foreground">Frecuencia:</span> <span className="font-medium">{c.frequency < 999 ? `c/${c.frequency}d` : 'Única vez'}</span></div>
              </div>

              {/* Expanded details */}
              {selectedCustomer === c.name && (
                <div className="mt-4 pt-4 border-t border-border">
                  <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Productos favoritos</h3>
                  <div className="space-y-1.5">
                    {Object.entries(c.products).sort(([, a], [, b]) => b.revenue - a.revenue).slice(0, 5).map(([name, data]) => (
                      <div key={name} className="flex items-center justify-between text-xs">
                        <span className="truncate mr-2">{name}</span>
                        <span className="text-muted-foreground shrink-0">{data.qty}u · {formatARS(data.revenue)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                    <div className="bg-muted rounded-lg p-2.5">
                      <span className="text-muted-foreground">Primera compra</span>
                      <p className="font-medium">{new Date(c.firstPurchase).toLocaleDateString('es-AR')}</p>
                    </div>
                    <div className="bg-muted rounded-lg p-2.5">
                      <span className="text-muted-foreground">Unidades totales</span>
                      <p className="font-medium">{c.totalUnits}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
