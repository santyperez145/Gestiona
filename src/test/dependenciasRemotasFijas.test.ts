import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 2026-10-15: 13 funciones importaban `esm.sh/@supabase/supabase-js@2`. Cuando
// esm.sh empezó a servir una 2.x nueva, la revisión de tipos del CI se rompió
// sin que cambiara nuestro código. Toda dependencia remota va con versión exacta.
function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("dependencias remotas con versión exacta", () => {
  it("ninguna importación de esm.sh queda en una versión flotante", () => {
    const flotantes: string[] = [];
    for (const f of archivos("supabase/functions")) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/https:\/\/esm\.sh\/((?:@[^/]+\/)?[^@/"']+)@([^/"'?]+)/g)) {
        if (!/^\d+\.\d+\.\d+$/.test(m[2])) flotantes.push(`${f}: ${m[1]}@${m[2]}`);
      }
    }
    expect(flotantes).toEqual([]);
  });
});
