import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, BarChart3, ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  useCreator,
  type CreatorMetricReportInput,
  type CreatorSocialMetricReport,
} from "@/lib/creatorContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const today = () => new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
};

const STATUS: Record<CreatorSocialMetricReport["status"], { label: string; variant: "secondary" | "default" | "destructive" }> = {
  submitted: { label: "En revisión", variant: "secondary" },
  verified: { label: "Verificada", variant: "default" },
  rejected: { label: "Rechazada", variant: "destructive" },
};

const PLATFORM: Record<CreatorSocialMetricReport["platform"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

type Draft = {
  influencer_id: string;
  platform: CreatorMetricReportInput["platform"];
  metric_kind: CreatorMetricReportInput["metric_kind"];
  evidence_url: string;
  period_start: string;
  period_end: string;
  followers: string;
  reach: string;
  impressions: string;
  engagement_rate: string;
  notes: string;
};

const initialDraft = (): Draft => ({
  influencer_id: "",
  platform: "instagram",
  metric_kind: "captura",
  evidence_url: "",
  period_start: thirtyDaysAgo(),
  period_end: today(),
  followers: "",
  reach: "",
  impressions: "",
  engagement_rate: "",
  notes: "",
});

const optionalNumber = (value: string) => value.trim() === "" ? null : Number(value);

export default function CreatorMetricReportsCard() {
  const { linkedProfiles, metricReports, submitMetricReport } = useCreator();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!draft.influencer_id && linkedProfiles[0]?.id) {
      setDraft(current => ({ ...current, influencer_id: linkedProfiles[0].id }));
    }
  }, [draft.influencer_id, linkedProfiles]);

  const verified = useMemo(
    () => metricReports.filter(report => report.status === "verified").length,
    [metricReports],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const followers = Number(draft.followers);
    const reach = optionalNumber(draft.reach);
    const impressions = optionalNumber(draft.impressions);
    const engagement = optionalNumber(draft.engagement_rate);

    if (!draft.influencer_id) {
      toast.error("Elegí la marca para la que reportás estas métricas.");
      return;
    }
    if (!/^https:\/\/\S+$/.test(draft.evidence_url.trim())) {
      toast.error("La evidencia debe ser un enlace HTTPS válido.");
      return;
    }
    if (!draft.period_start || !draft.period_end || draft.period_start > draft.period_end || draft.period_end > today()) {
      toast.error("Revisá el período: debe terminar hoy o antes.");
      return;
    }
    if (!Number.isFinite(followers) || followers < 0) {
      toast.error("Ingresá una cantidad válida de seguidores.");
      return;
    }
    if ([reach, impressions].some(value => value != null && (!Number.isFinite(value) || value < 0))) {
      toast.error("Alcance e impresiones no pueden ser negativos.");
      return;
    }
    if (engagement != null && (!Number.isFinite(engagement) || engagement < 0 || engagement > 100)) {
      toast.error("El engagement debe estar entre 0 y 100.");
      return;
    }

    setSubmitting(true);
    try {
      await submitMetricReport({
        influencer_id: draft.influencer_id,
        platform: draft.platform,
        metric_kind: draft.metric_kind,
        evidence_url: draft.evidence_url.trim(),
        period_start: draft.period_start,
        period_end: draft.period_end,
        followers,
        reach,
        impressions,
        engagement_rate: engagement,
        notes: draft.notes.trim() || null,
      });
      toast.success("Reporte enviado para revisión.");
      setDraft(current => ({
        ...initialDraft(),
        influencer_id: current.influencer_id,
        platform: current.platform,
      }));
      setFormOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message.includes("metric_report_rate_limited")) toast.error("Alcanzaste el límite diario de reportes.");
      else if (message.includes("influencer_not_linked")) toast.error("Ese perfil ya no está vinculado con tu cuenta.");
      else toast.error("No pudimos enviar el reporte. Revisá los datos e intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" /> Métricas sociales
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {verified} verificadas · {metricReports.length} reportes enviados
          </p>
        </div>
        <Button size="sm" variant={formOpen ? "outline" : "default"} onClick={() => setFormOpen(open => !open)}>
          {formOpen ? "Cerrar" : "Nuevo reporte"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {formOpen && (
          <form onSubmit={submit} className="space-y-4 border-y border-border py-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Marca</Label>
                <Select value={draft.influencer_id} onValueChange={value => setDraft(current => ({ ...current, influencer_id: value }))}>
                  <SelectTrigger aria-label="Marca del reporte"><SelectValue placeholder="Elegí una marca" /></SelectTrigger>
                  <SelectContent>
                    {linkedProfiles.map(profile => (
                      <SelectItem key={profile.id} value={profile.id}>{profile.org_name ?? "Marca"} · {profile.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Red social</Label>
                <Select value={draft.platform} onValueChange={value => setDraft(current => ({ ...current, platform: value as Draft["platform"] }))}>
                  <SelectTrigger aria-label="Red social"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                    <SelectItem value="youtube">YouTube</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="metric-period-start">Desde</Label>
                <Input id="metric-period-start" type="date" max={today()} value={draft.period_start} onChange={event => setDraft(current => ({ ...current, period_start: event.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="metric-period-end">Hasta</Label>
                <Input id="metric-period-end" type="date" max={today()} value={draft.period_end} onChange={event => setDraft(current => ({ ...current, period_end: event.target.value }))} required />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <MetricNumber id="metric-followers" label="Seguidores" required value={draft.followers} onChange={followers => setDraft(current => ({ ...current, followers }))} />
              <MetricNumber id="metric-reach" label="Alcance" value={draft.reach} onChange={reach => setDraft(current => ({ ...current, reach }))} />
              <MetricNumber id="metric-impressions" label="Impresiones" value={draft.impressions} onChange={impressions => setDraft(current => ({ ...current, impressions }))} />
              <MetricNumber id="metric-engagement" label="Engagement %" max={100} step="0.01" value={draft.engagement_rate} onChange={engagement_rate => setDraft(current => ({ ...current, engagement_rate }))} />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Tipo de evidencia</Label>
                <Select value={draft.metric_kind} onValueChange={value => setDraft(current => ({ ...current, metric_kind: value as Draft["metric_kind"] }))}>
                  <SelectTrigger aria-label="Tipo de evidencia"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="captura">Captura</SelectItem>
                    <SelectItem value="export_csv">Exportación CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="metric-evidence">Enlace HTTPS a la evidencia</Label>
                <Input id="metric-evidence" type="url" inputMode="url" placeholder="https://..." value={draft.evidence_url} onChange={event => setDraft(current => ({ ...current, evidence_url: event.target.value }))} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="metric-notes">Notas</Label>
              <Textarea id="metric-notes" maxLength={2000} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} placeholder="Contexto del período o de la evidencia" />
            </div>
            <Button type="submit" disabled={submitting || linkedProfiles.length === 0} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Enviando..." : "Enviar para revisión"}
            </Button>
          </form>
        )}

        {linkedProfiles.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Tu cuenta todavía no está vinculada con una marca.</p>
        ) : metricReports.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Todavía no enviaste métricas para verificar.</p>
        ) : (
          <div className="divide-y divide-border">
            {metricReports.map(report => {
              const status = STATUS[report.status];
              return (
                <div key={report.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {report.org_name ?? "Marca"} · {PLATFORM[report.platform]}
                      {report.status === "verified" && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Métricas verificadas" />}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {report.period_start} a {report.period_end} · {Number(report.followers).toLocaleString("es-AR")} seguidores
                      {report.engagement_rate != null ? ` · ${report.engagement_rate}% engagement` : ""}
                    </p>
                    {report.review_notes && <p className="mt-1 text-xs text-muted-foreground">Revisión: {report.review_notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Button asChild size="icon" variant="ghost" title="Abrir evidencia">
                      <a href={report.evidence_url} target="_blank" rel="noreferrer" aria-label="Abrir evidencia"><ExternalLink className="h-4 w-4" /></a>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricNumber({ id, label, value, onChange, required, max, step = "1" }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  max?: number;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" min="0" max={max} step={step} value={value} onChange={event => onChange(event.target.value)} required={required} />
    </div>
  );
}
