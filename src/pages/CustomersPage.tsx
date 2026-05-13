import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  getSalesDB, getDebtsDB, getSettingsDB, formatARS,
  getCustomersDB, createCustomerDB, updateCustomerDB, deleteCustomerDB,
  getCRMSegmentsDB, saveCRMSegmentsDB, type SavedCRMSegment,
} from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import {
  Users, ShoppingBag, Crown, AlertCircle,
  MessageCircle, Plus, Edit2, Trash2, X, Save, Phone, Mail, MapPin,
  Calendar, Tag, ChevronDown, ChevronUp, Upload, Clock, FileText, CreditCard,
  Star, TrendingUp, Package, Gift, Merge, Download,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePermissions } from "@/lib/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  healthScore: number;
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

function computeHealthScore(c: CustomerData, monetarySorted: number[]): number {
  if (c.purchaseCount === 0) return 0;

  // Recency — 0 to 35 points
  const d = c.daysSinceLastPurchase;
  const recency = d <= 7 ? 35 : d <= 14 ? 28 : d <= 30 ? 20 : d <= 60 ? 10 : d <= 90 ? 5 : 0;

  // Frequency — 0 to 35 points
  const p = c.purchaseCount;
  const freq = p >= 10 ? 35 : p >= 7 ? 28 : p >= 5 ? 21 : p >= 3 ? 14 : p >= 2 ? 7 : 4;

  // Monetary — 0 to 30 points via percentile
  const rank = monetarySorted.filter(s => s <= c.totalSpent).length;
  const monetary = monetarySorted.length > 0 ? Math.round((rank / monetarySorted.length) * 30) : 0;

  return Math.min(100, recency + freq + monetary);
}

function HealthScoreBadge({ score }: { score: number }) {
  const { color, label } = score >= 80
    ? { color: "text-yellow-400 bg-yellow-400/15 border-yellow-400/30", label: "⭐" }
    : score >= 60
    ? { color: "text-green-400 bg-green-400/15 border-green-400/30", label: "●" }
    : score >= 40
    ? { color: "text-blue-400 bg-blue-400/15 border-blue-400/30", label: "●" }
    : score >= 20
    ? { color: "text-orange-400 bg-orange-400/15 border-orange-400/30", label: "●" }
    : { color: "text-red-400 bg-red-400/15 border-red-400/30", label: "●" };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${color}`}
      title={`Score de salud: ${score}/100 (Recency + Frequency + Monetary)`}
    >
      {label} {score}
    </span>
  );
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
// Communications log component
// ─────────────────────────────────────────────────────────────
const COMM_TYPES = [
  { value: "note", label: "Nota", icon: "📝" },
  { value: "call", label: "Llamada", icon: "📞" },
  { value: "whatsapp", label: "WhatsApp", icon: "💬" },
  { value: "email", label: "Email", icon: "📧" },
  { value: "visit", label: "Visita", icon: "🏪" },
  { value: "other", label: "Otro", icon: "📌" },
];

type CommEntry = { id: string; type: string; summary: string; created_at: string };

// ─────────────────────────────────────────────────────────────
// Customer Sales Timeline — 360 view
// ─────────────────────────────────────────────────────────────
const PAY_COLOR: Record<string, string> = {
  efectivo:      "text-green-400",
  transferencia: "text-blue-400",
  debito:        "text-primary",
  credito:       "text-yellow-400",
  mayorista:     "text-purple-400",
  fiado:         "text-destructive",
};

function CustomerSalesTimeline({
  customerName,
  sales,
  debts,
  onCreateInvoice,
}: {
  customerName: string;
  sales: any[];
  debts: any[];
  onCreateInvoice: (sale: any) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const customerSales = useMemo(
    () =>
      sales
        .filter((s: any) => s.customer_name?.toLowerCase() === customerName.toLowerCase())
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [sales, customerName],
  );

  const customerDebts = useMemo(
    () => debts.filter((d: any) => d.customer_name?.toLowerCase() === customerName.toLowerCase()),
    [debts, customerName],
  );

  const shown = showAll ? customerSales : customerSales.slice(0, 5);

  if (customerSales.length === 0 && customerDebts.filter((d: any) => d.status !== "paid").length === 0) return null;

  return (
    <div className="space-y-3">
      {customerSales.length > 0 && (
        <div>
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />Historial de compras ({customerSales.length})
          </h3>
          <div className="space-y-1.5">
            {shown.map((s: any) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 group hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium truncate">{s.product_name}</span>
                    {s.quantity > 1 && <span className="text-[10px] bg-muted rounded px-1 text-muted-foreground">x{s.quantity}</span>}
                    {!s.paid && <span className="text-[10px] bg-destructive/20 text-destructive rounded px-1">DEBE</span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(s.date).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                    {s.payment_method && <span className={`ml-1 ${PAY_COLOR[s.payment_method] ?? ""}`}>· {s.payment_method}</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono font-semibold">{formatARS(Number(s.total_ars))}</p>
                  <button
                    onClick={() => onCreateInvoice(s)}
                    className="text-[10px] text-primary hover:underline hidden group-hover:block"
                    title="Crear factura desde esta venta"
                  >
                    + factura
                  </button>
                </div>
              </div>
            ))}
          </div>
          {customerSales.length > 5 && (
            <button className="text-xs text-primary hover:underline mt-1.5" onClick={() => setShowAll(v => !v)}>
              {showAll ? "Mostrar menos" : `Ver ${customerSales.length - 5} más`}
            </button>
          )}
        </div>
      )}

      {customerDebts.filter((d: any) => d.status !== "paid").length > 0 && (
        <div>
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 text-destructive" />Deudas pendientes
          </h3>
          <div className="space-y-1.5">
            {customerDebts
              .filter((d: any) => d.status !== "paid")
              .map((d: any) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg bg-destructive/8 border border-destructive/20 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium">{d.description || "Deuda sin descripción"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(d.date).toLocaleDateString("es-AR")}
                      {d.due_date && ` · vence ${new Date(d.due_date).toLocaleDateString("es-AR")}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono font-semibold text-destructive">{formatARS(Number(d.remaining_ars))}</p>
                    <p className="text-[10px] text-muted-foreground">de {formatARS(Number(d.amount_ars))}</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CommunicationsLog({ orgId, userId, customerName }: { orgId: string; userId: string; customerName: string }) {
  const [entries, setEntries] = useState<CommEntry[]>([]);
  const [type, setType] = useState("note");
  const [summary, setSummary] = useState("");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    supabase
      .from("customer_communications")
      .select("id,type,summary,created_at")
      .eq("org_id", orgId)
      .eq("customer_name", customerName)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setEntries((data || []) as CommEntry[]));
  }, [orgId, customerName]);

  const handleAdd = async () => {
    if (!summary.trim()) return;
    setAdding(true);
    try {
      const { data, error } = await supabase
        .from("customer_communications")
        .insert({ org_id: orgId, user_id: userId, customer_name: customerName, type, summary: summary.trim() })
        .select("id,type,summary,created_at")
        .single();
      if (error) throw error;
      setEntries(prev => [data as CommEntry, ...prev]);
      setSummary("");
      setShowForm(false);
      toast.success("Interacción registrada");
    } catch { toast.error("Error al guardar"); }
    finally { setAdding(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="w-3 h-3" />Historial de comunicaciones
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          <Plus className="w-3 h-3" />Agregar
        </button>
      </div>

      {showForm && (
        <div className="bg-muted/40 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-3 gap-1">
            {COMM_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`flex items-center gap-1 justify-center py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                  type === t.value ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                }`}
              >
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <Textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="Descripción de la interacción..."
            className="bg-card resize-none text-xs"
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 text-xs h-7" onClick={handleAdd} disabled={adding || !summary.trim()}>
              {adding ? "Guardando…" : "Guardar"}
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowForm(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/50 italic py-1">Sin interacciones registradas</p>
      ) : (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {entries.map(e => {
            const t = COMM_TYPES.find(ct => ct.value === e.type);
            return (
              <div key={e.id} className="flex gap-2 text-xs bg-muted/30 rounded-lg px-2.5 py-2">
                <span className="shrink-0">{t?.icon || "📌"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground leading-tight">{e.summary}</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">
                    {t?.label} · {new Date(e.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} {new Date(e.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { canCreate, canEdit, canDelete } = usePermissions();
  const [sales, setSales] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"totalSpent" | "purchaseCount" | "lastPurchase" | "avgTicket" | "healthScore">("totalSpent");
  const [savedSegments, setSavedSegments] = useState<SavedCRMSegment[]>([]);
  const [saveSegmentName, setSaveSegmentName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [formModal, setFormModal] = useState<{ open: boolean; profile?: CustomerProfile }>({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [installments, setInstallments] = useState<any[]>([]);
  const [payingInstallment, setPayingInstallment] = useState<string | null>(null);
  const [loyaltyBalances, setLoyaltyBalances] = useState<Record<string, number>>({});
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [mergingCustomer, setMergingCustomer] = useState<string | null>(null); // source name
  const [mergeTarget, setMergeTarget] = useState("");
  const [merging, setMerging] = useState(false);

  const loadData = async () => {
    if (!user) return;
    const [s, d, st, profs, segs] = await Promise.all([
      getSalesDB(user.id),
      getDebtsDB(user.id),
      getSettingsDB(user.id),
      getCustomersDB(user.id).catch(() => [] as CustomerProfile[]),
      getCRMSegmentsDB(user.id).catch(() => [] as SavedCRMSegment[]),
    ]);
    setSales(s);
    setDebts(d);
    setSettings(st);
    setProfiles(profs);
    // Merge DB segments with any existing localStorage segments (migration)
    const lsRaw = localStorage.getItem("gestiona.crm.saved_segments");
    const lsSegs: SavedCRMSegment[] = lsRaw ? JSON.parse(lsRaw) : [];
    if (segs.length === 0 && lsSegs.length > 0) {
      // Migrate from localStorage to DB
      saveCRMSegmentsDB(user.id, lsSegs).then(() => {
        localStorage.removeItem("gestiona.crm.saved_segments");
      });
      setSavedSegments(lsSegs);
    } else {
      setSavedSegments(segs);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user]);

  useEffect(() => {
    if (!activeOrg) return;
    supabase
      .from('installment_schedule')
      .select('id, sale_id, installment_number, amount_ars, due_date, paid, sale:sale_id(customer_name, product_name)')
      .eq('org_id', activeOrg.id)
      .eq('paid', false)
      .order('due_date', { ascending: true })
      .then(({ data }) => setInstallments(data || []));
  }, [activeOrg]);

  const handleMergeCustomers = async () => {
    if (!activeOrg || !mergingCustomer || !mergeTarget.trim()) return;
    const target = mergeTarget.trim();
    if (target.toLowerCase() === mergingCustomer.toLowerCase()) {
      toast.error("El cliente destino debe ser diferente al origen");
      return;
    }
    if (!confirm(`¿Combinar "${mergingCustomer}" en "${target}"? Todas las ventas, deudas y puntos del cliente origen se reasignarán al destino. Esta acción no se puede deshacer.`)) return;
    setMerging(true);
    try {
      const orgId = activeOrg.id;
      // Update sales
      await supabase.from("sales").update({ customer_name: target }).eq("org_id", orgId).eq("customer_name", mergingCustomer);
      // Update debts
      await supabase.from("debts").update({ customer_name: target }).eq("org_id", orgId).eq("customer_name", mergingCustomer);
      // Update loyalty_points
      await supabase.from("loyalty_points").update({ customer_name: target }).eq("org_id", orgId).eq("customer_name", mergingCustomer);
      // Delete source profile (if exists)
      const srcProfile = profiles.find(p => p.name.toLowerCase() === mergingCustomer.toLowerCase());
      if (srcProfile) {
        await supabase.from("customers").delete().eq("id", srcProfile.id);
      }
      toast.success(`"${mergingCustomer}" fusionado con "${target}"`);
      setMergingCustomer(null);
      setMergeTarget("");
      setSelectedCustomer(null);
      loadData();
    } catch (e: any) {
      toast.error(e.message || "Error al fusionar");
    } finally {
      setMerging(false);
    }
  };

  // Load loyalty points balances and settings
  useEffect(() => {
    if (!activeOrg) return;
    Promise.all([
      supabase
        .from("loyalty_points")
        .select("customer_name, delta")
        .eq("org_id", activeOrg.id),
      supabase
        .from("settings")
        .select("loyalty_enabled")
        .eq("org_id", activeOrg.id)
        .maybeSingle(),
    ]).then(([{ data: pts }, { data: sett }]) => {
      if (sett) setLoyaltyEnabled(!!sett.loyalty_enabled);
      if (pts) {
        const map: Record<string, number> = {};
        for (const row of pts) {
          map[row.customer_name] = (map[row.customer_name] || 0) + Number(row.delta);
        }
        setLoyaltyBalances(map);
      }
    }).catch(() => {});
  }, [activeOrg]);

  const payInstallment = async (installmentId: string) => {
    if (!activeOrg) return;
    setPayingInstallment(installmentId);
    try {
      const { error } = await supabase
        .from('installment_schedule')
        .update({ paid: true, paid_at: new Date().toISOString() })
        .eq('id', installmentId);
      if (error) throw error;
      setInstallments(prev => prev.filter(i => i.id !== installmentId));
      toast.success('Cuota marcada como pagada');
    } catch (e: any) {
      toast.error(e.message || 'Error al registrar pago');
    } finally {
      setPayingInstallment(null);
    }
  };

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

    const list = Object.values(map).map(c => {
      c.avgTicket = c.purchaseCount > 0 ? c.totalSpent / c.purchaseCount : 0;
      c.daysSinceLastPurchase = Math.floor((now - new Date(c.lastPurchase).getTime()) / 86400000);
      const spanDays = Math.max(1, (new Date(c.lastPurchase).getTime() - new Date(c.firstPurchase).getTime()) / 86400000);
      c.frequency = c.purchaseCount > 1 ? Math.round(spanDays / (c.purchaseCount - 1)) : 999;
      if (c.segment !== "Sin compras") {
        const seg = getSegment(c);
        c.segment = seg.label;
        c.segmentColor = seg.color;
      }
      c.healthScore = 0;
      return c;
    });
    // Compute health scores (monetary uses percentile across all customers)
    const monetarySorted = list.filter(c => c.purchaseCount > 0).map(c => c.totalSpent).sort((a, b) => a - b);
    list.forEach(c => { c.healthScore = computeHealthScore(c, monetarySorted); });
    return list;
  }, [sales, debts, profiles, profileByName]);

  const filtered = useMemo(() => {
    let list = customers;
    if (search) list = list.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    if (segmentFilter !== "all") list = list.filter(c => c.segment === segmentFilter);
    list.sort((a, b) => {
      if (sortBy === "lastPurchase") return new Date(b.lastPurchase).getTime() - new Date(a.lastPurchase).getTime();
      return b[sortBy as keyof typeof b] as number - (a[sortBy as keyof typeof a] as number);
    });
    return list;
  }, [customers, search, segmentFilter, sortBy]);

  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    customers.forEach(c => { counts[c.segment] = (counts[c.segment] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [customers]);

  const saveCurrentSegment = async () => {
    if (!saveSegmentName.trim() || !user) return;
    const next = [...savedSegments, { id: Date.now().toString(), name: saveSegmentName.trim(), segment: segmentFilter }];
    setSavedSegments(next);
    await saveCRMSegmentsDB(user.id, next).catch(() => {});
    setSaveSegmentName("");
    setShowSaveInput(false);
    toast.success(`Segmento "${saveSegmentName.trim()}" guardado`);
  };

  const deleteSavedSegment = async (id: string) => {
    const next = savedSegments.filter(s => s.id !== id);
    setSavedSegments(next);
    if (user) await saveCRMSegmentsDB(user.id, next).catch(() => {});
  };

  const exportCSV = () => {
    const rows = [
      ["Nombre", "Segmento", "Score Salud", "Total Gastado (ARS)", "Ganancia (ARS)", "Compras", "Ticket Promedio (ARS)", "Última Compra", "Días sin Comprar", "Frecuencia (días)", "Deuda Pendiente (ARS)", "Email", "Teléfono"],
      ...filtered.map(c => [
        c.name,
        c.segment,
        c.healthScore,
        c.totalSpent.toFixed(2),
        c.totalProfit.toFixed(2),
        c.purchaseCount,
        c.avgTicket.toFixed(2),
        c.lastPurchase || "",
        c.daysSinceLastPurchase === 9999 ? "" : c.daysSinceLastPurchase,
        c.frequency === 999 ? "" : c.frequency,
        c.pendingDebt.toFixed(2),
        c.email || "",
        c.phone || "",
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes_${segmentFilter !== "all" ? segmentFilter + "_" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} clientes exportados`);
  };

  const handleCreate = async (data: Partial<CustomerProfile>) => {
    if (!user) return;
    await createCustomerDB(user.id, data as Parameters<typeof createCustomerDB>[1]);
    toast.success("Cliente creado");
    await loadData();
  };

  const handleUpdate = async (id: string, data: Partial<CustomerProfile>) => {
    await updateCustomerDB(id, data);
    toast.success("Cliente actualizado");
    await loadData();
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast.error("El CSV está vacío o mal formateado"); return; }
      // Skip header row
      const rows = lines.slice(1);
      let ok = 0, failed = 0;
      for (const line of rows) {
        const [nombre, email, telefono, direccion, cumple] = line.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
        if (!nombre) continue;
        try {
          await createCustomerDB(user.id, {
            name: nombre,
            email: email || undefined,
            phone: telefono || undefined,
            address: direccion || undefined,
            birthday: cumple || undefined,
          });
          ok++;
        } catch {
          failed++;
        }
      }
      toast.success(`${ok} contacto(s) importados${failed > 0 ? ` · ${failed} fallidos` : ""}`);
      await loadData();
    } catch {
      toast.error("Error al leer el archivo CSV");
    } finally {
      setImporting(false);
    }
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
    <div className="space-y-6">
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
      <PageHeader
        icon={Users}
        title="Clientes / CRM"
        description={`${customers.length} clientes · ${formatARS(totalRevenue)} facturado`}
        badge={
          totalDebt > 0
            ? { label: `${formatARS(totalDebt)} adeudado`, variant: "destructive" }
            : { label: "Sin deudas ✓", variant: "success" }
        }
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={exportCSV}
              disabled={filtered.length === 0}
              className="gap-2"
              title={`Exportar ${filtered.length} clientes${segmentFilter !== "all" ? ` (${segmentFilter})` : ""} a CSV con datos RFM`}
            >
              <Download className="w-4 h-4" />
              Exportar{segmentFilter !== "all" ? ` ${segmentFilter}` : ""} CSV
            </Button>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvImport}
                disabled={importing}
              />
              <span
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-muted text-sm font-medium hover:bg-muted/80 transition-colors"
                title="Importar desde CSV (columnas: nombre,email,telefono,direccion,cumpleaños)"
              >
                {importing
                  ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Upload className="w-4 h-4" />}
                Importar CSV
              </span>
            </label>
            {canCreate && (
              <Button
                onClick={() => setFormModal({ open: true })}
                className="gradient-gold text-primary-foreground gap-2"
              >
                <Plus className="w-4 h-4" />Nuevo cliente
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Clientes" value={customers.length} icon={Users} color="primary"
          sub={`${customers.filter(c => c.daysSinceLastPurchase <= 30).length} activos este mes`} />
        <KPICard label="Ticket Promedio" value={formatARS(avgTicketGlobal)} icon={ShoppingBag} color="blue"
          sub={`${totalPurchases} ventas totales`} />
        <KPICard label="VIP / Premium" value={customers.filter(c => c.segment === "VIP" || c.segment === "Premium").length} icon={Crown} color="warning"
          sub="clientes top" />
        <KPICard label="Deuda Total" value={formatARS(totalDebt)} icon={AlertCircle}
          color={totalDebt > 0 ? "destructive" : "success"}
          sub={`${customers.filter(c => c.pendingDebt > 0).length} con saldo pendiente`} />
      </div>

      {/* Segmentation Chart */}
      {segmentCounts.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 shadow-card">
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

      {/* At-risk alert panel */}
      {(() => {
        const atRisk = customers.filter(c => c.segment === "En riesgo" || c.segment === "Dormido");
        if (atRisk.length === 0) return null;
        return (
          <div className="bg-orange-500/5 border border-orange-500/30 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-orange-400 shrink-0" />
              <p className="text-sm font-semibold text-orange-400">{atRisk.length} cliente{atRisk.length !== 1 ? "s" : ""} que necesitan reactivación</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {atRisk.slice(0, 6).map(c => (
                <a
                  key={c.name}
                  href={c.phone ? `https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${c.name.split(' ')[0]}! 👋 Hace ${c.daysSinceLastPurchase} días que no te vemos por acá. ¿Se te ofrece algo? Tenemos novedades para vos 🛍️`)}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${c.phone ? "border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 cursor-pointer" : "border-border bg-muted text-muted-foreground cursor-default"}`}
                  title={c.phone ? "Enviar WhatsApp de reactivación" : "Sin teléfono registrado"}
                  onClick={e => { if (!c.phone) e.preventDefault(); }}
                >
                  <MessageCircle className="w-3 h-3" />
                  {c.name.split(' ')[0]} ({c.daysSinceLastPurchase}d)
                </a>
              ))}
              {atRisk.length > 6 && (
                <button onClick={() => setSegmentFilter(segmentFilter === "En riesgo" ? "all" : "En riesgo")} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border hover:bg-muted/80">
                  +{atRisk.length - 6} más →
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Saved segments */}
      {(savedSegments.length > 0 || segmentFilter !== "all") && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {savedSegments.map(s => (
            <div key={s.id} className="flex items-center gap-1">
              <button
                onClick={() => setSegmentFilter(s.segment)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  segmentFilter === s.segment
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground hover:border-primary/30"
                }`}
              >
                {s.name}
              </button>
              <button onClick={() => deleteSavedSegment(s.id)} className="text-muted-foreground hover:text-destructive" title="Eliminar segmento guardado">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {segmentFilter !== "all" && (
            showSaveInput ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={saveSegmentName}
                  onChange={e => setSaveSegmentName(e.target.value)}
                  placeholder="Nombre del segmento"
                  className="h-7 text-xs bg-muted w-40"
                  onKeyDown={e => { if (e.key === "Enter") saveCurrentSegment(); if (e.key === "Escape") setShowSaveInput(false); }}
                  autoFocus
                />
                <Button size="sm" className="h-7 text-xs px-2" onClick={saveCurrentSegment} disabled={!saveSegmentName.trim()}>
                  <Save className="w-3 h-3 mr-1" />Guardar
                </Button>
                <button onClick={() => setShowSaveInput(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveInput(true)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-all"
                title="Guardar filtro actual como segmento"
              >
                + Guardar segmento
              </button>
            )
          )}
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
            <SelectItem value="healthScore">Mayor score</SelectItem>
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
                      {c.purchaseCount > 0 && <HealthScoreBadge score={c.healthScore} />}
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

                {/* Expanded details — Ficha 360 */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-border">
                    {/* Health Score gauge */}
                    {c.purchaseCount > 0 && (
                      <div className="mb-3 bg-muted/40 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-muted-foreground">Score de salud del cliente</span>
                          <HealthScoreBadge score={c.healthScore} />
                        </div>
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              c.healthScore >= 80 ? "bg-yellow-400" :
                              c.healthScore >= 60 ? "bg-green-400" :
                              c.healthScore >= 40 ? "bg-blue-400" :
                              c.healthScore >= 20 ? "bg-orange-400" : "bg-red-400"
                            }`}
                            style={{ width: `${c.healthScore}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                          <span>Recencia · Frecuencia · Valor monetario</span>
                          <span>{c.healthScore}/100</span>
                        </div>
                      </div>
                    )}
                    {/* Action buttons */}
                    <div className="flex gap-2 mb-3">
                      {canEdit && (
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
                      )}
                      {canDelete && c.profileId && (
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-xs text-muted-foreground ml-auto"
                        onClick={() => setMergingCustomer(mergingCustomer === c.name ? null : c.name)}
                        title="Fusionar este cliente con otro (útil para duplicados)"
                      >
                        <Merge className="w-3.5 h-3.5" />Fusionar
                      </Button>
                    </div>

                    {/* Inline merge form */}
                    {mergingCustomer === c.name && (
                      <div className="mb-3 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 space-y-2">
                        <p className="text-xs font-medium text-orange-400">
                          Fusionar <strong>"{c.name}"</strong> en otro cliente
                        </p>
                        <p className="text-[10px] text-muted-foreground">Todas las ventas, deudas y puntos se moverán al cliente destino.</p>
                        <div className="flex gap-2">
                          <Input
                            list={`merge-targets-${c.name}`}
                            value={mergeTarget}
                            onChange={e => setMergeTarget(e.target.value)}
                            placeholder="Nombre del cliente destino…"
                            className="bg-muted border-border text-xs h-8 flex-1"
                          />
                          <datalist id={`merge-targets-${c.name}`}>
                            {customers.filter(x => x.name !== c.name).map(x => (
                              <option key={x.name} value={x.name} />
                            ))}
                          </datalist>
                          <Button
                            size="sm"
                            className="h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white shrink-0"
                            onClick={handleMergeCustomers}
                            disabled={merging || !mergeTarget.trim()}
                          >
                            {merging ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Fusionar"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setMergingCustomer(null); setMergeTarget(""); }}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}

                    <Tabs defaultValue="resumen" className="w-full">
                      <TabsList className="h-8 text-xs mb-3">
                        <TabsTrigger value="resumen" className="text-xs h-7 gap-1"><TrendingUp className="w-3 h-3" />Resumen</TabsTrigger>
                        <TabsTrigger value="compras" className="text-xs h-7 gap-1"><Package className="w-3 h-3" />Compras ({sales.filter((s: any) => s.customer_name?.toLowerCase() === c.name.toLowerCase()).length})</TabsTrigger>
                        <TabsTrigger value="deudas" className="text-xs h-7 gap-1"><CreditCard className="w-3 h-3" />Cuotas/Deudas</TabsTrigger>
                        <TabsTrigger value="contacto" className="text-xs h-7 gap-1"><MessageCircle className="w-3 h-3" />Contacto</TabsTrigger>
                      </TabsList>

                      {/* ── Tab: Resumen ── */}
                      <TabsContent value="resumen" className="space-y-3 mt-0">
                        {/* KPIs */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { l: "Total gastado", v: formatARS(c.totalSpent), icon: <TrendingUp className="w-3 h-3 text-primary" /> },
                            { l: "Ganancia generada", v: formatARS(c.totalProfit), icon: <Star className="w-3 h-3 text-yellow-400" /> },
                            { l: "Ticket promedio", v: formatARS(c.avgTicket), icon: <ShoppingBag className="w-3 h-3 text-blue-400" /> },
                            { l: "Deuda pendiente", v: formatARS(c.pendingDebt), icon: <AlertCircle className={`w-3 h-3 ${c.pendingDebt > 0 ? "text-destructive" : "text-muted-foreground"}`} /> },
                          ].map(k => (
                            <div key={k.l} className="bg-muted/30 rounded-lg p-2.5 text-xs">
                              <div className="flex items-center gap-1 text-muted-foreground mb-1">{k.icon}{k.l}</div>
                              <p className={`font-mono font-semibold text-sm ${k.l === "Deuda pendiente" && c.pendingDebt > 0 ? "text-destructive" : ""}`}>{k.v}</p>
                            </div>
                          ))}
                        </div>

                        {/* Loyalty points badge */}
                        {loyaltyEnabled && (
                          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs ${
                            (loyaltyBalances[c.name] || 0) > 0
                              ? "bg-yellow-500/10 border border-yellow-500/20"
                              : "bg-muted/30 border border-border"
                          }`}>
                            <Gift className={`w-4 h-4 shrink-0 ${(loyaltyBalances[c.name] || 0) > 0 ? "text-yellow-400" : "text-muted-foreground"}`} />
                            <div className="flex-1">
                              <span className="text-muted-foreground">Puntos de fidelidad</span>
                              <span className={`ml-2 font-mono font-bold ${(loyaltyBalances[c.name] || 0) > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
                                {(loyaltyBalances[c.name] || 0).toLocaleString("es-AR")} pts
                              </span>
                            </div>
                            {(loyaltyBalances[c.name] || 0) > 0 && (
                              <a href="/fidelidad" className="text-yellow-400 hover:text-yellow-300 text-[10px] underline shrink-0">
                                Ver fidelidad →
                              </a>
                            )}
                          </div>
                        )}

                        {/* Pending debt alert */}
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
                                .map(([name, data]: [string, any]) => (
                                  <div key={name} className="flex items-center justify-between text-xs">
                                    <span className="truncate mr-2">{name}</span>
                                    <span className="text-muted-foreground shrink-0">{data.qty}u · {formatARS(data.revenue)}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Stats grid */}
                        {c.purchaseCount > 0 && (
                          <div className="grid grid-cols-2 gap-2 text-xs">
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
                      </TabsContent>

                      {/* ── Tab: Compras ── */}
                      <TabsContent value="compras" className="mt-0">
                        <CustomerSalesTimeline
                          customerName={c.name}
                          sales={sales}
                          debts={debts}
                          onCreateInvoice={(sale) => {
                            window.location.href = `/facturas?from_sale=${sale.id}&customer=${encodeURIComponent(sale.customer_name || '')}&total=${sale.total_ars}`;
                          }}
                        />
                      </TabsContent>

                      {/* ── Tab: Cuotas / Deudas ── */}
                      <TabsContent value="deudas" className="mt-0 space-y-3">
                        {/* Cuotas pendientes */}
                        {(() => {
                          const customerInstallments = installments.filter(
                            i => i.sale?.customer_name?.toLowerCase() === c.name.toLowerCase()
                          );
                          if (customerInstallments.length === 0) return (
                            <p className="text-xs text-muted-foreground text-center py-4">Sin cuotas pendientes</p>
                          );
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          return (
                            <div>
                              <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <CreditCard className="w-3 h-3 text-primary" />
                                Cuotas pendientes ({customerInstallments.length})
                              </h3>
                              <div className="space-y-1.5">
                                {customerInstallments.map(inst => {
                                  const due = new Date(inst.due_date + 'T12:00:00');
                                  const overdue = due < today;
                                  return (
                                    <div key={inst.id} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${overdue ? 'bg-destructive/8 border-destructive/20' : 'bg-muted/30 border-border/50'}`}>
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium truncate">{inst.sale?.product_name || 'Venta'} — cuota {inst.installment_number}</p>
                                        <p className={`text-[10px] mt-0.5 ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                          {overdue ? '⚠️ Vencida · ' : ''}{due.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs font-mono font-semibold">{formatARS(Number(inst.amount_ars))}</span>
                                        <button
                                          onClick={() => payInstallment(inst.id)}
                                          disabled={payingInstallment === inst.id}
                                          className="text-[10px] px-2 py-1 rounded-md bg-success/20 text-success hover:bg-success/30 transition-colors font-medium disabled:opacity-50"
                                        >
                                          {payingInstallment === inst.id ? '…' : 'Cobrar'}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Active debts */}
                        {debts.filter((d: any) => d.customer_name?.toLowerCase() === c.name.toLowerCase() && d.status !== 'paid').length > 0 && (
                          <div>
                            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <AlertCircle className="w-3 h-3 text-destructive" />Deudas activas
                            </h3>
                            <div className="space-y-1.5">
                              {debts
                                .filter((d: any) => d.customer_name?.toLowerCase() === c.name.toLowerCase() && d.status !== 'paid')
                                .map((d: any) => (
                                  <div key={d.id} className="flex items-center justify-between rounded-lg bg-destructive/8 border border-destructive/20 px-3 py-2">
                                    <div>
                                      <p className="text-xs font-medium">{d.description || "Deuda"}</p>
                                      <p className="text-[10px] text-muted-foreground">{new Date(d.date).toLocaleDateString("es-AR")}</p>
                                    </div>
                                    <span className="text-xs font-mono font-semibold text-destructive">{formatARS(Number(d.remaining_ars || d.amount_ars))}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </TabsContent>

                      {/* ── Tab: Contacto / CRM ── */}
                      <TabsContent value="contacto" className="mt-0 space-y-3">
                        {/* Contact info */}
                        {(c.email || c.phone || c.address || c.birthday) ? (
                          <div className="grid grid-cols-1 gap-2 text-xs">
                            {c.email && (
                              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2.5">
                                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <a href={`mailto:${c.email}`} className="hover:underline text-primary truncate">{c.email}</a>
                              </div>
                            )}
                            {c.phone && (
                              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2.5">
                                <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <a
                                  href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="hover:underline text-green-400"
                                >
                                  {c.phone} (WhatsApp)
                                </a>
                              </div>
                            )}
                            {c.address && (
                              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2.5">
                                <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span>{c.address}</span>
                              </div>
                            )}
                            {c.birthday && (
                              <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2.5">
                                <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span>{new Date(c.birthday + "T12:00:00").toLocaleDateString("es-AR")} (cumpleaños)</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground text-center py-2">Sin datos de contacto. <button className="text-primary hover:underline" onClick={() => setFormModal({ open: true, profile: { name: c.name } })}>Agregar ahora</button></p>
                        )}

                        {/* Notes */}
                        {c.profileNotes && (
                          <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground">
                            <p className="font-medium text-foreground mb-1 flex items-center gap-1"><FileText className="w-3 h-3" />Notas</p>
                            {c.profileNotes}
                          </div>
                        )}

                        {/* Tags */}
                        {c.tags && c.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {c.tags.map(t => (
                              <span key={t} className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-medium">{t}</span>
                            ))}
                          </div>
                        )}

                        {/* Communications log */}
                        {activeOrg && user && (
                          <CommunicationsLog
                            orgId={activeOrg.id}
                            userId={user.id}
                            customerName={c.name}
                          />
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
                      </TabsContent>
                    </Tabs>

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

                    {/* Cuotas pendientes */}
                    {(() => {
                      const customerInstallments = installments.filter(
                        i => i.sale?.customer_name?.toLowerCase() === c.name.toLowerCase()
                      );
                      if (customerInstallments.length === 0) return null;
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return (
                        <div>
                          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <CreditCard className="w-3 h-3 text-primary" />
                            Cuotas pendientes ({customerInstallments.length})
                          </h3>
                          <div className="space-y-1.5">
                            {customerInstallments.map(inst => {
                              const due = new Date(inst.due_date + 'T12:00:00');
                              const overdue = due < today;
                              return (
                                <div key={inst.id} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${overdue ? 'bg-destructive/8 border-destructive/20' : 'bg-muted/30 border-border/50'}`}>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium truncate">{inst.sale?.product_name || 'Venta'} — cuota {inst.installment_number}</p>
                                    <p className={`text-[10px] mt-0.5 ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                      {overdue ? '⚠️ Vencida · ' : ''}{due.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-xs font-mono font-semibold">{formatARS(Number(inst.amount_ars))}</span>
                                    <button
                                      onClick={() => payInstallment(inst.id)}
                                      disabled={payingInstallment === inst.id}
                                      className="text-[10px] px-2 py-1 rounded-md bg-success/20 text-success hover:bg-success/30 transition-colors font-medium disabled:opacity-50"
                                    >
                                      {payingInstallment === inst.id ? '…' : 'Cobrar'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* 360 — Sales timeline & debts */}
                    <CustomerSalesTimeline
                      customerName={c.name}
                      sales={sales}
                      debts={debts}
                      onCreateInvoice={(sale) => {
                        window.location.href = `/facturas?from_sale=${sale.id}&customer=${encodeURIComponent(sale.customer_name || '')}&total=${sale.total_ars}`;
                      }}
                    />

                    {/* Communications log */}
                    {activeOrg && user && (
                      <CommunicationsLog
                        orgId={activeOrg.id}
                        userId={user.id}
                        customerName={c.name}
                      />
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
