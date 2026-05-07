import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";

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
}

const SEGMENTS = [
  { value: "all", label: "Todos los clientes con email" },
  { value: "vip", label: "VIP y Premium" },
  { value: "at_risk", label: "En riesgo (sin comprar 30–60d)" },
  { value: "dormant", label: "Dormidos (sin comprar 60–90d)" },
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmailCampaignsPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [unsubscribed, setUnsubscribed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
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

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const [{ data: camps }, { data: custs }, { data: sales }, { data: unsubs }] = await Promise.all([
        supabase.from("email_campaigns" as any).select("*").eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("customers" as any).select("id,name,email").eq("org_id", activeOrg.id).not("email", "is", null),
        supabase.from("sales").select("customer_name,date").eq("org_id", activeOrg.id).order("date", { ascending: false }),
        (supabase as any).from("email_unsubscribes").select("email").eq("org_id", activeOrg.id),
      ]);
      setCampaigns((camps || []) as Campaign[]);
      setCustomers((custs || []) as Customer[]);
      setSalesData(sales || []);
      setUnsubscribed(new Set((unsubs || []).map((u: any) => u.email.toLowerCase())));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg]);

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
        return true;
      });
    };
  }, [customers, salesData, unsubscribed]);

  const currentAudience = useMemo(() => audienceFor(segment), [audienceFor, segment]);

  // ── Create campaign ───────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!activeOrg || !user) return;
    if (!subject.trim() || !bodyHtml.trim()) { toast.error("Completá asunto y cuerpo"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("email_campaigns" as any).insert({
        org_id: activeOrg.id,
        subject: subject.trim(),
        body_html: bodyHtml.trim(),
        segment,
        status: "draft",
        sent_count: 0,
        failed_count: 0,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      if (error) throw error;
      toast.success(scheduledAt ? `Campaña programada para ${new Date(scheduledAt).toLocaleString("es-AR")}` : "Campaña creada como borrador");
      setOpen(false); setSubject(""); setBodyHtml(""); setSegment("all"); setScheduledAt("");
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
    if (audience.length === 0) { toast.error("No hay destinatarios para este segmento"); return; }
    if (!confirm(`Enviar a ${audience.length} contacto(s) con email?`)) return;
    setSending(camp.id);
    try {
      await supabase.from("email_campaigns" as any).update({ status: "sending" }).eq("id", camp.id);
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
      await supabase.from("email_campaigns" as any).update({ status: "failed" }).eq("id", camp.id);
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
      await supabase.from("email_campaigns" as any).delete().eq("id", id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6 text-primary" />
            Email Marketing
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Campañas dirigidas a tus clientes con email registrado
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Nueva campaña
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Con email", value: customers.filter(c => c.email).length, icon: Users, color: "text-primary" },
          { label: "Campañas enviadas", value: campaigns.filter(c => c.status === "sent").length, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Total enviados", value: campaigns.reduce((s, c) => s + (c.sent_count || 0), 0), icon: Send, color: "text-blue-400" },
          {
            label: "Tasa apertura",
            value: (() => {
              const totalSent = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
              const totalOpens = campaigns.reduce((s, c) => s + (c.open_count || 0), 0);
              return totalSent > 0 ? `${(totalOpens / totalSent * 100).toFixed(1)}%` : "—";
            })(),
            icon: MailOpen, color: "text-emerald-400",
          },
        ].map(s => (
          <Card key={s.label} className="border-border bg-card/60">
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color} shrink-0`} />
              <div>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
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
              <Card key={camp.id} className="border-border bg-card/60">
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{camp.subject}</span>
                      <Badge className={`text-xs px-1.5 py-0 rounded-full ${STATUS_COLORS[camp.status]}`}>
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
                    {camp.status === "sent" && camp.sent_count > 0 && (
                      <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/50">
                        <div className="flex items-center gap-1.5 text-xs">
                          <MailOpen className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="font-medium">{camp.open_count ?? 0}</span>
                          <span className="text-muted-foreground">aperturas</span>
                          {camp.sent_count > 0 && (
                            <span className="text-emerald-400 font-semibold">
                              ({((camp.open_count ?? 0) / camp.sent_count * 100).toFixed(1)}%)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <MousePointerClick className="w-3.5 h-3.5 text-blue-400" />
                          <span className="font-medium">{camp.click_count ?? 0}</span>
                          <span className="text-muted-foreground">clics</span>
                          {camp.sent_count > 0 && (
                            <span className="text-blue-400 font-semibold">
                              ({((camp.click_count ?? 0) / camp.sent_count * 100).toFixed(1)}%)
                            </span>
                          )}
                        </div>
                        {(camp.unsubscribe_count ?? 0) > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-red-400">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{camp.unsubscribe_count} baja{camp.unsubscribe_count !== 1 ? "s" : ""}</span>
                          </div>
                        )}
                      </div>
                    )}
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
            <div className="space-y-1.5">
              <Label>Segmento de audiencia</Label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEGMENTS.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label} ({audienceFor(s.value).length} contactos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Asunto</Label>
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Ej: 🔥 Oferta exclusiva para vos"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cuerpo del email (HTML o texto)</Label>
              <Textarea
                value={bodyHtml}
                onChange={e => setBodyHtml(e.target.value)}
                placeholder="Hola {{nombre}}, tenemos una oferta especial..."
                rows={10}
                className="font-mono text-sm"
              />
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
          <div
            className="prose prose-invert prose-sm max-w-none rounded-lg border border-border p-4 bg-card text-sm"
            dangerouslySetInnerHTML={{ __html: preview?.body_html || "" }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
