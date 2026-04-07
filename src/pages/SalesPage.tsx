import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getSalesDB, addSaleDB, deleteSaleDB, updateSaleDB, getProductsDB, getSettingsDB, formatARS, formatUSD } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, DollarSign, ChevronLeft, ChevronRight, Edit } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import { checkStockAfterSale } from "@/lib/stockNotifications";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";

const PAGE_SIZE = 20;

export default function SalesPage() {
  const { user } = useAuth();
  const [sales, setSales] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const reload = async () => {
    if (user) {
      setSales(await getSalesDB(user.id));
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, [user]);

  const filtered = sales.filter(s => {
    if (!dateFrom) return true;
    const d = new Date(s.date);
    if (d < dateFrom) return false;
    if (dateTo) { const end = new Date(dateTo); end.setHours(23,59,59,999); if (d > end) return false; }
    return true;
  });
  const totalSales = filtered.reduce((s, v) => s + Number(v.total_ars), 0);
  const totalProfit = filtered.reduce((s, v) => s + Number(v.profit_ars), 0);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleDelete = async (sale: any) => {
    await deleteSaleDB(sale.id);
    if (user) await logAudit(user.id, 'delete', 'sale', sale.id, { product: sale.product_name, total: sale.total_ars });
    reload();
    toast.success("Venta eliminada");
  };

  if (loading) return <TableSkeleton rows={8} cols={7} />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Ventas</h1>
          <p className="text-muted-foreground text-sm">{filtered.length} ventas · Total: {formatARS(totalSales)} · Ganancia: {formatARS(totalProfit)}</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); setPage(0); }} />
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nueva Venta</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-lg">
            <DialogHeader><DialogTitle className="font-display">{editItem ? 'Editar Venta' : 'Registrar Venta'}</DialogTitle></DialogHeader>
            <SaleForm userId={user!.id} editItem={editItem} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState icon={DollarSign} title="No hay ventas registradas" description="Registrá tu primera venta para comenzar a ver tus ganancias." actionLabel="Nueva Venta" onAction={() => setOpen(true)} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">Fecha</th>
                  <th className="text-left p-3 font-medium">Producto</th>
                  <th className="text-left p-3 font-medium">Cliente</th>
                  <th className="text-right p-3 font-medium">Cant.</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-right p-3 font-medium">Ganancia</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                  <th className="text-center p-3 font-medium">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(s => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="p-3">{new Date(s.date).toLocaleDateString('es-AR')}</td>
                    <td className="p-3">{s.product_name}</td>
                    <td className="p-3">{s.customer_name || '—'}</td>
                    <td className="p-3 text-right">{s.quantity}</td>
                    <td className="p-3 text-right font-medium">{formatARS(Number(s.total_ars))}</td>
                    <td className="p-3 text-right">
                      <span className={Number(s.profit_ars) > 0 ? 'text-success' : 'text-destructive'}>{formatARS(Number(s.profit_ars))}</span>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.paid ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                        {s.paid ? 'Pagado' : 'Debe'}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { setEditItem(s); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>
                        <ConfirmDialog
                          trigger={<Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                          title="¿Eliminar esta venta?"
                          description={`Se eliminará la venta de ${s.product_name} por ${formatARS(Number(s.total_ars))}.`}
                          confirmText="Eliminar"
                          onConfirm={() => handleDelete(s)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {paged.map(s => (
              <div key={s.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{s.product_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(s.date).toLocaleDateString('es-AR')} · {s.customer_name || 'Sin cliente'}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.paid ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                    {s.paid ? 'Pagado' : 'Debe'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex gap-4 text-sm">
                    <span>x{s.quantity}</span>
                    <span className="font-medium">{formatARS(Number(s.total_ars))}</span>
                    <span className={Number(s.profit_ars) > 0 ? 'text-success' : 'text-destructive'}>{formatARS(Number(s.profit_ars))}</span>
                  </div>
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                    title="¿Eliminar venta?"
                    confirmText="Eliminar"
                    onConfirm={() => handleDelete(s)}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {page + 1} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SaleForm({ userId, editItem, onSave }: { userId: string; editItem?: any; onSave: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [productId, setProductId] = useState(editItem?.product_id || '');
  const [quantity, setQuantity] = useState(String(editItem?.quantity || '1'));
  const [customerName, setCustomerName] = useState(editItem?.customer_name || '');
  const [paid, setPaid] = useState(editItem ? String(editItem.paid) : 'true');
  const [useDiscount, setUseDiscount] = useState(editItem?.discount_applied ? 'true' : 'false');
  const [customPrice, setCustomPrice] = useState(editItem ? String(editItem.unit_price_ars) : '');
  const [date, setDate] = useState(editItem ? new Date(editItem.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([getProductsDB(userId), getSettingsDB(userId)]);
      setProducts(p);
      setSettings(s);
    })();
  }, [userId]);

  const product = products.find(p => p.id === productId);
  const qty = parseInt(quantity) || 0;
  const applyDiscount = useDiscount === 'true' && product?.discount_price_ars;
  const baseUnitPrice = applyDiscount ? Number(product!.discount_price_ars) : (Number(product?.sale_price_ars) || 0);
  const unitPrice = customPrice ? (parseFloat(customPrice) || baseUnitPrice) : baseUnitPrice;
  const total = unitPrice * qty;
  const exchangeRate = Number(settings?.exchange_rate || 1695);
  const costPerUnitARS = product ? Number(product.total_cost_usd) * exchangeRate : 0;
  const profitARS = total - (costPerUnitARS * qty);
  const profitUSD = exchangeRate > 0 ? profitARS / exchangeRate : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || qty <= 0) { toast.error("Seleccioná un producto y cantidad"); return; }
    if (!editItem && product && qty > product.stock) { toast.error(`Stock insuficiente (${product.stock})`); return; }

    const saleData = {
      product_id: productId, product_name: product!.name,
      quantity: qty, unit_price_ars: unitPrice, discount_applied: !!applyDiscount || !!customPrice,
      total_ars: total, cost_per_unit_usd: Number(product!.total_cost_usd),
      profit_ars: profitARS, profit_usd: profitUSD,
      customer_name: customerName || null, date, paid: paid === 'true',
    };

    if (editItem) {
      await updateSaleDB(editItem.id, saleData, editItem);
      await logAudit(userId, 'update', 'sale', editItem.id, { product: product!.name, total, profit: profitARS });
      toast.success("Venta actualizada");
    } else {
      const saleId = crypto.randomUUID();
      await addSaleDB({ id: saleId, user_id: userId, ...saleData });
      await logAudit(userId, 'create', 'sale', saleId, { product: product!.name, total, profit: profitARS });
      toast.success("Venta registrada");
      if (productId) await checkStockAfterSale(productId, product!.name);
    }
    onSave();
  };

  if (!settings) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Producto</label>
        <Select value={productId} onValueChange={v => { setProductId(v); setCustomPrice(''); setUseDiscount('false'); }}>
          <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>
            {products.filter(p => p.stock > 0).map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Cantidad</label>
          <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Fecha</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      <div><label className="text-sm text-muted-foreground">Cliente (opcional)</label>
        <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nombre" className="bg-muted border-border" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Pago</label>
          <Select value={paid} onValueChange={setPaid}><SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="true">Pagado</SelectItem><SelectItem value="false">Fía (deuda)</SelectItem></SelectContent>
          </Select>
        </div>
        {product?.discount_price_ars && (
          <div><label className="text-sm text-muted-foreground">Descuento</label>
            <Select value={useDiscount} onValueChange={setUseDiscount}><SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="false">Normal ({formatARS(Number(product.sale_price_ars))})</SelectItem><SelectItem value="true">Oferta ({formatARS(Number(product.discount_price_ars))})</SelectItem></SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div><label className="text-sm text-muted-foreground">Precio personalizado (opcional)</label>
        <Input type="number" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder={`Predeterminado: ${formatARS(baseUnitPrice)}`} className="bg-muted border-border" /></div>
      {product && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Precio unitario:</span><span>{formatARS(unitPrice)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Costo unitario:</span><span className="text-warning">{formatARS(costPerUnitARS)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total:</span><span className="text-primary">{formatARS(total)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Ganancia:</span>
            <span className={profitARS > 0 ? 'text-success font-medium' : 'text-destructive font-medium'}>{formatARS(profitARS)} ({formatUSD(profitUSD)})</span>
          </div>
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">{editItem ? 'Actualizar Venta' : 'Registrar Venta'}</Button>
    </form>
  );
}
