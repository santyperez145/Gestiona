import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("puerta E2E de CI", () => {
  const config = read("playwright.config.ts");
  const workflow = read(".github/workflows/ci.yml");
  const authSetup = read("e2e/auth.setup.ts");
  const packageJson = read("package.json");

  it("levanta un puerto propio estricto y no reutiliza procesos por defecto", () => {
    expect(config).toContain('process.env.E2E_PORT ?? "4173"');
    expect(config).toContain("--strictPort");
    expect(config).toContain('process.env.E2E_REUSE_SERVER === "true"');
    expect(config).toContain("reuseExistingServer,");
    expect(config).not.toContain("reuseExistingServer: true");
  });

  it("CI instala Chromium y ejecuta tienda desktop, mobile y panel", () => {
    expect(workflow).toContain("npx playwright install --with-deps chromium");
    expect(workflow).toContain("npm run test:e2e:ci");
    expect(packageJson).toContain(
      'playwright test --project=chromium --project=mobile --project=panel',
    );
  });

  it("CI exige configuración real y nunca cae a placeholders", () => {
    for (const name of [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "E2E_STORE_SLUG",
      "E2E_USER",
      "E2E_PASSWORD",
    ]) {
      expect(workflow).toContain(name);
    }
    expect(workflow).toContain('E2E_REQUIRE_AUTH: "true"');
    expect(workflow).toContain("Validate E2E environment");
  });

  it("la autenticación ausente falla cuando el gate la declara obligatoria", () => {
    expect(authSetup).toContain('process.env.E2E_REQUIRE_AUTH === "true"');
    expect(authSetup).toContain("throw new Error");
  });
});
