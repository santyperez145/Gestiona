import type { CustomerIdentityReviewRow, ProductIdentityReviewRow } from "@/lib/recordIdentity";

export type IdentityReviewEntity = "products" | "customers";

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  // Excel and Sheets interpret values beginning with these characters as
  // formulas. An internal export must remain data when someone opens it.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildIdentityReviewCsv(
  entity: IdentityReviewEntity,
  rows: Array<ProductIdentityReviewRow | CustomerIdentityReviewRow>,
): string {
  const header = entity === "products"
    ? ["id", "nombre", "marca", "sku", "ean", "estado", "problema"]
    : ["id", "nombre", "email", "telefono", "whatsapp", "estado", "problema"];

  const lines = rows.map(row => {
    if (entity === "products") {
      const product = row as ProductIdentityReviewRow;
      const status = product.review_required
        ? "revisar"
        : product.sku_key || product.barcode_key
          ? "cubierta"
          : "incompleta";
      return [product.id, product.name, product.brand, product.sku, product.barcode, status, product.identity_issue];
    }

    const customer = row as CustomerIdentityReviewRow;
    const status = customer.review_required
      ? "revisar"
      : customer.email_key || customer.phone_key || customer.whatsapp_key
        ? "cubierta"
        : "incompleta";
    return [customer.id, customer.name, customer.email, customer.phone, customer.whatsapp_number, status, customer.identity_issue];
  });

  return [header, ...lines].map(line => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function identityReviewFilename(entity: IdentityReviewEntity, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `gestiona-identidad-${entity}-${day}.csv`;
}
