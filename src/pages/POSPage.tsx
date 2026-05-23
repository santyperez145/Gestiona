import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { getProductsDB, getSettingsDB, addSaleDB, deleteSaleDB, formatARS, validateCouponDB, incrementCouponUse, awardLoyaltyPointsForSale, getVariantsByUserDB } from "@/lib/supabaseStore";
import { logAudit } from "@/lib/auditLog";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ShoppingCart, Search, Minus, Plus, Trash2, X, CheckCircle2,
  Banknote, ArrowLeftRight, CreditCard, UserX, User, Zap, Printer,
  QrCode, ChevronUp, Package, MessageCircle, RotateCcw, Link2, Copy, Loader2,
  Ticket, Tag, SplitSquareHorizontal, Percent, DollarSign, Undo2, WifiOff, RefreshCw, BarChart2, Sun, Moon, Mail, Layers, Maximize2, Minimize2, Pencil, Check, AlertCircle, Mic, MicOff, HelpCircle, Keyboard,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useWakeLock } from "@/hooks/useWakeLock";
import { usePriceList } from "@/hooks/usePriceList";
import { BrowserMultiFormatReader } from "@zxing/browser";
import Fuse from "fuse.js";
import confetti from "canvas-confetti";

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
  customPrice?: number | null;   // per-item price override set in cart
  category?: string;
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
            className={`flex flex-col items-center gap-0.5 py-2 rounded-[8px] border text-[10px] font-medium transition-all ${
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
  note, onClose, onNewSale,
}: {
  items: CartItem[]; payMethod: PayMethod;
  splitMode: boolean; splitMethod1: PayMethod; splitMethod2: PayMethod;
  splitAmount1: number; splitAmount2: number;
  customer: string; total: number; cashGiven: number;
  businessName: string; orgId: string;
  globalDiscountARS: number; couponDiscount: number;
  note?: string;
  onClose: () => void; onNewSale: () => void;
}) {
  const change = !splitMode && payMethod === "efectivo" && cashGiven > total ? cashGiven - total : 0;
  const [emailTo, setEmailTo] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const sendReceiptEmail = async () => {
    const trimmed = emailTo.trim().toLowerCase();
    if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      toast.error("Ingresá un email válido");
      return;
    }
    setSendingEmail(true);
    try {
      const itemsText = items.map(it => `• ${it.quantity}× ${it.name} — ${formatARS(it.price * it.quantity)}`).join("\n");
      const { error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          to: trimmed,
          subject: `Recibo de compra — ${businessName}`,
          invoiceNumber: `REC-${Date.now().toString().slice(-6)}`,
          customerName: customer || "Cliente",
          orgName: businessName,
          totalARS: total,
          dueDate: null,
          notes: itemsText,
        },
      });
      if (error) throw error;
      setEmailSent(true);
      toast.success(`Recibo enviado a ${trimmed}`);
    } catch {
      toast.error("Error al enviar el recibo");
    } finally {
      setSendingEmail(false);
    }
  };

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
${note ? `<div class="divider"></div><div style="font-size:10px;padding:3px 0"><span style="font-weight:bold">Nota:</span> ${note}</div>` : ""}
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
      <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] w-full max-w-sm shadow-2xl animate-fade-in">
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
          {note && (
            <div className="mt-3 pt-3 border-t border-dashed border-border">
              <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Nota interna</p>
              <p className="text-xs italic text-amber-400/80">{note}</p>
            </div>
          )}
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

          {/* Email receipt */}
          {!emailSent ? (
            <div className="flex gap-1.5">
              <Input
                type="email"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                placeholder="email@cliente.com"
                className="h-9 text-sm bg-muted border-border flex-1"
                onKeyDown={e => e.key === "Enter" && sendReceiptEmail()}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={sendReceiptEmail}
                disabled={sendingEmail || !emailTo.trim()}
                className="h-9 gap-1.5 shrink-0 border-blue-500/30 text-blue-400 hover:bg-blue-500/5"
              >
                {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-success text-center">✓ Recibo enviado a {emailTo}</p>
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
      await supabase.from("returns").insert({
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
      <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                      className="w-full flex items-center gap-3 p-3 rounded-[10px] border border-border hover:border-orange-500/40 hover:bg-orange-500/5 transition-all text-left"
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
              <div className="bg-muted rounded-[10px] p-3 flex items-center gap-3">
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
                      className={`py-2 rounded-[8px] border text-xs font-medium capitalize transition-all ${
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
  usePageTitle("POS — Punto de Venta");
  // Keep screen awake while POS is open — prevents display from dimming mid-transaction
  useWakeLock({ active: true });
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const config = useBusinessConfig();
  const { checkSalesLimit } = usePlanLimits();

  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [topProductIds, setTopProductIds] = useState<Set<string>>(new Set());
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, any[]>>({});
  const [variantPickerProduct, setVariantPickerProduct] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [showBundles, setShowBundles] = useState(false);
  const [bundles, setBundles] = useState<Array<{ id: string; name: string; description: string | null; price_ars: number; bundle_items: { product_id: string; quantity: number }[] }>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceVal, setEditingPriceVal] = useState("");
  const [customer, setCustomer] = useState("");
  const [posNote, setPosNote] = useState("");
  const [showRecentCustomers, setShowRecentCustomers] = useState(false);
  const [recentCustomers] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("gestiona.pos.recent_customers") || "[]"); }
    catch { return []; }
  });

  const saveRecentCustomer = (name: string) => {
    if (!name.trim()) return;
    const existing: string[] = (() => {
      try { return JSON.parse(localStorage.getItem("gestiona.pos.recent_customers") || "[]"); }
      catch { return []; }
    })();
    const updated = [name.trim(), ...existing.filter(c => c.toLowerCase() !== name.trim().toLowerCase())].slice(0, 8);
    localStorage.setItem("gestiona.pos.recent_customers", JSON.stringify(updated));
  };

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

  // Category discounts
  const catDiscKey = `gestiona.pos.catDisc.${activeOrg?.id || 'default'}`;
  const [categoryDiscounts, setCategoryDiscounts] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(catDiscKey) || '{}'); } catch { return {}; }
  });
  const [showCatDiscount, setShowCatDiscount] = useState(false);
  const saveCatDiscounts = (next: Record<string, number>) => {
    setCategoryDiscounts(next);
    localStorage.setItem(catDiscKey, JSON.stringify(next));
  };

  // VIP auto-discount based on loyalty tier
  const [vipTier, setVipTier] = useState<{ name: string; pct: number; points: number } | null>(null);
  const [vipLoading, setVipLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{
    items: CartItem[]; total: number; cash: number;
    globalDiscountARS: number; couponDiscount: number; note: string;
  } | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [loadingProds, setLoadingProds] = useState(true);
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<any>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [showReturn, setShowReturn] = useState(false);

  // POS-specific light/dark theme (independent of global app theme)
  const posThemeKey = `gestiona.pos.theme.${activeOrg?.id || 'default'}`;
  const [posTheme, setPosTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem(`gestiona.pos.theme.${activeOrg?.id || 'default'}`) as 'dark' | 'light') || 'dark'
  );
  const togglePosTheme = () => {
    const next = posTheme === 'dark' ? 'light' : 'dark';
    setPosTheme(next);
    localStorage.setItem(posThemeKey, next);
  };

  // Seller on shift (localStorage per org)
  const sellerKey = `gestiona.pos.seller.${activeOrg?.id || 'default'}`;
  const [sellerName, setSellerName] = useState(() => localStorage.getItem(`gestiona.pos.seller.${activeOrg?.id || 'default'}`) || "");
  const [showSellerPrompt, setShowSellerPrompt] = useState(false);
  const [sellerInput, setSellerInput] = useState("");

  // Turno (shift) sales tracking — accumulates each successful checkout
  const [turnoSales, setTurnoSales] = useState<Array<{ items: CartItem[]; total: number; method: string; customer: string; ts: number; saleIds: string[] }>>([]);
  const [showTurnoHistory, setShowTurnoHistory] = useState(false);
  const [showTurnoSummary, setShowTurnoSummary] = useState(false);

  useEffect(() => {
    if (!sellerName) setShowSellerPrompt(true);
  }, []);

  // Fullscreen state (reactive via fullscreenchange event)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Offline mode
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineSales, setOfflineSales] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem(`gestiona.pos.offline_sales.${activeOrg?.id || 'default'}`) || "[]"); } catch { return []; }
  });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, []);

  const offlineKey = `gestiona.pos.offline_sales.${activeOrg?.id || 'default'}`;

  const syncOfflineSales = async () => {
    if (!offlineSales.length || !isOnline) return;
    setSyncing(true);
    let synced = 0;
    const remaining = [...offlineSales];
    for (let i = remaining.length - 1; i >= 0; i--) {
      try {
        await addSaleDB(remaining[i]);
        remaining.splice(i, 1);
        synced++;
      } catch { /* keep it in queue */ }
    }
    setOfflineSales(remaining);
    localStorage.setItem(offlineKey, JSON.stringify(remaining));
    setSyncing(false);
    if (synced > 0) toast.success(`${synced} venta${synced !== 1 ? "s" : ""} sincronizada${synced !== 1 ? "s" : ""} correctamente`);
  };

  // Pending debt alert for selected customer
  // Price list — auto-applied when customer has one assigned
  const [customerPriceListId, setCustomerPriceListId] = useState<string | null>(null);
  const { meta: activePriceList, getPrice } = usePriceList(customerPriceListId);

  const [customerDebt, setCustomerDebt] = useState<number | null>(null);
  useEffect(() => {
    setCustomerDebt(null);
    setCustomerPriceListId(null);
    if (!activeOrg || !customer.trim() || customer.trim().length < 3) return;
    const timeout = setTimeout(async () => {
      const [debtRes, customerRes] = await Promise.all([
        supabase
          .from("debts")
          .select("remaining_ars")
          .eq("org_id", activeOrg.id)
          .ilike("customer_name", `%${customer.trim()}%`)
          .neq("status", "paid"),
        supabase
          .from("customers")
          .select("price_list_id")
          .eq("org_id", activeOrg.id)
          .ilike("name", `%${customer.trim()}%`)
          .limit(1)
          .maybeSingle(),
      ]);
      const total = (debtRes.data || []).reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
      setCustomerDebt(total > 0 ? total : null);
      setCustomerPriceListId((customerRes.data as any)?.price_list_id ?? null);
    }, 600);
    return () => clearTimeout(timeout);
  }, [customer, activeOrg]);

  // VIP loyalty tier lookup — fires when customer name settles (debounced)
  useEffect(() => {
    if (!activeOrg || !customer.trim() || customer.trim().length < 3) {
      setVipTier(null);
      return;
    }
    const timeout = setTimeout(async () => {
      setVipLoading(true);
      try {
        const { data } = await supabase
          .from("loyalty_points")
          .select("delta")
          .eq("org_id", activeOrg.id)
          .ilike("customer_name", customer.trim());
        const balance = (data || []).reduce((s: number, r: any) => s + Number(r.delta), 0);
        if (balance >= 1000) {
          const tier = { name: "Platino", pct: 10, points: balance };
          setVipTier(tier);
          setShowDiscount(true);
          setDiscountType("percent");
          setDiscountValue("10");
        } else if (balance >= 500) {
          const tier = { name: "Oro", pct: 5, points: balance };
          setVipTier(tier);
          setShowDiscount(true);
          setDiscountType("percent");
          setDiscountValue("5");
        } else if (balance >= 100) {
          setVipTier({ name: "Plata", pct: 2, points: balance });
          setShowDiscount(true);
          setDiscountType("percent");
          setDiscountValue("2");
        } else {
          setVipTier(null);
        }
      } catch { setVipTier(null); }
      finally { setVipLoading(false); }
    }, 700);
    return () => clearTimeout(timeout);
  }, [customer, activeOrg]);

  // Keyboard shortcuts
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      // F1 / ? → show keyboard shortcuts help
      if (e.key === 'F1' || (e.key === '?' && !inInput)) { e.preventDefault(); setShowShortcutHelp(v => !v); return; }
      // F2 → focus product search
      if (e.key === 'F2') { e.preventDefault(); searchInputRef.current?.focus(); searchInputRef.current?.select(); return; }
      // F5 / F11 → toggle fullscreen
      if (e.key === 'F5' || e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
      // Escape → close help overlay first, then clear search, then cart
      if (e.key === 'Escape') {
        if (showShortcutHelp) { setShowShortcutHelp(false); return; }
        if (!inInput) { if (search) setSearch(''); else if (cart.length > 0) setCart([]); return; }
      }
      // F9 → confirm sale (if cart has items and sale not disabled)
      if (e.key === 'F9') { e.preventDefault(); if (cart.length > 0 && !confirmDisabled) confirmSale(); return; }
      // + key → increment qty of last cart item
      if (e.key === '+' && !inInput && cart.length > 0) {
        e.preventDefault();
        setCart(prev => prev.map((it, i) => i === prev.length - 1 ? { ...it, quantity: it.quantity + 1 } : it));
        return;
      }
      // - key → decrement qty of last cart item
      if (e.key === '-' && !inInput && cart.length > 0) {
        e.preventDefault();
        setCart(prev => prev.map((it, i) => i === prev.length - 1 ? { ...it, quantity: Math.max(1, it.quantity - 1) } : it));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, search, confirmDisabled, showShortcutHelp, toggleFullscreen]);

  // ── Voice commands (Web Speech API) ──────────────────────────────────────────
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const SpeechRecognitionAPI = typeof window !== 'undefined'
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;
  const voiceSupported = !!SpeechRecognitionAPI;

  const toggleVoice = useCallback(() => {
    if (!SpeechRecognitionAPI) { toast.error("Tu navegador no soporta comandos de voz"); return; }
    if (voiceActive) {
      recognitionRef.current?.stop();
      setVoiceActive(false);
      setVoiceTranscript('');
      return;
    }
    const rec = new SpeechRecognitionAPI();
    rec.lang = 'es-AR';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setVoiceTranscript(transcript);
      if (e.results[e.results.length - 1].isFinal) {
        processVoiceCommand(transcript.toLowerCase());
        setVoiceActive(false);
        setVoiceTranscript('');
      }
    };
    rec.onerror = () => { setVoiceActive(false); setVoiceTranscript(''); toast.error("Error de micrófono"); };
    rec.onend = () => setVoiceActive(false);
    recognitionRef.current = rec;
    rec.start();
    setVoiceActive(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive, SpeechRecognitionAPI]);

  const processVoiceCommand = useCallback((cmd: string) => {
    // "vende X [unidades] de [producto]" | "agrega X [producto]" | "busca [producto]"
    const sellMatch = cmd.match(/(?:vend[eé]|agreg[aá]|a[ñn]ad[eé]|pone)\s+(\d+)?\s*(?:unidades?\s+de\s+)?(.+)/i);
    const searchMatch = cmd.match(/(?:busca|busc[aá]r?|encontr[aá]r?)\s+(.+)/i);
    const clearMatch = cmd.match(/(?:limpi[aá]r?|vaciá?r?|cancel[aá]r?)\s*(?:carrito)?/i);
    const clientMatch = cmd.match(/(?:cliente|para)\s+(.+)/i);

    if (clearMatch) { setCart([]); toast.success("🎤 Carrito vaciado"); return; }
    if (clientMatch) { setCustomer(clientMatch[1].trim()); toast.success(`🎤 Cliente: ${clientMatch[1].trim()}`); return; }
    if (searchMatch) { setSearch(searchMatch[1].trim()); toast.success(`🎤 Buscando: ${searchMatch[1].trim()}`); return; }
    if (sellMatch) {
      const qty = parseInt(sellMatch[1] || '1', 10);
      const productQuery = sellMatch[2].trim();
      setSearch(productQuery);
      // Wait for fuse.js to filter, then add first result
      setTimeout(() => {
        const fuse = new Fuse(products, { keys: ['name', 'brand'], threshold: 0.5, ignoreLocation: true });
        const results = fuse.search(productQuery);
        if (results[0]) {
          const p = results[0].item;
          setCart(prev => {
            const key = p.id;
            const existing = prev.find(i => i.id === key);
            if (existing) return prev.map(i => i.id === key ? { ...i, quantity: i.quantity + qty } : i);
            return [...prev, { ...p, quantity: qty, id: key }];
          });
          setSearch('');
          toast.success(`🎤 ${qty}× ${p.name} al carrito`);
        } else {
          toast.error(`🎤 No encontré "${productQuery}"`);
        }
      }, 300);
    } else {
      // Fallback: use as search
      setSearch(cmd);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

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
      const since30 = new Date(); since30.setDate(since30.getDate() - 30);
      const [prods, sett, { data: recentSales }, allVariants] = await Promise.all([
        getProductsDB(user.id),
        getSettingsDB(user.id),
        supabase.from('sales').select('product_id, quantity').gte('date', since30.toISOString().slice(0, 10)),
        getVariantsByUserDB(user.id).catch(() => []),
      ]);
      setProducts(prods);
      setSettings(sett);
      // Group variants by product_id
      const varMap: Record<string, any[]> = {};
      (allVariants || []).forEach((v: any) => {
        if (!varMap[v.product_id]) varMap[v.product_id] = [];
        varMap[v.product_id].push(v);
      });
      setVariantsByProduct(varMap);
      setLoadingProds(false);
      // Compute top-5 products by units sold in last 30 days
      const vel: Record<string, number> = {};
      (recentSales || []).forEach((s: any) => { if (s.product_id) vel[s.product_id] = (vel[s.product_id] || 0) + Number(s.quantity || 1); });
      const top5 = Object.entries(vel).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
      setTopProductIds(new Set(top5));
    })();
  }, [user]);

  // ── Load bundles for POS ──
  useEffect(() => {
    if (!activeOrg?.id) return;
    supabase
      .from("product_bundles")
      .select("id,name,description,price_ars,bundle_items(product_id,quantity)")
      .eq("org_id", activeOrg.id)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setBundles((data || []) as any));
  }, [activeOrg?.id]);

  // ── Filtered products ──
  const filtered = useMemo(() => {
    let list = products.filter((p) => p.stock > 0 || p.allow_negative_stock);
    if (cat !== "all") list = list.filter((p) => p.category === cat);
    if (search) {
      // Exact barcode/SKU match takes priority
      const exactBarcode = list.find(p => p.barcode === search.trim() || p.sku === search.trim());
      if (exactBarcode) return [exactBarcode];
      // Fuse.js fuzzy search — handles typos, partial matches, accent-insensitive
      const fuse = new Fuse(list, {
        keys: [
          { name: 'name', weight: 0.6 },
          { name: 'brand', weight: 0.3 },
          { name: 'description', weight: 0.1 },
        ],
        threshold: 0.4,      // 0=exact, 1=match anything — 0.4 is comfortably fuzzy
        minMatchCharLength: 2,
        ignoreLocation: true, // match anywhere in string, not just from start
      });
      return fuse.search(search).map(r => r.item);
    }
    return list;
  }, [products, cat, search]);

  // ── Cart calculations ──
  const effectivePayMethod = splitMode ? splitMethod1 : payMethod;
  const usesDiscount = PAY_METHODS.find(m => m.value === effectivePayMethod)?.usesDiscount ?? false;

  const priceFor = (item: CartItem) => {
    if (item.customPrice != null && item.customPrice > 0) return item.customPrice;
    return usesDiscount && item.discountPrice && item.discountPrice > 0 ? item.discountPrice : item.price;
  };

  const cartSubtotal = cart.reduce((s, it) => s + priceFor(it) * it.quantity, 0);

  // Category discount: sum per-item discounts based on configured category %
  const catDiscountARS = cart.reduce((s, it) => {
    const pct = it.category ? (categoryDiscounts[it.category] || 0) : 0;
    if (pct <= 0) return s;
    return s + priceFor(it) * it.quantity * (pct / 100);
  }, 0);

  const afterCatDiscount = Math.max(0, cartSubtotal - catDiscountARS);

  const couponDiscount = couponResult?.valid
    ? couponResult.coupon.discount_type === "percentage"
      ? afterCatDiscount * (couponResult.coupon.discount_value / 100)
      : Math.min(couponResult.coupon.discount_value, afterCatDiscount)
    : 0;

  const afterCoupon = Math.max(0, afterCatDiscount - couponDiscount);

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

  const addToCart = useCallback((prod: any, variantOverride?: { id: string; name: string; stock: number; price?: number }) => {
    const cartKey = variantOverride ? `${prod.id}__${variantOverride.id}` : prod.id;
    const stockLimit = variantOverride ? variantOverride.stock : prod.stock;
    // Use price list adjusted price if a customer with a list is selected
    const basePrice = variantOverride?.price ?? Number(prod.sale_price_ars);
    const price = customerPriceListId ? getPrice({ id: prod.id, sale_price_ars: basePrice }) : (basePrice || 0);
    const displayName = variantOverride ? `${prod.name} · ${variantOverride.name}` : prod.name;
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.productId === cartKey);
      if (idx >= 0) {
        if (prev[idx].quantity >= stockLimit && stockLimit > 0) {
          toast.warning("Sin stock suficiente");
          return prev;
        }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [...prev, {
        productId: cartKey,
        name: displayName,
        brand: prod.brand,
        price,
        discountPrice: prod.discount_price_ars ? Number(prod.discount_price_ars) : null,
        costUSD: Number(prod.total_cost_usd) || 0,
        exchangeRate: Number(settings?.exchange_rate) || 1695,
        quantity: 1,
        stock: stockLimit,
        imageUrl: prod.image_url || null,
        useDiscount: false,
        category: prod.category || '',
      }];
    });
    setShowCart(true);
    if (variantPickerProduct) setVariantPickerProduct(null);
  }, [settings, variantPickerProduct]);

  // ── Bundle: explode into individual cart items ──
  const addBundleToCart = (bundle: typeof bundles[0]) => {
    const exchangeRate = Number(settings?.exchange_rate) || 1695;
    let addedCount = 0;
    bundle.bundle_items.forEach(item => {
      const prod = products.find(p => p.id === item.product_id);
      if (!prod) return;
      for (let i = 0; i < item.quantity; i++) {
        const price = customerPriceListId ? getPrice({ id: prod.id, sale_price_ars: Number(prod.sale_price_ars) }) : Number(prod.sale_price_ars);
        setCart(prev => {
          const idx = prev.findIndex(it => it.productId === prod.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
            return updated;
          }
          return [...prev, {
            productId: prod.id,
            name: prod.name,
            brand: prod.brand || '',
            price,
            discountPrice: prod.discount_price_ars ? Number(prod.discount_price_ars) : null,
            costUSD: Number(prod.total_cost_usd) || 0,
            exchangeRate,
            quantity: 1,
            stock: prod.stock,
            imageUrl: prod.image_url || null,
            useDiscount: false,
            category: prod.category || '',
          }];
        });
        addedCount++;
      }
    });
    // Override the total with bundle price by adding a price-override note
    toast.success(`Kit "${bundle.name}" agregado · ${bundle.bundle_items.length} producto${bundle.bundle_items.length !== 1 ? 's' : ''}`, {
      description: `Precio del kit: $${Number(bundle.price_ars).toLocaleString('es-AR')} — ajustá el descuento en el carrito si es necesario`,
    });
    setShowCart(true);
    setShowBundles(false);
  };

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) => it.productId === productId ? { ...it, quantity: it.quantity + delta } : it)
        .filter((it) => it.quantity > 0)
    );
  };

  const removeItem = (productId: string) => setCart((prev) => prev.filter((it) => it.productId !== productId));

  const applyPriceOverride = (productId: string, raw: string) => {
    const num = parseFloat(raw.replace(",", "."));
    setCart(prev => prev.map(it =>
      it.productId === productId
        ? { ...it, customPrice: !isNaN(num) && num > 0 ? num : null }
        : it
    ));
    setEditingPriceId(null);
  };

  const clearCart = () => {
    setCart([]);
    setCustomer("");
    setPosNote("");
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

    if (isOnline && !await checkSalesLimit()) return;

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
      const txSaleIds: string[] = [];

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

        const txItemId = crypto.randomUUID();
        txSaleIds.push(txItemId);
        const saleData: any = {
          id: txItemId,
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
          seller_name: sellerName || null,
          notes: posNote.trim() || null,
        };

        if (isOnline) {
          await addSaleDB(saleData);
          await logAudit(user.id, "create", "sale", saleData.id, {
            product: item.name,
            total: adjustedTotal,
            method: splitMode ? `split:${splitMethod1}+${splitMethod2}` : payMethod,
            source: "pos",
          });
        } else {
          const pending = [...offlineSales, saleData];
          setOfflineSales(pending);
          localStorage.setItem(offlineKey, JSON.stringify(pending));
        }
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
      if (!isOnline) {
        toast.success(`Venta guardada offline — se sincronizará al reconectar`);
        clearCart();
        setReceipt({ items: [...cart], total: cartTotal, cash: Number(cashGiven) || 0, globalDiscountARS, couponDiscount, note: posNote });
        return;
      }

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

      const updatedProducts = await getProductsDB(user.id);
      setProducts(updatedProducts);

      // Post-sale low-stock alerts
      const lowStockAlert = Number(settings?.low_stock_threshold ?? 5);
      cart.forEach(item => {
        const updated = updatedProducts.find((p: any) => p.id === item.productId);
        if (updated && updated.stock >= 0 && updated.stock <= lowStockAlert) {
          toast.warning(`⚠️ Stock bajo: ${item.name} — quedan ${updated.stock} unidades`, { duration: 6000 });
        }
      });

      if (customer.trim()) saveRecentCustomer(customer.trim());
      setReceipt({
        items: [...cart],
        total: cartTotal,
        cash: Number(cashGiven) || 0,
        globalDiscountARS,
        couponDiscount,
        note: posNote,
      });
      toast.success(`Venta de ${formatARS(cartTotal)} registrada`);
      // Confetti: big sales or every 10th sale get extra celebration
      const turnoCount = turnoSales.length + 1;
      const isBigSale = cartTotal >= (Number(settings?.large_sale_threshold_ars) || 50_000);
      if (isBigSale) {
        confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, colors: ['#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4'] });
      } else if (turnoCount % 10 === 0) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
      }
      setTurnoSales(prev => [...prev, { items: [...cart], total: cartTotal, method: splitMode ? `${splitMethod1}+${splitMethod2}` : payMethod, customer: customer.trim(), ts: Date.now(), saleIds: txSaleIds }]);
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
            const isEditingPrice = editingPriceId === it.productId;
            const hasCustom = it.customPrice != null && it.customPrice > 0;
            const costARS = it.costUSD * it.exchangeRate;
            const marginPct = unitP > 0 && costARS > 0 ? ((unitP - costARS) / unitP) * 100 : null;
            return (
              <div key={it.productId} className={`rounded-[10px] p-3 space-y-2 transition-colors ${hasCustom ? "bg-primary/8 border border-primary/20" : "bg-muted/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium leading-tight truncate flex-1">{it.name}</p>
                      {marginPct !== null && (
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${
                          marginPct >= 40 ? 'bg-green-500/20 text-green-400' :
                          marginPct >= 20 ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {marginPct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {isEditingPrice ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">$</span>
                          <input
                            autoFocus
                            type="number"
                            min={0}
                            value={editingPriceVal}
                            onChange={e => setEditingPriceVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") applyPriceOverride(it.productId, editingPriceVal);
                              if (e.key === "Escape") setEditingPriceId(null);
                            }}
                            className="w-24 h-5 text-xs font-mono bg-background border border-primary/50 rounded px-1 outline-none focus:ring-1 focus:ring-primary/50"
                            placeholder={String(unitP)}
                          />
                          <button
                            onClick={() => applyPriceOverride(it.productId, editingPriceVal)}
                            className="text-primary hover:text-primary/80"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEditingPriceId(null)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingPriceId(it.productId);
                            setEditingPriceVal(String(hasCustom ? it.customPrice : unitP));
                          }}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground group"
                          title="Editar precio"
                        >
                          <span className={hasCustom ? "text-primary font-semibold" : ""}>{formatARS(unitP)}</span>
                          <span className="text-muted-foreground/40">c/u</span>
                          <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-70 transition-opacity ml-0.5" />
                          {hasCustom && <span className="text-[9px] text-primary/70 font-medium">personalizado</span>}
                        </button>
                      )}
                    </div>
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
                  <div className="text-right">
                    <span className="font-semibold text-sm font-mono">{formatARS(unitP * it.quantity)}</span>
                    {hasCustom && (
                      <button
                        onClick={() => setCart(prev => prev.map(c => c.productId === it.productId ? { ...c, customPrice: null } : c))}
                        className="block text-[9px] text-muted-foreground hover:text-destructive ml-auto mt-0.5"
                        title="Restablecer precio original"
                      >
                        × restaurar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Customer + Payment */}
      <div className="px-4 py-3 border-t border-border space-y-3">
        <div className="relative">
          <Input
            placeholder="Cliente (opcional)"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            onFocus={() => setShowRecentCustomers(true)}
            onBlur={() => setTimeout(() => setShowRecentCustomers(false), 150)}
            className="h-8 text-sm bg-muted"
          />
          {showRecentCustomers && recentCustomers.filter(c => !customer || c.toLowerCase().includes(customer.toLowerCase())).length > 0 && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[hsl(228_24%_7%)] border border-border/60 rounded-lg shadow-lg overflow-hidden">
              {recentCustomers
                .filter(c => !customer || c.toLowerCase().includes(customer.toLowerCase()))
                .slice(0, 5)
                .map(c => (
                  <button
                    key={c}
                    onMouseDown={() => { setCustomer(c); setShowRecentCustomers(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors truncate"
                  >
                    {c}
                  </button>
                ))}
            </div>
          )}
        </div>
        {vipLoading && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Verificando nivel…</p>}
        {vipTier && !vipLoading && (
          <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${
            vipTier.name === "Platino" ? "bg-purple-500/15 border border-purple-500/30 text-purple-300" :
            vipTier.name === "Oro" ? "bg-yellow-500/15 border border-yellow-500/30 text-yellow-300" :
            "bg-slate-500/15 border border-slate-500/30 text-slate-300"
          }`}>
            <span>⭐ {customer.trim()} · {vipTier.name} · {vipTier.points.toLocaleString("es-AR")} pts</span>
            <span className="font-bold">{vipTier.pct}% desc. aplicado</span>
          </div>
        )}

        {/* Customer debt alert */}
        {customerDebt !== null && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-destructive/15 border border-destructive/30 text-destructive">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{customer.trim()} tiene <strong>{formatARS(customerDebt)}</strong> pendiente de cobro</span>
          </div>
        )}

        {/* Price list badge — shown when customer has an active price list */}
        {activePriceList && activePriceList.discount_pct > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/15 border border-blue-500/30 text-blue-300">
            <Tag className="w-3.5 h-3.5 shrink-0" />
            <span>Lista: <strong>{activePriceList.name}</strong> · -{activePriceList.discount_pct}% aplicado en precios</span>
          </div>
        )}

        {/* Internal note */}
        <Input
          placeholder="Nota interna (opcional)"
          value={posNote}
          onChange={(e) => setPosNote(e.target.value)}
          className="h-8 text-sm bg-muted"
          maxLength={200}
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
              <div className="bg-muted/40 rounded-[10px] p-2.5 space-y-2">
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
              <div className="bg-muted/40 rounded-[10px] p-2.5 space-y-2">
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
            className={`w-full flex items-center justify-between px-3 py-2 rounded-[8px] border text-xs font-medium transition-all ${
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
            <div className="bg-muted/40 rounded-[10px] p-2.5 space-y-2">
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

        {/* Category discount panel */}
        {cart.length > 0 && (() => {
          const cats = [...new Set(cart.map(it => it.category).filter(Boolean))] as string[];
          if (cats.length === 0) return null;
          return (
            <div className="space-y-1.5">
              <button
                onClick={() => setShowCatDiscount(!showCatDiscount)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-[8px] border text-xs font-medium transition-all ${
                  showCatDiscount || catDiscountARS > 0
                    ? 'border-primary/40 bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/30'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  Desc. por categoría
                </span>
                {catDiscountARS > 0 && <span className="text-success font-mono">-{formatARS(catDiscountARS)}</span>}
              </button>
              {showCatDiscount && (
                <div className="bg-muted/40 rounded-[10px] p-2.5 space-y-2">
                  {cats.map(cat => (
                    <div key={cat} className="flex items-center gap-2">
                      <span className="text-xs flex-1 truncate capitalize">{cat.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={categoryDiscounts[cat] || ''}
                          onChange={e => saveCatDiscounts({ ...categoryDiscounts, [cat]: Math.min(100, Number(e.target.value) || 0) })}
                          className="w-14 text-right text-xs border border-border rounded bg-card px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/60"
                          placeholder="0"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground">El % se aplica al precio de cada ítem de esa categoría.</p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Total + confirm */}
        <div className="bg-primary/10 rounded-[10px] px-4 py-3 border border-primary/20 space-y-1">
          {cartSubtotal !== cartTotal && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-mono">{formatARS(cartSubtotal)}</span>
            </div>
          )}
          {catDiscountARS > 0 && (
            <div className="flex items-center justify-between text-xs text-success">
              <span>Desc. categoría</span>
              <span className="font-mono">-{formatARS(catDiscountARS)}</span>
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

        {/* Historial del turno */}
        {turnoSales.length > 0 && (
          <div className="border border-border rounded-[10px] overflow-hidden">
            <button
              onClick={() => setShowTurnoHistory(!showTurnoHistory)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <RotateCcw className="w-3 h-3" />
                Últimas ventas del turno ({turnoSales.length})
              </span>
              <ChevronUp className={`w-3 h-3 transition-transform ${showTurnoHistory ? '' : 'rotate-180'}`} />
            </button>
            {showTurnoHistory && (
              <div className="divide-y divide-border max-h-48 overflow-y-auto">
                {[...turnoSales].reverse().map((s, i) => (
                  <div key={s.ts} className="flex items-center justify-between px-3 py-2 text-xs gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{s.items.map(it => it.name).join(', ')}</p>
                      <p className="text-muted-foreground text-[10px]">
                        {s.customer || 'Sin cliente'} · {s.method} · {new Date(s.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="font-mono font-semibold text-primary shrink-0">{formatARS(s.total)}</span>
                    <button
                      onClick={async () => {
                        if (!confirm('¿Anular esta venta?')) return;
                        try {
                          await Promise.all(s.saleIds.map(id => deleteSaleDB(id)));
                          setTurnoSales(prev => prev.filter(t => t.ts !== s.ts));
                          toast.success('Venta anulada');
                          const updated = await getProductsDB(user!.id);
                          setProducts(updated);
                        } catch { toast.error('Error al anular'); }
                      }}
                      className="shrink-0 p-1 text-destructive/60 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                      title="Anular venta"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Button
          className="w-full gradient-gold text-primary-foreground font-semibold h-11 text-base gap-2"
          onClick={confirmSale}
          disabled={confirmDisabled}
        >
          {submitting ? (
            <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Registrando...</>
          ) : (
            <><CheckCircle2 className="w-5 h-5" />Confirmar venta <span className="ml-auto text-[10px] opacity-60 font-normal">F9</span></>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Variant Picker modal */}
      {variantPickerProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setVariantPickerProduct(null)}>
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="min-w-0 mr-3">
                <p className="text-sm font-semibold truncate">{variantPickerProduct.name}</p>
                <p className="text-xs text-muted-foreground">Seleccioná una variante</p>
              </div>
              <button onClick={() => setVariantPickerProduct(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
              {(variantsByProduct[variantPickerProduct.id] || []).map(v => {
                const outOfStock = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    onClick={() => !outOfStock && addToCart(variantPickerProduct, { id: v.id, name: v.variant_name, stock: v.stock, price: v.price_override || undefined })}
                    disabled={outOfStock}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-[10px] border text-left transition-all ${
                      outOfStock ? 'opacity-40 cursor-not-allowed border-border' : 'border-border hover:border-primary/50 hover:bg-primary/5 active:scale-98'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{v.variant_name}</p>
                      {v.price_override && <p className="text-xs text-muted-foreground">{formatARS(v.price_override)}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-[5px] ${
                      v.stock <= 0 ? 'bg-red-500/15 text-red-400' :
                      v.stock <= 3 ? 'bg-yellow-500/15 text-yellow-400' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {v.stock <= 0 ? 'Sin stock' : `×${v.stock}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={() => addToCart(variantPickerProduct)}
                className="w-full py-2.5 rounded-[10px] border border-dashed border-border hover:border-primary/40 hover:bg-muted/30 transition-colors text-xs text-muted-foreground"
              >
                Sin variante específica (stock total: {variantPickerProduct.stock})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Return modal */}
      {showReturn && user && activeOrg && (
        <QuickReturnModal
          userId={user.id}
          orgId={activeOrg.id}
          onClose={() => setShowReturn(false)}
        />
      )}

      {/* Turno summary modal */}
      {showTurnoSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-display font-bold flex items-center gap-2"><BarChart2 className="w-4 h-4 text-primary" />Resumen del turno</h2>
              <button onClick={() => setShowTurnoSummary(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Ventas', value: String(turnoSales.length) },
                  { label: 'Total', value: formatARS(turnoSales.reduce((s, v) => s + v.total, 0)) },
                  { label: 'Ticket prom.', value: formatARS(turnoSales.length > 0 ? turnoSales.reduce((s, v) => s + v.total, 0) / turnoSales.length : 0) },
                ].map(k => (
                  <div key={k.label} className="bg-muted/40 rounded-[10px] p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k.label}</p>
                    <p className="text-lg font-bold font-display text-primary mt-0.5">{k.value}</p>
                  </div>
                ))}
              </div>
              {/* Method breakdown */}
              {(() => {
                const byMethod: Record<string, number> = {};
                turnoSales.forEach(s => { byMethod[s.method] = (byMethod[s.method] || 0) + s.total; });
                return (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Por medio de pago</p>
                    <div className="space-y-1.5">
                      {Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([method, total]) => (
                        <div key={method} className="flex items-center justify-between text-sm">
                          <span className="capitalize text-muted-foreground">{method}</span>
                          <span className="font-semibold">{formatARS(total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Recent sales list */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ventas del turno</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {[...turnoSales].reverse().map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0">
                      <div>
                        <p className="font-medium">{s.items.map(it => it.name).join(', ')}</p>
                        <p className="text-muted-foreground">{s.customer || 'Sin cliente'} · {new Date(s.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <span className="font-bold text-primary ml-2 shrink-0">{formatARS(s.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {sellerName && <p className="text-[11px] text-muted-foreground text-center">Vendedor: <span className="font-semibold">{sellerName}</span></p>}
            </div>
            <div className="p-4 pt-0 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setTurnoSales([]); setShowTurnoSummary(false); toast.success("Turno reiniciado"); }}>
                Reiniciar turno
              </Button>
              <Button className="flex-1 gradient-gold text-primary-foreground font-semibold" onClick={() => setShowTurnoSummary(false)}>
                Continuar
              </Button>
            </div>
          </div>
        </div>
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
          note={receipt.note}
          onClose={() => setReceipt(null)}
          onNewSale={() => { setReceipt(null); clearCart(); }}
        />
      )}

      {/* Barcode scanner overlay */}
      {scanning && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4">
          <p className="text-white font-semibold">Apuntá la cámara al código de barras</p>
          <div className="relative w-72 h-48 rounded-[10px] overflow-hidden border-2 border-primary">
            <video ref={videoRef} className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-0.5 bg-primary animate-pulse" />
            </div>
          </div>
          <Button variant="outline" onClick={stopScan}>Cancelar</Button>
        </div>
      )}

      {/* Seller prompt dialog */}
      {showSellerPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] shadow-2xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold font-display mb-1">¿Quién atiende hoy?</h2>
            <p className="text-xs text-muted-foreground mb-4">El nombre del vendedor se registrará en cada venta del turno.</p>
            <input
              type="text"
              value={sellerInput}
              onChange={e => setSellerInput(e.target.value)}
              placeholder="Tu nombre"
              className="w-full h-10 px-3 rounded-lg border border-border bg-muted text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/40"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter" && sellerInput.trim()) {
                  const name = sellerInput.trim();
                  setSellerName(name);
                  localStorage.setItem(sellerKey, name);
                  setShowSellerPrompt(false);
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                className="flex-1 gradient-gold text-primary-foreground"
                onClick={() => {
                  const name = sellerInput.trim();
                  if (!name) return;
                  setSellerName(name);
                  localStorage.setItem(sellerKey, name);
                  setShowSellerPrompt(false);
                }}
                disabled={!sellerInput.trim()}
              >
                Confirmar
              </Button>
              <Button variant="ghost" onClick={() => setShowSellerPrompt(false)}>Omitir</Button>
            </div>
          </div>
        </div>
      )}

      <div className={`h-[calc(100vh-4rem)] lg:h-screen flex flex-col ${posTheme === 'light' ? 'bg-white text-gray-900 [&_.bg-card]:bg-gray-50 [&_.bg-muted]:bg-gray-100 [&_.border-border]:border-gray-200 [&_.text-muted-foreground]:text-gray-500 [&_.text-foreground]:text-gray-900' : ''}`}>
        {/* Offline / sync banner */}
        {!isOnline && (
          <div className="shrink-0 flex items-center gap-3 bg-orange-500/10 border-b border-orange-500/30 px-4 py-2 text-xs text-orange-400">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>Sin conexión — las ventas se guardan localmente y se sincronizan al reconectar</span>
            {offlineSales.length > 0 && (
              <span className="ml-auto font-medium">{offlineSales.length} pendiente{offlineSales.length !== 1 ? "s" : ""}</span>
            )}
          </div>
        )}
        {isOnline && offlineSales.length > 0 && (
          <div className="shrink-0 flex items-center gap-3 bg-blue-500/10 border-b border-blue-500/30 px-4 py-2 text-xs text-blue-400">
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${syncing ? "animate-spin" : ""}`} />
            <span>{offlineSales.length} venta{offlineSales.length !== 1 ? "s" : ""} pendiente{offlineSales.length !== 1 ? "s" : ""} de sincronizar</span>
            <Button size="sm" variant="outline" className="ml-auto h-6 text-[10px] border-blue-500/40 text-blue-400 hover:bg-blue-500/10" onClick={syncOfflineSales} disabled={syncing}>
              {syncing ? "Sincronizando..." : "Sincronizar ahora"}
            </Button>
          </div>
        )}
        {/* Top bar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-card/60 backdrop-blur">
          {sellerName && (
            <div className="hidden sm:flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
              <User className="w-3 h-3" />
              <span>{sellerName}</span>
              <button
                onClick={() => { setSellerInput(sellerName); setShowSellerPrompt(true); }}
                className="text-[10px] text-primary hover:underline"
              >cambiar</button>
            </div>
          )}
          {turnoSales.length > 0 && (
            <button onClick={() => setShowTurnoSummary(true)}
              className="hidden sm:flex items-center gap-1.5 shrink-0 text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-2 py-1 hover:bg-primary/20 transition-colors font-medium">
              <BarChart2 className="w-3 h-3" />
              {turnoSales.length} venta{turnoSales.length !== 1 ? 's' : ''} · {formatARS(turnoSales.reduce((s, v) => s + v.total, 0))}
            </button>
          )}
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={voiceActive ? voiceTranscript || '🎤 Escuchando...' : search}
              onChange={(e) => !voiceActive && setSearch(e.target.value)}
              placeholder={voiceActive ? '🎤 Hablá ahora...' : 'Buscar producto… (F2 · 🎤 voz)'}
              className={`pl-9 h-9 bg-muted/60 border-border text-sm ${voiceActive ? 'border-red-500/50 bg-red-500/5' : ''}`}
              readOnly={voiceActive}
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
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 shrink-0" onClick={togglePosTheme} title={posTheme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}>
            {posTheme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
          </Button>
          {voiceSupported && (
            <Button size="sm" variant="ghost"
              className={`h-9 w-9 p-0 shrink-0 hidden sm:flex relative ${voiceActive ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40' : ''}`}
              title={voiceActive ? `Escuchando: "${voiceTranscript}"` : "Comando de voz (ej: vende 2 Lattafa)"}
              onClick={toggleVoice}
            >
              {voiceActive ? <MicOff className="w-4 h-4 text-red-400 animate-pulse" /> : <Mic className="w-4 h-4" />}
              {voiceActive && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 shrink-0 hidden sm:flex" title="Pantalla completa (F5 / F11)"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-9 w-9 p-0 shrink-0 hidden sm:flex" title="Atajos de teclado (F1 / ?)"
            onClick={() => setShowShortcutHelp(v => !v)}
          >
            <HelpCircle className="w-4 h-4" />
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
              onClick={() => { setCat(c.value); setShowBundles(false); }}
              className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-[5px] border transition-all ${
                !showBundles && cat === c.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {c.label}
            </button>
          ))}
          {bundles.length > 0 && (
            <button
              onClick={() => setShowBundles(v => !v)}
              className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-[5px] border transition-all flex items-center gap-1.5 ${
                showBundles
                  ? "bg-yellow-500 text-yellow-950 border-yellow-500"
                  : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20"
              }`}
            >
              <Layers className="w-3 h-3" />Kits ({bundles.length})
            </button>
          )}
        </div>

        {/* Main area */}
        <div className="flex-1 overflow-hidden flex">
          {/* Product grid / Bundle grid */}
          <div className={`flex-1 overflow-y-auto p-3 ${showCart ? "hidden lg:block" : "block"}`}>
            {/* Bundles grid */}
            {showBundles ? (
              <div>
                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />Kits disponibles — hacé click para agregar al carrito
                </p>
                {bundles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Layers className="w-10 h-10 mb-3 opacity-20" />
                    <p className="text-sm">Sin kits activos</p>
                    <p className="text-xs mt-1">Creá kits en Catálogo → Combos & Kits</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {bundles.map(bundle => {
                      const items = bundle.bundle_items || [];
                      const componentNames = items.map(item => {
                        const prod = products.find(p => p.id === item.product_id);
                        return prod ? `${item.quantity}x ${prod.name}` : null;
                      }).filter(Boolean);
                      return (
                        <button
                          key={bundle.id}
                          onClick={() => addBundleToCart(bundle)}
                          className="text-left bg-card border border-yellow-500/20 rounded-xl p-4 hover:border-yellow-500/50 hover:bg-yellow-500/5 transition-all group"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-yellow-500/15 flex items-center justify-center shrink-0">
                                <Layers className="w-4 h-4 text-yellow-400" />
                              </div>
                              <p className="font-semibold text-sm leading-tight">{bundle.name}</p>
                            </div>
                            <span className="text-sm font-mono font-bold text-primary shrink-0">
                              ${Number(bundle.price_ars).toLocaleString('es-AR')}
                            </span>
                          </div>
                          {bundle.description && (
                            <p className="text-[10px] text-muted-foreground mb-2 line-clamp-1">{bundle.description}</p>
                          )}
                          <div className="space-y-0.5">
                            {componentNames.slice(0, 4).map((name, i) => (
                              <p key={i} className="text-[10px] text-muted-foreground/70 truncate">· {name}</p>
                            ))}
                            {componentNames.length > 4 && (
                              <p className="text-[10px] text-muted-foreground/50">+{componentNames.length - 4} más</p>
                            )}
                          </div>
                          <div className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">{items.length} producto{items.length !== 1 ? "s" : ""}</span>
                            <span className="text-[10px] text-yellow-400 font-medium group-hover:translate-x-0.5 transition-transform">Agregar →</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : loadingProds ? (
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
                      onClick={() => {
                        if (outOfStock) return;
                        const prodVariants = variantsByProduct[prod.id];
                        if (prodVariants?.length > 0) {
                          setVariantPickerProduct(prod);
                        } else {
                          addToCart(prod);
                        }
                      }}
                      disabled={outOfStock}
                      className={`relative flex flex-col bg-card border rounded-[10px] overflow-hidden text-left transition-all hover:shadow-md active:scale-95 ${
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
                        {variantsByProduct[prod.id]?.length > 0 && (
                          <p className="text-[9px] text-blue-400 font-medium">{variantsByProduct[prod.id].length} variantes →</p>
                        )}

                        <div className="flex items-center justify-between mt-auto">
                          <div>
                            <p className={`text-sm font-bold font-mono ${showDisc ? "text-primary" : ""}`}>
                              {formatARS(displayPrice)}
                            </p>
                            {showDisc && (
                              <p className="text-[10px] line-through text-muted-foreground/50">{formatARS(price)}</p>
                            )}
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-[5px] ${
                            prod.stock <= 0 ? "bg-red-500/15 text-red-400" :
                            prod.stock <= 3 ? "bg-yellow-500/15 text-yellow-400" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {prod.stock <= 0 ? "Sin stock" : `×${prod.stock}`}
                          </span>
                        </div>
                      </div>

                      {/* Top seller badge */}
                      {topProductIds.has(prod.id) && !inCart && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-orange-500/90 text-white text-[9px] font-bold shadow">
                          🔥 Top
                        </div>
                      )}
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

      {/* ── Keyboard shortcuts overlay ─────────────────────────── */}
      {showShortcutHelp && (
        <div
          className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowShortcutHelp(false)}
        >
          <div
            className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-2xl shadow-2xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-primary" />Atajos de teclado POS
              </h2>
              <button onClick={() => setShowShortcutHelp(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {([
                ["F2", "Enfocar búsqueda de productos"],
                ["F9", "Confirmar venta (si hay items en el carrito)"],
                ["F5 / F11", "Pantalla completa"],
                ["F1 / ?", "Mostrar / cerrar esta ayuda"],
                ["Escape", "Cerrar ayuda · Limpiar búsqueda · Vaciar carrito"],
                ["+ / −", "Aumentar / reducir cantidad del último ítem"],
              ] as [string, string][]).map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <kbd className="shrink-0 inline-flex items-center justify-center min-w-[52px] px-2 py-1 rounded-lg border border-border bg-muted font-mono text-[11px] font-bold text-foreground">
                    {key}
                  </kbd>
                  <span className="text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-4 border-t border-border/40 pt-3">
              Los atajos no funcionan cuando el foco está en un campo de texto. Presioná Escape para cerrar.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
