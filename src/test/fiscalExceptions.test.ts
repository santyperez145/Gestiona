import { describe, expect, it } from "vitest";
import { grupoPendienteFiscal, resumenPendientesFiscales, type ComprobantePendienteFiscal } from "@/lib/fiscalExceptions";
import { resumirRechazoArca } from "../../supabase/functions/_shared/arcaRechazos";

const base: ComprobantePendienteFiscal = { status: "draft", cae: null, tipo_comprobante: 6, afip_status: null, afip_error: null };
const con = (cambios: Partial<ComprobantePendienteFiscal>) => ({ ...base, ...cambios });
const rechazo = (code: number) => resumirRechazoArca([], [{ code, msg: "" }]).mensaje;

describe("bandeja de pendientes fiscales", () => {
  it("excluye comprobantes no fiscales, autorizados o anulados", () => {
    expect(grupoPendienteFiscal(con({ tipo_comprobante: null }))).toBeNull();
    expect(grupoPendienteFiscal(con({ cae: "41124599989845", afip_status: "authorized" }))).toBeNull();
    expect(grupoPendienteFiscal(con({ status: "canceled", afip_status: "rejected" }))).toBeNull();
    expect(grupoPendienteFiscal(con({ afip_status: "not_applicable" }))).toBeNull();
  });

  it("distingue listos para autorizar de los que esperan conciliación", () => {
    expect(grupoPendienteFiscal(base)).toBe("sin_autorizar");
    expect(grupoPendienteFiscal(con({ afip_status: "pending" }))).toBe("sin_autorizar");
    expect(grupoPendienteFiscal(con({ afip_status: "processing" }))).toBe("en_verificacion");
  });

  it.each([
    [10013, "datos_cliente"],
    [10246, "datos_cliente"],
    [10096, "conexion"],
    [10048, "importes"],
    [10041, "importes"],
    [10192, "contador"],
    [10016, "reintentar"],
  ])("agrupa el rechazo %s por la acción que necesita", (code, grupo) => {
    expect(grupoPendienteFiscal(con({ afip_status: "rejected", afip_error: rechazo(code) }))).toBe(grupo);
  });

  it("usa el estado cuando el mensaje es anterior al catálogo", () => {
    expect(grupoPendienteFiscal(con({ afip_status: "config_error", afip_error: "Error de credenciales AFIP" }))).toBe("conexion");
    expect(grupoPendienteFiscal(con({ afip_status: "validation_error", afip_error: "Factura A requiere CUIT del cliente" }))).toBe("datos_cliente");
    expect(grupoPendienteFiscal(con({ afip_status: "network_error", afip_error: "Error de conexión con AFIP" }))).toBe("reintentar");
    expect(grupoPendienteFiscal(con({ afip_status: "rejected", afip_error: "texto viejo" }))).toBe("reintentar");
  });

  it("resume en orden estable y omite grupos vacíos", () => {
    const resumen = resumenPendientesFiscales([
      con({ afip_status: "processing" }),
      base,
      con({ afip_status: "rejected", afip_error: rechazo(10013) }),
      con({ afip_status: "config_error" }),
      con({ afip_status: "rejected", afip_error: rechazo(10017) }),
      con({ cae: "41124599989845", afip_status: "authorized" }),
    ]);
    expect(resumen).toEqual([
      { grupo: "conexion", cantidad: 1 },
      { grupo: "datos_cliente", cantidad: 2 },
      { grupo: "sin_autorizar", cantidad: 1 },
      { grupo: "en_verificacion", cantidad: 1 },
    ]);
    expect(resumenPendientesFiscales([])).toEqual([]);
  });
});
