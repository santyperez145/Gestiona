import { describe, expect, it } from "vitest";
import { storeDebeEscribirBanco } from "@/lib/storeFirstPublish";

// 2026-11-04: plata. Al cambiar de comercio el formulario del banco seguía con
// el CBU del anterior; si la lectura del nuevo fallaba o tardaba y se guardaba,
// el CBU de A quedaba en los `settings` de B y los compradores de B le
// transferían a A.
const VACIO = { bank_cbu: "", bank_alias: "", bank_name: "", bank_holder: "" };
const DE_A = { bank_cbu: "0000003100010000000001", bank_alias: "comercio.a", bank_name: "", bank_holder: "A" };

describe("storeDebeEscribirBanco", () => {
  it("no escribe en B el CBU que quedó cargado de A", () => {
    expect(storeDebeEscribirBanco({ orgId: "org-b", formOrgId: "org-a", bancoLeido: false, form: DE_A })).toBe(false);
    expect(storeDebeEscribirBanco({ orgId: "org-b", formOrgId: "org-a", bancoLeido: true, form: DE_A })).toBe(false);
  });

  it("sin comercio no escribe", () => {
    expect(storeDebeEscribirBanco({ orgId: null, formOrgId: null, bancoLeido: true, form: DE_A })).toBe(false);
    expect(storeDebeEscribirBanco({ orgId: undefined, formOrgId: undefined, bancoLeido: false, form: DE_A })).toBe(false);
  });

  it("sin haber leído lo guardado, el formulario vacío no borra el CBU", () => {
    expect(storeDebeEscribirBanco({ orgId: "org-b", formOrgId: "org-b", bancoLeido: false, form: VACIO })).toBe(false);
    expect(storeDebeEscribirBanco({ orgId: "org-b", formOrgId: "org-b", bancoLeido: false, form: { ...VACIO, bank_alias: "   " } })).toBe(false);
  });

  it("escribe lo tipeado para este comercio aunque la lectura no haya llegado", () => {
    expect(storeDebeEscribirBanco({ orgId: "org-b", formOrgId: "org-b", bancoLeido: false, form: { ...VACIO, bank_alias: "comercio.b" } })).toBe(true);
  });

  it("con lo guardado ya leído escribe, también para vaciarlo a propósito", () => {
    expect(storeDebeEscribirBanco({ orgId: "org-b", formOrgId: "org-b", bancoLeido: true, form: VACIO })).toBe(true);
    expect(storeDebeEscribirBanco({ orgId: "org-b", formOrgId: "org-b", bancoLeido: true, form: DE_A })).toBe(true);
  });
});
