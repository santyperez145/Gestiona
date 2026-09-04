import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  announceUpdateAvailable,
  createControllerChangeHandler,
  hasPendingAppUpdate,
  UPDATE_AVAILABLE_EVENT,
} from "@/lib/swUpdate";

const source = readFileSync(resolve(process.cwd(), "src/lib/swUpdate.ts"), "utf8");

describe("actualizaciones sin interrupciones", () => {
  it("no recarga automáticamente al cambiar el service worker", () => {
    expect(source).not.toContain("window.location.reload");
    expect(source).not.toMatch(/setTimeout\([\s\S]{0,120}reload/);
  });

  it("una instalación limpia no se anuncia como una versión nueva", () => {
    const onUpdate = vi.fn();
    const onControllerChange = createControllerChangeHandler(false, onUpdate);

    onControllerChange();
    expect(onUpdate).not.toHaveBeenCalled();

    onControllerChange();
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("una pestaña ya controlada anuncia el primer cambio de versión", () => {
    const onUpdate = vi.fn();
    const onControllerChange = createControllerChangeHandler(true, onUpdate);

    onControllerChange();
    expect(onUpdate).toHaveBeenCalledOnce();
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

  it("el error boundary conoce una versión pendiente sin forzar la recarga", () => {
    expect(hasPendingAppUpdate()).toBe(false);
    announceUpdateAvailable();
    expect(hasPendingAppUpdate()).toBe(true);

    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toContain("hasPendingAppUpdate() || isStaleBuildError(error)");
  });
});
