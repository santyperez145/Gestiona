import { describe, it, expect } from "vitest";
import { resolveTheme, hexToHsl, THEME_IDS } from "@/storefront/theme";

describe("hexToHsl", () => {
  it("convierte un hex a la forma que usan las variables CSS", () => {
    expect(hexToHsl("#ffffff")).toBe("0 0% 100%");
    expect(hexToHsl("#000000")).toBe("0 0% 0%");
  });

  it("acepta con y sin numeral", () => {
    expect(hexToHsl("f59e0b")).toBe(hexToHsl("#f59e0b"));
  });

  it("devuelve null ante un valor inválido en vez de romper la tienda", () => {
    expect(hexToHsl("no-es-un-color")).toBeNull();
    expect(hexToHsl("")).toBeNull();
    expect(hexToHsl(null)).toBeNull();
    expect(hexToHsl("#fff")).toBeNull();   // formato corto no soportado
  });
});

describe("resolveTheme", () => {
  it("los 5 temas del panel existen y definen todas las variables", () => {
    expect(THEME_IDS).toHaveLength(5);
    const requeridas = ["--st-bg", "--st-surface", "--st-border", "--st-text", "--st-muted", "--st-accent", "--st-accent-fg", "--st-header"];
    for (const id of THEME_IDS) {
      const t = resolveTheme(id, null);
      for (const v of requeridas) expect(t.vars[v], `${id} sin ${v}`).toBeTruthy();
    }
  });

  it("un tema desconocido cae en minimal en vez de quedar sin estilos", () => {
    expect(resolveTheme("no-existe", null).id).toBe("minimal");
    expect(resolveTheme(null, null).id).toBe("minimal");
  });

  it("el color de marca pisa el acento del tema", () => {
    const t = resolveTheme("luxury", "#f59e0b");
    expect(t.vars["--st-accent"]).toBe(hexToHsl("#f59e0b"));
  });

  it("ajusta el texto del acento para que se lea: claro sobre oscuro", () => {
    // Un acento oscuro necesita texto blanco encima.
    expect(resolveTheme("minimal", "#1a1a2e").vars["--st-accent-fg"]).toBe("0 0% 100%");
    // Uno claro necesita texto oscuro, o el botón queda ilegible.
    expect(resolveTheme("minimal", "#ffe066").vars["--st-accent-fg"]).toBe("0 0% 10%");
  });

  it("un color de marca inválido no rompe el tema base", () => {
    const base = resolveTheme("sport", null);
    const conBasura = resolveTheme("sport", "rojo");
    expect(conBasura.vars["--st-accent"]).toBe(base.vars["--st-accent"]);
  });
});
