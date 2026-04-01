import { useState, useEffect } from "react";
import { Product } from "@/lib/types";
import { getProducts, addProduct, updateProduct, deleteProduct, formatARS, formatUSD, getSettings } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const reload = () => setProducts(getProducts());
  useEffect(reload, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Productos</h1>
          <p className="text-muted-foreground">Gestiona tu catálogo de vapers y perfumes</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo Producto</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle className="font-display">{editing ? 'Editar' : 'Nuevo'} Producto</DialogTitle></DialogHeader>
            <ProductForm product={editing} onSave={() => { setOpen(false); setEditing(null); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {!products.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No hay productos aún</p>
          <p className="text-sm">Agregá tu primer producto para empezar</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Categoría</th>
                <th className="text-right p-3 font-medium">Costo USD</th>
                <th className="text-right p-3 font-medium">+15% Pasero</th>
                <th className="text-right p-3 font-medium">Precio ARS</th>
                <th className="text-right p-3 font-medium">Stock</th>
                <th className="text-center p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-primary/15 text-primary">{p.category === 'vaper' ? 'Vaper' : 'Perfume'}</span>
                  </td>
                  <td className="p-3 text-right">{formatUSD(p.costUSD)}</td>
                  <td className="p-3 text-right">{formatUSD(p.totalCostUSD)}</td>
                  <td className="p-3 text-right font-medium">{formatARS(p.salePriceARS)}</td>
                  <td className="p-3 text-right">
                    <span className={p.stock <= 3 ? 'text-destructive font-bold' : ''}>{p.stock}</span>
                  </td>
                  <td className="p-3 text-center space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { deleteProduct(p.id); reload(); toast.success("Producto eliminado"); }}>
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

function ProductForm({ product, onSave }: { product: Product | null; onSave: () => void }) {
  const settings = getSettings();
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState<'vaper' | 'perfume'>(product?.category || 'vaper');
  const [costUSD, setCostUSD] = useState(product?.costUSD?.toString() || '');
  const [salePriceARS, setSalePriceARS] = useState(product?.salePriceARS?.toString() || '');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');

  const cost = parseFloat(costUSD) || 0;
  const customs = cost * (settings.customsPercent / 100);
  const total = cost + customs;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !costUSD) { toast.error("Completá todos los campos"); return; }
    const data: Product = {
      id: product?.id || crypto.randomUUID(),
      name: name.trim(),
      category,
      costUSD: cost,
      customsFee: customs,
      totalCostUSD: total,
      salePriceARS: parseFloat(salePriceARS) || 0,
      stock: parseInt(stock) || 0,
      createdAt: product?.createdAt || new Date().toISOString(),
    };
    if (product) updateProduct(data); else addProduct(data);
    toast.success(product ? "Producto actualizado" : "Producto agregado");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Nombre</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Vaper SMOK Nord" className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Categoría</label>
        <Select value={category} onValueChange={(v: 'vaper' | 'perfume') => setCategory(v)}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="vaper">Vaper</SelectItem>
            <SelectItem value="perfume">Perfume Árabe</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Costo USD</label>
          <Input type="number" step="0.01" value={costUSD} onChange={e => setCostUSD(e.target.value)} placeholder="0.00" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">+15% Pasero</label>
          <div className="h-10 flex items-center px-3 rounded-md bg-muted border border-border text-sm">{formatUSD(total)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Precio Venta ARS</label>
          <Input type="number" step="1" value={salePriceARS} onChange={e => setSalePriceARS(e.target.value)} placeholder="0" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Stock Inicial</label>
          <Input type="number" value={stock} onChange={e => setStock(e.target.value)} placeholder="0" className="bg-muted border-border" />
        </div>
      </div>
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">
        {product ? 'Guardar Cambios' : 'Agregar Producto'}
      </Button>
    </form>
  );
}
