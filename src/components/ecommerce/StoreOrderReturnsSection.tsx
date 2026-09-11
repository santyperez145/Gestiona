/**
 * Sección de devoluciones y reclamos (RMA) dentro de la ficha de un pedido.
 *
 * Muestra el historial de solicitudes asociadas al pedido y permite crear una
 * devolución directamente para cumplir con la Ley 24.240 o garantías comerciales.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RotateCcw,
  ExternalLink,
  Plus,
  Loader2,
  Clock,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { formatARS } from "@/lib/supabaseStore";
import {
  calcularDiasArrepentimiento,
  estaEnPlazoArrepentimiento,
  returnStatusLabel,
  returnStatusTone,
  returnTipoLabel,
  type StoreOrderReturnSummary,
} from "@/lib/storeOrderReturn";
import type { StoreOrderDetail } from "@/lib/storeOrderDetail";

interface Props {
  detail: StoreOrderDetail;
  orgId?: string;
  canEdit: boolean;
}

export default function StoreOrderReturnsSection({ detail, orgId, canEdit }: Props) {
  const [returns, setReturns] = useState<StoreOrderReturnSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Formulario de nueva devolución
  const [selectedItemIdx, setSelectedItemIdx] = useState("0");
  const [tipo, setTipo] = useState<"arrepentimiento" | "falla">("arrepentimiento");
  const [quantity, setQuantity] = useState("1");
  const [motivo, setMotivo] = useState("");

  const diasArrepentimiento = calcularDiasArrepentimiento(detail.order.delivered_at);
  const enPlazo = estaEnPlazoArrepentimiento(detail.order.delivered_at);
  const isPaid = detail.order.payment_status === "paid";

  const loadReturns = useCallback(async () => {
    if (!orgId || !detail.order.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("return_requests")
      .select("id, rma_number, tipo, status, product_name, quantity, refund_amount, resolution, created_at")
      .eq("org_id", orgId)
      .eq("ecommerce_order_id", detail.order.id)
      .order("created_at", { ascending: false });

    setLoading(false);
    if (error) {
      console.error("Error cargando return_requests:", error);
      return;
    }
    setReturns((data ?? []) as StoreOrderReturnSummary[]);
  }, [orgId, detail.order.id]);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  const handleCrearDevolucion = async () => {
    if (!orgId || !canEdit) return;
    const item = detail.items[Number(selectedItemIdx)] ?? detail.items[0];
    const qty = parseInt(quantity, 10);

    if (isNaN(qty) || qty < 1) {
      toast.error("Ingresá una cantidad válida");
      return;
    }

    if (item && qty > item.quantity) {
      toast.error(`La cantidad no puede superar las ${item.quantity} unidades compradas`);
      return;
    }

    if (tipo === "arrepentimiento" && !enPlazo) {
      toast.error("El plazo legal de arrepentimiento de 10 días ya expiró. Podés iniciar por falla si corresponde a garantía.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("return_requests").insert({
      org_id: orgId,
      rma_number: "", // el trigger de la base genera el RMA-YYYY-XXXXX
      ecommerce_order_id: detail.order.id,
      customer_name: detail.order.customer_name,
      customer_email: detail.order.customer_email || null,
      product_name: item ? item.name : "Producto de orden",
      quantity: qty,
      tipo,
      condition: tipo === "arrepentimiento" ? "unopened" : "defective",
      status: "pending",
      reason_text: motivo.trim() || (tipo === "arrepentimiento" ? "Arrepentimiento legal de compra" : "Reclamo por falla"),
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message || "No se pudo registrar la solicitud");
      return;
    }

    toast.success("Solicitud de devolución registrada");
    setModalOpen(false);
    setMotivo("");
    loadReturns();
  };

  return (
    <section aria-labelledby="pedido-devoluciones" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 id="pedido-devoluciones" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <RotateCcw className="h-3.5 w-3.5 text-primary" />
          Devoluciones y reclamos (RMA)
        </h3>
        {isPaid && canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-primary hover:text-primary gap-1 px-2"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Iniciar RMA
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-4 border border-border/60 rounded-lg bg-card text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
          Consultando devoluciones...
        </div>
      ) : returns.length > 0 ? (
        <div className="space-y-2">
          {returns.map((r) => (
            <article
              key={r.id}
              className="rounded-lg border border-border/60 bg-card p-3 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs font-bold text-primary">
                    {r.rma_number || "RMA en trámite"}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    · {returnTipoLabel(r.tipo)}
                  </span>
                </div>
                <Badge className={`text-[10px] border ${returnStatusTone(r.status)}`}>
                  {returnStatusLabel(r.status)}
                </Badge>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate max-w-[65%]">
                  {r.quantity} × {r.product_name}
                </span>
                {r.refund_amount ? (
                  <span className="font-mono font-medium text-foreground">
                    Reintegro: {formatARS(Number(r.refund_amount))}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
                <span className="text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString("es-AR")}
                </span>
                <Link
                  to={`/ventas?tab=Devoluciones&search=${encodeURIComponent(r.rma_number || "")}`}
                  className="text-primary hover:underline flex items-center gap-1 font-medium"
                >
                  Gestionar en portal
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 bg-muted/15 p-3 text-xs space-y-1">
          <p className="text-muted-foreground">
            No hay solicitudes de devolución registradas para este pedido.
          </p>
          {isPaid && (
            <div className="flex items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
              {enPlazo ? (
                <>
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>
                    Arrepentimiento legal: <strong>{diasArrepentimiento} día{diasArrepentimiento !== 1 ? "s" : ""} restante{diasArrepentimiento !== 1 ? "s" : ""}</strong> (Ley 24.240).
                  </span>
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>Plazo legal de arrepentimiento finalizado. Se admiten reclamos por falla de producto.</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal para iniciar RMA */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Iniciar devolución / RMA</DialogTitle>
            <DialogDescription>
              Pedido {detail.order.order_number} · {detail.order.customer_name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rma-item">Producto a devolver</Label>
              <Select value={selectedItemIdx} onValueChange={setSelectedItemIdx}>
                <SelectTrigger id="rma-item">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {detail.items.map((it, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {it.name} (comprado: {it.quantity}u)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rma-tipo">Tipo de devolución</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
                  <SelectTrigger id="rma-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="arrepentimiento">Arrepentimiento (Ley 24.240)</SelectItem>
                    <SelectItem value="falla">Falla / Garantía</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rma-qty">Cantidad</Label>
                <Input
                  id="rma-qty"
                  type="number"
                  min="1"
                  max={detail.items[Number(selectedItemIdx)]?.quantity || 1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            {tipo === "arrepentimiento" && !enPlazo && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-500">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Pasaron más de 10 días desde la entrega. Seleccioná "Falla / Garantía" si el reclamo es por mal funcionamiento.</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rma-motivo">Motivo o detalle del cliente</Label>
              <Input
                id="rma-motivo"
                placeholder={tipo === "arrepentimiento" ? "Sin causa (opcional)" : "Describí la falla del producto"}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleCrearDevolucion} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Registrar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
