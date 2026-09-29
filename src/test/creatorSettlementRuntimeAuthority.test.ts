import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260929000500_creator_settlement_runtime_authority.sql");
const drill = read("scripts/creator-settlement-matrix.sql");

describe("autoridad runtime de liquidaciones de creadores", () => {
  it("separa revisión humana de confirmación de dinero", () => {
    expect(migration).toContain("p_status NOT IN ('approved', 'rejected')");
    expect(migration).toContain("Aprobar o rechazar no confirma una transferencia");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.resolve_creator_withdrawal(uuid, text)\n  TO authenticated");
  });

  it("habilita el sincronizador firmado y conserva un actor contable", () => {
    expect(migration).toContain("v_is_service");
    expect(migration).toContain("TO authenticated, service_role");
    expect(migration).toContain("v_row.processed_by");
    expect(migration).toContain("organization.owner_user_id");
  });

  it("crea payout y gasto Finance en la misma transacción", () => {
    expect(migration).toContain("INSERT INTO public.influencer_payouts");
    expect(migration).toContain("INSERT INTO public.expenses");
    expect(migration).toContain("influencer_withdrawal:");
    expect(migration).toContain("WHERE NOT EXISTS");
  });

  it("tiene una certificación reversible del recorrido completo", () => {
    expect(drill).toContain("creator_payout_destination_save");
    expect(drill).toContain("creator_request_withdrawal");
    expect(drill).toContain("SET LOCAL ROLE service_role");
    expect(drill).toContain("public.ledger_entries");
    expect(drill).toContain("creator settlement matrix rollback");
  });
});
