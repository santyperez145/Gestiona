import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Edit, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/lib/orgContext';
import { useModulePerms } from '@/lib/permissionsContext';
import { useInfluencerCampaigns } from '@/hooks/useInfluencerCampaigns';
import { createContract, createDeliverable, deleteContract, deleteDeliverable, listInfluencerContracts, listInfluencerDeliverables, listInfluencers, updateContract, updateDeliverable, type InfluencerContract, type InfluencerDeliverable } from '@/lib/influencersDB';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Kind = 'contracts' | 'deliverables';
type RecordRow = InfluencerContract | InfluencerDeliverable;
const CONTRACT_STATES = { active: 'Vigente', paused: 'En pausa', expired: 'Vencido', cancelled: 'Cancelado' };
const DELIVERY_STATES = { pendiente: 'Pendiente', en_progreso: 'En producción', entregado: 'En revisión', completado: 'Aprobado internamente' };
const CONTRACT_TYPES = { fixed: 'Monto fijo', percentage: 'Porcentaje', hybrid: 'Mixto' };

export default function InfluencerRecords({ kind }: { kind: Kind }) {
  const { activeOrg } = useOrg();
  const orgId = activeOrg.id;
  const permissions = useModulePerms('influencers');
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const [editing, setEditing] = useState<RecordRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RecordRow | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const isContract = kind === 'contracts';
  const title = isContract ? 'Contratos' : 'Entregables';
  const queryKey = ['influencer-records', orgId, kind];
  const query = useQuery<RecordRow[]>({ queryKey, queryFn: () => isContract ? listInfluencerContracts() : listInfluencerDeliverables(), refetchOnWindowFocus: false });
  const remove = async () => {
    if (!deleting || lock.current || !permissions.canDelete) return;
    lock.current = true; setBusy(true);
    try { await (isContract ? deleteContract(deleting.id) : deleteDeliverable(deleting.id)); setDeleting(null); await client.invalidateQueries({ queryKey }); toast.success('Registro eliminado'); }
    catch { toast.error('No pudimos eliminar el registro. Revisá los permisos e intentá nuevamente.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const rows = (query.data ?? []).filter(item => `${item.influencer_name} ${'description' in item ? item.description : CONTRACT_TYPES[item.contract_type]}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return <div className="space-y-5"><PageHeader icon={isContract ? FileText : Calendar} eyebrow="Nerqia · Influencers" title={title} actions={permissions.canCreate && <Button onClick={() => setEditing('new')}><Plus className="mr-2 h-4 w-4" />{isContract ? 'Nuevo contrato' : 'Nuevo entregable'}</Button>} />
    <Input aria-label={`Buscar ${title.toLowerCase()}`} placeholder="Buscar por creador o descripción" value={search} className="sm:max-w-sm" onChange={event => setParams({ q: event.target.value }, { replace: true })} />
    {query.isPending ? <WorkspaceState kind="initial-loading" title={`Cargando ${title.toLowerCase()}`} /> : query.isError ? <WorkspaceState kind="error-recoverable" title="No pudimos cargar los registros" actionLabel="Reintentar" onAction={() => void query.refetch()} /> : !rows.length ? <WorkspaceState kind={search ? 'empty-filtered' : 'empty-first-use'} title="Sin registros" /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">{isContract ? 'Condiciones' : 'Contenido'}</th><th className="p-3">Fecha</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">{rows.map(item => {
      const contract = item as InfluencerContract; const delivery = item as InfluencerDeliverable;
      const date = isContract ? contract.valid_until : delivery.due_date;
      return <tr key={item.id}><td className="max-w-[180px] break-words py-4 font-medium">{item.influencer_name}</td><td className="max-w-[300px] break-words p-3">{isContract ? <><p>{CONTRACT_TYPES[contract.contract_type]}</p><p className="text-xs text-muted-foreground">{contract.contract_type !== 'percentage' && new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(contract.contract_amount)}{contract.contract_type !== 'fixed' && ` ${contract.commission_percent}%`}</p></> : <><p>{delivery.description}</p><p className="mt-1 text-xs text-muted-foreground">{delivery.campaign_name || 'Sin campaña'}</p>{delivery.content_url?.startsWith('https://') && <a href={delivery.content_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary">Abrir contenido<ExternalLink className="h-3 w-3" /></a>}</>}</td><td className="p-3">{date ? new Date(`${date}T12:00:00`).toLocaleDateString('es-AR') : 'Sin vencimiento'}</td><td className="p-3"><Badge variant="outline">{isContract ? CONTRACT_STATES[contract.status] : DELIVERY_STATES[delivery.status]}</Badge>{isContract && <p className="mt-1 text-xs text-muted-foreground">{contract.is_signed ? 'Firma declarada' : 'Sin firma registrada'}</p>}</td><td className="p-3"><div className="flex justify-end gap-1">{permissions.canEdit && <Button variant="ghost" size="icon" title="Editar registro" aria-label={`Editar registro de ${item.influencer_name}`} onClick={() => setEditing(item)}><Edit className="h-4 w-4" /></Button>}{permissions.canDelete && <Button variant="ghost" size="icon" title="Eliminar registro" aria-label={`Eliminar registro de ${item.influencer_name}`} onClick={() => setDeleting(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}</div></td></tr>;
    })}</tbody></table></div>}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}>{editing && <RecordForm key={editing === 'new' ? 'new' : editing.id} kind={kind} initial={editing === 'new' ? null : editing} orgId={orgId} onSaved={() => { setEditing(null); void client.invalidateQueries({ queryKey }); }} />}</Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Eliminar registro</DialogTitle><DialogDescription>Se eliminará el registro de {deleting?.influencer_name}. Esta acción no puede deshacerse.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Volver</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>Eliminar</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function RecordForm({ kind, initial, orgId, onSaved }: { kind: Kind; initial: RecordRow | null; orgId: string; onSaved: () => void }) {
  const isContract = kind === 'contracts';
  const contract = initial as InfluencerContract | null; const delivery = initial as InfluencerDeliverable | null;
  const permissions = useModulePerms('influencers');
  const creators = useQuery({ queryKey: ['influencer-creators', orgId], queryFn: () => listInfluencers(orgId), refetchOnWindowFocus: false });
  const campaigns = useInfluencerCampaigns();
  const [form, setForm] = useState({ creator: initial?.influencer_id ?? '', campaign: delivery?.campaign_id ?? '', description: delivery?.description ?? '', date: (isContract ? contract?.valid_from : delivery?.due_date) ?? '', end: contract?.valid_until ?? '', type: contract?.contract_type ?? 'fixed', amount: contract?.contract_amount ?? 0, percent: contract?.commission_percent ?? 0, status: initial?.status ?? (isContract ? 'active' : 'pendiente'), notes: initial?.notes ?? '', content: delivery?.content_url ?? '', review: delivery?.review_notes ?? '' });
  const [busy, setBusy] = useState(false); const lock = useRef(false); const [error, setError] = useState('');
  const selectedCampaign = campaigns.data?.find(item => item.id === form.campaign);
  const selectable = (creators.data ?? []).filter(item => !form.campaign || selectedCampaign?.influencer_campaign_creators.some(assigned => assigned.influencer_id === item.id));
  const update = (key: keyof typeof form, value: string | number) => setForm(previous => ({ ...previous, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !(initial ? permissions.canEdit : permissions.canCreate)) return;
    const creator = selectable.find(item => item.id === form.creator);
    if (!creator) { setError('Seleccioná un creador de la campaña elegida.'); return; }
    if (isContract && form.end && form.end < form.date) { setError('La fecha final no puede ser anterior al inicio.'); return; }
    if (!isContract && ['entregado', 'completado'].includes(form.status) && !form.content.startsWith('https://')) { setError('Agregá el enlace HTTPS del contenido antes de enviarlo a revisión.'); return; }
    if (!isContract && form.status === 'completado' && !form.review.trim()) { setError('Registrá el resultado de la revisión antes de aprobar.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const base = { org_id: orgId, influencer_id: creator.id, influencer_name: creator.name, notes: form.notes };
      if (isContract) {
        const payload = { ...base, contract_type: form.type as InfluencerContract['contract_type'], contract_amount: form.amount, commission_percent: form.percent, commission_fixed: form.amount, valid_from: form.date, valid_until: form.end || null, status: form.status as InfluencerContract['status'] };
        if (initial) await updateContract(initial.id, payload); else await createContract(payload);
      } else {
        const payload = { ...base, campaign_id: form.campaign || null, campaign_name: selectedCampaign?.title ?? '', description: form.description, due_date: form.date, content_url: form.content.trim() || null, review_notes: form.review.trim() || null, status: form.status as InfluencerDeliverable['status'] };
        if (initial) await updateDeliverable(initial.id, payload); else await createDeliverable(payload);
      }
      toast.success('Registro guardado'); onSaved();
    } catch { setError('No pudimos guardar. Revisá permisos, fechas y asignación del creador. Para aprobar, el contenido debe estar previamente en revisión.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{initial ? 'Editar' : 'Nuevo'} {isContract ? 'contrato' : 'entregable'}</DialogTitle><DialogDescription>{isContract ? 'Registro interno de las condiciones acordadas. No constituye una firma electrónica.' : 'Contenido acordado, fecha de entrega y revisión interna.'}</DialogDescription></DialogHeader>
    {creators.isError || (!isContract && campaigns.isError) ? <WorkspaceState kind="error-recoverable" title="No pudimos cargar las opciones" actionLabel="Reintentar" onAction={() => { void creators.refetch(); void campaigns.refetch(); }} /> : <form onSubmit={submit} className="space-y-4"><fieldset disabled={busy || creators.isPending || (!isContract && campaigns.isPending)} className="grid min-w-0 gap-3 sm:grid-cols-2">
      {!isContract && <div className="space-y-1 sm:col-span-2"><Label htmlFor="record-campaign">Campaña</Label><Select value={form.campaign || 'none'} onValueChange={value => { update('campaign', value === 'none' ? '' : value); update('creator', ''); }}><SelectTrigger id="record-campaign"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin campaña</SelectItem>{campaigns.data?.map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></div>}
      <div className="space-y-1"><Label htmlFor="record-creator">Creador</Label><Select value={form.creator} onValueChange={value => update('creator', value)}><SelectTrigger id="record-creator"><SelectValue placeholder="Elegir creador" /></SelectTrigger><SelectContent>{selectable.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="record-date">{isContract ? 'Vigente desde' : 'Fecha de entrega'}</Label><Input id="record-date" type="date" required value={form.date} onChange={event => update('date', event.target.value)} /></div>
      {isContract ? <>
        <div className="space-y-1"><Label htmlFor="record-end">Vigente hasta</Label><Input id="record-end" type="date" min={form.date || undefined} value={form.end} onChange={event => update('end', event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="record-type">Tipo de acuerdo</Label><Select value={form.type} onValueChange={value => update('type', value)}><SelectTrigger id="record-type"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CONTRACT_TYPES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        {form.type !== 'percentage' && <div className="space-y-1"><Label htmlFor="record-amount">Monto fijo (ARS)</Label><Input id="record-amount" type="number" min={0} step="0.01" value={form.amount} onChange={event => update('amount', Number(event.target.value))} /></div>}
        {form.type !== 'fixed' && <div className="space-y-1"><Label htmlFor="record-percent">Comisión (%)</Label><Input id="record-percent" type="number" min={0} max={100} step="0.01" value={form.percent} onChange={event => update('percent', Number(event.target.value))} /></div>}
      </> : <>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="record-description">Contenido acordado</Label><Textarea id="record-description" required maxLength={4000} value={form.description} onChange={event => update('description', event.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="record-content">Enlace del contenido</Label><Input id="record-content" type="url" pattern="https://.*" value={form.content} onChange={event => update('content', event.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="record-review">Resultado de la revisión</Label><Textarea id="record-review" value={form.review} maxLength={4000} onChange={event => update('review', event.target.value)} /></div>
      </>}
      <div className="space-y-1"><Label htmlFor="record-state">Estado</Label><Select value={form.status} onValueChange={value => update('status', value)}><SelectTrigger id="record-state"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(isContract ? CONTRACT_STATES : DELIVERY_STATES).filter(([value]) => value !== 'completado' || (initial && ['entregado', 'completado'].includes(initial.status))).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="record-notes">Notas</Label><Textarea id="record-notes" value={form.notes} maxLength={4000} onChange={event => update('notes', event.target.value)} /></div>
    </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy || creators.isPending || (!isContract && campaigns.isPending)}>{busy ? 'Guardando...' : 'Guardar registro'}</Button></form>}
  </DialogContent>;
}
