import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const roadmap = readFileSync(resolve(root, "ROADMAP.md"), "utf8");
const backlog = readFileSync(
  resolve(root, "docs/auditorias/2026-08-24_backlog_ejecutable.md"),
  "utf8",
);

function ids(source: string, pattern: RegExp): string[] {
  return Array.from(source.matchAll(pattern), (match) => match[1]);
}

describe("roadmap canónico y backlog de auditoría", () => {
  it("mapea una sola vez los 41 hallazgos de auditoría", () => {
    const auditIds = ids(backlog, /^## (P[0-3]-\d{2})\b/gm);
    const mappedIds = ids(roadmap, /^\| (P[0-3]-\d{2}) \|/gm);

    expect(auditIds).toHaveLength(41);
    expect(new Set(auditIds).size).toBe(auditIds.length);
    expect(mappedIds).toHaveLength(41);
    expect(new Set(mappedIds).size).toBe(mappedIds.length);
    expect(mappedIds.sort()).toEqual(auditIds.sort());
  });

  it("mantiene una sola cola de producto y conserva la auditoría como evidencia", () => {
    expect(backlog).toContain("ya no es una segunda cola de producto");
    expect(backlog).toContain("# Secuencia original del 2026-08-24 — sustituida");
    expect(roadmap).toContain("### Matriz canónica del backlog de auditoría");
    expect(roadmap).toContain("## 7. Portfolio de slices y bitácora de ejecución");
    expect(roadmap).not.toContain("## 7. Los próximos 25 slices");
  });
});
