import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Lock, Plus, Check, X, Search, Loader2, Package, Clock, RefreshCw } from "lucide-react";
import KPICard from "@/components/shared/KPICard";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { literalFilter } from "@/lib/searchText";

interface Reservation {
  id: string;
  product_id: string;
  customer_name: string;
  customer_phone: string | null;
  quantity: number;
  status: "active" | "fulfilled" | "cancelled" | "expired";
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  products?: { name: string } | null;
}

interface Availability {
  product_id: string;
  product_name: string;
  stock_total: number;
  reserved: number;
  available: number;
}

const STATUS_META: Record<Reservation["status"], { label: string; cls: string }> = {
  active:    { label: "Activa",   cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  fulfilled: { label: "Cumplida", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  cancelled: { label: "Cancelada", cls: "bg-muted text-muted-foreground border-border" },
  expired:   { label: "Vencida",  cls: "bg-red-500/15 text-red-400 border-red-500/30" },
};

export default function StockReservationsTab() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");

  // Form
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    // Vence las que ya pasaron su fecha antes de listar (best-effort)
    await supabase.rpc("expire_stock_reservations", { p_org_id: orgId }).then(() => {}, () => {});
    const [resRes, availRes] = await Promise.all([
      supabase.from("stock_reservations")
        .select("*, products(name)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("product_availability")
        .select("*")
        .eq("org_id", orgId)
        .order("product_name"),
    ]);
    setReservations((resRes.data ?? []) as unknown as Reservation[]);
    setAvailability((availRes.data ?? []) as unknown as Availability[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const selected = availability.find(a => a.product_id === productId);

  const createReservation = async () => {
    const qty = parseInt(quantity, 10);
    if (!productId) { toast.error("Elegí un producto"); return; }
    if (!customerName.trim()) { toast.error("Poné el nombre del cliente"); return; }
    if (!qty || qty <= 0) { toast.error("Cantidad inválida"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("create_stock_reservation", {
        p_org_id: orgId,
        p_product_id: productId,
        p_quantity: qty,
        p_customer_name: customerName.trim(),
        p_customer_phone: customerPhone.trim() || null,
        p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        p_notes: notes.trim() || null,
        p_variant_id: null,
      });
      if (error) throw error;
      toast.success(`Reservadas ${qty} u. para ${customerName.trim()}`);
      setOpen(false);
      setProductId(""); setCustomerName(""); setCustomerPhone("");
      setQuantity("1"); setExpiresAt(""); setNotes("");
      load();
    } catch (e: any) {
      // El RPC devuelve el detalle de stock insuficiente
      toast.error(e.message || "No se pudo crear la reserva");
    } finally { setSaving(false); }
  };

  const resolve = async (id: string, status: "fulfilled" | "cancelled") => {
    const { error } = await supabase.rpc("resolve_stock_reservation", {
      p_reservation_id: id, p_status: status,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(status === "fulfilled" ? "Reserva cumplida" : "Reserva cancelada");
    load();
  };

  const filtered = useMemo(() => {
    let out = reservations;
    if (statusFilter !== "all") out = out.filter(r => r.status === statusFilter);
    if (search.trim().length >= 2) {
      out = literalFilter(out, search, r => [r.customer_name, r.products?.name, r.notes]);
    }
    return out;
  }, [reservations, statusFilter, search]);

  const kpis = useMemo(() => {
    const active = reservations.filter(r => r.status === "active");
    return {
      active: active.length,
      units: active.reduce((s, r) => s + r.quantity, 0),
      porVencer: active.filter(r => r.expires_at && new Date(r.expires_at).getTime() - Date.now() < 3 * 86400000).length,
      productos: new Set(active.map(r => r.product_id)).size,
    };
  }, [reservations]);

  if (loading) return <TableSkeleton rows={6} cols={5} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Reservas activas" value={kpis.active} icon={Lock} color="warning" />
        <KPICard label="Unidades reservadas" value={kpis.units} icon={Package} color="primary" />
        <KPICard label="Vencen en 3 días" value={kpis.porVencer} icon={Clock} color={kpis.porVencer > 0 ? "destructive" : "success"} />
        <KPICard label="Productos afectados" value={kpis.productos} icon={Package} color="primary" />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cliente o producto…" className="pl-8 h-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Activas</SelectItem>
            <SelectItem value="fulfilled">Cumplidas</SelectItem>
            <SelectItem value="cancelled">Canceladas</SelectItem>
            <SelectItem value="expired">Vencidas</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Actualizar</Button>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />Nueva reserva</Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Reservar no descuenta el stock físico: baja el <strong>disponible</strong> (stock − reservas activas),
        así no se vende dos veces lo mismo. Al concretar la venta, marcala como cumplida.
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon={Lock} title="Sin reservas" description="Cuando reserves stock para un cliente, aparece acá." />
      ) : (
        <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Producto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cant.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vence</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(r => {
                const meta = STATUS_META[r.status] ?? STATUS_META.active;
                const vence = r.expires_at ? new Date(r.expires_at) : null;
                const pronto = vence && vence.getTime() - Date.now() < 3 * 86400000;
                return (
                  <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{r.products?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span>{r.customer_name}</span>
                      {r.customer_phone && <span className="block text-[11px] text-muted-foreground">{r.customer_phone}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{r.quantity}</td>
                    <td className="px-4 py-3 text-xs">
                      {vence
                        ? <span className={pronto && r.status === "active" ? "text-amber-400 font-semibold" : "text-muted-foreground"}>
                            {vence.toLocaleDateString("es-AR")}
                          </span>
                        : <span className="text-muted-foreground">Sin vencimiento</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-xs border ${meta.cls}`}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === "active" ? (
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" title="Marcar como cumplida (se concretó la venta)"
                            onClick={() => resolve(r.id, "fulfilled")}>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Cancelar reserva (libera el stock)"
                            onClick={() => resolve(r.id, "cancelled")}>
                            <X className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {r.resolved_at ? new Date(r.resolved_at).toLocaleDateString("es-AR") : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Nueva reserva ─────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="w-4 h-4 text-primary" />Nueva reserva</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label>Producto *</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Elegí un producto" /></SelectTrigger>
                <SelectContent>
                  {availability.filter(a => a.available > 0).map(a => (
                    <SelectItem key={a.product_id} value={a.product_id}>
                      {a.product_name} — {a.available} disp.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Stock {selected.stock_total} · reservado {selected.reserved} · <strong>disponible {selected.available}</strong>
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cliente *</Label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="mt-1.5" placeholder="Nombre" />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="mt-1.5" placeholder="Opcional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cantidad *</Label>
                <Input type="number" min="1" max={selected?.available ?? undefined} value={quantity}
                  onChange={e => setQuantity(e.target.value)} className="mt-1.5 font-mono" />
              </div>
              <div>
                <Label>Vence</Label>
                <Input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="mt-1.5 text-xs" />
              </div>
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1.5 resize-none"
                placeholder="Ej: pasa a buscarlo el viernes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={createReservation} disabled={saving || !productId}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
              Reservar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
