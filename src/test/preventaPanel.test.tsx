import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseStoreOrderItems } from "@/lib/storeOrderDetail";
import ProductPreventaSection from "@/components/products/ProductPreventaSection";

const m = vi.hoisted(() => ({
  producto: { data: { stock: -2, preventa_cupo: 5 } as Record<string, unknown> | null, error: null as unknown },
  variantes: { data: [] as unknown[], error: null as unknown },
  actualizaciones: [] as unknown[],
  error: vi.fn(),
  exito: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: m.error, success: m.exito } }));
vi.mock("@/lib/fechaAR", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fechaAR")>()),
  hoyAR: () => "2026-10-31",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => m.producto;
      q.then = (resolver: (v: unknown) => unknown) => resolver(tabla === "product_variants" ? m.variantes : m.producto);
      q.update = (valores: unknown) => { m.actualizaciones.push(valores); return { eq: async () => ({ error: null }) }; };
      return q;
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  m.actualizaciones.length = 0;
  m.producto = { data: { stock: -2, preventa_cupo: 5 }, error: null };
  m.variantes = { data: [], error: null };
});

describe("preventa en el panel", () => {
  it("dice hasta cuántas se venden sin stock, cuándo llegan y cuántas se deben", async () => {
    render(<ProductPreventaSection productId="zz" proximoIngreso="2026-11-20" />);
    expect(await screen.findByText("En preventa: se venden hasta 5 unidades sin stock, que llegan aprox. el 20/11.")).toBeVisible();
    expect(screen.getByText("Vendidas en preventa sin entregar: 2.")).toBeVisible();
  });

  it("sin próximo ingreso, o vencido, avisa que la preventa no está activa", async () => {
    const { unmount } = render(<ProductPreventaSection productId="zz" proximoIngreso="" />);
    expect(await screen.findByText(/Cargá el «Próximo ingreso»/)).toBeVisible();
    unmount();
    render(<ProductPreventaSection productId="zz" proximoIngreso="2026-10-01" />);
    expect(await screen.findByText(/El próximo ingreso ya pasó/)).toBeVisible();
  });

  it("guarda el cupo; vacío quita la preventa", async () => {
    render(<ProductPreventaSection productId="zz" proximoIngreso="2026-11-20" />);
    const campo = await screen.findByLabelText("Unidades en preventa");
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(m.exito).toHaveBeenCalledWith("El producto ya no se vende en preventa"));
    expect(m.actualizaciones).toEqual([{ preventa_cupo: 0 }]);
  });

  it("con variantes no se ofrece, y sin la columna en la base no se muestra", async () => {
    m.variantes = { data: [{ id: "v1", active: true }], error: null };
    const { unmount } = render(<ProductPreventaSection productId="zz" proximoIngreso="2026-11-20" />);
    expect(await screen.findByText("La preventa es para productos sin variantes.")).toBeVisible();
    expect(screen.queryByLabelText("Unidades en preventa")).not.toBeInTheDocument();
    unmount();
    m.variantes = { data: [], error: null };
    m.producto = { data: { stock: 3 }, error: null };
    const { container } = render(<ProductPreventaSection productId="zz" proximoIngreso="2026-11-20" />);
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("la ficha del pedido y el email dicen qué líneas son de preventa", () => {
    expect(parseStoreOrderItems([
      { name: "ZZ Consola", quantity: 4, unit_price: 1000, total: 4000, preventa: { cantidad: 2, llega: "2026-11-20" } },
      { name: "ZZ Joystick", quantity: 1, unit_price: 500, total: 500 },
    ])).toEqual([
      { name: "ZZ Consola", quantity: 4, unit_price: 1000, total: 4000, preventa: { cantidad: 2, llega: "2026-11-20" } },
      { name: "ZZ Joystick", quantity: 1, unit_price: 500, total: 500 },
    ]);
    expect(readFileSync("src/components/ecommerce/StoreOrderInspector.tsx", "utf8")).toContain("Despachalas cuando entre la mercadería.");
    expect(readFileSync("supabase/functions/store-order-email/index.ts", "utf8")).toContain("${esc(i.name)}${notaDePreventa(i)}");
    expect(readFileSync("src/pages/ProductsPage.tsx", "utf8"))
      .toContain("<ProductPreventaSection productId={product.id} proximoIngreso={expectedRestockAt} />");
  });
});
