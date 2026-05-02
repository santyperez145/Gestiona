import { useState, useEffect } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Search, RotateCcw, Package, Calendar, DollarSign,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Loader2,
} from "lucide-react";
import { formatARS } from "@/lib/supabaseStore";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

type Return = {
  id: string;
  sale_id: string | null;
  product_name: string;
  quantity: number;
  amount_ars: number;
  reason: string;
  refund_method: string;
  notes: string;
  created_at: string;
};

type Sale = {
  id: string;
  product_name: string;
  quantity: number;
  total_ars: number;
  customer_name: string;
  date: string;
  returned: boolean;
};

const REFUND_METHODS = [
  { value: "efectivo",       label: "Efectivo" },
  { value: "transferencia",  label: "Transferencia" },
  { value: "credito_tienda", label: "Crédito en tienda" },
];

const REASONS = [
  "Producto defectuoso",
  "Error en el pedido",
  "El cliente cambió de opinión",
  "Producto no corresponde a la descripción",
  "Daño en el envío",
  "Otro",
];

export default function DevolucionesPage() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();

  const [returns, setReturns] = useState<Return[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form
  const [saleSearch, setSaleSearch] = useState("");
  const [saleResults, setSaleResults] = useState<Sale[]>([]);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [amountArs, setAmountArs] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [refundMethod, setRefundMethod] = useState("efectivo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchingRef, setSearchingRef] = useState(false);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("returns")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setReturns((data as Return[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const searchSales = async (q: string) => {
    if (!q.trim() || !activeOrg) { setSaleResults([]); return; }
    setSearchingRef(true);
    const { data } = await supabase
      .from("sales")
      .select("id, product_name, quantity, total_ars, customer_name, date, returned")
      .eq("org_id", activeOrg.id)
      .eq("returned", false)
      .ilike("product_name", `%${q}%`)
      .order("date", { ascending: false })
      .limit(8);
    setSaleResults((data as Sale[]) || []);
    setSearchingRef(false);
  };

  const selectSale = (s: Sale) => {
    setSelectedSale(s);
    setProductName(s.product_name);
    setQuantity("1");
    setAmountArs(String(s.total_ars));
    setSaleResults([]);
    setSaleSearch(s.product_name);
  };

  const resetForm = () => {
    setSelectedSale(null); setSaleSearch(""); setSaleResults([]);
    setProductName(""); setQuantity("1"); setAmountArs("");
    setReason(REASONS[0]); setRefundMethod("efectivo"); setNotes("");
  };

  const handleCreate = async () => {
    if (!productName.trim() || !activeOrg || !user) return;
    const qty = parseInt(quantity) || 1;
    const amount = parseFloat(amountArs) || 0;
    setSaving(true);

    try {
      // Insert return record
      const { data: ret, error: retErr } = await supabase
        .from("returns")
        .insert({
          org_id: activeOrg.id,
          user_id: user.id,
          sale_id: selectedSale?.id || null,
          product_name: productName,
          quantity: qty,
          amount_ars: amount,
          reason,
          refund_method: refundMethod,
          notes: notes || null,
        })
        .select("id")
        .single();

      if (retErr) throw retErr;

      // Restore stock on the product linked to the sale
      if (selectedSale?.id) {
        // Get the product_id from the sale
        const { data: saleRow } = await supabase
          .from("sales")
          .select("product_id")
          .eq("id", selectedSale.id)
          .maybeSingle();

        if (saleRow?.product_id) {
          // Increment stock
          await supabase.rpc("increment_product_stock", {
            p_product_id: saleRow.product_id,
            p_qty: qty,
          }).catch(async () => {
            // Fallback: manual increment if RPC doesn't exist
            const { data: prod } = await supabase
              .from("products")
              .select("stock")
              .eq("id", saleRow.product_id)
              .maybeSingle();
            if (prod) {
              await supabase
                .from("products")
                .update({ stock: (prod.stock || 0) + qty })
                .eq("id", saleRow.product_id);
            }
          });
        }

        // Mark original sale as returned
        await supabase
          .from("sales")
          .update({ returned: true, return_id: ret.id })
          .eq("id", selectedSale.id);
      }

      toast.success(`Devolución registrada · Stock restaurado (+${qty} uds)`);
      setOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.error(e.message || "Error al registrar devolución");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("returns").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Devolución eliminada"); load(); }
  };

  const filtered = returns.filter(r =>
    r.product_name.toLowerCase().includes(search.toLowerCase()) ||
    (r.reason || "").toLowerCase().includes(search.toLowerCase())
  );

  const totalReturned = filtered.reduce((s, r) => s + r.amount_ars, 0);
  const totalUnits = filtered.reduce((s, r) => s + r.quantity, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-primary" /> Devoluciones
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {returns.length} devoluciones · {totalUnits} unidades · {formatARS(totalReturned)} reintegrado
          </p>
        </div>
        <Button className="gradient-gold text-primary-foreground shadow-gold h-9" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Nueva devolución
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-card border border-border rounded-xl p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total devoluciones</p>
          <p className="text-xl font-bold font-display mt-1">{returns.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Unidades devueltas</p>
          <p className="text-xl font-bold font-display mt-1">{returns.reduce((s, r) => s + r.quantity, 0)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Monto reintegrado</p>
          <p className="text-xl font-bold font-display text-destructive mt-1">
            {formatARS(returns.reduce((s, r) => s + r.amount_ars, 0))}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por producto o motivo…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <RotateCcw className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">
            {search ? "Sin resultados." : "No hay devoluciones registradas."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <div key={r.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
                  <RotateCcw className="w-4 h-4 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{r.product_name}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      ×{r.quantity} uds
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${
                      r.refund_method === "efectivo" ? "text-green-400 border-green-500/20"
                        : r.refund_method === "transferencia" ? "text-blue-400 border-blue-500/20"
                        : "text-primary border-primary/20"
                    }`}>
                      {REFUND_METHODS.find(m => m.value === r.refund_method)?.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(r.created_at).toLocaleDateString("es-AR")}
                    </span>
                    <span className="text-sm font-bold text-destructive">{formatARS(r.amount_ars)}</span>
                    {r.reason && (
                      <span className="text-xs text-muted-foreground truncate">{r.reason}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                  >
                    {expandedId === r.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <ConfirmDialog
                    title="Eliminar devolución"
                    description="¿Eliminás este registro? El stock NO se vuelve a descontar."
                    onConfirm={() => handleDelete(r.id)}
                  >
                    <button className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors text-xs px-2">
                      Eliminar
                    </button>
                  </ConfirmDialog>
                </div>
              </div>

              {expandedId === r.id && (
                <div className="px-4 py-3 border-t border-border bg-muted/10 space-y-1 text-xs text-muted-foreground">
                  <div className="flex gap-2">
                    <Package className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Motivo: <span className="text-foreground">{r.reason || "—"}</span></span>
                  </div>
                  {r.sale_id && (
                    <div className="flex gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-success" />
                      <span>Venta original vinculada · stock restaurado automáticamente</span>
                    </div>
                  )}
                  {r.notes && (
                    <div className="flex gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Notas: {r.notes}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar devolución</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">

            {/* Search existing sale */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Buscar venta de referencia <span className="text-muted-foreground/50">(opcional)</span>
              </label>
              <div className="relative">
                <Input
                  placeholder="Nombre del producto de la venta original…"
                  value={saleSearch}
                  onChange={e => { setSaleSearch(e.target.value); searchSales(e.target.value); }}
                  className="pr-8"
                />
                {searchingRef && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {saleResults.length > 0 && (
                <div className="mt-1 border border-border rounded-lg overflow-hidden shadow-lg z-10">
                  {saleResults.map(s => (
                    <button
                      key={s.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border/50 last:border-0 transition-colors"
                      onClick={() => selectSale(s)}
                    >
                      <span className="font-medium">{s.product_name}</span>
                      <span className="text-muted-foreground text-xs ml-2">
                        {new Date(s.date).toLocaleDateString("es-AR")} · {formatARS(s.total_ars)}
                        {s.customer_name ? ` · ${s.customer_name}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {selectedSale && (
                <div className="mt-2 flex items-center gap-2 text-xs text-success bg-success/5 border border-success/20 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Venta vinculada · el stock se restaurará automáticamente
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Producto *</label>
              <Input
                placeholder="Nombre del producto"
                value={productName}
                onChange={e => setProductName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Cantidad *</label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Monto a reintegrar (ARS)</label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={amountArs}
                  onChange={e => setAmountArs(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Motivo *</label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Método de reintegro</label>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REFUND_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas internas</label>
              <Textarea
                placeholder="Descripción del problema, fotos adjuntas, etc."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="h-16 resize-none text-xs"
              />
            </div>

            <Button
              className="w-full gradient-gold text-primary-foreground"
              disabled={!productName.trim() || saving}
              onClick={handleCreate}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Registrando…</>
                : <><RotateCcw className="w-4 h-4 mr-2" />Registrar devolución</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
