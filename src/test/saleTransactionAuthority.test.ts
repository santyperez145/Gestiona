import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260815000004_sale_transactions_plan_limit.sql"),
  "utf8",
);
const store = readFileSync(resolve(ROOT, "src/lib/supabaseStore.ts"), "utf8");
const pos = readFileSync(resolve(ROOT, "src/pages/POSPage.tsx"), "utf8");
const salesPage = readFileSync(resolve(ROOT, "src/pages/SalesPage.tsx"), "utf8");
const planLimits = readFileSync(resolve(ROOT, "src/lib/usePlanLimits.ts"), "utf8");
const publicApi = readFileSync(resolve(ROOT, "supabase/functions/public-api/index.ts"), "utf8");
const publicApiAuthority = readFileSync(
  resolve(ROOT, "supabase/migrations/20260829000020_api_publica_tiene_contrato.sql"),
  "utf8",
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("transacciones de venta y cupo de plan", () => {
  it("define una unidad comercial separada de los renglones y cuenta en horario argentino", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.sale_transactions");
    expect(migration).toContain("sale_transaction_id uuid");
    expect(migration).toContain("America/Argentina/Buenos_Aires");
    expect(migration).toContain("max_sales_per_month");
    expect(migration).toContain("Límite de % ventas/mes alcanzado");
  });

  it("crea el ticket en la base, bloquea el insert directo y no permite reasignarlo", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.create_sales_transaction");
    expect(migration).toContain("DROP POLICY IF EXISTS \"Org members create sales\"");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.prevent_sale_transaction_reassignment");
    expect(migration).toContain("La transacción de una venta es inmutable");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.create_sales_transaction(uuid, jsonb, text) FROM PUBLIC, anon;");
  });

  it("no vuelve a evaluar el cupo por el segundo renglón de un mismo ticket", () => {
    expect(migration).toContain("pg_advisory_xact_lock(");
    expect(migration).toContain("sale-transaction:");
    expect(migration).toContain("IF NOT FOUND THEN\n    INSERT INTO public.sale_transactions");
    expect(migration).not.toContain("ON CONFLICT (id) DO NOTHING;");
  });

  it("el navegador usa el RPC y ninguna pantalla inserta filas de sales directamente", () => {
    expect(store).toContain("rpc('create_sales_transaction'");
    expect(store).not.toContain(".from('sales').insert");

    const writes = sourceFiles(resolve(ROOT, "src"))
      .filter((file) => !file.endsWith("saleTransactionAuthority.test.ts"))
      .filter((file) => /\.from\(["']sales["']\)\.insert/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(ROOT, ""));

    expect(writes, "las ventas nuevas sólo las inserta el RPC de la base").toEqual([]);
  });

  it("POS y Ventas agrupan el carrito, incluso cuando POS se sincroniza offline", () => {
    expect(pos).toContain('await addSalesDB(transactionLines, "pos")');
    expect(pos).toContain("offline_transaction_id");
    expect(pos).toContain("await addSalesDB(lines, 'pos')");
    expect(salesPage).toContain("await addSalesDB(newSales.map(({ sale }) => sale), 'manual')");
    expect(planLimits).toContain("rpc('get_sales_plan_usage'");
    expect(planLimits).not.toContain(".from('sales')");
  });

  it("la API de servidor conserva el tenant y el producto persistido antes de crear una venta", () => {
    expect(publicApi).toContain('eq("org_id", orgId)');
    expect(publicApi).toContain('rpc("api_v1_crear_venta"');
    expect(publicApiAuthority).toContain("v_owner, v_product.id, v_product.name");
    expect(publicApiAuthority).toContain("p_org_id");
    expect(publicApiAuthority).toContain("COALESCE(p_date, now()), 'api'");
    expect(publicApiAuthority).toContain("INSERT INTO public.sales");
    expect(publicApi).not.toContain("org_id: orgId,\n      ...body,");
  });
});
