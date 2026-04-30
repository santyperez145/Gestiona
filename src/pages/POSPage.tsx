import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { getProductsDB, getSettingsDB, addSaleDB, formatARS } from "@/lib/supabaseStore";
import { logAudit } from "@/lib/auditLog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ShoppingCart, Search, Minus, Plus, Trash2, X, CheckCircle2,
  Banknote, ArrowLeftRight, CreditCard, UserX, Zap, Printer,
  QrCode, ChevronUp, Package, MessageCircle, RotateCcw,
} from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface CartItem {
  productId: string;
  name: string;
  brand: string;
  price: number;
  costUSD: number;
  exchangeRate: number;
  quantity: number;
  stock: number;
  imageUrl?: string | null;
  useDiscount: boolean;
  discountPrice?: number | null;
}

type PayMethod = "efectivo" | "transferencia" | "debito" | "credito" | "mayorista" | "fiado";

const PAY_METHODS: { value: PayMethod; label: string; icon: typeof Banknote; usesDiscount: boolean; color: string }[] = [
  { value: "efectivo",      label: "Efectivo",      icon: Banknote,        usesDiscount: true,  color: "text-green-400" },
  { value: "transferencia", label: "Transferencia", icon: ArrowLeftRight,  usesDiscount: true,  color: "text-blue-400" },
  { value: "debito",        label: "Débito",        icon: CreditCard,      usesDiscount: false, color: "text-primary" },
  { value: "credito",       label: "Crédito",       icon: CreditCard,      usesDiscount: false, color: "text-yellow-400" },
  { value: "mayorista",     label: "Mayorista",     icon: Zap,             usesDiscount: true,  color: "text-purple-400" },
  { value: "fiado",         label: "Fiado / Deuda", icon: UserX,           usesDiscount: false, color: "text-red-400" },
];

const CATS = [
  { value: "all", label: "Todo" },
  { value: "perfume_arabe", label: "Árabe" },
  { value: "perfume_diseñador", label: "Diseñador" },
  { value: "vaper", label: "Vaper" },
  { value: "electronico", label: "Electrónico" },
];

// ─────────────────────────────────────────────────────────────
// Barcode scanner hook
// ─────────────────────────────────────────────────────────────
function useBarcodeScanner(onDetect: (code: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [scanning, setScanning] = useState(false);

  const start = useCallback(async () => {
    try {
      readerRef.current = new BrowserMultiFormatReader();
      setScanning(true);
      await readerRef.current.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (result) {
          onDetect(result.getText());
          stop();
        }
      });
    } catch (e) {
      toast.error("No se pudo acceder a la cámara");
      setScanning(false);
    }
  }, [onDetect]);

  const stop = useCallback(() => {
    readerRef.current?.reset();
    setScanning(false);
  }, []);

  return { videoRef, scanning, start, stop };
}

// ─────────────────────────────────────────────────────────────
// Receipt generator (WhatsApp text)
// ─────────────────────────────────────────────────────────────
function buildReceiptText(
  items: CartItem[], payMethod: PayMethod, customer: string,
  total: number, cashGiven: number, businessName: string,
) {
  const lines = items.map(
    (it) => `• ${it.name} x${it.quantity} → ${formatARS(it.price * it.quantity)}`
  );
  const change = payMethod === "efectivo" && cashGiven > total ? cashGiven - total : 0;
  const date = new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  return [
    `🧾 *${businessName}*`,
    `📅 ${date}`,
    customer ? `👤 ${customer}` : "",
    "",
    ...lines,
    "",
    `💰 *Total: ${formatARS(total)}*`,
    PAY_METHODS.find(m => m.value === payMethod)?.label ? `Método: ${PAY_METHODS.find(m => m.value === payMethod)!.label}` : "",
    change > 0 ? `Cambio: ${formatARS(change)}` : "",
    payMethod === "fiado" ? "⚠️ Pendiente de pago" : "✅ Pagado",
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────
// Receipt Modal
// ─────────────────────────────────────────────────────────────
function ReceiptModal({
  items, payMethod, customer, total, cashGiven, businessName,
  onClose, onNewSale,
}: {
  items: CartItem[]; payMethod: PayMethod; customer: string;
  total: number; cashGiven: number; businessName: string;
  onClose: () => void; onNewSale: () => void;
}) {
  const change = payMethod === "efectivo" && cashGiven > total ? cashGiven - total : 0;
  const receiptText = buildReceiptText(items, payMethod, customer, total, cashGiven, businessName);

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(receiptText)}`, "_blank");
  };

  const print = () => window.print();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <h2 className="font-display font-bold">Venta registrada</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Receipt body */}
        <div className="px-5 py-4 print:block" id="receipt-print">
          <div className="text-center mb-4">
            <p className="font-bold text-lg">{businessName}</p>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleString("es-AR", { dateStyle: "long", timeStyle: "short" })}
            </p>
            {customer && <p className="text-sm mt-1">👤 {customer}</p>}
          </div>

          <div className="space-y-1.5 border-t border-dashed border-border py-3">
            {items.map((it) => (
              <div key={it.productId} className="flex justify-between text-sm">
                <span className="flex-1 truncate">{it.name} <span className="text-muted-foreground">x{it.quantity}</span></span>
                <span className="font-mono ml-2 shrink-0">{formatARS(it.price * it.quantity)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-border pt-3 space-y-1">
            <div className="flex justify-between text-sm font-bold text-primary">
              <span>TOTAL</span>
              <span className="font-mono">{formatARS(total)}</span>
            </div>
            {payMethod === "efectivo" && cashGiven >= total && (
              <>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Recibido</span>
                  <span className="font-mono">{formatARS(cashGiven)}</span>
                </div>
                <div className="flex justify-between text-sm text-green-400 font-semibold">
                  <span>Cambio</span>
                  <span className="font-mono">{formatARS(change)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Pago</span>
              <span className="capitalize">{PAY_METHODS.find(m => m.value === payMethod)?.label}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={shareWhatsApp} className="gap-1.5">
            <MessageCircle className="w-4 h-4 text-green-400" />WhatsApp
          </Button>
          <Button variant="outline" size="sm" onClick={print} className="gap-1.5">
            <Printer className="w-4 h-4" />Imprimir
          </Button>
          <Button className="col-span-2 gradient-gold text-primary-foreground gap-1.5" onClick={onNewSale}>
            <RotateCcw className="w-4 h-4" />Nueva venta
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main POS Page
// ─────────────────────────────────────────────────────────────
export default function POSPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const config = useBusinessConfig();

  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("efectivo");
  const [cashGiven, setCashGiven] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ items: CartItem[]; total: number; cash: number } | null>(null);
  const [showCart, setShowCart] = useState(false); // mobile toggle
  const [loadingProds, setLoadingProds] = useState(true);

  // Barcode scanner
  const handleBarcode = useCallback((code: string) => {
    const prod = products.find((p) => p.barcode === code || p.sku === code);
    if (prod) {
      addToCart(prod);
      toast.success(`Escaneado: ${prod.name}`);
    } else {
      toast.error(`Código ${code} no encontrado`);
    }
  }, [products]);

  const { videoRef, scanning, start: startScan, stop: stopScan } = useBarcodeScanner(handleBarcode);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [prods, sett] = await Promise.all([getProductsDB(user.id), getSettingsDB(user.id)]);
      setProducts(prods);
      setSettings(sett);
      setLoadingProds(false);
    })();
  }, [user]);

  // ── Filtered products ──
  const filtered = useMemo(() => {
    let list = products.filter((p) => p.stock > 0 || p.allow_negative_stock);
    if (cat !== "all") list = list.filter((p) => p.category === cat);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        p.name?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, cat, search]);

  // ── Cart helpers ──
  const usesDiscount = PAY_METHODS.find(m => m.value === payMethod)?.usesDiscount ?? false;

  const priceFor = (item: CartItem) =>
    usesDiscount && item.discountPrice && item.discountPrice > 0 ? item.discountPrice : item.price;

  const cartTotal = cart.reduce((s, it) => s + priceFor(it) * it.quantity, 0);
  const cartQty = cart.reduce((s, it) => s + it.quantity, 0);

  const addToCart = useCallback((prod: any) => {
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.productId === prod.id);
      if (idx >= 0) {
        if (prev[idx].quantity >= prod.stock && prod.stock > 0) {
          toast.warning("Sin stock suficiente");
          return prev;
        }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [...prev, {
        productId: prod.id,
        name: prod.name,
        brand: prod.brand,
        price: Number(prod.sale_price_ars) || 0,
        discountPrice: prod.discount_price_ars ? Number(prod.discount_price_ars) : null,
        costUSD: Number(prod.total_cost_usd) || 0,
        exchangeRate: Number(settings?.exchange_rate) || 1695,
        quantity: 1,
        stock: prod.stock,
        imageUrl: prod.image_url || null,
        useDiscount: false,
      }];
    });
    setShowCart(true);
  }, [settings]);

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) => it.productId === productId ? { ...it, quantity: it.quantity + delta } : it)
        .filter((it) => it.quantity > 0)
    );
  };

  const removeItem = (productId: string) => setCart((prev) => prev.filter((it) => it.productId !== productId));

  const clearCart = () => { setCart([]); setCustomer(""); setCashGiven(""); setPayMethod("efectivo"); };

  // ── Confirm sale ──
  const confirmSale = async () => {
    if (!user || !cart.length) return;
    setSubmitting(true);
    try {
      const paid = payMethod !== "fiado";
      const date = new Date().toISOString();

      for (const item of cart) {
        const unitPrice = priceFor(item);
        const totalARS = unitPrice * item.quantity;
        const costARS = item.costUSD * item.exchangeRate;
        const profitARS = totalARS - costARS * item.quantity;
        const profitUSD = item.exchangeRate > 0 ? profitARS / item.exchangeRate : 0;

        const saleData: any = {
          id: crypto.randomUUID(),
          user_id: user.id,
          product_id: item.productId,
          product_name: item.name,
          quantity: item.quantity,
          unit_price_ars: unitPrice,
          discount_applied: usesDiscount && !!item.discountPrice,
          total_ars: totalARS,
          cost_per_unit_usd: item.costUSD,
          profit_ars: profitARS,
          profit_usd: profitUSD,
          customer_name: customer.trim() || null,
          date,
          paid,
          payment_method: payMethod,
        };

        await addSaleDB(saleData);
        await logAudit(user.id, "create", "sale", saleData.id, {
          product: item.name, total: totalARS, method: payMethod, source: "pos",
        });
      }

      // Refresh stock
      const [prods] = await Promise.all([getProductsDB(user.id)]);
      setProducts(prods);

      setReceipt({ items: [...cart], total: cartTotal, cash: Number(cashGiven) || 0 });
      toast.success(`Venta de ${formatARS(cartTotal)} registrada`);
    } catch (e: any) {
      toast.error(e.message || "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  const cartPanel = (
    <div className="flex flex-col h-full">
      {/* Cart header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Carrito</span>
          {cartQty > 0 && (
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {cartQty}
            </span>
          )}
        </div>
        {cart.length > 0 && (
          <button onClick={clearCart} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
            <Trash2 className="w-3 h-3" />Limpiar
          </button>
        )}
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {cart.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-20" />
            Tocá un producto para agregar
          </div>
        ) : (
          cart.map((it) => {
            const unitP = priceFor(it);
            return (
              <div key={it.productId} className="bg-muted/40 rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight truncate">{it.name}</p>
                    <p className="text-xs text-muted-foreground">{formatARS(unitP)} c/u</p>
                  </div>
                  <button onClick={() => removeItem(it.productId)} className="text-muted-foreground hover:text-destructive shrink-0 mt-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => changeQty(it.productId, -1)}
                      className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold">{it.quantity}</span>
                    <button
                      onClick={() => changeQty(it.productId, 1)}
                      disabled={it.quantity >= it.stock && it.stock > 0}
                      className="w-7 h-7 rounded-lg bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="font-semibold text-sm font-mono">{formatARS(unitP * it.quantity)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Customer + Payment */}
      <div className="px-4 py-3 border-t border-border space-y-3">
        <Input
          placeholder="Cliente (opcional)"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          className="h-8 text-sm bg-muted"
        />

        {/* Payment method grid */}
        <div className="grid grid-cols-3 gap-1">
          {PAY_METHODS.map((m) => {
            const Icon = m.icon;
            const active = payMethod === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setPayMethod(m.value)}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-xl border text-[10px] font-medium transition-all ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? "text-primary" : m.color}`} />
                {m.label.split(" ")[0]}
              </button>
            );
          })}
        </div>

        {/* Cash calculator */}
        {payMethod === "efectivo" && (
          <div className="space-y-1">
            <Input
              type="number" placeholder="Monto recibido ($)"
              value={cashGiven}
              onChange={(e) => setCashGiven(e.target.value)}
              className="h-8 text-sm bg-muted"
            />
            {Number(cashGiven) > 0 && (
              <div className={`text-xs text-center font-semibold px-2 py-1 rounded-lg ${
                Number(cashGiven) >= cartTotal ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
              }`}>
                {Number(cashGiven) >= cartTotal
                  ? `Cambio: ${formatARS(Number(cashGiven) - cartTotal)}`
                  : `Faltan: ${formatARS(cartTotal - Number(cashGiven))}`
                }
              </div>
            )}
          </div>
        )}

        {/* Total + confirm */}
        <div className="bg-primary/10 rounded-xl px-4 py-3 flex items-center justify-between border border-primary/20">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Total</span>
          <span className="text-xl font-display font-bold text-primary">{formatARS(cartTotal)}</span>
        </div>

        <Button
          className="w-full gradient-gold text-primary-foreground font-semibold h-11 text-base gap-2"
          onClick={confirmSale}
          disabled={cart.length === 0 || submitting || (payMethod === "efectivo" && cashGiven !== "" && Number(cashGiven) < cartTotal)}
        >
          {submitting ? (
            <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Registrando...</>
          ) : (
            <><CheckCircle2 className="w-5 h-5" />Confirmar venta</>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Receipt modal */}
      {receipt && (
        <ReceiptModal
          items={receipt.items}
          payMethod={payMethod}
          customer={customer}
          total={receipt.total}
          cashGiven={receipt.cash}
          businessName={config.businessName || "Gestiona"}
          onClose={() => setReceipt(null)}
          onNewSale={() => { setReceipt(null); clearCart(); }}
        />
      )}

      {/* Barcode scanner overlay */}
      {scanning && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4">
          <p className="text-white font-semibold">Apuntá la cámara al código de barras</p>
          <div className="relative w-72 h-48 rounded-2xl overflow-hidden border-2 border-primary">
            <video ref={videoRef} className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-0.5 bg-primary animate-pulse" />
            </div>
          </div>
          <Button variant="outline" onClick={stopScan}>Cancelar</Button>
        </div>
      )}

      <div className="h-[calc(100vh-4rem)] lg:h-screen flex flex-col">
        {/* Top bar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-card/60 backdrop-blur">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto o marca…"
              className="pl-9 h-9 bg-muted/60 border-border text-sm"
              autoFocus
            />
          </div>
          <Button size="sm" variant="outline" className="h-9 gap-1.5 shrink-0" onClick={() => scanning ? stopScan() : startScan()}>
            <QrCode className="w-4 h-4" />
            <span className="hidden sm:inline">Escanear</span>
          </Button>
          {/* Mobile cart toggle */}
          <Button
            size="sm"
            variant={showCart ? "default" : "outline"}
            className="lg:hidden h-9 relative shrink-0"
            onClick={() => setShowCart(!showCart)}
          >
            <ShoppingCart className="w-4 h-4" />
            {cartQty > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                {cartQty}
              </span>
            )}
          </Button>
        </div>

        {/* Category pills */}
        <div className="shrink-0 flex gap-2 px-4 py-2 overflow-x-auto scrollbar-hide border-b border-border/50 bg-card/40">
          {CATS.map((c) => (
            <button
              key={c.value}
              onClick={() => setCat(c.value)}
              className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                cat === c.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Main area */}
        <div className="flex-1 overflow-hidden flex">
          {/* Product grid */}
          <div className={`flex-1 overflow-y-auto p-3 ${showCart ? "hidden lg:block" : "block"}`}>
            {loadingProds ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Package className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">Sin resultados</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-4 gap-2">
                {filtered.map((prod) => {
                  const inCart = cart.find((it) => it.productId === prod.id);
                  const discP = prod.discount_price_ars ? Number(prod.discount_price_ars) : null;
                  const price = Number(prod.sale_price_ars) || 0;
                  const showDisc = usesDiscount && discP && discP > 0;
                  const displayPrice = showDisc ? discP! : price;
                  const outOfStock = prod.stock <= 0 && !prod.allow_negative_stock;

                  return (
                    <button
                      key={prod.id}
                      onClick={() => !outOfStock && addToCart(prod)}
                      disabled={outOfStock}
                      className={`relative flex flex-col bg-card border rounded-xl overflow-hidden text-left transition-all hover:shadow-md active:scale-95 ${
                        inCart ? "border-primary/60 ring-1 ring-primary/30" : "border-border hover:border-primary/30"
                      } ${outOfStock ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      {/* Image or placeholder */}
                      <div className="w-full aspect-square bg-muted/40 flex items-center justify-center overflow-hidden">
                        {prod.image_url ? (
                          <img src={prod.image_url} alt={prod.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-8 h-8 text-muted-foreground/30" />
                        )}
                      </div>

                      <div className="p-2.5 flex flex-col gap-1">
                        <p className="text-xs font-semibold leading-tight line-clamp-2">{prod.name}</p>
                        {prod.brand && <p className="text-[10px] text-muted-foreground">{prod.brand}</p>}

                        <div className="flex items-center justify-between mt-auto">
                          <div>
                            <p className={`text-sm font-bold font-mono ${showDisc ? "text-primary" : ""}`}>
                              {formatARS(displayPrice)}
                            </p>
                            {showDisc && (
                              <p className="text-[10px] line-through text-muted-foreground/50">{formatARS(price)}</p>
                            )}
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            prod.stock <= 0 ? "bg-red-500/15 text-red-400" :
                            prod.stock <= 3 ? "bg-yellow-500/15 text-yellow-400" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {prod.stock <= 0 ? "Sin stock" : `×${prod.stock}`}
                          </span>
                        </div>
                      </div>

                      {/* In-cart badge */}
                      {inCart && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow">
                          {inCart.quantity}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Desktop cart sidebar */}
          <div className="hidden lg:flex w-80 xl:w-96 flex-col border-l border-border bg-card/60 shrink-0">
            {cartPanel}
          </div>

          {/* Mobile cart slide-up */}
          {showCart && (
            <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 h-[85vh] bg-card border-t border-border rounded-t-2xl shadow-2xl flex flex-col">
              <div className="flex justify-center pt-3 pb-1">
                <button onClick={() => setShowCart(false)} className="text-muted-foreground">
                  <ChevronUp className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {cartPanel}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
