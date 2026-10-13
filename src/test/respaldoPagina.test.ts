import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { leerPaginado, SNAPSHOT_PAGE_SIZE } from "../../supabase/functions/_shared/leerPaginado";

// PostgREST corta en 1000 filas aunque se pida más. El respaldo pedía todo de
// una vez, recibía 1000 y lo marcaba «truncado»: Famatina (5.500 productos) y
// Exentry quedaron sin respaldo válido (medido 2026-10-13).
function tablaFalsa(total: number, tope = 1000) {
  const filas = Array.from({ length: total }, (_, i) => ({ id: String(i).padStart(6, "0") }));
  const pedidos: Array<[number, number]> = [];
  const pagina = async (desde: number, hasta: number) => {
    pedidos.push([desde, hasta]);
    const pedidas = filas.slice(desde, hasta + 1);
    return { data: pedidas.slice(0, tope), error: null, count: desde === 0 ? total : null };
  };
  return { pagina, pedidos };
}

describe("el respaldo lee todas las filas, de a páginas", () => {
  it("una tabla de 5.500 filas sale completa, no cortada en 1000", async () => {
    const { pagina, pedidos } = tablaFalsa(5_500);
    const r = await leerPaginado(pagina, 50_000);
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(5_500);
    expect(r.count).toBe(5_500);
    expect(pedidos.length).toBe(6);
    expect(pedidos.every(([d, h]) => h - d + 1 <= SNAPSHOT_PAGE_SIZE)).toBe(true);
  });

  it("una tabla de exactamente 1000 filas pide una página más y termina", async () => {
    const { pagina, pedidos } = tablaFalsa(1_000);
    const r = await leerPaginado(pagina, 50_000);
    expect(r.rows).toHaveLength(1_000);
    expect(pedidos).toHaveLength(2);
  });

  it("no pasa del tope + 1: así el respaldo se entera de que excede el límite", async () => {
    const { pagina } = tablaFalsa(3_500);
    const r = await leerPaginado(pagina, 2_000);
    expect(r.rows).toHaveLength(2_001);
  });

  it("un error en una página corta y se informa", async () => {
    const r = await leerPaginado(async (desde) => (
      desde === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null, count: 3000 }
        : { data: null, error: { code: "57014" }, count: null }
    ), 50_000);
    expect(r.error).toEqual({ code: "57014" });
  });

  it("si una inserción corre el offset, no duplica filas", async () => {
    let llamada = 0;
    const r = await leerPaginado(async () => {
      llamada += 1;
      if (llamada === 1) return { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null, count: 1001 };
      return { data: [{ id: 999 }, { id: 1000 }], error: null, count: null };
    }, 50_000);
    expect(r.rows.map(f => f.id)).toHaveLength(1001);
  });

  it("las dos lecturas del respaldo (directa e hijas) paginan ordenando por id", () => {
    const s = fs.readFileSync("supabase/functions/_shared/organizationSnapshot.ts", "utf8");
    expect(s.match(/leerPaginado\(\s*\(desde, hasta\) => admin/g)).toHaveLength(2);
    expect(s.match(/\.order\("id", \{ ascending: true \}\)\s*\.range\(desde, hasta\)/g)).toHaveLength(2);
    expect(s).not.toContain(".limit(MAX_ROWS_PER_TABLE + 1)");
  });
});
