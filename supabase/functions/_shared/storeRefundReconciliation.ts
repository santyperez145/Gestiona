/**
 * Reconciliación de reintegros de tienda contra MercadoPago.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * Un reintegro queda `processing` cuando el POST hacia MercadoPago no termina
 * de confirmarse (timeout, respuesta no-approved, o confirmación que llega en
 * un webhook posterior). El operador siempre puede pulsar «Consultar estado»,
 * pero el dinero no debería quedar colgado hasta que alguien lo haga: si el
 * comercio no abre el panel, el RMA queda `approved/processing` para siempre y
 * el cliente ve su plata atrapada.
 *
 * ── Quién lo llama ──────────────────────────────────────────────────────────
 *
 * Dos caminos, una sola lógica:
 *  - `mercadopago-webhook`: cuando MP notifica un `payment.updated` de un pago
 *    con reintegros pendientes (recuperación barata y en caliente).
 *  - `reconcile-store-refunds` (cron): barre cada 10 minutos **todas** las
 *    operaciones `processing` de todas las orgs y las reconcilia aunque MP
 *    nunca mande el webhook — o el webhook se pierda, que pasa.
 *
 * La autoridad del dinero sigue siendo la base: `pago_reintegro_resultado`
 * valida monto, org y estado en SQL antes de asentar. Este módulo sólo trae
 * la verdad del proveedor y se la entrega al RPC.
 */
import { getMpCredentials } from "./mpToken.ts";

/** Sanea una fila de refund del proveedor para guardarla como evidencia. */
function refundSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const asText = (item: unknown, max = 120): string | null => {
    if (typeof item !== "string" && typeof item !== "number") return null;
    const clean = String(item).trim();
    return clean ? clean.slice(0, max) : null;
  };
  return {
    id: asText(row.id),
    status: asText(row.status, 40),
    amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
    payment_id: asText(row.payment_id),
    date_created: asText(row.date_created, 80),
    source: "mercadopago_refund_reconciliation",
  };
}

interface PendingRefundRow {
  id: string;
  amount: number | null;
  status: string;
  external_refund_id: string | null;
}

/** Opciones de la reconciliación. */
export interface ReconcileOptions {
  /** Client con service_role: lee payment_refunds y llama a los RPCs de dinero. */
  // deno-lint-ignore no-explicit-any
  admin: any;
  /** Org del pago; acota la búsqueda y evita cruzar organizaciones. */
  orgId?: string;
  /** Payment id de MercadoPago; cuando falta, se barre todo lo pendiente. */
  providerPaymentId?: string | null;
  /** Token del comercio; si falta se resuelve por organización. */
  accessToken?: string | null;
  /** Telemetría del origen de la llamada (webhook / cron). */
  source: "mercadopago_webhook" | "reconcile_cron";
}

export interface ReconcileOutcome {
  checked: number;
  settled: number;
  observed: number;
  failedFetches: number;
}

const EMPTY: ReconcileOutcome = { checked: 0, settled: 0, observed: 0, failedFetches: 0 };

/**
 * Reconcilia reintegros `processing` de tienda con la lista oficial de
 * refunds de MercadoPago. Idempotente: si no hay pendientes, no hace nada.
 */
export async function reconcileStoreRefunds(
  options: ReconcileOptions,
): Promise<ReconcileOutcome> {
  const { admin, source } = options;
  const orgId = options.orgId ?? null;
  const paymentId = options.providerPaymentId ?? null;

  let query = admin
    .from("payment_refunds")
    .select("id, org_id, amount, status, external_refund_id, provider_payment_id")
    .eq("provider", "mercadopago")
    .eq("status", "processing")
    .limit(50);

  if (orgId) query = query.eq("org_id", orgId);
  if (paymentId) query = query.eq("provider_payment_id", paymentId);

  const { data: pending, error: pendingError } = await query;
  if (pendingError) {
    console.error("storeRefundReconciliation pending lookup:", pendingError);
    return { ...EMPTY };
  }
  if (!pending?.length) return { ...EMPTY };

  // Los tokens viven por organización: agrupar evita pedir la credencial del
  // mismo comercio varias veces en un mismo lote.
  const tokens = new Map<string, string | null>();

  // deno-lint-ignore no-explicit-any
  const tokenFor = async (rowOrgId: string): Promise<string | null> => {
    if (tokens.has(rowOrgId)) return tokens.get(rowOrgId) ?? null;
    let resolved: string | null = null;
    try {
      const creds = await getMpCredentials(admin, rowOrgId);
      resolved = creds?.accessToken ?? null;
    } catch (error) {
      console.error("storeRefundReconciliation credentials:", error);
    }
    tokens.set(rowOrgId, resolved);
    return resolved;
  };

  const outcome: ReconcileOutcome = { ...EMPTY };

  for (const refund of pending) {
    const rowOrgId: string = refund.org_id;
    const rowPaymentId = refund.provider_payment_id
      ? String(refund.provider_payment_id)
      : null;
    if (!rowOrgId || !rowPaymentId) {
      // Sin org o sin payment id no hay contrato con el proveedor: queda
      // pendiente y visible en `payment_refunds.raw` la próxima observación.
      continue;
    }

    const accessToken = options.accessToken && rowOrgId === orgId && rowPaymentId === paymentId
      ? options.accessToken
      : await tokenFor(rowOrgId);
    if (!accessToken) {
      console.error("storeRefundReconciliation: sin token para org", rowOrgId);
      outcome.failedFetches += 1;
      continue;
    }

    let response: Response;
    let payload: unknown;
    try {
      response = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(rowPaymentId)}/refunds`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      payload = await response.json().catch(() => ({}));
    } catch (error) {
      console.error("storeRefundReconciliation provider network:", error);
      outcome.failedFetches += 1;
      continue;
    }

    if (!response.ok) {
      console.error("storeRefundReconciliation provider:", response.status);
      outcome.failedFetches += 1;
      continue;
    }

    const rows = Array.isArray(payload)
      ? payload.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).refunds)
        ? ((payload as Record<string, unknown>).refunds as unknown[]).filter(
          (row): row is Record<string, unknown> => !!row && typeof row === "object",
        )
        : [];

    const approved = rows.filter((row) => String(row.status ?? "").toLowerCase() === "approved");

    // El monto solo identifica un reintegro cuando no hay otro pendiente con
    // el mismo importe: si lo hay, esperar el ID del proveedor evita asignar
    // dinero al RMA equivocado. Es la misma regla que aplicaba el webhook.
    const localSameAmount = pending.filter(
      (candidate: { amount?: unknown; id?: unknown }) =>
        candidate.id !== refund.id
        && Number(candidate.amount) === Number(refund.amount),
    );
    const knownExternalId = refund.external_refund_id ? String(refund.external_refund_id) : "";
    const exactMatches = approved
      // deno-lint-ignore no-explicit-any
      .map((row: any, index: number) => ({ row, index }))
      .filter(({ row }) => knownExternalId && String(row.id ?? "") === knownExternalId);
    const amountMatches = approved
      // deno-lint-ignore no-explicit-any
      .map((row: any, index: number) => ({ row, index }))
      .filter(({ row }) => Number(row.amount) === Number(refund.amount));

    const matches = exactMatches.length > 0
      ? exactMatches
      : localSameAmount.length === 0
        ? amountMatches
        : [];

    outcome.checked += 1;

    if (matches.length !== 1) {
      await admin.rpc("pago_reintegro_observar", {
        p_refund_id: refund.id,
        p_raw: {
          source: `${source}_refund_reconciliation`,
          approved_refunds: approved.slice(0, 25).map(refundSnapshot),
          reason: matches.length === 0 ? "no_match" : "ambiguous_match",
        },
      });
      outcome.observed += 1;
      continue;
    }

    const match = matches[0];
    const providerRow = refundSnapshot(match.row);
    const { error: settledError } = await admin.rpc("pago_reintegro_resultado", {
      p_refund_id: refund.id,
      p_status: "refunded",
      p_external_id: providerRow.id,
      p_raw: providerRow,
    });
    if (settledError) {
      // El proveedor confirmó el dinero; el RPC asentará en un próximo intento
      // con la misma clave. Fallar ruidoso acá mantiene la evidencia visible.
      console.error("pago_reintegro_resultado reconciliation:", settledError);
      continue;
    }
    outcome.settled += 1;
  }

  return outcome;
}