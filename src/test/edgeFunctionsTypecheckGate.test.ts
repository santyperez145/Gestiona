import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const functionsDir = resolve(ROOT, "supabase/functions");
const checker = readFileSync(resolve(ROOT, "scripts/check-edge-functions.mjs"), "utf8");
const workflow = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

describe("guardia de tipos de Edge Functions", () => {
  it("descubre cada entrypoint sin mantener una allowlist", () => {
    const count = readdirSync(functionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .filter((entry) => existsSync(resolve(functionsDir, entry.name, "index.ts")))
      .length;

    expect(count).toBe(63);
    expect(checker).toContain('readdirSync(functionsDir, { withFileTypes: true })');
    expect(checker).toContain('"check", "--no-lock", ...entries');
    expect(checker).not.toContain("mercadopago-webhook/index.ts");
  });

  it("lo convierte en una puerta bloqueante del CI", () => {
    expect(packageJson.scripts?.["check:functions"]).toBe("node scripts/check-edge-functions.mjs");
    expect(workflow).toContain("denoland/setup-deno@v2");
    expect(workflow).toContain("Type check Edge Functions");
    expect(workflow).toContain("npm run check:functions");
  });
});
