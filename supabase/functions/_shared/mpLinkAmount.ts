/**
 * Autoridad del monto para Checkout Pro (mercadopago-link).
 *
 * Si el cobro apunta a una fila del Core (payment_link o quote), el total sale
 * de ahí. El body del navegador no es autoridad. Sin fuente durable (POS ad-hoc)
 * se admite el total del cajero — mismo criterio que el ticket POS.
 */

export type MpLinkAmountSource =
  | { kind: "payment_link"; id: string }
  | { kind: "quote"; id: string }
  | { kind: "client_ad_hoc" };

export type MpLinkAmountResult =
  | { ok: true; total: number; source: MpLinkAmountSource }
  | { ok: false; error: string; status: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseQuoteExternalRef(externalRef: string | null | undefined): string | null {
  if (!externalRef) return null;
  const m = /^quote:([0-9a-f-]{36})$/i.exec(externalRef.trim());
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

export function parseLinkExternalRef(externalRef: string | null | undefined): string | null {
  if (!externalRef) return null;
  const m = /^link:([0-9a-f-]{36})$/i.exec(externalRef.trim());
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

export function validateChargeTotal(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0 || total > 999_999_999_999.99) {
    return "El monto del cobro no es válido";
  }
  return null;
}

/** Redondeo ARS a 2 decimales (media unidad hacia arriba en valor absoluto). */
export function roundArs(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Elige el total canónico: si hay fila del Core, gana la fila.
 * `clientTotal` sólo aplica cuando no hay fuente.
 */
export function pickCanonicalTotal(opts: {
  coreTotal: number | null | undefined;
  clientTotal: number | null | undefined;
  source: MpLinkAmountSource;
}): MpLinkAmountResult {
  if (opts.source.kind !== "client_ad_hoc") {
    const t = Number(opts.coreTotal);
    const err = validateChargeTotal(t);
    if (err) return { ok: false, error: err, status: 422 };
    return { ok: true, total: roundArs(t), source: opts.source };
  }
  const t = Number(opts.clientTotal);
  const err = validateChargeTotal(t);
  if (err) return { ok: false, error: err, status: 400 };
  return { ok: true, total: roundArs(t), source: opts.source };
}
