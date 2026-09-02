/**
 * Espejo de `supabase/functions/_shared/mpLinkAmount.ts` para vitest.
 * Si se toca uno, se toca el otro (misma regla que rounding / paymentFees).
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

export function roundArs(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

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
