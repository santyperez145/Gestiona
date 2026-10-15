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
  it("ninguna lectura con await descarta el error", () => {
    const patron = /const \{ data(?:\s*:\s*\w+)? \} = await (?:supabase|sb|client)\b/;
    const mudas = archivos("src").filter(f => patron.test(fs.readFileSync(f, "utf8")));
    expect(mudas).toEqual([]);
  });

  // 2026-10-15: `supabase.from(...).update(...)` suelto, sin await ni .then,
  // no se envía nunca (el contador de prompts del asistente no subía).
  it("ninguna consulta queda suelta sin enviarse", () => {
    const sueltas: string[] = [];
    for (const f of archivos("src")) {
      const s = fs.readFileSync(f, "utf8");
      const re = /^[ \t]*(?:supabase|sb)\s*\.(?:from|rpc)\(/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const antes = s.slice(0, m.index).trimEnd();
        if (!antes || !";{}".includes(antes[antes.length - 1])) continue;
        let k = m.index, d = 0;
        while (k < s.length) {
          const c = s[k];
          if ("([{".includes(c)) d++;
          else if (")]}".includes(c)) { d--; if (d < 0) break; }
          else if (c === ";" && d === 0) break;
          k++;
        }
        const sentencia = s.slice(m.index, k);
        if (!/\.then\(|\.catch\(/.test(sentencia)) sueltas.push(`${f}: ${sentencia.trim().slice(0, 80)}`);
      }
    }
    expect(sueltas).toEqual([]);
  });
});
