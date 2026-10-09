import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: database }));

import {
  listAttributeDefinitions,
  listProductAttributeValues,
  normalizeAttributeOptions,
  defaultProductTypeId,
  saveProductAttributeValues,
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

function queryResult(result: { data?: unknown; error?: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    delete: vi.fn(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of [query.select, query.eq, query.in, query.order, query.delete]) {
    method.mockReturnValue(query);
  }
  return query;
}

beforeEach(() => database.from.mockReset());

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

  it("elige un tipo por defecto sin adivinar cuando hay varios", () => {
    expect(defaultProductTypeId([])).toBeNull();
    expect(defaultProductTypeId([{ id: "solo", source: "custom" }])).toBe("solo");
    expect(defaultProductTypeId([
      { id: "perfil", source: "business_profile" },
      { id: "extra", source: "custom" },
    ])).toBe("perfil");
    expect(defaultProductTypeId([
      { id: "a", source: "business_profile" },
      { id: "b", source: "business_profile" },
    ])).toBeNull();
    expect(defaultProductTypeId([
      { id: "a", source: "custom" },
      { id: "b", source: "custom" },
    ])).toBeNull();
  });
});

describe("guardar atributos sólo modifica las definiciones cargadas", () => {
  const retained = definition("number");
  const cleared = { ...definition("text"), id: "attribute-cleared" };
  const historicalId = "attribute-other-type";

  it("no escribe ni elimina nada si no hay definiciones cargadas", async () => {
    await saveProductAttributeValues(base.org_id, base.product_id, [], {
      [historicalId]: "Valor histórico",
    });
    expect(database.from).not.toHaveBeenCalled();
  });

  it("preserva atributos de otro tipo al guardar y limpiar el tipo actual", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    // El mock devuelve un id ajeno además del filtro: la defensa local también
    // limita la limpieza, incluso con un resultado inesperado de la lectura.
    const read = queryResult({ data: [retained.id, cleared.id, historicalId].map(id => ({ attribute_definition_id: id })), error: null });
    const remove = queryResult({ error: null });
    database.from.mockReturnValueOnce({ upsert }).mockReturnValueOnce(read).mockReturnValueOnce(remove);

    await saveProductAttributeValues(base.org_id, base.product_id, [retained, cleared], { [retained.id]: 0, [cleared.id]: "" });

    expect(upsert).toHaveBeenCalledWith([{ ...base, value_number: 0 }], { onConflict: "product_id,attribute_definition_id" });
    expect(read.eq.mock.calls).toEqual([["org_id", base.org_id], ["product_id", base.product_id]]);
    expect(read.in).toHaveBeenCalledWith("attribute_definition_id", [retained.id, cleared.id]);
    expect(remove.eq.mock.calls).toEqual([["org_id", base.org_id], ["product_id", base.product_id]]);
    expect(remove.in).toHaveBeenCalledWith("attribute_definition_id", [cleared.id]);
  });

  it("una carga parcial sólo puede limpiar las definiciones de esa carga", async () => {
    const read = queryResult({ data: [cleared.id, retained.id, historicalId].map(id => ({ attribute_definition_id: id })), error: null });
    const remove = queryResult({ error: null });
    database.from.mockReturnValueOnce(read).mockReturnValueOnce(remove);

    await saveProductAttributeValues(base.org_id, base.product_id, [cleared], { [cleared.id]: null });

    expect(read.in).toHaveBeenCalledWith("attribute_definition_id", [cleared.id]);
    expect(remove.in).toHaveBeenCalledWith("attribute_definition_id", [cleared.id]);
    expect(database.from).toHaveBeenCalledTimes(2);
  });

  it("mantiene un falso explícito sin limpiarlo ni convertirlo en ausencia", async () => {
    const flag = definition("boolean");
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const read = queryResult({ data: [{ attribute_definition_id: flag.id }, { attribute_definition_id: historicalId }], error: null });
    database.from.mockReturnValueOnce({ upsert }).mockReturnValueOnce(read);

    await saveProductAttributeValues(base.org_id, base.product_id, [flag], { [flag.id]: false });

    expect(upsert).toHaveBeenCalledWith([{ ...base, value_boolean: false }], { onConflict: "product_id,attribute_definition_id" });
    expect(database.from).toHaveBeenCalledTimes(2);
  });

  it("no ejecuta limpieza si la escritura falla", async () => {
    const error = { code: "write-failed" };
    const upsert = vi.fn().mockResolvedValue({ error });
    database.from.mockReturnValueOnce({ upsert });

    await expect(saveProductAttributeValues(base.org_id, base.product_id, [retained, cleared], { [retained.id]: 12 })).rejects.toBe(error);
    expect(database.from).toHaveBeenCalledTimes(1);
  });

  it("no transforma una lectura fallida en limpieza del producto", async () => {
    const error = { code: "read-failed" };
    const read = queryResult({ data: null, error });
    database.from.mockReturnValueOnce(read);

    await expect(saveProductAttributeValues(base.org_id, base.product_id, [cleared], {})).rejects.toBe(error);
    expect(database.from).toHaveBeenCalledTimes(1);
    expect(read.delete).not.toHaveBeenCalled();
  });

  it("propaga un fallo de limpieza sin anunciar un guardado exitoso", async () => {
    const error = { code: "delete-failed" };
    const read = queryResult({ data: [{ attribute_definition_id: cleared.id }], error: null });
    const remove = queryResult({ error });
    database.from.mockReturnValueOnce(read).mockReturnValueOnce(remove);

    await expect(saveProductAttributeValues(base.org_id, base.product_id, [cleared], {})).rejects.toBe(error);
    expect(remove.in).toHaveBeenCalledWith("attribute_definition_id", [cleared.id]);
  });

  it("lee definiciones del tipo y organización explícitos", async () => {
    const read = queryResult({ data: [retained], error: null });
    database.from.mockReturnValueOnce(read);

    await expect(listAttributeDefinitions(base.org_id, retained.product_type_id)).resolves.toEqual([retained]);
    expect(database.from).toHaveBeenCalledWith("attribute_definitions");
    expect(read.eq.mock.calls).toEqual([["org_id", base.org_id], ["product_type_id", retained.product_type_id]]);
  });

  it("un fallo de carga de definiciones no se confunde con un tipo sin atributos", async () => {
    const error = { code: "definitions-failed" };
    database.from.mockReturnValueOnce(queryResult({ data: null, error }));

    await expect(listAttributeDefinitions(base.org_id, retained.product_type_id)).rejects.toBe(error);
    expect(database.from).toHaveBeenCalledTimes(1);
  });

  it("un fallo de carga de valores no se confunde con valores vacíos", async () => {
    const error = { code: "values-failed" };
    const read = queryResult({ data: null, error });
    database.from.mockReturnValueOnce(read);

    await expect(listProductAttributeValues(base.org_id, base.product_id)).rejects.toBe(error);
    expect(read.eq.mock.calls).toEqual([["org_id", base.org_id], ["product_id", base.product_id]]);
    expect(read.delete).not.toHaveBeenCalled();
  });
});
