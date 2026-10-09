import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { columnasIdentidadFiscal, errorIdentidadFiscal, identidadFiscalDesde, IDENTIDAD_FISCAL_VACIA, letraParaCliente } from "@/lib/customerFiscal";
import { etiquetaCliente, terminoBusquedaCliente } from "@/components/pos/PosCustomerPicker";

const cuitValido = "20-12345678-6";

describe("identidad fiscal del cliente", () => {
  it("consumidor final no exige documento; si lo carga, lo valida", () => {
    expect(errorIdentidadFiscal(IDENTIDAD_FISCAL_VACIA)).toBeNull();
    expect(errorIdentidadFiscal({ ...IDENTIDAD_FISCAL_VACIA, tax_id: "30111222" })).toBeNull();
    expect(errorIdentidadFiscal({ ...IDENTIDAD_FISCAL_VACIA, tax_id: "123" })).toMatch(/CUIT de 11 dígitos o un DNI/);
    expect(errorIdentidadFiscal({ ...IDENTIDAD_FISCAL_VACIA, tax_id: "20123456780" })).toMatch(/verificador/);
  });

  it("inscripto, monotributo y exento se identifican con CUIT válido", () => {
    for (const condicion of ["responsable_inscripto", "monotributo", "exento"] as const) {
      expect(errorIdentidadFiscal({ ...IDENTIDAD_FISCAL_VACIA, vat_condition: condicion })).toMatch(/CUIT/);
      expect(errorIdentidadFiscal({ ...IDENTIDAD_FISCAL_VACIA, vat_condition: condicion, tax_id: "30111222" })).toMatch(/CUIT/);
      expect(errorIdentidadFiscal({ ...IDENTIDAD_FISCAL_VACIA, vat_condition: condicion, tax_id: cuitValido })).toBeNull();
    }
  });

  it("guarda sólo dígitos, deduce el tipo y vacía lo opcional", () => {
    expect(columnasIdentidadFiscal({ vat_condition: "responsable_inscripto", tax_id: cuitValido, legal_name: "  ", fiscal_address: " Calle 1 " }))
      .toEqual({ vat_condition: "responsable_inscripto", tax_id: "20123456786", tax_id_type: "CUIT", legal_name: null, fiscal_address: "Calle 1" });
    expect(columnasIdentidadFiscal({ ...IDENTIDAD_FISCAL_VACIA, tax_id: "30.111.222" })).toMatchObject({ tax_id: "30111222", tax_id_type: "DNI" });
    expect(columnasIdentidadFiscal(IDENTIDAD_FISCAL_VACIA)).toMatchObject({ tax_id: null, tax_id_type: null });
  });

  it("lee una ficha guardada y formatea el CUIT", () => {
    expect(identidadFiscalDesde({ vat_condition: "monotributo", tax_id: "20123456786" })).toMatchObject({ vat_condition: "monotributo", tax_id: cuitValido });
    expect(identidadFiscalDesde({ vat_condition: "zz" }).vat_condition).toBe("consumidor_final");
  });

  it("anticipa la letra con la misma regla del servidor", () => {
    expect(letraParaCliente("responsable_inscripto", "responsable_inscripto")).toBe("A");
    expect(letraParaCliente("responsable_inscripto", "monotributo")).toBe("B");
    expect(letraParaCliente("responsable_inscripto", null)).toBe("B");
    expect(letraParaCliente("monotributo", "responsable_inscripto")).toBe("C");
  });

  it("la búsqueda no rompe el filtro de PostgREST", () => {
    expect(terminoBusquedaCliente("Pérez, (SA)*%")).toBe("Pérez SA");
    expect(etiquetaCliente({ tax_id: "20123456786", vat_condition: "responsable_inscripto" })).toBe("CUIT 20-12345678-6 · Responsable Inscripto");
    expect(etiquetaCliente({ tax_id: null, vat_condition: "consumidor_final" })).toBe("Consumidor Final");
  });

  it("el POS envía el cliente en cada renglón y el SQL decide la clase con su ficha", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(pos).toContain("customer_id: posCustomer?.id ?? null");
    const sql = readFileSync("supabase/migrations/20261009000200_customer_fiscal_identity.sql", "utf8");
    expect(sql).toContain("public.tipo_de_comprobante(v_emisor, v_cond)");
    expect(sql).toContain("c.id = v_customer_id AND c.org_id = p_org");
  });
});
