import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardList,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Search,
  Send,
  CheckCircle,
  Package,
  DollarSign,
  Truck,
  ChevronDown,
  ChevronUp,
  FileText,
  XCircle,
  Download,
  Eye,
  Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import InvoiceOCRModal, { OCRPrefillData } from "@/components/purchases/InvoiceOCRModal";
import PurchaseRequestsTab from "@/components/purchases/PurchaseRequestsTab";
import { ScanLine } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PurchaseOrder {
  id: string;
  org_id: string;
  order_number: string;
  supplier_id: string | null;
  supplier_name: string;
  supplier_email: string | null;
  status: "draft" | "sent" | "confirmed" | "partially_received" | "received" | "cancelled";
  currency: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  notes: string | null;
  internal_notes: string | null;
  expected_date: string | null;
  received_date: string | null;
  payment_terms: string | null;
  sent_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  items?: POItem[];
}

interface POItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  sku: string | null;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  tax_rate: number;
  total_cost: number;
}

interface Supplier {
  id: string;
  name: string;
  email: string | null;
}

interface Product {
  id: string;
  name: string;
  sku: string | null;
  cost: number | null;
  price: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "Borrador", color: "bg-muted/40 text-muted-foreground", icon: FileText },
  sent: { label: "Enviada", color: "bg-blue-500/15 text-blue-400", icon: Send },
  confirmed: { label: "Confirmada", color: "bg-violet-500/15 text-violet-400", icon: CheckCircle },
  partially_received: { label: "Recibida parcial", color: "bg-amber-500/15 text-amber-400", icon: Package },
  received: { label: "Recibida", color: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle },
  cancelled: { label: "Cancelada", color: "bg-red-500/15 text-red-400", icon: XCircle },
};

const PAYMENT_TERMS: Record<string, string> = {
  immediate: "Pago inmediato",
  "15_days": "15 días",
  "30_days": "30 días",
  "60_days": "60 días",
};

function fmtCurrency(n: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

// ─── PO Form Dialog ───────────────────────────────────────────────────────────

interface POFormProps {
  open: boolean;
  order: PurchaseOrder | null;
  suppliers: Supplier[];
  products: Product[];
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
  prefill?: OCRPrefillData | null;
}

function POForm({ open, order, suppliers, products, orgId, onClose, onSaved, prefill }: POFormProps) {
  const [loading, setLoading] = useState(false);
  const [supplierId, setSupplierId] = useState("none");
  const [supplierName, setSupplierName] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [currency, setCurrency] = useState("ARS");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("30_days");
  const [items, setItems] = useState<Omit<POItem, "id" | "order_id" | "total_cost">[]>([]);
  const [searchProd, setSearchProd] = useState("");

  useEffect(() => {
    if (order) {
      setSupplierId(order.supplier_id ?? "none");
      setSupplierName(order.supplier_name);
      setSupplierEmail(order.supplier_email ?? "");
      setCurrency(order.currency);
      setNotes(order.notes ?? "");
      setInternalNotes(order.internal_notes ?? "");
      setExpectedDate(order.expected_date ?? "");
      setPaymentTerms(order.payment_terms ?? "30_days");
      setItems((order.items ?? []).map(i => ({
        product_id: i.product_id, product_name: i.product_name, sku: i.sku,
        quantity_ordered: i.quantity_ordered, quantity_received: i.quantity_received,
        unit_cost: i.unit_cost, tax_rate: i.tax_rate,
      })));
    } else if (prefill) {
      setSupplierId("none"); setSupplierName(prefill.supplierName ?? ""); setSupplierEmail(""); setCurrency("ARS");
      setNotes(""); setInternalNotes(""); setExpectedDate(""); setPaymentTerms("30_days");
      setItems(prefill.items.map(i => ({
        product_id: null, product_name: i.product_name, sku: i.sku,
        quantity_ordered: i.quantity_ordered, quantity_received: 0,
        unit_cost: i.unit_cost, tax_rate: i.tax_rate,
      })));
    } else {
      setSupplierId("none"); setSupplierName(""); setSupplierEmail(""); setCurrency("ARS");
      setNotes(""); setInternalNotes(""); setExpectedDate(""); setPaymentTerms("30_days");
      setItems([]);
    }
  }, [order, open, prefill]);

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    if (id !== "none") {
      const s = suppliers.find(s => s.id === id);
      if (s) { setSupplierName(s.name); setSupplierEmail(s.email ?? ""); }
    }
  };

  const addItem = (prod?: Product) => {
    setItems(prev => [...prev, {
      product_id: prod?.id ?? null,
      product_name: prod?.name ?? "",
      sku: prod?.sku ?? null,
      quantity_ordered: 1,
      quantity_received: 0,
      unit_cost: prod?.cost ?? prod?.price ?? 0,
      tax_rate: 21,
    }]);
  };

  const updateItem = (i: number, key: string, val: string | number) => {
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [key]: val } : item));
  };

  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const subtotal = items.reduce((a, i) => a + i.quantity_ordered * i.unit_cost, 0);
  const taxTotal = items.reduce((a, i) => a + i.quantity_ordered * i.unit_cost * i.tax_rate / 100, 0);
  const total = subtotal + taxTotal;

  const handleSave = async () => {
    if (!supplierName.trim()) { toast.error("Proveedor requerido"); return; }
    if (items.length === 0) { toast.error("Agregá al menos un ítem"); return; }
    setLoading(true);

    let orderId = order?.id;
    let orderNum = order?.order_number;

    if (!order) {
      // Get order number
      const { data: numData } = await supabase.rpc("generate_po_number", { p_org_id: orgId });
      orderNum = numData;
      const { data: newOrder, error: orderError } = await supabase.from("purchase_orders").insert({
        org_id: orgId, order_number: orderNum, supplier_id: supplierId === "none" ? null : supplierId,
        supplier_name: supplierName.trim(), supplier_email: supplierEmail.trim() || null,
        currency, notes: notes.trim() || null, internal_notes: internalNotes.trim() || null,
        expected_date: expectedDate || null, payment_terms: paymentTerms,
      }).select().single();
      if (orderError) { toast.error("Error al crear OC: " + orderError.message); setLoading(false); return; }
      orderId = newOrder.id;
    } else {
      const { error } = await supabase.from("purchase_orders").update({
        supplier_id: supplierId === "none" ? null : supplierId,
        supplier_name: supplierName.trim(), supplier_email: supplierEmail.trim() || null,
        currency, notes: notes.trim() || null, internal_notes: internalNotes.trim() || null,
        expected_date: expectedDate || null, payment_terms: paymentTerms,
      }).eq("id", order.id);
      if (error) { toast.error("Error: " + error.message); setLoading(false); return; }
      // Delete old items
      await supabase.from("purchase_order_items").delete().eq("order_id", order.id);
    }

    // Insert items
    await supabase.from("purchase_order_items").insert(
      items.map(i => ({ ...i, order_id: orderId, org_id: orgId }))
    );

    setLoading(false);
    toast.success(order ? "OC actualizada" : `OC creada: ${orderNum}`);
    onSaved();
    onClose();
  };

  const filteredProds = products.filter(p =>
    !searchProd || p.name.toLowerCase().includes(searchProd.toLowerCase())
  ).slice(0, 8);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? `Editar ${order.order_number}` : "Nueva Orden de Compra"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Supplier */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Proveedor</Label>
              <Select value={supplierId} onValueChange={handleSupplierChange}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingreso manual</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nombre proveedor *</Label>
              <Input value={supplierName} onChange={e => setSupplierName(e.target.value)} />
            </div>
            <div>
              <Label>Email proveedor</Label>
              <Input type="email" value={supplierEmail} onChange={e => setSupplierEmail(e.target.value)} />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Condición de pago</Label>
              <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_TERMS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fecha esperada</Label>
              <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Ítems de la orden</Label>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input placeholder="Buscar producto..." value={searchProd} onChange={e => setSearchProd(e.target.value)} className="pl-8 h-8 text-xs w-44" />
                </div>
                {searchProd && filteredProds.length > 0 && (
                  <div className="absolute z-10 bg-popover border border-border rounded-lg shadow-lg mt-8 w-64 max-h-48 overflow-y-auto">
                    {filteredProds.map(p => (
                      <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                        onClick={() => { addItem(p); setSearchProd(""); }}>
                        {p.name}
                        {p.sku && <span className="text-xs text-muted-foreground ml-2">{p.sku}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => addItem()}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar
                </Button>
              </div>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-border rounded-lg text-sm text-muted-foreground">
                Buscá un producto o hacé clic en Agregar
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Producto</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cant.</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Costo unit.</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">IVA %</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <Input value={item.product_name} onChange={e => updateItem(i, "product_name", e.target.value)} className="h-7 text-xs" />
                        </td>
                        <td className="px-3 py-2 w-20">
                          <Input type="number" value={item.quantity_ordered} onChange={e => updateItem(i, "quantity_ordered", parseFloat(e.target.value) || 0)} className="h-7 text-xs text-right" min="0" />
                        </td>
                        <td className="px-3 py-2 w-28">
                          <Input type="number" value={item.unit_cost} onChange={e => updateItem(i, "unit_cost", parseFloat(e.target.value) || 0)} className="h-7 text-xs text-right" min="0" />
                        </td>
                        <td className="px-3 py-2 w-16">
                          <Input type="number" value={item.tax_rate} onChange={e => updateItem(i, "tax_rate", parseFloat(e.target.value) || 0)} className="h-7 text-xs text-right" min="0" max="100" />
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-xs">
                          {fmtCurrency(item.quantity_ordered * item.unit_cost, currency)}
                        </td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="ghost" onClick={() => removeItem(i)}>
                            <Trash2 className="w-3 h-3 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {items.length > 0 && (
              <div className="text-right text-sm space-y-0.5 mt-2">
                <p className="text-muted-foreground">Subtotal: <span className="font-medium text-foreground">{fmtCurrency(subtotal, currency)}</span></p>
                <p className="text-muted-foreground">IVA: <span className="font-medium text-foreground">{fmtCurrency(taxTotal, currency)}</span></p>
                <p className="font-bold text-base">Total: {fmtCurrency(total, currency)}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Notas para el proveedor</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>Notas internas</Label>
              <Textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={2} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {order ? "Guardar cambios" : "Crear OC"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Recepción de mercadería ──────────────────────────────────────────────────

/** Lo que falta de un renglón. Nunca negativo, aunque el dato venga sucio. */
function pendienteDe(item: POItem): number {
  return Math.max(0, Number(item.quantity_ordered ?? 0) - Number(item.quantity_received ?? 0));
}

/**
 * Registrar una entrega, total o parcial.
 *
 * Antes el único botón era "Marcar recibida", que corría un UPDATE de `status`
 * y `received_date` y **nada más**: no tocaba `quantity_received` ni movía una
 * sola unidad de stock. Es decir que el módulo de órdenes de compra estaba
 * desconectado del inventario, y el estado `partially_received` —que ya estaba
 * en el vocabulario y en la UI, con su color ámbar— no se podía alcanzar.
 *
 * Todo pasa por el RPC `receive_purchase_order`: valida contra lo pendiente,
 * inserta en `purchases` para que el trigger mueva el stock, deja la entrega en
 * `purchase_order_receipts` y recalcula el estado desde los renglones. Acá no se
 * calcula nada de eso — si la pantalla decidiera el estado o el stock, dos
 * recepciones simultáneas se pisarían.
 */
function ReceiveDialog({ order, open, onOpenChange, onDone }: {
  order: PurchaseOrder;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const items = order.items ?? [];
  // Por default llega todo lo que falta: es el caso común, y así el parcial es
  // corregir un número en vez de cargar todos.
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [sucursales, setSucursales] = useState<Array<{ id: string; name: string }>>([]);
  const [sucursalId, setSucursalId] = useState("");

  useEffect(() => {
    if (open) {
      setCantidades(Object.fromEntries(items.map(i => [i.id, String(pendienteDe(i))])));
      setNotas("");
    }
  }, [open, order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A qué sucursal entra la mercadería. Sólo se pregunta si la organización
  // tiene sucursales cargadas: sin ellas el stock es uno solo y preguntar sería
  // ruido. La principal viene elegida porque es donde entra casi siempre.
  useEffect(() => {
    if (!open) return;
    supabase
      .from("locations")
      .select("id, name, is_main")
      .eq("org_id", order.org_id)
      .eq("active", true)
      .order("is_main", { ascending: false })
      .order("name")
      .then(({ data, error }) => {
        if (error) { toast.error("No se pudieron cargar las sucursales"); return; }
        const filas = data ?? [];
        setSucursales(filas);
        setSucursalId(prev => prev || filas[0]?.id || "");
      });
  }, [open, order.org_id]);

  // Al cerrar, la próxima entrega de esta misma orden es una entrega nueva y
  // legítima: necesita su propia clave.
  useEffect(() => { if (!open) claveIdem.current = null; }, [open]);

  const aRecibir = items
    .map(i => ({ item_id: i.id, quantity: Number(cantidades[i.id] ?? 0) }))
    .filter(x => x.quantity > 0);

  const excedido = items.some(i => Number(cantidades[i.id] ?? 0) > pendienteDe(i));

  /**
   * I6a — clave de idempotencia de este intento de recepción.
   *
   * Va en un ref: no tiene que provocar re-render y tiene que sobrevivir a los
   * reintentos del mismo submit. Se limpia al cerrar el diálogo, así que una
   * segunda entrega de la misma orden —que es legítima— usa una clave nueva.
   *
   * Sin esto, una recepción PARCIAL repetida sumaba la mercadería dos veces:
   * verificado contra producción, recibir 4 dos veces dejaba 8.
   */
  const claveIdem = useRef<string | null>(null);

  const confirmar = async () => {
    setGuardando(true);
    if (!claveIdem.current) claveIdem.current = crypto.randomUUID();
    try {
      const { data, error } = await supabase.rpc(
        "receive_purchase_order_idem" as never, {
        p_order_id: order.id,
        p_items: aRecibir,
        p_notes: notas.trim() || null,
        p_location_id: sucursalId || null,
        p_idempotency_key: claveIdem.current,
      } as never);
      if (error) throw error;
      const res = data as { status?: string; pendientes?: number } | null;
      toast.success(
        res?.status === "received"
          ? "Orden recibida completa"
          : `Entrega registrada — quedan ${Number(res?.pendientes ?? 0)} unidades`,
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      // El RPC explica qué renglón y por cuánto se pasó; mostrarlo es más útil
      // que un "error al recibir" genérico.
      toast.error(e instanceof Error ? e.message : "No se pudo registrar la entrega");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recibir mercadería — {order.order_number}</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Producto</th>
                <th className="text-right px-3 py-2 font-medium">Pedido</th>
                <th className="text-right px-3 py-2 font-medium">Ya recibido</th>
                <th className="text-right px-3 py-2 font-medium">Falta</th>
                <th className="text-right px-3 py-2 font-medium w-28">Llega ahora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map(i => {
                const falta = pendienteDe(i);
                const valor = Number(cantidades[i.id] ?? 0);
                return (
                  <tr key={i.id} className={falta === 0 ? "opacity-50" : ""}>
                    <td className="px-3 py-2">{i.product_name}</td>
                    <td className="px-3 py-2 text-right">{i.quantity_ordered}</td>
                    <td className="px-3 py-2 text-right">{i.quantity_received}</td>
                    <td className="px-3 py-2 text-right font-medium">{falta}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number" min={0} max={falta} disabled={falta === 0}
                        value={cantidades[i.id] ?? ""}
                        onChange={e => setCantidades(p => ({ ...p, [i.id]: e.target.value }))}
                        className={`h-7 text-xs text-right ${valor > falta ? "border-destructive" : ""}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sucursales.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Entra en</Label>
            <Select value={sucursalId} onValueChange={setSucursalId}>
              <SelectTrigger className="text-xs"><SelectValue placeholder="Sucursal de destino" /></SelectTrigger>
              <SelectContent>
                {sucursales.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Nota de la entrega (opcional)</Label>
          <Input
            value={notas} onChange={e => setNotas(e.target.value)}
            placeholder="Remito 1234, faltó una caja…" className="text-xs"
          />
        </div>

        {excedido && (
          <p className="text-xs text-destructive">
            Hay renglones con más unidades de las que faltan. Recibir de más se rechaza:
            si el proveedor mandó de más, corregí la orden primero.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirmar} disabled={guardando || excedido || aRecibir.length === 0}>
            <Package className="w-3.5 h-3.5 mr-1" />
            {guardando ? "Registrando…" : `Recibir ${aRecibir.reduce((s, x) => s + x.quantity, 0)} unidades`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── PO Row ───────────────────────────────────────────────────────────────────

interface PORowProps {
  order: PurchaseOrder;
  onEdit: () => void;
  onAdvanceStatus: (status: string) => void;
  onReceived: () => void;
  onDelete: () => void;
}

function PORow({ order, onEdit, onAdvanceStatus, onReceived, onDelete }: PORowProps) {
  const [recibiendo, setRecibiendo] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sc = STATUS_CONFIG[order.status];
  const StatusIcon = sc.icon;

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-semibold text-sm">{order.order_number}</span>
            <span className="font-medium text-sm">{order.supplier_name}</span>
            <Badge className={`text-xs border ${sc.color}`}><StatusIcon className="w-3 h-3 mr-1" />{sc.label}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(order.created_at), "dd/MM/yyyy")}
            {order.expected_date ? ` · Esperada: ${format(new Date(order.expected_date), "dd/MM/yyyy")}` : ""}
            {order.payment_terms ? ` · ${PAYMENT_TERMS[order.payment_terms] ?? order.payment_terms}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-sm">{fmtCurrency(order.total_amount, order.currency)}</p>
          <p className="text-xs text-muted-foreground">{order.items?.length ?? 0} ítems</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </div>

      {expanded && (
        <div className="border-t border-border p-3 bg-muted/10 space-y-3">
          {order.items && order.items.length > 0 && (
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/20">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Producto</th>
                    <th className="text-right px-3 py-1.5 font-medium">Pedido</th>
                    <th className="text-right px-3 py-1.5 font-medium">Recibido</th>
                    <th className="text-right px-3 py-1.5 font-medium">Falta</th>
                    <th className="text-right px-3 py-1.5 font-medium">Costo unit.</th>
                    <th className="text-right px-3 py-1.5 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {order.items.map(item => {
                    const falta = pendienteDe(item);
                    return (
                    <tr key={item.id}>
                      <td className="px-3 py-1.5">{item.product_name}{item.sku ? ` (${item.sku})` : ""}</td>
                      <td className="px-3 py-1.5 text-right">{item.quantity_ordered}</td>
                      <td className={`px-3 py-1.5 text-right ${falta > 0 ? "text-amber-400" : "text-emerald-400"}`}>{item.quantity_received}</td>
                      <td className={`px-3 py-1.5 text-right ${falta > 0 ? "text-amber-400 font-medium" : "text-muted-foreground"}`}>{falta}</td>
                      <td className="px-3 py-1.5 text-right">{fmtCurrency(item.unit_cost, order.currency)}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{fmtCurrency(item.total_cost, order.currency)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {order.status === "draft" && (
              <Button size="sm" variant="outline" onClick={() => onAdvanceStatus("sent")}>
                <Send className="w-3.5 h-3.5 mr-1" /> Enviar OC
              </Button>
            )}
            {order.status === "sent" && (
              <Button size="sm" variant="outline" onClick={() => onAdvanceStatus("confirmed")}>
                <CheckCircle className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Confirmar
              </Button>
            )}
            {(order.status === "confirmed" || order.status === "partially_received") && (
              <Button size="sm" variant="outline" onClick={() => setRecibiendo(true)}>
                <Package className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Recibir mercadería
              </Button>
            )}
            {order.status !== "cancelled" && order.status !== "received" && (
              <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => onAdvanceStatus("cancelled")}>
                <XCircle className="w-3.5 h-3.5 mr-1" /> Cancelar
              </Button>
            )}
            {["draft", "sent", "confirmed"].includes(order.status) && (
              <Button size="sm" variant="ghost" onClick={onEdit}>
                <Edit className="w-3.5 h-3.5 mr-1" /> Editar
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar
            </Button>
          </div>
        </div>
      )}

      <ReceiveDialog
        order={order}
        open={recibiendo}
        onOpenChange={setRecibiendo}
        onDone={onReceived}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  usePageTitle("Órdenes de Compra");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [tab, setTab] = usePersistedState<"ordenes" | "cotizaciones" | "solicitudes">(
    orgViewKey("purchase-orders.tab", orgId),
    "ordenes",
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [ocrModalOpen, setOcrModalOpen] = useState(false);
  const [ocrPrefill, setOcrPrefill] = useState<OCRPrefillData | null>(null);

  const loadAll = async () => {
    if (!orgId) return;
    setLoading(true);
    const [ordRes, supRes, prodRes] = await Promise.all([
      supabase.from("purchase_orders").select("*, items:purchase_order_items(*)").eq("org_id", orgId).order("created_at", { ascending: false }),
      // La tabla real es `suppliers` (no `proveedores`), y en products el
      // costo/precio son cost_usd / sale_price_ars.
      supabase.from("suppliers").select("id,name,email").eq("org_id", orgId).order("name"),
      supabase.from("products").select("id,name,sku,cost_usd,sale_price_ars").eq("org_id", orgId).order("name"),
    ]);
    setOrders((ordRes.data ?? []) as PurchaseOrder[]);
    setSuppliers((supRes.data ?? []) as Supplier[]);
    setProducts(((prodRes.data ?? []) as any[]).map(p => ({
      id: p.id, name: p.name, sku: p.sku,
      cost: p.cost_usd ?? null, price: p.sale_price_ars ?? 0,
    })) as Product[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [orgId]);

  const kpis = useMemo(() => {
    const open = orders.filter(o => ["draft", "sent", "confirmed"].includes(o.status)).length;
    const pendingValue = orders.filter(o => ["sent", "confirmed", "partially_received"].includes(o.status)).reduce((a, o) => a + o.total_amount, 0);
    const monthTotal = orders.filter(o => {
      const d = new Date(o.created_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((a, o) => a + o.total_amount, 0);
    const received = orders.filter(o => o.status === "received").length;
    return { open, pendingValue, monthTotal, received };
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      const matchSearch = !search || o.order_number.toLowerCase().includes(search.toLowerCase()) || o.supplier_name.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "all" || o.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [orders, search, filterStatus]);

  const handleAdvanceStatus = async (order: PurchaseOrder, status: string) => {
    const update: Record<string, unknown> = { status };
    if (status === "sent") update.sent_at = new Date().toISOString();
    if (status === "confirmed") update.confirmed_at = new Date().toISOString();
    if (status === "received") update.received_date = new Date().toISOString().slice(0, 10);

    const { error } = await supabase.from("purchase_orders").update(update).eq("id", order.id);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(`OC ${STATUS_CONFIG[status]?.label}`);
    loadAll();
  };

  const handleDelete = async (order: PurchaseOrder) => {
    if (!confirm(`¿Eliminar ${order.order_number}?`)) return;
    const { error } = await supabase.from("purchase_orders").delete().eq("id", order.id);
    if (error) { toast.error("No se puede eliminar"); return; }
    setOrders(prev => prev.filter(o => o.id !== order.id));
    toast.success("OC eliminada");
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={ClipboardList}
        title="Órdenes de Compra"
        description="Gestión formal de OC a proveedores con seguimiento de recepción"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOcrModalOpen(true)}>
              <ScanLine className="w-4 h-4 mr-1.5" /> Escanear factura
            </Button>
            <Button size="sm" onClick={() => { setEditingOrder(null); setOcrPrefill(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Nueva OC
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
          <TabsTrigger value="solicitudes">Solicitudes</TabsTrigger>
        </TabsList>

        <TabsContent value="ordenes" className="space-y-6 pb-12">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KPICard label="OC abiertas" value={kpis.open} sub="en proceso" icon={ClipboardList} color="blue" />
            <KPICard label="Valor pendiente" value={fmtCurrency(kpis.pendingValue)} sub="por recibir" icon={DollarSign} color="warning" />
            <KPICard label="Compras del mes" value={fmtCurrency(kpis.monthTotal)} sub="mes actual" icon={Truck} color="primary" />
            <KPICard label="OC recibidas" value={kpis.received} sub="completadas" icon={CheckCircle} color="success" />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Buscar OC o proveedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin órdenes de compra</p>
              <p className="text-sm">Creá tu primera OC para un proveedor</p>
            </div>
          ) : (
            <div className="space-y-2 pb-12">
              {filtered.map(order => (
                <PORow
                  key={order.id}
                  order={order}
                  onEdit={() => { setEditingOrder(order); setFormOpen(true); }}
                  onAdvanceStatus={status => handleAdvanceStatus(order, status)}
                  onReceived={loadAll}
                  onDelete={() => handleDelete(order)}
                />
              ))}
              <p className="text-xs text-muted-foreground text-right pt-1">{filtered.length} OC{filtered.length !== 1 ? "s" : ""}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="solicitudes">
          <PurchaseRequestsTab />
        </TabsContent>
      </Tabs>

      <POForm
        open={formOpen}
        order={editingOrder}
        suppliers={suppliers}
        products={products}
        orgId={orgId}
        onClose={() => { setFormOpen(false); setEditingOrder(null); setOcrPrefill(null); }}
        onSaved={loadAll}
        prefill={ocrPrefill}
      />

      <InvoiceOCRModal
        open={ocrModalOpen}
        onOpenChange={setOcrModalOpen}
        onUseData={data => { setEditingOrder(null); setOcrPrefill(data); setFormOpen(true); }}
      />
    </div>
  );
}
