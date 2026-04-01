import { useState, useEffect } from "react";
import { Sale } from "@/lib/types";
import { getSales, addSale, deleteSale, getProducts, formatARS } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [open, setOpen] = useState(false);
  const reload = () => setSales(getSales());
  useEffect(reload, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Ventas</h1>
          <p className="text-muted-foreground">Registro de ventas en pesos argentinos</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nueva Venta</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle className="font-display">Registrar Venta</DialogTitle></DialogHeader>
            <SaleForm onSave={() => { setOpen(false); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {!sales.length ? (
        <div className="text-center py-20 text-muted-foreground"><p className="text-lg">No hay ventas registradas</p></div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3 font-medium">Fecha</th>
                <th className="text-left p-3 font-medium">Producto</th>
                <th className="text-left p-3 font-medium">Cliente</th>
                <th className="text-right p-3 font-medium">Cant.</th>
                <th className="text-right p-3 font-medium">Precio Unit.</th>
                <th className="text-right p-3 font-medium">Total</th>
                <th className="text-center p-3 font-medium">Estado</th>
                <th className="text-center p-3 font-medium">Acc.</th>
              </tr>
            </thead>
            <tbody>
              {sales.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(s => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3">{new Date(s.date).toLocaleDateString('es-AR')}</td>
                  <td className="p-3">{s.productName}</td>
                  <td className="p-3">{s.customerName || '—'}</td>
                  <td className="p-3 text-right">{s.quantity}</td>
                  <td className="p-3 text-right">{formatARS(s.unitPriceARS)}</td>
                  <td className="p-3 text-right font-medium">{formatARS(s.totalARS)}</td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.paid ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                      {s.paid ? 'Pagado' : 'Debe'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => { deleteSale(s.id); reload(); toast.success("Venta eliminada"); }}>
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

function SaleForm({ onSave }: { onSave: () => void }) {
  const products = getProducts();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [customerName, setCustomerName] = useState('');
  const [paid, setPaid] = useState('true');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const product = products.find(p => p.id === productId);
  const qty = parseInt(quantity) || 0;
  const unitPrice = product?.salePriceARS || 0;
  const total = unitPrice * qty;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || qty <= 0) { toast.error("Seleccioná un producto y cantidad"); return; }
    if (product && qty > product.stock) { toast.error(`Stock insuficiente (${product.stock} disponibles)`); return; }
    addSale({
      id: crypto.randomUUID(),
      productId,
      productName: product!.name,
      quantity: qty,
      unitPriceARS: unitPrice,
      totalARS: total,
      customerName,
      date,
      paid: paid === 'true',
    });
    toast.success("Venta registrada");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Producto</label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>
            {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Cantidad</label>
          <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Fecha</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" />
        </div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Cliente (opcional)</label>
        <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nombre del cliente" className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Estado de Pago</label>
        <Select value={paid} onValueChange={setPaid}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Pagado</SelectItem>
            <SelectItem value="false">Fía (genera deuda)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {product && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Precio unitario:</span><span>{formatARS(unitPrice)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total:</span><span className="text-primary">{formatARS(total)}</span></div>
          {product.stock < qty && <p className="text-destructive text-xs mt-1">⚠ Stock insuficiente</p>}
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">Registrar Venta</Button>
    </form>
  );
}
