import { readFileSync } from "node:fs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consultar = vi.fn();
vi.mock("@/lib/arcaPadron", () => ({ consultarPadron: (...a: unknown[]) => consultar(...a) }));

import { usePadronAutomatico } from "@/hooks/usePadronAutomatico";

const persona = { cuit: "30699999993", nombre: "ZZ DISTRIBUIDORA S.A.", condicionIva: "responsable_inscripto" };

describe("consulta automática al padrón al escribir un CUIT", () => {
  beforeEach(() => { vi.useFakeTimers(); consultar.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  const esperar = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(500); }); };

  it("consulta sola cuando el CUIT queda completo y válido, y completa con lo de ARCA", async () => {
    consultar.mockResolvedValue({ ok: true, persona, desdeCache: false });
    const onPersona = vi.fn();
    const { result, rerender } = renderHook(({ cuit }) => usePadronAutomatico("org", cuit, onPersona), { initialProps: { cuit: "" } });
    rerender({ cuit: "30-6999999" });
    await esperar();
    expect(consultar).not.toHaveBeenCalled();
    rerender({ cuit: "30-69999999-3" });
    await esperar();
    expect(consultar).toHaveBeenCalledWith("org", "30699999993");
    expect(onPersona).toHaveBeenCalledWith(persona);
    expect(result.current.estado).toMatchObject({ estado: "listo" });
  });

  it("no consulta un CUIT con el dígito verificador mal", async () => {
    const { rerender } = renderHook(({ cuit }) => usePadronAutomatico("org", cuit, vi.fn()), { initialProps: { cuit: "" } });
    rerender({ cuit: "30699999990" });
    await esperar();
    expect(consultar).not.toHaveBeenCalled();
  });

  it("no pisa una ficha abierta con su CUIT ni uno que llegó de elegir un cliente", async () => {
    consultar.mockResolvedValue({ ok: true, persona, desdeCache: true });
    const { result, rerender } = renderHook(({ cuit }) => usePadronAutomatico("org", cuit, vi.fn()), { initialProps: { cuit: "30699999993" } });
    await esperar();
    expect(consultar).not.toHaveBeenCalled();
    act(() => result.current.conocido("27222222228"));
    rerender({ cuit: "27222222228" });
    await esperar();
    expect(consultar).not.toHaveBeenCalled();
    act(() => result.current.reintentar());
    await esperar();
    expect(consultar).toHaveBeenCalledWith("org", "27222222228");
  });

  it("una respuesta vieja no pisa la del CUIT nuevo", async () => {
    let resolverPrimera: (v: unknown) => void = () => {};
    consultar.mockImplementationOnce(() => new Promise(r => { resolverPrimera = r; }))
      .mockResolvedValueOnce({ ok: true, persona: { ...persona, cuit: "27222222228", nombre: "PEREZ ANA" }, desdeCache: false });
    const onPersona = vi.fn();
    const { rerender } = renderHook(({ cuit }) => usePadronAutomatico("org", cuit, onPersona), { initialProps: { cuit: "" } });
    rerender({ cuit: "30699999993" });
    await esperar();
    rerender({ cuit: "27222222228" });
    await esperar();
    await act(async () => { resolverPrimera({ ok: true, persona, desdeCache: false }); });
    expect(onPersona).toHaveBeenCalledTimes(1);
    expect(onPersona.mock.calls[0][0].nombre).toBe("PEREZ ANA");
  });

  it("si ARCA no está habilitada lo dice con el código, sin tirar error", async () => {
    consultar.mockResolvedValue({ ok: false, error: "x", code: "servicio_no_asociado", pasos: "asociá" });
    const { result, rerender } = renderHook(({ cuit }) => usePadronAutomatico("org", cuit, vi.fn()), { initialProps: { cuit: "" } });
    rerender({ cuit: "30699999993" });
    await esperar();
    expect(result.current.estado).toMatchObject({ estado: "error", code: "servicio_no_asociado", pasos: "asociá" });
  });
});

describe("todos los campos de CUIT completan solos", () => {
  it.each([
    "src/components/customers/CustomerFiscalFields.tsx",
    "src/pages/InvoicesPage.tsx",
    "src/components/afip/AfipConfigForm.tsx",
    "src/components/afip/ComprobantesDeCompra.tsx",
    "src/components/afip/RetencionesSufridas.tsx",
    "src/pages/ProveedoresPage.tsx",
    "src/pages/TaxManagementPage.tsx",
    "src/pages/FinanceDocumentsPage.tsx",
  ])("%s usa la consulta automática", archivo => {
    const fuente = readFileSync(archivo, "utf8");
    expect(fuente).toContain("usePadronAutomatico(");
    expect(fuente).toContain("<EstadoDelPadron");
    expect(fuente).not.toContain("consultarPadron(");
  });

  it("el punto de venta da de alta clientes con los mismos campos fiscales", () => {
    expect(readFileSync("src/components/pos/PosCustomerPicker.tsx", "utf8")).toContain("<CustomerFiscalFields");
  });

  it("«Cómo habilitarla» lleva a una sección que existe en la página de ARCA", () => {
    expect(readFileSync("src/components/afip/EstadoDelPadron.tsx", "utf8")).toContain('to="/afip#consulta-cuit"');
    expect(readFileSync("src/components/afip/ConsultaDeCuit.tsx", "utf8")).toContain('id="consulta-cuit"');
    expect(readFileSync("src/pages/AFIPPage.tsx", "utf8")).toContain("<ConsultaDeCuit");
  });

  it("el proveedor se guarda aunque falte la columna del CUIT, y lo avisa", () => {
    const fuente = readFileSync("src/pages/ProveedoresPage.tsx", "utf8");
    expect(fuente).toContain("isMissingColumn(error)");
    expect(fuente).toContain("toast.warning(\"El CUIT no se guardó todavía");
  });
});
