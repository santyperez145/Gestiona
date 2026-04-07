import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getPurchasesDB, addPurchaseDB, deletePurchaseDB, updatePurchaseDB, getProductsDB, getSettingsDB, formatARS, formatUSD } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ShoppingCart, ChevronLeft, ChevronRight, Edit } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";

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
  const reload = async () => { if (user) { setPurchases(await getPurchasesDB(user.id)); setLoading(false); } };
  useEffect(() => { reload(); }, [user]);

  const filtered = purchases.filter(p => {
    if (!dateFrom) return true;
    const d = new Date(p.date);
    if (d < dateFrom) return false;
    if (dateTo) { const end = new Date(dateTo); end.setHours(23,59,59,999); if (d > end) return false; }
    return true;
  });
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Compras</h1>
          <p className="text-muted-foreground text-sm">{filtered.length} compras · {formatUSD(totalUSD)} · {formatARS(totalARS)}</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); setPage(0); }} />
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nueva Compra</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle className="font-display">{editItem ? 'Editar Compra' : 'Registrar Compra'}</DialogTitle></DialogHeader>
            <PurchaseForm userId={user!.id} editItem={editItem} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState icon={ShoppingCart} title="No hay compras registradas" description="Registrá tu primera compra para llevar el control de tu inversión." actionLabel="Nueva Compra" onAction={() => setOpen(true)} />
      ) : (
        <>
          <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">Fecha</th>
                  <th className="text-left p-3 font-medium">Producto</th>
                  <th className="text-left p-3 font-medium">Proveedor</th>
                  <th className="text-right p-3 font-medium">Cant.</th>
                  <th className="text-right p-3 font-medium">Unit. USD</th>
                  <th className="text-right p-3 font-medium">Pasero</th>
                  <th className="text-right p-3 font-medium">Total USD</th>
                  <th className="text-right p-3 font-medium">Total ARS</th>
                  <th className="text-center p-3 font-medium">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="p-3">{new Date(p.date).toLocaleDateString('es-AR')}</td>
                    <td className="p-3">{p.product_name}</td>
                    <td className="p-3 text-muted-foreground">{p.supplier || '—'}</td>
                    <td className="p-3 text-right">{p.quantity}</td>
                    <td className="p-3 text-right">{formatUSD(Number(p.unit_cost_usd))}</td>
                    <td className="p-3 text-right text-warning">{formatUSD(Number(p.customs_fee))}</td>
                    <td className="p-3 text-right font-medium">{formatUSD(Number(p.total_usd))}</td>
                    <td className="p-3 text-right font-medium">{formatARS(Number(p.total_ars))}</td>
                    <td className="p-3 text-center">
                      <ConfirmDialog
                        trigger={<Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                        title="¿Eliminar compra?"
                        description={`Se eliminará la compra de ${p.product_name}.`}
                        confirmText="Eliminar"
                        onConfirm={() => handleDelete(p)}
                      />
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
                  <div>
                    <p className="font-medium text-sm">{p.product_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(p.date).toLocaleDateString('es-AR')} · {p.supplier || 'Sin proveedor'}</p>
                  </div>
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3 h-3 text-destructive" /></Button>}
                    title="¿Eliminar compra?"
                    confirmText="Eliminar"
                    onConfirm={() => handleDelete(p)}
                  />
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

function PurchaseForm({ userId, onSave }: { userId: string; onSave: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [exchangeRate, setExchangeRate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([getProductsDB(userId), getSettingsDB(userId)]);
      setProducts(p); setSettings(s);
      setExchangeRate(String(s?.exchange_rate || 1695));
    })();
  }, [userId]);

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
    if (!productId || qty <= 0) { toast.error("Seleccioná producto y cantidad"); return; }
    await addPurchaseDB({
      user_id: userId, product_id: productId, product_name: product!.name,
      quantity: qty, unit_cost_usd: unitCost, customs_fee: customsFee,
      total_usd: totalUSD, exchange_rate: rate, total_ars: totalARS, date, supplier,
    });
    await logAudit(userId, 'create', 'purchase', undefined, { product: product!.name, totalUSD, qty });
    toast.success("Compra registrada");
    onSave();
  };

  if (!settings) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label className="text-sm text-muted-foreground">Producto</label>
        <Select value={productId} onValueChange={setProductId}><SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-sm text-muted-foreground">Cantidad</label><Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">TC</label><Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Fecha</label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      <div><label className="text-sm text-muted-foreground">Proveedor</label><Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Opcional" className="bg-muted border-border" /></div>
      {product && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span>{formatUSD(unitCost * qty)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">+{customsPercent}% Pasero:</span><span className="text-warning">{formatUSD(customsFee)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total USD:</span><span>{formatUSD(totalUSD)}</span></div>
          <div className="flex justify-between font-bold"><span>Total ARS:</span><span className="text-primary">{formatARS(totalARS)}</span></div>
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">Registrar Compra</Button>
    </form>
  );
}
