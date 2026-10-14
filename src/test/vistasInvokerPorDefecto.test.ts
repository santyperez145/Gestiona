import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ADR 006, acción 2: toda vista nueva en `public` queda security_invoker si no
// declara lo contrario (espejo de `ensure_rls`). Probado en vivo con
// `scripts/vistas-invoker-por-defecto-matrix.sql` (2026-10-13).
const sql = fs.readFileSync("supabase/migrations/20261013000800_vistas_invoker_por_defecto.sql", "utf8");

describe("vistas invoker por defecto", () => {
  it("el event trigger corre en CREATE VIEW y sólo toca public", () => {
    expect(sql).toMatch(/CREATE EVENT TRIGGER vistas_invoker_por_defecto\s+ON ddl_command_end\s+WHEN TAG IN \('CREATE VIEW'\)/);
    expect(sql).toContain("schema_name = 'public'");
  });

  it("respeta una opción explícita y si falla el ALTER falla la creación (no hay EXCEPTION que lo trague)", () => {
    expect(sql).toContain("o LIKE 'security_invoker=%'");
    const cuerpo = sql.slice(sql.indexOf("AS $$"), sql.indexOf("$$;"));
    expect(cuerpo).not.toMatch(/EXCEPTION/);
  });

  it("toda migración posterior que cree una vista que corre como dueño lo dice y justifica", () => {
    const posteriores = fs.readdirSync("supabase/migrations").filter(f => f > "20261013000800");
    for (const f of posteriores) {
      const m = fs.readFileSync(`supabase/migrations/${f}`, "utf8");
      if (/security_invoker\s*=\s*false/i.test(m)) expect(m, f).toMatch(/@(publica|revisada):/);
    }
  });

  it("el ADR registra la acción como hecha", () => {
    expect(fs.readFileSync("docs/ADR_006_FRONTERA_ENTRE_NEGOCIOS.md", "utf8")).toMatch(/2\. \[x\] Event trigger de vistas invoker/);
  });
});
