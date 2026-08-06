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

// ── Subcategorías ───────────────────────────────────────────────────────────
import { arbolDeCategorias, slugsDeRama, validarPadre } from "@/lib/storeCategories";

const arbolito: CategoriaTienda[] = [
  cat({ id: "perf", slug: "perfumes", name: "Perfumes", productos: 0, sort_order: 0 }),
  cat({ id: "arab", slug: "arabes", name: "Árabes", parent_id: "perf", productos: 54, sort_order: 0 }),
  cat({ id: "dise", slug: "disenador", name: "Diseñador", parent_id: "perf", productos: 1, sort_order: 1 }),
  cat({ id: "vap", slug: "vaper", name: "Vapers", productos: 5, sort_order: 1 }),
];

describe("arbolDeCategorias", () => {
  it("cuelga las hijas de su padre y deja las raíces arriba", () => {
    const arbol = arbolDeCategorias(arbolito);
    expect(arbol.map(n => n.slug)).toEqual(["perfumes", "vaper"]);
    expect(arbol[0].hijos.map(n => n.slug)).toEqual(["arabes", "disenador"]);
    expect(arbol[1].hijos).toEqual([]);
  });

  it("suma los productos de toda la rama, no sólo los propios", () => {
    // "Perfumes" no tiene productos propios pero tiene 55 abajo: sin esto
    // desaparecería del menú por parecer vacía.
    const arbol = arbolDeCategorias(arbolito);
    expect(arbol[0].productos).toBe(0);
    expect(arbol[0].productosEnRama).toBe(55);
  });

  it("respeta el orden del comercio en cada nivel", () => {
    const arbol = arbolDeCategorias([
      cat({ id: "a", slug: "a", name: "A", sort_order: 2 }),
      cat({ id: "b", slug: "b", name: "B", sort_order: 1 }),
      cat({ id: "a2", slug: "a2", name: "A2", parent_id: "a", sort_order: 2 }),
      cat({ id: "a1", slug: "a1", name: "A1", parent_id: "a", sort_order: 1 }),
    ]);
    expect(arbol.map(n => n.slug)).toEqual(["b", "a"]);
    expect(arbol[1].hijos.map(n => n.slug)).toEqual(["a1", "a2"]);
  });

  it("una hija cuyo padre no está se muestra como raíz, no se pierde", () => {
    // Pasa cuando el padre se escondió: el RPC público no lo devuelve.
    const arbol = arbolDeCategorias([cat({ id: "x", slug: "x", parent_id: "fantasma" })]);
    expect(arbol.map(n => n.slug)).toEqual(["x"]);
  });

  it("un ciclo no cuelga el navegador", () => {
    // Con una recursión sin guarda esto es un bucle infinito en el render.
    const ciclo = [
      cat({ id: "a", slug: "a", parent_id: "b" }),
      cat({ id: "b", slug: "b", parent_id: "a" }),
    ];
    const arbol = arbolDeCategorias(ciclo);
    expect(arbol.length).toBeGreaterThan(0);
    expect(arbol.length).toBeLessThanOrEqual(2);
  });

  it("una lista vacía da un árbol vacío", () => {
    expect(arbolDeCategorias([])).toEqual([]);
  });
});

describe("slugsDeRama", () => {
  it("entrar al padre trae también lo de las hijas", () => {
    // Sin esto, tocar "Perfumes" da una página vacía y el comprador se va.
    expect(slugsDeRama("perfumes", arbolito).sort())
      .toEqual(["arabes", "disenador", "perfumes"]);
  });

  it("una hoja se trae a sí misma", () => {
    expect(slugsDeRama("vaper", arbolito)).toEqual(["vaper"]);
  });

  it("un slug que no existe se devuelve igual, sin romper el filtro", () => {
    expect(slugsDeRama("no-existe", arbolito)).toEqual(["no-existe"]);
  });

  it("un ciclo no cuelga", () => {
    const ciclo = [
      cat({ id: "a", slug: "a", parent_id: "b" }),
      cat({ id: "b", slug: "b", parent_id: "a" }),
    ];
    expect(slugsDeRama("a", ciclo).sort()).toEqual(["a", "b"]);
  });
});

describe("validarPadre", () => {
  it("deja colgar una categoría de otra de primer nivel", () => {
    expect(validarPadre("vap", "perf", arbolito)).toBeUndefined();
  });

  it("sacar el padre siempre se puede", () => {
    expect(validarPadre("arab", null, arbolito)).toBeUndefined();
  });

  it("no deja que sea su propia subcategoría", () => {
    expect(validarPadre("perf", "perf", arbolito))
      .toBe("Una categoría no puede ser su propia subcategoría");
  });

  it("no deja colgar un padre de su propia hija: eso es un ciclo", () => {
    expect(validarPadre("perf", "arab", arbolito))
      .toBe("Esa categoría ya está adentro de la que estás moviendo");
  });

  it("corta en dos niveles", () => {
    expect(validarPadre("vap", "arab", arbolito)).toBe("Sólo se permiten dos niveles");
  });
});

describe("menuDeCategorias con subcategorías", () => {
  it("el menú lleva SÓLO las de primer nivel", () => {
    // El bug: con la lista plana el menú agarraba dos hijas, el padre no
    // aparecía nunca y por lo tanto tampoco su desplegable.
    const menu = menuDeCategorias(arbolito, []);
    expect(menu.map(m => m.slug)).toEqual(["perfumes", "vaper"]);
  });

  it("un padre sin productos propios entra igual si su rama tiene", () => {
    expect(menuDeCategorias(arbolito, []).map(m => m.slug)).toContain("perfumes");
  });

  it("una rama entera vacía no entra al menú", () => {
    const vacias = [
      cat({ id: "p", slug: "p", name: "P", productos: 0 }),
      cat({ id: "h", slug: "h", name: "H", parent_id: "p", productos: 0 }),
      cat({ id: "ok", slug: "ok", name: "OK", productos: 3 }),
    ];
    expect(menuDeCategorias(vacias, []).map(m => m.slug)).toEqual(["ok"]);
  });
});
