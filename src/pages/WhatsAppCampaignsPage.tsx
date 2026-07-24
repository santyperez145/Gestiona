import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { getSettingsDB, formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  MessageCircle, Send, Users, CheckCircle2, XCircle, Clock,
  Loader2, Plus, Trash2, Phone, RotateCcw, AlertCircle,
  Eye, Variable,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ─── Template library ─────────────────────────────────────────────────────────
const WA_TEMPLATES = [
  {
    id: "oferta",
    label: "🔥 Oferta especial",
    message: "¡Hola {{nombre}}! 🔥 Tenemos una oferta exclusiva para vos por tiempo limitado. ¿Querés que te cuente los detalles? ¡No te la perdás!",
  },
  {
    id: "reactivacion",
    label: "😊 Reactivación",
    message: "¡Hola {{nombre}}! 😊 Hace un tiempo que no sabemos de vos y quisimos saludarte. Tenemos novedades que te van a encantar. ¿Charlamos?",
  },
  {
    id: "recordatorio",
    label: "💳 Recordatorio deuda",
    message: "¡Hola {{nombre}}! 👋 Te recordamos que tenés un saldo pendiente. Cuando puedas coordinamos el pago. ¡Gracias por tu confianza!",
  },
  {
    id: "cumple",
    label: "🎂 Cumpleaños",
    message: "¡Feliz cumpleaños {{nombre}}! 🎂🎉 En tu día especial tenemos un regalo para vos. Escribinos o visitanos para reclamarlo. ¡Que la pases genial!",
  },
  {
    id: "novedad",
    label: "📦 Novedad",
    message: "¡Hola {{nombre}}! 📦 ¡Llegó algo nuevo que sabemos que te va a interesar! Escribinos para ver los detalles antes que se agote. 🙌",
  },
  {
    id: "mayorista",
    label: "🏪 Precio mayorista",
    message: "¡Hola {{nombre}}! 🏪 Tenemos precios especiales mayoristas disponibles. Si comprás en cantidad, te damos condiciones increíbles. ¿Hablamos?",
  },
  {
    id: "encuesta",
    label: "⭐ Pedido de reseña",
    message: "¡Hola {{nombre}}! ⭐ Nos importa mucho tu opinión. ¿Cómo fue tu experiencia con nosotros? Tu feedback nos ayuda a mejorar. ¡Gracias!",
  },
] as const;

// ─── Segment definitions ──────────────────────────────────────────────────────
const SEGMENTS = [
  { value: "all",          label: "Todos los clientes con teléfono" },
  { value: "vip",          label: "VIP — compraron en los últimos 30 días" },
  { value: "at_risk",      label: "En riesgo — sin comprar 30–60 días" },
  { value: "dormant",      label: "Dormidos — sin comprar 60–90 días" },
  { value: "lost",         label: "Perdidos — sin comprar más de 90 días" },
  { value: "birthday",     label: "Cumpleaños este mes" },
  { value: "with_debt",    label: "Con deuda pendiente" },
  { value: "never_bought", label: "Nunca compraron (solo en CRM)" },
];

// ─── Status display ───────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft:   { label: "Borrador",  className: "bg-muted text-muted-foreground" },
  sending: { label: "Enviando…", className: "bg-blue-500/20 text-blue-400" },
  sent:    { label: "Enviado",   className: "bg-emerald-500/20 text-emerald-400" },
  failed:  { label: "Fallido",   className: "bg-red-500/20 text-red-400" },
};

interface Campaign {
  id: string;
  org_id: string;
  message: string;
  segment: string;
  status: "draft" | "sending" | "sent" | "failed";
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
  coupon_code: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  birthday?: string | null;
}

export default function WhatsAppCampaignsPage() {
  usePageTitle("WhatsApp Masivo");
  const { user, session } = useAuth();
  const { activeOrg } = useOrg();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [debtsData, setDebtsData] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<{ id: string; code: string }[]>([]);
  // coupon_code (uppercased) -> { count, revenue } of attributed sales
  const [attributionByCode, setAttributionByCode] = useState<Record<string, { count: number; revenue: number }>>({});
  const [loading, setLoading] = useState(true);
  const [evolutionConfigured, setEvolutionConfigured] = useState<boolean | null>(null);

  // Form
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [segment, setSegment] = useState("all");
  const [couponCode, setCouponCode] = useState<string>("");  // "" = sin cupón
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = async () => {
    if (!activeOrg || !user) return;
    setLoading(true);
    try {
      const [{ data: camps }, { data: custs }, { data: sales }, { data: debts }, { data: coups }, { data: couponSales }, sett] = await Promise.all([
        supabase.from("whatsapp_campaigns").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("customers").select("id,name,phone,birthday").eq("org_id", activeOrg.id),
        supabase.from("sales").select("customer_name,date").eq("org_id", activeOrg.id).order("date", { ascending: false }),
        supabase.from("debts").select("customer_name,amount,paid").eq("org_id", activeOrg.id).eq("paid", false),
        supabase.from("coupons").select("id, code").eq("user_id", user.id),
        // One aggregate query for attribution: all sales made with any coupon
        supabase.from("sales").select("coupon_code, total_ars").eq("org_id", activeOrg.id).not("coupon_code", "is", null),
        getSettingsDB(user.id),
      ]);

      setCampaigns((camps || []) as Campaign[]);
      setCustomers((custs || []) as Customer[]);
      setSalesData(sales || []);
      setDebtsData(debts || []);
      setCoupons((coups || []) as { id: string; code: string }[]);

      // Aggregate attributed sales by coupon_code (uppercased), mirroring CouponsPage
      const attrMap: Record<string, { count: number; revenue: number }> = {};
      (couponSales || []).forEach((s: any) => {
        if (!s.coupon_code) return;
        const k = s.coupon_code.toUpperCase();
        if (!attrMap[k]) attrMap[k] = { count: 0, revenue: 0 };
        attrMap[k].count++;
        attrMap[k].revenue += s.total_ars || 0;
      });
      setAttributionByCode(attrMap);

      // Check Evolution API config from settings DB
      const { data: evoCfg } = await supabase
        .from("settings")
        .select("evolution_api_url, evolution_api_key")
        .eq("org_id", activeOrg.id)
        .maybeSingle();
      setEvolutionConfigured(!!(evoCfg?.evolution_api_url && evoCfg?.evolution_api_key));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  // ── Audience segmentation ────────────────────────────────────────────────────
  const audienceFor = useMemo(() => {
    const today = new Date();
    const lastPurchase: Record<string, number> = {};
    salesData.forEach(s => {
      if (!s.customer_name) return;
      const d = new Date(s.date).getTime();
      if (!lastPurchase[s.customer_name] || d > lastPurchase[s.customer_name]) {
        lastPurchase[s.customer_name] = d;
      }
    });
    const debtSet = new Set((debtsData || []).map((d: any) => d.customer_name?.toLowerCase()));

    const withPhone = customers.filter(c => c.phone && c.phone.trim().length >= 8);

    return (seg: string): Customer[] => {
      if (seg === "all") return withPhone;
      return withPhone.filter(c => {
        const lastMs = lastPurchase[c.name];
        const daysSince = lastMs ? (today.getTime() - lastMs) / 86_400_000 : 999;
        if (seg === "vip")          return daysSince <= 30;
        if (seg === "at_risk")      return daysSince > 30 && daysSince <= 60;
        if (seg === "dormant")      return daysSince > 60 && daysSince <= 90;
        if (seg === "lost")         return daysSince > 90;
        if (seg === "never_bought") return !lastMs;
        if (seg === "with_debt")    return debtSet.has(c.name?.toLowerCase());
        if (seg === "birthday") {
          const m = today.getMonth() + 1;
          if (!c.birthday) return false;
          const bm = parseInt(c.birthday.split("-")[1] || "0");
          return bm === m;
        }
        return true;
      });
    };
  }, [customers, salesData, debtsData]);

  const currentAudience = useMemo(() => audienceFor(segment), [audienceFor, segment]);

  // ── Create campaign ───────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!activeOrg || !user) return;
    if (!message.trim()) { toast.error("Escribí el mensaje"); return; }
    setSaving(true);
    try {
      const { error } = await (supabase.from("whatsapp_campaigns") as any).insert({
        org_id: activeOrg.id,
        message: message.trim(),
        segment,
        status: "draft",
        sent_count: 0,
        failed_count: 0,
        coupon_code: couponCode || null,
      });
      if (error) throw error;
      toast.success("Campaña creada como borrador");
      setOpen(false); setMessage(""); setSegment("all"); setCouponCode("");
      load();
    } catch {
      toast.error("Error al guardar campaña");
    } finally {
      setSaving(false);
    }
  };

  // ── Send campaign ─────────────────────────────────────────────────────────────
  const handleSend = async (camp: Campaign) => {
    const audience = audienceFor(camp.segment);
    if (!audience.length) { toast.error("No hay destinatarios con teléfono en este segmento"); return; }
    if (!confirm(`¿Enviar WhatsApp a ${audience.length} contacto(s)?`)) return;

    setSending(camp.id);
    try {
      await supabase.from("whatsapp_campaigns").update({ status: "sending" }).eq("id", camp.id);
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status: "sending" } : c));

      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: {
          orgId: activeOrg!.id,
          recipients: audience.map(c => ({ phone: c.phone!, name: c.name })),
          message: camp.message,
          campaignId: camp.id,
        },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });

      if (error) throw error;
      toast.success(`WhatsApp enviado: ${data?.sent ?? 0} enviados, ${data?.failed ?? 0} fallidos`);
      load();
    } catch (err: any) {
      toast.error("Error al enviar: " + (err?.message || String(err)));
      await supabase.from("whatsapp_campaigns").update({ status: "failed" }).eq("id", camp.id);
      load();
    } finally {
      setSending(null);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta campaña?")) return;
    setDeleting(id);
    await supabase.from("whatsapp_campaigns").delete().eq("id", id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
    setDeleting(null);
  };

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const totalSent  = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const totalFail  = campaigns.reduce((s, c) => s + (c.failed_count || 0), 0);
  const sentCamps  = campaigns.filter(c => c.status === "sent").length;
  const totalPhone = customers.filter(c => c.phone && c.phone.trim().length >= 8).length;

  const insertVariable = (v: string) => {
    setMessage(prev => prev + v);
  };

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
        title="WhatsApp Masivo"
        description={`Enviá campañas a tus clientes · ${totalPhone} contactos con teléfono`}
        icon={MessageCircle}
        actions={
          <Button onClick={() => setOpen(true)} className="gradient-gold text-primary-foreground font-semibold shadow-gold gap-1.5">
            <Plus className="w-4 h-4" />Nueva campaña
          </Button>
        }
      />

      {/* Evolution API warning */}
      {evolutionConfigured === false && (
        <div className="mb-5 flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-[10px] p-4">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-300">Evolution API no configurada</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Podés crear campañas en borrador ahora, pero para enviarlas necesitás configurar Evolution API y conectar tu WhatsApp en{" "}
              <a href="/integraciones" className="underline text-amber-400">Integraciones</a>.
            </p>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Contactos" value={totalPhone} icon={Users} />
        <KPICard label="Campañas enviadas" value={sentCamps} icon={CheckCircle2} color="success" />
        <KPICard label="Mensajes enviados" value={totalSent} icon={MessageCircle} color="blue" />
        <KPICard label="Fallidos" value={totalFail} icon={XCircle} color="destructive" />
      </div>

      {/* Campaign list */}
      {campaigns.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No hay campañas todavía</p>
          <p className="text-sm mt-1">Creá tu primera campaña de WhatsApp masivo</p>
        </div>
      ) : (
        <div className="space-y-3 pb-12">
          {campaigns.map(camp => {
            const audience = audienceFor(camp.segment);
            const segLabel = SEGMENTS.find(s => s.value === camp.segment)?.label || camp.segment;
            const badge = STATUS_BADGE[camp.status] || STATUS_BADGE.draft;
            const isSending = sending === camp.id;
            return (
              <div
                key={camp.id}
                className="bg-card border border-border/60 rounded-[10px] p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {segLabel}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      <Phone className="w-2.5 h-2.5 inline mr-0.5" />{audience.length} contactos
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90 line-clamp-2">{camp.message}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                    <span>{new Date(camp.created_at).toLocaleDateString("es-AR")}</span>
                    {camp.sent_at && <span>Enviado {new Date(camp.sent_at).toLocaleDateString("es-AR")}</span>}
                    {camp.sent_count > 0 && <span className="text-emerald-400">{camp.sent_count} ✓</span>}
                    {camp.failed_count > 0 && <span className="text-red-400">{camp.failed_count} ✗</span>}
                  </div>
                  {/* Coupon attribution line */}
                  {camp.coupon_code && (() => {
                    const attr = attributionByCode[camp.coupon_code.toUpperCase()] || { count: 0, revenue: 0 };
                    return (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 border-primary/30 text-primary">
                          {camp.coupon_code}
                        </Badge>
                        <span className="text-muted-foreground">
                          Ventas atribuidas: <span className="font-semibold text-foreground">{attr.count}</span>
                          {" · "}Ingresos: <span className="font-semibold text-emerald-400">{formatARS(attr.revenue)}</span>
                        </span>
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {camp.status === "draft" && (
                    <Button
                      size="sm"
                      onClick={() => handleSend(camp)}
                      disabled={isSending}
                      className="gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs"
                    >
                      {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Enviar
                    </Button>
                  )}
                  {camp.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSend(camp)}
                      disabled={isSending}
                      className="gap-1.5 text-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />Reintentar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(camp.id)}
                    disabled={deleting === camp.id || isSending}
                    className="text-muted-foreground hover:text-destructive p-2"
                  >
                    {deleting === camp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-green-400" />
              Nueva campaña WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Segment */}
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Segmento</label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEGMENTS.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                      <span className="ml-2 text-muted-foreground text-xs">
                        ({audienceFor(s.value).length})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {currentAudience.length} contacto(s) recibirán este mensaje
              </p>
            </div>

            {/* Coupon attribution */}
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">
                Cupón asociado <span className="text-xs">(opcional)</span>
              </label>
              <Select value={couponCode || "__none__"} onValueChange={v => setCouponCode(v === "__none__" ? "" : v)}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin cupón</SelectItem>
                  {coupons.map(c => (
                    <SelectItem key={c.id} value={c.code}>{c.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Las ventas hechas con este cupón se atribuirán a la campaña.
              </p>
            </div>

            {/* Template picker */}
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Plantillas rápidas</label>
              <div className="flex flex-wrap gap-1.5">
                {WA_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setMessage(t.message)}
                    className="text-xs px-2.5 py-1 rounded-[6px] bg-muted border border-border/60 hover:border-primary/40 hover:text-primary transition-all"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm text-muted-foreground">Mensaje</label>
                <div className="flex gap-1">
                  <button
                    onClick={() => insertVariable("{{nombre}}")}
                    className="text-[10px] bg-muted border border-border/60 px-2 py-0.5 rounded hover:border-primary/40 hover:text-primary transition-all flex items-center gap-1"
                  >
                    <Variable className="w-2.5 h-2.5" />{"{{nombre}}"}
                  </button>
                </div>
              </div>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Hola {{nombre}}! 👋 ..."
                rows={5}
                className="bg-muted border-border text-sm resize-none"
              />
              <div className="flex justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">
                  Usá {"{{nombre}}"} para personalizar el nombre
                </p>
                <p className="text-[10px] text-muted-foreground">{message.length} chars</p>
              </div>
            </div>

            {/* Preview */}
            {message && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  <Eye className="w-3 h-3 inline mr-1" />Vista previa
                </label>
                <div className="bg-[#075E54] rounded-[12px] rounded-tl-[0] p-3 max-w-[280px] text-white text-sm leading-relaxed">
                  {message.replace(/\{\{nombre\}\}/g, currentAudience[0]?.name?.split(" ")[0] || "Juan")}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleCreate}
                disabled={saving || !message.trim()}
                className="gradient-gold text-primary-foreground font-semibold flex-1"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
                Guardar borrador
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
