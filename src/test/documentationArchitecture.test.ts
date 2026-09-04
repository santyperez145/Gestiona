import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const lines = (path: string) => read(path).split(/\r?\n/).length;

const removedDocuments = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/COMPARACION.md",
  "docs/CAPACIDADES.md",
  "docs/INNOVATION_ORBIT_PLAYBOOKS.md",
  "docs/FINANCE_MENDEL_BLUEPRINT.md",
  "docs/FINANCE_DOCUMENT_DRAFTS.md",
  "docs/FINANCE_DOCUMENT_EXTRACTION.md",
  "docs/FINANCE_DOCUMENT_INSPECTION.md",
  "docs/FINANCE_DOCUMENT_MATCHING.md",
  "docs/PRICE_IMPACT_LOOP.md",
  "docs/infra.md",
];

function textFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    const repoPath = relative(root, absolute).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      if ([".git", ".claude", "dist", "node_modules"].includes(entry.name)) return [];
      return textFiles(absolute);
    }

    return [".md", ".mjs", ".ts", ".tsx", ".json", ".yml", ".yaml"]
      .includes(extname(entry.name))
      ? [repoPath]
      : [];
  });
}

describe("arquitectura documental", () => {
  it("mantiene un conjunto rector neutral y elimina documentos paralelos", () => {
    for (const path of [
      "README.md",
      "CONTRIBUTING.md",
      "ROADMAP.md",
      "DESIGNROADMAP.md",
      "docs/INDICE.md",
      "docs/ARQUITECTURA.md",
      "docs/ESTRATEGIA.md",
      "docs/FINANCE.md",
    ]) {
      expect(existsSync(resolve(root, path)), `falta ${path}`).toBe(true);
    }

    for (const path of removedDocuments) {
      expect(existsSync(resolve(root, path)), `${path} volvió a ser una autoridad paralela`)
        .toBe(false);
    }
  });

  it("lista cada documento activo de docs en el índice", () => {
    const index = read("docs/INDICE.md");
    const activeDocs = readdirSync(resolve(root, "docs"))
      .filter((name) => name.endsWith(".md") && name !== "INDICE.md");

    for (const name of activeDocs) {
      expect(index, `docs/${name} no está clasificado en docs/INDICE.md`)
        .toContain(`(${name})`);
    }
  });

  it("evita que los documentos rectores vuelvan a ser bitácoras enormes", () => {
    const budgets: Record<string, number> = {
      "README.md": 220,
      "CONTRIBUTING.md": 380,
      "ROADMAP.md": 380,
      "DESIGNROADMAP.md": 260,
      "docs/ARQUITECTURA.md": 300,
      "docs/ESTRATEGIA.md": 300,
      "docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md": 350,
      "docs/FINANCE.md": 260,
      "docs/GUIA.md": 180,
      "docs/INTERFAZ.md": 180,
    };

    for (const [path, maximum] of Object.entries(budgets)) {
      expect(lines(path), `${path} superó su presupuesto de ${maximum} líneas`)
        .toBeLessThanOrEqual(maximum);
    }

    for (const entry of readdirSync(resolve(root, "docs"), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const path = `docs/${entry.name}`;
      expect(lines(path), `${path} necesita consolidación`).toBeLessThanOrEqual(400);
    }
  });

  it("no conserva rastros de herramientas usadas para generar código", () => {
    const forbidden = /CLAUDE\.md|AGENTS\.md|Lovable|lovable-|\.lovable\//i;
    const offenders = textFiles(root)
      .filter((path) => path !== "src/test/documentationArchitecture.test.ts")
      .filter((path) => forbidden.test(read(path)))
      .filter((path) => statSync(resolve(root, path)).isFile());

    expect(offenders).toEqual([]);
  });
});
