import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NAV_ITEMS, NAV_GROUPS, ITEMS_DIARIOS, GRUPOS_PLEGABLES,
  itemsDe, grupoDeRuta, buscarItems, normalizar,
} from "@/lib/navigation";

/**
 * La reorganización sólo es segura si no se pierde ningún destino y si el
 * buscador conoce los nombres viejos. Esto verifica las dos cosas.
 */
describe("estructura de la navegación", () => {
  it("no hay rutas duplicadas", () => {
    const rutas = NAV_ITEMS.map(i => i.to);
    expect(new Set(rutas).size).toBe(rutas.length);
  });

  it("todo item cae en un grupo declarado", () => {
    const grupos = new Set(NAV_GROUPS.map(g => g.id));
    for (const i of NAV_ITEMS) {
      expect(grupos.has(i.group), `${i.to} en grupo desconocido "${i.group}"`).toBe(true);
    }
  });

  it("todo grupo tiene al menos un item: uno vacío es un encabezado sin nada abajo", () => {
    for (const g of NAV_GROUPS) {
      expect(itemsDe(g.id).length, `grupo ${g.id} vacío`).toBeGreaterThan(0);
    }
  });

  it("los ids de grupo son únicos: el sidebar los usa como claves React", () => {
    const ids = NAV_GROUPS.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo item declara al menos un rol, o no lo ve nadie", () => {
    for (const i of NAV_ITEMS) {
      expect(i.roles.length, `${i.to} sin roles`).toBeGreaterThan(0);
    }
  });

  it("toda ruta empieza con barra", () => {
    for (const i of NAV_ITEMS) expect(i.to.startsWith("/"), i.to).toBe(true);
  });

  // El sidebar deja estos seis siempre visibles. Si crecen, vuelve el problema
  // que esta reorganización viene a resolver.
  it("el bloque diario se mantiene chico y Commerce va primero después de Inicio", () => {
    expect(ITEMS_DIARIOS.length).toBeLessThanOrEqual(7);
    expect(ITEMS_DIARIOS.map(i => i.to).slice(0, 3)).toEqual(["/", "/tienda-online", "/caja"]);
    expect(ITEMS_DIARIOS.map(i => i.to)).toContain("/caja");
  });

  it("los grupos plegables no incluyen el diario", () => {
    expect(GRUPOS_PLEGABLES.map(g => g.id)).not.toContain("diario");
  });

  it("cada ruta resuelve a su grupo", () => {
    expect(grupoDeRuta("/caja")).toBe("diario");
    expect(grupoDeRuta("/envios")).toBe("commerce");
    expect(grupoDeRuta("/cupones")).toBe("commerce");
    expect(grupoDeRuta("/kardex")).toBe("compras");
    expect(grupoDeRuta("/no-existe")).toBeNull();
  });

  it("Tienda y canales va primero entre los plegables", () => {
    expect(GRUPOS_PLEGABLES[0]?.id).toBe("commerce");
    expect(itemsDe("commerce").map(i => i.to)).toEqual(
      expect.arrayContaining(["/envios", "/cupones", "/promociones"]),
    );
  });

  it("ordena Commerce por flujo operativo", () => {
    expect(itemsDe("commerce").map(i => i.to)).toEqual([
      "/envios",
      "/links-de-pago",
      "/cupones",
      "/promociones",
    ]);
  });

  it("ordena Trabajo por uso diario", () => {
    expect(itemsDe("trabajo").map(i => i.to)).toEqual([
      "/tareas",
      "/calendario",
    ]);
  });

  it("ordena Compras por pipeline de inventario", () => {
    expect(itemsDe("compras").map(i => i.to)).toEqual([
      "/compras",
      "/ordenes-compra",
      "/proveedores",
      "/planificacion",
      "/kardex",
      "/transferencias",
      "/sucursales",
      "/lotes",
      "/bundles",
      "/listas-precios",
      "/valuacion-inventario",
    ]);
  });

  it("ordena Cobranzas por documento", () => {
    expect(itemsDe("cobranzas").map(i => i.to)).toEqual([
      "/deudas",
      "/presupuestos",
      "/cuotas",
      "/facturas",
      "/devoluciones",
    ]);
  });

  it("ordena Finanzas por ciclo de autoridad", () => {
    expect(itemsDe("finanzas").map(i => i.to)).toEqual([
      "/billetera",
      "/movimientos",
      "/cash-flow",
      "/pl-dashboard",
      "/libro",
      "/banco",
      "/gastos",
      "/comisiones",
      "/impuestos",
      "/afip",
      "/multi-divisa",
      "/cheques",
      "/suscripciones",
    ]);
  });

  it("ordena Marketing por canal de conversión", () => {
    expect(itemsDe("marketing").map(i => i.to)).toEqual([
      "/marketing",
      "/email-campaigns",
      "/whatsapp-campaigns",
      "/fidelidad",
      "/catalogo",
      "/influencers",
      "/canjes",
      "/afiliados",
      "/referidos",
    ]);
  });

  it("ordena Reportes por lectura de negocio", () => {
    expect(itemsDe("reportes").map(i => i.to)).toEqual([
      "/reportes",
      "/analytics",
      "/ia",
    ]);
  });

  it("ordena Sistema con operación antes de configuración profunda", () => {
    expect(itemsDe("sistema").map(i => i.to).slice(0, 4)).toEqual([
      "/alertas",
      "/integraciones",
      "/equipo",
      "/ajustes",
    ]);
  });

  it("ordena Sistema con estructura completa", () => {
    expect(itemsDe("sistema").map(i => i.to)).toEqual([
      "/alertas",
      "/integraciones",
      "/equipo",
      "/ajustes",
      "/admin",
      "/calidad-datos",
      "/mi-plan",
      "/perfil",
    ]);
  });
});

describe("normalizar", () => {
  it("saca acentos y mayúsculas: nadie pone tildes cuando busca rápido", () => {
    expect(normalizar("Presupuéstos")).toBe("presupuestos");
    expect(normalizar("  Órdenes  ")).toBe("ordenes");
    expect(normalizar("FACTURACIÓN")).toBe("facturacion");
  });
});

describe("buscador de la paleta", () => {
  it("encuentra por el nombre visible", () => {
    expect(buscarItems("productos")[0].to).toBe("/productos");
  });

  it("encuentra sin tildes", () => {
    expect(buscarItems("ordenes")[0].to).toBe("/ordenes-compra");
  });

  // Ésta es la garantía que hace seguro renombrar: quien sabía la jerga vieja
  // tiene que seguir llegando.
  it("encuentra por el nombre VIEJO que se dejó de mostrar", () => {
    expect(buscarItems("kardex").map(i => i.to)).toContain("/kardex");
    expect(buscarItems("pos").map(i => i.to)).toContain("/caja");
    // /rfm es alias desde la consolidación CRM: quien busca la jerga vieja
    // llega al workspace de Clientes, donde vive la vista Segmentos.
    expect(buscarItems("rfm").map(i => i.to)).toContain("/clientes");
    expect(buscarItems("p&l").map(i => i.to)).toContain("/pl-dashboard");
    expect(buscarItems("bundles").map(i => i.to)).toContain("/bundles");
    expect(buscarItems("ecommerce").map(i => i.to)).toContain("/tienda-online");
  });

  it("encuentra por cómo lo diría alguien que no conoce el sistema", () => {
    expect(buscarItems("me deben").map(i => i.to)).toContain("/deudas");
    expect(buscarItems("cobrar").map(i => i.to)).toContain("/caja");
    expect(buscarItems("dolar").map(i => i.to)).toContain("/multi-divisa");
  });

  // Si "ventas" devolviera primero Reportes porque lo tiene en las keywords, el
  // buscador sería peor que el menú.
  it("el nombre pesa más que la palabra clave", () => {
    expect(buscarItems("ventas")[0].to).toBe("/ventas");
    expect(buscarItems("clientes")[0].to).toBe("/clientes");
  });

  it("sin consulta devuelve todo, y filtra por rol", () => {
    expect(buscarItems("")).toHaveLength(NAV_ITEMS.length);
    const deVendedor = buscarItems("", "vendedor");
    expect(deVendedor.length).toBeLessThan(NAV_ITEMS.length);
    expect(deVendedor.every(i => i.roles.includes("vendedor"))).toBe(true);
    // Un vendedor no tiene por qué ver Finanzas.
    expect(deVendedor.map(i => i.to)).not.toContain("/banco");
  });

  it("una consulta sin resultados devuelve vacío en vez de todo", () => {
    expect(buscarItems("xyzabc123")).toEqual([]);
  });

  // Todo destino tiene que ser alcanzable escribiendo su propio nombre: si uno
  // no se encuentra ni así, quedó huérfano.
  it("todos los destinos se encuentran por su nombre", () => {
    for (const i of NAV_ITEMS) {
      const r = buscarItems(i.label).map(x => x.to);
      expect(r, `no se encuentra "${i.label}"`).toContain(i.to);
    }
  });
});

describe("atajo Alt+2 respeta el canal", () => {
  it("el vendedor de mostrador sigue en POS; el resto entra por Commerce", () => {
    const layout = readFileSync(resolve(process.cwd(), "src/components/AppLayout.tsx"), "utf8");
    expect(layout).toContain('role === "vendedor" || activeOrg?.onboarding_goal === "pos"');
    expect(layout).toContain('? "/caja"');
    expect(layout).toContain(': "/tienda-online"');
    expect(layout).not.toMatch(/"2": "\/caja"/);
  });
});
