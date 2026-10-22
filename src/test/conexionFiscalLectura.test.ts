import { describe, expect, it, vi } from "vitest";
import { conColumnasDelCertificado } from "@/lib/conexionFiscalLectura";

// Las migraciones van a mano: entre publicar y aplicar, una columna nueva no existe.
describe("estado fiscal sin la migración del certificado propio", () => {
  it("pide las columnas nuevas y, si no existen, repite sin ellas", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const leer = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column afip_connection_status.certificado_vence does not exist" } })
      .mockResolvedValueOnce({ data: { cuit: "1" }, error: null });
    const r = await conColumnasDelCertificado("cuit", "certificado_vence", leer);
    expect(leer).toHaveBeenNthCalledWith(1, "cuit, certificado_vence");
    expect(leer).toHaveBeenNthCalledWith(2, "cuit");
    expect(r).toEqual({ data: { cuit: "1" }, error: null });
  });

  it("un error que no es de columna no se esconde", async () => {
    const leer = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    const r = await conColumnasDelCertificado("cuit", "certificado_vence", leer);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(r.error?.code).toBe("42501");
  });
});
