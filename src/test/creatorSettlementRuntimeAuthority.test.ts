import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260929000500_creator_settlement_runtime_authority.sql");
const reversal = read("supabase/migrations/20260929001040_creator_payout_reversals.sql");
const drill = read("scripts/creator-settlement-matrix.sql");
const paymentsPage = read("src/pages/InfluencerPaymentsPage.tsx");
const creatorPortal = read("src/pages/CreatorPortalPage.tsx");

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

  it("revierte sin borrar el pago y compensa payout, gasto y ledger", () => {
    expect(reversal).toContain("CREATE TABLE IF NOT EXISTS public.influencer_payout_reversals");
    expect(reversal).toContain("'reversal:withdrawal:' || v_row.id::text");
    expect(reversal).toContain("-v_row.amount_ars");
    expect(reversal).toContain("public.ledger_contraasentar");
    expect(reversal).toContain("IF v_row.status = 'reversed'");
    expect(drill).toContain("'reversa_a_finance'");
    expect(drill).toContain("el payout neto no volvió a cero");
  });

  it("expone la reversa a marca y creador con copy humano", () => {
    expect(paymentsPage).toContain("reverseWithdrawalRequest");
    expect(paymentsPage).toContain("Registrar reversa");
    expect(paymentsPage).toContain("Confirmar reversa");
    expect(creatorPortal).toContain('w.status === "reversed" ? "Revertido"');
    expect(creatorPortal).toContain("w.reversal_reference");
  });
});
