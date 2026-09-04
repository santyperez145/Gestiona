import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UPDATE_AVAILABLE_EVENT } from "@/lib/swUpdate";

const source = readFileSync(resolve(process.cwd(), "src/lib/swUpdate.ts"), "utf8");

describe("actualizaciones sin interrupciones", () => {
  it("no recarga automáticamente al cambiar el service worker", () => {
    expect(source).not.toContain("window.location.reload");
    expect(source).not.toMatch(/setTimeout\([\s\S]{0,120}reload/);
  });

  it("controllerchange sólo anuncia que hay una versión", () => {
    expect(source).toContain('addEventListener("controllerchange", showUpdateNotice)');
    expect(source).toContain("Hay una versión nueva de Nerqia");
  });

  it("el evento de chunks obsoletos usa el mismo aviso deduplicado", () => {
    expect(UPDATE_AVAILABLE_EVENT).toBe("nerqia:update-available");
    expect(source).toContain("id: UPDATE_TOAST_ID");
  });

  it("conserva chequeos de versión sin recargar en segundo plano", () => {
    expect(source).toContain("reg.update()");
    expect(source).toContain('document.addEventListener("visibilitychange"');
  });

  it("sólo el botón explícito limpia caches y actualiza", () => {
    expect(source).toContain("void hardReload()");
    expect(source).toContain('label: "Actualizar"');
  });
});
