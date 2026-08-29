import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/organizationSnapshot.ts"),
  "utf8",
);

describe("contrato portátil de snapshots", () => {
  it("excluye el SMTP privado completo en vez de exportar una credencial", () => {
    expect(source).toContain('"merchant_smtp_connections"');
    expect(source).not.toMatch(/SECRET_SETTINGS_COLUMNS[\s\S]{0,300}"smtp_pass"/);

    const restoreDrill = readFileSync(resolve(process.cwd(), "scripts/restore-drill.mjs"), "utf8");
    expect(restoreDrill).toContain('"merchant_smtp_connections"');
  });

  it("lleva las relaciones hijas operativas por el FK de su padre, nunca por una consulta global", () => {
    expect(source).toContain('bundle_items: { parentTable: "product_bundles", foreignKey: "bundle_id" }');
    expect(source).toContain('price_list_items: { parentTable: "price_lists", foreignKey: "price_list_id" }');
    expect(source).toContain('purchase_request_items: { parentTable: "purchase_requests", foreignKey: "request_id" }');
    expect(source).toContain('customer_segment_members: { parentTable: "customer_segments", foreignKey: "segment_id" }');
    expect(source).toContain('store_order_status_email_log: { parentTable: "ecommerce_orders", foreignKey: "ecommerce_order_id" }');
    expect(source).toContain('delivery_events: { parentTable: "deliveries", foreignKey: "delivery_id" }');
    expect(source).toContain('drip_send_log: { parentTable: "drip_enrollments", foreignKey: "enrollment_id" }');
    expect(source).toContain('invoice_items: { parentTable: "invoices", foreignKey: "invoice_id" }');
    expect(source).toContain('.in(scope.foreignKey, parentChunk)');
  });

  it("no marca completo un hijo si su padre quedó incompleto y conserva el límite explícito", () => {
    expect(source).toContain('if (parent.status === "error" || parent.status === "truncated")');
    expect(source).toContain('RELATED_PARENT_ID_CHUNK = 200');
    expect(source).toContain('if (availableRowCount > MAX_ROWS_PER_TABLE)');
  });

  it("versiona el contrato sin invalidar los snapshots v1 ni v2 ya verificados", () => {
    expect(source).toContain('export const SNAPSHOT_SCHEMA_VERSION = 3');
    expect(source).toContain('snapshot.schema_version === 1');
    expect(source).toContain('snapshot.schema_version === 2');
    expect(source).toContain('? SNAPSHOT_TABLES_V1');
    expect(source).toContain('? SNAPSHOT_TABLES_V2');
    expect(source).toContain('? SNAPSHOT_TABLES');
    const weeklyBackup = readFileSync(resolve(process.cwd(), "supabase/functions/weekly-backup/index.ts"), "utf8");
    expect(weeklyBackup).toContain("SNAPSHOT_SCHEMA_VERSION,");
    expect(weeklyBackup).toContain("hasCurrentVerifiedSnapshot");
    expect(weeklyBackup).toContain("snapshot_schema_version === SNAPSHOT_SCHEMA_VERSION");
  });
});
