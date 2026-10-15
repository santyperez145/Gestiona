import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 2026-10-15: 27 consultas tomaban sólo `data` y descartaban el error: si
// fallaban, la pantalla mostraba «sin datos» y nadie se enteraba. Ahora el
// error queda en el registro de la app; ésta impide que vuelva el patrón.
function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "test" ? [] : archivos(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("sin consultas que se tragan el error", () => {
  it("ninguna toma sólo { data } en un .then", () => {
    const patron = /\.then\(\s*\(\s*\{\s*data\s*\}\s*\)\s*=>/;
    const mudas = archivos("src").filter(f => patron.test(fs.readFileSync(f, "utf8")));
    expect(mudas).toEqual([]);
  });
});
