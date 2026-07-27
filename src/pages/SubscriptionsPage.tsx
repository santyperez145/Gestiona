import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Search,
  RefreshCw,
  CreditCard,
  Users,
  DollarSign,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Edit,
  Trash2,
  Play,
  Pause,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  Eye,
  RotateCcw,
  Layers,
  Sparkles,
} from "lucide-react";
import { format, differenceInDays, isAfter, isBefore, addDays } from "date-fns";
import { es } from "date-fns/locale";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubscriptionPlan {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billing_interval: "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";
  trial_days: number;
  features: string[] | null;
  is_public: boolean;
  active: boolean;
  subscriber_count: number;
  created_at: string;
  updated_at: string;
}

interface Subscription {
  id: string;
  org_id: string;
  plan_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  status: "trial" | "active" | "past_due" | "cancelled" | "paused" | "expired";
  current_period_start: string;
  current_period_end: string;
  trial_end: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  payment_method: string | null;
  amount_override: number | null;
  discount_percent: number;
  notes: string | null;
  auto_renew: boolean;
  created_at: string;
  updated_at: string;
  // joined
  plan?: SubscriptionPlan;
}

interface SubscriptionInvoice {
  id: string;
  subscription_id: string;
  org_id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "void";
  period_start: string;
  period_end: string;
  due_date: string;
  paid_at: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INTERVAL_LABELS: Record<string, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  trial: { label: "Prueba", color: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: Clock },
  active: { label: "Activa", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle },
  past_due: { label: "Vencida", color: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertTriangle },
  cancelled: { label: "Cancelada", color: "bg-red-500/15 text-red-400 border-red-500/30", icon: XCircle },
  paused: { label: "Pausada", color: "bg-muted/40 text-muted-foreground border-border/40", icon: Pause },
  expired: { label: "Expirada", color: "bg-red-500/15 text-red-400 border-red-500/30", icon: XCircle },
};

const INVOICE_STATUS_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  pending: { label: "Pendiente", color: "bg-amber-500/15 text-amber-400" },
  paid: { label: "Pagada", color: "bg-emerald-500/15 text-emerald-400" },
  failed: { label: "Fallida", color: "bg-red-500/15 text-red-400" },
  void: { label: "Anulada", color: "bg-muted/40 text-muted-foreground" },
};

function fmtCurrency(amount: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Plan Form Dialog ─────────────────────────────────────────────────────────

interface PlanFormDialogProps {
  open: boolean;
  plan: SubscriptionPlan | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function PlanFormDialog({ open, plan, orgId, onClose, onSaved }: PlanFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("ARS");
  const [billingInterval, setBillingInterval] = useState<string>("monthly");
  const [trialDays, setTrialDays] = useState("0");
  const [featuresText, setFeaturesText] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (plan) {
      setName(plan.name);
      setDescription(plan.description ?? "");
      setPrice(String(plan.price));
      setCurrency(plan.currency);
      setBillingInterval(plan.billing_interval);
      setTrialDays(String(plan.trial_days));
      setFeaturesText((plan.features ?? []).join("\n"));
      setIsPublic(plan.is_public);
      setActive(plan.active);
    } else {
      setName(""); setDescription(""); setPrice("0"); setCurrency("ARS");
      setBillingInterval("monthly"); setTrialDays("0"); setFeaturesText(""); setIsPublic(false); setActive(true);
    }
  }, [plan, open]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("El nombre es requerido"); return; }
    setLoading(true);
    const features = featuresText.split("\n").map(l => l.trim()).filter(Boolean);
    const payload = {
      org_id: orgId,
      name: name.trim(),
      description: description.trim() || null,
      price: parseFloat(price) || 0,
      currency,
      billing_interval: billingInterval,
      trial_days: parseInt(trialDays) || 0,
      features: features.length ? features : null,
      is_public: isPublic,
      active,
    };
    const { error } = plan
      ? await supabase.from("subscription_plans").update(payload).eq("id", plan.id)
      : await supabase.from("subscription_plans").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error al guardar el plan"); return; }
    toast.success(plan ? "Plan actualizado" : "Plan creado");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? "Editar Plan" : "Nuevo Plan de Suscripción"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nombre del plan *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Plan Premium" />
            </div>
            <div className="col-span-2">
              <Label>Descripción</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Breve descripción del plan..." rows={2} />
            </div>
            <div>
              <Label>Precio</Label>
              <Input type="number" value={price} onChange={e => setPrice(e.target.value)} min="0" step="0.01" />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="BRL">BRL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Facturación</Label>
              <Select value={billingInterval} onValueChange={setBillingInterval}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(INTERVAL_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Días de prueba</Label>
              <Input type="number" value={trialDays} onChange={e => setTrialDays(e.target.value)} min="0" />
            </div>
            <div className="col-span-2">
              <Label>Beneficios incluidos (uno por línea)</Label>
              <Textarea value={featuresText} onChange={e => setFeaturesText(e.target.value)} placeholder={"Soporte 24/7\nReportes avanzados\nAPI acceso"} rows={4} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_public" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="rounded" />
              <Label htmlFor="is_public">Plan público (visible en catálogo)</Label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="active_plan" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
              <Label htmlFor="active_plan">Plan activo</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {plan ? "Guardar cambios" : "Crear plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Subscription Form Dialog ─────────────────────────────────────────────────

interface SubFormDialogProps {
  open: boolean;
  sub: Subscription | null;
  plans: SubscriptionPlan[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function SubFormDialog({ open, sub, plans, orgId, onClose, onSaved }: SubFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [planId, setPlanId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [status, setStatus] = useState<string>("trial");
  const [periodStart, setPeriodStart] = useState(format(new Date(), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [amountOverride, setAmountOverride] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [notes, setNotes] = useState("");
  const [autoRenew, setAutoRenew] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("");

  useEffect(() => {
    if (sub) {
      setPlanId(sub.plan_id);
      setCustomerName(sub.customer_name);
      setCustomerEmail(sub.customer_email ?? "");
      setStatus(sub.status);
      setPeriodStart(sub.current_period_start);
      setPeriodEnd(sub.current_period_end);
      setAmountOverride(sub.amount_override != null ? String(sub.amount_override) : "");
      setDiscountPercent(String(sub.discount_percent));
      setNotes(sub.notes ?? "");
      setAutoRenew(sub.auto_renew);
      setPaymentMethod(sub.payment_method ?? "");
    } else {
      const activePlans = plans.filter(p => p.active);
      setPlanId(activePlans[0]?.id ?? "");
      setCustomerName(""); setCustomerEmail(""); setStatus("trial");
      setPeriodStart(format(new Date(), "yyyy-MM-dd"));
      setPeriodEnd(format(addDays(new Date(), 30), "yyyy-MM-dd"));
      setAmountOverride(""); setDiscountPercent("0"); setNotes(""); setAutoRenew(true); setPaymentMethod("");
    }
  }, [sub, open, plans]);

  const handleSave = async () => {
    if (!planId) { toast.error("Seleccioná un plan"); return; }
    if (!customerName.trim()) { toast.error("El nombre del cliente es requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId,
      plan_id: planId,
      customer_name: customerName.trim(),
      customer_email: customerEmail.trim() || null,
      status,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      amount_override: amountOverride ? parseFloat(amountOverride) : null,
      discount_percent: parseFloat(discountPercent) || 0,
      notes: notes.trim() || null,
      auto_renew: autoRenew,
      payment_method: paymentMethod.trim() || null,
    };
    const { error } = sub
      ? await supabase.from("customer_subscriptions").update(payload).eq("id", sub.id)
      : await supabase.from("customer_subscriptions").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error al guardar la suscripción"); return; }
    toast.success(sub ? "Suscripción actualizada" : "Suscripción creada");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sub ? "Editar Suscripción" : "Nueva Suscripción"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Plan *</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar plan..." /></SelectTrigger>
                <SelectContent>
                  {plans.filter(p => p.active).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {fmtCurrency(p.price, p.currency)} / {INTERVAL_LABELS[p.billing_interval]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cliente *</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nombre del cliente" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="cliente@email.com" />
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Método de pago</Label>
              <Input value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} placeholder="Transferencia, MP, etc." />
            </div>
            <div>
              <Label>Inicio período</Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <Label>Fin período</Label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
            <div>
              <Label>Precio override</Label>
              <Input type="number" value={amountOverride} onChange={e => setAmountOverride(e.target.value)} placeholder="Vacío = usa precio del plan" min="0" />
            </div>
            <div>
              <Label>Descuento (%)</Label>
              <Input type="number" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} min="0" max="100" />
            </div>
            <div className="col-span-2">
              <Label>Notas</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="auto_renew" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} className="rounded" />
              <Label htmlFor="auto_renew">Renovación automática</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {sub ? "Guardar cambios" : "Crear suscripción"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoice Modal ────────────────────────────────────────────────────────────

interface InvoicesModalProps {
  open: boolean;
  sub: Subscription | null;
  onClose: () => void;
  onRefresh: () => void;
}

function InvoicesModal({ open, sub, onClose, onRefresh }: InvoicesModalProps) {
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !sub) return;
    setLoading(true);
    supabase
      .from("subscription_invoices")
      .select("*")
      .eq("subscription_id", sub.id)
      .order("created_at", { ascending: false })
      // status/currency son TEXT con CHECK en DB → llegan como string
      .then(({ data }) => { setInvoices((data ?? []) as SubscriptionInvoice[]); setLoading(false); });
  }, [open, sub]);

  const markPaid = async (inv: SubscriptionInvoice) => {
    const { error } = await supabase
      .from("subscription_invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (error) { toast.error("Error"); return; }
    toast.success("Factura marcada como pagada");
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: "paid", paid_at: new Date().toISOString() } : i));
    onRefresh();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Facturas — {sub?.customer_name}
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 space-y-2">
          {loading ? (
            <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Sin facturas aún</div>
          ) : invoices.map(inv => {
            const sc = INVOICE_STATUS_CONFIG[inv.status];
            const isOverdue = inv.status === "pending" && isBefore(new Date(inv.due_date), new Date());
            return (
              <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{inv.invoice_number}</span>
                    <Badge className={`text-xs border ${sc.color}`}>{sc.label}</Badge>
                    {isOverdue && <Badge className="text-xs bg-red-500/15 text-red-400 border-red-500/30">Vencida</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Período: {format(new Date(inv.period_start), "dd/MM/yy")} → {format(new Date(inv.period_end), "dd/MM/yy")}
                    {" · "}Vence: {format(new Date(inv.due_date), "dd/MM/yy")}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold">{fmtCurrency(inv.amount, inv.currency)}</span>
                  {inv.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => markPaid(inv)}>
                      <CheckCircle className="w-3.5 h-3.5 mr-1" /> Pagar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plan Card ────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: SubscriptionPlan;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onNewSub: () => void;
}

function PlanCard({ plan, onEdit, onToggle, onDelete, onNewSub }: PlanCardProps) {
  return (
    <div className={`rounded-xl border bg-card p-5 flex flex-col gap-3 transition-all ${!plan.active ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base">{plan.name}</h3>
            {plan.is_public && <Badge className="text-xs bg-blue-500/15 text-blue-400">Público</Badge>}
            {!plan.active && <Badge className="text-xs bg-muted/40 text-muted-foreground">Inactivo</Badge>}
          </div>
          {plan.description && <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold">{fmtCurrency(plan.price, plan.currency)}</p>
          <p className="text-xs text-muted-foreground">{INTERVAL_LABELS[plan.billing_interval]}</p>
        </div>
      </div>

      {plan.trial_days > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-blue-400">
          <Clock className="w-3.5 h-3.5" />
          {plan.trial_days} días de prueba gratis
        </div>
      )}

      {plan.features && plan.features.length > 0 && (
        <ul className="space-y-1 pb-12">
          {plan.features.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-border mt-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mr-auto">
          <Users className="w-3.5 h-3.5" />
          {plan.subscriber_count} suscriptor{plan.subscriber_count !== 1 ? "es" : ""}
        </div>
        <Button size="sm" variant="outline" onClick={onNewSub}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Suscribir
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Edit className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {plan.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Subscription Row ─────────────────────────────────────────────────────────

interface SubRowProps {
  sub: Subscription;
  onEdit: () => void;
  onRenew: () => void;
  onChangeStatus: (status: string) => void;
  onViewInvoices: () => void;
}

function SubRow({ sub, onEdit, onRenew, onChangeStatus, onViewInvoices }: SubRowProps) {
  const [expanded, setExpanded] = useState(false);
  const sc = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.expired;
  const StatusIcon = sc.icon;
  const planName = sub.plan?.name ?? "—";
  const amount = sub.amount_override != null
    ? sub.amount_override * (1 - sub.discount_percent / 100)
    : (sub.plan?.price ?? 0) * (1 - sub.discount_percent / 100);
  const currency = sub.plan?.currency ?? "ARS";
  const daysLeft = differenceInDays(new Date(sub.current_period_end), new Date());
  const isExpiringSoon = ["active", "trial"].includes(sub.status) && daysLeft >= 0 && daysLeft <= 7;

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{sub.customer_name}</span>
            <Badge className={`text-xs border shrink-0 ${sc.color}`}>
              <StatusIcon className="w-3 h-3 mr-1" />{sc.label}
            </Badge>
            {isExpiringSoon && (
              <Badge className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/30 shrink-0">
                <AlertTriangle className="w-3 h-3 mr-1" />Vence en {daysLeft}d
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {planName} · {format(new Date(sub.current_period_end), "dd/MM/yyyy")}
            {sub.customer_email && ` · ${sub.customer_email}`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-sm">{fmtCurrency(amount, currency)}</p>
          <p className="text-xs text-muted-foreground">{INTERVAL_LABELS[sub.plan?.billing_interval ?? "monthly"]}</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </div>

      {expanded && (
        <div className="border-t border-border p-3 bg-muted/20 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Período inicio</p>
              <p className="font-medium">{format(new Date(sub.current_period_start), "dd/MM/yyyy")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Período fin</p>
              <p className="font-medium">{format(new Date(sub.current_period_end), "dd/MM/yyyy")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Descuento</p>
              <p className="font-medium">{sub.discount_percent}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Renovación auto</p>
              <p className="font-medium">{sub.auto_renew ? "Sí" : "No"}</p>
            </div>
            {sub.payment_method && (
              <div>
                <p className="text-muted-foreground">Método de pago</p>
                <p className="font-medium">{sub.payment_method}</p>
              </div>
            )}
            {sub.cancel_reason && (
              <div className="col-span-2">
                <p className="text-muted-foreground">Razón cancelación</p>
                <p className="font-medium">{sub.cancel_reason}</p>
              </div>
            )}
            {sub.notes && (
              <div className="col-span-4">
                <p className="text-muted-foreground">Notas</p>
                <p className="font-medium">{sub.notes}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onViewInvoices}>
              <FileText className="w-3.5 h-3.5 mr-1" /> Facturas
            </Button>
            {["active", "trial", "past_due"].includes(sub.status) && (
              <Button size="sm" variant="outline" onClick={onRenew}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Renovar
              </Button>
            )}
            {sub.status !== "active" && sub.status !== "cancelled" && (
              <Button size="sm" variant="outline" onClick={() => onChangeStatus("active")}>
                <Play className="w-3.5 h-3.5 mr-1" /> Activar
              </Button>
            )}
            {sub.status === "active" && (
              <Button size="sm" variant="outline" onClick={() => onChangeStatus("paused")}>
                <Pause className="w-3.5 h-3.5 mr-1" /> Pausar
              </Button>
            )}
            {sub.status !== "cancelled" && (
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => onChangeStatus("cancelled")}>
                <XCircle className="w-3.5 h-3.5 mr-1" /> Cancelar
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Edit className="w-3.5 h-3.5 mr-1" /> Editar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  usePageTitle("Suscripciones");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingSubs, setLoadingSubs] = useState(true);

  // Dialogs
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [invoicesModalSub, setInvoicesModalSub] = useState<Subscription | null>(null);

  // Filters
  const [searchSubs, setSearchSubs] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlan, setFilterPlan] = useState("all");
  const [preselectedPlanId, setPreselectedPlanId] = useState<string | null>(null);

  // Load plans
  const loadPlans = async () => {
    if (!orgId) return;
    setLoadingPlans(true);
    const { data } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("org_id", orgId)
      .order("price");
    // billing_interval es TEXT con CHECK en DB → llega como string
    setPlans((data ?? []) as SubscriptionPlan[]);
    setLoadingPlans(false);
  };

  // Load subs with plan info
  const loadSubs = async () => {
    if (!orgId) return;
    setLoadingSubs(true);
    const { data } = await supabase
      .from("customer_subscriptions")
      .select("*, plan:subscription_plans(*)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    setSubs((data ?? []) as Subscription[]);
    setLoadingSubs(false);
  };

  useEffect(() => { loadPlans(); loadSubs(); }, [orgId]);

  // KPIs
  const kpis = useMemo(() => {
    const active = subs.filter(s => s.status === "active").length;
    const trial = subs.filter(s => s.status === "trial").length;
    const expiringSoon = subs.filter(s => {
      if (!["active", "trial"].includes(s.status)) return false;
      const d = differenceInDays(new Date(s.current_period_end), new Date());
      return d >= 0 && d <= 7;
    }).length;
    const mrr = subs
      .filter(s => ["active", "trial"].includes(s.status))
      .reduce((acc, s) => {
        const price = s.amount_override != null ? s.amount_override : (s.plan?.price ?? 0);
        const discounted = price * (1 - s.discount_percent / 100);
        const interval = s.plan?.billing_interval ?? "monthly";
        // normalize to monthly
        const factor: Record<string, number> = { weekly: 4.33, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12 };
        return acc + discounted * (factor[interval] ?? 1);
      }, 0);
    return { active, trial, expiringSoon, mrr };
  }, [subs]);

  // Filtered subs
  const filteredSubs = useMemo(() => {
    return subs.filter(s => {
      const matchSearch = !searchSubs || s.customer_name.toLowerCase().includes(searchSubs.toLowerCase()) || (s.customer_email ?? "").toLowerCase().includes(searchSubs.toLowerCase());
      const matchStatus = filterStatus === "all" || s.status === filterStatus;
      const matchPlan = filterPlan === "all" || s.plan_id === filterPlan;
      return matchSearch && matchStatus && matchPlan;
    });
  }, [subs, searchSubs, filterStatus, filterPlan]);

  const handleTogglePlan = async (plan: SubscriptionPlan) => {
    const { error } = await supabase
      .from("subscription_plans")
      .update({ active: !plan.active })
      .eq("id", plan.id);
    if (error) { toast.error("Error"); return; }
    toast.success(plan.active ? "Plan desactivado" : "Plan activado");
    loadPlans();
  };

  const handleDeletePlan = async (plan: SubscriptionPlan) => {
    if (!confirm(`¿Eliminar el plan "${plan.name}"? Si tiene suscripciones activas no se podrá eliminar.`)) return;
    const { error } = await supabase.from("subscription_plans").delete().eq("id", plan.id);
    if (error) { toast.error("No se pudo eliminar. Puede tener suscripciones activas."); return; }
    toast.success("Plan eliminado");
    loadPlans();
  };

  const handleChangeSubStatus = async (sub: Subscription, status: string) => {
    const update: Record<string, unknown> = { status };
    if (status === "cancelled") update.cancelled_at = new Date().toISOString();
    const { error } = await supabase.from("customer_subscriptions").update(update).eq("id", sub.id);
    if (error) { toast.error("Error al cambiar estado"); return; }
    toast.success(`Suscripción ${STATUS_CONFIG[status]?.label ?? status}`);
    loadSubs();
  };

  const handleRenew = async (sub: Subscription) => {
    const { error } = await supabase.rpc("renew_subscription", { p_subscription_id: sub.id });
    if (error) { toast.error("Error al renovar: " + error.message); return; }
    toast.success("Suscripción renovada y factura generada");
    loadSubs();
  };

  const openNewSubForPlan = (planId: string) => {
    setPreselectedPlanId(planId);
    setEditingSub(null);
    setSubDialogOpen(true);
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={CreditCard}
        title="Suscripciones & Recurrencia"
        description="Gestioná planes, suscriptores y facturación automática"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { loadPlans(); loadSubs(); }}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Actualizar
            </Button>
            <Button size="sm" onClick={() => { setEditingSub(null); setPreselectedPlanId(null); setSubDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Nueva suscripción
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard label="Activas" value={kpis.active} sub="suscripciones vigentes" icon={CheckCircle} color="success" />
        <KPICard label="En prueba" value={kpis.trial} sub="período trial" icon={Clock} color="blue" />
        <KPICard label="Vencen pronto" value={kpis.expiringSoon} sub="próximos 7 días" icon={AlertTriangle} color="warning" />
        <KPICard label="MRR estimado" value={fmtCurrency(kpis.mrr)} sub="ingresos mensuales" icon={TrendingUp} color="primary" />
      </div>

      <Tabs defaultValue="subscriptions">
        <TabsList>
          <TabsTrigger value="subscriptions" className="flex items-center gap-1.5">
            <Users className="w-4 h-4" /> Suscriptores
          </TabsTrigger>
          <TabsTrigger value="plans" className="flex items-center gap-1.5">
            <Layers className="w-4 h-4" /> Planes
          </TabsTrigger>
        </TabsList>

        {/* ── Subscriptions Tab ── */}
        <TabsContent value="subscriptions" className="space-y-4 mt-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={searchSubs}
                onChange={e => setSearchSubs(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPlan} onValueChange={setFilterPlan}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Plan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los planes</SelectItem>
                {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loadingSubs ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSubs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin suscripciones</p>
              <p className="text-sm mt-1">Creá un plan y comenzá a suscribir clientes</p>
            </div>
          ) : (
            <div className="space-y-2 pb-12">
              {filteredSubs.map(sub => (
                <SubRow
                  key={sub.id}
                  sub={sub}
                  onEdit={() => { setEditingSub(sub); setPreselectedPlanId(null); setSubDialogOpen(true); }}
                  onRenew={() => handleRenew(sub)}
                  onChangeStatus={status => handleChangeSubStatus(sub, status)}
                  onViewInvoices={() => setInvoicesModalSub(sub)}
                />
              ))}
              <p className="text-xs text-muted-foreground text-right pt-1">
                {filteredSubs.length} suscripción{filteredSubs.length !== 1 ? "es" : ""}
                {filteredSubs.length !== subs.length ? ` de ${subs.length}` : ""}
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Plans Tab ── */}
        <TabsContent value="plans" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {plans.filter(p => p.active).length} plan{plans.filter(p => p.active).length !== 1 ? "es" : ""} activo{plans.filter(p => p.active).length !== 1 ? "s" : ""}
            </p>
            <Button size="sm" onClick={() => { setEditingPlan(null); setPlanDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo plan
            </Button>
          </div>

          {loadingPlans ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin planes</p>
              <p className="text-sm mt-1">Creá tu primer plan de suscripción</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onEdit={() => { setEditingPlan(plan); setPlanDialogOpen(true); }}
                  onToggle={() => handleTogglePlan(plan)}
                  onDelete={() => handleDeletePlan(plan)}
                  onNewSub={() => openNewSubForPlan(plan.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <PlanFormDialog
        open={planDialogOpen}
        plan={editingPlan}
        orgId={orgId}
        onClose={() => { setPlanDialogOpen(false); setEditingPlan(null); }}
        onSaved={loadPlans}
      />

      <SubFormDialog
        open={subDialogOpen}
        sub={editingSub}
        plans={plans}
        orgId={orgId}
        onClose={() => { setSubDialogOpen(false); setEditingSub(null); setPreselectedPlanId(null); }}
        onSaved={loadSubs}
      />

      <InvoicesModal
        open={!!invoicesModalSub}
        sub={invoicesModalSub}
        onClose={() => setInvoicesModalSub(null)}
        onRefresh={loadSubs}
      />
    </div>
  );
}
