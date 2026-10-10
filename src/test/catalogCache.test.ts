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
