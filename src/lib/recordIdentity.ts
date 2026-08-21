/**
 * Canonical keys used to review records across imports and sales channels.
 * These keys are for matching and reporting; they never replace source data.
 */

export function normalizeIdentityText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

export function normalizeIdentityEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/\s+/g, "").trim();
  return normalized || null;
}

export function normalizeIdentityPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\D/g, "");
  return normalized || null;
}

export function normalizeProductSku(value: string | null | undefined): string | null {
  const text = normalizeIdentityText(value);
  return text ? text.replace(/\s/g, "").toUpperCase() : null;
}

export function normalizeProductBarcode(value: string | null | undefined): string | null {
  return normalizeIdentityPhone(value);
}

export interface ProductIdentityReviewRow {
  id: string;
  org_id: string;
  name: string;
  brand: string;
  sku: string | null;
  barcode: string | null;
  sku_key: string | null;
  barcode_key: string | null;
  name_brand_key: string | null;
  sku_match_count: number;
  barcode_match_count: number;
  name_brand_match_count: number;
  exact_conflict: boolean;
  review_required: boolean;
  identity_issue: string | null;
}

export interface CustomerIdentityReviewRow {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  name_key: string | null;
  email_key: string | null;
  phone_key: string | null;
  whatsapp_key: string | null;
  name_match_count: number;
  email_match_count: number;
  phone_match_count: number;
  whatsapp_match_count: number;
  exact_conflict: boolean;
  review_required: boolean;
  missing_contact: boolean;
  identity_issue: string | null;
}

export interface IdentityReviewSummary {
  total: number;
  reviewRows: number;
  exactConflictRows: number;
  softCandidateRows: number;
  missingPrimaryRows: number;
  identifiedRows: number;
  coveragePercent: number;
  examples: Array<{
    id: string;
    label: string;
    issue: string;
  }>;
}

const roundedPercent = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 100) : 0;

export function missingProductIdentityRows(rows: ProductIdentityReviewRow[]): ProductIdentityReviewRow[] {
  return rows.filter(row => !row.sku_key && !row.barcode_key);
}

export function missingCustomerIdentityRows(rows: CustomerIdentityReviewRow[]): CustomerIdentityReviewRow[] {
  return rows.filter(row => row.missing_contact || (!row.email_key && !row.phone_key && !row.whatsapp_key));
}

export function summarizeProductIdentity(rows: ProductIdentityReviewRow[]): IdentityReviewSummary {
  const exact = rows.filter(row => row.exact_conflict || row.sku_match_count > 1 || row.barcode_match_count > 1);
  const soft = rows.filter(row => !exact.includes(row) && row.name_brand_match_count > 1);
  const missing = missingProductIdentityRows(rows);
  const identified = rows.filter(row => !!row.sku_key || !!row.barcode_key);
  const review = [...exact, ...soft];

  return {
    total: rows.length,
    reviewRows: review.length,
    exactConflictRows: exact.length,
    softCandidateRows: soft.length,
    missingPrimaryRows: missing.length,
    identifiedRows: identified.length,
    coveragePercent: roundedPercent(identified.length, rows.length),
    examples: review.slice(0, 6).map(row => ({
      id: row.id,
      label: `${row.brand} · ${row.name}`,
      issue: row.identity_issue || (exact.includes(row) ? "Identificador compartido" : "Nombre y marca compartidos"),
    })),
  };
}

export function summarizeCustomerIdentity(rows: CustomerIdentityReviewRow[]): IdentityReviewSummary {
  const exact = rows.filter(row =>
    row.exact_conflict
    || row.email_match_count > 1
    || row.phone_match_count > 1
    || row.whatsapp_match_count > 1,
  );
  const soft = rows.filter(row => !exact.includes(row) && row.name_match_count > 1);
  const missing = missingCustomerIdentityRows(rows);
  const identified = rows.filter(row => !!row.email_key || !!row.phone_key || !!row.whatsapp_key);
  const review = [...exact, ...soft];

  return {
    total: rows.length,
    reviewRows: review.length,
    exactConflictRows: exact.length,
    softCandidateRows: soft.length,
    missingPrimaryRows: missing.length,
    identifiedRows: identified.length,
    coveragePercent: roundedPercent(identified.length, rows.length),
    examples: review.slice(0, 6).map(row => ({
      id: row.id,
      label: row.name,
      issue: row.identity_issue || (exact.includes(row) ? "Contacto compartido" : "Nombre compartido; revisar homonimia"),
    })),
  };
}
