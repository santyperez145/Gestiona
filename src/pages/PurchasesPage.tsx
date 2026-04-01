import { useState, useEffect } from "react";
import { Purchase } from "@/lib/types";
import { getPurchases, addPurchase, deletePurchase, getProducts, getSettings, formatARS, formatUSD } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [open, setOpen] = useState(false);
  const reload = () => setPurchases(getPurchases());
  useEffect(reload, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Compras</h1>
          <p className="text-muted-foreground">Registro de compras en USD + 15% pasero</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nueva Compra</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle className="font-display">Registrar Compra</DialogTitle></DialogHeader>
            <PurchaseForm onSave={() => { setOpen(false); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {!purchases.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No hay compras registradas</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3 font-medium">Fecha</th>
                <th className="text-left p-3 font-medium">Producto</th>
                <th className="text-right p-3 font-medium">Cant.</th>
                <th className="text-right p-3 font-medium">Unit. USD</th>
                <th className="text-right p-3 font-medium">+15%</th>
                <th className="text-right p-3 font-medium">Total USD</th>
                <th className="text-right p-3 font-medium">TC</th>
                <th className="text-right p-3 font-medium">Total ARS</th>
                <th className="text-center p-3 font-medium">Acc.</th>
              </tr>
            </thead>
            <tbody>
              {purchases.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3">{new Date(p.date).toLocaleDateString('es-AR')}</td>
                  <td className="p-3">{p.productName}</td>
                  <td className="p-3 text-right">{p.quantity}</td>
                  <td className="p-3 text-right">{formatUSD(p.unitCostUSD)}</td>
                  <td className="p-3 text-right">{formatUSD(p.customsFee)}</td>
                  <td className="p-3 text-right font-medium">{formatUSD(p.totalUSD)}</td>
                  <td className="p-3 text-right">${p.exchangeRate}</td>
                  <td className="p-3 text-right font-medium">{formatARS(p.totalARS)}</td>
                  <td className="p-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => { deletePurchase(p.id); reload(); toast.success("Compra eliminada"); }}>
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

function PurchaseForm({ onSave }: { onSave: () => void }) {
  const products = getProducts();
  const settings = getSettings();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [exchangeRate, setExchangeRate] = useState(settings.exchangeRate.toString());
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const product = products.find(p => p.id === productId);
  const qty = parseInt(quantity) || 0;
  const unitCost = product?.costUSD || 0;
  const customsFee = unitCost * qty * (settings.customsPercent / 100);
  const totalUSD = unitCost * qty + customsFee;
  const rate = parseFloat(exchangeRate) || 0;
  const totalARS = totalUSD * rate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || qty <= 0) { toast.error("Seleccioná un producto y cantidad"); return; }
    addPurchase({
      id: crypto.randomUUID(),
      productId,
      productName: product!.name,
      quantity: qty,
      unitCostUSD: unitCost,
      customsFee,
      totalUSD,
      exchangeRate: rate,
      totalARS,
      date,
      supplier,
    });
    toast.success("Compra registrada y stock actualizado");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Producto</label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>
            {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Cantidad</label>
          <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Tipo de Cambio</label>
          <Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Fecha</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" />
        </div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Proveedor (opcional)</label>
        <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Nombre del proveedor" className="bg-muted border-border" />
      </div>
      {product && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Costo unitario:</span><span>{formatUSD(unitCost)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal ({qty}x):</span><span>{formatUSD(unitCost * qty)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">+15% Pasero:</span><span className="text-warning">{formatUSD(customsFee)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1 mt-1"><span>Total USD:</span><span>{formatUSD(totalUSD)}</span></div>
          <div className="flex justify-between font-bold"><span>Total ARS:</span><span className="text-primary">{formatARS(totalARS)}</span></div>
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">Registrar Compra</Button>
    </form>
  );
}
