/**
 * Cola + inspector + despacho de pedidos online.
 *
 * Vive en `/pedidos-online` (first-level, vendedor incluido) y también en el tab
 * Pedidos de `/tienda-online` mientras el setup sigue ahí.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import StoreOrdersPanel from "@/components/ecommerce/StoreOrdersPanel";
import StoreOrderInspector from "@/components/ecommerce/StoreOrderInspector";
import OrderShipmentDialog, { type OrderForShipment } from "@/components/ecommerce/OrderShipmentDialog";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import {
  findStoreOrderForInspect,
  isStoreOrderInspectId,
  STORE_ORDER_LIST_SELECT,
  type StoreOrderInspectRow,
} from "@/lib/storeOrderDetail";

interface Props {
  orgId: string | null;
  storeName: string;
  publicStoreUrl?: string | null;
  orders: StoreOrderInspectRow[];
  ordersLoading: boolean;
  ordersError: string | null;
  onReload: () => void | Promise<void>;
  /** Sin tab=orders en la URL (ruta /pedidos-online). */
  standalone?: boolean;
}

export default function StoreOrdersWorkspace({
  orgId,
  storeName,
  publicStoreUrl,
  orders,
  ordersLoading,
  ordersError,
  onReload,
  standalone = false,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { ask, dialog } = useConfirmDialog();
  const [envioDe, setEnvioDe] = useState<StoreOrderInspectRow | null>(null);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [pedidoExtra, setPedidoExtra] = useState<StoreOrderInspectRow | null>(null);
  const [pedidoExtraLoading, setPedidoExtraLoading] = useState(false);

  const pedidoId = searchParams.get("pedido");
  const inspectedOrder = findStoreOrderForInspect(orders, pedidoId) ?? pedidoExtra;

  const openPedido = useCallback((orderId: string) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (!standalone) params.set("tab", "orders");
      params.set("pedido", orderId);
      return params;
    });
  }, [setSearchParams, standalone]);

  const closePedido = useCallback(() => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.delete("pedido");
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const confirmarPagoManual = async (order: { id: string; order_number: string; payment_method?: string | null }) => {
    const medio = order.payment_method === "efectivo" ? "efectivo" : "transferencia";
    if (!(await ask({
      title: "¿Marcar como cobrado?",
      description: medio === "efectivo"
        ? `Confirmás que recibiste el pago en efectivo del pedido ${order.order_number}. Se acredita la venta y se puede despachar.`
        : `Confirmás que viste la transferencia del pedido ${order.order_number}. Se acredita la venta y se puede despachar.`,
      confirmText: "Marcar cobrado",
    }))) return;
    setConfirmingPaid(true);
    const { data, error } = await supabase.rpc("confirmar_pago_manual_tienda", {
      p_order_id: order.id,
    });
    setConfirmingPaid(false);
    if (error) {
      console.error("confirmar_pago_manual_tienda:", error);
      toast.error(error.message || "No se pudo acreditar el pago.");
      return;
    }
    if ((data as { ok?: boolean } | null)?.ok === false) {
      toast.error("No se pudo acreditar el pago.");
      return;
    }
    toast.success(`Pedido ${order.order_number} marcado como cobrado`);
    const { data: mailData, error: mailErr } = await supabase.functions.invoke(
      "store-order-status-email",
      { body: { orderId: order.id, event: "payment_confirmed" } },
    );
    const mailMsg = (mailData as { error?: string } | null)?.error;
    if (mailErr || mailMsg) {
      console.error("store-order-status-email / payment_confirmed:", mailErr ?? mailMsg);
      toast.warning(
        `Cobro acreditado, pero no pudimos avisar por email${mailMsg ? `: ${mailMsg}` : "."}`,
      );
    }
    await onReload();
  };

  useEffect(() => {
    const raw = searchParams.get("pedido");
    if (!raw) {
      setPedidoExtra(null);
      setPedidoExtraLoading(false);
      return;
    }
    if (findStoreOrderForInspect(orders, raw)) {
      setPedidoExtra(null);
      setPedidoExtraLoading(false);
      return;
    }
    if (!orgId || !isStoreOrderInspectId(raw)) {
      setPedidoExtra(null);
      setPedidoExtraLoading(false);
      return;
    }
    let cancelado = false;
    setPedidoExtraLoading(true);
    supabase
      .from("ecommerce_orders")
      .select(STORE_ORDER_LIST_SELECT)
      .eq("org_id", orgId)
      .eq("id", raw)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          console.error("Pedido fuera de cola:", error);
          setPedidoExtra(null);
        } else {
          setPedidoExtra((data ?? null) as StoreOrderInspectRow | null);
        }
        setPedidoExtraLoading(false);
      });
    return () => { cancelado = true; };
  }, [searchParams, orders, orgId]);

  return (
    <>
      <StoreOrdersPanel
        orders={orders}
        loading={ordersLoading}
        error={ordersError}
        selectedId={pedidoId}
        publicStoreUrl={publicStoreUrl}
        standalone={standalone}
        onRetry={() => { void onReload(); }}
        onInspect={order => openPedido(order.id)}
        onPrepare={order => {
          const full = orders.find(o => o.id === order.id) ?? inspectedOrder;
          if (full) setEnvioDe(full);
        }}
      />
      <OrderShipmentDialog
        order={envioDe as OrderForShipment | null}
        storeName={storeName}
        onClose={() => setEnvioDe(null)}
        onDone={() => { void onReload(); }}
      />
      <StoreOrderInspector
        open={Boolean(pedidoId)}
        orgId={orgId}
        order={inspectedOrder}
        requestedId={pedidoId}
        loading={Boolean(pedidoId) && !inspectedOrder && (ordersLoading || pedidoExtraLoading)}
        confirmingPaid={confirmingPaid}
        onClose={closePedido}
        onPrepare={order => { setEnvioDe(order as StoreOrderInspectRow); }}
        onConfirmPaid={order => { void confirmarPagoManual(order); }}
      />
      {dialog}
    </>
  );
}
