import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

/**
 * Ninguna pantalla vuelve a tener dos URLs, y ninguna página queda huérfana.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * El 2026-08-27 se eliminaron **12 páginas duplicadas**: tres del CRM, el
 * planner social, tres motores de planificación de inventario, tres centros
 * analíticos y dos páginas genéricas de IA. Todas eran la misma tarea partida
 * en varias URLs, y varias además calculaban lo mismo de formas distintas.
 *
 * El manifest ya tiene guardas de aliases —«ningún alias es también canónica»,
 * «todo alias apunta a una canónica»—, pero ninguna impedía el caso que
 * empezó todo: **dos rutas canónicas montando el mismo componente**. Eso es
 * duplicación literal: dos URLs vivas para una pantalla, con la telemetría, el
 * SEO y los bookmarks partidos entre las dos.
 *
 * ⚠️ Y el segundo agujero: una página que se deja de rutear pero no se borra
 * queda como archivo muerto — compila, pesa en el repo y el próximo que la
 * encuentre no sabe si está viva. Medido al escribir esta guarda: **0
 * huérfanas** sobre 87 archivos de `src/pages`.
 */

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const MANIFEST = leer("src/app/routeManifest.ts");
const APP = leer("src/App.tsx");

/** `import("@/pages/X")` → `X`, en el orden en que aparecen en el manifest. */
function componentesDelManifest(): string[] {
  return [...MANIFEST.matchAll(/import\(\s*"@\/pages\/([A-Za-z0-9/_-]+)"\s*\)/g)]
    .map(m => m[1]);
}

function archivosDePaginas(dir = "src/pages"): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entrada);
    if (statSync(resolve(ROOT, rel)).isDirectory()) {
      salida.push(...archivosDePaginas(rel));
    } else if (/\.tsx$/.test(entrada)) {
      salida.push(rel.split(sep).join("/"));
    }
  }
  return salida;
}

/** Todo el código fuente, para preguntar quién importa a quién. */
function fuentes(dir = "src"): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entrada);
    if (statSync(resolve(ROOT, rel)).isDirectory()) {
      salida.push(...fuentes(rel));
    } else if (/\.tsx?$/.test(entrada)) {
      salida.push(rel.split(sep).join("/"));
    }
  }
  return salida;
}

describe("ninguna pantalla tiene dos URLs", () => {
  it("el escaneo encuentra componentes de verdad", () => {
    // Un regex roto haría que el test de abajo pase por vacío.
    expect(componentesDelManifest().length).toBeGreaterThan(50);
  });

  it("dos rutas canónicas no montan el mismo componente", () => {
    const vistos = new Map<string, number>();
    for (const c of componentesDelManifest()) {
      vistos.set(c, (vistos.get(c) ?? 0) + 1);
    }
    const repetidos = [...vistos.entries()]
      .filter(([, n]) => n > 1)
      .map(([c, n]) => `${c} montado por ${n} rutas`);

    expect(repetidos, [
      "Hay páginas con más de una URL canónica.",
      "Eso parte la telemetría, el SEO y los bookmarks entre dos direcciones",
      "para la misma pantalla. Si una es la vieja, va como alias con ?vista=;",
      "si son tareas distintas, cada una necesita su propio componente.",
      "",
      ...repetidos,
    ].join("\n")).toEqual([]);
  });
});

describe("ninguna página queda huérfana", () => {
  it("toda página está ruteada o la importa alguien", () => {
    const paginas = archivosDePaginas();
    const codigo = fuentes().filter(f => !f.includes("/test/"));

    const huerfanas = paginas.filter(pagina => {
      const modulo = pagina.replace(/^src\//, "@/").replace(/\.tsx$/, "");
      const rutaCorta = pagina.replace(/^src\/pages\//, "").replace(/\.tsx$/, "");

      if (MANIFEST.includes(`"@/pages/${rutaCorta}"`)) return false;
      if (APP.includes(`"@/pages/${rutaCorta}"`)) return false;

      // ¿La importa cualquier otro archivo que no sea ella misma?
      return !codigo.some(f =>
        f !== pagina && leer(f).includes(modulo.replace("@/pages/", "pages/")));
    });

    expect(huerfanas, [
      "Hay páginas que no rutea nadie y que nadie importa.",
      "Una página que se deja de rutear y no se borra es un archivo muerto:",
      "compila, pesa, y el próximo que la encuentre no sabe si está viva.",
      "Si se retiró, se borra; si sigue viva, necesita ruta o quien la monte.",
      "",
      ...huerfanas,
    ].join("\n")).toEqual([]);
  });
});

describe("las 12 que se eliminaron no volvieron", () => {
  // Guarda concreta contra la regresión exacta: si alguien recrea una de estas
  // como página, el nombre vuelve a aparecer en src/pages.
  const ELIMINADAS = [
    "AdvancedCRMPage", "CustomerRFMPage", "FollowUpPage",
    "SocialPlannerPage",
    "AutoRestockPage", "InventoryForecastPage", "SmartInventoryPage",
    "KPIDashboardPage", "BIReportsPage", "SalesForecastPage",
    "AIInsightsPage", "AIChatAdvancedPage",
  ];

  it("ninguna volvió a src/pages", () => {
    const existentes = archivosDePaginas().map(p =>
      p.replace(/^src\/pages\//, "").replace(/\.tsx$/, ""));
    const revividas = ELIMINADAS.filter(e => existentes.includes(e));

    expect(revividas, [
      "Volvió una página que se consolidó el 2026-08-27.",
      "Su contenido vive como vista en components/<dominio>/ y su ruta vieja",
      "es un alias con ?vista=. Recrearla parte otra vez la tarea en dos URLs.",
      "",
      ...revividas,
    ].join("\n")).toEqual([]);
  });

  it("sus rutas viejas siguen resolviendo como alias", () => {
    // El valor de eliminar una página es cero si el bookmark de alguien muere.
    for (const vieja of ["/rfm", "/crm-avanzado", "/seguimiento", "/planner-social",
                         "/restock", "/forecast-inventario", "/inventario-inteligente",
                         "/kpi-dashboard", "/bi-reportes", "/forecast", "/chat-ia"]) {
      expect(MANIFEST, `${vieja} dejó de estar en el manifest: un bookmark muere`)
        .toContain(`path: "${vieja}"`);
    }
  });
});
