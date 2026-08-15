import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isAnnouncementTone, isInternalAnnouncementPath, type PlatformAnnouncement } from "@/lib/platformAnnouncements";

interface PlatformAnnouncementBannerProps {
  /** AppLayout sólo lo monta cuando la sesión tiene una organización activa. */
  enabled: boolean;
}

const TONE_STYLE = {
  info: {
    shell: "border-sky-500/20 bg-sky-500/[0.07]",
    icon: "text-sky-400",
    action: "border-sky-500/25 text-sky-300 hover:bg-sky-500/10",
    Icon: Info,
  },
  maintenance: {
    shell: "border-violet-500/25 bg-violet-500/[0.08]",
    icon: "text-violet-300",
    action: "border-violet-500/25 text-violet-200 hover:bg-violet-500/10",
    Icon: Wrench,
  },
  warning: {
    shell: "border-amber-500/25 bg-amber-500/[0.08]",
    icon: "text-amber-400",
    action: "border-amber-500/25 text-amber-200 hover:bg-amber-500/10",
    Icon: AlertTriangle,
  },
  success: {
    shell: "border-emerald-500/25 bg-emerald-500/[0.07]",
    icon: "text-emerald-400",
    action: "border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/10",
    Icon: CheckCircle2,
  },
} as const;

function asAnnouncement(value: Record<string, unknown>): PlatformAnnouncement | null {
  if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.body !== "string"
    || typeof value.tone !== "string" || !isAnnouncementTone(value.tone)
    || typeof value.starts_at !== "string" || typeof value.published_at !== "string") return null;

  return {
    id: value.id,
    title: value.title,
    body: value.body,
    tone: value.tone,
    cta_label: typeof value.cta_label === "string" ? value.cta_label : null,
    cta_url: typeof value.cta_url === "string" ? value.cta_url : null,
    starts_at: value.starts_at,
    ends_at: typeof value.ends_at === "string" ? value.ends_at : null,
    published_at: value.published_at,
  };
}

/**
 * Avisos operativos del SaaS, separados de los banners comerciales de cada
 * tienda. Sólo usa el RPC saneado: una organización nunca puede recorrer
 * borradores, historial ni descartes ajenos desde el navegador.
 */
export default function PlatformAnnouncementBanner({ enabled }: PlatformAnnouncementBannerProps) {
  const [announcements, setAnnouncements] = useState<PlatformAnnouncement[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setAnnouncements([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase.rpc("get_my_platform_announcements");
    if (loadError) {
      console.error("No se pudieron cargar los anuncios de plataforma", loadError);
      setAnnouncements([]);
      setError("No pudimos cargar las comunicaciones operativas.");
      setLoading(false);
      return;
    }

    const parsed = (data ?? [])
      .map(row => asAnnouncement(row as unknown as Record<string, unknown>))
      .filter((row): row is PlatformAnnouncement => row !== null);
    setAnnouncements(parsed);
    setLoading(false);
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  const dismiss = async (announcementId: string) => {
    setDismissing(announcementId);
    const { error: dismissError } = await supabase.rpc("dismiss_platform_announcement", { p_announcement_id: announcementId });
    if (dismissError) {
      console.error("No se pudo descartar el anuncio de plataforma", dismissError);
      toast.error("No pudimos descartar este aviso. Intentá de nuevo.");
      setDismissing(null);
      return;
    }
    setAnnouncements(current => current.filter(announcement => announcement.id !== announcementId));
    setDismissing(null);
  };

  if (!enabled || loading) return null;

  if (error) {
    return (
      <div className="border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5">
        <div className="mx-auto flex max-w-[1380px] items-center gap-3 text-xs text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <p className="flex-1">{error}</p>
          <button onClick={() => void load()} className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-100" aria-label="Reintentar cargar comunicaciones">
            <RefreshCw className="h-3.5 w-3.5" />Reintentar
          </button>
        </div>
      </div>
    );
  }

  const announcement = announcements[0];
  if (!announcement) return null;
  const style = TONE_STYLE[announcement.tone];
  const Icon = style.Icon;
  const canNavigate = isInternalAnnouncementPath(announcement.cta_url) && Boolean(announcement.cta_label);

  return (
    <div className={`border-b px-4 py-2.5 ${style.shell}`} role="status" aria-live="polite">
      <div className="mx-auto flex max-w-[1380px] items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug"><span className="font-semibold">{announcement.title}</span><span className="text-muted-foreground"> — {announcement.body}</span></p>
          {canNavigate && (
            <Link to={announcement.cta_url} className={`mt-1.5 inline-flex rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${style.action}`}>
              {announcement.cta_label}
            </Link>
          )}
        </div>
        <button
          onClick={() => void dismiss(announcement.id)}
          disabled={dismissing === announcement.id}
          className="mt-0.5 shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-40"
          aria-label="Descartar aviso"
          title="Descartar para mi cuenta"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
