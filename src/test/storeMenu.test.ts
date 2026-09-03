import { describe, it, expect } from "vitest";
import {
  TIPOS, esUrlSegura, destinoDe, menuAutomatico, menuEfectivo, validarLink,
  type LinkMenu,
} from "@/lib/storeMenu";

const base = "/tienda/exentryimports";
const ctx = {
  base,
  categorias: [
    { slug: "perfume_arabe", label: "Perfume Árabe" },
    { slug: "vaper", label: "Vaper" },
    { slug: "electronico", label: "Electrónico" },
  ],
};

describe("esUrlSegura", () => {
  it("acepta http y https", () => {
    expect(esUrlSegura("https://instagram.com/tienda")).toBe(true);
    expect(esUrlSegura("http://ejemplo.com")).toBe(true);
  });

  it("rechaza javascript: — un link del menú es código que corre en la tienda", () => {
    expect(esUrlSegura("javascript:alert(1)")).toBe(false);
    expect(esUrlSegura("data:text/html,<script>")).toBe(false);
    expect(esUrlSegura("  JavaScript:alert(1)  ")).toBe(false);
  });

  it("rechaza lo que no es una URL", () => {
    expect(esUrlSegura("instagram.com")).toBe(false);
    expect(esUrlSegura("")).toBe(false);
    expect(esUrlSegura(null as unknown as string)).toBe(false);
  });
});

describe("destinoDe", () => {
  it("arma cada tipo de destino", () => {
    expect(destinoDe({ label: "Inicio", tipo: "inicio" }, base)?.to).toBe(base);
    expect(destinoDe({ label: "Todo", tipo: "productos" }, base)?.to).toBe(`${base}/productos`);
    expect(destinoDe({ label: "Promos", tipo: "ofertas" }, base)?.to).toBe(`${base}/productos?oferta=1`);
    expect(destinoDe({ label: "Árabes", tipo: "categoria", valor: "perfume_arabe" }, base)?.to)
      .toBe(`${base}/productos?cat=perfume_arabe`);
    expect(destinoDe({ label: "Cómo comprar", tipo: "pagina", valor: "como-comprar" }, base)?.to)
      .toBe(`${base}/pagina/como-comprar`);
  });

  it("un link externo se marca como externo y no pasa por el router", () => {
    const item = destinoDe({ label: "IG", tipo: "url", valor: "https://instagram.com/x" }, base);
    expect(item?.externo).toBe(true);
    expect(item?.to).toBe("https://instagram.com/x");
  });

  it("escapa el valor: una categoría con caracteres raros no rompe la URL", () => {
    expect(destinoDe({ label: "X", tipo: "categoria", valor: "ropa & más" }, base)?.to)
      .toBe(`${base}/productos?cat=ropa%20%26%20m%C3%A1s`);
  });

  it("descarta lo que no lleva a ningún lado en vez de mostrarlo roto", () => {
    expect(destinoDe({ label: "", tipo: "inicio" }, base)).toBeNull();
    expect(destinoDe({ label: "X", tipo: "categoria", valor: "" }, base)).toBeNull();
    expect(destinoDe({ label: "X", tipo: "pagina" }, base)).toBeNull();
    expect(destinoDe({ label: "X", tipo: "url", valor: "javascript:alert(1)" }, base)).toBeNull();
    expect(destinoDe({ label: "X", tipo: "loquesea" as never }, base)).toBeNull();
  });
});

describe("menuAutomatico", () => {
  it("es el de siempre: Inicio, Productos, dos categorías y Ofertas", () => {
    expect(menuAutomatico(ctx).map(m => m.label))
      .toEqual(["Inicio", "Productos", "Perfume Árabe", "Vaper", "Ofertas"]);
  });

  it("sin categorías sigue teniendo por dónde entrar al catálogo", () => {
    expect(menuAutomatico({ base, categorias: [] }).map(m => m.label))
      .toEqual(["Inicio", "Productos", "Ofertas"]);
  });

  it("en el subdominio Inicio apunta a la raíz y no a la página actual", () => {
    expect(menuAutomatico({ base: "", categorias: [] })[0]?.to).toBe("/");
    expect(destinoDe({ label: "Inicio", tipo: "inicio" }, "")?.to).toBe("/");
  });
});

describe("menuEfectivo", () => {
  it("una lista vacía significa 'armalo solo', no 'menú vacío'", () => {
    // Es lo que hace que aplicar la migración no cambie ninguna tienda.
    expect(menuEfectivo([], ctx)).toEqual(menuAutomatico(ctx));
    expect(menuEfectivo(null, ctx)).toEqual(menuAutomatico(ctx));
    expect(menuEfectivo(undefined, ctx)).toEqual(menuAutomatico(ctx));
  });

  it("un jsonb que no es un arreglo tampoco rompe el header", () => {
    expect(menuEfectivo({ roto: true }, ctx)).toEqual(menuAutomatico(ctx));
    expect(menuEfectivo("[]", ctx)).toEqual(menuAutomatico(ctx));
  });

  it("con links configurados manda lo que puso el comercio", () => {
    const links: LinkMenu[] = [
      { label: "Perfumes", tipo: "categoria", valor: "perfume_arabe" },
      { label: "Cómo comprar", tipo: "pagina", valor: "como-comprar" },
    ];
    expect(menuEfectivo(links, ctx).map(m => m.label))
      .toEqual(["Perfumes", "Cómo comprar"]);
  });

  it("descarta los rotos pero conserva los que sirven", () => {
    const links: LinkMenu[] = [
      { label: "Bueno", tipo: "productos" },
      { label: "Roto", tipo: "categoria", valor: "" },
      { label: "Peligroso", tipo: "url", valor: "javascript:alert(1)" },
    ];
    expect(menuEfectivo(links, ctx).map(m => m.label)).toEqual(["Bueno"]);
  });

  it("si TODOS están rotos vuelve al automático: el header no puede quedar vacío", () => {
    // Pasa de verdad: se borra una categoría o se despublica una página y el
    // menú apuntaba sólo ahí. Sin esto el comprador no llega al catálogo.
    const links: LinkMenu[] = [
      { label: "X", tipo: "categoria", valor: "" },
      { label: "Y", tipo: "pagina", valor: "" },
    ];
    expect(menuEfectivo(links, ctx)).toEqual(menuAutomatico(ctx));
  });
});

describe("validarLink", () => {
  it("acepta uno bien armado", () => {
    expect(validarLink({ label: "Ofertas", tipo: "ofertas" })).toBeUndefined();
    expect(validarLink({ label: "IG", tipo: "url", valor: "https://instagram.com" })).toBeUndefined();
  });

  it("pide texto", () => {
    expect(validarLink({ label: "", tipo: "inicio" })).toBe("Poné un texto para el link");
    expect(validarLink({ label: "  ", tipo: "inicio" })).toBeDefined();
    expect(validarLink({ label: "x".repeat(40), tipo: "inicio" })).toBe("El texto es muy largo");
  });

  it("pide el valor sólo en los tipos que lo necesitan", () => {
    expect(validarLink({ label: "Ofertas", tipo: "ofertas" })).toBeUndefined();
    expect(validarLink({ label: "Cat", tipo: "categoria" })).toBe("Elegí cuál");
    expect(validarLink({ label: "Link", tipo: "url" })).toBe("Poné la dirección");
  });

  it("rechaza una URL que no es http(s)", () => {
    expect(validarLink({ label: "X", tipo: "url", valor: "javascript:alert(1)" }))
      .toBe("La dirección tiene que empezar con http:// o https://");
  });

  it("cada tipo declara si pide valor, y la lista no tiene duplicados", () => {
    expect(new Set(TIPOS.map(t => t.id)).size).toBe(TIPOS.length);
    expect(TIPOS.filter(t => t.pideValor).map(t => t.id))
      .toEqual(["categoria", "pagina", "url"]);
  });
});

// ── Submenús ────────────────────────────────────────────────────────────────
import { menuConSubmenus } from "@/lib/storeMenu";

describe("menuConSubmenus", () => {
  const hijas = new Map([
    ["perfumes", [
      { slug: "arabes", label: "Árabes" },
      { slug: "disenador", label: "Diseñador" },
    ]],
  ]);

  it("despliega el ítem que apunta a una categoría con hijas", () => {
    const items = [{ label: "Perfumes", to: `${base}/productos?cat=perfumes` }];
    const [n] = menuConSubmenus(items, hijas, base);
    expect(n.hijos.map(h => h.label)).toEqual(["Árabes", "Diseñador"]);
    expect(n.hijos[0].to).toBe(`${base}/productos?cat=arabes`);
  });

  it("lo que no es una categoría queda plano", () => {
    const items = [
      { label: "Inicio", to: base },
      { label: "IG", to: "https://instagram.com/x", externo: true },
      { label: "Cómo comprar", to: `${base}/pagina/como-comprar` },
    ];
    expect(menuConSubmenus(items, hijas, base).every(n => n.hijos.length === 0)).toBe(true);
  });

  it("una categoría sin hijas queda plana", () => {
    const items = [{ label: "Vapers", to: `${base}/productos?cat=vaper` }];
    expect(menuConSubmenus(items, hijas, base)[0].hijos).toEqual([]);
  });

  it("lee el slug aunque venga escapado en la URL", () => {
    const conEspacio = new Map([["ropa de verano", [{ slug: "remeras", label: "Remeras" }]]]);
    const items = [{ label: "Ropa", to: `${base}/productos?cat=ropa%20de%20verano` }];
    expect(menuConSubmenus(items, conEspacio, base)[0].hijos).toHaveLength(1);
  });

  it("no confunde `cat` con otro parámetro que lo contenga", () => {
    const items = [{ label: "Ofertas", to: `${base}/productos?oferta=1` }];
    expect(menuConSubmenus(items, hijas, base)[0].hijos).toEqual([]);
  });
});
