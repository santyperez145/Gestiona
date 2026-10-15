import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 2026-10-14: 13 acciones de pantalla llamaban a la base (`await …DB(`) sin
// atrapar el error: si la base rechazaba, el error se perdía y a veces igual
// decía «Stock actualizado» o «Gasto eliminado». Una acción nueva así no pasa.
function acciones(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) acciones(p, out);
    else if (p.endsWith(".tsx")) {
      const s = fs.readFileSync(p, "utf8");
      const re = /const (\w+) = async \([^)]*\) => \{([\s\S]*?)\n {2}\};/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const cuerpo = m[2];
        if (/await \w+DB\(/.test(cuerpo) && !/try\s*\{/.test(cuerpo) && !/\.catch\(/.test(cuerpo)) {
          out.push(`${p.split(path.sep).join("/")}: ${m[1]}`);
        }
      }
    }
  }
  return out;
}

describe("las acciones de pantalla miran el error de la base", () => {
  it("ninguna llama a …DB sin try/catch", () => {
    expect(acciones("src")).toEqual([]);
  });
});
