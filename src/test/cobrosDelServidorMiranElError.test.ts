import { describe, it, expect } from "vitest";
import fs from "node:fs";

// Mismo criterio que `escriturasMiranElError.test.ts`, en las funciones de
// servidor que tocan cobros de Mercado Pago y las acciones de plataforma. El cliente se llama `admin`,
// `supabase` o similar, así que se mira cualquier `await x.from(`.
const ARCHIVOS = [
  "supabase/functions/mercadopago-webhook/index.ts",
  "supabase/functions/store-pay/index.ts",
  "supabase/functions/mercadopago-pos-qr/index.ts",
  "supabase/functions/_shared/mpToken.ts",
  "supabase/functions/mp-payouts/index.ts",
  "supabase/functions/_shared/mpPayoutsSync.ts",
  "supabase/functions/mp-connect/index.ts",
  "supabase/functions/mercadopago-payment-methods/index.ts",
  "supabase/functions/platform-admin-action/index.ts",
  "supabase/functions/weekly-backup/index.ts",
];

function escriturasSueltas(fuente: string): number[] {
  const lineas = fuente.split("\n");
  const sueltas: number[] = [];
  lineas.forEach((l, i) => {
    if (!/^\s*await\s+\(?\s*\w+\s*(\.from\(|$)/.test(l)) return;
    const tramo = lineas.slice(i, i + 6).join(" ").split(";")[0];
    if (/\.from\(/.test(tramo) && /\.(insert|update|delete|upsert)\s*\(/.test(tramo)) sueltas.push(i + 1);
  });
  return sueltas;
}

describe("cobros del servidor: las escrituras miran el error", () => {
  it("el detector ve la escritura partida en varias líneas", () => {
    expect(escriturasSueltas(`await admin\n  .from("x")\n  .update({ a: 1 })\n  .eq("id", id);`)).toEqual([1]);
  });

  for (const archivo of ARCHIVOS) {
    it(`${archivo} no tiene escrituras sin mirar el error`, () => {
      expect(escriturasSueltas(fs.readFileSync(archivo, "utf8"))).toEqual([]);
    });
  }

  it("el webhook pide reintento si no pudo anotar un link o una venta pagados", () => {
    const s = fs.readFileSync("supabase/functions/mercadopago-webhook/index.ts", "utf8");
    expect(s).toContain("throw new ReintentarWebhook(`payment_links:");
    expect(s).toContain("throw new ReintentarWebhook(`sales:");
    const captura = s.slice(s.indexOf("if (e instanceof ReintentarWebhook)"));
    expect(captura.slice(0, 200)).toContain("status: 500");
  });

  it("una conciliación de pagos a creadores a medias pide reintento", () => {
    const sync = fs.readFileSync("supabase/functions/_shared/mpPayoutsSync.ts", "utf8");
    expect(sync).toContain("ok: sinAnotar === 0");
    const s = fs.readFileSync("supabase/functions/mercadopago-webhook/index.ts", "utf8");
    expect(s).toMatch(/resultado\.sinAnotar > 0\) \{\s*throw new ReintentarWebhook/);
  });

  it("desconectar MP no dice «listo» si los tokens siguen guardados", () => {
    const s = fs.readFileSync("supabase/functions/mp-connect/index.ts", "utf8");
    expect(s).toContain("throw new Error(`No se pudo desconectar Mercado Pago:");
    expect(s).toContain("throw new Error(`No se pudo validar la conexión:");
  });

  it("borrar una organización es un solo DELETE: entero o nada, y no borra la auditoría", () => {
    const s = fs.readFileSync("supabase/functions/platform-admin-action/index.ts", "utf8");
    const bloque = s.slice(s.indexOf('if (action === "deleteOrg")'), s.indexOf('if (action === "toggleBanUser")'));
    expect(bloque).not.toMatch(/for \(const table of/);
    expect(bloque).not.toContain('"audit_logs"');
    expect(bloque).toContain("No se borró nada");
  });

  it("bloquear un usuario o quitar un admin de plataforma no dice «listo» si falló", () => {
    const s = fs.readFileSync("supabase/functions/platform-admin-action/index.ts", "utf8");
    expect(s).toContain("if (banError) return json(");
    expect(s).toContain("if (bajaError) return json(");
  });

  it("sólo actualiza ventas cuando la referencia es un id, para no reintentar para siempre", () => {
    const s = fs.readFileSync("supabase/functions/mercadopago-webhook/index.ts", "utf8");
    const antes = s.slice(0, s.indexOf('.from("sales")'));
    expect(antes.slice(-600)).toMatch(/isApproved && \/\^\[0-9a-f\]\{8\}/);
  });
});
