import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mensajeDeError, origenDeRuta } from "@/lib/registroDeErrores";

describe("registro propio de errores", () => {
  it("limpia datos personales y arma un mensaje corto", () => {
    expect(mensajeDeError(new TypeError("no se pudo con ana@ejemplo.com"))).toBe("TypeError: no se pudo con [EMAIL_REDACTED]");
    expect(mensajeDeError({ message: "Bearer abc.def" })).toBe("Bearer [REDACTED]");
    expect(mensajeDeError("x".repeat(500))?.length).toBe(300);
    expect(mensajeDeError(undefined)).toBeNull();
  });

  it("sabe si el error es del panel o de la tienda", () => {
    expect(origenDeRuta("/tienda/famatina/productos")).toBe("tienda");
    expect(origenDeRuta("/productos")).toBe("panel");
    expect(origenDeRuta("/")).toBe("otro");
  });

  it("main y el ErrorBoundary lo usan, sin contar una versión vieja como error", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(main).toContain("if (!isStaleBuildError(event.error)) registrarError(event.error ?? event.message);");
    expect(app).toContain("onError={error => { if (!isStaleBuildError(error)) registrarError(error); }}");
    const lib = readFileSync(resolve(process.cwd(), "src/lib/registroDeErrores.ts"), "utf8");
    expect(lib).toContain("if (esNavegadorAutomatizado()) return;");
    expect(lib).toContain("keepalive: true");
  });
});

describe("la importación de catálogo deja rastro de sus errores", () => {
  // Los errores atrapados no llegan al registro global. El corte de Famatina
  // en la fila 5.500 (10/10) no dejó rastro y hubo que reproducirlo a ciegas.
  it("reportError registra el motivo real, no sólo el mensaje amable", async () => {
    const fs = await import("node:fs");
    const s = fs.readFileSync("src/components/products/ProductsExcelImport.tsx", "utf8");
    const cuerpo = s.slice(s.indexOf("function reportError("), s.indexOf("async function loadHistory("));
    expect(cuerpo).toContain("registrarError(`Importación de catálogo: ${mensajeDeError(cause) ?? fallback}`)");
  });

  it("el motivo del servidor llega limpio al registro", () => {
    const motivo = mensajeDeError({ message: "No se pudo aplicar el lote que empieza en la fila 5501; los lotes anteriores se conservan. Motivo: x" });
    expect(motivo).toContain("fila 5501");
  });
});
