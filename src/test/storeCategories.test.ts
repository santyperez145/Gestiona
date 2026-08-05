import { describe, it, expect } from "vitest";
import {
  NOMBRES_HEREDADOS, slugALegible, nombreDeCategoria, menuDeCategorias,
  slugDeNombre, validarNombre, type CategoriaTienda,
} from "@/lib/storeCategories";

const cat = (over: Partial<CategoriaTienda>): CategoriaTienda => ({
  id: "1", name: "Cat", slug: "cat", sort_order: 0, productos: 1, ...over,
});

describe("slugALegible", () => {
  it("convierte el slug en algo que se puede leer", () => {
    expect(slugALegible("perfume_arabe")).toBe("Perfume arabe");
    expect(slugALegible("ropa-de-verano")).toBe("Ropa de verano");
  });

  it("aguanta vacío y basura sin romper", () => {
    expect(slugALegible("")).toBe("");
    expect(slugALegible(null as unknown as string)).toBe("");
  });
});

describe("nombreDeCategoria", () => {
  it("gana el nombre que cargó el comercio", () => {
    const cats = [cat({ slug: "vaper", name: "Vapes y descartables" })];
    expect(nombreDeCategoria("vaper", cats)).toBe("Vapes y descartables");
  });

  it("sin categorías cargadas usa el nombre heredado", () => {
    // Es lo que hace que aplicar la migración no cambie nada ese mismo día.
    expect(nombreDeCategoria("perfume_arabe")).toBe("Perfume Árabe");
    expect(nombreDeCategoria("perfume_arabe", [])).toBe("Perfume Árabe");
  });

  it("un slug de otro rubro se muestra legible en vez de crudo", () => {
    // El caso que motivó todo esto: quien venda ropa no tiene por qué ver
    // "Perfume Árabe" ni "remeras_oversize".
    expect(nombreDeCategoria("remeras_oversize")).toBe("Remeras oversize");
  });

  it("nunca devuelve vacío: un botón sin texto no es un menú", () => {
    const cats = [cat({ slug: "vaper", name: "   " })];
    expect(nombreDeCategoria("vaper", cats)).toBe("Vaper");
    expect(nombreDeCategoria("loquesea").length).toBeGreaterThan(0);
  });

  it("los cuatro heredados siguen estando", () => {
    expect(Object.keys(NOMBRES_HEREDADOS).sort()).toEqual(
      ["electronico", "perfume_arabe", "perfume_diseñador", "vaper"],
    );
  });
});

describe("menuDeCategorias", () => {
  it("respeta el orden que puso el comercio, no el alfabético", () => {
    const cats = [
      cat({ id: "a", slug: "vaper", name: "Vaper", sort_order: 2 }),
      cat({ id: "b", slug: "arabe", name: "Árabes", sort_order: 1 }),
    ];
    expect(menuDeCategorias(cats, ["vaper", "arabe"]).map(m => m.slug))
      .toEqual(["arabe", "vaper"]);
  });

  it("esconde las vacías: una categoría sin productos es un callejón sin salida", () => {
    const cats = [
      cat({ id: "a", slug: "llena", productos: 4 }),
      cat({ id: "b", slug: "vacia", productos: 0 }),
    ];
    expect(menuDeCategorias(cats, []).map(m => m.slug)).toEqual(["llena"]);
  });

  it("pero no la esconde si los productos cargados dicen que tiene", () => {
    // El conteo del RPC y el catálogo que ya está en memoria pueden no estar
    // sincronizados; ante la duda se muestra, que es el error barato.
    const cats = [cat({ slug: "x", productos: 0 })];
    expect(menuDeCategorias(cats, ["x"]).map(m => m.slug)).toEqual(["x"]);
  });

  it("sin categorías cargadas cae a los slugs de los productos", () => {
    const menu = menuDeCategorias([], ["vaper", "perfume_arabe", "vaper"]);
    expect(menu.map(m => m.slug)).toEqual(["vaper", "perfume_arabe"]);
    expect(menu[1].label).toBe("Perfume Árabe");
  });

  it("sin nada de nada devuelve una lista vacía, no rompe", () => {
    expect(menuDeCategorias([], [])).toEqual([]);
  });
});

describe("slugDeNombre", () => {
  it("translitera los acentos en vez de borrarlos", () => {
    // Filtrar sin normalizar convierte "Diseñador" en "diseador".
    expect(slugDeNombre("Perfume Diseñador")).toBe("perfume-disenador");
    expect(slugDeNombre("Ñandú")).toBe("nandu");
  });

  it("arma un slug usable de un nombre cualquiera", () => {
    expect(slugDeNombre("Ropa de Verano")).toBe("ropa-de-verano");
    expect(slugDeNombre("  Ofertas!!  ")).toBe("ofertas");
    expect(slugDeNombre("2 x 1")).toBe("2-x-1");
  });

  it("no deja guiones colgando ni vacíos raros", () => {
    expect(slugDeNombre("---")).toBe("");
    expect(slugDeNombre("")).toBe("");
  });
});

describe("validarNombre", () => {
  const existentes = [cat({ id: "a", slug: "vaper", name: "Vaper" })];

  it("acepta un nombre nuevo", () => {
    expect(validarNombre("Perfumes de nicho", existentes)).toBeUndefined();
  });

  it("rechaza uno que ya existe", () => {
    expect(validarNombre("Vaper", existentes)).toBe("Ya existe una categoría con ese nombre");
    // Y también si sólo cambia el acento o la mayúscula: mismo slug.
    expect(validarNombre("VAPER", existentes)).toBeDefined();
  });

  it("deja editar la misma categoría sin chocar consigo misma", () => {
    expect(validarNombre("Vaper", existentes, "a")).toBeUndefined();
  });

  it("rechaza vacío, muy corto y sin letras", () => {
    expect(validarNombre("", existentes)).toBeDefined();
    expect(validarNombre("a", existentes)).toBeDefined();
    expect(validarNombre("!!!", existentes)).toBe("Poné un nombre con letras o números");
  });

  it("rechaza uno absurdamente largo", () => {
    expect(validarNombre("x".repeat(80), existentes)).toBe("El nombre es muy largo");
  });
});
