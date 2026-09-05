/**
 * SupplierPOModal — Generate & send a Purchase Order to a supplier.
 *
 * Shows low-stock products linked to the selected supplier, lets the user
 * set order quantities, then sends an email PO via the send-supplier-po
 * edge function (SMTP/Resend). Also builds a WhatsApp message.
 */
import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Truck, Send, MessageCircle, Package, AlertTriangle,
  DollarSign, Loader2, Check, X, FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { formatARS, formatUSD } from "@/lib/supabaseStore";
import { toast } from "sonner";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";

import { plural } from "@/lib/plural";
interface Supplier {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  contact?: string;
}

interface PoProduct {
  id: string;
  name: string;
  stock: number;
  low_stock_threshold?: number;
  cost_usd?: number;
  supplier_id?: string;
}

interface PoLine {
  product: PoProduct;
  qty: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-select this supplier */
  supplierId?: string;
}

export default function SupplierPOModal({ open, onClose, supplierId }: Props) {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<PoProduct[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState(supplierId ?? "");
  const [lines, setLines] = useState<PoLine[]>([]);
  const [notes, setNotes] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(1700);

  // Load suppliers & products
  useEffect(() => {
    if (!open || !activeOrg) return;
    Promise.all([
      supabase.from("suppliers").select("id, name, email, phone, contact").eq("org_id", activeOrg.id).order("name"),
      supabase.from("products").select("id, name, stock, low_stock_threshold, cost_usd, supplier_id").eq("org_id", activeOrg.id),
      supabase.from("settings").select("exchange_rate").eq("org_id", activeOrg.id).maybeSingle(),
    ]).then(([sRes, pRes, settRes]) => {
      setSuppliers(sRes.data ?? []);
      setProducts(pRes.data ?? []);
      if (settRes.data?.exchange_rate) setExchangeRate(Number(settRes.data.exchange_rate));
    });
    if (supplierId) setSelectedSupplierId(supplierId);
  }, [open, activeOrg, supplierId]);

  const supplier = suppliers.find(s => s.id === selectedSupplierId);

  // Low-stock products for this supplier
  const lowStockProducts = useMemo(() => {
    return products.filter(p => {
      const threshold = p.low_stock_threshold ?? 3;
      const matchesSup = !selectedSupplierId || p.supplier_id === selectedSupplierId;
      return p.stock <= threshold && matchesSup;
    });
  }, [products, selectedSupplierId]);

  // Init lines when supplier or low-stock changes
  useEffect(() => {
    setLines(
      lowStockProducts.map(p => ({
        product: p,
        qty: Math.max(1, (p.low_stock_threshold ?? 3) * 3 - p.stock), // order to 3x threshold
      }))
    );
  }, [lowStockProducts]);

  const totalUSD = lines.reduce((s, l) => s + (l.qty * (Number(l.product.cost_usd) || 0)), 0);
  const totalARS = totalUSD * exchangeRate;

  const updateQty = (productId: string, qty: number) => {
    setLines(prev => prev.map(l => l.product.id === productId ? { ...l, qty: Math.max(0, qty) } : l));
  };

  const activeLInes = lines.filter(l => l.qty > 0);

  const sendPO = async () => {
    if (!supplier || !activeOrg || activeLInes.length === 0) return;
    setSending(true);
    try {
      // Build PO summary for email
      const { data: settData } = await supabase.from("settings").select("business_name").eq("org_id", activeOrg.id).maybeSingle();
      const businessName = settData?.business_name || "Mi Negocio";

      // Send one email per product line (edge function supports single product)
      // Or aggregate into a multi-line format via notes
      const productSummary = activeLInes.map(l =>
        `• ${l.product.name}: ${l.qty} uds × U$S ${l.product.cost_usd ?? "—"} = U$S ${(l.qty * (Number(l.product.cost_usd) || 0)).toFixed(2)}`
      ).join("\n");

      const res = await supabase.functions.invoke("send-supplier-po", {
        body: {
          orgId: activeOrg.id,
          supplierEmail: supplier.email,
          supplierName: supplier.name,
          businessName,
          productName: activeLInes.length === 1 ? activeLInes[0].product.name : `Orden de compra (${plural(activeLInes.length, "producto")})`,
          quantity: activeLInes.length === 1 ? activeLInes[0].qty : activeLInes.reduce((s, l) => s + l.qty, 0),
          unitCostUSD: activeLInes.length === 1 ? (activeLInes[0].product.cost_usd ?? 0) : (totalUSD / activeLInes.reduce((s, l) => s + l.qty, 0)),
          totalUSD,
          scheduledDate: scheduledDate || undefined,
          notes: [notes, activeLInes.length > 1 ? `\n\nDetalle:\n${productSummary}` : ""].filter(Boolean).join(""),
          exchangeRate,
        },
      });

      if (res.error || res.data?.error) throw new Error(await mensajeDeEdgeFunction(res.error, res.data));
      setSent(true);
      toast.success(`Orden enviada a ${supplier.name}`, { duration: 4000 });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar la orden");
    } finally {
      setSending(false);
    }
  };

  // Build WhatsApp message
  const waMessage = useMemo(() => {
    if (!supplier || activeLInes.length === 0) return "";
    const lines2 = activeLInes.map(l => `• ${l.product.name}: ${l.qty} uds`).join("\n");
    return encodeURIComponent(
      `Hola ${supplier.name || supplier.contact || ""},\n\nTe envío una orden de compra:\n\n${lines2}\n\nTotal estimado: U$S ${totalUSD.toFixed(2)}\n\nGracias!`
    );
  }, [supplier, activeLInes, totalUSD]);

  const waPhone = supplier?.phone?.replace(/\D/g, "");

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setSent(false); } }}>
      <DialogContent className="bg-card border-border/60 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Truck className="w-5 h-5 text-primary" />
            Generar Orden de Compra
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="py-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-lg font-semibold">Orden enviada exitosamente</p>
            <p className="text-sm text-muted-foreground">Se envió un email a {supplier?.email || supplier?.name}</p>
            <Button variant="outline" onClick={() => { setSent(false); onClose(); }}>Cerrar</Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Supplier selector */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Proveedor</label>
              <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Seleccionar proveedor…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos los proveedores</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.email ? ` — ${s.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Product lines */}
            {lowStockProducts.length === 0 ? (
              <div className="py-8 text-center">
                <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {selectedSupplierId ? "No hay productos bajo stock para este proveedor." : "No hay productos bajo stock."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">Productos a pedir</label>
                  <Badge variant="outline" className="text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1 text-yellow-400" />
                    {lowStockProducts.length} bajo stock
                  </Badge>
                </div>
                <div className="rounded-xl border border-border/40 divide-y divide-border/30 overflow-hidden">
                  {lines.map(line => (
                    <div key={line.product.id} className="flex items-center gap-3 p-3 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{line.product.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 border-0 ${line.product.stock <= 0 ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}
                          >
                            Stock: {line.product.stock}
                          </Badge>
                          {line.product.cost_usd && (
                            <span className="text-[10px] text-muted-foreground">U$S {line.product.cost_usd}/ud</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => updateQty(line.product.id, line.qty - 1)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                        <Input
                          type="number"
                          min="0"
                          value={line.qty}
                          onChange={e => updateQty(line.product.id, parseInt(e.target.value) || 0)}
                          className="w-16 h-7 text-center text-sm bg-muted border-border"
                        />
                        <span className="text-xs text-muted-foreground w-20 text-right">
                          {line.product.cost_usd ? formatUSD(line.qty * Number(line.product.cost_usd)) : `${line.qty} uds`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total */}
            {totalUSD > 0 && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-primary/8 border border-primary/20">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Total estimado</span>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-primary font-mono">U$S {totalUSD.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">{formatARS(totalARS)}</p>
                </div>
              </div>
            )}

            {/* Notes + date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Fecha estimada de entrega</label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  className="bg-muted border-border text-sm"
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Notas adicionales</label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Condiciones, urgencia, etc."
                  className="bg-muted border-border text-sm h-10 resize-none"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                className="flex-1 gradient-gold text-primary-foreground font-semibold"
                disabled={sending || !supplier?.email || activeLInes.length === 0}
                onClick={sendPO}
              >
                {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {sending ? "Enviando…" : supplier?.email ? `Enviar a ${supplier.email}` : "Sin email (configura en Proveedores)"}
              </Button>

              {waPhone && activeLInes.length > 0 && (
                <a
                  href={`https://wa.me/${waPhone}?text=${waMessage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" className="gap-2 border-green-500/40 text-green-400 hover:bg-green-500/10">
                    <MessageCircle className="w-4 h-4" />
                    WhatsApp
                  </Button>
                </a>
              )}
            </div>

            {!supplier?.email && supplier && (
              <p className="text-xs text-yellow-400/80 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Configurá el email de {supplier.name} en la página de Proveedores para enviar emails.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
