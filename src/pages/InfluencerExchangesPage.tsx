import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSettingsDB, formatARS } from "@/lib/supabaseStore";
import { getExchangesDB, addExchangeDB, updateExchangeDB, deleteExchangeDB, generateInfluencerCode, formatARS as _fmt } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Gift, Instagram, Users, BarChart3, CheckCircle, Edit, FileSpreadsheet, TrendingUp, DollarSign, Target, Megaphone, Copy, Tag, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
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

  const [syncing, setSyncing] = useState(false);

  const handleSyncCosts = async () => {
    const exchangesWithProduct = exchanges.filter(e => e.product_id);
    if (!exchangesWithProduct.length) { toast.info('No hay canjes con producto vinculado'); return; }
    setSyncing(true);
    try {
      const [allProducts, settings] = await Promise.all([
        getProductsDB(user!.id),
        getSettingsDB(user!.id),
      ]);
      const productMap: Record<string, any> = {};
      for (const p of allProducts) productMap[p.id] = p;
      const rate = Number(settings?.exchange_rate || 1200);

      let updated = 0;
      await Promise.all(exchangesWithProduct.map(async (ex) => {
        const p = productMap[ex.product_id];
        if (!p) return;
        const costUSD = Number(p.total_cost_usd || 0);
        const newCostPerUnit = costUSD > 0
          ? costUSD * rate
          : Number(p.sale_price_ars || 0) * 0.4;
        if (newCostPerUnit <= 0) return;
        const current = Number(ex.product_value_ars || 0);
        if (Math.abs(current - newCostPerUnit) < 1) return; // already up to date
        await updateExchangeDB(ex.id, { product_value_ars: newCostPerUnit });
        updated++;
      }));

      await reload();
      if (updated > 0) {
        toast.success(`${updated} canje${updated > 1 ? 's' : ''} actualizado${updated > 1 ? 's' : ''} al costo actual`);
      } else {
        toast.info('Todos los canjes ya tienen el costo actualizado');
      }
    } catch (err: any) {
      toast.error('Error al sincronizar: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <TableSkeleton rows={6} cols={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Gift}
        title="Canjes & Influencers"
        description="Gestión de canjes, regalos y colaboraciones con influencers"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSyncCosts} disabled={syncing} title="Recalcula product_value_ars de todos los canjes según el costo USD actual del producto">
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Actualizando...' : 'Sincronizar costos'}
            </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
            <DialogTrigger asChild>
              <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo Canje</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display">{editItem ? 'Editar Canje' : 'Registrar Canje'}</DialogTitle></DialogHeader>
              <ExchangeForm userId={user!.id} editItem={editItem} existingExchanges={exchanges} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Inversión (costo)" value={formatARS(totalInversion)} icon={Target} sub="Lo que realmente costó" />
        <KPICard label="Ventas generadas" value={totalSalesGenerated > 0 ? formatARS(totalSalesGenerated) : "Sin datos"} icon={DollarSign} sub={roiPct !== null ? `ROI ${roiPct > 0 ? '+' : ''}${roiPct.toFixed(0)}%` : "Cargá ventas atribuidas"} />
        <KPICard label="Cumplimiento" value={`${fulfillmentRate.toFixed(0)}%`} icon={CheckCircle} sub={`${totalActual}/${totalExpected} posts · ${uniqueInfluencers} influencers`} />
        <KPICard label="CPM" value={cpm !== null ? formatARS(cpm) : "—"} icon={Megaphone} sub={`${(totalReach / 1000).toFixed(1)}K alcance estimado`} />
      </div>

      {/* ROI chart — only when there are exchanges with sales data */}
      {exchanges.filter(e => Number(e.sales_generated_ars || 0) > 0).length > 0 && (() => {
        const chartData = exchanges
          .filter(e => Number(e.product_value_ars) * e.quantity > 0)
          .map(e => {
            const inv = Number(e.product_value_ars) * e.quantity;
            const sales = Number(e.sales_generated_ars || 0);
            const roi = inv > 0 && sales > 0 ? ((sales - inv) / inv * 100) : 0;
            return { name: e.influencer_name.split(' ')[0], roi: parseFloat(roi.toFixed(1)), inv, sales };
          })
          .sort((a, b) => b.roi - a.roi)
          .slice(0, 8);
        return (
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" />ROI por Influencer (%)</h3>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'ROI']} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 11 }} />
                <Bar dataKey="roi" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.roi >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

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
                  <th className="text-center p-3 font-medium">Código</th>
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
                      <td className="p-3 text-center">
                        {ex.discount_code ? (
                          <button
                            className="flex items-center gap-1 mx-auto px-2 py-1 rounded bg-muted hover:bg-primary/10 border border-border hover:border-primary/40 transition-colors group"
                            title="Copiar código"
                            onClick={() => { navigator.clipboard.writeText(ex.discount_code); toast.success(`Código ${ex.discount_code} copiado`); }}
                          >
                            <Tag className="w-3 h-3 text-primary shrink-0" />
                            <span className="text-[11px] font-mono font-semibold text-primary">{ex.discount_code}</span>
                            <Copy className="w-2.5 h-2.5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </td>
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

function ExchangeForm({ userId, editItem, existingExchanges = [], onSave }: { userId: string; editItem?: any; existingExchanges?: any[]; onSave: () => void }) {
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
  const [discountCode, setDiscountCode] = useState(editItem?.discount_code || '');
  const [saving, setSaving] = useState(false);

  // Unique influencers from previous exchanges (for the quick-picker)
  // Each influencer keeps ONE discount code across all their canjes
  const knownInfluencers: { name: string; ig: string; followers: string; code: string }[] = useMemo(() => {
    // Sort by created_at desc so the first match per influencer is the most recent data
    const sorted = [...existingExchanges].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const seen = new Map<string, { name: string; ig: string; followers: string; code: string }>();
    for (const ex of sorted) {
      const key = ex.influencer_name?.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.set(key, {
          name: ex.influencer_name,
          ig: ex.influencer_instagram || '',
          followers: String(ex.influencer_followers || ''),
          // Reuse their existing code — if none, generate one now
          code: ex.discount_code || generateInfluencerCode(ex.influencer_name),
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [existingExchanges]);

  const handlePickInfluencer = (name: string) => {
    const inf = knownInfluencers.find(i => i.name === name);
    if (!inf) return;
    setInfluencerName(inf.name);
    setInfluencerIg(inf.ig);
    setInfluencerFollowers(inf.followers);
    // Always reuse the same code — one code per influencer across all canjes
    setDiscountCode(inf.code);
  };

  // Auto-generate code when influencer name is set (new form only)
  useEffect(() => {
    if (!editItem && influencerName.trim().length >= 2 && !discountCode) {
      setDiscountCode(generateInfluencerCode(influencerName));
    }
  }, [influencerName]);

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
          discount_code: discountCode.trim().toUpperCase() || null,
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
          discount_code: discountCode.trim().toUpperCase() || null,
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

      {/* ── Influencer existente (quick-fill) ── */}
      {!editItem && knownInfluencers.length > 0 && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
          <label className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Users className="w-3.5 h-3.5" /> Nuevo canje con influencer existente
          </label>
          <div className="flex flex-wrap gap-2">
            {knownInfluencers.map(inf => (
              <button
                key={inf.name}
                type="button"
                onClick={() => handlePickInfluencer(inf.name)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  influencerName === inf.name
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {inf.name}
                {inf.ig && <span className="ml-1 opacity-60">{inf.ig}</span>}
              </button>
            ))}
          </div>
          {influencerName && knownInfluencers.some(i => i.name === influencerName) && (
            <p className="text-[10px] text-primary/70 mt-2">
              Datos auto-completados · código reutilizado — el influencer conserva su mismo código en todos sus canjes
            </p>
          )}
        </div>
      )}

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
        <Textarea value={goalNotes} onChange={e => setGoalNotes(e.target.value)} placeholder="Ej: Aumentar awareness de perfume árabe, meta 5K impresiones" rows={2} className="bg-muted border-border resize-none" />
      </div>
      <div>
        <label className="text-sm text-muted-foreground flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-primary" />Código de descuento para rastrear ventas</label>
        <div className="flex gap-2 mt-1">
          <Input
            value={discountCode}
            onChange={e => setDiscountCode(e.target.value.toUpperCase())}
            placeholder="INF-NOMBRE-XXXX"
            className="bg-muted border-border font-mono uppercase"
          />
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setDiscountCode(generateInfluencerCode(influencerName || 'INF'))}>
            Regenerar
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">El influencer comparte este código. Al usarlo en POS o Ventas, la venta se atribuye automáticamente.</p>
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
