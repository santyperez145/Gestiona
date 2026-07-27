import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS, getSettingsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CreditCard, Plus, Copy, ExternalLink, Trash2, CheckCircle2,
  Clock, XCircle, Loader2, MessageCircle, RefreshCw,
  DollarSign, TrendingUp, AlertCircle, Banknote,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PaymentLink {
  id: string;
  org_id: string;
  quote_number: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  items: Array<{ description: string; qty: number; unitPrice: number; total: number }>;
  total_ars: number;
  mp_link: string | null;
  mp_preference_id: string | null;
  status: "pending" | "pending_confirmation" | "paid" | "cancelled" | "expired";
  paid_at: string | null;
  notes: string | null;
  expires_at: string | null;
  created_at: string;
  external_ref: string | null;
}

interface OrgSettings {
  mp_enabled: boolean;
  mp_access_token: string | null;
  whatsapp_number: string | null;
  business_name: string;
}

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  pending:              { label: "Pendiente",       icon: Clock,          className: "bg-amber-500/20 text-amber-400" },
  pending_confirmation: { label: "En revisión",     icon: RefreshCw,      className: "bg-blue-500/20 text-blue-400" },
  paid:                 { label: "Pagado",          icon: CheckCircle2,   className: "bg-emerald-500/20 text-emerald-400" },
  cancelled:            { label: "Cancelado",       icon: XCircle,        className: "bg-red-500/20 text-red-400" },
  expired:              { label: "Vencido",         icon: AlertCircle,    className: "bg-muted text-muted-foreground" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildPublicPaymentUrl(linkId: string): string {
  return `${window.location.origin}/pagar/${linkId}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PaymentLinksPage() {
  usePageTitle("Links de Pago");
  const { user, session } = useAuth();
  const { activeOrg } = useOrg();

  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings>({ mp_enabled: false, mp_access_token: null, whatsapp_number: null, business_name: "Mi Negocio" });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [generatingMP, setGeneratingMP] = useState<string | null>(null);

  // Form state
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresIn, setExpiresIn] = useState("72"); // hours
  const [items, setItems] = useState([{ description: "", qty: 1, unitPrice: 0 }]);
  const [saving, setSaving] = useState(false);

  // Filter
  const [filter, setFilter] = useState<"all" | "pending" | "paid" | "cancelled">("all");

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = async () => {
    if (!activeOrg || !user) return;
    setLoading(true);
    try {
      const [{ data: linksData }, { data: orgSettingsData }, userSettings] = await Promise.all([
        supabase.from("payment_links").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("settings").select("mp_enabled, mp_access_token, whatsapp_number, business_name").eq("org_id", activeOrg.id).maybeSingle(),
        getSettingsDB(user.id),
      ]);
      setLinks((linksData || []) as PaymentLink[]);
      setOrgSettings({
        mp_enabled: orgSettingsData?.mp_enabled ?? false,
        mp_access_token: orgSettingsData?.mp_access_token ?? null,
        whatsapp_number: orgSettingsData?.whatsapp_number ?? null,
        business_name: userSettings?.business_name || orgSettingsData?.business_name || "Mi Negocio",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  // ── Item helpers ──────────────────────────────────────────────────────────────
  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };
  const addItem = () => setItems(prev => [...prev, { description: "", qty: 1, unitPrice: 0 }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);

  // ── Create link ───────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!activeOrg || !user) return;
    if (!customerName.trim()) { toast.error("Ingresá el nombre del cliente"); return; }
    if (items.every(i => !i.description.trim())) { toast.error("Agregá al menos un ítem"); return; }
    if (total <= 0) { toast.error("El total debe ser mayor a 0"); return; }

    setSaving(true);
    try {
      const expiresAt = expiresIn
        ? new Date(Date.now() + Number(expiresIn) * 3_600_000).toISOString()
        : null;

      const computedItems = items
        .filter(i => i.description.trim())
        .map(i => ({
          description: i.description.trim(),
          qty: Number(i.qty) || 1,
          unitPrice: Number(i.unitPrice) || 0,
          total: (Number(i.qty) || 1) * (Number(i.unitPrice) || 0),
        }));

      const externalRef = `link-${Date.now()}`;

      const { data: newLink, error } = await supabase.from("payment_links").insert({
        org_id: activeOrg.id,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        customer_email: customerEmail.trim() || null,
        items: computedItems,
        total_ars: total,
        status: "pending",
        notes: notes.trim() || null,
        expires_at: expiresAt,
        external_ref: externalRef,
      }).select().single();

      if (error) throw error;

      // Generate Mercado Pago link if configured
      if (orgSettings.mp_enabled && orgSettings.mp_access_token && newLink) {
        try {
          const { data: mpData } = await supabase.functions.invoke("mercadopago-link", {
            body: {
              orgId: activeOrg.id,
              title: `Pago ${orgSettings.business_name} — ${customerName.trim()}`,
              total,
              externalRef: `sale:${newLink.id}`,
            },
            headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
          });
          if (mpData?.url) {
            await supabase.from("payment_links").update({
              mp_link: mpData.url,
              mp_preference_id: mpData.preferenceId || null,
            }).eq("id", newLink.id);
          }
        } catch {
          // MP link is optional — don't fail the whole creation
        }
      }

      toast.success("Link de pago creado");
      setOpen(false);
      setCustomerName(""); setCustomerPhone(""); setCustomerEmail(""); setNotes("");
      setItems([{ description: "", qty: 1, unitPrice: 0 }]);
      load();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Generate / refresh MP link ────────────────────────────────────────────────
  const generateMPLink = async (link: PaymentLink) => {
    if (!orgSettings.mp_enabled) {
      toast.error("Mercado Pago no configurado. Activalo en Integraciones.");
      return;
    }
    setGeneratingMP(link.id);
    try {
      const { data: mpData, error } = await supabase.functions.invoke("mercadopago-link", {
        body: {
          orgId: activeOrg!.id,
          title: `Pago — ${link.customer_name}`,
          total: link.total_ars,
          externalRef: `sale:${link.id}`,
        },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (error || !mpData?.url) throw new Error(error?.message || "Sin respuesta de MP");
      await supabase.from("payment_links").update({
        mp_link: mpData.url,
        mp_preference_id: mpData.preferenceId || null,
      }).eq("id", link.id);
      toast.success("Link de Mercado Pago generado");
      load();
    } catch (err: any) {
      toast.error("Error MP: " + (err.message || String(err)));
    } finally {
      setGeneratingMP(null);
    }
  };

  // ── Mark as paid ──────────────────────────────────────────────────────────────
  const markAsPaid = async (link: PaymentLink) => {
    await supabase.from("payment_links").update({
      status: "paid",
      paid_at: new Date().toISOString(),
    }).eq("id", link.id);
    toast.success("Marcado como pagado");
    load();
  };

  // ── Cancel ────────────────────────────────────────────────────────────────────
  const cancelLink = async (link: PaymentLink) => {
    if (!confirm("¿Cancelar este link de pago?")) return;
    await supabase.from("payment_links").update({ status: "cancelled" }).eq("id", link.id);
    toast.success("Link cancelado");
    load();
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este link?")) return;
    setDeleting(id);
    await supabase.from("payment_links").delete().eq("id", id);
    setLinks(prev => prev.filter(l => l.id !== id));
    setDeleting(null);
  };

  // ── Send via WhatsApp ─────────────────────────────────────────────────────────
  const sendViaWhatsApp = (link: PaymentLink) => {
    const phone = link.customer_phone?.replace(/\D/g, "");
    if (!phone) { toast.error("El cliente no tiene teléfono registrado"); return; }
    const publicUrl = buildPublicPaymentUrl(link.id);
    const msg = encodeURIComponent(
      `¡Hola ${link.customer_name.split(" ")[0]}! 👋 Te comparto el link para abonar tu pedido de ${formatARS(link.total_ars)}:\n${publicUrl}\n\n¡Gracias! 🙌`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
  };

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const totalPaid    = links.filter(l => l.status === "paid").reduce((s, l) => s + l.total_ars, 0);
  const pendingCount = links.filter(l => l.status === "pending" || l.status === "pending_confirmation").length;
  const paidCount    = links.filter(l => l.status === "paid").length;
  const convRate     = links.length ? Math.round((paidCount / links.length) * 100) : 0;

  const filtered = filter === "all" ? links : links.filter(l =>
    filter === "pending" ? (l.status === "pending" || l.status === "pending_confirmation")
    : l.status === filter
  );

  if (loading) return (
    <div className="space-y-4 pb-12">
      <div className="h-8 bg-muted/40 rounded animate-pulse w-48" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted/40 rounded-[10px] animate-pulse" />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Links de Pago"
        description="Generá links de cobro con Mercado Pago y transferencia"
        icon={CreditCard}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />Actualizar
            </Button>
            <Button onClick={() => setOpen(true)} className="gradient-gold text-primary-foreground font-semibold shadow-gold gap-1.5">
              <Plus className="w-4 h-4" />Nuevo link
            </Button>
          </div>
        }
      />

      {!orgSettings.mp_enabled && (
        <div className="mb-5 flex items-start gap-3 bg-blue-500/10 border border-blue-500/30 rounded-[10px] p-4">
          <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-300">
            Mercado Pago no activado. Los links se crean sin checkout MP.{" "}
            <a href="/integraciones" className="underline text-blue-400">Configurar en Integraciones →</a>
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Cobrado" value={formatARS(totalPaid)} icon={DollarSign} color="success" />
        <KPICard label="Pendientes" value={pendingCount} icon={Clock} color="warning" />
        <KPICard label="Pagados" value={paidCount} icon={CheckCircle2} color="success" />
        <KPICard label="Conversión" value={`${convRate}%`} icon={TrendingUp} color="blue" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(["all", "pending", "paid", "cancelled"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-[6px] font-medium transition-all border ${
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted border-border text-muted-foreground hover:border-border/80"
            }`}
          >
            {{ all: "Todos", pending: "Pendientes", paid: "Pagados", cancelled: "Cancelados" }[f]}
            <span className="ml-1.5 text-[10px] opacity-70">
              {f === "all" ? links.length
               : f === "pending" ? links.filter(l => l.status === "pending" || l.status === "pending_confirmation").length
               : links.filter(l => l.status === f).length}
            </span>
          </button>
        ))}
      </div>

      {/* Links list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p>No hay links en este estado</p>
        </div>
      ) : (
        <div className="space-y-3 pb-12">
          {filtered.map(link => {
            const cfg = STATUS_CONFIG[link.status] || STATUS_CONFIG.pending;
            const StatusIcon = cfg.icon;
            const publicUrl = buildPublicPaymentUrl(link.id);
            const isExpired = link.expires_at && new Date(link.expires_at) < new Date() && link.status === "pending";
            return (
              <div key={link.id} className="bg-card border border-border/60 rounded-[10px] p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.className}`}>
                        <StatusIcon className="w-2.5 h-2.5" />{cfg.label}
                      </span>
                      {isExpired && (
                        <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">Vencido</span>
                      )}
                      {link.quote_number && (
                        <span className="text-[10px] text-muted-foreground">#{link.quote_number}</span>
                      )}
                    </div>

                    {/* Customer + amount */}
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{link.customer_name}</p>
                      <span className="text-primary font-bold">{formatARS(link.total_ars)}</span>
                    </div>

                    {/* Items */}
                    {Array.isArray(link.items) && link.items.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {link.items.map(i => `${i.qty}× ${i.description}`).join(" · ")}
                      </p>
                    )}

                    {/* Notes + dates */}
                    {link.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{link.notes}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      <span>Creado {fmtDate(link.created_at)}</span>
                      {link.expires_at && <span>Vence {fmtDate(link.expires_at)}</span>}
                      {link.paid_at && <span className="text-emerald-400">Pagado {fmtDate(link.paid_at)}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {/* Copy public link */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-xs text-muted-foreground"
                      onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Link copiado"); }}
                    >
                      <Copy className="w-3.5 h-3.5" />Copiar
                    </Button>

                    {/* Open public page */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-xs text-muted-foreground"
                      onClick={() => window.open(publicUrl, "_blank")}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />Ver
                    </Button>

                    {/* Send via WhatsApp */}
                    {link.customer_phone && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-xs text-green-500"
                        onClick={() => sendViaWhatsApp(link)}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />WA
                      </Button>
                    )}

                    {/* MP link */}
                    {link.mp_link ? (
                      <Button
                        size="sm"
                        className="gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => window.open(link.mp_link!, "_blank")}
                      >
                        <CreditCard className="w-3.5 h-3.5" />MP
                      </Button>
                    ) : link.status === "pending" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={() => generateMPLink(link)}
                        disabled={generatingMP === link.id}
                      >
                        {generatingMP === link.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <CreditCard className="w-3.5 h-3.5" />}
                        Generar MP
                      </Button>
                    ) : null}

                    {/* Mark paid */}
                    {(link.status === "pending" || link.status === "pending_confirmation") && (
                      <Button
                        size="sm"
                        className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => markAsPaid(link)}
                      >
                        <Banknote className="w-3.5 h-3.5" />Pagado
                      </Button>
                    )}

                    {/* Cancel */}
                    {link.status === "pending" && (
                      <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => cancelLink(link)}>
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    )}

                    {/* Delete */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive p-1.5"
                      onClick={() => handleDelete(link.id)}
                      disabled={deleting === link.id}
                    >
                      {deleting === link.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-400" />Nuevo link de pago
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Customer info */}
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nombre del cliente *</label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Juan García" className="bg-muted border-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Teléfono</label>
                  <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+54911..." className="bg-muted border-border" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Email</label>
                  <Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="email@ejemplo.com" className="bg-muted border-border" />
                </div>
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">Ítems *</label>
                <Button size="sm" variant="ghost" onClick={addItem} className="gap-1 text-xs h-6">
                  <Plus className="w-3 h-3" />Ítem
                </Button>
              </div>
              <div className="space-y-2 pb-12">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5 items-center">
                    <Input
                      value={item.description}
                      onChange={e => updateItem(idx, "description", e.target.value)}
                      placeholder="Descripción"
                      className="bg-muted border-border text-sm"
                    />
                    <Input
                      type="number"
                      value={item.qty}
                      onChange={e => updateItem(idx, "qty", e.target.value)}
                      min="1"
                      className="bg-muted border-border text-sm w-16 text-center"
                    />
                    <Input
                      type="number"
                      value={item.unitPrice}
                      onChange={e => updateItem(idx, "unitPrice", e.target.value)}
                      placeholder="Precio"
                      min="0"
                      className="bg-muted border-border text-sm w-28"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-right">
                <span className="text-lg font-bold text-primary">{formatARS(total)}</span>
              </div>
            </div>

            {/* Expiry */}
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Vence en</label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 horas</SelectItem>
                  <SelectItem value="48">48 horas</SelectItem>
                  <SelectItem value="72">72 horas (recomendado)</SelectItem>
                  <SelectItem value="168">7 días</SelectItem>
                  <SelectItem value="">Sin vencimiento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Notas internas</label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notas opcionales..."
                rows={2}
                className="bg-muted border-border text-sm resize-none"
              />
            </div>

            {orgSettings.mp_enabled && (
              <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-[8px] px-3 py-2">
                <CreditCard className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <p className="text-xs text-blue-300">Se generará automáticamente un link de Mercado Pago al crear.</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button onClick={handleCreate} disabled={saving || total <= 0 || !customerName.trim()} className="gradient-gold text-primary-foreground font-semibold flex-1">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
                Crear link
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
