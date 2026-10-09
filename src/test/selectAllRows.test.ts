import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rangosUuid, selectAllRows, type ConsultaPorRango } from "@/lib/selectAllRows";

const hex = "0123456789abcdef";
const uuid = (n: number) => {
  const h = n.toString(16).padStart(32, "0").split("").reverse().join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Simula PostgREST: filtra por rango, ordena por id y corta en `limite`. */
function tabla(ids: string[]): { consulta: ConsultaPorRango<{ id: string }>; llamadas: number } {
  const ordenados = [...ids].sort();
  const estado = { llamadas: 0, consulta: null as unknown as ConsultaPorRango<{ id: string }> };
  estado.consulta = async ({ desde, hasta, despues, limite }) => {
    estado.llamadas += 1;
    const data = ordenados.filter(id => id >= desde && (!hasta || id < hasta) && (!despues || id > despues)).slice(0, limite).map(id => ({ id }));
    return { data, error: null };
  };
  return estado;
}

describe("lectura completa por rangos de UUID", () => {
  it("cubre todo el espacio en 16 rangos contiguos", () => {
    const rangos = rangosUuid();
    expect(rangos).toHaveLength(16);
    rangos.slice(0, -1).forEach((r, i) => expect(r.hasta).toBe(rangos[i + 1].desde));
    expect(rangos.at(-1)!.hasta).toBeNull();
    expect([...hex].every((d, i) => rangos[i].desde.startsWith(d))).toBe(true);
  });

  it("un catálogo chico usa una sola consulta", async () => {
    const t = tabla(Array.from({ length: 59 }, (_, i) => uuid(i * 7919)));
    expect(await selectAllRows(t.consulta)).toHaveLength(59);
    expect(t.llamadas).toBe(1);
  });

  it("trae 11.000 filas sin duplicar ni perder ninguna, superando el tope de página", async () => {
    const ids = Array.from({ length: 11_000 }, (_, i) => uuid(i * 2654435761));
    const t = tabla(ids);
    const filas = await selectAllRows(t.consulta, 1000);
    expect(filas).toHaveLength(11_000);
    expect(new Set(filas.map(f => f.id)).size).toBe(11_000);
  });

  it("propaga el error en lugar de devolver una lista parcial", async () => {
    const consulta: ConsultaPorRango<{ id: string }> = async () => ({ data: null, error: new Error("ZZ red") });
    await expect(selectAllRows(consulta)).rejects.toThrow("ZZ red");
  });

  it("Productos no vuelve a leer ventas o variantes con el tope silencioso", () => {
    const page = readFileSync("src/pages/ProductsPage.tsx", "utf8");
    expect(page).not.toContain("getVariantsByUserDB(user.id)");
    expect(page).toContain("selectAllRows<{ id: string; product_id: string | null; quantity: number | null; date: string }>");
  });
});
