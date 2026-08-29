import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
const appLayout = readFileSync(resolve(root, "src/components/AppLayout.tsx"), "utf8");

function version(paquete: string): string {
  return lock.packages?.[`node_modules/${paquete}`]?.version ?? "0.0.0";
}

function numerica(valor: string): number[] {
  return valor.split(/[.-]/).slice(0, 3).map((parte: string) => Number(parte) || 0);
}

function alMenos(actual: string, minimo: string): boolean {
  const a = numerica(actual);
  const b = numerica(minimo);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

describe("dependencias sin alertas productivas conocidas", () => {
  it.each([
    ["react-router", "7.18.0"],
    ["react-router-dom", "7.18.0"],
    ["dompurify", "3.4.13"],
    ["nanoid", "3.3.18"],
    ["vite", "8.2.2"],
    ["esbuild", "0.28.0"],
    ["@vitejs/plugin-react", "6.1.1"],
    ["vite-plugin-pwa", "1.3.0"],
  ])("%s queda en una línea parcheada", (paquete, minimo) => {
    expect(
      alMenos(version(paquete), minimo),
      `${paquete}@${version(paquete)} debe ser >= ${minimo}`,
    ).toBe(true);
  });

  it("el audit moderado es un comando reproducible y el CI conserva la foto completa", () => {
    expect(pkg.scripts["check:dependencies"]).toBe("npm audit --audit-level=moderate");
    expect(ci).toContain("run: npm audit");
  });

  it("la versión mínima de Node coincide con Vite 8", () => {
    expect(pkg.engines.node).toBe(">=20.19.0");
  });

  it("la paleta global tiene un solo dueño y no duplica listeners ni bundle", () => {
    expect(app).not.toContain('import("@/components/shared/CommandPalette")');
    expect(app).not.toContain("<CommandPalette />");
    expect(appLayout).toContain('lazy(() => import("@/components/shared/CommandPalette"))');
    expect(appLayout.match(/<CommandPalette \/>/g)).toHaveLength(1);
  });
});
