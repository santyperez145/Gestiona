import { describe, it, expect } from "vitest";
import {
  sugerenciasDeBusqueda, destinoSugerencia, moverSeleccion,
  buscarProductosDeTienda,
  type ProductoBuscable,
} from "@/lib/searchSuggest";

const base = "/tienda/exentryimports";

const p = (over: Partial<ProductoBuscable> & { id: string }): ProductoBuscable => ({
  name: over.id, brand: null, category: null, stock: 5, image_url: null, total_sold: 0, ...over,
});

const catalogo: ProductoBuscable[] = [
  p({ id: "1", name: "LATTAFA ASAD ZANZIBAR", brand: "LATTAFA", category: "perfume_arabe" }),
  p({ id: "2", name: "LATTAFA KHAMRAH", brand: "LATTAFA", category: "perfume_arabe", total_sold: 10 }),
  p({ id: "3", name: "AFNAN 9PM BLACK", brand: "AFNAN", category: "perfume_arabe" }),
  p({ id: "4", name: "ELFBAR ICE KING", brand: "ELF BAR", category: "vaper" }),
];

const nombreCategoria = (s: string) =>
  ({ perfume_arabe: "Perfume Árabe", vaper: "Vaper" }[s] ?? s);

describe("sugerenciasDeBusqueda", () => {
  it("con menos de dos letras no sugiere nada", () => {
    // Con una letra sola cualquier lista es ruido y el desplegable tapa la
    // pantalla apenas se toca el buscador.
    expect(sugerenciasDeBusqueda("", catalogo)).toEqual([]);
    expect(sugerenciasDeBusqueda("l", catalogo)).toEqual([]);
    expect(sugerenciasDeBusqueda("  ", catalogo)).toEqual([]);
  });

  it("la marca va primero: es un atajo a muchos productos", () => {
    const s = sugerenciasDeBusqueda("lattafa", catalogo);
    expect(s[0].tipo).toBe("marca");
    expect(s[0].label).toBe("LATTAFA");
    expect(s[0].cantidad).toBe(2);
  });

  it("encuentra la categoría por su nombre visible, no sólo por el slug", () => {
    // El comprador escribe "perfume", no "perfume_arabe".
    const s = sugerenciasDeBusqueda("perfume ara", catalogo, { nombreCategoria });
    expect(s.some(x => x.tipo === "categoria" && x.valor === "perfume_arabe")).toBe(true);
  });

  it("ignora las tildes en los dos sentidos", () => {
    expect(sugerenciasDeBusqueda("arabe", catalogo, { nombreCategoria })
      .some(x => x.tipo === "categoria")).toBe(true);
    expect(sugerenciasDeBusqueda("árabe", catalogo, { nombreCategoria })
      .some(x => x.tipo === "categoria")).toBe(true);
  });

  it("prioriza el producto cuyo nombre EMPIEZA con lo buscado", () => {
    const soloProductos = sugerenciasDeBusqueda("elfbar", catalogo).filter(x => x.tipo === "producto");
    expect(soloProductos[0].label).toBe("ELFBAR ICE KING");
  });

  it("pide todos los términos, no cualquiera", () => {
    // "lattafa khamrah" no puede traer el ASAD.
    const s = sugerenciasDeBusqueda("lattafa khamrah", catalogo).filter(x => x.tipo === "producto");
    expect(s.map(x => x.label)).toEqual(["LATTAFA KHAMRAH"]);
  });

  it("desempata por lo más vendido", () => {
    const s = sugerenciasDeBusqueda("lattafa", catalogo).filter(x => x.tipo === "producto");
    expect(s[0].label).toBe("LATTAFA KHAMRAH");
  });

  it("no sugiere lo agotado si hay algo con stock", () => {
    const conAgotado = [
      p({ id: "a", name: "ASAD CON STOCK", brand: "L", stock: 3 }),
      p({ id: "b", name: "ASAD AGOTADO", brand: "L", stock: 0 }),
    ];
    const s = sugerenciasDeBusqueda("asad", conAgotado).filter(x => x.tipo === "producto");
    expect(s.map(x => x.label)).toEqual(["ASAD CON STOCK"]);
  });

  it("pero sí lo sugiere si es lo único que hay", () => {
    // La ficha existe y ofrece avisar cuando vuelva: es mejor que "no
    // encontramos nada".
    const todoAgotado = [p({ id: "b", name: "ASAD AGOTADO", stock: 0 })];
    expect(sugerenciasDeBusqueda("asad", todoAgotado).length).toBeGreaterThan(0);
  });

  it("un agotado coincidente no desaparece porque haya stock de otro producto", () => {
    const productos = [p({ id: "b", name: "TALADRO INDUSTRIAL", stock: 0 }), p({ id: "a", name: "MARTILLO", stock: 5 })];
    expect(sugerenciasDeBusqueda("taladro", productos).map(s => s.valor)).toEqual(["b"]);
  });

  it("no devuelve nada cuando no hay coincidencia", () => {
    expect(sugerenciasDeBusqueda("zapatillas", catalogo)).toEqual([]);
  });

  it("respeta el límite", () => {
    expect(sugerenciasDeBusqueda("lattafa", catalogo, { limite: 2 })).toHaveLength(2);
  });

  it("un término con caracteres de regex no rompe el ranking", () => {
    // El nombre se usa dentro de un RegExp para ver si empieza una palabra.
    expect(() => sugerenciasDeBusqueda("a+b(c", catalogo)).not.toThrow();
    expect(() => sugerenciasDeBusqueda("[[[", catalogo)).not.toThrow();
  });

  it("un catálogo vacío no rompe", () => {
    expect(sugerenciasDeBusqueda("algo", [])).toEqual([]);
  });
});

describe("buscarProductosDeTienda: same contract as predictive search", () => {
  it("Enter on a typo includes every suggested product, with an explicit approximate flag", () => {
    const result = buscarProductosDeTienda("lataffa", catalogo);
    expect(result.aproximada).toBe(true);
    expect(result.productos.map(p => p.id)).toEqual(["2", "1"]);
    const suggested = sugerenciasDeBusqueda("lataffa", catalogo).filter(s => s.tipo === "producto");
    expect(suggested.every(s => result.productos.some(p => p.id === s.valor))).toBe(true);
  });

  it("an exact result wins even if it is sold out and approximate products have stock", () => {
    const productos = [p({ id: "exact", name: "LATTAFA", stock: 0 }), p({ id: "other", name: "LATTAFAS", stock: 5 }), p({ id: "approx", name: "LATAFFA", stock: 5 })];
    const result = buscarProductosDeTienda("lattafa", productos);
    expect(result.aproximada).toBe(false);
    expect(result.productos.map(p => p.id)).toEqual(["exact", "other"]);
  });

  it("keeps every token mandatory and ignores accents", () => {
    expect(buscarProductosDeTienda("látaffa khamrah", catalogo).productos.map(p => p.id)).toEqual(["2"]);
    expect(buscarProductosDeTienda("lataffa tornillo", catalogo).productos).toEqual([]);
  });

  it("category labels and descriptions work in both inputs; descriptions are not fuzzed", () => {
    const productos = [p({ id: "tool", name: "ROTOPERCUTOR", category: "maquinas", description: "Para hormigón armado" })];
    const label = () => "Herramientas eléctricas";
    expect(buscarProductosDeTienda("electricas", productos, label).productos).toEqual(productos);
    expect(sugerenciasDeBusqueda("electricas", productos, { nombreCategoria: label }).some(s => s.tipo === "producto")).toBe(true);
    expect(buscarProductosDeTienda("hormigón", productos).productos).toEqual(productos);
    expect(buscarProductosDeTienda("hormigonx", productos).productos).toEqual([]);
  });

  it("blank queries preserve the merchant's order; unknown queries do not invent results", () => {
    expect(buscarProductosDeTienda("  ", catalogo).productos).toBe(catalogo);
    expect(buscarProductosDeTienda("zapatillas", catalogo)).toEqual({ productos: [], aproximada: false });
    expect(buscarProductosDeTienda("[[[", catalogo).productos).toEqual([]);
  });
});

describe("destinoSugerencia", () => {
  it("cada tipo lleva a donde corresponde", () => {
    expect(destinoSugerencia({ tipo: "producto", label: "X", valor: "abc" }, base))
      .toBe(`${base}/producto/abc`);
    expect(destinoSugerencia({ tipo: "categoria", label: "X", valor: "perfume_arabe" }, base))
      .toBe(`${base}/productos?cat=perfume_arabe`);
    expect(destinoSugerencia({ tipo: "marca", label: "X", valor: "ELF BAR" }, base))
      .toBe(`${base}/productos?q=ELF%20BAR`);
  });
});

describe("moverSeleccion", () => {
  it("baja y sube dentro de la lista", () => {
    expect(moverSeleccion(-1, 1, 3)).toBe(0);
    expect(moverSeleccion(0, 1, 3)).toBe(1);
    expect(moverSeleccion(2, -1, 3)).toBe(1);
  });

  it("pasarse por abajo vuelve a 'nada seleccionado', no al principio", () => {
    // Si no, con la primera opción marcada, Enter navega a algo que el
    // comprador no eligió en vez de buscar lo que escribió.
    expect(moverSeleccion(2, 1, 3)).toBe(-1);
  });

  it("subir desde 'nada' va al último", () => {
    expect(moverSeleccion(-1, -1, 3)).toBe(2);
  });

  it("sin opciones no hay nada que seleccionar", () => {
    expect(moverSeleccion(0, 1, 0)).toBe(-1);
    expect(moverSeleccion(-1, -1, 0)).toBe(-1);
  });
});
