import { describe, expect, it } from "vitest";
import {
  normalizeAttributeOptions,
  slugifyProductType,
  toProductAttributeValue,
  type AttributeDefinition,
} from "./productTypes";

const base = { org_id: "org-1", product_id: "product-1", attribute_definition_id: "attribute-1" };

function definition(data_type: AttributeDefinition["data_type"]): AttributeDefinition {
  return {
    ...base,
    id: "attribute-1",
    product_type_id: "type-1",
    name: "Atributo",
    slug: "atributo",
    data_type,
    unit: null,
    options: [],
    required: false,
    filterable: true,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  };
}

describe("product types kernel", () => {
  it("creates stable slugs for names with accents and punctuation", () => {
    expect(slugifyProductType("  Ropa de Niño / Verano  ")).toBe("ropa-de-nino-verano");
  });

  it("does not keep duplicate or blank select options", () => {
    expect(normalizeAttributeOptions(["  Rojo", "Rojo", "", " azul "])).toEqual(["Rojo", "azul"]);
  });

  it("maps values to the correct typed column", () => {
    expect(toProductAttributeValue(definition("number"), "12.5", base)).toMatchObject({ value_number: 12.5 });
    expect(toProductAttributeValue(definition("boolean"), false, base)).toMatchObject({ value_boolean: false });
    expect(toProductAttributeValue(definition("date"), "2026-08-21", base)).toMatchObject({ value_date: "2026-08-21" });
    expect(toProductAttributeValue(definition("multiselect"), ["M", "L"], base)).toMatchObject({ value_json: ["M", "L"] });
  });

  it("drops empty and invalid values instead of inventing data", () => {
    expect(toProductAttributeValue(definition("text"), "", base)).toBeNull();
    expect(toProductAttributeValue(definition("number"), "not-a-number", base)).toBeNull();
    expect(toProductAttributeValue(definition("multiselect"), ["", "  "], base)).toBeNull();
  });
});
