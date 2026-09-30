import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260930000100_wallet_withdrawal_authority.sql",
  "utf8",
);
const readScope = readFileSync(
  "supabase/migrations/20260930000110_wallet_finance_read_scope.sql",
  "utf8",
);
const page = readFileSync("src/pages/WalletPage.tsx", "utf8");
const drill = readFileSync("scripts/wallet-withdrawal-matrix.sql", "utf8");

describe("autoridad de retiros de la billetera comercial", () => {
  it("solicitar reserva saldo sin inventar una transferencia", () => {
    const requestBody = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.wallet_solicitar_retiro"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.wallet_confirmar_retiro"),
    );
    expect(requestBody).not.toContain("public.ledger_asentar(");
    expect(requestBody).toContain("'solicitado'");
    expect(requestBody).toContain("entry_id', NULL");
  });

  it("solo una confirmacion con referencia mueve el ledger", () => {
    expect(migration).toContain("char_length(v_reference) < 3");
    expect(migration).toContain("'Retiro confirmado a '");
    expect(migration).toContain("SET estado = 'pagado'");
    expect(migration).toContain("referencia = v_reference");
  });

  it("protege cuentas, confirmacion y cancelacion con permisos Finance", () => {
    expect(migration.match(/exigir_permiso\([^;]*'finance'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("REVOKE ALL ON TABLE public.wallet_bank_accounts");
  });

  it("protege retiros y vistas contables con finance.view", () => {
    expect(readScope).toContain("wallet_withdrawals_read");
    expect(readScope.match(/has_permission\([^;]*'finance', 'view'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(readScope.match(/security_invoker = true/g)?.length).toBe(2);
  });

  it("la UI usa las autoridades y explica la transferencia externa", () => {
    expect(page).toContain("saveWalletBankAccount");
    expect(page).toContain("confirmWalletWithdrawal");
    expect(page).toContain("rejectWalletWithdrawal");
    expect(page).not.toContain('.from("wallet_bank_accounts").insert');
    expect(page).toContain("Nerqia no mueve el dinero");
  });

  it("certifica reserva, pago, cancelacion e idempotencia sin dejar datos", () => {
    expect(drill).toContain("public.wallet_solicitar_retiro");
    expect(drill).toContain("public.wallet_confirmar_retiro");
    expect(drill).toContain("public.wallet_rechazar_retiro");
    expect(drill).toContain("wallet matrix rollback");
  });
});
