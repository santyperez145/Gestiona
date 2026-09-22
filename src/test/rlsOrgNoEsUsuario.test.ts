import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Una organización no es un usuario. `org_id = auth.uid()` deja la tabla
 * inaccesible para todos los miembros reales (o, si alguien crea una org con
 * el id de un usuario, se la entrega). La pertenencia se decide con
 * `is_org_member(org_id, auth.uid())` o con memberships.
 */
describe("RLS: la organización no es el usuario", () => {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const migrations = readdirSync(dir).filter(file => file.endsWith(".sql"));

  it("ninguna migración compara org_id contra auth.uid()", () => {
    const offenders = migrations.filter(file =>
      /\borg_id\s*=\s*auth\.uid\(\)/i.test(readFileSync(resolve(dir, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("la conciliación bancaria usa bank_transactions con membresía real", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/BankReconciliationPage.tsx"), "utf8");
    expect(page).toContain('from("bank_transactions")');
    expect(page).not.toMatch(/from\(["']bank_(accounts|statements|matches|reconciliation)["']\)/);
    expect(page).not.toContain('org_id: ""');
  });
});
