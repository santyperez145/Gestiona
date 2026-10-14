import { describe, expect, it, vi } from "vitest";
import { MARGEN_MS, RESYNC_COMPLETO_MS, sincronizarCatalogo, type AlmacenCatalogo, type GuardadoCatalogo } from "@/lib/catalogCache";

type Fila = { id: string; name: string; updated_at: string };
const memoria = () => {
  const datos = new Map<string, GuardadoCatalogo<Fila>>();
  const almacen: AlmacenCatalogo<Fila> = { leer: async k => datos.get(k) ?? null, guardar: async (k, v) => { datos.set(k, v); } };
  return { datos, almacen };
};
const fila = (id: string, updated_at: string, name = id): Fila => ({ id, name, updated_at });

describe("catálogo con caché incremental", () => {
  it("la primera vez lee todo y después sólo los cambios desde el último visto menos el margen", async () => {
    const { almacen } = memoria();
    const leerTodo = vi.fn(async () => [fila("a", "2026-10-10T10:00:00Z"), fila("b", "2026-10-10T11:00:00Z")]);
    const leerCambiosDesde = vi.fn(async () => [fila("b", "2026-10-10T12:00:00Z", "B nuevo")]);
    const fuentes = { leerTodo, leerCambiosDesde, contar: async () => 2, leerIds: async () => ["a", "b"] };
    const t0 = Date.parse("2026-10-10T12:00:00Z");

    expect((await sincronizarCatalogo("k", fuentes, almacen, t0)).modo).toBe("completo");
    const segunda = await sincronizarCatalogo("k", fuentes, almacen, t0 + 60_000);
    expect(segunda.modo).toBe("incremental");
    expect(leerTodo).toHaveBeenCalledTimes(1);
    expect(leerCambiosDesde).toHaveBeenCalledWith(new Date(Date.parse("2026-10-10T11:00:00Z") - MARGEN_MS).toISOString());
    expect(segunda.filas.find(f => f.id === "b")?.name).toBe("B nuevo");
  });

  it("quita los borrados cuando el conteo no coincide", async () => {
    const { almacen } = memoria();
    let todo = [fila("a", "2026-10-10T10:00:00Z"), fila("b", "2026-10-10T10:00:00Z")];
    const fuentes = { leerTodo: async () => todo, leerCambiosDesde: async () => [], contar: async () => todo.length, leerIds: async () => todo.map(f => f.id) };
    await sincronizarCatalogo("k", fuentes, almacen, 0 + 1);
    todo = [todo[0]];
    const r = await sincronizarCatalogo("k", fuentes, almacen, 2);
    expect(r.filas.map(f => f.id)).toEqual(["a"]);
  });

  it("resincroniza completo cada 6 horas y funciona sin almacenamiento", async () => {
    const { almacen } = memoria();
    const leerTodo = vi.fn(async () => [fila("a", "2026-10-10T10:00:00Z")]);
    const fuentes = { leerTodo, leerCambiosDesde: async () => [], contar: async () => 1, leerIds: async () => ["a"] };
    await sincronizarCatalogo("k", fuentes, almacen, 0);
    await sincronizarCatalogo("k", fuentes, almacen, RESYNC_COMPLETO_MS + 1);
    expect(leerTodo).toHaveBeenCalledTimes(2);
    expect((await sincronizarCatalogo("k", fuentes, null)).modo).toBe("completo");
  });
});

// 2026-10-14: «con más de 1.000 productos la plataforma se vuelve súper lenta y
// se cae». Cada pantalla releía y reescribía el catálogo entero (7,1 MB con
// 5.500 productos), tenía su propia copia y, después de una importación,
// re-bajaba enteros todos los productos tocados en los últimos 10 minutos.
describe("catálogo grande: una copia, sólo lo que cambió", () => {
  it("lo incremental pide versiones y baja completos sólo los que cambiaron", async () => {
    const { almacen } = memoria();
    const base = Array.from({ length: 1000 }, (_, i) => fila(`p${i}`, "2026-10-10T10:00:00Z"));
    const leerPorIds = vi.fn(async (ids: string[]) => ids.map(id => fila(id, "2026-10-10T12:00:00Z", `${id} nuevo`)));
    const fuentes = {
      leerTodo: async () => base,
      leerCambiosDesde: vi.fn(async () => base),
      contar: async () => 1000,
      leerIds: async () => base.map(f => f.id),
      // Una importación tocó 1.000 en la ventana, pero sólo 2 cambiaron de verdad.
      leerVersionesDesde: async () => base.map(f => ({ id: f.id, updated_at: f.id === "p3" || f.id === "p7" ? "2026-10-10T12:00:00Z" : f.updated_at })),
      leerPorIds,
    };
    await sincronizarCatalogo("k", fuentes, almacen, Date.parse("2026-10-10T12:00:00Z"));
    const r = await sincronizarCatalogo("k", fuentes, almacen, Date.parse("2026-10-10T12:01:00Z"));
    expect(leerPorIds).toHaveBeenCalledTimes(1);
    expect(leerPorIds.mock.calls[0][0]).toEqual(["p3", "p7"]);
    expect(fuentes.leerCambiosDesde).not.toHaveBeenCalled();
    expect(r.filas.find(f => f.id === "p3")?.name).toBe("p3 nuevo");
  });

  it("sin cambios devuelve la misma copia y no reescribe el almacenamiento", async () => {
    const { almacen } = memoria();
    const guardar = vi.spyOn(almacen, "guardar");
    const fuentes = { leerTodo: async () => [fila("a", "2026-10-10T10:00:00Z")], leerCambiosDesde: async () => [], contar: async () => 1, leerIds: async () => ["a"] };
    const t0 = Date.parse("2026-10-10T12:00:00Z");
    const primera = await sincronizarCatalogo("k", fuentes, almacen, t0);
    const segunda = await sincronizarCatalogo("k", fuentes, almacen, t0 + 1000);
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(segunda.filas).toBe(primera.filas);
  });

  it("una copia por pestaña: la segunda pantalla no vuelve a leer el almacenamiento", async () => {
    const { almacenConMemoria } = await import("@/lib/catalogCache");
    const { almacen } = memoria();
    await almacen.guardar("k", { filas: [fila("a", "x")], maxUpdatedAt: "x", completoAt: 1, version: 1 });
    const leer = vi.spyOn(almacen, "leer");
    const compartido = almacenConMemoria(almacen, new Map());
    const a = await compartido.leer("k");
    const b = await compartido.leer("k");
    expect(leer).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("pedidos simultáneos comparten una sola sincronización", async () => {
    const { unaVezALaVez } = await import("@/lib/catalogCache");
    let corridas = 0;
    const trabajo = async () => { corridas += 1; await new Promise(r => setTimeout(r, 5)); return corridas; };
    const resultados = await Promise.all([unaVezALaVez("k", trabajo), unaVezALaVez("k", trabajo), unaVezALaVez("k", trabajo)]);
    expect(corridas).toBe(1);
    expect(resultados).toEqual([1, 1, 1]);
    expect(await unaVezALaVez("k", trabajo)).toBe(2);
  });

  it("getProductsDB usa la copia compartida y versiones livianas", async () => {
    const fs = await import("node:fs");
    const store = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");
    expect(store).toContain("unaVezALaVez(clave, () => sincronizarProductos(clave, orgId))");
    expect(store).toContain("almacenConMemoria(almacenIndexedDb<ProductRow>())");
    expect(store).toContain(".select('id, updated_at')");
    expect(store).toContain("return ordenadas.slice();");
  });
});
