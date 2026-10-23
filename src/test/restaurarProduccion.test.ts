import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSULTAS_PRODUCCION, estadoDelProyecto, PASOS, PROYECTO, secretosExigidos, secretosFaltantes } from "../../scripts/restaurar-produccion.mjs";

describe("restaurar producción en un solo comando", () => {
  const fuente = readFileSync("scripts/restaurar-produccion.mjs", "utf8");

  it("lee el estado del proyecto que sale del CLI", () => {
    const lista = JSON.stringify([{ id: PROYECTO, status: "INACTIVE" }, { id: "otro", status: "ACTIVE_HEALTHY" }]);
    expect(estadoDelProyecto(lista)).toBe("INACTIVE");
    expect(estadoDelProyecto(JSON.stringify([{ id: PROYECTO, status: "ACTIVE_HEALTHY" }]))).toBe("ACTIVE_HEALTHY");
    expect(estadoDelProyecto("[]")).toBe("NO_ENCONTRADO");
    expect(estadoDelProyecto("no es json")).toBe("ILEGIBLE");
  });

  it("simula antes de aplicar, audita antes de publicar y sólo escribe con --ejecutar", () => {
    expect(PASOS).toEqual([
      "Proyecto activo y Auth respondiendo", "Simulacro de las migraciones pendientes", "Aplicar las migraciones pendientes",
      "Auditoría de permisos en producción", "Publicar las funciones", "Control de estado y CI",
    ]);
    const simulacro = fuente.indexOf('correr("node", ["scripts/migraciones-pendientes.mjs"])');
    const sinEjecutar = fuente.indexOf("if (!ejecutar)");
    const aplicar = fuente.indexOf('"scripts/migraciones-pendientes.mjs", "--aplicar"');
    const auditoria = fuente.indexOf("await auditar()");
    const funciones = fuente.indexOf('"scripts/deploy-functions.sh"');
    expect(simulacro).toBeGreaterThan(0);
    expect(sinEjecutar).toBeGreaterThan(simulacro);
    expect(aplicar).toBeGreaterThan(sinEjecutar);
    expect(auditoria).toBeGreaterThan(aplicar);
    expect(funciones).toBeGreaterThan(auditoria);
  });

  it("frena con el proyecto inactivo y nunca imprime la conexión", () => {
    expect(fuente).toContain('if (estado !== "ACTIVE_HEALTHY")');
    expect(fuente).not.toMatch(/console\.\w+\([^)]*SUPABASE_DB_URL\b(?!\s+en el entorno)/);
    expect(CONSULTAS_PRODUCCION.truncate).toContain("TRUNCATE");
    expect(CONSULTAS_PRODUCCION.vistasEscribibles).toContain("security_invoker");
  });

  it("compara los secretos que exigen las funciones con los cargados, sólo por nombre", () => {
    const exigidos = secretosExigidos();
    expect(exigidos.get("MP_APP_SECRET")).toBeDefined();
    expect([...exigidos.keys()].some(n => n.startsWith("SUPABASE_"))).toBe(false);
    const faltan = secretosFaltantes(new Map([["MP_APP_ID", new Set(["mp-connect"])], ["MELI_CLIENT_ID", new Set(["meli-oauth", "meli-sync"])]]),
      JSON.stringify([{ name: "MP_APP_ID", value: "no se lee" }]));
    expect(faltan).toEqual([{ nombre: "MELI_CLIENT_ID", funciones: ["meli-oauth", "meli-sync"] }]);
    expect(secretosFaltantes(new Map(), "no es json")).toBeNull();
  });
});
