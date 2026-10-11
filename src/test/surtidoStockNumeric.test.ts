import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("editor de surtido con stock fraccionado", () => {
  it("get_store_assortment devuelve stock numeric, como products.stock desde 20261009000800", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011002500_surtido_stock_numeric.sql"), "utf8");
    expect(sql).toContain(" stock numeric,");
    expect(sql).not.toContain(" stock integer,");
    expect(sql).toContain("TO authenticated;");
  });
});
