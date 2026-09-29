import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { listSocialMetricReports, reviewSocialMetricReport, type SocialMetricReport } from '@/lib/influencersDB';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
const KIND_LABEL: Record<string, string> = { captura: 'Captura', export_csv: 'Export CSV' };
const PERIOD_DAYS = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;

function ReportEvidenceDialog({ report, onClose }: { report: SocialMetricReport; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Evidencia de {report.influencer_name ?? 'creador'}</DialogTitle>
          <DialogDescription>
            {PLATFORM_LABEL[report.platform] ?? report.platform} · {KIND_LABEL[report.metric_kind] ?? report.metric_kind} · ventana de {PERIOD_DAYS(report.period_start, report.period_end)} días ({report.period_start} → {report.period_end})
          </DialogDescription>
        </DialogHeader>
        <a href={report.evidence_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
          Abrir evidencia <ExternalLink className="h-4 w-4" />
        </a>
        {report.notes && <p className="rounded border bg-muted/40 p-3 text-sm">{report.notes}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** Bandeja Go-Marz: el creador sube evidencia, la marca verifica o rechaza. */
export default function SocialMetricReportsInbox({ activeOrgId }: { activeOrgId: string | null }) {
  const client = useQueryClient();
  const [evidence, setEvidence] = useState<SocialMetricReport | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['social-metric-reports', activeOrgId],
    enabled: Boolean(activeOrgId),
    refetchOnWindowFocus: false,
    queryFn: () => listSocialMetricReports(activeOrgId!),
  });

  const review = async (report: SocialMetricReport, status: 'verified' | 'rejected') => {
    setBusyId(report.id);
    try {
      await reviewSocialMetricReport(report.id, status, notes[report.id]?.trim() || null);
      toast.success(status === 'verified' ? 'Métricas verificadas: el sello aparece en descubrimiento' : 'Reporte rechazado');
      await client.invalidateQueries({ queryKey: ['social-metric-reports', activeOrgId] });
      await client.invalidateQueries({ queryKey: ['influencer-reputation'] });
      setNotes(prev => ({ ...prev, [report.id]: '' }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No pudimos registrar la revisión');
    } finally {
      setBusyId(null);
    }
  };

  if (!activeOrgId) return <WorkspaceState kind="empty-first-use" title="Elegí una organización" description="La bandeja de métricas depende de la organización activa." />;
  if (query.isPending) return <WorkspaceState kind="initial-loading" title="Cargando métricas de creadores" />;
  if (query.isError) return <WorkspaceState kind="error-recoverable" title="No pudimos cargar los reportes" actionLabel="Reintentar" onAction={() => void query.refetch()} />;
  const reports = query.data ?? [];

  return (
    <div className="space-y-4">
      {reports.length > 0 && reports.map(report => (
        <div key={report.id} className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium truncate">{report.influencer_name ?? 'Creador'}</span>
              <Badge variant="outline">{PLATFORM_LABEL[report.platform] ?? report.platform}</Badge>
              <Badge variant="outline">{KIND_LABEL[report.metric_kind] ?? report.metric_kind}</Badge>
              {report.status === 'verified' && <Badge variant="default" className="gap-1"><BadgeCheck className="h-3 w-3" /> Verificada</Badge>}
              {report.status === 'rejected' && <Badge variant="destructive">Rechazada</Badge>}
              {report.status === 'submitted' && <Badge variant="secondary">En revisión</Badge>}
            </div>
            <span className="text-xs text-muted-foreground">
              {report.period_start} → {report.period_end} ({PERIOD_DAYS(report.period_start, report.period_end)} días)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><span className="block text-xs text-muted-foreground">Seguidores</span><span className="tabular-nums">{Number(report.followers).toLocaleString('es-AR')}</span></div>
            <div><span className="block text-xs text-muted-foreground">Alcance</span><span className="tabular-nums">{report.reach == null ? '—' : Number(report.reach).toLocaleString('es-AR')}</span></div>
            <div><span className="block text-xs text-muted-foreground">Impresiones</span><span className="tabular-nums">{report.impressions == null ? '—' : Number(report.impressions).toLocaleString('es-AR')}</span></div>
            <div><span className="block text-xs text-muted-foreground">Engagement</span><span className="tabular-nums">{report.engagement_rate == null ? '—' : `${report.engagement_rate}%`}</span></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEvidence(report)}>Ver evidencia</Button>
            {report.status === 'submitted' && (
              <>
                <Input value={notes[report.id] ?? ''} onChange={e => setNotes(prev => ({ ...prev, [report.id]: e.target.value }))}
                  placeholder="Motivo / nota de revisión (opcional)" className="h-8 max-w-xs text-xs" />
                <Button size="sm" disabled={busyId === report.id} onClick={() => void review(report, 'verified')}>
                  {busyId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Verificar
                </Button>
                <Button variant="destructive" size="sm" disabled={busyId === report.id} onClick={() => void review(report, 'rejected')}>Rechazar</Button>
              </>
            )}
            {report.status === 'rejected' && report.review_notes && <span className="text-xs text-muted-foreground">Motivo: {report.review_notes}</span>}
          </div>
        </div>
      ))}
      {evidence && <ReportEvidenceDialog report={evidence} onClose={() => setEvidence(null)} />}
    </div>
  );
}