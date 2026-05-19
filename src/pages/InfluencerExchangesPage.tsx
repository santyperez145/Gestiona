import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSettingsDB, formatARS } from "@/lib/supabaseStore";
import { getExchangesDB, addExchangeDB, updateExchangeDB, deleteExchangeDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Gift, Instagram, Users, BarChart3, CheckCircle, Edit, FileSpreadsheet, TrendingUp, DollarSign, Target, Megaphone } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import KPICard from "@/components/shared/KPICard";
import { logAudit } from "@/lib/auditLog";
import { listExchangeConfigs, ExchangeConfig } from "@/lib/marketingExtraDB";

export default function InfluencerExchangesPage() {
  const { user } = useAuth();
  const [exchanges, setExchanges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [statusConfigs, setStatusConfigs] = useState<ExchangeConfig[]>([]);
  const [typeConfigs, setTypeConfigs] = useState<ExchangeConfig[]>([]);

  const STATUS_MAP = useMemo(() => {
    const m: Record<string, { label: string; class: string }> = {};
    statusConfigs.forEach(s => { m[s.code] = { label: s.label, class: s.color_class }; });
    return m;
  }, [statusConfigs]);
  const TYPE_MAP = useMemo(() => {
    const m: Record<string, string> = {};
    typeConfigs.forEach(t => { m[t.code] = t.label; });
    return m;
  }, [typeConfigs]);

  const reload = async () => {
    if (user) { setExchanges(await getExchangesDB(user.id)); setLoading(false); }
  };
  useEffect(() => {
    reload();
    listExchangeConfigs('status').then(setStatusConfigs).catch(() => {});
    listExchangeConfigs('type').then(setTypeConfigs).catch(() => {});
  }, [user]);

  const filtered = exchanges.filter(e => {
    if (filter !== 'all' && e.status !== filter) return false;
    if (search && !e.influencer_name.toLowerCase().includes(search.toLowerCase()) && !e.product_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // product_value_ars now stores COST (investment), not sale price
  const totalInversion = exchanges.reduce((s, e) => s + Number(e.product_value_ars) * e.quantity, 0);
  const totalSalesGenerated = exchanges.reduce((s, e) => s + Number(e.sales_generated_ars || 0), 0);
  const totalReach = exchanges.reduce((s, e) => s + (e.influencer_followers || 0) * (e.actual_posts || e.expected_posts || 1), 0);
  const totalExpected = exchanges.reduce((s, e) => s + (e.expected_posts || 0), 0);
  const totalActual = exchanges.reduce((s, e) => s + (e.actual_posts || 0), 0);
  const fulfillmentRate = totalExpected > 0 ? (totalActual / totalExpected * 100) : 0;
  const uniqueInfluencers = new Set(exchanges.map(e => e.influencer_instagram || e.influencer_name)).size;
  const roiPct = totalInversion > 0 && totalSalesGenerated > 0 ? ((totalSalesGenerated - totalInversion) / totalInversion * 100) : null;
  const cpm = totalReach > 0 && totalInversion > 0 ? (totalInversion / totalReach * 1000) : null;

  const handleDelete = async (ex: any) => {
    await deleteExchangeDB(ex.id);
    if (user) await logAudit(user.id, 'delete', 'exchange', ex.id, { influencer: ex.influencer_name, product: ex.product_name });
    reload();
    toast.success("Canje eliminado");
  };

  const handleUpdateStatus = async (ex: any, newStatus: string) => {
    const updates: any = { status: newStatus };
    if (newStatus === 'publicado' && ex.actual_posts === 0) updates.actual_posts = 1;
    await updateExchangeDB(ex.id, updates);
    reload();
    toast.success(`Estado actualizado a ${STATUS_MAP[newStatus]?.label}`);
  };

  const handleUpdatePosts = async (ex: any, posts: number) => {
    await updateExchangeDB(ex.id, { actual_posts: posts });
    reload();
  };

  if (loading) return <TableSkeleton rows={6} cols={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Gift}
        title="Canjes & Influencers"
        description="Gestión de canjes, regalos y colaboraciones con influencers"
        actions={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
            <DialogTrigger asChild>
              <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo Canje</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display">{editItem ? 'Editar Canje' : 'Registrar Canje'}</DialogTitle></DialogHeader>
              <ExchangeForm userId={user!.id} editItem={editItem} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
            </DialogContent>
          </Dialog>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Inversión (costo)" value={formatARS(totalInversion)} icon={Target} sub="Lo que realmente costó" />
        <KPICard label="Ventas generadas" value={totalSalesGenerated > 0 ? formatARS(totalSalesGenerated) : "Sin datos"} icon={DollarSign} sub={roiPct !== null ? `ROI ${roiPct > 0 ? '+' : ''}${roiPct.toFixed(0)}%` : "Cargá ventas atribuidas"} />
        <KPICard label="Cumplimiento" value={`${fulfillmentRate.toFixed(0)}%`} icon={CheckCircle} sub={`${totalActual}/${totalExpected} posts · ${uniqueInfluencers} influencers`} />
        <KPICard label="CPM" value={cpm !== null ? formatARS(cpm) : "—"} icon={Megaphone} sub={`${(totalReach / 1000).toFixed(1)}K alcance estimado`} />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input placeholder="Buscar influencer o producto..." value={search} onChange={e => setSearch(e.target.value)} className="bg-muted border-border sm:max-w-xs" />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="bg-muted border-border w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {statusConfigs.map(s => (
              <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="ml-auto whitespace-nowrap" onClick={() => {
          const header = "Influencer,Instagram,Seguidores,Producto,Tipo,Cantidad,Valor ARS,Posts esperados,Posts reales,Estado,Fecha\n";
          const rows = filtered.map(ex => [
            ex.influencer_name, ex.influencer_instagram || '', ex.influencer_followers || 0,
            ex.product_name, TYPE_MAP[ex.exchange_type] || ex.exchange_type || '', ex.quantity,
            Number(ex.product_value_ars) * ex.quantity,
            ex.expected_posts || 0, ex.actual_posts || 0,
            STATUS_MAP[ex.status]?.label || ex.status,
            ex.created_at ? ex.created_at.slice(0, 10) : '',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = "canjes_influencers.csv"; a.click();
          URL.revokeObjectURL(url);
        }}>
          <FileSpreadsheet className="w-4 h-4 mr-2" />CSV
        </Button>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Gift} title="No hay canjes registrados" description="Registrá tu primer canje con influencers para comenzar a trackear el ROI." actionLabel="Nuevo Canje" onAction={() => setOpen(true)} />
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">Influencer</th>
                  <th className="text-left p-3 font-medium">Producto</th>
                  <th className="text-center p-3 font-medium">Tipo</th>
                  <th className="text-right p-3 font-medium">Inversión</th>
                  <th className="text-right p-3 font-medium">Ventas atr.</th>
                  <th className="text-center p-3 font-medium">Posts</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                  <th className="text-center p-3 font-medium">ROI</th>
                  <th className="text-center p-3 font-medium">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(ex => {
                  const inversion = Number(ex.product_value_ars) * ex.quantity;
                  const salesAtr = Number(ex.sales_generated_ars || 0);
                  const roi = inversion > 0 && salesAtr > 0 ? ((salesAtr - inversion) / inversion * 100) : null;
                  return (
                    <tr key={ex.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <p className="font-medium">{ex.influencer_name}</p>
                        {ex.influencer_instagram && <p className="text-xs text-muted-foreground flex items-center gap-1"><Instagram className="w-3 h-3" />@{ex.influencer_instagram}</p>}
                        {ex.influencer_followers > 0 && <p className="text-[10px] text-muted-foreground">{ex.influencer_followers.toLocaleString()} seg.</p>}
                      </td>
                      <td className="p-3">
                        <p>{ex.product_name}</p>
                        <p className="text-xs text-muted-foreground">x{ex.quantity}</p>
                      </td>
                      <td className="p-3 text-center"><span className="text-xs">{TYPE_MAP[ex.exchange_type] || ex.exchange_type}</span></td>
                      <td className="p-3 text-right font-medium text-warning">{formatARS(inversion)}</td>
                      <td className="p-3 text-right">
                        <Input
                          type="number" min="0"
                          className="w-24 h-7 text-xs text-right bg-muted border-border"
                          value={ex.sales_generated_ars || ""}
                          placeholder="0"
                          onChange={e => updateExchangeDB(ex.id, { sales_generated_ars: parseFloat(e.target.value) || 0 }).then(reload)}
                        />
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Input type="number" min="0" className="w-12 h-7 text-xs text-center bg-muted border-border p-0" value={ex.actual_posts} onChange={e => handleUpdatePosts(ex, parseInt(e.target.value) || 0)} />
                          <span className="text-xs text-muted-foreground">/ {ex.expected_posts}</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <Select value={ex.status} onValueChange={v => handleUpdateStatus(ex, v)}>
                          <SelectTrigger className="h-7 text-xs w-28 mx-auto border-0 bg-transparent p-1">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_MAP[ex.status]?.class}`}>{STATUS_MAP[ex.status]?.label}</span>
                          </SelectTrigger>
                          <SelectContent>
                            {statusConfigs.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3 text-center">
                        {roi !== null
                          ? <span className={`text-xs font-semibold ${roi >= 0 ? 'text-success' : 'text-destructive'}`}>{roi >= 0 ? '+' : ''}{roi.toFixed(0)}%</span>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(ex); setOpen(true); }}>
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                            title="¿Eliminar canje?"
                            description={`Se eliminará el canje con ${ex.influencer_name}.`}
                            confirmText="Eliminar"
                            onConfirm={() => handleDelete(ex)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {filtered.map(ex => {
              const value = Number(ex.product_value_ars) * ex.quantity;
              return (
                <div key={ex.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">{ex.influencer_name}</p>
                      {ex.influencer_instagram && <p className="text-xs text-muted-foreground flex items-center gap-1"><Instagram className="w-3 h-3" />@{ex.influencer_instagram}</p>}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_MAP[ex.status]?.class}`}>{STATUS_MAP[ex.status]?.label}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                    <div><span className="text-muted-foreground block">Producto</span><span>{ex.product_name}</span></div>
                    <div><span className="text-muted-foreground block">Valor</span><span className="font-medium">{formatARS(value)}</span></div>
                    <div><span className="text-muted-foreground block">Posts</span><span>{ex.actual_posts}/{ex.expected_posts}</span></div>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => { setEditItem(ex); setOpen(true); }}><Edit className="w-3 h-3 mr-1" />Editar</Button>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm" className="h-7 text-destructive"><Trash2 className="w-3 h-3" /></Button>}
                      title="¿Eliminar canje?"
                      confirmText="Eliminar"
                      onConfirm={() => handleDelete(ex)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ExchangeForm({ userId, editItem, onSave }: { userId: string; editItem?: any; onSave: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [productId, setProductId] = useState(editItem?.product_id || '');
  const [quantity, setQuantity] = useState(String(editItem?.quantity || 1));
  const [influencerName, setInfluencerName] = useState(editItem?.influencer_name || '');
  const [influencerIg, setInfluencerIg] = useState(editItem?.influencer_instagram || '');
  const [influencerFollowers, setInfluencerFollowers] = useState(String(editItem?.influencer_followers || ''));
  const [exchangeType, setExchangeType] = useState(editItem?.exchange_type || 'canje');
  const [expectedPosts, setExpectedPosts] = useState(String(editItem?.expected_posts || 1));
  const [notes, setNotes] = useState(editItem?.notes || '');
  const [goalNotes, setGoalNotes] = useState(editItem?.goal_notes || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProductsDB(userId).then(setProducts);
    getSettingsDB(userId).then(setSettings);
  }, [userId]);

  const product = products.find(p => p.id === productId);
  const qty = parseInt(quantity) || 1;
  const exchangeRate = settings?.exchange_rate || 1200;
  // Investment = cost (what we paid), not sale price
  const costUSD = product ? Number(product.total_cost_usd || 0) : 0;
  const investmentARS = costUSD > 0 ? costUSD * exchangeRate * qty : (product ? Number(product.sale_price_ars) * 0.4 * qty : 0);
  const saleValueARS = product ? Number(product.sale_price_ars) * qty : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!influencerName.trim()) { toast.error("Ingresá el nombre del influencer"); return; }
    if (!productId) { toast.error("Seleccioná un producto"); return; }
    if (!editItem && product && qty > product.stock) { toast.error(`Stock insuficiente (${product.stock})`); return; }

    setSaving(true);
    try {
      if (editItem) {
        await updateExchangeDB(editItem.id, {
          influencer_name: influencerName.trim(),
          influencer_instagram: influencerIg.trim() || null,
          influencer_followers: parseInt(influencerFollowers) || 0,
          product_id: productId, product_name: product!.name,
          quantity: qty, product_value_ars: investmentARS / qty,
          exchange_type: exchangeType, expected_posts: parseInt(expectedPosts) || 1,
          notes: notes.trim() || null,
          goal_notes: goalNotes.trim() || null,
        });
        toast.success("Canje actualizado");
      } else {
        await addExchangeDB({
          user_id: userId,
          influencer_name: influencerName.trim(),
          influencer_instagram: influencerIg.trim() || null,
          influencer_followers: parseInt(influencerFollowers) || 0,
          product_id: productId, product_name: product!.name,
          quantity: qty, product_value_ars: investmentARS / qty,
          exchange_type: exchangeType, expected_posts: parseInt(expectedPosts) || 1,
          notes: notes.trim() || null,
          goal_notes: goalNotes.trim() || null,
        });
        await logAudit(userId, 'create', 'exchange', undefined, { influencer: influencerName, product: product!.name, qty });
        toast.success("Canje registrado — stock descontado");
      }
      onSave();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="text-sm text-muted-foreground">Nombre del Influencer *</label>
          <Input value={influencerName} onChange={e => setInfluencerName(e.target.value)} placeholder="Nombre" className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Instagram</label>
          <Input value={influencerIg} onChange={e => setInfluencerIg(e.target.value)} placeholder="@usuario" className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Seguidores</label>
          <Input type="number" value={influencerFollowers} onChange={e => setInfluencerFollowers(e.target.value)} placeholder="0" className="bg-muted border-border" /></div>
      </div>
      <div><label className="text-sm text-muted-foreground">Producto *</label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>{products.filter(p => editItem || p.stock > 0).map(p => <SelectItem key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-sm text-muted-foreground">Cantidad</label>
          <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Tipo</label>
          <Select value={exchangeType} onValueChange={setExchangeType}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="canje">Canje</SelectItem>
              <SelectItem value="regalo">Regalo</SelectItem>
              <SelectItem value="colaboracion">Colaboración</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><label className="text-sm text-muted-foreground">Posts esperados</label>
          <Input type="number" min="0" value={expectedPosts} onChange={e => setExpectedPosts(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      <div><label className="text-sm text-muted-foreground">Notas</label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Detalles del acuerdo..." className="bg-muted border-border" /></div>
      <div><label className="text-sm text-muted-foreground">Objetivo de campaña</label>
        <Textarea value={goalNotes} onChange={e => setGoalNotes(e.target.value)} placeholder="Ej: Aumentar awareness de perfume árabe, meta 5K impresiones, código INFLUENCER10" rows={2} className="bg-muted border-border resize-none" />
      </div>
      {product && (
        <div className="bg-muted rounded-lg p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Inversión (costo real):</span>
            <span className="font-bold text-warning">{formatARS(investmentARS)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Valor de venta (referencia):</span>
            <span className="text-muted-foreground">{formatARS(saleValueARS)}</span>
          </div>
          {costUSD === 0 && (
            <p className="text-[11px] text-muted-foreground/60">⚠ Sin costo USD en producto — estimando 40% del precio de venta</p>
          )}
        </div>
      )}
      <Button type="submit" disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">
        {saving ? 'Guardando...' : editItem ? 'Actualizar Canje' : 'Registrar Canje'}
      </Button>
    </form>
  );
}
