import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getSalesDB, addSaleDB, deleteSaleDB, updateSaleDB, getProductsDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, getUniqueCustomersDB, formatDateAR, dateToNoon, calculateDecantPrice, calculateWholesalePrice, validateCouponDB, incrementCouponUse } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, DollarSign, ChevronLeft, ChevronRight, Edit, Filter, Ticket } from "lucide-react";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import { checkStockAfterSale } from "@/lib/stockNotifications";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import { useUserRole } from "@/lib/useUserRole";

const PAGE_SIZE = 20;

const PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo', usesDiscount: true },
  { value: 'transferencia', label: 'Transferencia', usesDiscount: true },
  { value: 'mayorista', label: 'Mayorista', usesDiscount: true },
  { value: 'debito', label: 'Débito', usesDiscount: false },
  { value: 'credito', label: 'Crédito', usesDiscount: false },
  { value: 'fiado', label: 'Fiado', usesDiscount: false },
];

const CATEGORIES = [
  { value: 'all', label: 'Todas' },
  { value: 'perfume_arabe', label: 'Perfume Árabe' },
  { value: 'perfume_diseñador', label: 'Perfume Diseñador' },
  { value: 'vaper', label: 'Vaper' },
  { value: 'electronico', label: 'Electrónico' },
];

const PAYMENT_BADGE: Record<string, string> = {
  efectivo: 'bg-success/15 text-success',
  transferencia: 'bg-blue-500/15 text-blue-400',
  mayorista: 'bg-purple-500/15 text-purple-400',
  debito: 'bg-primary/15 text-primary',
  credito: 'bg-warning/15 text-warning',
  fiado: 'bg-destructive/15 text-destructive',
};

export default function SalesPage() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [filterCat, setFilterCat] = useState('all');
  const reload = async () => {
    if (user) {
      const [s, p] = await Promise.all([getSalesDB(user.id), getProductsDB(user.id)]);
      setSales(s);
      setProducts(p);
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, [user]);

  const productCatMap = useMemo(() => {
    const map: Record<string, string> = {};
    products.forEach(p => { map[p.id] = p.category; });
    return map;
  }, [products]);

  const filtered = sales.filter(s => {
    if (filterCat !== 'all' && productCatMap[s.product_id] !== filterCat) return false;
    if (!dateFrom) return true;
    const d = new Date(s.date);
    if (d < dateFrom) return false;
    if (dateTo) { const end = new Date(dateTo); end.setHours(23,59,59,999); if (d > end) return false; }
    return true;
  });
  const totalSales = filtered.reduce((s, v) => s + Number(v.total_ars), 0);
  const totalProfit = filtered.reduce((s, v) => s + Number(v.profit_ars), 0);
  const totalProfitUSD = filtered.reduce((s, v) => s + Number(v.profit_usd), 0);
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
          <p className="text-muted-foreground text-sm">
            {filtered.length} ventas · Total: {formatARS(totalSales)} · Ganancia: {formatARS(totalProfit)} ({formatUSD(totalProfitUSD)})
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterCat} onValueChange={v => { setFilterCat(v); setPage(0); }}>
            <SelectTrigger className="bg-card border-border w-[160px] h-9 text-sm">
              <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">Fecha</th>
                  <th className="text-left p-3 font-medium">Producto</th>
                  <th className="text-left p-3 font-medium">Cliente</th>
                  <th className="text-center p-3 font-medium">Medio</th>
                  <th className="text-right p-3 font-medium">Cant.</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-right p-3 font-medium">Ganancia</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                  {isAdmin && <th className="text-center p-3 font-medium">Acc.</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map(s => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="p-3">{formatDateAR(s.date)}</td>
                    <td className="p-3">{s.product_name}</td>
                    <td className="p-3">{s.customer_name || '—'}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${PAYMENT_BADGE[s.payment_method] || 'bg-muted'}`}>
                        {s.payment_method || 'efectivo'}
                      </span>
                    </td>
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
                    {isAdmin && (
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
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {paged.map(s => (
              <div key={s.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{s.product_name}</p>
                    <p className="text-xs text-muted-foreground">{formatDateAR(s.date)} · {s.customer_name || 'Sin cliente'}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${PAYMENT_BADGE[s.payment_method] || 'bg-muted'}`}>
                      {s.payment_method || 'efectivo'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.paid ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                      {s.paid ? 'Pagado' : 'Debe'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex gap-4 text-sm">
                    <span>x{s.quantity}</span>
                    <span className="font-medium">{formatARS(Number(s.total_ars))}</span>
                    <span className={Number(s.profit_ars) > 0 ? 'text-success' : 'text-destructive'}>{formatARS(Number(s.profit_ars))}</span>
                  </div>
                  {isAdmin && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(s); setOpen(true); }}><Edit className="w-3 h-3" /></Button>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                      title="¿Eliminar venta?"
                      confirmText="Eliminar"
                      onConfirm={() => handleDelete(s)}
                    />
                  </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
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
  const [customers, setCustomers] = useState<string[]>([]);
  const [productId, setProductId] = useState(editItem?.product_id || '');
  const [quantity, setQuantity] = useState(String(editItem?.quantity || '1'));
  const [customerName, setCustomerName] = useState(editItem?.customer_name || '');
  const [customerFilter, setCustomerFilter] = useState('');
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState((editItem as any)?.payment_method || 'efectivo');
  const [customPrice, setCustomPrice] = useState(editItem ? String(editItem.unit_price_ars) : '');
  const [date, setDate] = useState(editItem ? new Date(editItem.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [decantSize, setDecantSize] = useState<string>('full');
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState<any>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, s, c] = await Promise.all([getProductsDB(userId), getSettingsDB(userId), getUniqueCustomersDB(userId)]);
      setProducts(p);
      setSettings(s);
      setCustomers(c);
    })();
  }, [userId]);

  const product = products.find(p => p.id === productId);
  const qty = parseInt(quantity) || 0;
  const methodConfig = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  const usesDiscount = methodConfig?.usesDiscount ?? false;
  const isFiado = paymentMethod === 'fiado';
  const isMayorista = paymentMethod === 'mayorista';

  const isPerfume = product?.category === 'perfume_arabe' || product?.category === 'perfume_diseñador';
  const contentMl = Number(product?.content_ml || 100);
  const exchangeRate = Number(settings?.exchange_rate || 1695);
  const volumeThreshold = Number(settings?.volume_discount_threshold || 3);
  const volumeDiscountPct = Number(settings?.volume_discount_percent || 10);

  // Decant price calculation
  const isDecant = decantSize !== 'full' && isPerfume;
  const decantMl = decantSize === '10' ? 10 : decantSize === '5' ? 5 : decantSize === '2.5' ? 2.5 : 0;
  const decantMargin = decantSize === '10' ? Number(settings?.decant_margin_10ml || 250) :
    decantSize === '5' ? Number(settings?.decant_margin_5ml || 350) : Number(settings?.decant_margin_2_5ml || 500);
  const decantPrice = isDecant ? calculateDecantPrice(Number(product?.total_cost_usd || 0), contentMl, decantMl, decantMargin, exchangeRate) : 0;

  const discountPrice = product?.discount_price_ars ? Number(product.discount_price_ars) : null;
  const normalPrice = Number(product?.sale_price_ars) || 0;
  const baseUnitPrice = isDecant ? decantPrice : (usesDiscount && discountPrice ? discountPrice : normalPrice);
  
  // Volume discount: auto-apply for mayorista payment or when qty >= threshold
  const applyVolume = (isMayorista || qty >= volumeThreshold) && !isDecant;
  let autoUnitPrice = baseUnitPrice;
  let volumeWarning = false;
  if (applyVolume) {
    const { wholesalePrice, belowFloor } = calculateWholesalePrice(
      discountPrice || 0, normalPrice, volumeDiscountPct, Number(product?.total_cost_usd || 0), exchangeRate
    );
    autoUnitPrice = wholesalePrice;
    volumeWarning = belowFloor;
  }

  // Apply coupon discount
  const couponDiscount = couponResult?.valid && couponResult.coupon ? 
    (couponResult.coupon.discount_percent > 0 ? autoUnitPrice * (Number(couponResult.coupon.discount_percent) / 100) : Number(couponResult.coupon.discount_fixed_ars || 0)) : 0;
  const priceAfterCoupon = Math.max(0, autoUnitPrice - couponDiscount);

  const unitPrice = customPrice ? (parseFloat(customPrice) || priceAfterCoupon) : priceAfterCoupon;
  const total = unitPrice * qty;
  const costPerUnitUSD = isDecant ? (Number(product?.total_cost_usd || 0) / contentMl) * decantMl : Number(product?.total_cost_usd || 0);
  const costPerUnitARS = costPerUnitUSD * exchangeRate;
  const profitARS = total - (costPerUnitARS * qty);
  const profitUSD = exchangeRate > 0 ? profitARS / exchangeRate : 0;

  const handleValidateCoupon = async () => {
    if (!couponCode.trim()) return;
    setValidatingCoupon(true);
    try {
      const result = await validateCouponDB(userId, couponCode);
      setCouponResult(result);
    } catch { setCouponResult({ valid: false, reason: 'Error al validar' }); }
    setValidatingCoupon(false);
  };

  const filteredCustomers = customers.filter(c => 
    c.toLowerCase().includes((customerFilter || customerName).toLowerCase())
  ).slice(0, 8);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || qty <= 0) { toast.error("Seleccioná un producto y cantidad"); return; }
    if (!editItem && product && qty > product.stock) { toast.error(`Stock insuficiente (${product.stock})`); return; }

    const paid = !isFiado;
    const discountApplied = usesDiscount || !!customPrice || applyVolume;
    const productLabel = isDecant ? `${product!.name} (${decantSize}ml)` : product!.name;

    const saleData: any = {
      product_id: productId, product_name: productLabel,
      quantity: qty, unit_price_ars: unitPrice, discount_applied: discountApplied,
      total_ars: total, cost_per_unit_usd: costPerUnitUSD,
      profit_ars: profitARS, profit_usd: profitUSD,
      customer_name: customerName || null, date: dateToNoon(date), paid,
      payment_method: paymentMethod,
      coupon_id: couponResult?.valid ? couponResult.coupon.id : null,
    };

    if (editItem) {
      await updateSaleDB(editItem.id, saleData, editItem);
      await logAudit(userId, 'update', 'sale', editItem.id, { product: productLabel, total, profit: profitARS });
      toast.success("Venta actualizada");
    } else {
      const saleId = crypto.randomUUID();
      await addSaleDB({ id: saleId, user_id: userId, ...saleData });
      await logAudit(userId, 'create', 'sale', saleId, { product: productLabel, total, profit: profitARS, paymentMethod });
      toast.success("Venta registrada");
      if (couponResult?.valid) await incrementCouponUse(couponResult.coupon.id);
      if (productId && !isDecant) await checkStockAfterSale(productId, product!.name);
    }
    onSave();
  };

  if (!settings) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Producto</label>
        <Select value={productId} onValueChange={v => { setProductId(v); setCustomPrice(''); setDecantSize('full'); }}>
          <SelectTrigger className="bg-muted border-border"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>
            {products.filter(p => editItem || p.stock > 0).map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Decant selector for perfumes */}
      {product && isPerfume && (
        <div>
          <label className="text-sm text-muted-foreground">Tamaño</label>
          <div className="flex gap-2 mt-1">
            {[
              { value: 'full', label: `Completo (${contentMl}ml)` },
              { value: '10', label: '10ml' },
              { value: '5', label: '5ml' },
              { value: '2.5', label: '2.5ml' },
            ].map(s => (
              <button key={s.value} type="button"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${decantSize === s.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border hover:bg-accent'}`}
                onClick={() => { setDecantSize(s.value); setCustomPrice(''); }}>
                {s.label}
              </button>
            ))}
          </div>
          {isDecant && <p className="text-[10px] text-muted-foreground mt-1">Decant {decantSize}ml · Precio auto: {formatARS(decantPrice)}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Cantidad</label>
          <Input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Fecha</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      {/* Customer combobox */}
      <div className="relative">
        <label className="text-sm text-muted-foreground">Cliente</label>
        <Input 
          value={customerName} 
          onChange={e => { setCustomerName(e.target.value); setCustomerFilter(e.target.value); setShowCustomerList(true); }} 
          onFocus={() => setShowCustomerList(true)}
          onBlur={() => setTimeout(() => setShowCustomerList(false), 200)}
          placeholder="Buscar o escribir nombre..."
          className="bg-muted border-border" 
        />
        {showCustomerList && filteredCustomers.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {filteredCustomers.map(c => (
              <button
                key={c}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors first:rounded-t-lg last:rounded-b-lg"
                onMouseDown={() => { setCustomerName(c); setShowCustomerList(false); }}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Medio de Pago</label>
        <Select value={paymentMethod} onValueChange={v => { setPaymentMethod(v); setCustomPrice(''); }}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {product && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {isDecant 
              ? `Decant ${decantSize}ml: ${formatARS(decantPrice)}`
              : usesDiscount && discountPrice
                ? `Precio c/descuento: ${formatARS(discountPrice)}`
                : `Precio normal: ${formatARS(normalPrice)}`
            }
            {applyVolume && ` · Mayorista -${volumeDiscountPct}%`}
            {volumeWarning && ' ⚠️ Ajustado al piso de rentabilidad'}
            {isFiado && ' · Se genera deuda automáticamente'}
          </p>
        )}
      </div>
      {/* Coupon code */}
      <div>
        <label className="text-sm text-muted-foreground flex items-center gap-1"><Ticket className="w-3.5 h-3.5" />Cupón de descuento</label>
        <div className="flex gap-2 mt-1">
          <Input 
            value={couponCode} 
            onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponResult(null); }} 
            placeholder="Ej: EXENTRY10" 
            className="bg-muted border-border flex-1" 
          />
          <Button type="button" variant="outline" size="sm" onClick={handleValidateCoupon} disabled={validatingCoupon || !couponCode.trim()}>
            {validatingCoupon ? '...' : 'Validar'}
          </Button>
        </div>
        {couponResult && (
          <p className={`text-[10px] mt-1 font-medium ${couponResult.valid ? 'text-success' : 'text-destructive'}`}>
            {couponResult.valid 
              ? `✓ Cupón aplicado: ${couponResult.coupon.discount_percent > 0 ? `-${couponResult.coupon.discount_percent}%` : `-${formatARS(Number(couponResult.coupon.discount_fixed_ars))}`}`
              : `✗ ${couponResult.reason}`}
          </p>
        )}
      </div>
      <div><label className="text-sm text-muted-foreground">Precio personalizado (opcional)</label>
        <Input type="number" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder={`Automático: ${formatARS(priceAfterCoupon)}`} className="bg-muted border-border" /></div>
      {product && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm animate-in fade-in duration-200">
          <div className="flex justify-between"><span className="text-muted-foreground">Precio unitario:</span><span>{formatARS(unitPrice)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Costo unitario:</span><span className="text-warning">{formatARS(costPerUnitARS)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total ({qty} uds):</span><span className="text-primary">{formatARS(total)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Ganancia:</span>
            <span className={profitARS > 0 ? 'text-success font-medium' : 'text-destructive font-medium'}>{formatARS(profitARS)} ({formatUSD(profitUSD)})</span>
          </div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Margen:</span>
            <span className={profitARS > 0 ? 'text-success' : 'text-destructive'}>{total > 0 ? Math.round(profitARS / total * 100) : 0}%</span>
          </div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Medio:</span>
            <span className="capitalize font-medium">{paymentMethod}{!isFiado ? ' · Pagado' : ' · Deuda'}</span>
          </div>
          {isDecant && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Tipo:</span><span className="font-medium">Decant {decantSize}ml</span></div>}
          {applyVolume && (
            <div className="flex justify-between text-xs border-t border-border pt-1">
              <span className="text-muted-foreground">Mayorista:</span>
              <span className="text-primary font-medium">-{volumeDiscountPct}% ({qty}+ uds){volumeWarning ? ' ⚠️ piso' : ''}</span>
            </div>
          )}
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">{editItem ? 'Actualizar Venta' : 'Registrar Venta'}</Button>
    </form>
  );
}
