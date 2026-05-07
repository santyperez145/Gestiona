import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { listInfluencers, createInfluencer, updateInfluencer, deleteInfluencer, listInfluencerSales, listPayouts, createPayout, type Influencer } from '@/lib/influencersDB';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit, Copy, DollarSign, TrendingUp, Users, Award, Instagram } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { toast } from 'sonner';
import KPICard from '@/components/shared/KPICard';
import EmptyState from '@/components/shared/EmptyState';
import { TableSkeleton } from '@/components/shared/PageSkeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import InfluencerExchangesPage from './InfluencerExchangesPage';

const TIER_COLORS: Record<string, string> = {
  nano: 'bg-zinc-500/20 text-zinc-300',
  micro: 'bg-blue-500/20 text-blue-300',
  medio: 'bg-purple-500/20 text-purple-300',
  macro: 'bg-amber-500/20 text-amber-300',
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
}

function genCode(name: string) {
  return (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) + Math.floor(Math.random() * 90 + 10);
}

function InfluencersTab() {
  const { user } = useAuth();
  const [items, setItems] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Influencer | null>(null);

  const reload = async () => { setItems(await listInfluencers()); setLoading(false); };
  useEffect(() => { reload(); }, []);

  const totalGen = items.reduce((s, i) => s + Number(i.total_generated_ars || 0), 0);
  const totalCom = items.reduce((s, i) => s + Number(i.total_commissions_ars || 0), 0);
  const totalSales = items.reduce((s, i) => s + (i.total_sales_count || 0), 0);

  const copyLink = (inf: Influencer) => {
    const url = `${window.location.origin}/catalogo/${user?.id}?ref=${inf.referral_code}`;
    navigator.clipboard.writeText(url);
    toast.success(`Link de ${inf.name} copiado`);
  };

  if (loading) return <TableSkeleton rows={5} cols={6} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Influencers" value={items.length.toString()} icon={Users} />
        <KPICard label="Generado" value={fmt(totalGen)} icon={TrendingUp} />
        <KPICard label="Comisiones" value={fmt(totalCom)} icon={DollarSign} />
        <KPICard label="Ventas" value={totalSales.toString()} icon={Award} />
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Lista de influencers</h3>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEdit(null); setOpen(true); }} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-1" /> Nuevo influencer
            </Button>
          </DialogTrigger>
          <InfluencerForm initial={edit} onSaved={() => { setOpen(false); reload(); }} userId={user!.id} />
        </Dialog>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Users} title="Sin influencers" description="Agregá tu primer influencer para empezar a tracker comisiones." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase">
              <tr>
                <th className="text-left p-3">Nombre</th>
                <th className="text-left p-3">Tier</th>
                <th className="text-right p-3">Seguidores</th>
                <th className="text-left p-3">Código</th>
                <th className="text-right p-3">Comisión</th>
                <th className="text-right p-3">Generado</th>
                <th className="text-right p-3">A pagar</th>
                <th className="text-right p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-t border-border hover:bg-muted/40">
                  <td className="p-3 font-medium">
                    {i.name}
                    {i.instagram && <a href={`https://instagram.com/${i.instagram.replace('@', '')}`} target="_blank" rel="noreferrer" className="ml-2 text-xs text-primary inline-flex items-center"><Instagram className="w-3 h-3 mr-1" />{i.instagram}</a>}
                  </td>
                  <td className="p-3"><Badge className={TIER_COLORS[i.tier]}>{i.tier}</Badge></td>
                  <td className="p-3 text-right">{(i.followers_ig || 0).toLocaleString('es-AR')}</td>
                  <td className="p-3 font-mono text-xs">
                    <button onClick={() => copyLink(i)} className="hover:text-primary inline-flex items-center gap-1">
                      {i.referral_code} <Copy className="w-3 h-3" />
                    </button>
                  </td>
                  <td className="p-3 text-right">{i.commission_type === 'porcentaje' ? `${i.commission_percent}%` : fmt(i.commission_fixed_ars)}</td>
                  <td className="p-3 text-right">{fmt(Number(i.total_generated_ars))}</td>
                  <td className="p-3 text-right text-success">{fmt(Number(i.total_commissions_ars))}</td>
                  <td className="p-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => { setEdit(i); setOpen(true); }}><Edit className="w-4 h-4" /></Button>
                    <ConfirmDialog
                      trigger={<Button size="icon" variant="ghost"><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                      title="Eliminar influencer"
                      description={`¿Eliminar a ${i.name}? Esto NO borra sus ventas históricas.`}
                      onConfirm={async () => { await deleteInfluencer(i.id); toast.success('Eliminado'); reload(); }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

function InfluencerForm({ initial, onSaved, userId }: { initial: Influencer | null; onSaved: () => void; userId: string }) {
  const [form, setForm] = useState<any>(initial || {
    name: '', instagram: '', tiktok: '', phone: '', email: '',
    followers_ig: 0, followers_tiktok: 0, engagement_rate: 0,
    commission_percent: 10, commission_type: 'porcentaje', commission_fixed_ars: 0,
    referral_code: '', status: 'activo', notes: '',
  });

  const submit = async () => {
    if (!form.name) return toast.error('Nombre requerido');
    if (!form.referral_code) form.referral_code = genCode(form.name);
    try {
      if (initial) await updateInfluencer(initial.id, form);
      else await createInfluencer({ ...form, user_id: userId });
      toast.success(initial ? 'Actualizado' : 'Creado');
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Error');
    }
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{initial ? 'Editar' : 'Nuevo'} influencer</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Nombre *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label>Instagram</Label><Input placeholder="@handle" value={form.instagram} onChange={e => setForm({ ...form, instagram: e.target.value })} /></div>
        <div><Label>TikTok</Label><Input placeholder="@handle" value={form.tiktok} onChange={e => setForm({ ...form, tiktok: e.target.value })} /></div>
        <div><Label>Seguidores IG</Label><Input type="number" value={form.followers_ig} onChange={e => setForm({ ...form, followers_ig: +e.target.value })} /></div>
        <div><Label>Seguidores TikTok</Label><Input type="number" value={form.followers_tiktok} onChange={e => setForm({ ...form, followers_tiktok: +e.target.value })} /></div>
        <div><Label>Teléfono</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div className="col-span-2 grid grid-cols-3 gap-3 pt-2 border-t border-border">
          <div>
            <Label>Tipo comisión</Label>
            <Select value={form.commission_type} onValueChange={v => setForm({ ...form, commission_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="porcentaje">% del total</SelectItem>
                <SelectItem value="monto_fijo">Monto fijo por venta</SelectItem>
                <SelectItem value="por_venta">Por venta concretada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.commission_type === 'porcentaje' ? (
            <div><Label>%</Label><Input type="number" step="0.1" value={form.commission_percent} onChange={e => setForm({ ...form, commission_percent: +e.target.value })} /></div>
          ) : (
            <div><Label>$ ARS</Label><Input type="number" value={form.commission_fixed_ars} onChange={e => setForm({ ...form, commission_fixed_ars: +e.target.value })} /></div>
          )}
          <div><Label>Estado</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="pausado">Pausado</SelectItem>
                <SelectItem value="baneado">Baneado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="col-span-2"><Label>Código de referido</Label><Input placeholder="auto si lo dejás vacío" value={form.referral_code} onChange={e => setForm({ ...form, referral_code: e.target.value })} /></div>
        <div className="col-span-2"><Label>Notas</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
      </div>
      <Button onClick={submit} className="w-full gradient-gold text-primary-foreground">Guardar</Button>
    </DialogContent>
  );
}

function SalesTab() {
  const [sales, setSales] = useState<any[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  useEffect(() => {
    (async () => {
      setSales(await listInfluencerSales());
      setInfluencers(await listInfluencers());
    })();
  }, []);
  const infMap = Object.fromEntries(influencers.map(i => [i.id, i.name]));
  const pending = sales.filter(s => !s.paid);
  const totalPending = pending.reduce((s, x) => s + Number(x.commission_ars), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <KPICard label="Ventas atribuidas" value={sales.length.toString()} icon={TrendingUp} />
        <KPICard label="Comisiones a pagar" value={fmt(totalPending)} icon={DollarSign} />
      </div>
      {sales.length === 0 ? <EmptyState icon={TrendingUp} title="Sin ventas con código aún" description="Cuando una venta use código de referido, aparecerá acá." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase"><tr>
              <th className="text-left p-3">Fecha</th><th className="text-left p-3">Influencer</th><th className="text-left p-3">Código</th><th className="text-right p-3">Venta</th><th className="text-right p-3">Comisión</th><th className="text-center p-3">Estado</th>
            </tr></thead>
            <tbody>
              {sales.map(s => (
                <tr key={s.id} className="border-t border-border">
                  <td className="p-3">{new Date(s.created_at).toLocaleDateString('es-AR')}</td>
                  <td className="p-3 font-medium">{infMap[s.influencer_id] || '—'}</td>
                  <td className="p-3 font-mono text-xs">{s.referral_code}</td>
                  <td className="p-3 text-right">{fmt(Number(s.sale_total_ars))}</td>
                  <td className="p-3 text-right text-success">{fmt(Number(s.commission_ars))}</td>
                  <td className="p-3 text-center"><Badge className={s.paid ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}>{s.paid ? 'Pagado' : 'Pendiente'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PayoutsTab() {
  const { user } = useAuth();
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [selInf, setSelInf] = useState('');
  const [pendingSales, setPendingSales] = useState<any[]>([]);

  const reload = async () => {
    setInfluencers(await listInfluencers());
    setPayouts(await listPayouts());
  };
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (!selInf) { setPendingSales([]); return; }
    listInfluencerSales(selInf).then(s => setPendingSales(s.filter((x: any) => !x.paid)));
  }, [selInf]);

  const total = pendingSales.reduce((s, x) => s + Number(x.commission_ars), 0);

  const submit = async () => {
    if (!selInf || pendingSales.length === 0) return toast.error('Sin comisiones pendientes');
    await createPayout(selInf, total, pendingSales.map(s => s.id), user!.id);
    toast.success('Liquidación registrada');
    setOpen(false); setSelInf(''); reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h3 className="text-lg font-semibold">Liquidaciones</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gradient-gold text-primary-foreground"><DollarSign className="w-4 h-4 mr-1" /> Nueva liquidación</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Liquidar comisiones</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Influencer</Label>
                <Select value={selInf} onValueChange={setSelInf}>
                  <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
                  <SelectContent>{influencers.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="p-3 rounded bg-muted text-sm">
                <div>Ventas pendientes: <strong>{pendingSales.length}</strong></div>
                <div>Total a pagar: <strong className="text-success">{fmt(total)}</strong></div>
              </div>
              <Button onClick={submit} className="w-full" disabled={!selInf || total === 0}>Confirmar pago</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {payouts.length === 0 ? <EmptyState icon={DollarSign} title="Sin liquidaciones" description="Generá tu primera liquidación cuando tengas comisiones acumuladas." /> : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase"><tr>
              <th className="text-left p-3">Fecha</th><th className="text-left p-3">Influencer</th><th className="text-right p-3">Ventas</th><th className="text-right p-3">Monto</th>
            </tr></thead>
            <tbody>
              {payouts.map(p => {
                const inf = influencers.find(i => i.id === p.influencer_id);
                return (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-3">{new Date(p.paid_at).toLocaleDateString('es-AR')}</td>
                    <td className="p-3">{inf?.name || '—'}</td>
                    <td className="p-3 text-right">{p.sales_count}</td>
                    <td className="p-3 text-right text-success font-semibold">{fmt(Number(p.amount_ars))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function InfluencersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Influencers Pro"
        description="Gestión completa de afiliados, comisiones, canjes y liquidaciones."
      />
      <Tabs defaultValue="influencers">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="influencers">Influencers</TabsTrigger>
          <TabsTrigger value="sales">Ventas con código</TabsTrigger>
          <TabsTrigger value="payouts">Liquidaciones</TabsTrigger>
          <TabsTrigger value="exchanges">Canjes</TabsTrigger>
        </TabsList>
        <TabsContent value="influencers"><InfluencersTab /></TabsContent>
        <TabsContent value="sales"><SalesTab /></TabsContent>
        <TabsContent value="payouts"><PayoutsTab /></TabsContent>
        <TabsContent value="exchanges"><InfluencerExchangesPage /></TabsContent>
      </Tabs>
    </div>
  );
}