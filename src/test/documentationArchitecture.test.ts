// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("documentación accesible", () => {
  it("conserva los documentos de entrada", () => {
    for (const path of ["README.md", "CONTRIBUTING.md", "ROADMAP.md", "DESIGNROADMAP.md", "docs/INDICE.md"]) {
      expect(existsSync(resolve(root, path)), `falta ${path}`).toBe(true);
    }
  });

  it("permite encontrar cada documento activo desde el índice", () => {
    const index = readFileSync(resolve(root, "docs/INDICE.md"), "utf8");
    for (const name of readdirSync(resolve(root, "docs"))) {
      if (name.endsWith(".md") && name !== "INDICE.md") {
        expect(index, `${name} no está enlazado`).toContain(`(${name})`);
      }
    }
  });
});
