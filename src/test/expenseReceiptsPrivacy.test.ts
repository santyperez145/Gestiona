import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPENSE_RECEIPT_MAX_BYTES,
  buildExpenseReceiptPath,
  expenseReceiptPath,
  validateExpenseReceipt,
} from "@/lib/expenseReceipts";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260828000170_los_comprobantes_no_son_publicos.sql"),
  "utf8",
);
const expenses = readFileSync(resolve(root, "src/pages/ExpensesPage.tsx"), "utf8");
const scanner = readFileSync(resolve(root, "src/components/shared/ReceiptScanner.tsx"), "utf8");

describe("comprobantes de gastos privados", () => {
  it("el bucket queda privado y las tres operaciones dependen del permiso del tenant", () => {
    expect(migration).toMatch(/'expense-receipts',[\s\S]{0,80}false/);
    expect(migration).toContain("DROP POLICY IF EXISTS \"Public read access to receipts\"");
    expect(migration.match(/public\.has_permission\(/g)).toHaveLength(5);
    expect(migration).not.toMatch(/FOR SELECT TO public/);
  });

  it("la UI no vuelve a usar un bucket público ni getPublicUrl", () => {
    expect(expenses).not.toContain("from('product-images').upload");
    expect(expenses).not.toContain("getPublicUrl");
    expect(scanner).not.toContain("getPublicUrl");
    expect(scanner).not.toContain('.from("expense-receipts")');
  });

  it("valida tipo, vacío y límite antes de subir", () => {
    expect(validateExpenseReceipt({ type: "application/pdf", size: 500 })).toBeNull();
    expect(validateExpenseReceipt({ type: "text/html", size: 500 })).toMatch(/debe ser/);
    expect(validateExpenseReceipt({ type: "image/jpeg", size: 0 })).toMatch(/vacío/);
    expect(validateExpenseReceipt({ type: "image/png", size: EXPENSE_RECEIPT_MAX_BYTES + 1 }))
      .toMatch(/10 MB/);
  });

  it("genera y reconoce sólo paths org/usuario/uuid seguros", () => {
    const org = "42abf3d2-6650-407a-a5d2-9781c4ab6778";
    const user = "7be05068-7f07-45c8-b8c6-88956895f04e";
    const path = buildExpenseReceiptPath(org, user, "image/jpeg");
    expect(path).toMatch(new RegExp(`^${org}/${user}/[0-9a-f-]+\\.jpg$`, "i"));
    expect(expenseReceiptPath(path)).toBe(path);
    expect(expenseReceiptPath("../otro-tenant/recibo.pdf")).toBeNull();
    expect(expenseReceiptPath("https://example.com/documento.pdf")).toBeNull();
  });

  it("migra referencias públicas antiguas del mismo bucket a path privado", () => {
    const path = "42abf3d2-6650-407a-a5d2-9781c4ab6778/7be05068-7f07-45c8-b8c6-88956895f04e/00000000-0000-4000-8000-000000000001.pdf";
    const url = `https://proyecto.supabase.co/storage/v1/object/public/expense-receipts/${path}`;
    expect(expenseReceiptPath(url)).toBe(path);
  });
});
