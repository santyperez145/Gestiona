import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit, Plus, Search, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { useModulePerms } from '@/lib/permissionsContext';
import { supabase } from '@/integrations/supabase/client';
import { createInfluencer, deleteInfluencer, isActiveInfluencer, listInfluencers, updateInfluencer, type Influencer } from '@/lib/influencersDB';
import { enlaceInfluencerConRef } from '@/lib/storeFirstPublish';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function InfluencersPage() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const permissions = useModulePerms('influencers');
  const client = useQueryClient();
  const orgId = activeOrg.id;
  const query = useQuery({ queryKey: ['influencer-creators', orgId], queryFn: () => listInfluencers(orgId), refetchOnWindowFocus: false });
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const [editing, setEditing] = useState<Influencer | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Influencer | null>(null);
  const [busy, setBusy] = useState(false);
  const deletingRef = useRef(false);
  const refresh = () => client.invalidateQueries({ queryKey: ['influencer-creators', orgId] });
  const copyLink = async (creator: Influencer) => {
    try {
      const { data, error } = await supabase.from('ecommerce_stores').select('slug, is_active').eq('org_id', orgId).order('is_active', { ascending: false }).order('is_primary', { ascending: false }).order('created_at').limit(1).maybeSingle();
      if (error) throw error;
      const url = enlaceInfluencerConRef({ origin: window.location.origin, userId: user?.id, storeSlug: data?.slug, storeActive: Boolean(data?.is_active), referralCode: creator.referral_code });
      if (!url) { toast.error('Publicá la tienda antes de compartir el enlace.'); return; }
      await navigator.clipboard.writeText(url);
      toast.success('Enlace de referido copiado');
    } catch { toast.error('No pudimos copiar el enlace. Intentá nuevamente.'); }
  };
  const remove = async () => {
    if (!deleting || !permissions.canDelete || deletingRef.current) return;
    deletingRef.current = true; setBusy(true);
    try { await deleteInfluencer(deleting.id); setDeleting(null); await refresh(); toast.success('Creador eliminado'); }
    catch { toast.error('No se pudo eliminar. Revisá los permisos y las campañas vinculadas. Podés pausar el creador para conservar su historial.'); }
    finally { deletingRef.current = false; setBusy(false); }
  };
  const filtered = (query.data ?? []).filter(item => `${item.name} ${item.instagram ?? ''} ${item.tiktok ?? ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return <div className="space-y-5">
    <PageHeader icon={Users} eyebrow="Nerqia · Influencers" title="Creadores" actions={permissions.canCreate && <Button onClick={() => setEditing('new')}><Plus className="mr-2 h-4 w-4" />Nuevo creador</Button>} />
    <div className="relative sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar creadores" value={search} placeholder="Nombre o cuenta social" className="pl-9" onChange={event => setParams(previous => { const next = new URLSearchParams(previous); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); return next; }, { replace: true })} /></div>
    {query.isPending ? <WorkspaceState kind="initial-loading" title="Cargando creadores" /> : query.isError ? <WorkspaceState kind="error-recoverable" title="No pudimos cargar los creadores" actionLabel="Reintentar" onAction={() => void query.refetch()} /> : !filtered.length ? <WorkspaceState kind={search ? 'empty-filtered' : 'empty-first-use'} title={search ? 'Sin coincidencias' : 'Todavía no hay creadores'} /> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
      <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Creador</th><th className="p-3">Estado</th><th className="p-3 text-right">Seguidores</th><th className="p-3">Código de referido</th><th className="p-3">Comisión por venta</th><th className="p-3 text-right">Acciones</th></tr></thead>
      <tbody className="divide-y divide-border">{filtered.map(item => <tr key={item.id} className="hover:bg-muted/30"><td className="max-w-[260px] py-4"><p className="break-words font-medium">{item.name}</p><p className="break-words text-xs text-muted-foreground">{item.instagram || item.tiktok || 'Sin cuenta social'}</p></td><td className="p-3"><Badge variant="outline">{isActiveInfluencer(item.status) ? 'Activo' : 'Pausado'}</Badge></td><td className="p-3 text-right tabular-nums">{Math.max(item.followers_ig ?? 0, item.followers_tiktok ?? 0).toLocaleString('es-AR')}</td><td className="p-3 font-mono text-xs">{item.referral_code}</td><td className="p-3">{item.commission_type === 'porcentaje' ? `${item.commission_percent}%` : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(item.commission_fixed_ars ?? 0)}</td><td className="p-3"><div className="flex justify-end gap-1">
        <Button size="icon" variant="ghost" title="Copiar enlace de referido" aria-label={`Copiar enlace de ${item.name}`} onClick={() => void copyLink(item)}><Copy className="h-4 w-4" /></Button>
        {permissions.canEdit && <Button size="icon" variant="ghost" title="Editar creador" aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}><Edit className="h-4 w-4" /></Button>}
        {permissions.canDelete && <Button size="icon" variant="ghost" title="Eliminar creador" aria-label={`Eliminar ${item.name}`} onClick={() => setDeleting(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
      </div></td></tr>)}</tbody>
    </table></div>}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}>{editing && <CreatorForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} orgId={orgId} userId={user.id} onSaved={() => { setEditing(null); void refresh(); }} />}</Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Eliminar creador</DialogTitle><DialogDescription>Se eliminará a {deleting?.name}. Si tiene campañas vinculadas, la eliminación será rechazada para conservar el historial.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Volver</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>Eliminar</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function CreatorForm({ initial, orgId, userId, onSaved }: { initial: Influencer | null; orgId: string; userId: string; onSaved: () => void }) {
  const permissions = useModulePerms('influencers');
  const [form, setForm] = useState(() => ({ name: initial?.name ?? '', instagram: initial?.instagram ?? '', tiktok: initial?.tiktok ?? '', email: initial?.email ?? '', phone: initial?.phone ?? '', followers_ig: initial?.followers_ig ?? 0, followers_tiktok: initial?.followers_tiktok ?? 0, commission_percent: initial?.commission_percent ?? 10, commission_type: initial?.commission_type ?? 'porcentaje', commission_fixed_ars: initial?.commission_fixed_ars ?? 0, referral_code: initial?.referral_code ?? '', status: initial?.status ?? 'activo' }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !(initial ? permissions.canEdit : permissions.canCreate)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const payload = { ...form, name: form.name.trim(), referral_code: form.referral_code.trim() || crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase() };
      if (initial) await updateInfluencer(initial.id, payload); else await createInfluencer({ ...payload, org_id: orgId, user_id: userId });
      toast.success(initial ? 'Creador actualizado' : 'Creador creado'); onSaved();
    } catch { setError('No pudimos guardar el creador. Revisá los datos, los permisos y que el código no esté repetido.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>{initial ? 'Editar creador' : 'Nuevo creador'}</DialogTitle><DialogDescription>Datos de contacto y condiciones de referido.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4"><fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
      {(['name', 'instagram', 'tiktok', 'email', 'phone', 'referral_code'] as const).map(key => <div key={key} className="space-y-1"><Label htmlFor={`creator-${key}`}>{{ name: 'Nombre', instagram: 'Instagram', tiktok: 'TikTok', email: 'Correo electrónico', phone: 'Teléfono', referral_code: 'Código de referido (opcional)' }[key]}</Label><Input id={`creator-${key}`} type={key === 'email' ? 'email' : 'text'} required={key === 'name'} maxLength={160} value={form[key]} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} /></div>)}
      {(['followers_ig', 'followers_tiktok'] as const).map(key => <div key={key} className="space-y-1"><Label htmlFor={`creator-${key}`}>{key === 'followers_ig' ? 'Seguidores de Instagram' : 'Seguidores de TikTok'}</Label><Input id={`creator-${key}`} type="number" min={0} max={2147483647} step={1} value={form[key]} onChange={event => setForm(previous => ({ ...previous, [key]: Number(event.target.value) }))} /></div>)}
      <div className="space-y-1"><Label htmlFor="creator-status">Estado</Label><Select value={isActiveInfluencer(form.status) ? 'activo' : 'pausado'} disabled={busy} onValueChange={value => setForm(previous => ({ ...previous, status: value }))}><SelectTrigger id="creator-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="activo">Activo</SelectItem><SelectItem value="pausado">Pausado</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="creator-commission">Comisión</Label><Select value={form.commission_type} disabled={busy} onValueChange={value => setForm(previous => ({ ...previous, commission_type: value as Influencer['commission_type'] }))}><SelectTrigger id="creator-commission"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="porcentaje">Porcentaje de venta</SelectItem><SelectItem value="monto_fijo">Monto fijo por venta</SelectItem><SelectItem value="por_venta">Por venta concretada</SelectItem></SelectContent></Select></div>
      {form.commission_type === 'porcentaje' ? <div className="space-y-1"><Label htmlFor="creator-percent">Porcentaje</Label><Input id="creator-percent" type="number" min={0} max={100} step="0.01" value={form.commission_percent} onChange={event => setForm(previous => ({ ...previous, commission_percent: Number(event.target.value) }))} /></div> : <div className="space-y-1"><Label htmlFor="creator-fixed">Monto (ARS)</Label><Input id="creator-fixed" type="number" min={0} step="0.01" value={form.commission_fixed_ars} onChange={event => setForm(previous => ({ ...previous, commission_fixed_ars: Number(event.target.value) }))} /></div>}
    </fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar creador'}</Button></form>
  </DialogContent>;
}
