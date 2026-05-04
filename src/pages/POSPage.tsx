import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { getProductsDB, getSettingsDB, addSaleDB, formatARS, validateCouponDB, incrementCouponUse, awardLoyaltyPointsForSale } from "@/lib/supabaseStore";
import { logAudit } from "@/lib/auditLog";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ShoppingCart, Search, Minus, Plus, Trash2, X, CheckCircle2,
  Banknote, ArrowLeftRight, CreditCard, UserX, Zap, Printer,
  QrCode, ChevronUp, Package, MessageCircle, RotateCcw, Link2, Copy, Loader2,
  Ticket, Tag, SplitSquareHorizontal, Percent, DollarSign, Undo2,
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
// Payment method mini selector
// ─────────────────────────────────────────────────────────────
function PayMethodGrid({
  value,
  onChange,
  compact = false,
}: {
  value: PayMethod;
  onChange: (m: PayMethod) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {PAY_METHODS.map((m) => {
        const Icon = m.icon;
        const active = value === m.value;
        return (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
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
  );
}

// ─────────────────────────────────────────────────────────────
// Receipt generator (WhatsApp text)
// ─────────────────────────────────────────────────────────────
function buildReceiptText(
  items: CartItem[],
  payMethod: PayMethod,
  splitMode: boolean,
  splitMethod1: PayMethod,
  splitMethod2: PayMethod,
  splitAmount1: number,
  splitAmount2: number,
  customer: string,
  total: number,
  cashGiven: number,
  businessName: string,
  globalDiscountARS: number,
  couponDiscount: number,
) {
  const lines = items.map(
    (it) => `• ${it.name} x${it.quantity} → ${formatARS(it.price * it.quantity)}`
  );
  const change = !splitMode && payMethod === "efectivo" && cashGiven > total ? cashGiven - total : 0;
  const date = new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

  const paymentLine = splitMode
    ? `Pago: ${PAY_METHODS.find(m => m.value === splitMethod1)?.label} ${formatARS(splitAmount1)} + ${PAY_METHODS.find(m => m.value === splitMethod2)?.label} ${formatARS(splitAmount2)}`
    : `Método: ${PAY_METHODS.find(m => m.value === payMethod)?.label}`;

  return [
    `🧾 *${businessName}*`,
    `📅 ${date}`,
    customer ? `👤 ${customer}` : "",
    "",
    ...lines,
    "",
    couponDiscount > 0 ? `🏷️ Descuento cupón: -${formatARS(couponDiscount)}` : "",
    globalDiscountARS > 0 ? `🔖 Descuento adicional: -${formatARS(globalDiscountARS)}` : "",
    `💰 *Total: ${formatARS(total)}*`,
    paymentLine,
    change > 0 ? `Cambio: ${formatARS(change)}` : "",
    payMethod === "fiado" ? "⚠️ Pendiente de pago" : "✅ Pagado",
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────
// Receipt Modal
// ─────────────────────────────────────────────────────────────
function ReceiptModal({
  items, payMethod, splitMode, splitMethod1, splitMethod2, splitAmount1, splitAmount2,
  customer, total, cashGiven, businessName, orgId, globalDiscountARS, couponDiscount,
  onClose, onNewSale,
}: {
  items: CartItem[]; payMethod: PayMethod;
  splitMode: boolean; splitMethod1: PayMethod; splitMethod2: PayMethod;
  splitAmount1: number; splitAmount2: number;
  customer: string; total: number; cashGiven: number;
  businessName: string; orgId: string;
  globalDiscountARS: number; couponDiscount: number;
  onClose: () => void; onNewSale: () => void;
}) {
  const change = !splitMode && payMethod === "efectivo" && cashGiven > total ? cashGiven - total : 0;
  const receiptText = buildReceiptText(
    items, payMethod, splitMode, splitMethod1, splitMethod2,
    splitAmount1, splitAmount2, customer, total, cashGiven, businessName,
    globalDiscountARS, couponDiscount,
  );
  const [mpLink, setMpLink] = useState("");
  const [mpLoading, setMpLoading] = useState(false);

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(receiptText)}`, "_blank");
  };

  const print = () => {
    const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
    const rows = items.map(it =>
      `<tr><td>${it.name}</td><td align="center">x${it.quantity}</td><td align="right">${formatARS(it.price * it.quantity)}</td></tr>`
    ).join("");

    let discountRows = "";
    if (couponDiscount > 0) discountRows += `<tr><td colspan="2">Desc. cupón</td><td align="right" style="color:green">-${formatARS(couponDiscount)}</td></tr>`;
    if (globalDiscountARS > 0) discountRows += `<tr><td colspan="2">Desc. adicional</td><td align="right" style="color:green">-${formatARS(globalDiscountARS)}</td></tr>`;

    let paymentInfo = "";
    if (splitMode) {
      paymentInfo = `<p>${splitMethod1}: ${formatARS(splitAmount1)} | ${splitMethod2}: ${formatARS(splitAmount2)}</p>`;
    } else {
      paymentInfo = `<p>Pago: ${payMethod.toUpperCase()}</p>`;
      if (payMethod === "efectivo" && cashGiven >= total) {
        paymentInfo += `<p>Recibido: ${formatARS(cashGiven)} — Cambio: ${formatARS(change)}</p>`;
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { font-family: 'Courier New', monospace; font-size: 12px; color: #000; }
  body { width: 72mm; margin: 0; }
  h1 { font-size: 16px; text-align: center; margin: 4px 0; }
  .center { text-align: center; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; }
  .total-row td { font-weight: bold; font-size: 14px; border-top: 1px solid #000; padding-top: 4px; }
  .footer { text-align: center; margin-top: 8px; font-size: 10px; }
</style></head><body>
<h1>${businessName}</h1>
<p class="center">${new Date().toLocaleString("es-AR")}</p>
${customer ? `<p class="center">Cliente: ${customer}</p>` : ""}
<div class="divider"></div>
<table>
  <tbody>${rows}</tbody>
</table>
<div class="divider"></div>
<table>
  <tbody>
    ${discountRows}
    <tr class="total-row"><td colspan="2">TOTAL</td><td align="right">${formatARS(total)}</td></tr>
  </tbody>
</table>
<div class="divider"></div>
${paymentInfo}
<p class="center">${payMethod === "fiado" ? "⚠ PENDIENTE DE PAGO" : "✓ PAGADO"}</p>
<div class="footer">¡Gracias por tu compra!</div>
</body></html>`;

    const w = window.open("", "_blank", "width=400,height=600");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); w.close(); }
  };

  const generateMpLink = async () => {
    setMpLoading(true);
    const { data, error } = await supabase.functions.invoke("mercadopago-link", {
      body: {
        orgId,
        title: `Venta ${businessName}${customer ? ` - ${customer}` : ""}`,
        total,
      },
    });
    setMpLoading(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Error al generar link MP");
      return;
    }
    setMpLink(data.url);
  };

  const copyMpLink = () => {
    navigator.clipboard.writeText(mpLink);
    toast.success("Link copiado");
  };

  const shareMpWhatsApp = () => {
    const text = `💳 Pagá tu compra acá: ${mpLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

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
            {couponDiscount > 0 && (
              <div className="flex justify-between text-xs text-success">
                <span>Descuento cupón</span>
                <span className="font-mono">-{formatARS(couponDiscount)}</span>
              </div>
            )}
            {globalDiscountARS > 0 && (
              <div className="flex justify-between text-xs text-success">
                <span>Descuento adicional</span>
                <span className="font-mono">-{formatARS(globalDiscountARS)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-primary">
              <span>TOTAL</span>
              <span className="font-mono">{formatARS(total)}</span>
            </div>
            {!splitMode && payMethod === "efectivo" && cashGiven >= total && (
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
            {splitMode ? (
              <div className="space-y-0.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{PAY_METHODS.find(m => m.value === splitMethod1)?.label}</span>
                  <span className="font-mono">{formatARS(splitAmount1)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{PAY_METHODS.find(m => m.value === splitMethod2)?.label}</span>
                  <span className="font-mono">{formatARS(splitAmount2)}</span>
                </div>
              </div>
            ) : (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Pago</span>
                <span className="capitalize">{PAY_METHODS.find(m => m.value === payMethod)?.label}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={shareWhatsApp} className="gap-1.5">
              <MessageCircle className="w-4 h-4 text-green-400" />WhatsApp
            </Button>
            <Button variant="outline" size="sm" onClick={print} className="gap-1.5">
              <Printer className="w-4 h-4" />Imprimir
            </Button>
          </div>

          {/* Mercado Pago link */}
          {!mpLink ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/5"
              onClick={generateMpLink}
              disabled={mpLoading}
            >
              {mpLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Generando link…</>
                : <><Link2 className="w-4 h-4" />Generar link Mercado Pago</>
              }
            </Button>
          ) : (
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-xs truncate border-blue-500/30 text-blue-400" onClick={shareMpWhatsApp}>
                <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">MP por WhatsApp</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 border-blue-500/30 text-blue-400" onClick={copyMpLink}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          <Button className="w-full gradient-gold text-primary-foreground gap-1.5" onClick={onNewSale}>
            <RotateCcw className="w-4 h-4" />Nueva venta
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Quick Return Modal
// ─────────────────────────────────────────────────────────────
const REFUND_METHODS = ["efectivo", "transferencia", "credito"] as const;

function QuickReturnModal({ userId, orgId, onClose }: { userId: string; orgId: string; onClose: () => void }) {
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<string>("efectivo");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("sales")
        .select("id, product_name, product_id, quantity, total_ars, customer_name, date, returned")
        .eq("org_id", orgId)
        .eq("returned", false)
        .order("date", { ascending: false })
        .limit(50);
      setRecentSales(data || []);
      setLoading(false);
    })();
  }, [orgId]);

  const filtered = useMemo(() => {
    if (!search) return recentSales;
    const s = search.toLowerCase();
    return recentSales.filter(
      (s2: any) =>
        s2.product_name?.toLowerCase().includes(s) ||
        s2.customer_name?.toLowerCase().includes(s),
    );
  }, [recentSales, search]);

  const handleReturn = async () => {
    if (!selected) return;
    if (!reason.trim()) { toast.error("Ingresá el motivo de la devolución"); return; }
    if (qty < 1 || qty > selected.quantity) { toast.error(`Cantidad inválida (máx ${selected.quantity})`); return; }
    setSubmitting(true);
    try {
      const amountARS = (Number(selected.total_ars) / selected.quantity) * qty;
      await supabase.from("returns" as any).insert({
        org_id: orgId,
        user_id: userId,
        sale_id: selected.id,
        product_name: selected.product_name,
        quantity: qty,
        amount_ars: amountARS,
        reason,
        refund_method: refundMethod,
        notes: "",
      });
      // Restore stock
      if (selected.product_id) {
        const { data: prod } = await supabase
          .from("products")
          .select("stock")
          .eq("id", selected.product_id)
          .single();
        if (prod) {
          await supabase
            .from("products")
            .update({ stock: prod.stock + qty })
            .eq("id", selected.product_id);
        }
      }
      // Mark sale as returned
      await supabase.from("sales").update({ returned: true }).eq("id", selected.id);
      toast.success(`Devolución registrada — ${formatARS(amountARS)}`);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error al registrar devolución");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-orange-400" />
            <h2 className="font-semibold">Devolución rápida</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {!selected ? (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por producto o cliente…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-muted"
                />
              </div>
              {loading ? (
                <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">Sin ventas recientes</p>
              ) : (
                <div className="space-y-2">
                  {filtered.slice(0, 20).map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => { setSelected(s); setQty(1); }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-orange-500/40 hover:bg-orange-500/5 transition-all text-left"
                    >
                      <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{s.product_name}</p>
                        <p className="text-xs text-muted-foreground">{s.customer_name || "Sin nombre"} · {new Date(s.date).toLocaleDateString("es-AR")}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-mono font-semibold">{formatARS(Number(s.total_ars))}</p>
                        <p className="text-[10px] text-muted-foreground">x{s.quantity}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="bg-muted rounded-xl p-3 flex items-center gap-3">
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                  <X className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{selected.product_name}</p>
                  <p className="text-xs text-muted-foreground">{selected.customer_name || "Sin nombre"} · x{selected.quantity} · {formatARS(Number(selected.total_ars))}</p>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cantidad a devolver (máx {selected.quantity})</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted"><Minus className="w-3 h-3" /></button>
                  <span className="text-lg font-bold font-display w-10 text-center">{qty}</span>
                  <button onClick={() => setQty(q => Math.min(selected.quantity, q + 1))} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted"><Plus className="w-3 h-3" /></button>
                  <span className="text-sm text-muted-foreground ml-2">= {formatARS((Number(selected.total_ars) / selected.quantity) * qty)}</span>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Motivo *</label>
                <Input
                  placeholder="Ej: producto defectuoso, cambio de talla…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="bg-muted"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Método de reintegro</label>
                <div className="grid grid-cols-3 gap-2">
                  {REFUND_METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setRefundMethod(m)}
                      className={`py-2 rounded-xl border text-xs font-medium capitalize transition-all ${
                        refundMethod === m
                          ? "border-orange-500/60 bg-orange-500/10 text-orange-400"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold gap-2"
                onClick={handleReturn}
                disabled={submitting || !reason.trim()}
              >
                {submitting
                  ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Registrando…</>
                  : <><Undo2 className="w-4 h-4" />Confirmar devolución</>
                }
              </Button>
            </div>
          )}
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

  // Single payment
  const [payMethod, setPayMethod] = useState<PayMethod>("efectivo");
  const [cashGiven, setCashGiven] = useState("");

  // Split payment
  const [splitMode, setSplitMode] = useState(false);
  const [splitMethod1, setSplitMethod1] = useState<PayMethod>("efectivo");
  const [splitMethod2, setSplitMethod2] = useState<PayMethod>("transferencia");
  const [splitAmount1, setSplitAmount1] = useState("");

  // Global discount
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{
    items: CartItem[]; total: number; cash: number;
    globalDiscountARS: number; couponDiscount: number;
  } | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [loadingProds, setLoadingProds] = useState(true);
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<any>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  // Saved orders (hold carts)
  type SavedOrder = { id: string; label: string; cart: CartItem[]; customer: string; savedAt: string };
  const [savedOrders, setSavedOrders] = useState<SavedOrder[]>(() => {
    try { return JSON.parse(localStorage.getItem("gestiona.pos.saved_orders") || "[]"); } catch { return []; }
  });
  const [showSavedOrders, setShowSavedOrders] = useState(false);

  const saveCurrentOrder = () => {
    if (!cart.length) { toast.error("El carrito está vacío"); return; }
    const order: SavedOrder = {
      id: Date.now().toString(),
      label: customer.trim() || `Pedido ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`,
      cart,
      customer,
      savedAt: new Date().toISOString(),
    };
    const next = [...savedOrders, order];
    setSavedOrders(next);
    localStorage.setItem("gestiona.pos.saved_orders", JSON.stringify(next));
    setCart([]);
    setCustomer("");
    toast.success(`Pedido guardado: ${order.label}`);
  };

  const restoreOrder = (order: SavedOrder) => {
    if (cart.length && !window.confirm("¿Reemplazar el carrito actual con el pedido guardado?")) return;
    setCart(order.cart);
    setCustomer(order.customer);
    const next = savedOrders.filter(o => o.id !== order.id);
    setSavedOrders(next);
    localStorage.setItem("gestiona.pos.saved_orders", JSON.stringify(next));
    setShowSavedOrders(false);
    toast.success(`Pedido "${order.label}" recuperado`);
  };

  const deleteSavedOrder = (id: string) => {
    const next = savedOrders.filter(o => o.id !== id);
    setSavedOrders(next);
    localStorage.setItem("gestiona.pos.saved_orders", JSON.stringify(next));
  };

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

  // ── Cart calculations ──
  const effectivePayMethod = splitMode ? splitMethod1 : payMethod;
  const usesDiscount = PAY_METHODS.find(m => m.value === effectivePayMethod)?.usesDiscount ?? false;

  const priceFor = (item: CartItem) =>
    usesDiscount && item.discountPrice && item.discountPrice > 0 ? item.discountPrice : item.price;

  const cartSubtotal = cart.reduce((s, it) => s + priceFor(it) * it.quantity, 0);

  const couponDiscount = couponResult?.valid
    ? couponResult.coupon.discount_type === "percentage"
      ? cartSubtotal * (couponResult.coupon.discount_value / 100)
      : Math.min(couponResult.coupon.discount_value, cartSubtotal)
    : 0;

  const afterCoupon = Math.max(0, cartSubtotal - couponDiscount);

  const globalDiscountARS = showDiscount && discountValue
    ? discountType === "percent"
      ? afterCoupon * (Math.min(100, Number(discountValue)) / 100)
      : Math.min(Number(discountValue), afterCoupon)
    : 0;

  const cartTotal = Math.max(0, afterCoupon - globalDiscountARS);
  const cartQty = cart.reduce((s, it) => s + it.quantity, 0);

  // Split amounts
  const splitAmt1 = Number(splitAmount1) || 0;
  const splitAmt2 = Math.max(0, cartTotal - splitAmt1);

  const handleValidateCoupon = async () => {
    if (!couponCode.trim() || !user) return;
    setValidatingCoupon(true);
    try {
      const result = await validateCouponDB(user.id, couponCode);
      setCouponResult(result);
      if (result.valid) toast.success(`Cupón aplicado: ${result.coupon.code}`);
      else toast.error(result.reason || "Cupón inválido");
    } catch {
      toast.error("Error al validar cupón");
    } finally {
      setValidatingCoupon(false);
    }
  };

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

  const clearCart = () => {
    setCart([]);
    setCustomer("");
    setCashGiven("");
    setPayMethod("efectivo");
    setSplitMode(false);
    setSplitAmount1("");
    setSplitMethod1("efectivo");
    setSplitMethod2("transferencia");
    setCouponCode("");
    setCouponResult(null);
    setShowDiscount(false);
    setDiscountValue("");
  };

  // ── Confirm sale ──
  const confirmSale = async () => {
    if (!user || !activeOrg || !cart.length) return;

    // Validate split payment
    if (splitMode) {
      if (splitAmt1 <= 0) { toast.error("Ingresá el monto del primer método"); return; }
      if (splitAmt1 > cartTotal) { toast.error("El primer monto supera el total"); return; }
      if (splitMethod1 === splitMethod2) { toast.error("Los dos métodos deben ser diferentes"); return; }
    }

    const orgId = activeOrg.id;
    setSubmitting(true);
    try {
      const isPaid = splitMode
        ? splitMethod1 !== "fiado" && splitMethod2 !== "fiado"
        : payMethod !== "fiado";
      const primaryMethod = splitMode
        ? (splitAmt1 >= splitAmt2 ? splitMethod1 : splitMethod2)
        : payMethod;
      const date = new Date().toISOString();

      for (const item of cart) {
        const unitPrice = priceFor(item);
        const lineTotal = unitPrice * item.quantity;
        const proportion = cartTotal > 0 ? lineTotal / cartSubtotal : 0;

        // Distribute global discount proportionally across items
        const itemGlobalDiscount = globalDiscountARS * proportion;
        const itemCouponDiscount = couponDiscount * proportion;
        const adjustedTotal = Math.max(0, lineTotal - itemGlobalDiscount - itemCouponDiscount);

        const costARS = item.costUSD * item.exchangeRate;
        const profitARS = adjustedTotal - costARS * item.quantity;
        const profitUSD = item.exchangeRate > 0 ? profitARS / item.exchangeRate : 0;

        const splitPayments = splitMode ? [
          { method: splitMethod1, amount: Math.round(adjustedTotal * (splitAmt1 / cartTotal)) },
          { method: splitMethod2, amount: Math.round(adjustedTotal * (splitAmt2 / cartTotal)) },
        ] : null;

        const saleData: any = {
          id: crypto.randomUUID(),
          user_id: user.id,
          org_id: orgId,
          product_id: item.productId,
          product_name: item.name,
          quantity: item.quantity,
          unit_price_ars: unitPrice,
          discount_applied: usesDiscount && !!item.discountPrice,
          total_ars: adjustedTotal,
          cost_per_unit_usd: item.costUSD,
          profit_ars: profitARS,
          profit_usd: profitUSD,
          customer_name: customer.trim() || null,
          date,
          paid: isPaid,
          payment_method: primaryMethod,
          split_payments: splitPayments,
          global_discount_ars: itemGlobalDiscount > 0 ? itemGlobalDiscount : null,
          coupon_id: couponResult?.valid ? couponResult.coupon.id : null,
        };

        await addSaleDB(saleData);
        await logAudit(user.id, "create", "sale", saleData.id, {
          product: item.name,
          total: adjustedTotal,
          method: splitMode ? `split:${splitMethod1}+${splitMethod2}` : payMethod,
          source: "pos",
        });
      }

      if (couponResult?.valid) await incrementCouponUse(couponResult.coupon.id);

      // Award loyalty points (best-effort)
      if (customer.trim()) {
        awardLoyaltyPointsForSale(orgId, customer.trim(), cartTotal, cart[0]?.productId ?? "").catch(() => {});
      }

      // Outbound webhook: sale.created (best-effort)
      if (settings?.webhook_enabled && settings?.webhook_url) {
        supabase.functions.invoke("send-webhook", {
          body: {
            event: "sale.created",
            data: {
              customer: customer.trim() || null,
              total_ars: cartTotal,
              items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
              payment_method: splitMode ? `${splitMethod1}+${splitMethod2}` : payMethod,
            },
          },
        }).catch(() => {});
      }

      // Large sale notification (best-effort)
      const largeThreshold = Number(settings?.large_sale_threshold_ars) || 50_000;
      if (cartTotal >= largeThreshold && user) {
        supabase.from("notifications").insert({
          user_id: user.id,
          org_id: orgId,
          type: "venta_grande",
          title: `Venta grande: ${formatARS(cartTotal)}`,
          message: customer.trim() ? `Cliente: ${customer.trim()}` : "Venta sin nombre de cliente",
          read: false,
        }).then(() => {}).catch(() => {});
      }

      setProducts(await getProductsDB(user.id));

      setReceipt({
        items: [...cart],
        total: cartTotal,
        cash: Number(cashGiven) || 0,
        globalDiscountARS,
        couponDiscount,
      });
      toast.success(`Venta de ${formatARS(cartTotal)} registrada`);
    } catch (e: any) {
      toast.error(e.message || "Error al registrar");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Confirm button disabled condition ──
  const confirmDisabled =
    cart.length === 0 ||
    submitting ||
    (splitMode && splitAmt1 <= 0) ||
    (!splitMode && payMethod === "efectivo" && cashGiven !== "" && Number(cashGiven) < cartTotal);

  // ─────────────────────────────────────────────────────────
  // Cart panel
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
        <div className="flex items-center gap-2">
          {savedOrders.length > 0 && (
            <button onClick={() => setShowSavedOrders(true)} className="text-xs text-primary flex items-center gap-1 hover:opacity-80">
              <Package className="w-3 h-3" />{savedOrders.length} guardado{savedOrders.length !== 1 ? "s" : ""}
            </button>
          )}
          {cart.length > 0 && (
            <button onClick={saveCurrentOrder} className="text-xs text-muted-foreground hover:text-warning flex items-center gap-1" title="Guardar carrito para después">
              <Undo2 className="w-3 h-3" />Guardar
            </button>
          )}
          {cart.length > 0 && (
            <button onClick={clearCart} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
              <Trash2 className="w-3 h-3" />Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Saved orders panel */}
      {showSavedOrders && (
        <div className="border-b border-border bg-muted/20 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">Pedidos guardados</span>
            <button onClick={() => setShowSavedOrders(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
          </div>
          {savedOrders.map(order => (
            <div key={order.id} className="flex items-center justify-between gap-2 bg-card rounded-lg px-3 py-2 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{order.label}</p>
                <p className="text-muted-foreground">{order.cart.length} ítem{order.cart.length !== 1 ? "s" : ""} · {new Date(order.savedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => restoreOrder(order)}>Recuperar</Button>
                <button onClick={() => deleteSavedOrder(order.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

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

        {/* Payment section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Método de pago</span>
            <button
              onClick={() => { setSplitMode(!splitMode); setSplitAmount1(""); }}
              className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg border transition-all ${
                splitMode
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30"
              }`}
            >
              <SplitSquareHorizontal className="w-3 h-3" />
              Dividir pago
            </button>
          </div>

          {!splitMode ? (
            <>
              <PayMethodGrid value={payMethod} onChange={setPayMethod} />
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
            </>
          ) : (
            /* Split payment mode */
            <div className="space-y-2">
              {/* Method 1 */}
              <div className="bg-muted/40 rounded-xl p-2.5 space-y-2">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Método 1</span>
                <PayMethodGrid value={splitMethod1} onChange={setSplitMethod1} />
                <Input
                  type="number"
                  placeholder="Monto ($)"
                  value={splitAmount1}
                  onChange={(e) => setSplitAmount1(e.target.value)}
                  className="h-8 text-sm bg-card"
                />
              </div>
              {/* Method 2 */}
              <div className="bg-muted/40 rounded-xl p-2.5 space-y-2">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Método 2</span>
                <PayMethodGrid value={splitMethod2} onChange={setSplitMethod2} />
                <div className={`h-8 flex items-center px-3 rounded-lg border text-sm font-mono ${
                  splitAmt2 > 0 ? "bg-primary/10 border-primary/30 text-primary" : "bg-card border-border text-muted-foreground"
                }`}>
                  {splitAmt1 > 0 ? formatARS(splitAmt2) : "Resto automático"}
                </div>
              </div>
              {splitAmt1 > 0 && splitAmt2 >= 0 && (
                <div className="text-[10px] text-center text-muted-foreground">
                  {formatARS(splitAmt1)} + {formatARS(splitAmt2)} = {formatARS(cartTotal)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Coupon */}
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Ticket className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Código de cupón"
                value={couponCode}
                onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); if (couponResult) setCouponResult(null); }}
                className="h-8 text-sm bg-muted pl-8 uppercase"
                onKeyDown={(e) => e.key === "Enter" && handleValidateCoupon()}
              />
            </div>
            <Button
              variant="outline" size="sm" className="h-8 px-3 text-xs shrink-0"
              onClick={handleValidateCoupon}
              disabled={!couponCode.trim() || validatingCoupon}
            >
              {validatingCoupon ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Aplicar"}
            </Button>
          </div>
          {couponResult?.valid && (
            <div className="flex items-center justify-between text-xs bg-success/10 text-success px-3 py-1.5 rounded-lg border border-success/20">
              <span className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                {couponResult.coupon.code} — {couponResult.coupon.discount_type === "percentage"
                  ? `${couponResult.coupon.discount_value}% off`
                  : `${formatARS(couponResult.coupon.discount_value)} off`}
              </span>
              <button onClick={() => { setCouponResult(null); setCouponCode(""); }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Global discount toggle */}
        <div className="space-y-1.5">
          <button
            onClick={() => { setShowDiscount(!showDiscount); setDiscountValue(""); }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
              showDiscount
                ? "border-primary/40 bg-primary/5 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/30"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              Descuento adicional
            </span>
            {showDiscount && globalDiscountARS > 0 && (
              <span className="text-success font-mono">-{formatARS(globalDiscountARS)}</span>
            )}
          </button>

          {showDiscount && (
            <div className="bg-muted/40 rounded-xl p-2.5 space-y-2">
              {/* Type toggle */}
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => { setDiscountType("percent"); setDiscountValue(""); }}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    discountType === "percent"
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  <Percent className="w-3 h-3" />Porcentaje
                </button>
                <button
                  onClick={() => { setDiscountType("fixed"); setDiscountValue(""); }}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    discountType === "fixed"
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  <DollarSign className="w-3 h-3" />Monto fijo
                </button>
              </div>
              <Input
                type="number"
                placeholder={discountType === "percent" ? "Ej: 10 (para 10%)" : "Monto en $"}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="h-8 text-sm bg-card"
                min={0}
                max={discountType === "percent" ? 100 : undefined}
              />
              {globalDiscountARS > 0 && (
                <div className="text-xs text-center text-success font-medium">
                  Descuento: -{formatARS(globalDiscountARS)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Total + confirm */}
        <div className="bg-primary/10 rounded-xl px-4 py-3 border border-primary/20 space-y-1">
          {cartSubtotal !== cartTotal && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono">{formatARS(cartSubtotal)}</span>
            </div>
          )}
          {couponDiscount > 0 && (
            <div className="flex items-center justify-between text-xs text-success">
              <span>Descuento cupón</span>
              <span className="font-mono">-{formatARS(couponDiscount)}</span>
            </div>
          )}
          {globalDiscountARS > 0 && (
            <div className="flex items-center justify-between text-xs text-success">
              <span>Desc. adicional</span>
              <span className="font-mono">-{formatARS(globalDiscountARS)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Total</span>
            <span className="text-xl font-display font-bold text-primary">{formatARS(cartTotal)}</span>
          </div>
          {splitMode && splitAmt1 > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
              <span>{PAY_METHODS.find(m => m.value === splitMethod1)?.label}</span>
              <span className="font-mono">{formatARS(splitAmt1)}</span>
            </div>
          )}
          {splitMode && splitAmt1 > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{PAY_METHODS.find(m => m.value === splitMethod2)?.label}</span>
              <span className="font-mono">{formatARS(splitAmt2)}</span>
            </div>
          )}
        </div>

        <Button
          className="w-full gradient-gold text-primary-foreground font-semibold h-11 text-base gap-2"
          onClick={confirmSale}
          disabled={confirmDisabled}
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
      {/* Quick Return modal */}
      {showReturn && user && activeOrg && (
        <QuickReturnModal
          userId={user.id}
          orgId={activeOrg.id}
          onClose={() => setShowReturn(false)}
        />
      )}

      {/* Receipt modal */}
      {receipt && (
        <ReceiptModal
          items={receipt.items}
          payMethod={payMethod}
          splitMode={splitMode}
          splitMethod1={splitMethod1}
          splitMethod2={splitMethod2}
          splitAmount1={splitAmt1}
          splitAmount2={splitAmt2}
          customer={customer}
          total={receipt.total}
          cashGiven={receipt.cash}
          businessName={config.businessName || "Gestiona"}
          orgId={activeOrg?.id || ""}
          globalDiscountARS={receipt.globalDiscountARS}
          couponDiscount={receipt.couponDiscount}
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
          <Button size="sm" variant="outline" className="h-9 gap-1.5 shrink-0 border-orange-500/40 text-orange-400 hover:bg-orange-500/10" onClick={() => setShowReturn(true)}>
            <Undo2 className="w-4 h-4" />
            <span className="hidden sm:inline">Devolver</span>
          </Button>
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
