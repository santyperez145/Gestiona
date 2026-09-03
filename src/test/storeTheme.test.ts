import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTheme, hexToHsl, THEME_IDS, resolveFont, googleFontHref, STORE_FONTS, STORE_THEMES, themePaintsHeader } from "@/storefront/theme";

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
  it("todos los temas del panel existen y definen todas las variables", () => {
    // El número sale de la lista, no de una constante escrita a mano: agregar
    // un tema no tiene que obligar a tocar el test, pero olvidarse una variable
    // sí tiene que fallar.
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(5);
    const requeridas = ["--st-bg", "--st-surface", "--st-border", "--st-text", "--st-muted", "--st-accent", "--st-accent-fg", "--st-header", "--st-header-fg"];
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

  it("Luxury conserva el header: la marca pinta el botón, no el cromo", () => {
    const base = resolveTheme("luxury", null);
    const t = resolveTheme("luxury", "#f59e0b");
    expect(themePaintsHeader("luxury")).toBe(false);
    expect(t.vars["--st-header"]).toBe(base.vars["--st-header"]);
    expect(t.vars["--st-accent"]).toBe(hexToHsl("#f59e0b"));
  });

  it("Bold sí pinta el header porque el tema ya es de color", () => {
    expect(themePaintsHeader("bold")).toBe(true);
    expect(resolveTheme("bold", "#1a1a2e").vars["--st-header"]).toBe(hexToHsl("#1a1a2e"));
  });

  it("el panel y la vitrina enumeran los mismos temas", () => {
    expect(STORE_THEMES.map(t => t.id)).toEqual(THEME_IDS);
    const page = readFileSync(resolve(process.cwd(), "src/pages/EcommerceStorePage.tsx"), "utf8");
    expect(page).toContain("STORE_THEMES");
    expect(page).toContain("resolveTheme");
    expect(page).not.toMatch(/const THEMES = \[/);
    expect(page).not.toContain("Perfume 100ml");
  });

  it("un color de marca inválido no rompe el tema base", () => {
    const base = resolveTheme("sport", null);
    const conBasura = resolveTheme("sport", "rojo");
    expect(conBasura.vars["--st-accent"]).toBe(base.vars["--st-accent"]);
  });
});

describe("tipografías de la tienda", () => {
  it("el catálogo trae etiqueta y stack en todas", () => {
    expect(STORE_FONTS.length).toBeGreaterThan(1);
    for (const f of STORE_FONTS) {
      expect(f.stack, `fuente ${f.id}`).toBeTruthy();
      expect(f.label, `fuente ${f.id}`).toBeTruthy();
    }
  });

  it("resuelve una del catálogo", () => {
    expect(resolveFont("playfair")?.label).toBe("Playfair Display");
  });

  // El caso que importa: una fuente que se saca del catálogo, o un valor viejo
  // guardado en la base, no puede dejar la vitrina sin renderizar. Cae en la
  // del tema, que es como se veía antes.
  it("una fuente desconocida devuelve null en vez de romper", () => {
    expect(resolveFont("fuente-que-no-existe")).toBeNull();
    expect(resolveFont(null)).toBeNull();
    expect(resolveFont("")).toBeNull();
  });

  it("la del sistema no descarga nada", () => {
    expect(googleFontHref(resolveFont("sistema"))).toBeNull();
    expect(googleFontHref(null)).toBeNull();
  });

  // La CSP de vercel.json sólo permite hojas de estilo de fonts.googleapis.com:
  // si alguna fuente apuntara a otro lado, el navegador la bloquearía y la
  // tienda se vería con la del sistema sin que nadie entienda por qué.
  it("las de Google apuntan a fonts.googleapis.com, que es lo que permite la CSP", () => {
    for (const f of STORE_FONTS) {
      const href = googleFontHref(f);
      if (href === null) continue;
      expect(href.startsWith("https://fonts.googleapis.com/css2?family="), `fuente ${f.id}`).toBe(true);
      expect(href).toContain("display=swap");
    }
  });
});
