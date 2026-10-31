import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumirVitales, type FilaVitales } from "@/lib/velocidadTienda";
import VelocidadDeTuTienda from "@/components/ecommerce/VelocidadDeTuTienda";

const m = vi.hoisted(() => ({ respuesta: { data: [] as unknown[] | null, error: null as unknown }, filtros: [] as string[][] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (columna: string, valor: string) => { m.filtros.push([tabla, "eq", columna, valor]); return q; };
      q.gte = (columna: string, valor: string) => { m.filtros.push([tabla, "gte", columna, valor]); return q; };
      q.limit = () => q;
      q.then = (resolver: (v: unknown) => unknown) => resolver(m.respuesta);
      return q;
    },
  },
}));

const fila = (metrica: string, pagina: string, buenas: number, regulares = 0, malas = 0): FilaVitales =>
  ({ metrica, pagina, buenas, regulares, malas });

beforeEach(() => {
  m.filtros.length = 0;
  m.respuesta = { data: [], error: null };
});

describe("velocidad de la tienda para el comercio", () => {
  it("pasa si cada medida tiene al menos 75% de visitas buenas", () => {
    const r = resumirVitales([
      fila("lcp", "inicio", 30, 5, 5), fila("lcp", "producto", 40, 0, 0),
      fila("inp", "inicio", 50, 0, 0),
      fila("cls", "productos", 45, 5, 0),
    ]);
    expect(r.metricas.map(x => [x.metrica, x.visitas, x.pctBuenas, x.estado])).toEqual([
      ["lcp", 80, 87.5, "pasa"], ["inp", 50, 100, "pasa"], ["cls", 50, 90, "pasa"],
    ]);
    expect(r.pasa).toBe(true);
  });

  it("dice qué medida no pasa y en qué página mirar", () => {
    const r = resumirVitales([
      fila("lcp", "inicio", 5, 10, 10), fila("lcp", "producto", 20, 0, 0),
      fila("inp", "inicio", 50), fila("cls", "inicio", 50),
    ]);
    expect(r.metricas[0]).toMatchObject({ metrica: "lcp", estado: "a_mejorar", peorPagina: "inicio", pctBuenas: 55.6 });
    expect(r.pasa).toBe(false);
  });

  it("con menos de 20 visitas no hay datos para decir", () => {
    const r = resumirVitales([fila("lcp", "inicio", 10), fila("inp", "inicio", 50), fila("cls", "inicio", 50)]);
    expect(r.metricas[0].estado).toBe("pocos_datos");
    expect(r.pasa).toBeNull();
  });

  it("la tarjeta lee 28 días de su negocio y muestra cada medida", async () => {
    m.respuesta = { data: [fila("lcp", "inicio", 5, 10, 10), fila("lcp", "producto", 20), fila("inp", "inicio", 50), fila("cls", "inicio", 50)], error: null };
    render(<VelocidadDeTuTienda orgId="zz-org" />);
    expect(await screen.findByText("A mejorar")).toBeVisible();
    expect(screen.getByText(/Achicá las fotos de la portada/)).toBeVisible();
    expect(screen.getByText(/Lo más lento es la portada/)).toBeVisible();
    expect(screen.getAllByText("100% buenas · 50 visitas")).toHaveLength(2);
    expect(m.filtros[0]).toEqual(["store_vitales", "eq", "org_id", "zz-org"]);
    expect(m.filtros[1][2]).toBe("dia");
    expect(m.filtros[1][3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sin visitas lo dice; con error lo avisa; sin la tabla no se muestra", async () => {
    const { unmount } = render(<VelocidadDeTuTienda orgId="zz-org" />);
    expect(await screen.findByText(/Todavía no hay visitas medidas/)).toBeVisible();
    unmount();
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    m.respuesta = { data: null, error: { code: "57014", message: "timeout" } };
    const otra = render(<VelocidadDeTuTienda orgId="zz-org" />);
    expect(await screen.findByText(/No pudimos leer la velocidad/)).toBeVisible();
    otra.unmount();
    consola.mockRestore();
    m.respuesta = { data: null, error: { code: "42P01", message: "relation \"store_vitales\" does not exist" } };
    const { container } = render(<VelocidadDeTuTienda orgId="zz-org" />);
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("está en el resumen de la tienda", () => {
    expect(readFileSync("src/pages/EcommerceStorePage.tsx", "utf8")).toContain("<VelocidadDeTuTienda orgId={orgId} />");
  });
});
