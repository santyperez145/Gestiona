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
