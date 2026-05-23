import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { getSettingsDB } from "@/lib/supabaseStore";
import { safeChannel } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Mail, Plus, Send, Users, CheckCircle2, XCircle,
  Clock, Loader2, Eye, Trash2, AlertCircle, MousePointerClick, MailOpen,
  Copy, FlaskConical, Trophy,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─── Email Templates ──────────────────────────────────────────────────────────

const EMAIL_TEMPLATES = [
  {
    id: "oferta",
    label: "🔥 Oferta especial",
    subject: "🔥 Oferta exclusiva solo para vos",
    body: `<p>¡Hola {{nombre}}!</p>
<p>Tenemos una oferta especial que no podés perderte. Por tiempo limitado, disfrutá de descuentos exclusivos en nuestros mejores productos.</p>
<p>Visitanos o escribinos para aprovechar esta promoción antes de que termine.</p>
<p>¡Hasta pronto! 👋</p>`,
  },
  {
    id: "cumple",
    label: "🎂 Cumpleaños",
    subject: "🎂 ¡Feliz cumpleaños, {{nombre}}!",
    body: `<p>¡Hola {{nombre}}!</p>
<p>En tu día especial queremos saludarte y agradecerte por ser parte de nuestra comunidad.</p>
<p>Como regalo de cumpleaños, tenemos una sorpresa esperándote. ¡Vení a visitarnos o escribinos!</p>
<p>¡Que tengas un día increíble! 🎉</p>`,
  },
  {
    id: "reactivacion",
    label: "😴 Reactivación",
    subject: "Te extrañamos, {{nombre}} 💙",
    body: `<p>¡Hola {{nombre}}!</p>
<p>Hace un tiempo que no te vemos por acá y quisimos saber cómo estás.</p>
<p>Tenemos novedades y productos nuevos que seguramente te van a interesar. ¿Qué te parece si nos ponemos al día?</p>
<p>¡Esperamos verte pronto! 🙌</p>`,
  },
  {
    id: "novedad",
    label: "📦 Novedad de producto",
    subject: "📦 Novedad: ¡Llegó algo nuevo!",
    body: `<p>¡Hola {{nombre}}!</p>
<p>Tenemos excelentes noticias: acaba de llegar un nuevo producto que pensamos que te va a encantar.</p>
<p>Si querés conocerlo antes que todos, contactanos para más información.</p>
<p>¡Gracias por tu preferencia! ⭐</p>`,
  },
  {
    id: "boletin",
    label: "📰 Boletín mensual",
    subject: "📰 Novedades de {{nombre}} — este mes",
    body: `<p>¡Hola {{nombre}}!</p>
<p>Te compartimos las novedades de este mes:</p>
<ul>
  <li>✅ Nuevos productos disponibles</li>
  <li>✅ Ofertas especiales</li>
  <li>✅ Cambios en horarios o servicios</li>
</ul>
<p>¡Gracias por elegirnos siempre! 🙏</p>`,
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  org_id: string;
  subject: string;
  body_html: string;
  segment: string;
  status: "draft" | "sending" | "sent" | "failed";
  sent_count: number;
  failed_count: number;
  open_count: number;
  click_count: number;
  unsubscribe_count: number;
  created_at: string;
  sent_at: string | null;
  scheduled_at: string | null;
}

interface Customer {
  id: string;
  name: string;
  email?: string;
  birthday?: string | null;
}

const SEGMENTS = [
  { value: "all", label: "Todos los clientes con email" },
  { value: "vip", label: "VIP y Premium (compraron últimos 30d)" },
  { value: "at_risk", label: "En riesgo (sin comprar 30–60d)" },
  { value: "dormant", label: "Dormidos (sin comprar 60–90d)" },
  { value: "lost", label: "Perdidos (sin comprar +90d)" },
  { value: "birthday", label: "Cumpleaños este mes" },
  { value: "never_bought", label: "Nunca compraron (solo en CRM)" },
];

const STATUS_COLORS: Record<string, string> = {
  draft:   "bg-muted text-muted-foreground",
  sending: "bg-blue-500/20 text-blue-400",
  sent:    "bg-emerald-500/20 text-emerald-400",
  failed:  "bg-red-500/20 text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador", sending: "Enviando…", sent: "Enviado", failed: "Fallido",
};

// ─── Branding helper ──────────────────────────────────────────────────────────

function buildBrandedEmail(bodyHtml: string, logoUrl: string | null, businessName: string): string {
  const logoTag = logoUrl
    ? `<img src="${logoUrl}" alt="${businessName}" style="max-height:60px;max-width:200px;display:block;margin:0 auto 10px">`
    : '';
  const header = `
<div style="text-align:center;padding:20px 16px 16px;background:#1A1A2E;border-radius:8px 8px 0 0">
  ${logoTag}
  <h2 style="color:#D4A843;margin:0;font-size:20px;font-weight:700;letter-spacing:1px">${businessName}</h2>
</div>`;
  const footer = `
<div style="text-align:center;margin-top:24px;padding:12px;font-size:11px;color:#888;border-top:1px solid #eee">
  <p style="margin:0">© ${new Date().getFullYear()} ${businessName} · Recibiste este email porque sos parte de nuestra comunidad.</p>
  <p style="margin:4px 0 0"><a href="{{unsubscribe_url}}" style="color:#888;text-decoration:underline">Cancelar suscripción</a></p>
</div>`;
  return `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;border:1px solid #eee;border-radius:8px;overflow:hidden">
  ${header}
  <div style="padding:24px 20px;background:#ffffff;color:#222;font-size:14px;line-height:1.7">
    ${bodyHtml}
  </div>
  ${footer}
</div>`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmailCampaignsPage() {
  usePageTitle("Email Marketing");
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [unsubscribed, setUnsubscribed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [orgSettings, setOrgSettings] = useState<{ logo_url: string | null; business_name: string }>({ logo_url: null, business_name: "Mi Negocio" });
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Campaign | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [segment, setSegment] = useState("all");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [showBodyPreview, setShowBodyPreview] = useState(false);
  const [bulkCampaign, setBulkCampaign] = useState<{ emails: string[]; names: string[]; count: number; segment: string } | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  // A/B test state
  const [abMode, setAbMode] = useState(false);
  const [subjectB, setSubjectB] = useState("");

  // Read bulk selection from CRM sessionStorage on mount
  useEffect(() => {
    const raw = sessionStorage.getItem('gestiona.bulk_campaign');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        setBulkCampaign(data);
        setSegment('bulk_custom');
        setOpen(true);
      } catch { /* ignore malformed */ }
      sessionStorage.removeItem('gestiona.bulk_campaign');
    }
  }, []);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!activeOrg || !user) return;
    setLoading(true);
    try {
      const [{ data: camps }, { data: custs }, { data: sales }, { data: unsubs }, sett] = await Promise.all([
        supabase.from("email_campaigns").select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("customers").select("id,name,email,birthday").eq("org_id", activeOrg.id).not("email", "is", null),
        supabase.from("sales").select("customer_name,date").eq("org_id", activeOrg.id).order("date", { ascending: false }),
        supabase.from("email_unsubscribes").select("email").eq("org_id", activeOrg.id),
        getSettingsDB(user.id),
      ]);
      setCampaigns((camps || []) as Campaign[]);
      setCustomers((custs || []) as Customer[]);
      setSalesData(sales || []);
      setUnsubscribed(new Set((unsubs || []).map((u: any) => u.email.toLowerCase())));
      if (sett) setOrgSettings({ logo_url: sett.logo_url || null, business_name: sett.business_name || "Mi Negocio" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

  // Live metric updates: when resend-webhook increments open/click counts, refresh campaigns
  useEffect(() => {
    if (!activeOrg) return;
    const ch = safeChannel("email-campaigns-rt", activeOrg.id)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "email_campaigns",
        filter: `org_id=eq.${activeOrg.id}`,
      }, payload => {
        setCampaigns(prev => prev.map(c => c.id === (payload.new as any).id ? { ...c, ...(payload.new as any) } : c));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeOrg]);

  // ── Segment audiences ────────────────────────────────────────────────────────

  const audienceFor = useMemo(() => {
    const today = new Date();
    const lastPurchaseByName: Record<string, number> = {};
    salesData.forEach(s => {
      if (!s.customer_name) return;
      const d = new Date(s.date).getTime();
      if (!lastPurchaseByName[s.customer_name] || d > lastPurchaseByName[s.customer_name]) {
        lastPurchaseByName[s.customer_name] = d;
      }
    });

    // Exclude unsubscribed customers
    const withEmail = customers.filter(c => c.email && !unsubscribed.has(c.email.toLowerCase()));
    return (seg: string): Customer[] => {
      if (seg === "all") return withEmail;
      return withEmail.filter(c => {
        const lastMs = lastPurchaseByName[c.name];
        const daysSince = lastMs ? (today.getTime() - lastMs) / 86_400_000 : 999;
        if (seg === "vip") return daysSince <= 30;
        if (seg === "at_risk") return daysSince > 30 && daysSince <= 60;
        if (seg === "dormant") return daysSince > 60 && daysSince <= 90;
        if (seg === "lost") return daysSince > 90;
        if (seg === "birthday") {
          const m = today.getMonth() + 1;
          if (!c.birthday) return false;
          const bm = parseInt(c.birthday.split("-")[1] || "0");
          return bm === m;
        }
        if (seg === "never_bought") return !lastMs;
        return true;
      });
    };
  }, [customers, salesData, unsubscribed]);

  const bulkAudience = useMemo(() => {
    if (!bulkCampaign) return [];
    const emailSet = new Set(bulkCampaign.emails.map(e => e.toLowerCase()));
    return customers.filter(c => c.email && emailSet.has(c.email.toLowerCase()));
  }, [bulkCampaign, customers]);

  const currentAudience = useMemo(() => {
    if (segment === 'bulk_custom') return bulkAudience;
    return audienceFor(segment);
  }, [audienceFor, segment, bulkAudience]);

  // ── Create campaign ───────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!activeOrg || !user) return;
    if (!subject.trim() || !bodyHtml.trim()) { toast.error("Completá asunto y cuerpo"); return; }
    if (abMode && !subjectB.trim()) { toast.error("Ingresá el asunto B para el test A/B"); return; }
    setSaving(true);
    try {
      const brandedHtml = buildBrandedEmail(bodyHtml.trim(), orgSettings.logo_url, orgSettings.business_name);
      const baseRow = {
        org_id: activeOrg.id,
        body_html: brandedHtml,
        segment,
        status: "draft",
        sent_count: 0,
        failed_count: 0,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      };

      if (abMode) {
        // Create two campaigns for A/B test
        const [resA, resB] = await Promise.all([
          supabase.from("email_campaigns").insert({ ...baseRow, subject: `[A] ${subject.trim()}` }),
          supabase.from("email_campaigns").insert({ ...baseRow, subject: `[B] ${subjectB.trim()}` }),
        ]);
        if (resA.error || resB.error) throw resA.error || resB.error;
        toast.success("Test A/B creado — dos campañas listas para enviar");
      } else {
        const { error } = await supabase.from("email_campaigns").insert({ ...baseRow, subject: subject.trim() });
        if (error) throw error;
        toast.success(scheduledAt ? `Campaña programada para ${new Date(scheduledAt).toLocaleString("es-AR")}` : "Campaña creada como borrador");
      }

      setOpen(false); setSubject(""); setSubjectB(""); setBodyHtml(""); setSegment("all"); setScheduledAt(""); setAbMode(false);
      load();
    } catch {
      toast.error("Error al guardar campaña");
    } finally {
      setSaving(false);
    }
  };

  // Duplicate an existing campaign
  const handleDuplicate = async (camp: Campaign) => {
    if (!activeOrg) return;
    try {
      const { error } = await supabase.from("email_campaigns").insert({
        org_id: activeOrg.id,
        subject: `Copia — ${camp.subject}`,
        body_html: camp.body_html,
        segment: camp.segment,
        status: "draft",
        sent_count: 0,
        failed_count: 0,
        scheduled_at: null,
      });
      if (error) throw error;
      toast.success("Campaña duplicada como borrador");
      load();
    } catch {
      toast.error("Error al duplicar campaña");
    }
  };

  // ── Send campaign ─────────────────────────────────────────────────────────────

  const handleSend = async (camp: Campaign) => {
    const audience = audienceFor(camp.segment);
    if (audience.length === 0) { toast.error("No hay destinatarios para este segmento"); return; }
    if (!confirm(`Enviar a ${audience.length} contacto(s) con email?`)) return;
    setSending(camp.id);
    try {
      await supabase.from("email_campaigns").update({ status: "sending" }).eq("id", camp.id);
      setCampaigns(prev => prev.map(c => c.id === camp.id ? { ...c, status: "sending" } : c));

      const { data, error } = await supabase.functions.invoke("send-email-campaign", {
        body: {
          campaignId: camp.id,
          subject: camp.subject,
          bodyHtml: camp.body_html,
          recipients: audience.map(c => ({ email: c.email!, name: c.name })),
          orgName: activeOrg?.name || "Gestiona",
          orgId: activeOrg?.id,
          // metadata passed to Resend so webhook can update metrics
          metadata: { campaign_id: camp.id, org_id: activeOrg?.id },
        },
      });

      if (error) throw error;
      toast.success(`Enviado a ${data?.sent ?? audience.length} contactos`);
      load();
    } catch {
      toast.error("Error al enviar campaña");
      await supabase.from("email_campaigns").update({ status: "failed" }).eq("id", camp.id);
      load();
    } finally {
      setSending(null);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta campaña?")) return;
    setDeleting(id);
    try {
      await supabase.from("email_campaigns").delete().eq("id", id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const totalSentEmails = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const totalOpensEmails = campaigns.reduce((s, c) => s + (c.open_count || 0), 0);
  const openRate = totalSentEmails > 0 ? `${(totalOpensEmails / totalSentEmails * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Mail}
        title="Email Marketing"
        description="Campañas dirigidas a tus clientes con email registrado"
        badge={
          campaigns.filter(c => c.status === "sent").length > 0
            ? { label: `${campaigns.filter(c => c.status === "sent").length} enviadas`, variant: "success" }
            : undefined
        }
        actions={
          <Button onClick={() => setOpen(true)} className="gradient-gold text-primary-foreground gap-1.5">
            <Plus className="w-4 h-4" /> Nueva campaña
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Con email" value={customers.filter(c => c.email).length} icon={Users} color="primary"
          sub="clientes alcanzables" />
        <KPICard label="Campañas enviadas" value={campaigns.filter(c => c.status === "sent").length} icon={CheckCircle2} color="success"
          sub={`${campaigns.length} totales`} />
        <KPICard label="Total enviados" value={totalSentEmails} icon={Send} color="blue" sub="emails despachados" />
        <KPICard label="Tasa apertura" value={openRate} icon={MailOpen} color="success" sub={`${totalOpensEmails} abiertos`} />
      </div>

      {/* Warning: no email configured */}
      <div className="flex items-start gap-3 rounded-lg border border-yellow-800/40 bg-yellow-950/20 px-4 py-3 text-sm text-yellow-300">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          Para enviar, configurá <strong>RESEND_API_KEY</strong> en las variables de entorno de Supabase y verificá tu dominio en Resend.
          Los emails salen desde <code className="text-xs">marketing@gestiona.app</code>.
        </div>
      </div>

      {/* Campaigns list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando...
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">Sin campañas</p>
          <p className="text-sm">Creá tu primera campaña para empezar a comunicarte con tus clientes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(camp => {
            const aud = audienceFor(camp.segment);
            return (
              <Card key={camp.id} className="border-border/60 bg-[hsl(228_24%_7%)]">
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {camp.subject.startsWith("[A] ") || camp.subject.startsWith("[B] ") ? (
                        <>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${camp.subject.startsWith("[A]") ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"}`}>
                            {camp.subject.startsWith("[A]") ? "A/B — A" : "A/B — B"}
                          </span>
                          <span className="font-semibold truncate">{camp.subject.replace(/^\[A\] |\[B\] /, "")}</span>
                          {camp.status === "sent" && camp.sent_count > 0 && (() => {
                            // Find the paired campaign
                            const paired = camp.subject.startsWith("[A]")
                              ? campaigns.find(c => c.subject === camp.subject.replace("[A]", "[B]"))
                              : campaigns.find(c => c.subject === camp.subject.replace("[B]", "[A]"));
                            if (paired?.status === "sent" && paired.sent_count > 0) {
                              const rateA = camp.subject.startsWith("[A]") ? (camp.open_count ?? 0) / camp.sent_count : (paired.open_count ?? 0) / paired.sent_count;
                              const rateB = camp.subject.startsWith("[A]") ? (paired.open_count ?? 0) / paired.sent_count : (camp.open_count ?? 0) / camp.sent_count;
                              const winner = rateA > rateB ? (camp.subject.startsWith("[A]") ? "A" : "B") : (camp.subject.startsWith("[A]") ? "B" : "A");
                              const isWinner = (camp.subject.startsWith("[A]") && winner === "A") || (camp.subject.startsWith("[B]") && winner === "B");
                              return isWinner ? (
                                <span className="flex items-center gap-1 text-[10px] font-bold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
                                  <Trophy className="w-3 h-3" /> Ganadora
                                </span>
                              ) : null;
                            }
                            return null;
                          })()}
                        </>
                      ) : (
                        <span className="font-semibold truncate">{camp.subject}</span>
                      )}
                      <Badge className={`text-xs px-1.5 py-0 rounded-[3px] ${STATUS_COLORS[camp.status]}`}>
                        {STATUS_LABELS[camp.status]}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-2">
                      <span>{SEGMENTS.find(s => s.value === camp.segment)?.label}</span>
                      <span>·</span>
                      <span>{aud.length} destinatario(s)</span>
                      {camp.sent_count > 0 && <><span>·</span><span className="text-emerald-400">{camp.sent_count} enviados</span></>}
                      {camp.failed_count > 0 && <><span>·</span><span className="text-red-400">{camp.failed_count} fallidos</span></>}
                      {camp.scheduled_at && camp.status === "draft" && (
                        <><span>·</span><span className="text-blue-400 flex items-center gap-1"><Clock className="w-3 h-3" />Programado: {new Date(camp.scheduled_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></>
                      )}
                      <span>·</span>
                      <span>{new Date(camp.created_at).toLocaleDateString("es-AR")}</span>
                    </div>
                    {/* Metrics row (only for sent campaigns with data) */}
                    {camp.status === "sent" && camp.sent_count > 0 && (() => {
                      const openRate = (camp.open_count ?? 0) / camp.sent_count * 100;
                      const clickRate = (camp.click_count ?? 0) / camp.sent_count * 100;
                      return (
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 w-28 shrink-0">
                              <MailOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="text-xs text-muted-foreground">Apertura</span>
                            </div>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(openRate, 100)}%` }} />
                            </div>
                            <span className="text-xs font-semibold font-mono text-emerald-400 w-16 text-right">{openRate.toFixed(1)}% <span className="text-muted-foreground font-normal">({camp.open_count ?? 0})</span></span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 w-28 shrink-0">
                              <MousePointerClick className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                              <span className="text-xs text-muted-foreground">Clics</span>
                            </div>
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(clickRate, 100)}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-blue-400 w-16 text-right">{clickRate.toFixed(1)}% <span className="text-muted-foreground font-normal">({camp.click_count ?? 0})</span></span>
                          </div>
                          {(camp.unsubscribe_count ?? 0) > 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-red-400">
                              <XCircle className="w-3.5 h-3.5" />
                              <span>{camp.unsubscribe_count} baja{camp.unsubscribe_count !== 1 ? "s" : ""}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setPreview(camp)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {camp.status === "draft" && (
                      <Button
                        size="sm"
                        disabled={!!sending || aud.length === 0}
                        onClick={() => handleSend(camp)}
                      >
                        {sending === camp.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Send className="w-4 h-4" />}
                        <span className="ml-1 hidden sm:inline">Enviar</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      title="Duplicar campaña"
                      onClick={() => handleDuplicate(camp)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={deleting === camp.id}
                      onClick={() => handleDelete(camp.id)}
                    >
                      {deleting === camp.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva campaña de email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Branding info */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
              {orgSettings.logo_url
                ? <><img src={orgSettings.logo_url} alt="logo" className="h-5 w-auto rounded" /><span><strong className="text-foreground">{orgSettings.business_name}</strong> — logo incluido automáticamente en el email</span></>
                : <span>⚠ Sin logo · <strong className="text-foreground">{orgSettings.business_name}</strong> · Configurá tu logo en Ajustes</span>
              }
            </div>
            {/* Template picker */}
            <div className="space-y-1.5">
              <Label>Plantilla (opcional)</Label>
              <div className="flex flex-wrap gap-2">
                {EMAIL_TEMPLATES.map(t => (
                  <button key={t.id} type="button"
                    onClick={() => { setSubject(t.subject); setBodyHtml(t.body); }}
                    className="px-2.5 py-1.5 text-xs rounded-[6px] border border-border bg-muted hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground">
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {bulkCampaign && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                <Users className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span><strong>{bulkCampaign.count} clientes</strong> seleccionados desde CRM · segmento: <em>{bulkCampaign.segment}</em></span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Segmento de audiencia</Label>
              <Select value={segment} onValueChange={v => { setSegment(v); if (v !== 'bulk_custom') setBulkCampaign(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {bulkCampaign && (
                    <SelectItem value="bulk_custom">
                      ✓ Selección CRM ({bulkAudience.length} con email)
                    </SelectItem>
                  )}
                  {SEGMENTS.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label} ({audienceFor(s.value).length} contactos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* A/B Test toggle */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-muted/20">
              <FlaskConical className="w-4 h-4 text-purple-400 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold">Test A/B de asunto</p>
                <p className="text-[10px] text-muted-foreground">Crea dos versiones con distinto asunto para comparar tasas de apertura</p>
              </div>
              <button
                type="button"
                onClick={() => setAbMode(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors ${abMode ? 'bg-purple-500' : 'bg-muted'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${abMode ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="space-y-1.5">
              <Label>{abMode ? "Asunto Versión A" : "Asunto"}</Label>
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Ej: 🔥 Oferta exclusiva para vos"
                maxLength={100}
              />
            </div>
            {abMode && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Asunto Versión B
                  <span className="text-[10px] text-muted-foreground font-normal">— el sistema divide la audiencia 50/50</span>
                </Label>
                <Input
                  value={subjectB}
                  onChange={e => setSubjectB(e.target.value)}
                  placeholder="Ej: Te extrañamos 💙 — volvé con esta oferta"
                  maxLength={100}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Cuerpo del email (HTML o texto)</Label>
                <div className="flex rounded-[6px] border border-border overflow-hidden h-7">
                  <button
                    type="button"
                    onClick={() => setShowBodyPreview(false)}
                    className={`px-3 text-xs transition-colors ${!showBodyPreview ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                  >Editar</button>
                  <button
                    type="button"
                    onClick={() => setShowBodyPreview(true)}
                    className={`px-3 text-xs transition-colors ${showBodyPreview ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                  >Vista previa</button>
                </div>
              </div>
              {showBodyPreview ? (
                <iframe
                  sandbox=""
                  srcDoc={bodyHtml ? buildBrandedEmail(bodyHtml, orgSettings.logo_url, orgSettings.business_name) : '<p style="color:#aaa;padding:16px;font-family:sans-serif">El cuerpo del email aparecerá aquí...</p>'}
                  className="min-h-[220px] w-full rounded-[8px] border border-border bg-gray-50"
                  style={{ minHeight: 220 }}
                  title="Vista previa del email"
                />
              ) : (
                <Textarea
                  value={bodyHtml}
                  onChange={e => setBodyHtml(e.target.value)}
                  placeholder="Hola {{nombre}}, tenemos una oferta especial..."
                  rows={10}
                  className="font-mono text-sm"
                />
              )}
              <p className="text-xs text-muted-foreground">
                Podés usar <code>{"{{nombre}}"}</code> para personalizar el saludo.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Programar envío (opcional)</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">Dejá vacío para enviar manualmente cuando quieras.</p>
            </div>
          </div>
          {/* Test send */}
          <div className="border-t border-border pt-4 mt-2 space-y-2">
            <Label className="text-xs text-muted-foreground">Envío de prueba (solo a vos)</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder="tu@email.com"
                className="text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={sendingTest || !testEmail || !subject || !bodyHtml}
                onClick={async () => {
                  if (!activeOrg || !subject || !bodyHtml) return;
                  setSendingTest(true);
                  try {
                    // Insert a temp draft and send to test email
                    const brandedHtml = buildBrandedEmail(bodyHtml.trim(), orgSettings.logo_url, orgSettings.business_name);
                    const { data: draft } = await supabase.from("email_campaigns").insert({
                      org_id: activeOrg.id, subject: `[PRUEBA] ${subject.trim()}`,
                      body_html: brandedHtml, segment: "all", status: "draft",
                      sent_count: 0, failed_count: 0,
                    }).select().single();
                    if (draft) {
                      await supabase.functions.invoke("send-email-campaign", {
                        body: { campaignId: draft.id, subject: `[PRUEBA] ${subject.trim()}`, bodyHtml: brandedHtml,
                          recipients: [{ email: testEmail, name: "Prueba" }], orgName: orgSettings.business_name },
                      });
                      await supabase.from("email_campaigns").delete().eq("id", draft.id);
                    }
                    toast.success(`Email de prueba enviado a ${testEmail}`);
                  } catch { toast.error("Error al enviar prueba"); }
                  finally { setSendingTest(false); }
                }}
              >
                {sendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Probar
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {scheduledAt ? "Programar" : "Guardar borrador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={v => !v && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vista previa: {preview?.subject}</DialogTitle>
          </DialogHeader>
          <iframe
            sandbox=""
            srcDoc={preview?.body_html || "<p style='color:#aaa;font-family:sans-serif;padding:16px'>Sin contenido</p>"}
            className="w-full rounded-[8px] border border-border bg-white"
            style={{ minHeight: 400 }}
            title="Vista previa de la campaña"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
