import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Ninguna escritura del front (insert/update/delete/upsert) puede ignorar lo
// que contesta la base: si RLS o un trigger la rechaza, la pantalla decía
// «cobrada», «guardada» o «eliminada» y no lo estaba. Eran 92 al 2026-10-11 y
// se cerraron por áreas (plata, stock, clientes, precios, el resto). Mismo
// criterio que `scripts/escrituras-sin-error.mjs`, sobre todo `src/`.
function archivos(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!/node_modules|[\\/]test$|integrations/.test(p)) archivos(p, out);
    } else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

function escriturasSueltas(fuente: string): number[] {
  const lineas = fuente.split("\n");
  const sueltas: number[] = [];
  lineas.forEach((l, i) => {
    // Un `await x.rpc(...)` suelto tampoco mira el error (se escapó del
    // primer barrido: 27 al 2026-10-14).
    if (/^\s*await\s+\w+\.rpc\(/.test(l)) { sueltas.push(i + 1); return; }
    if (!/^\s*await\s+\(?\s*supabase\b/.test(l)) return;
    const tramo = lineas.slice(i, i + 6).join(" ").split(";")[0];
    if (/\.(insert|update|delete|upsert)\s*\(/.test(tramo)) sueltas.push(i + 1);
  });
  return sueltas;
}

describe("las escrituras a la base miran el error", () => {
  it("el detector encuentra una escritura suelta y deja pasar la que asigna", () => {
    expect(escriturasSueltas(`  await supabase.from("x").update({ a: 1 }).eq("id", id);`)).toEqual([1]);
    expect(escriturasSueltas(`  const { error } = await supabase.from("x").update({ a: 1 });`)).toEqual([]);
    expect(escriturasSueltas(`  await supabase.rpc("sync_segment_members", { p: 1 });`)).toEqual([1]);
  });

  it("no queda ninguna escritura suelta en src/", () => {
    const sueltas = archivos("src").flatMap(f =>
      escriturasSueltas(fs.readFileSync(f, "utf8")).map(n => `${f.split(path.sep).join("/")}:${n}`),
    );
    expect(sueltas).toEqual([]);
  });

  it("el pago de una deuda falla si no se pudo guardar el comprobante", () => {
    const s = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");
    expect(s).toContain("if (ledgerError) throw ledgerError;");
  });

  it("las metas mensuales se guardan en la configuración del negocio, no del creador", () => {
    const s = fs.readFileSync("src/pages/ReportsPage.tsx", "utf8");
    const guardar = s.slice(s.indexOf("monthly_targets: {"), s.indexOf('toast.success("Metas guardadas")'));
    expect(guardar).toContain('.eq("org_id", activeOrg.id)');
    expect(guardar).not.toContain('.eq("user_id"');
  });
});
