import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Pause, Play, Plus, Save, Search, Target, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/lib/orgContext';
import { useModulePerms } from '@/lib/permissionsContext';
import { isActiveInfluencer, listInfluencers } from '@/lib/influencersDB';
import { useInfluencerCampaigns } from '@/hooks/useInfluencerCampaigns';
import { CAMPAIGN_CHANNELS, CAMPAIGN_OBJECTIVES, CAMPAIGN_STATUSES, CAMPAIGN_TRANSITIONS, campaignErrorMessage, saveInfluencerCampaign, transitionInfluencerCampaign, type CampaignDraft, type CampaignStatus, type InfluencerCampaign } from '@/lib/influencerCampaignsDB';
import CampaignChatPanel from '@/components/influencers/CampaignChatPanel';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (value: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
const TRANSITION_LABELS: Partial<Record<CampaignStatus, string>> = { active: 'Activar seguimiento', paused: 'Pausar', completed: 'Cerrar campaña', cancelled: 'Cancelar campaña' };
const TRANSITION_ICONS = { active: Play, paused: Pause, completed: Check, cancelled: X };

export default function InfluencerCampaignsPage() {
  const { activeOrg } = useOrg();
  const permissions = useModulePerms('influencers');
  const query = useInfluencerCampaigns();
  const [params, setParams] = useSearchParams();
  const selected = params.get('campana');
  const creating = params.get('nueva') === '1';
  const search = params.get('q') ?? '';
  const status = params.get('estado') ?? 'all';
  const campaign = query.data?.find(item => item.id === selected);
  const setParam = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const close = () => setParams(previous => { const next = new URLSearchParams(previous); next.delete('campana'); next.delete('nueva'); return next; });

  if (query.isPending) return <WorkspaceState kind="initial-loading" title="Cargando campañas" />;
  if (query.isError) return <WorkspaceState kind="error-recoverable" title="No pudimos cargar las campañas" description="No se modificaron tus datos." actionLabel="Reintentar" onAction={() => void query.refetch()} />;
  if (creating || selected) {
    if (!creating && !campaign) return <WorkspaceState kind="empty-filtered" title="Campaña no disponible" actionLabel="Volver a campañas" onAction={close} />;
    if (creating && !permissions.canCreate) return <WorkspaceState kind="permission" title="No tenés permiso para crear campañas" actionLabel="Volver" onAction={close} />;
    return <CampaignEditor key={`${activeOrg.id}:${campaign?.id ?? 'new'}`} campaign={campaign} onClose={close} onSaved={id => setParams(previous => {
      const next = new URLSearchParams(previous); next.delete('nueva'); next.set('campana', id); return next;
    })} />;
  }
  const filtered = (query.data ?? []).filter(item => (status === 'all' || item.status === status) && item.title.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return <div className="space-y-5">
    <PageHeader icon={Target} eyebrow="Nerqia · Influencers" title="Campañas" actions={permissions.canCreate && <Button onClick={() => setParam('nueva', '1')}><Plus className="mr-2 h-4 w-4" />Nueva campaña</Button>} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <Tabs value={status} onValueChange={value => setParam('estado', value)}>
        <TabsList className="h-auto flex-wrap"><TabsTrigger value="all">Todas</TabsTrigger>{Object.entries(CAMPAIGN_STATUSES).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList>
      </Tabs>
      <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar campañas" placeholder="Buscar campaña" value={search} onChange={event => setParam('q', event.target.value)} className="pl-9" /></div>
    </div>
    {filtered.length === 0 ? <WorkspaceState kind={query.data?.length ? 'empty-filtered' : 'empty-first-use'} title={query.data?.length ? 'Sin coincidencias' : 'Todavía no hay campañas'} /> : <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3 pr-4">Campaña</th><th className="p-3">Estado</th><th className="p-3">Canal</th><th className="p-3 text-right">Presupuesto</th><th className="p-3 text-right">Creadores</th><th className="p-3">Fecha objetivo</th></tr></thead>
        <tbody className="divide-y divide-border">{filtered.map(item => <tr key={item.id} className="hover:bg-muted/30">
          <td className="max-w-[260px] py-4 pr-4"><button className="break-words text-left font-medium text-primary hover:underline" onClick={() => setParam('campana', item.id)}>{item.title}</button><p className="mt-1 text-xs text-muted-foreground">{CAMPAIGN_OBJECTIVES[item.objective]}</p></td>
          <td className="p-3"><Badge variant="outline">{CAMPAIGN_STATUSES[item.status]}</Badge></td><td className="p-3">{CAMPAIGN_CHANNELS[item.channel]}</td>
          <td className="p-3 text-right tabular-nums">{money(item.budget_ars)}</td><td className="p-3 text-right">{item.influencer_campaign_creators.length}</td><td className="p-3">{item.due_date ? new Date(`${item.due_date}T12:00:00`).toLocaleDateString('es-AR') : 'Sin fecha'}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

function CampaignEditor({ campaign, onClose, onSaved }: { campaign?: InfluencerCampaign; onClose: () => void; onSaved: (id: string) => void }) {
  const { activeOrg } = useOrg();
  const orgId = activeOrg.id;
  const permissions = useModulePerms('influencers');
  const client = useQueryClient();
  const [draft, setDraft] = useState<CampaignDraft>(() => ({
    id: campaign?.id ?? crypto.randomUUID(), version: campaign?.version ?? 0, title: campaign?.title ?? '', brief: campaign?.brief ?? '',
    objective: campaign?.objective ?? 'sales', channel: campaign?.channel ?? 'instagram', budget_ars: campaign?.budget_ars ?? 0,
    due_date: campaign?.due_date ?? '', creator_ids: campaign?.influencer_campaign_creators.map(item => item.influencer_id) ?? [],
  }));
  const [creatorSearch, setCreatorSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState('');
  const [transition, setTransition] = useState<CampaignStatus | null>(null);
  const creators = useQuery({ queryKey: ['influencer-creators', orgId], queryFn: () => listInfluencers(orgId), refetchOnWindowFocus: false });
  const editable = campaign ? permissions.canEdit && ['draft', 'paused'].includes(campaign.status) : permissions.canCreate;
  const change = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setDirty(true); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !editable || !draft.title.trim() || !Number.isFinite(draft.budget_ars)) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const id = await saveInfluencerCampaign(orgId, draft);
      await client.invalidateQueries({ queryKey: ['influencer-campaigns', orgId] });
      if (mounted.current) { toast.success('Campaña guardada'); setDirty(false); onSaved(id); }
    } catch (cause) { if (mounted.current) setError(campaignErrorMessage(cause)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  // Refresh versions after a successful mutation, but never overwrite unsaved edits.
  useEffect(() => {
    if (campaign && !dirty) setDraft({ id: campaign.id, version: campaign.version, title: campaign.title,
      brief: campaign.brief, objective: campaign.objective, channel: campaign.channel,
      budget_ars: campaign.budget_ars, due_date: campaign.due_date ?? '',
      creator_ids: campaign.influencer_campaign_creators.map(item => item.influencer_id),
    });
  }, [campaign?.version, dirty]);
  const confirmTransition = async () => {
    if (!campaign || !transition || busyRef.current || !permissions.canEdit) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await transitionInfluencerCampaign(orgId, campaign, transition);
      await client.invalidateQueries({ queryKey: ['influencer-campaigns', orgId] });
      if (mounted.current) { setTransition(null); toast.success('Estado actualizado'); }
    } catch (cause) { if (mounted.current) { setTransition(null); setError(campaignErrorMessage(cause)); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const visibleCreators = (creators.data ?? []).filter(item => (isActiveInfluencer(item.status) || draft.creator_ids.includes(item.id)) && item.name.toLocaleLowerCase('es').includes(creatorSearch.toLocaleLowerCase('es')));
  return <div className="space-y-5">
    <Button variant="ghost" onClick={onClose} disabled={busy}><ArrowLeft className="mr-2 h-4 w-4" />Campañas</Button>
    <PageHeader icon={Target} eyebrow="Nerqia · Influencers" title={campaign ? campaign.title : 'Nueva campaña'} badge={campaign ? { label: CAMPAIGN_STATUSES[campaign.status] } : undefined} />
    {error && <WorkspaceState kind="error-recoverable" layout="banner" title={error} />}
    <form onSubmit={save} className="space-y-6">
      <fieldset disabled={!editable || busy} className="grid min-w-0 gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2"><Label htmlFor="campaign-title">Nombre de la campaña</Label><Input id="campaign-title" required maxLength={160} value={draft.title} onChange={event => change('title', event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="campaign-objective">Objetivo</Label><Select value={draft.objective} disabled={!editable || busy} onValueChange={value => change('objective', value as CampaignDraft['objective'])}><SelectTrigger id="campaign-objective"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CAMPAIGN_OBJECTIVES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="campaign-channel">Canal</Label><Select value={draft.channel} disabled={!editable || busy} onValueChange={value => change('channel', value as CampaignDraft['channel'])}><SelectTrigger id="campaign-channel"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CAMPAIGN_CHANNELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="campaign-budget">Presupuesto previsto (ARS)</Label><Input id="campaign-budget" type="number" min={0} max={999999999999.99} step="0.01" required value={draft.budget_ars} onChange={event => change('budget_ars', Number(event.target.value))} /></div>
        <div className="space-y-2"><Label htmlFor="campaign-date">Fecha objetivo</Label><Input id="campaign-date" type="date" value={draft.due_date} onChange={event => change('due_date', event.target.value)} /></div>
        <div className="space-y-2 md:col-span-2"><Label htmlFor="campaign-brief">Brief y requisitos de contenido</Label><Textarea id="campaign-brief" rows={7} maxLength={12000} value={draft.brief} onChange={event => change('brief', event.target.value)} /></div>
      </fieldset>
      <section className="space-y-3 border-t border-border pt-5" aria-labelledby="campaign-creators">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="campaign-creators" className="text-base font-semibold">Creadores asignados <span className="text-muted-foreground">({draft.creator_ids.length})</span></h2><Button asChild variant="outline" size="sm"><Link to="/influencer-marketing/creadores">Directorio de creadores</Link></Button></div>
        <Input aria-label="Buscar creadores" placeholder="Buscar por nombre" value={creatorSearch} onChange={event => setCreatorSearch(event.target.value)} className="sm:max-w-sm" />
        {creators.isPending ? <WorkspaceState kind="initial-loading" title="Cargando creadores" /> : creators.isError ? <WorkspaceState kind="error-recoverable" title="No pudimos cargar los creadores" actionLabel="Reintentar" onAction={() => void creators.refetch()} /> : <div className="max-h-72 overflow-y-auto divide-y divide-border border-y border-border">
          {visibleCreators.map(item => <label key={item.id} className="flex min-h-14 cursor-pointer items-center gap-3 py-3 pr-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.creator_ids.includes(item.id)} disabled={!editable || busy || (!isActiveInfluencer(item.status) && !draft.creator_ids.includes(item.id))} onChange={event => change('creator_ids', event.target.checked ? [...draft.creator_ids, item.id] : draft.creator_ids.filter(id => id !== item.id))} /><span className="min-w-0 flex-1 break-words font-medium">{item.name}{!isActiveInfluencer(item.status) && <span className="ml-2 text-xs text-muted-foreground">Inactivo</span>}</span><span className="text-xs text-muted-foreground">{Math.max(item.followers_ig ?? 0, item.followers_tiktok ?? 0).toLocaleString('es-AR')} seguidores</span></label>)}
          {!visibleCreators.length && <p className="py-6 text-sm text-muted-foreground">No hay creadores disponibles con esta búsqueda.</p>}
        </div>}
        {campaign && draft.creator_ids.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {(creators.data ?? []).filter(item => draft.creator_ids.includes(item.id)).map(item => (
              <CampaignChatPanel key={item.id} campaignId={campaign.id} influencerId={item.id} creatorName={item.name} />
            ))}
          </div>
        )}
      </section>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {editable && <Button type="submit" disabled={busy || creators.isPending || creators.isError}><Save className="mr-2 h-4 w-4" />{busy ? 'Guardando...' : 'Guardar campaña'}</Button>}
        {campaign && permissions.canEdit && CAMPAIGN_TRANSITIONS[campaign.status].map(status => {
          const Icon = TRANSITION_ICONS[status as keyof typeof TRANSITION_ICONS];
          return <Button key={status} type="button" variant="outline" disabled={busy || dirty} onClick={() => setTransition(status)}><Icon className="mr-2 h-4 w-4" />{TRANSITION_LABELS[status]}</Button>;
        })}
      </div>
    </form>
    <Dialog open={Boolean(transition)} onOpenChange={open => { if (!open && !busy) setTransition(null); }}><DialogContent><DialogHeader><DialogTitle>{transition ? TRANSITION_LABELS[transition] : ''}</DialogTitle><DialogDescription>{transition === 'active' ? 'Se activará el seguimiento interno. Esta acción no envía invitaciones, no publica contenido ni realiza pagos.' : transition === 'completed' ? 'Se cerrará el seguimiento interno. Esto no confirma publicaciones, pagos ni cumplimiento contractual.' : 'Se actualizará el estado de la campaña. El historial se conserva.'}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setTransition(null)}>Volver</Button><Button disabled={busy} onClick={() => void confirmTransition()}>{busy ? 'Actualizando...' : 'Confirmar'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
