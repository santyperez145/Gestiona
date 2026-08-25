import type { CustomerIdentityReviewRow, ProductIdentityReviewRow } from "@/lib/recordIdentity";
import { csvCell } from "@/lib/csv";

export type IdentityReviewEntity = "products" | "customers";

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
