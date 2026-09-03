import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, CalendarClock, CheckCircle2, Edit3, FileText, Loader2, Megaphone, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { usePlatformAccess } from "@/lib/usePermissions";
import {
  announcementLifecycle,
  announcementLifecycleLabel,
  announcementToneLabel,
  formatAnnouncementDate,
  isAnnouncementTone,
  toAnnouncementDateTimeInput,
  toAnnouncementIso,
  type AnnouncementTone,
  type PlatformAnnouncementRow,
} from "@/lib/platformAnnouncements";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

type AnnouncementForm = {
  id: string | null;
  title: string;
  body: string;
  tone: AnnouncementTone;
  ctaLabel: string;
  ctaUrl: string;
  startsAt: string;
  endsAt: string;
  publish: boolean;
};

const STATUS_STYLE = {
  draft: "border-border bg-muted/40 text-muted-foreground",
  scheduled: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  published: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expired: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  archived: "border-border bg-muted/40 text-muted-foreground",
} as const;

const TONE_STYLE: Record<AnnouncementTone, string> = {
  info: "border-sky-500/25 bg-sky-500/[0.07] text-sky-700 dark:text-sky-200",
  maintenance: "border-violet-500/25 bg-violet-500/[0.07] text-violet-700 dark:text-violet-200",
  warning: "border-amber-500/25 bg-amber-500/[0.07] text-amber-700 dark:text-amber-100",
  success: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-200",
};

function emptyForm(): AnnouncementForm {
  return {
    id: null,
    title: "",
    body: "",
    tone: "info",
    ctaLabel: "",
    ctaUrl: "",
    startsAt: toAnnouncementDateTimeInput(new Date().toISOString()),
    endsAt: "",
    publish: false,
  };
}

function formFromRow(row: PlatformAnnouncementRow): AnnouncementForm {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tone: isAnnouncementTone(row.tone) ? row.tone : "info",
    ctaLabel: row.cta_label || "",
    ctaUrl: row.cta_url || "",
    startsAt: toAnnouncementDateTimeInput(row.starts_at),
    endsAt: toAnnouncementDateTimeInput(row.ends_at),
    publish: Boolean(row.published_at),
  };
}

function upsertRow(rows: PlatformAnnouncementRow[], saved: PlatformAnnouncementRow): PlatformAnnouncementRow[] {
  const withoutSaved = rows.filter(row => row.id !== saved.id);
  return [saved, ...withoutSaved];
}

export default function PlatformAnnouncementsPage() {
  usePageTitle("Anuncios · Plataforma");
  const { loading: accessLoading, isSuperadmin } = usePlatformAccess();
  const { ask, dialog } = useConfirmDialog();
  const [rows, setRows] = useState<PlatformAnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<AnnouncementForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSuperadmin) return;
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase.rpc("list_platform_announcements");
    if (loadError) {
      console.error("No se pudieron cargar los anuncios de plataforma", loadError);
      setRows([]);
      setError("No pudimos cargar los anuncios. Reintentá la consulta.");
      setLoading(false);
      return;
    }
    setRows(data ?? []);
    setLoading(false);
  }, [isSuperadmin]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => ({
    published: rows.filter(row => announcementLifecycle(row) === "published").length,
    scheduled: rows.filter(row => announcementLifecycle(row) === "scheduled").length,
    drafts: rows.filter(row => announcementLifecycle(row) === "draft").length,
  }), [rows]);

  const openNew = () => {
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (row: PlatformAnnouncementRow) => {
    setForm(formFromRow(row));
    setDialogOpen(true);
  };

  const save = async (publish: boolean) => {
    const startsAt = toAnnouncementIso(form.startsAt);
    const endsAt = toAnnouncementIso(form.endsAt);
    if (!startsAt) {
      toast.error("Indicá desde cuándo se mostrará el anuncio.");
      return;
    }
    if (form.endsAt && !endsAt) {
      toast.error("La fecha de cierre no es válida.");
      return;
    }
    if (endsAt && endsAt <= startsAt) {
      toast.error("La fecha de cierre debe ser posterior al inicio.");
      return;
    }
    if ((form.ctaLabel.trim() && !form.ctaUrl.trim()) || (!form.ctaLabel.trim() && form.ctaUrl.trim())) {
      toast.error("La acción necesita texto y una ruta interna.");
      return;
    }
    if (form.ctaUrl.trim() && (!form.ctaUrl.trim().startsWith("/") || form.ctaUrl.trim().startsWith("//") || /\s/.test(form.ctaUrl))) {
      toast.error("La acción debe usar una ruta interna, por ejemplo /estado.");
      return;
    }

    setSaving(true);
    // PostgREST genera los argumentos text/timestamptz como no nulos aunque la
    // firma SQL admite NULL para limpiar CTA y fecha de cierre. El cast queda
    // aislado acá y el servidor vuelve a validar el contrato completo.
    const args = {
      p_id: form.id ?? undefined,
      p_title: form.title.trim(),
      p_body: form.body.trim(),
      p_tone: form.tone,
      p_cta_label: form.ctaLabel.trim() || null,
      p_cta_url: form.ctaUrl.trim() || null,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_publish: publish,
    } as unknown as Database["public"]["Functions"]["save_platform_announcement"]["Args"];
    const { data, error: saveError } = await supabase.rpc("save_platform_announcement", args);
    if (saveError || !data) {
      console.error("No se pudo guardar el anuncio de plataforma", saveError);
      toast.error(saveError?.message || "No pudimos guardar el anuncio.");
      setSaving(false);
      return;
    }

    setRows(current => upsertRow(current, data));
    setSaving(false);
    setDialogOpen(false);
    toast.success(publish ? "Anuncio publicado" : "Borrador guardado");
  };

  const archive = async (row: PlatformAnnouncementRow) => {
    if (!(await ask({
      title: `¿Archivar “${row.title}”?`,
      description: "Dejará de mostrarse y quedará en el historial operativo.",
      confirmText: "Archivar",
    }))) return;
    setArchivingId(row.id);
    const { data, error: archiveError } = await supabase.rpc("archive_platform_announcement", { p_id: row.id });
    if (archiveError || !data) {
      console.error("No se pudo archivar el anuncio de plataforma", archiveError);
      toast.error(archiveError?.message || "No pudimos archivar el anuncio.");
      setArchivingId(null);
      return;
    }
    setRows(current => upsertRow(current, data));
    setArchivingId(null);
    toast.success("Anuncio archivado");
  };

  if (accessLoading) return <div className="p-8 text-sm text-muted-foreground">Verificando permisos…</div>;
  if (!isSuperadmin) return <Navigate to="/platform" replace />;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon={Megaphone}
        eyebrow="Plataforma / Comunicación operativa"
        title="Anuncios a los comercios"
        description="Comunicá mantenimientos, cambios relevantes y lanzamientos dentro de Gestión. No aparece en la tienda pública ni se mezcla con banners comerciales."
        actions={<>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Actualizar</Button>
          <Button size="sm" onClick={openNew}><Plus className="mr-2 h-3.5 w-3.5" />Nuevo aviso</Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "En pantalla", value: summary.published, icon: CheckCircle2, tone: "text-emerald-700 dark:text-emerald-300" },
          { label: "Programados", value: summary.scheduled, icon: CalendarClock, tone: "text-blue-700 dark:text-blue-300" },
          { label: "Borradores", value: summary.drafts, icon: FileText, tone: "text-muted-foreground" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-xl border border-border/60 bg-card p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${tone}`} /></div><p className="mt-2 font-mono text-2xl font-bold tabular-nums">{value}</p></div>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4"><BellRing className="h-4 w-4 text-violet-700 dark:text-violet-300" /><div><h2 className="text-sm font-semibold">Historial de comunicación</h2><p className="mt-0.5 text-xs text-muted-foreground">Archivar preserva trazabilidad; no se borra un mensaje operativo.</p></div></div>
        {loading ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando anuncios…</div> : error ? <div className="p-8 text-center text-sm text-muted-foreground"><p>{error}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>Reintentar</Button></div> : rows.length === 0 ? <div className="p-10 text-center"><Megaphone className="mx-auto h-7 w-7 text-muted-foreground/35" /><p className="mt-3 text-sm font-medium">Todavía no hay anuncios</p><p className="mt-1 text-xs text-muted-foreground">Publicá el primero cuando haya una comunicación que el comercio necesite ver dentro del sistema.</p></div> : (
          <div className="divide-y divide-border/50">
            {rows.map(row => {
              const lifecycle = announcementLifecycle(row);
              return (
                <article key={row.id} className="p-4 sm:px-5 sm:py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{row.title}</h3><Badge variant="outline" className={STATUS_STYLE[lifecycle]}>{announcementLifecycleLabel(lifecycle)}</Badge><Badge variant="outline" className={TONE_STYLE[isAnnouncementTone(row.tone) ? row.tone : "info"]}>{announcementToneLabel(isAnnouncementTone(row.tone) ? row.tone : "info")}</Badge></div>
                      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{row.body}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">Desde {formatAnnouncementDate(row.starts_at)}{row.ends_at ? ` · hasta ${formatAnnouncementDate(row.ends_at)}` : " · sin vencimiento"}{row.cta_label ? ` · acción: ${row.cta_label}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {lifecycle !== "archived" && <Button size="sm" variant="outline" onClick={() => openEdit(row)}><Edit3 className="mr-1.5 h-3.5 w-3.5" />Editar</Button>}
                      {lifecycle !== "archived" && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={archivingId === row.id} onClick={() => void archive(row)}>{archivingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}<span className={archivingId === row.id ? "sr-only" : ""}>Archivar</span></Button>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{form.id ? "Editar anuncio" : "Nuevo anuncio"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="announcement-title">Título</Label><Input id="announcement-title" maxLength={140} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="Ej.: Mantenimiento programado" /><p className="text-right text-[10px] text-muted-foreground">{form.title.length}/140</p></div>
            <div className="space-y-1.5"><Label htmlFor="announcement-body">Mensaje</Label><Textarea id="announcement-body" maxLength={1200} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} placeholder="Qué va a pasar, cuándo y qué debería esperar el comercio." /><p className="text-right text-[10px] text-muted-foreground">{form.body.length}/1200</p></div>
            <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-1.5"><Label htmlFor="announcement-tone">Tipo</Label><Select value={form.tone} onValueChange={value => setForm(current => ({ ...current, tone: isAnnouncementTone(value) ? value : "info" }))}><SelectTrigger id="announcement-tone"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="info">Información</SelectItem><SelectItem value="maintenance">Mantenimiento</SelectItem><SelectItem value="warning">Importante</SelectItem><SelectItem value="success">Novedad</SelectItem></SelectContent></Select></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="announcement-start">Visible desde</Label><Input id="announcement-start" type="datetime-local" value={form.startsAt} onChange={event => setForm(current => ({ ...current, startsAt: event.target.value }))} /></div></div>
            <div className="space-y-1.5"><Label htmlFor="announcement-end">Ocultar el</Label><Input id="announcement-end" type="datetime-local" value={form.endsAt} onChange={event => setForm(current => ({ ...current, endsAt: event.target.value }))} /><p className="text-[10px] text-muted-foreground">Opcional. Sin fecha, seguirá activo hasta archivarlo.</p></div>
            <div className="grid gap-4 rounded-lg border border-border/50 bg-muted/20 p-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="announcement-cta-label">Texto de acción</Label><Input id="announcement-cta-label" maxLength={60} value={form.ctaLabel} onChange={event => setForm(current => ({ ...current, ctaLabel: event.target.value }))} placeholder="Ej.: Ver estado" /></div><div className="space-y-1.5"><Label htmlFor="announcement-cta-url">Ruta interna</Label><Input id="announcement-cta-url" value={form.ctaUrl} onChange={event => setForm(current => ({ ...current, ctaUrl: event.target.value }))} placeholder="/estado" /><p className="text-[10px] text-muted-foreground">Sólo rutas de Nerqia que empiecen con /.</p></div></div>
          </div>
          <DialogFooter><Button variant="outline" disabled={saving} onClick={() => void save(false)}>Guardar borrador</Button><Button className="bg-violet-600 text-white hover:bg-violet-500" disabled={saving} onClick={() => void save(true)}>{saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}{form.id && form.publish ? "Actualizar publicación" : "Publicar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
