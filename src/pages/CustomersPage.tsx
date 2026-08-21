import { useState, useEffect, useMemo, useCallback } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  getSalesDB, getDebtsDB, getSettingsDB, formatARS,
  getCustomersDB, createCustomerDB, updateCustomerDB, deleteCustomerDB,
  getCRMSegmentsDB, saveCRMSegmentsDB, type SavedCRMSegment,
} from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { normalizeName, belongsToCustomer, rowsOfCustomer, type CustomerRef } from "@/lib/customerMatch";
import { useOrg } from "@/lib/orgContext";
import {
  Users, ShoppingBag, Crown, AlertCircle,
  MessageCircle, Plus, Edit2, Trash2, X, Save, Phone, Mail, MapPin, EyeOff,
  Calendar, Tag, ChevronDown, ChevronUp, Upload, Clock, FileText, CreditCard,
  Star, TrendingUp, Package, Gift, Merge, Download, CheckSquare, Send, Printer, Bell, BookUser,
  Instagram, Droplets,
} from "lucide-react";
import { NOTAS_COMUNES, taxLabel } from "@/lib/scentTaxonomy";
import { recommendForPreferences } from "@/lib/perfumeMatch";
import PerfumeRecommenderModal from "@/components/products/PerfumeRecommenderModal";
import { useContactPicker } from "@/hooks/useContactPicker";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import UnlinkedSalesPanel from "@/components/customers/UnlinkedSalesPanel";
import IdentityHealthPanel from "@/components/shared/IdentityHealthPanel";
import { useModulePermissions } from "@/lib/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { toast } from "sonner";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { normalizeIdentityEmail, normalizeIdentityPhone, normalizeIdentityText } from "@/lib/recordIdentity";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type CustomerData = {
  name: string;
  /** Id en `customers`. Null mientras la persona no esté cargada en el CRM. */
  customerId?: string | null;
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
  churnRisk: number; // 0-100 predicted churn probability
  clv: number; // projected Customer Lifetime Value in ARS
  sellers: string[]; // seller_name values from sales
  // Profile from customers table (if exists)
  profileId?: string;
  company?: string;
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
  /** Viene del select(*); desempata homónimos igual que el trigger en SQL. */
  created_at?: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  birthday?: string;
  tags?: string[];
  notes?: string;
  instagram_handle?: string;
  whatsapp_number?: string;
  buys_vapers?: boolean;
  scent_preferences?: string[];
  custom_fields?: Record<string, any>;
};

type CustomFieldDef = {
  id: string;
  field_key: string;
  field_label: string;
  field_type: 'text' | 'number' | 'date' | 'boolean' | 'select';
  required: boolean;
  options?: string[] | null;
  sort_order: number;
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

/**
 * Predict churn probability 0-100 based on RFM signals.
 * Higher = more likely to churn (stop buying).
 */
function computeChurnRisk(c: CustomerData): number {
  if (c.segment === "Sin compras") return 90;
  const d = c.daysSinceLastPurchase;
  // Recency-based base score
  let risk = 0;
  if (d >= 180) risk = 85;
  else if (d >= 90) risk = 65 + Math.round((d - 90) / 3);
  else if (d >= 60) risk = 45 + Math.round((d - 60) / 1.5);
  else if (d >= 30) risk = 20 + Math.round((d - 30) / 1.5);
  else risk = Math.max(5, 20 - c.purchaseCount * 2);
  // Frequency penalty: single-purchase customers higher risk
  if (c.purchaseCount <= 1) risk = Math.min(95, risk + 15);
  // Health score inverse relationship
  const healthBonus = Math.round((100 - c.healthScore) * 0.1);
  return Math.min(95, Math.max(2, risk + healthBonus));
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

function ChurnRiskBadge({ risk }: { risk: number }) {
  if (risk < 50) return null; // Only show when risk is meaningful
  const { color, label } = risk >= 80
    ? { color: "text-red-400 bg-red-400/15 border-red-400/30", label: "🔴" }
    : risk >= 65
    ? { color: "text-orange-400 bg-orange-400/15 border-orange-400/30", label: "🟠" }
    : { color: "text-yellow-400 bg-yellow-400/15 border-yellow-400/30", label: "🟡" };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border hidden sm:inline-flex items-center gap-0.5 ${color}`}
      title={`Riesgo de churn: ${risk}% — probabilidad de que este cliente deje de comprar`}
    >
      {label} {risk}% churn
    </span>
  );
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
  Perdido: "hsl(var(--muted-foreground))",
};

// ─────────────────────────────────────────────────────────────
// Customer Form Modal (Create / Edit)
// ─────────────────────────────────────────────────────────────
function CustomerFormModal({
  initial,
  onSave,
  onClose,
  orgId,
}: {
  initial?: Partial<CustomerProfile>;
  onSave: (data: Partial<CustomerProfile>) => Promise<void>;
  onClose: () => void;
  orgId?: string;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    company: initial?.company ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    address: initial?.address ?? "",
    birthday: initial?.birthday ?? "",
    tags: (initial?.tags ?? []).join(", "),
    notes: initial?.notes ?? "",
    instagram: initial?.instagram_handle ?? "",
    whatsapp: initial?.whatsapp_number ?? "",
    buysVapers: initial?.buys_vapers ?? false,
  });
  const [scentPrefs, setScentPrefs] = useState<string[]>(initial?.scent_preferences ?? []);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>(
    initial?.custom_fields ?? {}
  );
  const [saving, setSaving] = useState(false);

  // Load custom field definitions for customers
  useEffect(() => {
    if (!orgId) return;
    supabase
      .from("custom_field_defs")
      .select("id, field_key, field_label, field_type, required, options, sort_order")
      .eq("org_id", orgId)
      .eq("entity_type", "customer")
      .order("sort_order")
      .then(({ data }) => { if (data) setCustomFieldDefs(data as CustomFieldDef[]); });
  }, [orgId]);
  const { supported: contactsSupported, pick: pickContact, picking } = useContactPicker();

  const handlePickContact = async () => {
    const contacts = await pickContact(false);
    if (!contacts || contacts.length === 0) return;
    const c = contacts[0];
    setForm(f => ({
      ...f,
      name: c.name || f.name,
      phone: c.phone || f.phone,
      email: c.email || f.email,
    }));
    toast.success("Datos importados del contacto");
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    // Validate required custom fields
    for (const def of customFieldDefs) {
      if (def.required && !customFieldValues[def.field_key] && customFieldValues[def.field_key] !== false) {
        toast.error(`El campo "${def.field_label}" es obligatorio`);
        return;
      }
    }
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        company: form.company.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        birthday: form.birthday || undefined,
        tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        notes: form.notes.trim() || undefined,
        instagram_handle: form.instagram.trim() || undefined,
        whatsapp_number: form.whatsapp.trim() || undefined,
        buys_vapers: form.buysVapers,
        scent_preferences: scentPrefs,
        custom_fields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
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
      <div className="bg-card border border-border/60 rounded-[10px] w-full max-w-md shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold">{initial?.id ? "Editar cliente" : "Nuevo cliente"}</h2>
          <div className="flex items-center gap-2">
            {contactsSupported && !initial?.id && (
              <button
                type="button"
                onClick={handlePickContact}
                disabled={picking}
                className="flex items-center gap-1.5 text-xs text-primary/80 hover:text-primary border border-primary/20 hover:border-primary/40 rounded-[6px] px-2.5 py-1 transition-all"
                title="Importar datos desde tu agenda de contactos"
              >
                <BookUser className="w-3.5 h-3.5" />
                {picking ? "Abriendo…" : "Desde contactos"}
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
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
          <div>
            <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Tag className="w-3 h-3" />Empresa / Negocio <span className="text-[10px] opacity-60">(opcional)</span>
            </label>
            <Input
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              placeholder="Ej: Distribuidora XYZ, Almacén El Sol..."
              className="bg-muted"
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

          {/* ── CRM perfumería: redes + preferencias ─────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Instagram className="w-3 h-3" />Instagram</label>
              <Input
                value={form.instagram}
                onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))}
                placeholder="@usuario"
                className="bg-muted"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MessageCircle className="w-3 h-3" />WhatsApp</label>
              <Input
                value={form.whatsapp}
                onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                placeholder="usa el teléfono si se deja vacío"
                className="bg-muted"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-lg p-3 border border-border">
            <input type="checkbox" id="buysVapers" checked={form.buysVapers} onChange={e => setForm(f => ({ ...f, buysVapers: e.target.checked }))} className="rounded" />
            <label htmlFor="buysVapers" className="text-sm flex items-center gap-1 cursor-pointer">
              <Package className="w-3.5 h-3.5 text-primary" />Compra vapers
            </label>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Droplets className="w-3 h-3" />Preferencias olfativas</label>
            <div className="flex flex-wrap gap-1.5">
              {NOTAS_COMUNES.map(n => {
                const active = scentPrefs.includes(n.value);
                return (
                  <button key={n.value} type="button"
                    onClick={() => setScentPrefs(prev => prev.includes(n.value) ? prev.filter(x => x !== n.value) : [...prev, n.value])}
                    className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-all ${active ? 'bg-primary/20 border-primary text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary'}`}>
                    {n.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom fields */}
          {customFieldDefs.length > 0 && (
            <div className="border-t border-border/50 pt-3 space-y-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">
                Campos personalizados
              </p>
              {customFieldDefs.map(def => (
                <div key={def.id}>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {def.field_label}
                    {def.required && <span className="text-destructive ml-0.5">*</span>}
                  </label>
                  {def.field_type === 'text' && (
                    <Input
                      value={customFieldValues[def.field_key] ?? ""}
                      onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.value }))}
                      className="bg-muted"
                    />
                  )}
                  {def.field_type === 'number' && (
                    <Input
                      type="number"
                      value={customFieldValues[def.field_key] ?? ""}
                      onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.value ? Number(e.target.value) : "" }))}
                      className="bg-muted"
                    />
                  )}
                  {def.field_type === 'date' && (
                    <Input
                      type="date"
                      value={customFieldValues[def.field_key] ?? ""}
                      onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.value }))}
                      className="bg-muted"
                    />
                  )}
                  {def.field_type === 'boolean' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!customFieldValues[def.field_key]}
                        onChange={e => setCustomFieldValues(v => ({ ...v, [def.field_key]: e.target.checked }))}
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="text-xs text-muted-foreground">Activado</span>
                    </div>
                  )}
                  {def.field_type === 'select' && def.options && (
                    <Select
                      value={customFieldValues[def.field_key] ?? ""}
                      onValueChange={v => setCustomFieldValues(vals => ({ ...vals, [def.field_key]: v }))}
                    >
                      <SelectTrigger className="bg-muted">
                        <SelectValue placeholder="Seleccioná..." />
                      </SelectTrigger>
                      <SelectContent>
                        {def.options.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
          )}
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

type CommEntry = {
  id: string;
  type: string;
  summary: string;
  created_at: string;
  follow_up_date?: string | null;
  outcome?: string | null;
};

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
  customerRef,
  sales,
  debts,
  onCreateInvoice,
}: {
  customerRef: CustomerRef;
  customerName: string;
  sales: any[];
  debts: any[];
  onCreateInvoice: (sale: any) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const customerSales = useMemo(
    () =>
      sales
        .filter((s: any) => belongsToCustomer(s, customerRef))
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [sales, customerRef],
  );

  const customerDebts = useMemo(
    () => debts.filter((d: any) => belongsToCustomer(d, customerRef)),
    [debts, customerRef],
  );

  const shown = showAll ? customerSales : customerSales.slice(0, 5);

  if (customerSales.length === 0 && customerDebts.filter((d: any) => d.status !== "paid").length === 0) return null;

  return (
    <div className="space-y-3 pb-12">
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

const QUOTE_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft:    { label: "Borrador", color: "text-muted-foreground bg-muted/40" },
  sent:     { label: "Enviado",  color: "text-blue-400 bg-blue-500/10" },
  accepted: { label: "Aceptado", color: "text-emerald-400 bg-emerald-500/10" },
  rejected: { label: "Rechazado",color: "text-destructive bg-destructive/10" },
  expired:  { label: "Vencido",  color: "text-amber-400 bg-amber-500/10" },
};

/**
 * Agrega una nota al perfil del cliente, con fecha y hora.
 *
 * Escribe en `customers.notes`, que es **de donde la ficha la lee**
 * (`profileNotes`). Antes los dos caminos de nota escribían en `customer_notes`
 * con `onConflict: 'org_id,customer_name'`, y eso estaba mal por partida doble:
 *
 * 1. Esa constraint no existe — la de la tabla es `UNIQUE (user_id,
 *    customer_name)` — así que Postgres rechazaba con `42P10`.
 * 2. Aun si hubiera entrado, `customer_notes` no la lee nadie en el CRM, así
 *    que la nota no habría aparecido igual.
 *
 * Y no se notaba porque `upsert()` no lanza: devuelve el error en `.error`, que
 * ningún llamador miraba. El `catch` nunca corría, la UI decía "Nota guardada"
 * y la tabla quedaba con cero filas. Por eso esto devuelve el error lanzándolo:
 * un fallo tiene que llegar al `catch` del llamador, no perderse.
 *
 * Si el cliente todavía no tiene perfil se lo crea. Una nota sobre alguien es
 * justamente el motivo para tenerlo en el CRM, y sin perfil la nota no tiene
 * dónde vivir. Sus compras se siguen viendo en la ficha: `belongsToCustomer`
 * cruza por nombre las filas que no tienen `customer_id`.
 */
async function appendCustomerNote(
  orgId: string,
  userId: string,
  customer: Pick<CustomerData, "name" | "profileId" | "profileNotes">,
  text: string,
): Promise<void> {
  const timestamp = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const entry = `[${timestamp}] ${text.trim()}`;
  const notes = customer.profileNotes ? `${customer.profileNotes}\n${entry}` : entry;

  if (customer.profileId) {
    const { error } = await supabase.from("customers").update({ notes }).eq("id", customer.profileId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("customers")
    .insert({ org_id: orgId, user_id: userId, name: customer.name, notes });
  if (error) throw error;
}

/**
 * Trae las filas de una tabla del CRM que son de un cliente, con la misma regla
 * que `belongsToCustomer`: si la fila está enlazada manda el `customer_id`, y si
 * no, se cruza por nombre.
 *
 * Son dos consultas y no un `.or()` a propósito. El `or` de PostgREST se arma
 * concatenando todo en una sola cadena, así que un nombre con coma o paréntesis
 * —"Pérez, Juan", "Ana (mayorista)"— rompe el filtro o, peor, lo convierte
 * calladamente en otro. Dos consultas explícitas no tienen ese problema.
 *
 * La segunda pide sólo filas con `customer_id IS NULL`. Una fila enlazada a OTRO
 * cliente no puede volver por la ventana del nombre: es lo que garantiza que dos
 * homónimos no se mezclen. Y el resultado se pasa igual por `belongsToCustomer`,
 * que normaliza acentos — el `ilike` de la consulta no.
 */
async function crmRowsForCustomer<T extends { id: string; created_at?: string }>(
  table: "quotes" | "customer_communications",
  columns: string,
  orgId: string,
  customer: CustomerRef,
  limit: number,
): Promise<T[]> {
  const base = () => supabase.from(table).select(columns).eq("org_id", orgId)
    .order("created_at", { ascending: false }).limit(limit);

  const nombre = (customer.name ?? "").trim();
  const consultas = [];
  if (customer.id) consultas.push(base().eq("customer_id", customer.id));
  // `%` y `_` son comodines de LIKE: sin escapar, un nombre que los tenga
  // traería filas de otra gente.
  if (nombre) consultas.push(base().is("customer_id", null).ilike("customer_name", nombre.replace(/[%_]/g, m => `\\${m}`)));

  const resultados = await Promise.all(consultas);
  const err = resultados.find(r => r.error)?.error;
  if (err) throw err;   // no se traga: "no tengo permiso" y "no hay nada" son problemas opuestos

  const porId = new Map<string, T>();
  for (const r of resultados) {
    for (const fila of (r.data ?? []) as unknown as T[]) porId.set(fila.id, fila);
  }
  return [...porId.values()]
    .filter(f => belongsToCustomer(f as any, customer))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, limit);
}

function CustomerQuotesTab({ customer, orgId }: { customer: CustomerRef; orgId: string }) {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const customerId = customer.id;
  const customerName = customer.name;

  useEffect(() => {
    setLoading(true);
    crmRowsForCustomer<any>(
      "quotes",
      "id,quote_number,valid_until,status,total_ars,created_at,notes,customer_id,customer_name",
      orgId,
      { id: customerId, name: customerName },
      20,
    )
      .then(filas => setQuotes(filas))
      .catch(() => toast.error("No se pudieron cargar los presupuestos"))
      .finally(() => setLoading(false));
  }, [customerId, customerName, orgId]);

  if (loading) return <p className="text-xs text-muted-foreground text-center py-6">Cargando...</p>;
  if (quotes.length === 0) return (
    <div className="text-center py-6 space-y-2">
      <p className="text-xs text-muted-foreground">Sin presupuestos para este cliente.</p>
      <a href="/presupuestos" className="text-xs text-primary hover:underline">Crear presupuesto →</a>
    </div>
  );

  const totalAccepted = quotes.filter(q => q.status === "accepted").reduce((s, q) => s + Number(q.total_ars || 0), 0);
  const totalSent     = quotes.filter(q => q.status === "sent").reduce((s, q) => s + Number(q.total_ars || 0), 0);

  return (
    <div className="space-y-3 pb-12">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: "Total presupuestos", v: quotes.length },
          { l: "Aceptados", v: formatARS(totalAccepted), sub: `${quotes.filter(q => q.status === "accepted").length} presup.` },
          { l: "Pendientes", v: formatARS(totalSent), sub: `${quotes.filter(q => q.status === "sent").length} presup.` },
        ].map(k => (
          <div key={k.l} className="bg-muted/30 rounded-lg p-2.5 text-xs">
            <p className="text-muted-foreground mb-1">{k.l}</p>
            <p className="font-mono font-semibold">{k.v}</p>
            {k.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* List */}
      <div className="space-y-1.5">
        {quotes.map(q => {
          const s = QUOTE_STATUS_LABEL[q.status] || QUOTE_STATUS_LABEL.draft;
          const expired = q.valid_until && new Date(q.valid_until) < new Date() && q.status === "sent";
          return (
            <div key={q.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 border border-border/40 hover:bg-muted/50 transition-colors">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">#{q.quote_number}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${expired ? "text-amber-400 bg-amber-500/10" : s.color}`}>
                    {expired ? "Vencido" : s.label}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(q.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                  {q.valid_until && ` · válido hasta ${new Date(q.valid_until + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}`}
                </p>
                {q.notes && <p className="text-[10px] text-muted-foreground truncate max-w-[200px] mt-0.5">{q.notes}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-mono font-semibold">{formatARS(Number(q.total_ars || 0))}</p>
                <a href="/presupuestos" className="text-[10px] text-primary hover:underline">Ver →</a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommunicationsLog({ orgId, userId, customer }: { orgId: string; userId: string; customer: CustomerRef }) {
  const customerId = customer.id;
  const customerName = customer.name ?? "";
  const [entries, setEntries] = useState<CommEntry[]>([]);
  const [type, setType] = useState("note");
  const [summary, setSummary] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Voice-to-text for quick note entry
  const { transcript, listening, start: startSpeech, stop: stopSpeech, supported: speechSupported, reset: resetSpeech } = useSpeechRecognition({
    onResult: (r) => { if (r.isFinal) setSummary(prev => (prev + " " + r.transcript).trim()); },
  });

  useEffect(() => {
    crmRowsForCustomer<CommEntry & { id: string; created_at?: string }>(
      "customer_communications",
      "id,type,summary,created_at,follow_up_date,outcome,customer_id,customer_name",
      orgId,
      { id: customerId, name: customerName },
      20,
    )
      .then(filas => setEntries(filas as CommEntry[]))
      .catch(() => toast.error("No se pudo cargar el historial de comunicaciones"));
  }, [orgId, customerId, customerName]);

  const handleAdd = async () => {
    if (!summary.trim()) return;
    setAdding(true);
    try {
      const { data, error } = await supabase
        .from("customer_communications")
        .insert({
          org_id: orgId,
          user_id: userId,
          // Se manda el id que la ficha ya conoce en vez de dejar que el trigger
          // lo deduzca del nombre: acá se sabe con certeza de quién es, y el
          // trigger respeta un customer_id ya provisto.
          customer_id: customerId ?? null,
          customer_name: customerName,
          type,
          summary: summary.trim(),
          follow_up_date: followUpDate || null,
          outcome: followUpDate ? "pending" : null,
        })
        .select("id,type,summary,created_at,follow_up_date,outcome")
        .single();
      if (error) throw error;
      setEntries(prev => [data as CommEntry, ...prev]);
      setSummary("");
      setFollowUpDate("");
      resetSpeech();
      setShowForm(false);
      toast.success(followUpDate ? `Interacción + seguimiento para ${new Date(followUpDate + "T12:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}` : "Interacción registrada");
    } catch { toast.error("Error al guardar"); }
    finally { setAdding(false); }
  };

  const markOutcome = async (id: string, outcome: string) => {
    await supabase.from("customer_communications").update({ outcome }).eq("id", id);
    setEntries(prev => prev.map(e => e.id === id ? { ...e, outcome } : e));
    toast.success(outcome === "completed" ? "✅ Seguimiento completado" : "Resultado actualizado");
  };

  const pendingFollowUps = entries.filter(e => e.follow_up_date && (e.outcome === "pending" || !e.outcome));
  const overdue = pendingFollowUps.filter(e => e.follow_up_date! < new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-2 pb-12">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="w-3 h-3" />Historial de comunicaciones
          {overdue.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[9px] font-bold">
              {overdue.length} vencido{overdue.length !== 1 ? "s" : ""}
            </span>
          )}
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          <Plus className="w-3 h-3" />Agregar
        </button>
      </div>

      {showForm && (
        <div className="bg-muted/40 rounded-[8px] p-3 space-y-2">
          {/* Interaction type */}
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

          {/* Summary + voice input */}
          <div className="relative">
            <Textarea
              value={summary + (listening ? " " + transcript : "")}
              onChange={e => setSummary(e.target.value)}
              placeholder="Descripción de la interacción…"
              className="bg-card resize-none text-xs pr-9"
              rows={2}
            />
            {speechSupported && (
              <button
                type="button"
                onMouseDown={startSpeech}
                onMouseUp={stopSpeech}
                onTouchStart={startSpeech}
                onTouchEnd={stopSpeech}
                className={`absolute right-2 top-2 p-1 rounded-md transition-colors ${
                  listening ? "bg-red-500/20 text-red-400 animate-pulse" : "text-muted-foreground hover:text-primary"
                }`}
                title={listening ? "Escuchando… suelta para parar" : "Mantené presionado para dictar"}
              >
                <Bell className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {listening && (
            <p className="text-[10px] text-red-400 animate-pulse">🎤 Escuchando…</p>
          )}

          {/* Follow-up date */}
          <div className="flex items-center gap-2">
            <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
            <input
              type="date"
              value={followUpDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setFollowUpDate(e.target.value)}
              className="flex-1 h-7 text-xs bg-card border border-border rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            {followUpDate && (
              <button onClick={() => setFollowUpDate("")} className="text-muted-foreground hover:text-foreground text-[10px]">✕ Quitar</button>
            )}
          </div>
          {followUpDate && (
            <p className="text-[10px] text-primary/70 flex items-center gap-1">
              <Bell className="w-3 h-3" />Recordatorio para {new Date(followUpDate + "T12:00").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "long" })}
            </p>
          )}

          <div className="flex gap-2">
            <Button size="sm" className="flex-1 text-xs h-7" onClick={handleAdd} disabled={adding || !summary.trim()}>
              {adding ? "Guardando…" : "Guardar"}
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { setShowForm(false); resetSpeech(); }}>Cancelar</Button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/50 italic py-1">Sin interacciones registradas</p>
      ) : (
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {entries.map(e => {
            const t = COMM_TYPES.find(ct => ct.value === e.type);
            const hasFollowUp = !!e.follow_up_date;
            const isOverdue = hasFollowUp && e.follow_up_date! < new Date().toISOString().slice(0, 10) && (e.outcome === "pending" || !e.outcome);
            const isPending = hasFollowUp && e.follow_up_date! >= new Date().toISOString().slice(0, 10) && (e.outcome === "pending" || !e.outcome);
            return (
              <div key={e.id} className={`flex gap-2 text-xs rounded-lg px-2.5 py-2 ${
                isOverdue ? "bg-red-500/8 border border-red-500/20" : isPending ? "bg-primary/5 border border-primary/15" : "bg-muted/30"
              }`}>
                <span className="shrink-0">{t?.icon || "📌"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground leading-tight">{e.summary}</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">
                    {t?.label} · {new Date(e.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })} {new Date(e.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  {hasFollowUp && (
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                        isOverdue ? "bg-red-500/15 text-red-400 border-red-500/20"
                        : e.outcome === "completed" ? "bg-green-500/15 text-green-400 border-green-500/20"
                        : "bg-primary/10 text-primary border-primary/20"
                      }`}>
                        {isOverdue ? "⏰ Vencido" : e.outcome === "completed" ? "✅ Completado" : `📅 ${new Date(e.follow_up_date! + "T12:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}`}
                      </span>
                      {(isOverdue || isPending) && (
                        <button
                          onClick={() => markOutcome(e.id, "completed")}
                          className="text-[9px] text-green-400 hover:underline"
                        >Marcar hecho</button>
                      )}
                    </div>
                  )}
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
// PDF export — Ficha 360
// ─────────────────────────────────────────────────────────────
function exportCustomer360PDF(c: any, recentSales: any[], businessName: string) {
  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

  const salesRows = recentSales.slice(0, 10).map(s => `
    <tr>
      <td>${new Date(s.date).toLocaleDateString('es-AR')}</td>
      <td>${s.product_name || '—'}</td>
      <td>${s.quantity || 1}</td>
      <td>${fmt(Number(s.total_ars))}</td>
      <td>${fmt(Number(s.profit_ars))}</td>
      <td>${s.paid ? '✓ Pagado' : '⏳ Debe'}</td>
    </tr>`).join('');

  const segColors: Record<string, string> = { VIP: '#d4a843', Premium: '#8b5cf6', Frecuente: '#3b82f6', Activo: '#10b981', 'En riesgo': '#f59e0b', Dormido: '#f97316', Perdido: '#ef4444', Nuevo: '#06b6d4' };
  const segColor = segColors[c.segment] || '#6b7280';
  const healthColor = c.healthScore >= 80 ? '#eab308' : c.healthScore >= 60 ? '#22c55e' : c.healthScore >= 40 ? '#3b82f6' : c.healthScore >= 20 ? '#f97316' : '#ef4444';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Ficha — ${c.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #1a1a2e; padding: 24px; font-size: 12px; }
  .header { background: #1a1a2e; color: #fff; padding: 20px 24px; border-radius: 10px 10px 0 0; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 20px; font-weight: 800; color: #d4a843; }
  .header .meta { text-align: right; font-size: 10px; color: rgba(255,255,255,0.5); }
  .subheader { background: #f5f5f5; padding: 12px 24px; border-left: 4px solid #d4a843; margin-bottom: 16px; border-radius: 0 0 4px 4px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  .kpi { background: #f9f9fb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 4px; }
  .kpi-value { font-size: 18px; font-weight: 900; font-family: monospace; color: #1a1a2e; }
  .kpi-value.danger { color: #ef4444; }
  .section { margin-bottom: 16px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; }
  .info-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .info-item { background: #f3f4f6; border-radius: 6px; padding: 6px 10px; }
  .info-item .label { font-size: 9px; color: #9ca3af; text-transform: uppercase; }
  .info-item .value { font-weight: 600; margin-top: 1px; }
  .health-bar-wrap { background: #e5e7eb; border-radius: 99px; height: 8px; width: 200px; margin-top: 6px; }
  .health-bar { height: 8px; border-radius: 99px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #1a1a2e; color: #d4a843; padding: 6px 10px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
  td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; }
  tr:nth-child(even) td { background: #f9fafb; }
  .footer { text-align: center; font-size: 9px; color: #d1d5db; margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="header">
  <div><h1>${c.name}</h1><p style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px">${businessName}</p></div>
  <div class="meta"><p>Ficha 360°</p><p>${today}</p></div>
</div>
<div class="subheader">
  <span class="badge" style="background:${segColor}20;color:${segColor};border:1px solid ${segColor}40">${c.segment || 'Sin segmento'}</span>
  ${c.company ? `<span style="margin-left:8px;font-size:11px;color:#6b7280">🏢 ${c.company}</span>` : ''}
  ${c.email ? `<span style="margin-left:8px;font-size:11px;color:#6b7280">✉ ${c.email}</span>` : ''}
  ${c.phone ? `<span style="margin-left:8px;font-size:11px;color:#6b7280">📞 ${c.phone}</span>` : ''}
</div>

<div class="kpis">
  <div class="kpi"><div class="kpi-label">Total gastado</div><div class="kpi-value">${fmt(c.totalSpent)}</div></div>
  <div class="kpi"><div class="kpi-label">Ganancia generada</div><div class="kpi-value" style="color:#16a34a">${fmt(c.totalProfit)}</div></div>
  <div class="kpi"><div class="kpi-label">Ticket promedio</div><div class="kpi-value">${fmt(c.avgTicket)}</div></div>
  <div class="kpi"><div class="kpi-label">Deuda pendiente</div><div class="kpi-value ${c.pendingDebt > 0 ? 'danger' : ''}">${fmt(c.pendingDebt)}</div></div>
</div>

<div class="kpis" style="grid-template-columns:repeat(3,1fr)">
  <div class="kpi"><div class="kpi-label">Compras totales</div><div class="kpi-value">${c.purchaseCount}</div></div>
  <div class="kpi"><div class="kpi-label">Días desde última compra</div><div class="kpi-value">${c.daysSinceLastPurchase ?? '—'}</div></div>
  <div class="kpi">
    <div class="kpi-label">Score de salud</div>
    <div class="kpi-value" style="color:${healthColor}">${c.healthScore}/100</div>
    <div class="health-bar-wrap"><div class="health-bar" style="width:${c.healthScore}%;background:${healthColor}"></div></div>
  </div>
</div>

${recentSales.length > 0 ? `
<div class="section">
  <div class="section-title">Últimas compras (${Math.min(recentSales.length, 10)})</div>
  <table>
    <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Total</th><th>Ganancia</th><th>Estado</th></tr></thead>
    <tbody>${salesRows}</tbody>
  </table>
</div>` : ''}

<div class="footer">${businessName} · Ficha generada el ${today} · Uso interno</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600); }
}

// ─────────────────────────────────────────────────────────────
// PDF — Estado de Cuenta (formal B2B account statement)
// ─────────────────────────────────────────────────────────────
function exportAccountStatementPDF(
  c: any,
  customerSales: any[],
  customerDebts: any[],
  businessName: string,
) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

  // Build unified transaction list sorted by date asc
  interface Transaction {
    date: string;
    desc: string;
    debit: number;   // amount the customer owes (purchase/debt)
    credit: number;  // amount already paid
    ref: string;
  }
  const transactions: Transaction[] = [];

  // Sales
  for (const s of customerSales) {
    const amount = Number(s.total_ars || 0);
    transactions.push({
      date: s.date ? new Date(s.date).toLocaleDateString('es-AR') : '—',
      desc: s.product_name || 'Venta',
      debit: amount,
      credit: s.paid ? amount : 0,
      ref: 'Venta',
    });
  }

  // Debts (not-yet-paid)
  for (const d of customerDebts) {
    if (!d.paid) {
      transactions.push({
        date: d.created_at ? new Date(d.created_at).toLocaleDateString('es-AR') : '—',
        desc: d.concept || d.note || 'Deuda pendiente',
        debit: Number(d.amount || d.remaining_ars || 0),
        credit: 0,
        ref: 'Deuda',
      });
    }
  }

  // Sort by date ascending
  transactions.sort((a, b) => {
    const da = a.date.split('/').reverse().join('-');
    const db = b.date.split('/').reverse().join('-');
    return da.localeCompare(db);
  });

  // Running balance
  let runningBalance = 0;
  const rows = transactions.map(t => {
    runningBalance += t.debit - t.credit;
    const balanceClass = runningBalance > 0 ? 'color:#ef4444' : runningBalance < 0 ? 'color:#16a34a' : '';
    return `<tr>
      <td>${t.date}</td>
      <td>${t.ref}</td>
      <td>${t.desc}</td>
      <td style="text-align:right">${t.debit > 0 ? fmt(t.debit) : '—'}</td>
      <td style="text-align:right;color:#16a34a">${t.credit > 0 ? fmt(t.credit) : '—'}</td>
      <td style="text-align:right;font-weight:600;${balanceClass}">${fmt(runningBalance)}</td>
    </tr>`;
  }).join('');

  const totalPurchased = transactions.reduce((s, t) => s + t.debit, 0);
  const totalPaid = transactions.reduce((s, t) => s + t.credit, 0);
  const totalBalance = totalPurchased - totalPaid;

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Estado de Cuenta — ${c.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #1a1a2e; padding: 24px; font-size: 12px; }
  .header { background: #1a1a2e; color: #fff; padding: 24px 28px; border-radius: 10px 10px 0 0; display: flex; justify-content: space-between; align-items: flex-start; }
  .header-left h1 { color: #d4a843; font-size: 22px; font-weight: 800; margin-bottom: 4px; }
  .header-left p { color: rgba(255,255,255,0.55); font-size: 11px; }
  .header-right { text-align: right; }
  .header-right .doc-title { font-size: 14px; font-weight: 700; color: #d4a843; margin-bottom: 4px; }
  .header-right .doc-date { font-size: 10px; color: rgba(255,255,255,0.5); }
  .subheader { background: #f9f9fb; border: 1px solid #e5e7eb; border-top: none; padding: 14px 28px; margin-bottom: 20px; border-radius: 0 0 4px 4px; display: flex; gap: 32px; }
  .sub-item .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 3px; }
  .sub-item .value { font-size: 13px; font-weight: 600; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .summary-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; }
  .summary-card .s-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 4px; }
  .summary-card .s-value { font-size: 18px; font-weight: 900; font-family: monospace; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #1a1a2e; color: #d4a843; padding: 7px 10px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
  tr:nth-child(even) td { background: #fafafa; }
  .total-row td { border-top: 2px solid #d4a843; font-weight: 700; font-size: 12px; background: #fffbeb !important; }
  .footer { text-align: center; font-size: 9px; color: #d1d5db; margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="header">
  <div class="header-left">
    <h1>${businessName}</h1>
    <p>Sistema de Gestión · Generado el ${today}</p>
  </div>
  <div class="header-right">
    <div class="doc-title">ESTADO DE CUENTA</div>
    <div class="doc-date">${today}</div>
  </div>
</div>
<div class="subheader">
  <div class="sub-item"><div class="label">Cliente</div><div class="value">${c.name}</div></div>
  ${c.company ? `<div class="sub-item"><div class="label">Empresa</div><div class="value">${c.company}</div></div>` : ''}
  ${c.email ? `<div class="sub-item"><div class="label">Email</div><div class="value">${c.email}</div></div>` : ''}
  ${c.phone ? `<div class="sub-item"><div class="label">Teléfono</div><div class="value">${c.phone}</div></div>` : ''}
</div>

<div class="summary-grid">
  <div class="summary-card">
    <div class="s-label">Total facturado</div>
    <div class="s-value">${fmt(totalPurchased)}</div>
  </div>
  <div class="summary-card">
    <div class="s-label">Total pagado</div>
    <div class="s-value" style="color:#16a34a">${fmt(totalPaid)}</div>
  </div>
  <div class="summary-card">
    <div class="s-label">Saldo pendiente</div>
    <div class="s-value" style="color:${totalBalance > 0 ? '#ef4444' : '#16a34a'}">${fmt(totalBalance)}</div>
  </div>
</div>

${transactions.length > 0 ? `
<div class="section-title">Movimientos (${transactions.length})</div>
<table>
  <thead>
    <tr>
      <th>Fecha</th>
      <th>Tipo</th>
      <th>Descripción</th>
      <th style="text-align:right">Cargo</th>
      <th style="text-align:right">Abono</th>
      <th style="text-align:right">Saldo</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    <tr class="total-row">
      <td colspan="3">TOTALES</td>
      <td style="text-align:right">${fmt(totalPurchased)}</td>
      <td style="text-align:right;color:#16a34a">${fmt(totalPaid)}</td>
      <td style="text-align:right;color:${totalBalance > 0 ? '#ef4444' : '#16a34a'}">${fmt(totalBalance)}</td>
    </tr>
  </tbody>
</table>` : '<p style="color:#9ca3af;font-size:12px">Sin movimientos registrados.</p>'}

<div class="footer">
  ${businessName} · Estado de cuenta al ${today} · Documento generado automáticamente · No requiere firma
</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=960,height=720');
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600); }
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function CustomersPage() {
  usePageTitle("Clientes — CRM");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { canCreate, canEdit, canDelete } = useModulePermissions("customers");
  const [sales, setSales] = useState<any[]>([]);
  const [recoProducts, setRecoProducts] = useState<any[]>([]);
  const [perfumeDetailsById, setPerfumeDetailsById] = useState<Record<string, any>>({});
  const [recoForCustomer, setRecoForCustomer] = useState<CustomerProfile | null>(null);
  const [debts, setDebts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = usePersistedState(
    orgViewKey("customers.search", activeOrg?.id),
    "",
  );
  const [segmentFilter, setSegmentFilter] = usePersistedState(
    orgViewKey("customers.segment-filter", activeOrg?.id),
    "all",
  );
  const [sortBy, setSortBy] = usePersistedState<"totalSpent" | "purchaseCount" | "lastPurchase" | "avgTicket" | "healthScore" | "clv" | "churnRisk">(
    orgViewKey("customers.sort", activeOrg?.id),
    "totalSpent",
  );
  const [savedSegments, setSavedSegments] = useState<SavedCRMSegment[]>([]);
  const [saveSegmentName, setSaveSegmentName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = usePersistedState<string | null>(
    orgViewKey("customers.selected", activeOrg?.id),
    null,
  );
  const [customerDetailTab, setCustomerDetailTab] = usePersistedState(
    orgViewKey("customers.detail-tab", `${activeOrg?.id || "default"}.${selectedCustomer || "none"}`),
    "resumen",
  );
  // `profile` puede venir parcial: al crear desde una fila sin ficha solo se
  // conoce el nombre, y el `id` decide si se crea o se actualiza.
  const [formModal, setFormModal] = useState<{ open: boolean; profile?: Partial<CustomerProfile> }>({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [csvPreview, setCsvPreview] = useState<{ headers: string[]; rows: string[][]; mapping: Record<string, string> } | null>(null);
  const [showRFM, setShowRFM] = useState(false);
  const [rfmSort, setRfmSort] = useState<"rfmScore" | "rScore" | "fScore" | "mScore">("rfmScore");
  const [csvPreviewOpen, setCsvPreviewOpen] = useState(false);
  const [installments, setInstallments] = useState<any[]>([]);
  const [payingInstallment, setPayingInstallment] = useState<string | null>(null);
  const [loyaltyBalances, setLoyaltyBalances] = useState<Record<string, number>>({});
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [mergingCustomer, setMergingCustomer] = useState<{ name: string; id: string | null } | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [merging, setMerging] = useState(false);
  const [selectedCustomerNames, setSelectedCustomerNames] = useState<Set<string>>(new Set());
  const [bulkWaOpen, setBulkWaOpen] = useState(false);
  const [bulkWaMessage, setBulkWaMessage] = useState("Hola {{nombre}}! 👋 Tenemos novedades y promociones especiales esperándote. ¡Pasate a vernos! 🛍️");
  const [bulkNoteOpen, setBulkNoteOpen] = useState(false);
  const [bulkNoteText, setBulkNoteText] = useState("");
  const [bulkNoteSaving, setBulkNoteSaving] = useState(false);
  const [quickNoteCustomer, setQuickNoteCustomer] = useState<string | null>(null);
  const [quickNoteText, setQuickNoteText] = useState("");
  const [quickNoteSaving, setQuickNoteSaving] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [filterBirthday, setFilterBirthday] = usePersistedState(
    orgViewKey("customers.birthday-filter", activeOrg?.id),
    "all",
  );
  const [filterSeller, setFilterSeller] = usePersistedState(
    orgViewKey("customers.seller-filter", activeOrg?.id),
    "all",
  );
  const [filterCompany, setFilterCompany] = usePersistedState(
    orgViewKey("customers.company-filter", activeOrg?.id),
    "all",
  );
  const [bulkBdayWaOpen, setBulkBdayWaOpen] = useState(false);
  const navigate = useNavigate();
  const [identityParams, setIdentityParams] = useSearchParams();

  // Reset follow-up form when switching customers
  useEffect(() => {
    setFollowUpOpen(false);
    setFollowUpDate("");
    setFollowUpNote("");
  }, [selectedCustomer]);

  const scheduleFollowUp = useCallback(async (customerName: string) => {
    if (!activeOrg || !user || !followUpDate) { toast.error("Seleccioná una fecha"); return; }
    setFollowUpSaving(true);
    try {
      const { error } = await supabase.from("tasks").insert({
        org_id: activeOrg.id,
        created_by: user.id,
        title: `Seguimiento: ${customerName}`,
        description: followUpNote.trim() || null,
        priority: "medium",
        due_date: followUpDate,
        category: "followup",
        status: "pending",
      });
      if (error) throw error;
      toast.success(`Seguimiento programado para ${new Date(followUpDate + "T12:00:00").toLocaleDateString("es-AR")}`);
      setFollowUpOpen(false);
      setFollowUpDate("");
      setFollowUpNote("");
    } catch (e: any) {
      toast.error("Error al programar seguimiento: " + e.message);
    } finally {
      setFollowUpSaving(false);
    }
  }, [activeOrg, user, followUpDate, followUpNote]);

  const loadData = async () => {
    if (!user) return;
    const orgId = await import("@/lib/orgContext").then(m => m.getActiveOrgId());
    const [s, d, st, profs, segs, prodRes, ppdRes] = await Promise.all([
      getSalesDB(user.id),
      getDebtsDB(user.id),
      getSettingsDB(user.id),
      getCustomersDB(user.id).catch(() => [] as CustomerProfile[]),
      getCRMSegmentsDB(user.id).catch(() => [] as SavedCRMSegment[]),
      supabase.from("products").select("id, name, brand, image_url, sale_price_ars, discount_price_ars, category").eq("org_id", orgId).gt("stock", 0),
      supabase.from("product_perfume_details").select("*").eq("org_id", orgId),
    ]);
    setSales(s);
    setDebts(d);
    setSettings(st);
    setProfiles(profs as unknown as CustomerProfile[]);
    setRecoProducts((prodRes.data as any[]) || []);
    const dmap: Record<string, any> = {};
    (ppdRes.data || []).forEach((r: any) => { dmap[r.product_id] = r; });
    setPerfumeDetailsById(dmap);
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
    const identityId = identityParams.get("identity");
    if (!identityId || loading) return;
    const profile = profiles.find(item => item.id === identityId);
    if (!profile) return;
    setFormModal({ open: true, profile });
    const next = new URLSearchParams(identityParams);
    next.delete("identity");
    setIdentityParams(next, { replace: true });
  }, [identityParams, loading, profiles, setIdentityParams]);

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
    if (!mergingCustomer.id) {
      toast.error("El origen necesita una ficha de cliente antes de fusionar");
      return;
    }
    const srcProfile = profiles.find(profile => profile.id === mergingCustomer.id);
    const dstProfile = profiles.find(profile => profile.id === mergeTarget);
    if (!srcProfile || !dstProfile) {
      toast.error("Seleccioná dos fichas de cliente válidas");
      return;
    }
    if (srcProfile.id === dstProfile.id) {
      toast.error("El cliente destino debe ser diferente al origen");
      return;
    }
    if (!confirm(`¿Combinar "${srcProfile.name}" en "${dstProfile.name}"? Sólo se moverán filas ya enlazadas por ID. Esta acción no se puede deshacer.`)) return;
    setMerging(true);
    try {
      const orgId = activeOrg.id;

      const reasignar = async (tabla: "sales" | "debts" | "loyalty_points") => {
        const { error } = await supabase.from(tabla)
          .update({ customer_name: dstProfile.name, customer_id: dstProfile.id })
          .eq("org_id", orgId)
          .eq("customer_id", srcProfile.id);
        if (error) throw error;
      };

      await reasignar("sales");
      await reasignar("debts");
      await reasignar("loyalty_points");

      const { error: deleteError } = await supabase.from("customers").delete().eq("id", srcProfile.id);
      if (deleteError) throw deleteError;
      toast.success(`"${srcProfile.name}" fusionado con "${dstProfile.name}"`);
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
        .select("customer_name, customer_id, delta")
        .eq("org_id", activeOrg.id),
      supabase
        .from("settings")
        .select("loyalty_enabled")
        .eq("org_id", activeOrg.id)
        .maybeSingle(),
    ]).then(([{ data: pts }, { data: sett }]) => {
      if (sett) setLoyaltyEnabled(!!sett.loyalty_enabled);
      if (pts) {
        // Se acumula por id cuando lo hay: con el nombre crudo como clave, los
        // puntos de "Juan Perez" y "juan  perez" eran dos saldos distintos y
        // ninguno era el saldo real.
        const map: Record<string, number> = {};
        for (const row of pts as { customer_name: string | null; customer_id: string | null; delta: number }[]) {
          const key = row.customer_id ?? normalizeName(row.customer_name);
          if (!key) continue;
          map[key] = (map[key] || 0) + Number(row.delta);
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

  /**
   * Saldo de puntos de un cliente. El mapa está indexado por id cuando lo hay,
   * así que leerlo por nombre devolvía 0 para todo el que ya estaba enlazado.
   */
  const saldoDe = useCallback(
    (c: CustomerData) => loyaltyBalances[c.customerId ?? normalizeName(c.name) ?? ""] || 0,
    [loyaltyBalances],
  );

  /** Referencia del cliente para cruzar filas. Se arma en un solo lugar. */
  const refDe = useCallback((c: CustomerData): CustomerRef => ({ id: c.customerId, name: c.name }), []);

  // Nombre normalizado → id del cliente. Espejo de lo que hace el trigger
  // `trg_sales_link_customer` en la base, para que una fila todavía sin
  // `customer_id` caiga en la misma ficha que las ya enlazadas.
  const profileIdByName = useMemo(() => {
    const map: Record<string, string> = {};
    // El más antiguo gana ante homónimos, igual que en SQL.
    [...profiles]
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
      .forEach(pr => {
        const n = normalizeName(pr.name);
        if (n && !map[n]) map[n] = pr.id;
      });
    return map;
  }, [profiles]);

  // Aggregate customer data from sales
  const customers = useMemo(() => {
    const map: Record<string, CustomerData> = {};
    const now = Date.now();

    /**
     * Clave de agrupación. El id manda; si la fila no está enlazada se usa el
     * id que le correspondería por nombre, y recién si tampoco existe se
     * agrupa por el nombre normalizado.
     *
     * Con el nombre crudo como clave, "Juan Perez" y "juan  perez" eran dos
     * clientes distintos en la lista, cada uno con la mitad de las compras.
     */
    const claveDe = (row: { customer_id?: string | null; customer_name?: string | null }) => {
      if (row.customer_id) return row.customer_id;
      const n = normalizeName(row.customer_name);
      if (!n) return "__anonimo__";
      return profileIdByName[n] ?? n;
    };

    sales.forEach((s: any) => {
      const name = s.customer_name || "Cliente anónimo";
      const key = claveDe(s);
      if (!map[key]) {
        map[key] = {
          name, customerId: s.customer_id ?? profileIdByName[normalizeName(name) ?? ""] ?? null,
          totalSpent: 0, totalProfit: 0, purchaseCount: 0, totalUnits: 0, avgTicket: 0,
          lastPurchase: s.date, firstPurchase: s.date, daysSinceLastPurchase: 0,
          frequency: 0, pendingDebt: 0, products: {}, segment: "", segmentColor: "", sellers: [], clv: 0, churnRisk: 0, healthScore: 0,
        };
      }
      const c = map[key];
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
      if (s.seller_name?.trim() && !c.sellers.includes(s.seller_name.trim())) c.sellers.push(s.seller_name.trim());
    });

    debts.filter(d => d.status !== "paid").forEach((d: any) => {
      const key = claveDe(d);
      if (map[key]) map[key].pendingDebt += Number(d.remaining_ars);
    });

    // Merge profiles
    profiles.forEach(p => {
      // Por id: así el perfil cae sobre el mismo grupo que sus ventas, aunque
      // el nombre esté escrito distinto en una y otra tabla.
      if (!map[p.id]) {
        // Profile exists but no sales yet — show it anyway
        map[p.id] = {
          name: p.name, customerId: p.id,
          totalSpent: 0, totalProfit: 0, purchaseCount: 0, totalUnits: 0,
          avgTicket: 0, lastPurchase: new Date().toISOString(), firstPurchase: new Date().toISOString(),
          daysSinceLastPurchase: 999, frequency: 999, pendingDebt: 0, products: {},
          segment: "Sin compras", segmentColor: "bg-muted text-muted-foreground", sellers: [], clv: 0, churnRisk: 0, healthScore: 0,
        };
      }
      const c = map[p.id];
      if (c) {
        // El nombre del perfil es el bueno: es el que el comercio mantiene.
        c.name = p.name;
        c.customerId = p.id;
        c.profileId = p.id;
        c.company = p.company;
        c.email = p.email;
        c.phone = p.phone;
        c.address = p.address;
        c.birthday = p.birthday;
        c.tags = p.tags;
        c.profileNotes = p.notes;
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
      c.churnRisk = 0;
      return c;
    });
    // Compute health scores (monetary uses percentile across all customers)
    const monetarySorted = list.filter(c => c.purchaseCount > 0).map(c => c.totalSpent).sort((a, b) => a - b);
    list.forEach(c => {
      c.healthScore = computeHealthScore(c, monetarySorted);
      // Projected CLV = avgTicket × purchasesPerYear × retentionYears
      const purchasesPerYear = c.frequency > 0 && c.frequency < 365 ? 365 / c.frequency : (c.purchaseCount > 0 ? c.purchaseCount : 0);
      const retentionYears = c.segment === "VIP" ? 3 : c.segment === "Premium" ? 2 : c.segment === "Frecuente" ? 1.5 : c.segment === "Activo" ? 1 : c.segment === "En riesgo" ? 0.5 : 0.25;
      c.clv = c.avgTicket > 0 ? Math.round(c.avgTicket * purchasesPerYear * retentionYears) : 0;
      // Churn risk: predicted probability of losing this customer (0-100)
      c.churnRisk = computeChurnRisk(c);
    });
    return list;
  }, [sales, debts, profiles, profileIdByName]);

  // Helper: check if a birthday falls within a range relative to today (comparing month+day only)
  const bdayInRange = (birthday: string | undefined, range: string): boolean => {
    if (!birthday) return false;
    const bd = new Date(birthday + 'T12:00:00');
    const bMonth = bd.getMonth();
    const bDay = bd.getDate();
    const today = new Date();
    if (range === 'this_month') return bMonth === today.getMonth();
    if (range === 'this_week') {
      for (let i = 0; i <= 7; i++) {
        const d = new Date(today); d.setDate(today.getDate() + i);
        if (d.getMonth() === bMonth && d.getDate() === bDay) return true;
      }
      return false;
    }
    return false;
  };

  // All unique sellers from raw sales data
  const sellerOptions = useMemo(() => {
    const names = new Set<string>();
    sales.forEach((s: any) => { if (s.seller_name?.trim()) names.add(s.seller_name.trim()); });
    return Array.from(names).sort();
  }, [sales]);

  const companyOptions = useMemo(() => {
    const names = new Set<string>();
    customers.forEach(c => { if (c.company?.trim()) names.add(c.company.trim()); });
    return Array.from(names).sort();
  }, [customers]);

  const filtered = useMemo(() => {
    let list = customers;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q))
      );
    }
    if (segmentFilter !== "all") list = list.filter(c => c.segment === segmentFilter);
    if (filterBirthday !== "all") list = list.filter(c => bdayInRange(c.birthday, filterBirthday));
    if (filterSeller !== "all") list = list.filter(c => c.sellers.includes(filterSeller));
    if (filterCompany !== "all") list = list.filter(c => c.company === filterCompany);
    list.sort((a, b) => {
      if (sortBy === "lastPurchase") return new Date(b.lastPurchase).getTime() - new Date(a.lastPurchase).getTime();
      return b[sortBy as keyof typeof b] as number - (a[sortBy as keyof typeof a] as number);
    });
    return list;
  }, [customers, search, segmentFilter, sortBy, filterBirthday, filterSeller, filterCompany]);

  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    customers.forEach(c => { counts[c.segment] = (counts[c.segment] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [customers]);

  const rfmData = useMemo(() => {
    const withPurchases = customers.filter(c => c.purchaseCount > 0);
    if (withPurchases.length === 0) return [];
    const quintile = (arr: number[], val: number, inverse = false) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = sorted.findIndex(v => v >= val);
      const pct = idx < 0 ? 1 : idx / sorted.length;
      const score = Math.ceil((inverse ? 1 - pct : pct) * 5);
      return Math.max(1, Math.min(5, score));
    };
    const recencies = withPurchases.map(c => c.daysSinceLastPurchase);
    const frequencies = withPurchases.map(c => c.purchaseCount);
    const monetaries = withPurchases.map(c => c.totalSpent);
    return withPurchases.map(c => {
      const rScore = quintile(recencies, c.daysSinceLastPurchase, true);
      const fScore = quintile(frequencies, c.purchaseCount, false);
      const mScore = quintile(monetaries, c.totalSpent, false);
      const rfmScore = rScore + fScore + mScore;
      return { ...c, rScore, fScore, mScore, rfmScore };
    });
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
      ["Nombre", "Empresa", "Segmento", "Score Salud", "Total Gastado (ARS)", "Ganancia (ARS)", "Compras", "Ticket Promedio (ARS)", "Primera Compra", "Última Compra", "Días sin Comprar", "Frecuencia (días)", "Deuda Pendiente (ARS)", "Email", "Teléfono", "Dirección", "Cumpleaños", "Etiquetas"],
      ...filtered.map(c => [
        c.name,
        c.company || "",
        c.segment,
        c.healthScore,
        c.totalSpent.toFixed(2),
        c.totalProfit.toFixed(2),
        c.purchaseCount,
        c.avgTicket.toFixed(2),
        c.firstPurchase || "",
        c.lastPurchase || "",
        c.daysSinceLastPurchase === 9999 ? "" : c.daysSinceLastPurchase,
        c.frequency === 999 ? "" : c.frequency,
        c.pendingDebt.toFixed(2),
        c.email || "",
        c.phone || "",
        c.address || "",
        c.birthday || "",
        (c.tags || []).join(", "),
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
    const created = await createCustomerDB(user.id, data as Parameters<typeof createCustomerDB>[1]);
    toast.success("Cliente creado");

    // ── Fire-and-forget territory auto-assignment ─────────────────────────
    // Builds a flat attribute blob the rule engine can match against.
    if (created?.id && created?.org_id) {
      (async () => {
        try {
          const c = created as Record<string, unknown>;
          const address = (c.address as string | null) ?? "";
          // crude city/province parse — works for "Calle 123, Córdoba, Córdoba"
          const parts = address.split(",").map(p => p.trim()).filter(Boolean);
          const attributes = {
            city:     parts[parts.length - 2] ?? "",
            province: parts[parts.length - 1] ?? "",
            tag:      Array.isArray(c.tags) ? (c.tags as string[]).join(",") : "",
            source:   "customer_create",
          };
          const { data: assigned } = await supabase.rpc("apply_territory_rules", {
            p_org_id:      created.org_id,
            p_entity_type: "customer",
            p_entity_id:   created.id,
            p_attributes:  attributes,
          });
          if (assigned) {
            // Optional: bubble up a subtle toast (skip if you want it silent)
            toast.message("📍 Cliente asignado por regla de territorio", { duration: 3000 });
          }
        } catch {
          // Silent — territory rules are optional
        }
      })();
    }

    await loadData();
  };

  const handleUpdate = async (id: string, data: Partial<CustomerProfile>) => {
    await updateCustomerDB(id, data);
    toast.success("Cliente actualizado");
    await loadData();
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  };

  const CSV_FIELD_OPTIONS = [
    { value: '', label: '— Ignorar —' },
    { value: 'name', label: 'Nombre' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Teléfono' },
    { value: 'address', label: 'Dirección' },
    { value: 'birthday', label: 'Cumpleaños (YYYY-MM-DD)' },
    { value: 'notes', label: 'Notas' },
  ];

  const autoDetectMapping = (headers: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    headers.forEach((h, i) => {
      const lower = h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const idx = String(i);
      if (/nombre|name/.test(lower)) mapping[idx] = 'name';
      else if (/email|correo|mail/.test(lower)) mapping[idx] = 'email';
      else if (/tel[ef]|phone|celular|movil/.test(lower)) mapping[idx] = 'phone';
      else if (/direcc|address|domicilio/.test(lower)) mapping[idx] = 'address';
      else if (/cumplea|birth|nacimiento/.test(lower)) mapping[idx] = 'birthday';
      else if (/nota|note/.test(lower)) mapping[idx] = 'notes';
      else mapping[idx] = '';
    });
    return mapping;
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast.error("El CSV está vacío o mal formateado"); return; }
      const headers = parseCSVLine(lines[0]);
      const dataRows = lines.slice(1).map(l => parseCSVLine(l)).filter(r => r.some(c => c));
      const mapping = autoDetectMapping(headers);
      setCsvPreview({ headers, rows: dataRows.slice(0, 200), mapping });
      setCsvPreviewOpen(true);
    } catch {
      toast.error("Error al leer el archivo CSV");
    }
  };

  const handleCsvConfirmImport = async () => {
    if (!csvPreview || !user) return;
    setImporting(true);
    const { headers, rows, mapping } = csvPreview;
    const existingEmails = new Set<string>();
    const existingPhones = new Set<string>();
    const existingNamesWithoutContact = new Set<string>();
    profiles.forEach(profile => {
      const emailKey = normalizeIdentityEmail(profile.email);
      const phoneKey = normalizeIdentityPhone(profile.phone || profile.whatsapp_number);
      const nameKey = normalizeIdentityText(profile.name);
      if (emailKey) existingEmails.add(emailKey);
      if (phoneKey) existingPhones.add(phoneKey);
      if (nameKey && !emailKey && !phoneKey) existingNamesWithoutContact.add(nameKey);
    });
    customers.forEach(customer => {
      const emailKey = normalizeIdentityEmail(customer.email);
      const phoneKey = normalizeIdentityPhone(customer.phone);
      const nameKey = normalizeIdentityText(customer.name);
      if (emailKey) existingEmails.add(emailKey);
      if (phoneKey) existingPhones.add(phoneKey);
      if (nameKey && !emailKey && !phoneKey) existingNamesWithoutContact.add(nameKey);
    });
    let ok = 0, skipped = 0, failed = 0;
    for (const row of rows) {
      const get = (field: string) => {
        const col = Object.entries(mapping).find(([, v]) => v === field)?.[0];
        return col !== undefined ? (row[Number(col)] || '').trim() : '';
      };
      const name = get('name');
      if (!name) continue;
      const emailKey = normalizeIdentityEmail(get('email'));
      const phoneKey = normalizeIdentityPhone(get('phone'));
      const nameKey = normalizeIdentityText(name);
      // Contact keys are strong. A name alone only skips when both records
      // lack contact data; homonyms with different contacts remain importable.
      if (
        (emailKey && existingEmails.has(emailKey))
        || (phoneKey && existingPhones.has(phoneKey))
        || (!emailKey && !phoneKey && nameKey && existingNamesWithoutContact.has(nameKey))
      ) { skipped++; continue; }
      try {
        await createCustomerDB(user.id, {
          name,
          email: get('email') || undefined,
          phone: get('phone') || undefined,
          address: get('address') || undefined,
          birthday: get('birthday') || undefined,
        });
        if (emailKey) existingEmails.add(emailKey);
        if (phoneKey) existingPhones.add(phoneKey);
        if (nameKey && !emailKey && !phoneKey) existingNamesWithoutContact.add(nameKey);
        ok++;
      } catch { failed++; }
    }
    const msgs = [`${ok} importado${ok !== 1 ? 's' : ''}`];
    if (skipped > 0) msgs.push(`${skipped} duplicado${skipped !== 1 ? 's' : ''} omitido${skipped !== 1 ? 's' : ''}`);
    if (failed > 0) msgs.push(`${failed} fallido${failed !== 1 ? 's' : ''}`);
    toast.success(msgs.join(' · '));
    setCsvPreviewOpen(false);
    setCsvPreview(null);
    await loadData();
    setImporting(false);
  };

  const saveQuickNote = async (customer: CustomerData) => {
    if (!quickNoteText.trim() || !user || !activeOrg) return;
    setQuickNoteSaving(true);
    try {
      await appendCustomerNote(activeOrg.id, user.id, customer, quickNoteText);
      toast.success("Nota guardada");
      setQuickNoteCustomer(null);
      setQuickNoteText("");
      await loadData();
    } catch {
      toast.error("Error al guardar la nota");
    } finally {
      setQuickNoteSaving(false);
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

  /**
   * Derecho de supresión (Ley 25.326). No se borran las ventas — AFIP exige
   * conservar los comprobantes — sino que se reemplaza el PII por un seudónimo
   * estable en todas las tablas de la organización.
   */
  const handleAnonymize = async (id: string, name: string) => {
    if (!activeOrg?.id) return;
    if (!confirm(
      `Anonimizar a "${name}"?\n\n` +
      `Se borran nombre, email, teléfono, dirección y notas de forma DEFINITIVA ` +
      `en toda la app. Las ventas se conservan (AFIP lo exige) pero pasan a figurar ` +
      `a nombre de un cliente anonimizado.\n\nEsta acción no se puede deshacer.`
    )) return;

    setDeletingId(id);
    try {
      const { data, error } = await supabase.rpc("anonymize_customer", {
        p_org_id: activeOrg.id,
        p_customer_id: id,
      });
      if (error) throw error;
      const tablas = (data as any)?.tablas?.length ?? 0;
      toast.success(`Cliente anonimizado${tablas ? ` · ${tablas} tabla${tablas > 1 ? "s" : ""} actualizada${tablas > 1 ? "s" : ""}` : ""}`);
      await loadData();
      if (selectedCustomer === name) setSelectedCustomer(null);
    } catch (e: any) {
      toast.error("No se pudo anonimizar: " + (e?.message ?? "error desconocido"));
    } finally {
      setDeletingId(null);
    }
  };

  const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    color: "hsl(40, 20%, 92%)",
  };

  // Top 5 clientes del mes actual
  const topThisMonth = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthSales = sales.filter((s: any) => String(s.date).slice(0, 7) === thisMonth);
    if (!monthSales.length) return [];
    const map: Record<string, { name: string; total: number; count: number }> = {};
    monthSales.forEach((s: any) => {
      const n = s.customer_name || "Anónimo";
      if (!map[n]) map[n] = { name: n, total: 0, count: 0 };
      map[n].total += Number(s.total_ars);
      map[n].count++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [sales]);

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
    <div className="workspace-page workspace-customers space-y-6 pb-12">
      {/* Form modal */}
      {formModal.open && (
        <CustomerFormModal
          initial={formModal.profile}
          onSave={formModal.profile?.id
            ? (data) => handleUpdate(formModal.profile!.id!, data)
            : handleCreate
          }
          onClose={() => setFormModal({ open: false })}
          orgId={activeOrg?.id}
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
          <div className="flex flex-wrap gap-2 flex-wrap">
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

      {/* Compradores que nunca entraron a la lista */}
      <UnlinkedSalesPanel />

      {activeOrg?.id && (
        <IdentityHealthPanel
          entity="customers"
          orgId={activeOrg.id}
          onOpenCustomer={canEdit ? (id) => {
            const profile = profiles.find(item => item.id === id);
            if (!profile) return;
            setFormModal({ open: true, profile });
          } : undefined}
        />
      )}

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

      {/* Top clientes del mes */}
      {topThisMonth.length > 0 && (
        <div className="workspace-customer-top bg-card border border-border/60 rounded-[10px] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Crown className="w-4 h-4 text-primary" />
              Top clientes — {new Date().toLocaleDateString('es-AR', { month: 'long' })}
            </h2>
            <button
              onClick={() => {
                const monthLabel = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
                const header = 'Posición,Nombre,Total ARS,Compras,VIP';
                const rows = topThisMonth.map((c, i) => {
                  const cData = customers.find((x: any) => x.name === c.name);
                  const isVip = cData?.segment === 'VIP' || cData?.segment === 'Premium';
                  return `${i + 1},"${c.name}",${c.total.toFixed(2)},${c.count},${isVip ? 'Sí' : 'No'}`;
                });
                const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = `top-clientes-${monthLabel.replace(/\s/g, '-')}.csv`; a.click();
              }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded border border-border hover:border-primary/30"
              title="Exportar CSV"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              CSV
            </button>
          </div>
          <div className="space-y-2.5">
            {topThisMonth.map((c, i) => {
              const customerData = customers.find(x => x.name === c.name);
              const isVip = customerData?.segment === 'VIP' || customerData?.segment === 'Premium';
              const barPct = (c.total / topThisMonth[0].total) * 100;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className={`w-5 text-center text-xs font-bold shrink-0 ${i === 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm font-medium truncate">{c.name}</span>
                      {isVip && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">VIP</span>}
                      <span className="shrink-0 text-[10px] text-muted-foreground">{c.count}x</span>
                    </div>
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/50 rounded-full transition-all" style={{ width: `${barPct}%` }} />
                    </div>
                  </div>
                  <span className="text-sm font-mono font-semibold text-primary shrink-0">{formatARS(c.total)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Segmentation Chart */}
      {segmentCounts.length > 0 && (
        <div className="workspace-customer-segments bg-card border border-border/60 rounded-[10px] p-4 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Segmentación Automática</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {segmentCounts.map(s => (
              <button
                key={s.name}
                onClick={() => setSegmentFilter(segmentFilter === s.name ? "all" : s.name)}
                className={`px-3 py-1.5 rounded-[5px] text-xs font-medium transition-all ${segmentFilter === s.name ? "ring-2 ring-primary" : ""}`}
                style={{ background: `${SEGMENT_COLORS[s.name] || "hsl(var(--muted-foreground))"}22`, color: SEGMENT_COLORS[s.name] || "hsl(var(--muted-foreground))" }}
              >
                {s.name} ({s.value})
              </button>
            ))}
            {segmentFilter !== "all" && (
              <button onClick={() => setSegmentFilter("all")} className="px-3 py-1.5 rounded-[5px] text-xs font-medium bg-muted text-muted-foreground">
                Todos
              </button>
            )}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={segmentCounts} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} width={80} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Clientes">
                {segmentCounts.map((s, i) => <Cell key={i} fill={SEGMENT_COLORS[s.name] || "hsl(var(--muted-foreground))"} />)}
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
          <div className="workspace-customer-risk bg-orange-500/5 border border-orange-500/30 rounded-[10px] p-4 mb-6">
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
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] text-xs font-medium border transition-all ${c.phone ? "border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 cursor-pointer" : "border-border bg-muted text-muted-foreground cursor-default"}`}
                  title={c.phone ? "Enviar WhatsApp de reactivación" : "Sin teléfono registrado"}
                  onClick={e => { if (!c.phone) e.preventDefault(); }}
                >
                  <MessageCircle className="w-3 h-3" />
                  {c.name.split(' ')[0]} ({c.daysSinceLastPurchase}d)
                </a>
              ))}
              {atRisk.length > 6 && (
                <button onClick={() => setSegmentFilter(segmentFilter === "En riesgo" ? "all" : "En riesgo")} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[5px] text-xs font-medium bg-muted text-muted-foreground border border-border hover:bg-muted/80">
                  +{atRisk.length - 6} más →
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* RFM Analysis Panel */}
      {rfmData.length > 0 && (
        <div className="workspace-customer-rfm bg-card border border-border/60 rounded-[10px] mb-4">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            onClick={() => setShowRFM(v => !v)}
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold font-display tracking-tight">Análisis RFM</span>
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{rfmData.length} clientes con compras</span>
            </div>
            {showRFM ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showRFM && (
            <div className="border-t border-border px-4 pb-4 pt-3">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Recency (R)", desc: "Cuándo compraron por última vez", key: "rScore" as const, color: "text-blue-400" },
                  { label: "Frequency (F)", desc: "Con qué frecuencia compran", key: "fScore" as const, color: "text-purple-400" },
                  { label: "Monetary (M)", desc: "Cuánto gastan en total", key: "mScore" as const, color: "text-green-400" },
                ].map(dim => {
                  const dist = [1, 2, 3, 4, 5].map(s => rfmData.filter(c => c[dim.key] === s).length);
                  const max = Math.max(...dist, 1);
                  return (
                    <div key={dim.key} className="bg-muted/40 rounded-lg p-3">
                      <p className={`text-xs font-semibold mb-0.5 ${dim.color}`}>{dim.label}</p>
                      <p className="text-[10px] text-muted-foreground mb-2">{dim.desc}</p>
                      <div className="flex items-end gap-1 h-10">
                        {dist.map((count, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                            <div className="w-full rounded-sm bg-primary/60" style={{ height: `${Math.max(4, (count / max) * 100)}%` }} />
                            <span className="text-[8px] text-muted-foreground">{i + 1}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Ordenar por:</span>
                {(["rfmScore", "rScore", "fScore", "mScore"] as const).map(k => (
                  <button key={k} onClick={() => setRfmSort(k)}
                    className={`px-2.5 py-1 rounded-[5px] text-[10px] font-medium border transition-all ${rfmSort === k ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:border-primary/20"}`}
                  >
                    {k === "rfmScore" ? "Total RFM" : k === "rScore" ? "Recency" : k === "fScore" ? "Frequency" : "Monetary"}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1.5 pr-3 font-medium">Cliente</th>
                      <th className="text-left py-1.5 pr-3 font-medium">Segmento</th>
                      <th className="text-center py-1.5 pr-2 font-medium text-blue-400">R</th>
                      <th className="text-center py-1.5 pr-2 font-medium text-purple-400">F</th>
                      <th className="text-center py-1.5 pr-2 font-medium text-green-400">M</th>
                      <th className="text-center py-1.5 pr-3 font-medium">RFM</th>
                      <th className="text-right py-1.5 font-medium">Facturación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rfmData].sort((a, b) => b[rfmSort] - a[rfmSort]).slice(0, 15).map(c => (
                      <tr key={c.name} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="py-1.5 pr-3 font-medium truncate max-w-[120px]">{c.name}</td>
                        <td className="py-1.5 pr-3"><span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${c.segmentColor}`}>{c.segment}</span></td>
                        <td className="text-center py-1.5 pr-2"><span className={`font-bold ${c.rScore >= 4 ? "text-blue-400" : c.rScore <= 2 ? "text-red-400" : "text-muted-foreground"}`}>{c.rScore}</span></td>
                        <td className="text-center py-1.5 pr-2"><span className={`font-bold ${c.fScore >= 4 ? "text-purple-400" : c.fScore <= 2 ? "text-red-400" : "text-muted-foreground"}`}>{c.fScore}</span></td>
                        <td className="text-center py-1.5 pr-2"><span className={`font-bold ${c.mScore >= 4 ? "text-green-400" : c.mScore <= 2 ? "text-red-400" : "text-muted-foreground"}`}>{c.mScore}</span></td>
                        <td className="text-center py-1.5 pr-3">
                          <span className={`font-bold text-sm ${c.rfmScore >= 12 ? "text-green-400" : c.rfmScore >= 8 ? "text-yellow-400" : "text-red-400"}`}>{c.rfmScore}</span>
                          <span className="text-muted-foreground">/15</span>
                        </td>
                        <td className="text-right py-1.5 font-mono">{formatARS(c.totalSpent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between mt-3">
                  {rfmData.length > 15 && (
                    <p className="text-[10px] text-muted-foreground">Mostrando top 15</p>
                  )}
                  <button
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all"
                    onClick={() => {
                      const bom = '﻿';
                      const headers = ['Nombre', 'Segmento', 'R (Recency)', 'F (Frequency)', 'M (Monetary)', 'RFM Total', 'Días desde última compra', 'Compras', 'Facturación ARS'];
                      const rows = [...rfmData].sort((a, b) => b.rfmScore - a.rfmScore).map(c => [
                        c.name, c.segment, c.rScore, c.fScore, c.mScore, c.rfmScore,
                        c.daysSinceLastPurchase < 999 ? c.daysSinceLastPurchase : '',
                        c.purchaseCount, c.totalSpent.toFixed(2),
                      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
                      const csv = bom + [headers.join(','), ...rows].join('\n');
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
                      a.download = `rfm_clientes_${new Date().toISOString().slice(0, 10)}.csv`;
                      a.click();
                      toast.success('RFM exportado');
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />CSV RFM
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved segments */}
      {(savedSegments.length > 0 || segmentFilter !== "all") && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {savedSegments.map(s => (
            <div key={s.id} className="flex items-center gap-1">
              <button
                onClick={() => setSegmentFilter(s.segment)}
                className={`px-3 py-1.5 rounded-[5px] text-xs font-medium border transition-all ${
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
                className="px-3 py-1.5 rounded-[5px] text-xs font-medium border border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-all"
                title="Guardar filtro actual como segmento"
              >
                + Guardar segmento
              </button>
            )
          )}
        </div>
      )}

      {/* Filters */}
      <div className="workspace-customer-filters flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
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
            <SelectItem value="clv">Mayor CLV</SelectItem>
            <SelectItem value="churnRisk">Mayor riesgo de churn</SelectItem>
            <SelectItem value="totalSpent">Mayor facturación</SelectItem>
            <SelectItem value="purchaseCount">Más compras</SelectItem>
            <SelectItem value="avgTicket">Mayor ticket</SelectItem>
            <SelectItem value="lastPurchase">Más reciente</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterBirthday} onValueChange={v => setFilterBirthday(v)}>
          <SelectTrigger className="bg-muted border-border w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">🎂 Cumpleaños: todos</SelectItem>
            <SelectItem value="this_week">Esta semana</SelectItem>
            <SelectItem value="this_month">Este mes</SelectItem>
          </SelectContent>
        </Select>
        {sellerOptions.length > 0 && (
          <Select value={filterSeller} onValueChange={v => setFilterSeller(v)}>
            <SelectTrigger className="bg-muted border-border w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">👤 Vendedor: todos</SelectItem>
              {sellerOptions.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterSeller !== "all" && (
          <button
            onClick={() => setFilterSeller("all")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            <X className="w-3 h-3" />
            {filterSeller}
          </button>
        )}
        {companyOptions.length > 0 && (
          <Select value={filterCompany} onValueChange={v => setFilterCompany(v)}>
            <SelectTrigger className="bg-muted border-border w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">🏢 Empresa: todas</SelectItem>
              {companyOptions.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterCompany !== "all" && (
          <button
            onClick={() => setFilterCompany("all")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            <X className="w-3 h-3" />
            {filterCompany}
          </button>
        )}
      </div>

      {/* Customer List */}
      {/* Bulk email action bar */}
      {selectedCustomerNames.size > 0 && (
        <div className="workspace-customer-bulk-bar fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-primary/40 shadow-xl rounded-[10px] px-4 py-3 animate-in slide-in-from-bottom-4">
          <span className="text-sm font-semibold">{selectedCustomerNames.size} cliente{selectedCustomerNames.size !== 1 ? 's' : ''} seleccionado{selectedCustomerNames.size !== 1 ? 's' : ''}</span>
          <button
            onClick={() => {
              const selected = filtered.filter(c => selectedCustomerNames.has(c.name));
              const emails = selected.map(c => c.email).filter(Boolean);
              const names = selected.map(c => c.name);
              sessionStorage.setItem('gestiona.bulk_campaign', JSON.stringify({ emails, names, count: selected.length, segment: segmentFilter !== 'all' ? segmentFilter : 'custom' }));
              navigate('/email-campaigns');
            }}
            className="px-4 py-1.5 rounded-[5px] bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Crear campaña de email
          </button>
          <button
            onClick={async () => {
              if (!activeOrg) return;
              const selected = filtered.filter(c => selectedCustomerNames.has(c.name));
              const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
              const dueDate = tomorrow.toISOString().slice(0, 10);
              const tasks = selected.map(c => ({
                org_id: activeOrg.id,
                title: `Seguimiento a ${c.name}`,
                priority: "medium",
                due_date: dueDate,
                category: "crm",
                status: "pending",
              }));
              const { error } = await supabase.from("tasks" as any).insert(tasks);
              if (error) { toast.error("Error al crear tareas"); return; }
              toast.success(`${tasks.length} tarea${tasks.length !== 1 ? "s" : ""} de seguimiento creada${tasks.length !== 1 ? "s" : ""} para mañana`);
              setSelectedCustomerNames(new Set());
            }}
            className="px-4 py-1.5 rounded-[5px] bg-muted border border-border text-sm font-medium hover:bg-muted/80 transition-colors flex items-center gap-2"
          >
            <CheckSquare className="w-4 h-4 text-primary" />
            Tarea seguimiento
          </button>
          <button
            onClick={() => { setBulkNoteText(""); setBulkNoteOpen(true); }}
            className="px-4 py-1.5 rounded-[5px] bg-muted border border-border text-sm font-medium hover:bg-muted/80 transition-colors flex items-center gap-2"
          >
            <FileText className="w-4 h-4 text-primary" />
            Agregar nota
          </button>
          <button
            onClick={() => {
              const selected = filtered.filter(c => selectedCustomerNames.has(c.name));
              const withPhone = selected.filter(c => c.phone);
              if (!withPhone.length) { toast.error("Ningún cliente seleccionado tiene teléfono registrado"); return; }
              setBulkWaOpen(true);
            }}
            className="px-4 py-1.5 rounded-[5px] bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors flex items-center gap-2"
          >
            <MessageCircle className="w-4 h-4" />
            WhatsApp masivo
          </button>
          {filtered.filter(c => selectedCustomerNames.has(c.name) && c.birthday && bdayInRange(c.birthday, 'this_month')).length > 0 && (
            <button
              onClick={() => setBulkBdayWaOpen(true)}
              className="px-4 py-1.5 rounded-[5px] bg-pink-600 text-white text-sm font-semibold hover:bg-pink-700 transition-colors flex items-center gap-2"
            >
              🎂 WhatsApp cumpleaños
            </button>
          )}
          <button onClick={() => setSelectedCustomerNames(new Set())} className="text-muted-foreground hover:text-foreground text-xs transition-colors">✕ Limpiar</button>
        </div>
      )}

      {/* Bulk Birthday WhatsApp Dialog */}
      <Dialog open={bulkBdayWaOpen} onOpenChange={setBulkBdayWaOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              🎂 WhatsApp de cumpleaños
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">Se enviarán mensajes personalizados a los clientes seleccionados con cumpleaños este mes.</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto border border-border rounded-lg p-3">
              {filtered
                .filter(c => selectedCustomerNames.has(c.name) && c.birthday && bdayInRange(c.birthday, 'this_month'))
                .map(c => {
                  const bday = new Date(c.birthday! + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long' });
                  const firstName = c.name.split(' ')[0];
                  const msg = `🎂 ¡Feliz cumpleaños ${firstName}! 🎉 Queremos desearte un día increíble. Como regalo especial, tenemos una sorpresa para vos. ¡Te esperamos!`;
                  const waUrl = c.phone
                    ? `https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
                    : null;
                  return (
                    <div key={c.name} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{c.name}</p>
                        <p className="text-[10px] text-pink-400">{bday}</p>
                      </div>
                      {waUrl ? (
                        <a href={waUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-green-400 hover:underline flex items-center gap-1 shrink-0">
                          <MessageCircle className="w-3.5 h-3.5" />Enviar
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Sin teléfono</span>
                      )}
                    </div>
                  );
                })}
            </div>
            <Button className="w-full bg-pink-600 hover:bg-pink-700 text-white" onClick={() => setBulkBdayWaOpen(false)}>Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk WhatsApp Dialog */}
      <Dialog open={bulkWaOpen} onOpenChange={setBulkWaOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-green-400" />
              WhatsApp masivo · {filtered.filter(c => selectedCustomerNames.has(c.name) && c.phone).length} destinatarios
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Mensaje (usá {"{{nombre}}"} para personalizar)</label>
              <Textarea
                value={bulkWaMessage}
                onChange={e => setBulkWaMessage(e.target.value)}
                rows={4}
                className="bg-muted text-sm"
                placeholder="Hola {{nombre}}! Tenemos novedades para vos..."
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Clientes con teléfono — hacé clic en cada link para enviar:</p>
              <div className="max-h-64 overflow-y-auto space-y-1.5 border border-border rounded-lg p-3">
                {filtered.filter(c => selectedCustomerNames.has(c.name) && c.phone).map(c => {
                  const msg = bulkWaMessage.replace(/\{\{nombre\}\}/g, c.name.split(' ')[0]);
                  const waUrl = `https://wa.me/${c.phone!.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
                  return (
                    <a
                      key={c.name}
                      href={waUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground">{c.phone} · {c.segment}</p>
                      </div>
                      <Send className="w-3.5 h-3.5 text-green-400 shrink-0" />
                    </a>
                  );
                })}
                {filtered.filter(c => selectedCustomerNames.has(c.name) && !c.phone).length > 0 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    + {filtered.filter(c => selectedCustomerNames.has(c.name) && !c.phone).length} sin teléfono registrado
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setBulkWaOpen(false)}>Cerrar</Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  const withPhone = filtered.filter(c => selectedCustomerNames.has(c.name) && c.phone);
                  const numbers = withPhone.map(c => c.phone!.replace(/\D/g, '')).join(', ');
                  navigator.clipboard.writeText(numbers);
                  toast.success(`${withPhone.length} números copiados`);
                }}
              >
                <MessageCircle className="w-4 h-4 mr-1.5" />
                Copiar teléfonos
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recomendador de perfumes por cliente */}
      <PerfumeRecommenderModal
        open={!!recoForCustomer}
        onOpenChange={(v) => { if (!v) setRecoForCustomer(null); }}
        title="Perfumes recomendados"
        subtitle={recoForCustomer ? `Para ${recoForCustomer.name} según sus preferencias olfativas` : undefined}
        results={recoForCustomer ? recommendForPreferences(recoForCustomer.scent_preferences || [], recoProducts, perfumeDetailsById, { limit: 8 }) : []}
        onPick={(prod) => { const num = (recoForCustomer?.whatsapp_number || recoForCustomer?.phone || '').replace(/\D/g, ''); if (num) window.open(`https://wa.me/${num}?text=${encodeURIComponent(`Hola ${recoForCustomer?.name?.split(' ')[0] || ''}! Te recomiendo este perfume que va con tu estilo: ${prod.name} 🌟`)}`, '_blank'); }}
      />

      {/* Bulk Note Dialog */}
      <Dialog open={bulkNoteOpen} onOpenChange={setBulkNoteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Nota masiva · {selectedCustomerNames.size} cliente{selectedCustomerNames.size !== 1 ? 's' : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Nota (se añadirá con timestamp a cada cliente)</label>
              <Textarea
                value={bulkNoteText}
                onChange={e => setBulkNoteText(e.target.value)}
                rows={4}
                className="bg-muted text-sm"
                placeholder="Ej: Contactado para campaña de reactivación Mayo 2026..."
                autoFocus
              />
            </div>
            <p className="text-[10px] text-muted-foreground">Se actualizará el campo de notas de cada cliente seleccionado, agregando esta nota con la fecha y hora actual.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setBulkNoteOpen(false)}>Cancelar</Button>
              <Button
                className="flex-1 gradient-gold text-primary-foreground"
                disabled={!bulkNoteText.trim() || bulkNoteSaving}
                onClick={async () => {
                  if (!user || !activeOrg || !bulkNoteText.trim()) return;
                  setBulkNoteSaving(true);
                  try {
                    const selectedList = filtered.filter(c => selectedCustomerNames.has(c.name));
                    // Se cuenta lo que entró de verdad. `Promise.all` con un
                    // await que no lanza daba siempre el total de seleccionados,
                    // aunque no se hubiera guardado ninguna.
                    const results = await Promise.allSettled(
                      selectedList.map(c => appendCustomerNote(activeOrg.id, user.id, c, bulkNoteText))
                    );
                    const ok = results.filter(r => r.status === "fulfilled").length;
                    const fallaron = results.length - ok;
                    if (ok > 0) toast.success(`Nota agregada a ${ok} cliente${ok !== 1 ? 's' : ''}`);
                    if (fallaron > 0) toast.error(`${fallaron} cliente${fallaron !== 1 ? 's' : ''} sin guardar`);
                    setBulkNoteOpen(false);
                    setBulkNoteText("");
                    setSelectedCustomerNames(new Set());
                    await loadData();
                  } catch {
                    toast.error("Error al guardar notas");
                  } finally {
                    setBulkNoteSaving(false);
                  }
                }}
              >
                <FileText className="w-4 h-4 mr-1.5" />Guardar nota
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Import Preview Dialog */}
      <Dialog open={csvPreviewOpen} onOpenChange={o => { if (!importing) setCsvPreviewOpen(o); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              Importar CSV — {csvPreview?.rows.length ?? 0} contactos detectados
            </DialogTitle>
          </DialogHeader>
          {csvPreview && (
            <div className="flex flex-col gap-4 overflow-hidden">
              {/* Column mapping */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Mapeo de columnas</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {csvPreview.headers.map((h, i) => (
                    <div key={i} className="space-y-1 pb-12">
                      <label className="text-[10px] text-muted-foreground font-medium truncate block" title={h}>{h}</label>
                      <select
                        value={csvPreview.mapping[String(i)] || ''}
                        onChange={e => {
                          const newMapping = { ...csvPreview.mapping, [String(i)]: e.target.value };
                          setCsvPreview({ ...csvPreview, mapping: newMapping });
                        }}
                        className="w-full text-xs bg-muted border border-border rounded px-2 py-1"
                      >
                        {CSV_FIELD_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview table */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Vista previa (primeras 5 filas)</p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        {csvPreview.headers.map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left text-muted-foreground font-medium whitespace-nowrap">
                            {h}
                            {csvPreview.mapping[String(i)] && <span className="ml-1 text-primary">→{csvPreview.mapping[String(i)]}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {csvPreview.rows.slice(0, 5).map((row, ri) => (
                        <tr key={ri} className="hover:bg-muted/20">
                          {csvPreview.headers.map((_, ci) => (
                            <td key={ci} className="px-2 py-1.5 text-foreground/80 max-w-[120px] truncate">{row[ci] || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {csvPreview.rows.length > 5 && (
                  <p className="text-[10px] text-muted-foreground mt-1">+{csvPreview.rows.length - 5} filas más · Duplicados por nombre serán omitidos automáticamente.</p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => { setCsvPreviewOpen(false); setCsvPreview(null); }}>Cancelar</Button>
                <Button
                  className="flex-1 gradient-gold text-primary-foreground"
                  disabled={importing || !Object.values(csvPreview.mapping).includes('name')}
                  onClick={handleCsvConfirmImport}
                >
                  {importing
                    ? <><span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />Importando...</>
                    : <><Upload className="w-3.5 h-3.5 mr-1.5" />Importar {csvPreview.rows.length} contactos</>
                  }
                </Button>
              </div>
              {!Object.values(csvPreview.mapping).includes('name') && (
                <p className="text-xs text-destructive text-center -mt-2">Asigná al menos una columna al campo "Nombre" para poder importar.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

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
      <div className="workspace-customer-list pb-12">
          {filtered.map(c => {
            const isExpanded = selectedCustomer === c.name;
            return (
              <div
                key={c.name}
                className={`workspace-customer-row bg-card border rounded-lg shadow-card transition-all ${isExpanded ? "workspace-customer-row-expanded border-primary" : "border-border hover:border-primary/30"}`}
              >
                {/* Main row */}
                <div
                  className="workspace-customer-row__main p-4 cursor-pointer"
                  onClick={() => setSelectedCustomer(isExpanded ? null : c.name)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedCustomerNames.has(c.name)}
                        onClick={e => e.stopPropagation()}
                        onChange={e => {
                          setSelectedCustomerNames(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(c.name); else next.delete(c.name);
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded shrink-0 accent-primary cursor-pointer"
                      />
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{c.name}</p>
                        {c.company && (
                          <p className="text-[10px] text-amber-400/80 font-medium truncate">{c.company}</p>
                        )}
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
                      <ChurnRiskBadge risk={c.churnRisk} />
                      {c.birthday && bdayInRange(c.birthday, 'this_week') && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-pink-500/20 text-pink-400 hidden sm:inline-flex items-center gap-0.5" title={`Cumpleaños: ${new Date(c.birthday + 'T12:00:00').toLocaleDateString('es-AR')}`}>🎂 Esta semana</span>
                      )}
                      {c.birthday && !bdayInRange(c.birthday, 'this_week') && bdayInRange(c.birthday, 'this_month') && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-pink-500/10 text-pink-300 hidden sm:inline-flex items-center gap-0.5" title={`Cumpleaños: ${new Date(c.birthday + 'T12:00:00').toLocaleDateString('es-AR')}`}>🎂 Este mes</span>
                      )}
                      {c.purchaseCount > 0 && (() => {
                        const firstPurchaseDate = new Date(c.firstPurchase);
                        const daysSince = Math.floor((Date.now() - firstPurchaseDate.getTime()) / 86400000);
                        return daysSince <= 30 ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 hidden sm:inline-flex items-center gap-0.5" title={`Primera compra: ${firstPurchaseDate.toLocaleDateString('es-AR')}`}>✨ Nuevo</span>
                        ) : null;
                      })()}
                      {c.purchaseCount > 0 && c.daysSinceLastPurchase >= 60 && c.daysSinceLastPurchase < 999 && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold hidden sm:inline-flex items-center gap-0.5 ${c.daysSinceLastPurchase >= 90 ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'}`}
                          title={`Última compra hace ${c.daysSinceLastPurchase} días`}>
                          🕐 {c.daysSinceLastPurchase}d sin comprar
                        </span>
                      )}
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
                      <div><span className="text-muted-foreground">Ganancia: </span><span className="font-medium text-emerald-400">{formatARS(c.totalProfit)}</span></div>
                      <div><span className="text-muted-foreground">Ticket prom.: </span><span className="font-medium">{formatARS(c.avgTicket)}</span></div>
                      <div><span className="text-muted-foreground">Frecuencia: </span><span className="font-medium">{c.frequency < 999 ? `c/${c.frequency}d` : "Única vez"}</span></div>
                    </div>
                  )}
                </div>

                {/* Expanded details — Ficha 360 */}
                {isExpanded && (
                  <div className="workspace-customer-row__detail px-4 pb-4 pt-2 border-t border-border">
                    {/* Health Score gauge */}
                    {c.purchaseCount > 0 && (
                      <div className="mb-3 bg-muted/40 rounded-[8px] px-4 py-3">
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
                              id: c.profileId, name: c.name, company: c.company, email: c.email, phone: c.phone,
                              address: c.address, birthday: c.birthday, tags: c.tags, notes: c.profileNotes,
                            } : { name: c.name },
                          })}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          {c.profileId ? "Editar perfil" : "Crear perfil"}
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                          onClick={() => {
                            setQuickNoteCustomer(quickNoteCustomer === c.name ? null : c.name);
                            setQuickNoteText("");
                          }}
                        >
                          <FileText className="w-3.5 h-3.5" />Nota rápida
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
                      {canDelete && c.profileId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs text-amber-500 hover:text-amber-500 border-amber-500/30 hover:border-amber-500/60"
                          onClick={() => handleAnonymize(c.profileId!, c.name)}
                          disabled={deletingId === c.profileId}
                          title="Derecho de supresión (Ley 25.326): borra los datos personales pero conserva las ventas"
                        >
                          <EyeOff className="w-3.5 h-3.5" />Anonimizar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-xs text-muted-foreground"
                        onClick={() => exportCustomer360PDF(
                          c,
                          rowsOfCustomer(sales as any[], refDe(c))
                            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()),
                          settings?.business_name || 'Mi Negocio'
                        )}
                        title="Exportar ficha completa del cliente en PDF"
                      >
                        <Printer className="w-3.5 h-3.5" />PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-xs text-muted-foreground"
                        onClick={() => exportAccountStatementPDF(
                          c,
                          rowsOfCustomer(sales as any[], refDe(c)),
                          rowsOfCustomer(debts as any[], refDe(c)),
                          settings?.business_name || 'Mi Negocio'
                        )}
                        title="Estado de cuenta formal para enviar al cliente"
                      >
                        <FileText className="w-3.5 h-3.5" />Cta. Cte.
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-xs text-muted-foreground ml-auto"
                        onClick={() => {
                          const sameSource = mergingCustomer?.name === c.name && mergingCustomer.id === (c.customerId ?? null);
                          setMergingCustomer(sameSource ? null : { name: c.name, id: c.customerId ?? null });
                          setMergeTarget("");
                        }}
                        title="Fusionar este cliente con otro (útil para duplicados)"
                      >
                        <Merge className="w-3.5 h-3.5" />Fusionar
                      </Button>
                    </div>

                    {/* Inline quick note */}
                    {quickNoteCustomer === c.name && (
                      <div className="mb-3 p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                        <p className="text-xs font-medium text-primary flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />Agregar nota rápida a {c.name}
                        </p>
                        <textarea
                          autoFocus
                          value={quickNoteText}
                          onChange={e => setQuickNoteText(e.target.value)}
                          placeholder="Escribí la nota aquí… (se guarda con fecha y hora)"
                          rows={2}
                          maxLength={500}
                          className="w-full text-xs bg-muted border border-border rounded-md px-2.5 py-2 resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) saveQuickNote(c); }}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs gap-1 flex-1" disabled={!quickNoteText.trim() || quickNoteSaving} onClick={() => saveQuickNote(c)}>
                            {quickNoteSaving ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-3 h-3" />}
                            Guardar nota
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setQuickNoteCustomer(null); setQuickNoteText(""); }}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Inline merge form */}
                    {mergingCustomer?.name === c.name && mergingCustomer.id === (c.customerId ?? null) && (
                      <div className="mb-3 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 space-y-2">
                        <p className="text-xs font-medium text-orange-400">
                          Fusionar <strong>"{c.name}"</strong> en otro perfil
                        </p>
                        <p className="text-[10px] text-muted-foreground">Sólo se mueven filas enlazadas por ID. Las ventas sin ficha no se asignan por nombre.</p>
                        <div className="flex gap-2">
                          <Select
                            value={mergeTarget}
                            onValueChange={setMergeTarget}
                          >
                            <SelectTrigger className="bg-muted border-border text-xs h-8 flex-1">
                              <SelectValue placeholder="Elegí el perfil destino…" />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.filter(profile => profile.id !== mergingCustomer.id).map(profile => (
                                <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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

                    <Tabs value={customerDetailTab} onValueChange={setCustomerDetailTab} className="w-full">
                      <TabsList className="h-8 text-xs mb-3">
                        <TabsTrigger value="resumen" className="text-xs h-7 gap-1"><TrendingUp className="w-3 h-3" />Resumen</TabsTrigger>
                        <TabsTrigger value="compras" className="text-xs h-7 gap-1"><Package className="w-3 h-3" />Compras ({rowsOfCustomer(sales as any[], refDe(c)).length})</TabsTrigger>
                        <TabsTrigger value="deudas" className="text-xs h-7 gap-1"><CreditCard className="w-3 h-3" />Cuotas/Deudas</TabsTrigger>
                        <TabsTrigger value="presupuestos" className="text-xs h-7 gap-1"><FileText className="w-3 h-3" />Presupuestos</TabsTrigger>
                        <TabsTrigger value="contacto" className="text-xs h-7 gap-1"><MessageCircle className="w-3 h-3" />Contacto</TabsTrigger>
                      </TabsList>

                      {/* ── Tab: Resumen ── */}
                      <TabsContent value="resumen" className="space-y-3 mt-0">
                        {/* KPIs */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { l: "Total gastado", v: formatARS(c.totalSpent), icon: <TrendingUp className="w-3 h-3 text-primary" /> },
                            { l: "CLV proyectado", v: formatARS(c.clv), icon: <Star className="w-3 h-3 text-yellow-400" />, tooltip: "Valor de vida del cliente proyectado (ticket × frecuencia × retención estimada)" },
                            { l: "Ticket promedio", v: formatARS(c.avgTicket), icon: <ShoppingBag className="w-3 h-3 text-blue-400" /> },
                            { l: "Deuda pendiente", v: formatARS(c.pendingDebt), icon: <AlertCircle className={`w-3 h-3 ${c.pendingDebt > 0 ? "text-destructive" : "text-muted-foreground"}`} /> },
                          ].map(k => (
                            <div key={k.l} className="bg-muted/30 rounded-lg p-2.5 text-xs" title={(k as any).tooltip}>
                              <div className="flex items-center gap-1 text-muted-foreground mb-1">{k.icon}{k.l}</div>
                              <p className={`font-mono font-semibold text-sm ${k.l === "Deuda pendiente" && c.pendingDebt > 0 ? "text-destructive" : k.l === "CLV proyectado" ? "text-yellow-400" : ""}`}>{k.v}</p>
                            </div>
                          ))}
                        </div>

                        {/* Loyalty points badge */}
                        {loyaltyEnabled && (
                          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs ${
                            saldoDe(c) > 0
                              ? "bg-yellow-500/10 border border-yellow-500/20"
                              : "bg-muted/30 border border-border"
                          }`}>
                            <Gift className={`w-4 h-4 shrink-0 ${saldoDe(c) > 0 ? "text-yellow-400" : "text-muted-foreground"}`} />
                            <div className="flex-1">
                              <span className="text-muted-foreground">Puntos de fidelidad</span>
                              <span className={`ml-2 font-mono font-bold ${saldoDe(c) > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>
                                {saldoDe(c).toLocaleString("es-AR")} pts
                              </span>
                            </div>
                            {saldoDe(c) > 0 && (
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

                        {/* ── CLV / LTV Prediction ── */}
                        {c.purchaseCount >= 2 && (() => {
                          // Customer lifetime in days (from first to last purchase)
                          const firstMs = new Date(c.firstPurchase).getTime();
                          const lastMs  = new Date(c.lastPurchase).getTime();
                          const spanDays = Math.max(1, (lastMs - firstMs) / 86400000);
                          // Purchase frequency: purchases per day
                          const freqPerDay = c.purchaseCount / spanDays;
                          // Avg ticket
                          const avgTicket = c.avgTicket;
                          // Projected CLV for next 12 months
                          const clv12m = avgTicket * freqPerDay * 365;
                          // Monthly spend estimate
                          const monthly = avgTicket * freqPerDay * 30;
                          // Days until next expected purchase (based on frequency)
                          const daysBetween = freqPerDay > 0 ? Math.round(1 / freqPerDay) : null;
                          const nextPurchaseDays = daysBetween !== null
                            ? Math.max(0, daysBetween - c.daysSinceLastPurchase)
                            : null;
                          // Churn probability (simple heuristic)
                          const churnRisk = c.daysSinceLastPurchase > (daysBetween ?? 30) * 2
                            ? "Alto"
                            : c.daysSinceLastPurchase > (daysBetween ?? 30) * 1.5
                            ? "Medio"
                            : "Bajo";
                          const churnColor = churnRisk === "Alto"
                            ? "text-red-400 bg-red-500/10 border-red-500/20"
                            : churnRisk === "Medio"
                            ? "text-orange-400 bg-orange-500/10 border-orange-500/20"
                            : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";

                          return (
                            <div className="bg-gradient-to-br from-primary/5 to-purple-500/5 border border-primary/20 rounded-xl p-3 space-y-2">
                              <div className="flex items-center gap-2 mb-1">
                                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                                <span className="text-xs font-semibold uppercase tracking-wider text-primary/80">CLV — Valor vitalicio proyectado</span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div className="bg-background/40 rounded-lg p-2 text-center">
                                  <p className="text-[10px] text-muted-foreground mb-0.5">CLV 12 meses</p>
                                  <p className="text-sm font-mono font-bold text-primary">{formatARS(clv12m)}</p>
                                </div>
                                <div className="bg-background/40 rounded-lg p-2 text-center">
                                  <p className="text-[10px] text-muted-foreground mb-0.5">Gasto/mes est.</p>
                                  <p className="text-sm font-mono font-bold">{formatARS(monthly)}</p>
                                </div>
                                <div className="bg-background/40 rounded-lg p-2 text-center">
                                  <p className="text-[10px] text-muted-foreground mb-0.5">Prox. compra</p>
                                  <p className="text-sm font-mono font-bold">
                                    {nextPurchaseDays !== null
                                      ? nextPurchaseDays <= 0 ? "Hoy / Inminente" : `en ${nextPurchaseDays}d`
                                      : "—"}
                                  </p>
                                </div>
                                <div className="bg-background/40 rounded-lg p-2 text-center">
                                  <p className="text-[10px] text-muted-foreground mb-0.5">Riesgo churn</p>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${churnColor}`}>{churnRisk}</span>
                                </div>
                              </div>
                              <p className="text-[10px] text-muted-foreground leading-relaxed">
                                Basado en {c.purchaseCount} compras en {Math.round(spanDays)} días · frec. {Math.round(daysBetween ?? 0)}d entre compras
                              </p>
                            </div>
                          );
                        })()}
                      </TabsContent>

                      {/* ── Tab: Compras ── */}
                      <TabsContent value="compras" className="mt-0 space-y-3">
                        {(() => {
                          const prof = profileByName[c.name.toLowerCase()];
                          const prefs = prof?.scent_preferences || [];
                          if (prefs.length === 0) return null;
                          const recos = recommendForPreferences(prefs, recoProducts, perfumeDetailsById, { limit: 4 });
                          if (recos.length === 0) return null;
                          return (
                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-semibold text-primary flex items-center gap-1.5"><Star className="w-3.5 h-3.5" />Recomendados según sus gustos</p>
                                <button onClick={() => setRecoForCustomer(prof || null)} className="text-[10px] text-primary hover:underline">Ver todos</button>
                              </div>
                              <p className="text-[10px] text-muted-foreground mb-2">Le gustan: {prefs.map((p: string) => taxLabel(NOTAS_COMUNES, p)).join(", ")}</p>
                              <div className="grid grid-cols-2 gap-2">
                                {recos.map(({ product, score }) => (
                                  <div key={product.id} className="flex items-center gap-2 bg-card rounded-md p-1.5 border border-border/60">
                                    <div className="w-8 h-8 rounded bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center">
                                      {product.image_url ? <img src={product.image_url} alt="" className="w-full h-full object-cover" /> : <Package className="w-4 h-4 text-muted-foreground/40" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[11px] font-medium truncate">{product.name}</p>
                                      <p className="text-[9px] text-primary font-bold">{score}% match</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        <CustomerSalesTimeline
                          customerName={c.name}
                          customerRef={refDe(c)}
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
                            i => i.sale && belongsToCustomer(i.sale, refDe(c))
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
                                          className="text-[10px] px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors font-medium disabled:opacity-50"
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
                        {rowsOfCustomer(debts as any[], refDe(c)).filter((d: any) => d.status !== 'paid').length > 0 && (
                          <div>
                            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <AlertCircle className="w-3 h-3 text-destructive" />Deudas activas
                            </h3>
                            <div className="space-y-1.5">
                              {debts
                                .filter((d: any) => belongsToCustomer(d, refDe(c)) && d.status !== 'paid')
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

                      {/* ── Tab: Presupuestos ── */}
                      <TabsContent value="presupuestos" className="mt-0">
                        {activeOrg && (
                          <CustomerQuotesTab customer={refDe(c)} orgId={activeOrg.id} />
                        )}
                      </TabsContent>

                      {/* ── Tab: Contacto / CRM ── */}
                      <TabsContent value="contacto" className="mt-0 space-y-3">
                        {/* Contact info */}
                        {(c.company || c.email || c.phone || c.address || c.birthday) ? (
                          <div className="grid grid-cols-1 gap-2 text-xs">
                            {c.company && (
                              <div className="flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-lg p-2.5">
                                <Tag className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="text-amber-300 font-medium">{c.company}</span>
                              </div>
                            )}
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
                            customer={refDe(c)}
                          />
                        )}

                        {/* Follow-up Scheduler */}
                        <div className="border-t border-border/30 pt-3">
                          {!followUpOpen ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full h-8 text-xs gap-2 border-dashed border-primary/40 text-primary/70 hover:text-primary hover:border-primary"
                              onClick={() => {
                                const d = new Date();
                                d.setDate(d.getDate() + 3);
                                setFollowUpDate(d.toISOString().slice(0, 10));
                                setFollowUpOpen(true);
                              }}
                            >
                              <Bell className="w-3.5 h-3.5" />
                              Programar seguimiento
                            </Button>
                          ) : (
                            <div className="space-y-2 bg-primary/5 border border-primary/20 rounded-lg p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                                  <Bell className="w-3.5 h-3.5" />Programar seguimiento
                                </p>
                                <button className="text-muted-foreground hover:text-foreground" onClick={() => setFollowUpOpen(false)}>
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <Input
                                type="date"
                                value={followUpDate}
                                onChange={e => setFollowUpDate(e.target.value)}
                                className="h-7 text-xs"
                              />
                              <Input
                                value={followUpNote}
                                onChange={e => setFollowUpNote(e.target.value)}
                                placeholder="Motivo / recordatorio (opcional)"
                                className="h-7 text-xs"
                              />
                              <Button
                                size="sm"
                                className="w-full h-7 text-xs gradient-gold text-primary-foreground font-semibold"
                                onClick={() => scheduleFollowUp(c.name)}
                                disabled={followUpSaving || !followUpDate}
                              >
                                {followUpSaving ? "Guardando…" : "Confirmar seguimiento"}
                              </Button>
                            </div>
                          )}
                        </div>

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
                        i => i.sale && belongsToCustomer(i.sale, refDe(c))
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
                                      className="text-[10px] px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors font-medium disabled:opacity-50"
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
                      customerRef={refDe(c)}
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
                        customer={refDe(c)}
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
