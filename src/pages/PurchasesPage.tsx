import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { getPurchasesDB, addPurchaseDB, deletePurchaseDB, updatePurchaseDB, getProductsDB, getSettingsDB, getSalesAggregatedDB, formatARS, formatUSD, formatDateAR, dateToNoon } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ShoppingCart, ChevronLeft, ChevronRight, Edit, FileSpreadsheet, ClipboardList, RotateCcw, Loader2, Clock, CalendarClock, DollarSign, Package, TrendingDown } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

const PAGE_SIZE = 20;

export default function PurchasesPage() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [orderOpen, setOrderOpen] = useState(false);
  const reload = async () => { if (user) { setPurchases(await getPurchasesDB(user.id)); setLoading(false); } };
  useEffect(() => { reload(); }, [user]);

  const [tab, setTab] = useState<'all' | 'scheduled'>('all');
  const filtered = purchases.filter(p => {
    if (tab === 'scheduled' && !p.is_scheduled) return false;
    if (tab === 'all' && p.is_scheduled) return false;
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
            <Button variant="outline" size="sm" onClick={() => setOrderOpen(true)}>
              <ClipboardList className="w-4 h-4 mr-1.5" />Orden de Compra
            </Button>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
              <DialogTrigger asChild>
                <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nueva Compra</Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="font-display">{editItem ? 'Editar Compra' : 'Registrar Compra'}</DialogTitle></DialogHeader>
                <PurchaseForm userId={user!.id} editItem={editItem} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
              </DialogContent>
            </Dialog>
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
      <div className="flex bg-card border border-border rounded-lg p-1 gap-1 w-fit mb-5">
        {([["all", "Realizadas"], ["scheduled", `Programadas`]] as const).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); setPage(0); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "scheduled" && <CalendarClock className="w-3.5 h-3.5" />}
            {label}
            {t === "scheduled" && scheduledCount > 0 && <span className="text-[10px] bg-white/20 px-1.5 rounded-full">{scheduledCount}</span>}
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

      {!filtered.length ? (
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
                    <td className="px-4 py-3 font-medium">{p.product_name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{p.supplier || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="bg-muted px-2 py-0.5 rounded text-xs font-medium">{p.quantity}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground hidden xl:table-cell">{formatUSD(Number(p.unit_cost_usd))}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatUSD(Number(p.total_usd))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-primary">{formatARS(Number(p.total_ars))}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(p); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>
                        <ConfirmDialog
                          trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                          title="¿Eliminar compra?"
                          description={`Se eliminará la compra de ${p.product_name}.`}
                          confirmText="Eliminar"
                          onConfirm={() => handleDelete(p)}
                        />
                      </div>
                    </td>
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
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(p); setOpen(true); }}><Edit className="w-3 h-3" /></Button>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3 h-3 text-destructive" /></Button>}
                      title="¿Eliminar compra?"
                      confirmText="Eliminar"
                      onConfirm={() => handleDelete(p)}
                    />
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
    </div>
  );
}

function PurchaseForm({ userId, editItem, onSave }: { userId: string; editItem?: any; onSave: () => void }) {
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
      if (orgId) {
        const { data } = await supabase.from("suppliers").select("id,name").eq("org_id", orgId).order("name");
        if (data) setSuppliers(data);

        if (editItem?.id) {
          const { data: existingDebt } = await supabase
            .from("supplier_debts" as any)
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
      rows.push({ 'Producto': 'TOTAL', 'Cantidad': rows.reduce((s, r) => s + r['Cantidad'], 0), 'Precio Unit. USD': 0, 'Total USD': totalUSD } as any);

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
