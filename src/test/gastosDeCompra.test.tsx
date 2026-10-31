import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aDatosDeGasto, costoPuesto, etiquetaDeGasto, formularioGastoVacio, numeroDeTexto, problemasDelGasto,
  recargoDeLosGastos, textoDelReparto,
} from "@/lib/gastosDeCompra";
import GastosDeLaCompra from "@/components/compras/GastosDeLaCompra";

const m = vi.hoisted(() => ({
  gastos: { data: [] as unknown[] | null, error: null as unknown },
  rpc: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = () => q;
      q.then = (resolver: (v: unknown) => unknown) =>
        resolver(tabla === "compra_gastos" ? m.gastos : { data: [{ id: "prov-1", name: "ZZ Despachante" }], error: null });
      return q;
    },
    rpc: (...args: unknown[]) => m.rpc(...args),
  },
}));

const gasto = (parte: Record<string, unknown> = {}) => ({
  id: "g1", compra_id: "c1", concepto: "flete", detalle: null, reparto: "valor", moneda: "USD", monto: 40, impuestos: 0,
  monto_ars: 40000, pago: "pagado", proveedor: "ZZ Forwarder", comprobante: null, fecha: "2026-10-20", ...parte,
});

beforeEach(() => {
  m.gastos = { data: [], error: null };
  m.rpc.mockReset();
  m.toast.success.mockReset();
  m.toast.error.mockReset();
});

describe("gastos de la compra: lo que se arma en la pantalla", () => {
  it("lee montos como se escriben en Argentina", () => {
    expect(numeroDeTexto("1.234,50")).toBe(1234.5);
    expect(numeroDeTexto("1.500")).toBe(1500);
    expect(numeroDeTexto("12.5")).toBe(12.5);
    expect(numeroDeTexto("120000")).toBe(120000);
    expect(numeroDeTexto(" 40 ")).toBe(40);
    expect(numeroDeTexto("")).toBeNull();
    expect(numeroDeTexto("-3")).toBeNull();
    expect(numeroDeTexto("abc")).toBeNull();
  });

  it("dice lo que la base rechazaría", () => {
    const f = formularioGastoVacio("2026-10-31");
    expect(problemasDelGasto(f)).toEqual(["Cargá el monto sin IVA."]);
    expect(problemasDelGasto({ ...f, monto: "100", concepto: "otro" })).toEqual(["Contá qué es el gasto."]);
    expect(problemasDelGasto({ ...f, monto: "100", moneda: "USD" })).toEqual(["Para un gasto en dólares cargá la cotización."]);
    expect(problemasDelGasto({ ...f, monto: "100", pago: "a_pagar" })).toEqual(["Para dejarlo a pagar, elegí a quién."]);
    expect(problemasDelGasto({ ...f, monto: "100", impuestos: "x" })).toEqual(["El IVA y las percepciones tienen que ser un número."]);
    expect(problemasDelGasto({ ...f, monto: "100", pago: "a_pagar", proveedor: "ZZ Despachante" })).toEqual([]);
  });

  it("manda el monto sin IVA aparte de los impuestos, y el medio o el vencimiento según el pago", () => {
    const f = { ...formularioGastoVacio("2026-10-31"), concepto: "despachante" as const, monto: "12.000", impuestos: "2.520",
      pago: "a_pagar" as const, proveedorId: "prov-1", vencimiento: "2026-11-30", reparto: "cantidad" as const };
    expect(aDatosDeGasto(f)).toMatchObject({
      concepto: "despachante", monto: 12000, impuestos: 2520, reparto: "cantidad", pago: "a_pagar", medio: null,
      proveedor_id: "prov-1", vencimiento: "2026-11-30", actualizar_costos: true, fecha: "2026-10-31",
    });
    expect(aDatosDeGasto({ ...f, pago: "pagado" })).toMatchObject({ medio: "transferencia", vencimiento: null });
  });

  it("costo puesto y recargo sobre lo comprado", () => {
    expect(costoPuesto({ quantity: 10, total_ars: 100000, gastos_ars: 16000 })).toBe(11600);
    expect(costoPuesto({ quantity: 3, total_ars: 100, gastos_ars: 33.34 })).toBe(44.45);
    expect(costoPuesto({ quantity: 0, total_ars: 100, gastos_ars: 1 })).toBe(0);
    expect(recargoDeLosGastos(400000, 64000)).toBe(16);
    expect(recargoDeLosGastos(0, 10)).toBeNull();
    expect(etiquetaDeGasto({ concepto: "otro", detalle: "Certificado de origen" })).toBe("Certificado de origen");
    expect(etiquetaDeGasto({ concepto: "flete", detalle: "courier" })).toBe("Flete (courier)");
  });

  it("el aviso cuenta qué costos cambiaron y por qué otros no", () => {
    expect(textoDelReparto({ costos_actualizados: 2 }, true)).toBe("Se actualizó el costo de 2 productos.");
    expect(textoDelReparto({ costos_actualizados: 1, con_compra_posterior: 1, sin_cotizacion: 2 }, true)).toBe(
      "Se actualizó el costo de 1 producto. 1 producto tiene una compra posterior y conserva ese costo. "
      + "2 productos con costo en dólares no se actualizaron: falta la cotización.");
    expect(textoDelReparto({ costos_actualizados: 0 }, false)).toBe("Los costos de los productos quedaron como estaban.");
  });
});

describe("gastos de la compra: la sección del detalle", () => {
  it("lista los gastos con el total y el recargo sobre lo comprado", async () => {
    m.gastos = { data: [gasto(), gasto({ id: "g2", concepto: "despachante", moneda: "ARS", monto: 12000, impuestos: 2520, monto_ars: 12000, pago: "a_pagar", proveedor: "ZZ Despachante" })], error: null };
    render(<GastosDeLaCompra orgId="o1" compraId="c1" totalCompraArs={400000} puedeEditar onCambio={() => {}} />);
    expect(await screen.findByText("Flete")).toBeVisible();
    expect(screen.getByText("Despachante")).toBeVisible();
    expect(screen.getByText(/de impuestos/)).toBeVisible();
    expect(screen.getByTestId("total-gastos-de-la-compra").textContent).toMatch(/13% sobre lo comprado/);
  });

  it("sin la tabla (migración sin aplicar) no se muestra; con otro error lo avisa", async () => {
    m.gastos = { data: null, error: { code: "42P01", message: "relation \"compra_gastos\" does not exist" } };
    const { container, unmount } = render(<GastosDeLaCompra orgId="o1" compraId="c1" totalCompraArs={1} puedeEditar onCambio={() => {}} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    unmount();
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    m.gastos = { data: null, error: { code: "57014", message: "timeout" } };
    render(<GastosDeLaCompra orgId="o1" compraId="c1" totalCompraArs={1} puedeEditar onCambio={() => {}} />);
    expect(await screen.findByText(/No pudimos leer los gastos/)).toBeVisible();
    consola.mockRestore();
  });

  it("agrega un gasto, avisa qué costos cambió y recarga la compra", async () => {
    m.rpc.mockResolvedValue({ data: { gasto_id: "g9", costos_actualizados: 2 }, error: null });
    const onCambio = vi.fn();
    render(<GastosDeLaCompra orgId="o1" compraId="c1" totalCompraArs={400000} puedeEditar onCambio={onCambio} />);
    fireEvent.click(await screen.findByRole("button", { name: /Agregar gasto/ }));
    const agregar = screen.getAllByRole("button", { name: /Agregar gasto/ }).at(-1)!;
    expect(agregar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Monto sin IVA"), { target: { value: "40.000" } });
    fireEvent.click(agregar);
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("agregar_gasto_a_compra", expect.objectContaining({
      p_org: "o1", p_compra: "c1", p_datos: expect.objectContaining({ concepto: "flete", monto: 40000, pago: "pagado", reparto: "valor" }),
    })));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
    expect(m.toast.success).toHaveBeenCalledWith("Gasto agregado", { description: "Se actualizó el costo de 2 productos." });
  });

  it("si la base todavía no tiene la función, lo dice en castellano", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    render(<GastosDeLaCompra orgId="o1" compraId="c1" totalCompraArs={1} puedeEditar onCambio={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Agregar gasto/ }));
    fireEvent.change(screen.getByLabelText("Monto sin IVA"), { target: { value: "10" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Agregar gasto/ }).at(-1)!);
    await waitFor(() => expect(m.toast.error).toHaveBeenCalledWith("Los gastos de la compra todavía no están habilitados en este negocio."));
  });

  it("quita un gasto confirmando; sin permiso no hay botones", async () => {
    m.gastos = { data: [gasto()], error: null };
    m.rpc.mockResolvedValue({ data: { costos_actualizados: 1 }, error: null });
    const onCambio = vi.fn();
    const { unmount } = render(<GastosDeLaCompra orgId="o1" compraId="c1" totalCompraArs={400000} puedeEditar onCambio={onCambio} />);
    fireEvent.click(await screen.findByRole("button", { name: "Quitar Flete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Quitar gasto" }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("quitar_gasto_de_compra", { p_org: "o1", p_gasto: "g1" }));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
    unmount();
    render(<GastosDeLaCompra orgId="o1" compraId="c1" totalCompraArs={400000} puedeEditar={false} onCambio={() => {}} />);
    expect(await screen.findByText("Flete")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Agregar gasto|Quitar/ })).toBeNull();
  });
});

describe("gastos de la compra: la base", () => {
  const migracion = readFileSync("supabase/migrations/20261031000100_gastos_de_compra.sql", "utf8");

  it("sólo el dueño o un administrador escriben, y sólo por las funciones", () => {
    expect(migracion).toContain("REVOKE ALL ON public.compra_gastos FROM PUBLIC, anon, authenticated;");
    expect(migracion).toContain("GRANT SELECT ON public.compra_gastos TO authenticated;");
    expect(migracion.match(/has_org_role\(p_org, auth\.uid\(\), ARRAY\['owner', 'admin'\]\)/g)).toHaveLength(3);
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.repartir_gastos_de_compra(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;");
  });

  it("los gastos no van a Gastos: se registran como la compra", () => {
    expect(migracion).not.toMatch(/INSERT INTO public\.expenses/);
    expect(migracion).toContain("'supplier_payment'");
    expect(migracion).toContain("v_monto_ars + v_impuestos_ars");
  });

  it("anular la compra se lleva los gastos y la matriz corre en el simulacro", () => {
    expect(migracion).toContain("DELETE FROM public.compra_gastos WHERE org_id = p_org AND compra_id = p_compra;");
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8")).toContain("'20261031000100': 'scripts/gastos-de-compra-matrix.sql'");
  });

  it("está en el detalle de la compra", () => {
    const pagina = readFileSync("src/pages/PurchasesPage.tsx", "utf8");
    expect(pagina).toContain("<GastosDeLaCompra orgId={activeOrg.id} compraId={detalle.id}");
    expect(pagina).toContain("Costo puesto");
  });
});
