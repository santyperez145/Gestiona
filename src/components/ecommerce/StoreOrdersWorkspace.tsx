/**
 * Cola + inspector + despacho de pedidos online.
 *
 * Vive sólo en `/pedidos-online` (first-level). El tab Pedidos de Commerce
 * redirige acá para no duplicar la cola.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import StoreOrdersPanel from "@/components/ecommerce/StoreOrdersPanel";
import StoreOrderInspector from "@/components/ecommerce/StoreOrderInspector";
import OrderShipmentDialog, { type OrderForShipment } from "@/components/ecommerce/OrderShipmentDialog";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { useHasPermission } from "@/lib/usePermissions";
import {
  findStoreOrderForInspect,
  isStoreOrderInspectId,
  STORE_ORDER_LIST_SELECT,
  type StoreOrderInspectRow,
} from "@/lib/storeOrderDetail";
import {
  countBulkFulfillmentCandidates,
  parseStoreOrderBulkResponse,
  type StoreOrderBulkResponse,
  type StoreOrderBulkStatus,
  type StoreOrderQueueRow,
} from "@/lib/storeOrderQueue";

interface Props {
  orgId: string | null;
  storeName: string;
  publicStoreUrl?: string | null;
  orders: StoreOrderInspectRow[];
  ordersLoading: boolean;
  ordersError: string | null;
  onReload: () => void | Promise<void>;
}

export default function StoreOrdersWorkspace({
  orgId,
  storeName,
  publicStoreUrl,
  orders,
  ordersLoading,
  ordersError,
  onReload,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { ask, dialog } = useConfirmDialog();
  const canEditEcommerce = useHasPermission("ecommerce", "edit");
  const [envioDe, setEnvioDe] = useState<StoreOrderInspectRow | null>(null);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<StoreOrderBulkResponse | null>(null);
  const [pedidoExtra, setPedidoExtra] = useState<StoreOrderInspectRow | null>(null);
  const [pedidoExtraLoading, setPedidoExtraLoading] = useState(false);

  const pedidoId = searchParams.get("pedido");
  const inspectedOrder = findStoreOrderForInspect(orders, pedidoId) ?? pedidoExtra;

  const openPedido = useCallback((orderId: string) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.set("pedido", orderId);
      return params;
    });
  }, [setSearchParams]);

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

  const avisarEstadoMasivo = async (orderIds: string[], event: StoreOrderBulkStatus) => {
    let failed = 0;
    for (let start = 0; start < orderIds.length; start += 4) {
      const batch = orderIds.slice(start, start + 4);
      const outcomes = await Promise.all(batch.map(async orderId => {
        try {
          const { data, error } = await supabase.functions.invoke("store-order-status-email", {
            body: { orderId, event },
          });
          const message = (data as { error?: string } | null)?.error;
          if (error || message) {
            console.error("store-order-status-email / bulk:", error ?? message);
            return false;
          }
          return true;
        } catch (error) {
          console.error("store-order-status-email / bulk:", error);
          return false;
        }
      }));
      failed += outcomes.filter(ok => !ok).length;
    }
    return failed;
  };

  const actualizarEntregaMasiva = async (
    selectedOrders: StoreOrderQueueRow[],
    status: StoreOrderBulkStatus,
  ) => {
    if (!orgId || !canEditEcommerce || selectedOrders.length === 0) return false;
    const candidates = countBulkFulfillmentCandidates(selectedOrders, status);
    const skippedByShape = selectedOrders.length - candidates;
    const action = status === "shipped" ? "marcar en camino" : "marcar entregados o retirados";
    if (!(await ask({
      title: `¿${action[0].toUpperCase()}${action.slice(1)}?`,
      description: `${candidates} de ${selectedOrders.length} pedidos tienen una transición compatible. ${
        skippedByShape > 0 ? `${skippedByShape} no aplican y quedarán sin cambios. ` : ""
      }La base vuelve a validar pago, preparación, tenant y estado antes de cambiar cada fila.`,
      confirmText: status === "shipped" ? "Marcar en camino" : "Confirmar entrega",
    }))) return false;

    setBulkBusy(true);
    const { data, error } = await supabase.rpc("bulk_update_store_order_fulfillment", {
      p_org_id: orgId,
      p_order_ids: selectedOrders.map(order => order.id),
      p_status: status,
    });
    if (error) {
      setBulkBusy(false);
      console.error("bulk_update_store_order_fulfillment:", error);
      toast.error(error.message || "No se pudo actualizar el lote.");
      return false;
    }
    const parsed = parseStoreOrderBulkResponse(data);
    if (!parsed) {
      setBulkBusy(false);
      console.error("bulk_update_store_order_fulfillment: respuesta inválida", data);
      toast.error("La base devolvió un resultado inválido. No repetimos la acción automáticamente.");
      return false;
    }
    setBulkResult(parsed);
    await onReload();

    const changedIds = parsed.results
      .filter(item => item.outcome === "changed" && item.order_id)
      .map(item => item.order_id as string);
    const notificationFailures = await avisarEstadoMasivo(changedIds, status);
    setBulkBusy(false);

    if (parsed.changed > 0) {
      toast.success(`${parsed.changed} ${parsed.changed === 1 ? "pedido actualizado" : "pedidos actualizados"}`);
    } else {
      toast.info("Ningún pedido necesitó el cambio.");
    }
    if (notificationFailures > 0) {
      toast.warning(`${notificationFailures} ${notificationFailures === 1 ? "aviso no pudo" : "avisos no pudieron"} enviarse. Los estados sí quedaron guardados.`);
    }
    return true;
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
        onRetry={() => { void onReload(); }}
        onInspect={order => openPedido(order.id)}
        onPrepare={order => {
          const full = orders.find(o => o.id === order.id) ?? inspectedOrder;
          if (full) setEnvioDe(full);
        }}
        canBulkEdit={canEditEcommerce}
        bulkBusy={bulkBusy}
        bulkResult={bulkResult}
        onDismissBulkResult={() => setBulkResult(null)}
        onBulkFulfill={actualizarEntregaMasiva}
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
