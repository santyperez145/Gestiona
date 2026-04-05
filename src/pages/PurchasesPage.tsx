import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getPurchasesDB, addPurchaseDB, deletePurchaseDB, getProductsDB, getSettingsDB, formatARS, formatUSD } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function PurchasesPage() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const reload = async () => { if (user) setPurchases(await getPurchasesDB(user.id)); };
  useEffect(() => { reload(); }, [user]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Compras</h1>
          <p className="text-muted-foreground">Registro de compras en USD + pasero</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nueva Compra</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle className="font-display">Registrar Compra</DialogTitle></DialogHeader>
            <PurchaseForm userId={user!.id} onSave={() => { setOpen(false); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {!purchases.length ? (
        <div className="text-center py-20 text-muted-foreground"><p className="text-lg">No hay compras registradas</p></div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3 font-medium">Fecha</th>
                <th className="text-left p-3 font-medium">Producto</th>
                <th className="text-right p-3 font-medium">Cant.</th>
                <th className="text-right p-3 font-medium">Unit. USD</th>
                <th className="text-right p-3 font-medium">Total USD</th>
                <th className="text-right p-3 font-medium">Total ARS</th>
                <th className="text-center p-3 font-medium">Acc.</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3">{new Date(p.date).toLocaleDateString('es-AR')}</td>
                  <td className="p-3">{p.product_name}</td>
                  <td className="p-3 text-right">{p.quantity}</td>
                  <td className="p-3 text-right">{formatUSD(Number(p.unit_cost_usd))}</td>
                  <td className="p-3 text-right font-medium">{formatUSD(Number(p.total_usd))}</td>
                  <td className="p-3 text-right font-medium">{formatARS(Number(p.total_ars))}</td>
                  <td className="p-3 text-center">
                    <Button variant="ghost" size="sm" onClick={async () => { await deletePurchaseDB(p.id); reload(); toast.success("Eliminada"); }}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
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
      setProducts(p);
      setSettings(s);
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
