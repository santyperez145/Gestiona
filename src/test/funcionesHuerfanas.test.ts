import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("funciones huérfanas borradas", () => {
  it("las tres funciones sin tabla se borran y nadie las llama", async () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011002600_funciones_huerfanas.sql"), "utf8");
    for (const f of ["get_customer_journey(uuid, uuid)", "get_customer_sentiment(uuid, integer)", "get_revenue_waterfall(uuid, integer)"]) {
      expect(sql).toContain(`DROP FUNCTION IF EXISTS public.${f};`);
    }
    const { execSync } = await import("node:child_process");
    let usos = "";
    try {
      usos = execSync('git grep -l -e get_customer_journey -e get_customer_sentiment -e get_revenue_waterfall -- src supabase/functions ":!src/integrations" ":!src/test"', { encoding: "utf8" }).trim();
    } catch { usos = ""; }
    expect(usos).toBe("");
  });

  it("el revalidador de funciones SQL queda en el repo", () => {
    const script = readFileSync(resolve(process.cwd(), "scripts/funciones-sql-revalidar.mjs"), "utf8");
    expect(script).toContain("await c.query('ROLLBACK');");
  });
});
