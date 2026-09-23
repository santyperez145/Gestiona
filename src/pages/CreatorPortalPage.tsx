import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCreator, type CreatorCampaign } from "@/lib/creatorContext";
import { supabase } from "@/integrations/supabase/client";
import { CreatorFoco } from "@/components/creator/CreatorFoco";
import BrandLogo from "@/components/shared/BrandLogo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  Sparkles, Instagram, Wallet, Target, CalendarClock, CheckCircle2,
  Clock, Loader2, ExternalLink, User, LogOut, Save, Upload,
} from "lucide-react";

/**
 * Portal del CREADOR autenticado — paridad Go-Marz.
 *
 * Un creador no es un comercio: no ve stock ni caja ni orgs. Ve SUS campañas
 * de todas las marcas que lo contratan, SUS entregables y SUS ingresos en
 * una sola bandeja. La identidad viaja por el email de la cuenta.
 */

const fmtMoney = (v: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", multiple: "Varias redes",
};

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "outline" | "destructive" }> = {
  activa: { label: "Activa", tone: "success" },
  active: { label: "Activa", tone: "success" },
  borrador: { label: "Borrador", tone: "outline" },
  draft: { label: "Borrador", tone: "outline" },
  finalizada: { label: "Finalizada", tone: "outline" },
  completed: { label: "Completado", tone: "success" },
  completado: { label: "Completado", tone: "success" },
  cumplido: { label: "Cumplido", tone: "success" },
  pendiente: { label: "Pendiente", tone: "warning" },
  pending: { label: "Pendiente", tone: "warning" },
  aceptado: { label: "Aceptada", tone: "success" },
  accepted: { label: "Aceptada", tone: "success" },
  declined: { label: "Rechazada", tone: "destructive" },
  expirada: { label: "Expirada", tone: "destructive" },
  expired: { label: "Expirada", tone: "destructive" },
  en_progreso: { label: "En progreso", tone: "warning" },
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline" className="text-[10px]">—</Badge>;
  const meta = STATUS_LABELS[status.toLowerCase()] ?? { label: status, tone: "outline" as const };
  return <Badge variant={meta.tone} className="text-[10px]">{meta.label}</Badge>;
}

function ProfileSection() {
  const { profile, saveProfile } = useCreator();
  const [form, setForm] = useState({
    display_name: profile?.display_name ?? "",
    bio: profile?.bio ?? "",
    phone: profile?.phone ?? "",
    instagram: profile?.instagram ?? "",
    tiktok: profile?.tiktok ?? "",
    youtube: profile?.youtube ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm({
      display_name: profile.display_name ?? "",
      bio: profile.bio ?? "",
      phone: profile.phone ?? "",
      instagram: profile.instagram ?? "",
      tiktok: profile.tiktok ?? "",
      youtube: profile.youtube ?? "",
    });
  }, [profile]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await saveProfile(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <User className="h-4 w-4 text-primary" /> Tu perfil de creador
        </CardTitle>
        {saved && <Badge variant="success" className="text-[10px]">Guardado</Badge>}
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="creator-name">Nombre público</Label>
              <Input id="creator-name" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="Como te conoce la audiencia" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creator-phone">Teléfono</Label>
              <Input id="creator-phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+54 9 ..." />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="creator-bio">Bio</Label>
            <Input id="creator-bio" value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} placeholder="Qué hacés y para quién creás contenido" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="creator-ig" className="flex items-center gap-1.5"><Instagram className="h-3.5 w-3.5" /> Instagram</Label>
              <Input id="creator-ig" value={form.instagram} onChange={e => setForm({ ...form, instagram: e.target.value })} placeholder="@usuario" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creator-tt">TikTok</Label>
              <Input id="creator-tt" value={form.tiktok} onChange={e => setForm({ ...form, tiktok: e.target.value })} placeholder="@usuario" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creator-yt">YouTube</Label>
              <Input id="creator-yt" value={form.youtube} onChange={e => setForm({ ...form, youtube: e.target.value })} placeholder="@canal" />
            </div>
          </div>
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Guardando..." : "Guardar perfil"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { profile } = useCreator();
  if (profile && !profile.onboarding_completed) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Completá tu perfil de creador</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Las marcas te van a encontrar por tu nombre, tus redes y tu bio. Completalos abajo para empezar a recibir campañas.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}

function CampaignCard({ campaign, registerRef }: { campaign: CreatorCampaign; registerRef?: (id: string, node: HTMLDivElement | null) => void }) {
  const { respondCampaign, submitDeliverable } = useCreator();
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!registerRef) return;
    return () => registerRef(campaign.id, null);
  }, [registerRef, campaign.id]);

  const invitation = campaign.invitation_status?.toLowerCase();
  const deliverado = Boolean(campaign.deliverable_url);
  const decidida = invitation === "accepted" || invitation === "declined" || invitation === "expired";

  const respond = async (action: "accept" | "decline") => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await respondCampaign(campaign.id, action);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes("invitation_expired")) setError("La invitación expiró: pedile una nueva a la marca.");
      else if (message.includes("invitation_not_found")) setError("No hay invitación pendiente para esta campaña.");
      else setError("No pudimos registrar tu respuesta. Intentá de nuevo.");
    } finally { setBusy(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!/^https:\/\/.+/.test(url.trim())) { setError("El enlace tiene que ser una URL https:// pública."); return; }
    if (!desc.trim()) { setError("Contá brevemente qué entregaste."); return; }
    setBusy(true); setError(null);
    try {
      await submitDeliverable(campaign.id, campaign.title, desc.trim(), url.trim());
      setShowForm(false); setUrl(""); setDesc("");
    } catch {
      setError("No pudimos registrar la entrega. Revisá el enlace e intentá de nuevo.");
    } finally { setBusy(false); }
  };

  return (
    <div
      ref={node => { if (registerRef) registerRef(campaign.id, node); }}
      className="rounded-xl border border-border bg-muted/20 p-4 space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{campaign.title}</p>
          <p className="text-xs text-muted-foreground">{campaign.org_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={campaign.status} />
          {invitation && <StatusBadge status={invitation} />}
        </div>
      </div>
      {campaign.brief && <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{campaign.brief}</p>}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {campaign.channel && <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> {CHANNEL_LABELS[campaign.channel] ?? campaign.channel}</span>}
        {campaign.due_date && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Hasta {fmtDate(campaign.due_date)}</span>}
        {campaign.budget_ars != null && Number(campaign.budget_ars) > 0 && (
          <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" /> {fmtMoney(Number(campaign.budget_ars))}</span>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      {/* Decisión de la invitación, en el portal y sin token público */}
      {!decidida && invitation && invitation !== "pending" && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void respond("decline")} className="h-8">No puedo</Button>
          <Button size="sm" disabled={busy} onClick={() => void respond("accept")} className="h-8">Aceptar campaña</Button>
        </div>
      )}

      {/* Entrega de contenido: solo con campaña aceptada y sin entregable previo */}
      {invitation === "accepted" && !deliverado && !showForm && (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="h-8 gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Entregar contenido
        </Button>
      )}
      {showForm && (
        <form onSubmit={submit} className="space-y-2 rounded-lg border border-border bg-card p-3">
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://enlace del contenido (post, reel, video)"
            inputMode="url"
            aria-label="Enlace del contenido"
          />
          <Input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Descripción breve de la entrega"
            aria-label="Descripción de la entrega"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy} className="h-8">{busy ? "Enviando..." : "Enviar entrega"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)} className="h-8">Cancelar</Button>
          </div>
        </form>
      )}

      {/* Feedback de la marca: aprobación o corrección pedida */}
      {campaign.review_notes && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5" role="status">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Feedback de {campaign.org_name}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{campaign.review_notes}</p>
        </div>
      )}

      {deliverado && (
        <a
          href={campaign.deliverable_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Contenido entregado <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

export default function CreatorPortalPage() {
  usePageTitle("Portal de creador");
  const { loading, isCreator, profile, campaigns, deliverables, earnings, refresh } = useCreator();
  const focoScrollRef = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => { void refresh(); }, [refresh]);

  /** El foco scrollea hasta la campaña y la resalta dos segundos. */
  const navigateToFoco = (campaignId: string) => {
    const node = focoScrollRef.current[campaignId];
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    node?.classList.add("ring-2", "ring-primary/40");
    setTimeout(() => node?.classList.remove("ring-2", "ring-primary/40"), 2000);
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Cargando tu portal...</p>
        </div>
      </div>
    );
  }

  if (!isCreator) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4">
        <div className="text-center max-w-md space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Sparkles className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">Esta cuenta no es de un creador</h1>
          <p className="text-sm text-muted-foreground">
            Si te registraste como negocio, tu lugar es el panel completo. Si sos creador y llegaste por error, iniciá sesión con el email que te registró la marca.
          </p>
          <div className="flex gap-2 justify-center">
            <Link to="/"><Button variant="outline">Ir al panel de negocio</Button></Link>
            <Link to="/login"><Button>Iniciar sesión</Button></Link>
          </div>
        </div>
      </div>
    );
  }

  const activas = campaigns.filter(c => !["finalizada", "completed", "finalizado"].includes(c.status.toLowerCase()));
  const pendientes = deliverables.filter(d => !["completado", "completed", "cumplido"].includes(d.status.toLowerCase()));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/portal-creador" className="flex items-center gap-2" aria-label="Portal de creador">
            <BrandLogo compact eager markClassName="h-7 w-7" nameClassName="text-sm font-semibold" />
            <Badge variant="secondary" className="text-[10px]">Creador</Badge>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-muted-foreground">{profile?.display_name ?? profile?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 text-muted-foreground hover:text-foreground">
              <LogOut className="h-3.5 w-3.5" /> Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <OnboardingGate>
          <CreatorFoco campaigns={campaigns} onNavigate={navigateToFoco} />

          {/* Ingresos */}
          {earnings && (
            <section aria-label="Ingresos" className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Disponible</p>
                  <p className="mt-1 text-2xl font-bold text-primary tabular-nums">{fmtMoney(Number(earnings.available_ars))}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Generado total</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{fmtMoney(Number(earnings.total_commissions_ars))}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{earnings.total_sales_count} ventas con tu link</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Pagado</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-600 tabular-nums">{fmtMoney(Number(earnings.paid_ars))}</p>
                  {Number(earnings.pending_withdrawals_ars) > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">{fmtMoney(Number(earnings.pending_withdrawals_ars))} en revisión</p>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {/* Campañas */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Tus campañas
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">{activas.length} activas</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {campaigns.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">Todavía no te contrataron campañas.</p>
                  <p className="text-xs text-muted-foreground">Cuando una marca te invite, la vas a ver acá.</p>
                </div>
              ) : campaigns.map(c => <CampaignCard key={c.id} campaign={c} registerRef={(id, node) => { focoScrollRef.current[id] = node; }} />)}
            </CardContent>
          </Card>

          {/* Entregables */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Entregables
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">{pendientes.length} pendientes</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {deliverables.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">Sin entregables todavía.</p>
                </div>
              ) : deliverables.map(d => {
                const done = ["completado", "completed", "cumplido"].includes(d.status.toLowerCase());
                return (
                  <div key={d.id} className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{d.description ?? d.campaign_name ?? "Entregable"}</p>
                        <p className="text-xs text-muted-foreground">{d.org_name}{d.campaign_name ? ` · ${d.campaign_name}` : ""}</p>
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" /> Vence {fmtDate(d.due_date)}
                      </span>
                      {done && d.content_url ? (
                        <a href={d.content_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-600 hover:underline">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Ver contenido <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <ProfileSection />
        </OnboardingGate>
      </main>
    </div>
  );
}
