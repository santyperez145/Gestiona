import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ciclo de contraseña del comprador", () => {
  it("usa una sola política en alta, checkout y recuperación", () => {
    const account = source("src/storefront/StoreAccount.tsx");
    const checkout = source("src/storefront/StoreCheckout.tsx");
    const auth = source("src/storefront/storeAuth.tsx");
    const recovery = source("src/storefront/StorePasswordRecovery.tsx");

    expect(account).toContain("MIN_PASSWORD_LENGTH");
    expect(account).toContain("passwordValidationMessage");
    expect(checkout).toContain("MIN_PASSWORD_LENGTH");
    expect(auth).toContain("passwordValidationMessage(password)");
    expect(recovery).toContain("passwordValidationMessage(password)");
    expect([account, checkout, auth, recovery].join("\n")).not.toMatch(/mínimo 6 caracteres|al menos 8 caracteres/);
  });

  it("el email vuelve a una ruta de recuperación real y exige sesión recovery", () => {
    const auth = source("src/storefront/storeAuth.tsx");
    const routes = source("src/pages/StorefrontPage.tsx");
    const recovery = source("src/storefront/StorePasswordRecovery.tsx");

    expect(auth).toContain('event === "PASSWORD_RECOVERY"');
    expect(auth).toContain('storeAccountRedirect(slug, basePath, "recuperar-clave")');
    expect(auth).toContain('supabase.auth.updateUser({ password })');
    expect(auth).toContain('supabase.auth.signOut({ scope: "others" })');
    expect(routes).toContain('<Route path="recuperar-clave" element={<StorePasswordRecovery />} />');
    expect(recovery).toContain("Boolean(session && passwordRecovery)");
    expect(recovery).not.toMatch(/Supabase|platform|superadmin/i);
  });
});
