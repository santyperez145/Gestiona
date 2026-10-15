import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fn = readFileSync(resolve(process.cwd(), "supabase/functions/check-alerts/index.ts"), "utf8");

describe("check-alerts no repite avisos", () => {
  it("un resumen por regla: el sin leer se actualiza y el leído en 24 h no se repite", () => {
    expect(fn).toContain(".or(`read.eq.false,created_at.gte.${cutoff24h}`)");
    expect(fn).toContain('.eq("entity_type", "ruta")');
    expect(fn).toContain("const previa = sinLeer.get(clave);");
    expect(fn).toContain("if (recientes.has(clave)) continue;");
  });

  it("no se traga un error al leer los avisos previos", () => {
    expect(fn).toContain("if (errPrevias) throw new Error(");
  });

  // 2026-10-15: una corrida dejó 51 avisos, uno por cliente o producto.
  it("no vuelve a crear un aviso por cliente o por producto", () => {
    expect(fn).not.toContain("Cliente inactivo: ${");
    expect(fn).not.toContain("Stock bajo: ${");
    expect(fn).not.toContain(".limit(20)");
  });
});

describe("customer-reactivation-alerts no repite el resumen sin leer", () => {
  const reac = readFileSync(resolve(process.cwd(), "supabase/functions/customer-reactivation-alerts/index.ts"), "utf8");
  it("mira los sin leer y los de hoy, por persona y tipo", () => {
    expect(reac).toContain(".or(`read.eq.false,created_at.gte.${todayStr}T00:00:00`)");
    expect(reac).toContain("notifications = notifications.filter(n => !yaAvisado.has(`${n.user_id}|${n.type}`));");
    expect(reac).toContain('.from("notifications").insert(notifications)');
  });
});
