import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { getPurchasesDB, addPurchaseDB, deletePurchaseDB, updatePurchaseDB, getProductsDB, getSettingsDB, getSalesAggregatedDB, formatARS, formatUSD, formatDateAR, dateToNoon } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ShoppingCart, ChevronLeft, ChevronRight, Edit, FileSpreadsheet, ClipboardList, RotateCcw, Loader2, Clock, CalendarClock, DollarSign, Package, TrendingDown, Search, Truck } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePermissions } from "@/lib/usePermissions";

const PAGE_SIZE = 20;

export default function PurchasesPage() {
  const { user } = useAuth();
  const { canCreate, canEdit, canDelete } = usePermissions();
  const [searchParams] = useSearchParams();
  const prefilledProduct = searchParams.get("product") || "";
  const [purchases, setPurchases] = useState<any[]>([]);
  const [open, setOpen] = useState(() => !!searchParams.get("product"));
  const [editItem, setEditItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [receivingOrder, setReceivingOrder] = useState<{ purchase: any; qty: string } | null>(null);
  const [receivingLoading, setReceivingLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [orderOpen, setOrderOpen] = useState(false);
  const reload = async () => { if (user) { setPurchases(await getPurchasesDB(user.id)); setLoading(false); } };
  useEffect(() => { reload(); }, [user]);

  const [tab, setTab] = useState<'all' | 'scheduled' | 'suppliers'>('all');
  const [search, setSearch] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('all');

  const supplierOptions = Array.from(new Set(purchases.map(p => p.supplier).filter(Boolean))).sort();

  const supplierStats = (() => {
    const map: Record<string, { totalUSD: number; totalARS: number; count: number; lastDate: string; products: Set<string> }> = {};
    purchases.filter(p => !p.is_scheduled).forEach(p => {
      const key = p.supplier || '(Sin proveedor)';
      if (!map[key]) map[key] = { totalUSD: 0, totalARS: 0, count: 0, lastDate: p.date, products: new Set() };
      map[key].totalUSD += Number(p.total_usd);
      map[key].totalARS += Number(p.total_ars);
      map[key].count += 1;
      if (p.date > map[key].lastDate) map[key].lastDate = p.date;
      if (p.product_name) map[key].products.add(p.product_name);
    });
    return Object.entries(map)
      .map(([name, s]) => ({ name, ...s, avgUSD: s.count > 0 ? s.totalUSD / s.count : 0, productCount: s.products.size }))
      .sort((a, b) => b.totalUSD - a.totalUSD);
  })();

  const filtered = purchases.filter(p => {
    if (tab === 'scheduled' && !p.is_scheduled) return false;
    if (tab === 'all' && p.is_scheduled) return false;
    if (search && !p.product_name?.toLowerCase().includes(search.toLowerCase()) && !p.supplier?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterSupplier !== 'all' && p.supplier !== filterSupplier) return false;
    if (!dateFrom) return true;
    const d = new Date(p.date);
    if (d < dateFrom) return false;
    if (dateTo) { const end = new Date(dateTo); end.setHours(23,59,59,999); if (d > end) return false; }
    return true;
  });
  const scheduledCount = purchases.filter(p => p.is_scheduled).length;
  const totalUSD = filtered.reduce((s, p) => s + Number(p.total_usd), 0);
  const totalARS = filtered.reduce((s, p) => s + Number(p.total_ars), 0);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportPurchasesCSV = () => {
    const header = ['Fecha', 'Producto', 'Proveedor', 'Cantidad', 'Costo USD', 'Total USD', 'Total ARS', 'Tipo'];
    const rows = filtered.map(p => [
      p.date,
      `"${(p.product_name || '').replace(/"/g, '""')}"`,
      `"${(p.supplier || '').replace(/"/g, '""')}"`,
      p.quantity,
      Number(p.cost_usd || 0).toFixed(2),
      Number(p.total_usd || 0).toFixed(2),
      Number(p.total_ars || 0).toFixed(2),
      p.is_scheduled ? 'Pedido' : 'Recibida',
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `compras_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} compras exportadas`);
  };

  const handleReceiveOrder = async () => {
    if (!receivingOrder) return;
    const { purchase: p, qty } = receivingOrder;
    const received = Number(qty);
    if (!received || received <= 0) { toast.error("Ingresá una cantidad válida"); return; }
    setReceivingLoading(true);
    try {
      await updatePurchaseDB(p.id, { is_scheduled: false, quantity: received, date: new Date().toISOString().slice(0, 10) });
      if (p.product_id) {
        const { data: prod } = await supabase.from('products').select('stock').eq('id', p.product_id).maybeSingle();
        if (prod) await supabase.from('products').update({ stock: (prod.stock || 0) + received }).eq('id', p.product_id);
      }
      if (user) await logAudit(user.id, 'update', 'purchase', p.id, { action: 'received', product: p.product_name, qty_received: received, qty_ordered: p.quantity });
      const partial = received < Number(p.quantity);
      toast.success(`${partial ? `Recepción parcial (${received}/${p.quantity} uds)` : 'Pedido recibido completo'} — stock actualizado`);
      setReceivingOrder(null);
      reload();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setReceivingLoading(false);
    }
  };

  const handleDelete = async (p: any) => {
    await deletePurchaseDB(p.id);
    if (user) await logAudit(user.id, 'delete', 'purchase', p.id, { product: p.product_name });
    reload();
    toast.success("Compra eliminada");
  };

  if (loading) return <TableSkeleton rows={6} cols={8} />;

  return (
    <div>
      <PageHeader
        icon={ShoppingCart}
        title="Compras"
        description="Registro de inventario y proveedores"
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); setPage(0); }} />
            {filtered.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportPurchasesCSV} title={`Exportar ${filtered.length} compras a CSV`}>
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />CSV
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setOrderOpen(true)}>
              <ClipboardList className="w-4 h-4 mr-1.5" />Orden de Compra
            </Button>
            {canCreate && (
              <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
                <DialogTrigger asChild>
                  <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nueva Compra</Button>
                </DialogTrigger>
                <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
                  <DialogHeader><DialogTitle className="font-display">{editItem ? 'Editar Compra' : 'Registrar Compra'}</DialogTitle></DialogHeader>
                  <PurchaseForm userId={user!.id} editItem={editItem} prefilledProductName={!editItem ? prefilledProduct : ""} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KPICard label="Total invertido USD" value={formatUSD(totalUSD)} icon={DollarSign} color="primary" sub={`${filtered.length} compras`} />
        <KPICard label="Total invertido ARS" value={formatARS(totalARS)} icon={TrendingDown} color="destructive" />
        <KPICard label="Prom. por compra" value={filtered.length > 0 ? formatUSD(totalUSD / filtered.length) : "$0"} icon={Package} color="blue" />
        <KPICard label="Programadas" value={scheduledCount} icon={CalendarClock} color="warning" sub="pendientes de concretar" />
      </div>

      {/* Tabs */}
      {/* Search + supplier filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Buscar producto o proveedor..."
            className="w-full pl-9 pr-3 h-9 text-sm rounded-lg bg-card border border-border outline-none focus:ring-1 focus:ring-primary/40 text-foreground placeholder:text-muted-foreground" />
        </div>
        {supplierOptions.length > 0 && (
          <Select value={filterSupplier} onValueChange={v => { setFilterSupplier(v); setPage(0); }}>
            <SelectTrigger className="bg-card border-border w-full sm:w-[180px] h-9 text-sm"><SelectValue placeholder="Todos los proveedores" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los proveedores</SelectItem>
              {supplierOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 border border-border w-fit mb-5">
        {([
          { id: 'all' as const, label: 'Realizadas', icon: ShoppingCart },
          { id: 'scheduled' as const, label: 'Programadas', icon: CalendarClock, count: scheduledCount },
          { id: 'suppliers' as const, label: 'Por Proveedor', icon: ClipboardList },
        ]).map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setPage(0); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-card border border-border shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t.label}</span>
            {'count' in t && t.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${tab === t.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Purchase Order Generator Dialog */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Generar Orden de Compra</DialogTitle></DialogHeader>
          <PurchaseOrderGenerator userId={user!.id} onDone={() => setOrderOpen(false)} />
        </DialogContent>
      </Dialog>

      {tab === 'suppliers' ? (
        supplierStats.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Sin compras registradas" description="Registrá compras con proveedor para ver el análisis aquí." />
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Proveedor</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compras</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Productos</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total USD</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Total ARS</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Prom. USD</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Última compra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {supplierStats.map((s, i) => (
                  <tr key={s.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-primary">{s.name.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <span className="font-medium text-sm">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{s.count}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">{s.productCount}</td>
                    <td className="px-4 py-3 text-right font-bold">{formatUSD(s.totalUSD)}</td>
                    <td className="px-4 py-3 text-right text-primary hidden lg:table-cell">{formatARS(s.totalARS)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">{formatUSD(s.avgUSD)}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden xl:table-cell">{formatDateAR(s.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/30">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-muted-foreground">{supplierStats.length} proveedores</td>
                  <td className="px-4 py-2 text-right text-xs font-bold">{formatUSD(supplierStats.reduce((s, x) => s + x.totalUSD, 0))}</td>
                  <td className="px-4 py-2 text-right text-xs font-bold text-primary hidden lg:table-cell">{formatARS(supplierStats.reduce((s, x) => s + x.totalARS, 0))}</td>
                  <td colSpan={2} className="hidden lg:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : !filtered.length ? (
        <EmptyState icon={ShoppingCart} title="No hay compras registradas" description="Registrá tu primera compra para llevar el control de tu inversión." actionLabel="Nueva Compra" onAction={() => setOpen(true)} />
      ) : (
        <>
          <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Producto</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Proveedor</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cant.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Unit.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total USD</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total ARS</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.map(p => (
                  <tr key={p.id} className="hover:bg-muted/20 transition-colors group">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateAR(p.date)}</td>
                    <td className="px-4 py-3 font-medium">
                      <span>{p.product_name}</span>
                      {p.is_scheduled && p.travel_status === 'en_camino' && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full font-semibold">
                          <Truck className="w-3 h-3" />En camino
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{p.supplier || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="bg-muted px-2 py-0.5 rounded text-xs font-medium">{p.quantity}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden xl:table-cell">{formatUSD(Number(p.unit_cost_usd))}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatUSD(Number(p.total_usd))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-primary">{formatARS(Number(p.total_ars))}</td>
                    {(canEdit || canDelete) && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canEdit && p.is_scheduled && p.travel_status !== 'en_camino' && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-blue-400 hover:text-blue-400 hover:bg-blue-400/10" title="Marcar como en camino" onClick={async () => { await updatePurchaseDB(p.id, { travel_status: 'en_camino' }); reload(); toast.success('Marcado como en camino'); }}>
                              <Truck className="w-3.5 h-3.5 mr-1" />En camino
                            </Button>
                          )}
                          {canEdit && p.is_scheduled && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-success hover:text-success hover:bg-success/10" title="Registrar recepción (puede ser parcial)" onClick={() => setReceivingOrder({ purchase: p, qty: String(p.quantity) })}>
                              <CalendarClock className="w-3.5 h-3.5 mr-1" />Recibido
                            </Button>
                          )}
                          {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(p); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>}
                          {canDelete && (
                            <ConfirmDialog
                              trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                              title="¿Eliminar compra?"
                              description={`Se eliminará la compra de ${p.product_name}.`}
                              confirmText="Eliminar"
                              onConfirm={() => handleDelete(p)}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {paged.map(p => (
              <div key={p.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{p.product_name}</p>
                    <p className="text-xs text-muted-foreground">{formatDateAR(p.date)} · {p.supplier || 'Sin proveedor'}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(p); setOpen(true); }}><Edit className="w-3 h-3" /></Button>}
                    {canDelete && (
                      <ConfirmDialog
                        trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3 h-3 text-destructive" /></Button>}
                        title="¿Eliminar compra?"
                        confirmText="Eliminar"
                        onConfirm={() => handleDelete(p)}
                      />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground block">Cant.</span><span>{p.quantity}</span></div>
                  <div><span className="text-muted-foreground block">Total USD</span><span className="font-medium">{formatUSD(Number(p.total_usd))}</span></div>
                  <div><span className="text-muted-foreground block">Total ARS</span><span className="font-medium">{formatARS(Number(p.total_ars))}</span></div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          )}
        </>
      )}

      {/* Partial receipt dialog */}
      <Dialog open={!!receivingOrder} onOpenChange={v => { if (!v) setReceivingOrder(null); }}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Registrar recepción</DialogTitle>
          </DialogHeader>
          {receivingOrder && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm">
                <p className="font-medium">{receivingOrder.purchase.product_name}</p>
                <p className="text-muted-foreground text-xs mt-0.5">Pedido: {receivingOrder.purchase.quantity} uds · {formatUSD(Number(receivingOrder.purchase.total_usd))}</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Cantidad recibida</label>
                <Input
                  type="number"
                  min="1"
                  max={receivingOrder.purchase.quantity}
                  value={receivingOrder.qty}
                  onChange={e => setReceivingOrder(r => r ? { ...r, qty: e.target.value } : null)}
                  className="bg-background"
                  autoFocus
                />
                {Number(receivingOrder.qty) < Number(receivingOrder.purchase.quantity) && Number(receivingOrder.qty) > 0 && (
                  <p className="text-xs text-warning">Recepción parcial — se actualizará el stock con {receivingOrder.qty} uds.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setReceivingOrder(null)}>Cancelar</Button>
                <Button className="flex-1 gradient-gold text-primary-foreground font-semibold" onClick={handleReceiveOrder} disabled={receivingLoading}>
                  {receivingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar recepción"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PurchaseForm({ userId, editItem, prefilledProductName, onSave }: { userId: string; editItem?: any; prefilledProductName?: string; onSave: () => void }) {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id;
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [productId, setProductId] = useState(editItem?.product_id || '');
  const [quantity, setQuantity] = useState(String(editItem?.quantity || '1'));
  const [exchangeRate, setExchangeRate] = useState(editItem ? String(editItem.exchange_rate) : '');
  const [supplier, setSupplier] = useState(editItem?.supplier || '');
  const [supplierId, setSupplierId] = useState(editItem?.supplier_id || '');
  const [date, setDate] = useState(editItem ? new Date(editItem.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [isScheduled, setIsScheduled] = useState(!!editItem?.is_scheduled);
  const [scheduledDate, setScheduledDate] = useState(editItem?.scheduled_date ? new Date(editItem.scheduled_date).toISOString().slice(0, 10) : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [createSupplierDebt, setCreateSupplierDebt] = useState(false);
  const [supplierDebtDueDate, setSupplierDebtDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [supplierDebtNotes, setSupplierDebtNotes] = useState("");

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([getProductsDB(userId), getSettingsDB(userId)]);
      setProducts(p); setSettings(s);
      setExchangeRate(String(s?.exchange_rate || 1695));
      if (prefilledProductName && !editItem) {
        const match = p.find((prod: any) => prod.name.toLowerCase().includes(prefilledProductName.toLowerCase()));
        if (match) setProductId(match.id);
      }
      if (orgId) {
        const { data } = await supabase.from("suppliers").select("id,name").eq("org_id", orgId).order("name");
        if (data) setSuppliers(data);

        if (editItem?.id) {
          const { data: existingDebt } = await supabase
            .from("supplier_debts")
            .select("due_date, notes")
            .eq("purchase_id", editItem.id)
            .maybeSingle();
          if (existingDebt) {
            setCreateSupplierDebt(true);
            if (existingDebt.due_date) setSupplierDebtDueDate(existingDebt.due_date);
            if (existingDebt.notes) setSupplierDebtNotes(existingDebt.notes);
          }
        }
      }
    })();
  }, [userId, orgId, editItem?.id]);

  const product = products.find(p => p.id === productId);
  const qty = parseInt(quantity) || 0;
  const unitCost = Number(product?.cost_usd || 0);
  const customsPercent = Number(settings?.customs_percent || 15);
  const customsFee = unitCost * qty * (customsPercent / 100);
  const totalUSD = unitCost * qty + customsFee;
  const rate = parseFloat(exchangeRate) || 0;
  const totalARS = totalUSD * rate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createSupplierDebt && isScheduled) { toast.error("La cuenta a pagar se crea cuando la compra ya estÃ¡ realizada"); return; }
    if (createSupplierDebt && !supplierId && !supplier.trim()) { toast.error("SeleccionÃ¡ un proveedor para registrar la cuenta a pagar"); return; }
    if (!productId || qty <= 0) { toast.error("Seleccioná producto y cantidad"); return; }
    const purchaseData: any = {
      product_id: productId, product_name: product!.name,
      quantity: qty, unit_cost_usd: unitCost, customs_fee: customsFee,
      total_usd: totalUSD, exchange_rate: rate, total_ars: totalARS, date: dateToNoon(date), supplier, supplier_id: supplierId || null,
      is_scheduled: isScheduled,
      scheduled_date: isScheduled ? dateToNoon(scheduledDate) : null,
      create_supplier_debt: !isScheduled && createSupplierDebt,
      supplier_debt_due_date: !isScheduled && createSupplierDebt ? supplierDebtDueDate || null : null,
      supplier_debt_notes: !isScheduled && createSupplierDebt ? supplierDebtNotes || null : null,
    };
    if (editItem) {
      await updatePurchaseDB(editItem.id, purchaseData, editItem);
      await logAudit(userId, 'update', 'purchase', editItem.id, { product: product!.name, totalUSD, qty, scheduled: isScheduled });
      toast.success(isScheduled ? "Compra programada actualizada" : "Compra actualizada");
    } else {
      await addPurchaseDB({ user_id: userId, ...purchaseData });
      await logAudit(userId, 'create', 'purchase', undefined, { product: product!.name, totalUSD, qty, scheduled: isScheduled });
      toast.success(isScheduled ? "Compra programada registrada (no descuenta stock)" : "Compra registrada");
    }
    onSave();
  };

  if (!settings) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between bg-muted/50 border border-border rounded-lg p-3">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Clock className="w-4 h-4 text-warning" />Compra programada</p>
          <p className="text-[11px] text-muted-foreground">No descuenta stock; aparece en el flujo de caja proyectado.</p>
        </div>
        <Switch checked={isScheduled} onCheckedChange={setIsScheduled} />
      </div>
      <div><label className="text-sm text-muted-foreground">Producto</label>
        <Select value={productId} onValueChange={setProductId}><SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({formatUSD(Number(p.cost_usd))})</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-sm text-muted-foreground">Cantidad</label><Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">TC (auto)</label><Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">{isScheduled ? 'Fecha registro' : 'Fecha'}</label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      {isScheduled && (
        <div>
          <label className="text-sm text-muted-foreground">Fecha programada (cuándo se concretará)</label>
          <Input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="bg-muted border-border mt-1" required />
        </div>
      )}
      <div>
        <label className="text-sm text-muted-foreground">Proveedor</label>
        {suppliers.length > 0 ? (
          <Select value={supplierId || '__none'} onValueChange={v => {
            if (v === '__none') { setSupplierId(''); setSupplier(''); }
            else {
              setSupplierId(v);
              const found = suppliers.find(s => s.id === v);
              if (found) setSupplier(found.name);
            }
          }}>
            <SelectTrigger className="bg-muted border-border mt-1"><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Sin proveedor</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Opcional" className="bg-muted border-border" />
        )}
      </div>
      <div className="flex items-center justify-between bg-muted/50 border border-border rounded-lg p-3">
        <div>
          <p className="text-sm font-medium">Registrar cuenta a pagar</p>
          <p className="text-[11px] text-muted-foreground">Vincula la compra con proveedores para seguir pagos pendientes.</p>
        </div>
        <Switch
          checked={createSupplierDebt}
          onCheckedChange={setCreateSupplierDebt}
          disabled={isScheduled || (!supplierId && !supplier.trim())}
        />
      </div>
      {createSupplierDebt && !isScheduled && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-muted-foreground">Vencimiento</label>
            <Input type="date" value={supplierDebtDueDate} onChange={e => setSupplierDebtDueDate(e.target.value)} className="bg-muted border-border" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Nota</label>
            <Input value={supplierDebtNotes} onChange={e => setSupplierDebtNotes(e.target.value)} placeholder="Opcional" className="bg-muted border-border" />
          </div>
        </div>
      )}
      {product && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm animate-in fade-in duration-200">
          <div className="flex justify-between"><span className="text-muted-foreground">Costo unitario:</span><span>{formatUSD(unitCost)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal ({qty} uds):</span><span>{formatUSD(unitCost * qty)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">+{customsPercent}% Pasero:</span><span className="text-warning">{formatUSD(customsFee)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total USD:</span><span>{formatUSD(totalUSD)}</span></div>
          <div className="flex justify-between font-bold"><span>Total ARS:</span><span className="text-primary">{formatARS(totalARS)}</span></div>
          <div className="flex justify-between text-xs border-t border-border pt-1"><span className="text-muted-foreground">Costo/u con pasero:</span><span>{formatUSD(qty > 0 ? totalUSD / qty : 0)}</span></div>
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">{editItem ? 'Actualizar Compra' : 'Registrar Compra'}</Button>
    </form>
  );
}

function PurchaseOrderGenerator({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [orders, setOrders] = useState<Record<string, { qty: number; supplier: string }>>({});
  const [loading, setLoading] = useState(true);
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockDays, setRestockDays] = useState(30);

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([getProductsDB(userId), getSettingsDB(userId)]);
      setProducts(p);
      setSettings(s);
      const initial: Record<string, { qty: number; supplier: string }> = {};
      p.forEach((prod: any) => { initial[prod.id] = { qty: 0, supplier: '' }; });
      setOrders(initial);
      setLoading(false);
    })();
  }, [userId]);

  const updateOrder = (id: string, field: 'qty' | 'supplier', value: any) => {
    setOrders(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const selectedProducts = products.filter(p => (orders[p.id]?.qty || 0) > 0);

  const generateExcel = async () => {
    if (!selectedProducts.length) { toast.error('Seleccioná al menos un producto'); return; }
    const { utils, writeFile } = await import('xlsx');
    const wb = utils.book_new();
    const businessName = settings?.business_name || 'EXENTRY IMPORTS';

    const bySupplier: Record<string, any[]> = {};
    selectedProducts.forEach(p => {
      const supplier = orders[p.id]?.supplier?.trim() || 'Sin proveedor';
      (bySupplier[supplier] = bySupplier[supplier] || []).push(p);
    });

    for (const [supplier, prods] of Object.entries(bySupplier)) {
      const rows = prods.map(p => ({
        'Producto': p.name,
        'Cantidad': orders[p.id]?.qty || 0,
        'Costo Unit. USD (con pasero)': Number(p.total_cost_usd),
        'Total USD': (orders[p.id]?.qty || 0) * Number(p.total_cost_usd),
      }));
      const totalUSD = rows.reduce((s, r) => s + r['Total USD'], 0);
      rows.push({ 'Producto': 'TOTAL', 'Cantidad': rows.reduce((s, r) => s + r['Cantidad'], 0), 'Precio Unit. USD': 0, 'Total USD': totalUSD, 'Costo Unit. USD (con pasero)': 0 });

      const ws = utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 35 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
      utils.book_append_sheet(wb, ws, supplier.substring(0, 31));
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    writeFile(wb, `orden_compra_${businessName.replace(/\s+/g, '_')}_${dateStr}.xlsx`);
    toast.success('Orden de compra generada');
    onDone();
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Cargando productos...</div>;

  const handlePreloadRestock = async () => {
    setRestockLoading(true);
    try {
      const agg = await getSalesAggregatedDB(userId, restockDays);
      if (!agg.length) { toast.info('No hay ventas en el período seleccionado'); setRestockLoading(false); return; }
      const newOrders = { ...orders };
      agg.forEach(item => {
        if (newOrders[item.product_id]) {
          newOrders[item.product_id] = { ...newOrders[item.product_id], qty: item.total_qty };
        }
      });
      setOrders(newOrders);
      toast.success(`Pre-cargado: ${agg.length} productos basado en ventas de ${restockDays} días`);
    } catch (err) {
      toast.error('Error al cargar datos de ventas');
    }
    setRestockLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Seleccioná los productos y cantidades para generar el Excel de orden de compra.</p>

      {/* Auto-restock section */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
        <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
          <RotateCcw className="w-3.5 h-3.5" /> Recompra automática
        </p>
        <p className="text-[11px] text-muted-foreground">Pre-carga las cantidades vendidas en un período para reponerlas.</p>
        <div className="flex items-center gap-2">
          <Select value={String(restockDays)} onValueChange={v => setRestockDays(Number(v))}>
            <SelectTrigger className="w-32 h-8 text-xs bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 días</SelectItem>
              <SelectItem value="15">Últimos 15 días</SelectItem>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="60">Últimos 60 días</SelectItem>
              <SelectItem value="90">Últimos 90 días</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handlePreloadRestock} disabled={restockLoading} className="text-xs h-8">
            {restockLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
            Pre-cargar recompra
          </Button>
        </div>
      </div>

      <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
        {products.map(p => (
          <div key={p.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${(orders[p.id]?.qty || 0) > 0 ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{p.name}</p>
              <p className="text-[10px] text-muted-foreground">Stock: {p.stock} · {formatUSD(Number(p.total_cost_usd))}/u (costo total)</p>
            </div>
            <Input
              type="text"
              placeholder="Proveedor"
              value={orders[p.id]?.supplier || ''}
              onChange={e => updateOrder(p.id, 'supplier', e.target.value)}
              className="w-28 h-8 text-xs bg-background border-border"
            />
            <Input
              type="number"
              min="0"
              value={orders[p.id]?.qty || ''}
              onChange={e => updateOrder(p.id, 'qty', parseInt(e.target.value) || 0)}
              placeholder="0"
              className="w-16 h-8 text-xs bg-background border-border text-center"
            />
          </div>
        ))}
      </div>

      {selectedProducts.length > 0 && (
        <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Productos:</span><span className="font-medium">{selectedProducts.length}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Unidades:</span><span className="font-medium">{selectedProducts.reduce((s, p) => s + (orders[p.id]?.qty || 0), 0)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1">
            <span>Total USD (con pasero):</span>
            <span>{formatUSD(selectedProducts.reduce((s, p) => s + (orders[p.id]?.qty || 0) * Number(p.total_cost_usd), 0))}</span>
          </div>
        </div>
      )}

      <Button onClick={generateExcel} className="w-full gradient-gold text-primary-foreground font-semibold" disabled={!selectedProducts.length}>
        <FileSpreadsheet className="w-4 h-4 mr-2" />
        Generar Excel ({selectedProducts.length} productos)
      </Button>
    </div>
  );
}
