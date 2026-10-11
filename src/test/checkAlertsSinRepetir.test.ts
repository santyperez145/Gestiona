import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fn = readFileSync(resolve(process.cwd(), "supabase/functions/check-alerts/index.ts"), "utf8");

describe("check-alerts no repite avisos", () => {
  it("no crea un aviso igual a uno sin leer ni a uno de las últimas 24 h", () => {
    expect(fn).toContain(".or(`read.eq.false,created_at.gte.${cutoff24h}`)");
  });

  it("reconoce el mismo aviso por título (el mensaje cambia a diario)", () => {
    expect(fn).toContain("if (recentMessages.has(`${adminId}|${alert.title}`)) continue;");
    expect(fn).not.toContain("recentMessages.has(`${adminId}|${alert.message}`)");
  });

  it("consulta en tandas y no se traga un error", () => {
    expect(fn).toContain(".in(\"title\", titulos.slice(i, i + 50))");
    expect(fn).toContain("if (errPrevias) throw new Error(");
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
