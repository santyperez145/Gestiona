import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  getSalesDB, getDebtsDB, getSettingsDB, formatARS,
  getCustomersDB, createCustomerDB, updateCustomerDB, deleteCustomerDB,
} from "@/lib/supabaseStore";
import {
  Users, ShoppingBag, Crown, AlertCircle,
  MessageCircle, Plus, Edit2, Trash2, X, Save, Phone, Mail, MapPin,
  Calendar, Tag, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
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
  frequency: number;
  pendingDebt: number;
  products: Record<string, { qty: number; revenue: number }>;
  segment: string;
  segmentColor: string;
  // Profile from customers table (if exists)
  profileId?: string;
  email?: string;
  phone?: string;
  address?: string;
  birthday?: string;
  tags?: string[];
  profileNotes?: string;
};

type CustomerProfile = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  birthday?: string;
  tags?: string[];
  notes?: string;
};

// ─────────────────────────────────────────────────────────────
// Segmentation
// ─────────────────────────────────────────────────────────────
function getSegment(c: CustomerData): { label: string; color: string } {
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
  VIP: "hsl(45, 90%, 50%)",
  Premium: "hsl(280, 60%, 55%)",
  Frecuente: "hsl(210, 70%, 55%)",
  Activo: "hsl(150, 60%, 45%)",
  "En riesgo": "hsl(30, 80%, 55%)",
  Dormido: "hsl(0, 60%, 50%)",
  Perdido: "hsl(220, 10%, 45%)",
};

// ─────────────────────────────────────────────────────────────
// Customer Form Modal (Create / Edit)
// ─────────────────────────────────────────────────────────────
function CustomerFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<CustomerProfile>;
  onSave: (data: Partial<CustomerProfile>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    address: initial?.address ?? "",
    birthday: initial?.birthday ?? "",
    tags: (initial?.tags ?? []).join(", "),
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        birthday: form.birthday || undefined,
        tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        notes: form.notes.trim() || undefined,
      });
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold">{initial?.id ? "Editar cliente" : "Nuevo cliente"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nombre *</label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Nombre completo"
              className="bg-muted"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Mail className="w-3 h-3" />Email</label>
              <Input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@ejemplo.com"
                className="bg-muted"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Phone className="w-3 h-3" />Teléfono</label>
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+54 9 11..."
                className="bg-muted"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Dirección</label>
            <Input
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Calle, número, localidad"
              className="bg-muted"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Cumpleaños</label>
            <Input
              type="date"
              value={form.birthday}
              onChange={e => setForm(f => ({ ...f, birthday: e.target.value }))}
              className="bg-muted"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Tag className="w-3 h-3" />Etiquetas (separadas por coma)</label>
            <Input
              value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="VIP, Mayorista, Barrio Norte"
              className="bg-muted"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notas internas</label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Preferencias, historial, recordatorios..."
              className="bg-muted resize-none"
              rows={3}
            />
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {initial?.id ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const { user } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"totalSpent" | "purchaseCount" | "lastPurchase" | "avgTicket">("totalSpent");
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [formModal, setFormModal] = useState<{ open: boolean; profile?: CustomerProfile }>({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = async () => {
    if (!user) return;
    const [s, d, st, profs] = await Promise.all([
      getSalesDB(user.id),
      getDebtsDB(user.id),
      getSettingsDB(user.id),
      getCustomersDB(user.id).catch(() => [] as CustomerProfile[]),
    ]);
    setSales(s);
    setDebts(d);
    setSettings(st);
    setProfiles(profs);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user]);

  // Build profile map by name for quick lookup
  const profileByName = useMemo(() => {
    const map: Record<string, CustomerProfile> = {};
    profiles.forEach(p => { map[p.name.toLowerCase()] = p; });
    return map;
  }, [profiles]);

  // Aggregate customer data from sales
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

    debts.filter(d => d.status !== "paid").forEach((d: any) => {
      const name = d.customer_name || "Cliente anónimo";
      if (map[name]) map[name].pendingDebt += Number(d.remaining_ars);
    });

    // Merge profiles
    profiles.forEach(p => {
      if (!map[p.name]) {
        // Profile exists but no sales yet — show it anyway
        map[p.name] = {
          name: p.name, totalSpent: 0, totalProfit: 0, purchaseCount: 0, totalUnits: 0,
          avgTicket: 0, lastPurchase: new Date().toISOString(), firstPurchase: new Date().toISOString(),
          daysSinceLastPurchase: 999, frequency: 999, pendingDebt: 0, products: {},
          segment: "Sin compras", segmentColor: "bg-muted text-muted-foreground",
        };
      }
      const prof = profileByName[p.name.toLowerCase()];
      if (prof) {
        const c = map[p.name];
        c.profileId = prof.id;
        c.email = prof.email;
        c.phone = prof.phone;
        c.address = prof.address;
        c.birthday = prof.birthday;
        c.tags = prof.tags;
        c.profileNotes = prof.notes;
      }
    });

    return Object.values(map).map(c => {
      c.avgTicket = c.purchaseCount > 0 ? c.totalSpent / c.purchaseCount : 0;
      c.daysSinceLastPurchase = Math.floor((now - new Date(c.lastPurchase).getTime()) / 86400000);
      const spanDays = Math.max(1, (new Date(c.lastPurchase).getTime() - new Date(c.firstPurchase).getTime()) / 86400000);
      c.frequency = c.purchaseCount > 1 ? Math.round(spanDays / (c.purchaseCount - 1)) : 999;
      if (c.segment !== "Sin compras") {
        const seg = getSegment(c);
        c.segment = seg.label;
        c.segmentColor = seg.color;
      }
      return c;
    });
  }, [sales, debts, profiles, profileByName]);

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

  const handleCreate = async (data: Partial<CustomerProfile>) => {
    if (!user) return;
    await createCustomerDB(user.id, data as any);
    toast.success("Cliente creado");
    await loadData();
  };

  const handleUpdate = async (id: string, data: Partial<CustomerProfile>) => {
    await updateCustomerDB(id, data as any);
    toast.success("Cliente actualizado");
    await loadData();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar el perfil de "${name}"? (no se eliminarán las ventas asociadas)`)) return;
    setDeletingId(id);
    try {
      await deleteCustomerDB(id);
      toast.success("Perfil eliminado");
      await loadData();
      if (selectedCustomer === name) setSelectedCustomer(null);
    } finally {
      setDeletingId(null);
    }
  };

  const tooltipStyle = {
    background: "hsl(220, 18%, 12%)",
    border: "1px solid hsl(220, 15%, 18%)",
    borderRadius: 8,
    color: "hsl(40, 20%, 92%)",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const totalDebt = customers.reduce((s, c) => s + c.pendingDebt, 0);
  const totalPurchases = customers.reduce((s, c) => s + c.purchaseCount, 0);
  const avgTicketGlobal = totalPurchases > 0 ? totalRevenue / totalPurchases : 0;

  return (
    <div>
      {/* Form modal */}
      {formModal.open && (
        <CustomerFormModal
          initial={formModal.profile}
          onSave={formModal.profile?.id
            ? (data) => handleUpdate(formModal.profile!.id!, data)
            : handleCreate
          }
          onClose={() => setFormModal({ open: false })}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Clientes / CRM</h1>
          <p className="text-muted-foreground text-sm">{customers.length} clientes · {formatARS(totalRevenue)} facturado</p>
        </div>
        <Button
          onClick={() => setFormModal({ open: true })}
          className="gradient-gold text-primary-foreground gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />Nuevo cliente
        </Button>
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
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${segmentFilter === s.name ? "ring-2 ring-primary" : ""}`}
                style={{ background: `${SEGMENT_COLORS[s.name] || "hsl(220, 10%, 45%)"}22`, color: SEGMENT_COLORS[s.name] || "hsl(220, 10%, 45%)" }}
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
              <YAxis type="category" dataKey="name" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 11 }} width={80} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Clientes">
                {segmentCounts.map((s, i) => <Cell key={i} fill={SEGMENT_COLORS[s.name] || "hsl(220, 10%, 45%)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Input
          placeholder="Buscar cliente..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-muted border-border sm:max-w-xs"
        />
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
          <p className="mb-4">{search || segmentFilter !== "all" ? "Sin resultados" : "Registrá ventas con nombre de cliente o creá uno manualmente"}</p>
          {!search && segmentFilter === "all" && (
            <Button variant="outline" onClick={() => setFormModal({ open: true })} className="gap-2">
              <Plus className="w-4 h-4" />Crear primer cliente
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const isExpanded = selectedCustomer === c.name;
            return (
              <div
                key={c.name}
                className={`bg-card border rounded-lg shadow-card transition-all ${isExpanded ? "border-primary" : "border-border hover:border-primary/30"}`}
              >
                {/* Main row */}
                <div
                  className="p-4 cursor-pointer"
                  onClick={() => setSelectedCustomer(isExpanded ? null : c.name)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{c.name}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.purchaseCount > 0 ? (
                            <p className="text-xs text-muted-foreground">{c.purchaseCount} compras · Última: {new Date(c.lastPurchase).toLocaleDateString("es-AR")}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">Sin compras registradas</p>
                          )}
                          {c.phone && (
                            <a
                              href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-[10px] text-green-400 flex items-center gap-0.5 hover:underline"
                            >
                              <MessageCircle className="w-3 h-3" />{c.phone}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.segmentColor}`}>{c.segment}</span>
                      {c.pendingDebt > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-destructive/20 text-destructive hidden sm:block">
                          Debe {formatARS(c.pendingDebt)}
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {/* Tags */}
                  {c.tags && c.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {c.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground border border-border">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {c.purchaseCount > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Facturado: </span><span className="font-medium">{formatARS(c.totalSpent)}</span></div>
                      <div><span className="text-muted-foreground">Ganancia: </span><span className="font-medium text-success">{formatARS(c.totalProfit)}</span></div>
                      <div><span className="text-muted-foreground">Ticket prom.: </span><span className="font-medium">{formatARS(c.avgTicket)}</span></div>
                      <div><span className="text-muted-foreground">Frecuencia: </span><span className="font-medium">{c.frequency < 999 ? `c/${c.frequency}d` : "Única vez"}</span></div>
                    </div>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-border space-y-4">
                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs"
                        onClick={() => setFormModal({
                          open: true,
                          profile: c.profileId ? {
                            id: c.profileId, name: c.name, email: c.email, phone: c.phone,
                            address: c.address, birthday: c.birthday, tags: c.tags, notes: c.profileNotes,
                          } : { name: c.name },
                        })}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        {c.profileId ? "Editar perfil" : "Crear perfil"}
                      </Button>
                      {c.profileId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
                          onClick={() => handleDelete(c.profileId!, c.name)}
                          disabled={deletingId === c.profileId}
                        >
                          <Trash2 className="w-3.5 h-3.5" />Eliminar perfil
                        </Button>
                      )}
                    </div>

                    {/* Profile fields */}
                    {(c.email || c.phone || c.address || c.birthday) && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {c.email && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="w-3 h-3 shrink-0" />
                            <a href={`mailto:${c.email}`} className="hover:underline truncate">{c.email}</a>
                          </div>
                        )}
                        {c.phone && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="w-3 h-3 shrink-0" />
                            <a
                              href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline text-green-400"
                            >
                              {c.phone}
                            </a>
                          </div>
                        )}
                        {c.address && (
                          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                            <MapPin className="w-3 h-3 shrink-0" />{c.address}
                          </div>
                        )}
                        {c.birthday && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="w-3 h-3 shrink-0" />
                            {new Date(c.birthday + "T12:00:00").toLocaleDateString("es-AR")}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notes */}
                    {c.profileNotes && (
                      <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground mb-1">Notas</p>
                        {c.profileNotes}
                      </div>
                    )}

                    {/* Pending debt */}
                    {c.pendingDebt > 0 && (
                      <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-xs text-destructive font-medium">
                        ⚠️ Deuda pendiente: {formatARS(c.pendingDebt)}
                      </div>
                    )}

                    {/* Favorite products */}
                    {Object.keys(c.products).length > 0 && (
                      <div>
                        <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Productos favoritos</h3>
                        <div className="space-y-1.5">
                          {Object.entries(c.products)
                            .sort(([, a], [, b]) => b.revenue - a.revenue)
                            .slice(0, 5)
                            .map(([name, data]) => (
                              <div key={name} className="flex items-center justify-between text-xs">
                                <span className="truncate mr-2">{name}</span>
                                <span className="text-muted-foreground shrink-0">{data.qty}u · {formatARS(data.revenue)}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Purchase history stats */}
                    {c.purchaseCount > 0 && (
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-muted rounded-lg p-2.5">
                          <span className="text-muted-foreground">Primera compra</span>
                          <p className="font-medium">{new Date(c.firstPurchase).toLocaleDateString("es-AR")}</p>
                        </div>
                        <div className="bg-muted rounded-lg p-2.5">
                          <span className="text-muted-foreground">Unidades totales</span>
                          <p className="font-medium">{c.totalUnits}</p>
                        </div>
                      </div>
                    )}

                    {/* WhatsApp Remarketing */}
                    {settings?.whatsapp_number && (
                      <div>
                        <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" />Remarketing WhatsApp
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            const templates: { label: string; msg: string; color: string }[] = [];
                            const firstName = c.name.split(" ")[0];
                            if (c.segment === "VIP" || c.segment === "Premium") {
                              templates.push({ label: "👑 Oferta VIP", msg: `Hola ${firstName}! Como cliente VIP tenés acceso a ofertas exclusivas antes que nadie. ¿Querés que te cuente las novedades? 🔥`, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" });
                            }
                            if (c.segment === "Dormido" || c.segment === "Perdido") {
                              templates.push({ label: "💤 Re-activar", msg: `¡Hola ${firstName}! Te extrañamos 😊 Tenemos novedades que te van a encantar. ¿Querés que te reserve algo? 🔥`, color: "bg-red-500/20 text-red-300 border-red-500/30" });
                            }
                            if (c.segment === "En riesgo") {
                              templates.push({ label: "⚠️ Retener", msg: `Hola ${firstName}, hace tiempo no nos visitás. Tenemos productos nuevos que seguro te gustan. ¿Querés que te cuente? 😊`, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" });
                            }
                            templates.push({ label: "📦 Nuevo producto", msg: `Hola ${firstName}! Llegaron productos nuevos que te van a interesar. ¿Querés que te mande el catálogo? 🛍️`, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" });
                            templates.push({ label: "🎉 Promo", msg: `Hola ${firstName}! Tenemos una promo especial solo por hoy. ¿Te interesa? 🔥`, color: "bg-green-500/20 text-green-400 border-green-500/30" });

                            const waNum = (c.phone || settings.whatsapp_number).replace(/[^0-9]/g, "");
                            return templates.map(t => (
                              <a
                                key={t.label}
                                href={`https://wa.me/${waNum}?text=${encodeURIComponent(t.msg)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-all hover:scale-105 ${t.color}`}
                              >
                                {t.label}
                              </a>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
