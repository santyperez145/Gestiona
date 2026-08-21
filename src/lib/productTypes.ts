import { supabase } from "@/integrations/supabase/client";

export type ProductAttributeType = "text" | "number" | "boolean" | "date" | "select" | "multiselect";

export interface ProductType {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AttributeDefinition {
  id: string;
  org_id: string;
  product_type_id: string;
  name: string;
  slug: string;
  data_type: ProductAttributeType;
  unit: string | null;
  options: string[];
  required: boolean;
  filterable: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductAttributeValue {
  id?: string;
  org_id: string;
  product_id: string;
  attribute_definition_id: string;
  value_text?: string | null;
  value_number?: number | null;
  value_boolean?: boolean | null;
  value_date?: string | null;
  value_json?: string[] | null;
}

export interface ProductAttributeInput {
  name: string;
  slug?: string;
  data_type: ProductAttributeType;
  unit?: string;
  options?: string[];
  required?: boolean;
  filterable?: boolean;
}

const db = supabase as any;

export function slugifyProductType(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tipo-producto";
}

export function normalizeAttributeOptions(options: string[]): string[] {
  return [...new Set(options.map(option => option.trim()).filter(Boolean))];
}

export function toProductAttributeValue(
  definition: AttributeDefinition,
  rawValue: unknown,
  base: Pick<ProductAttributeValue, "org_id" | "product_id" | "attribute_definition_id">,
): ProductAttributeValue | null {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;

  switch (definition.data_type) {
    case "number": {
      const value = Number(rawValue);
      return Number.isFinite(value) ? { ...base, value_number: value } : null;
    }
    case "boolean":
      return { ...base, value_boolean: rawValue === true || rawValue === "true" };
    case "date":
      return { ...base, value_date: String(rawValue) };
    case "multiselect": {
      const values = Array.isArray(rawValue)
        ? normalizeAttributeOptions(rawValue.map(String))
        : normalizeAttributeOptions(String(rawValue).split(","));
      return values.length ? { ...base, value_json: values } : null;
    }
    case "text":
    case "select":
      return { ...base, value_text: String(rawValue).trim() };
  }
}

export async function listProductTypes(orgId: string): Promise<ProductType[]> {
  const { data, error } = await db
    .from("product_types")
    .select("*")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data || []) as ProductType[];
}

export async function listAttributeDefinitions(orgId: string, productTypeId: string): Promise<AttributeDefinition[]> {
  const { data, error } = await db
    .from("attribute_definitions")
    .select("*")
    .eq("org_id", orgId)
    .eq("product_type_id", productTypeId)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data || []) as AttributeDefinition[];
}

export async function listProductAttributeValues(orgId: string, productId: string): Promise<ProductAttributeValue[]> {
  const { data, error } = await db
    .from("product_attribute_values")
    .select("*")
    .eq("org_id", orgId)
    .eq("product_id", productId);
  if (error) throw error;
  return (data || []) as ProductAttributeValue[];
}

export async function createProductType(orgId: string, name: string, description?: string): Promise<ProductType> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("El nombre del tipo es obligatorio");
  const { data, error } = await db
    .from("product_types")
    .insert({ org_id: orgId, name: cleanName, slug: slugifyProductType(cleanName), description: description?.trim() || null })
    .select("*")
    .single();
  if (error) throw error;
  return data as ProductType;
}

export async function createAttributeDefinition(orgId: string, productTypeId: string, input: ProductAttributeInput): Promise<AttributeDefinition> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error("El nombre del atributo es obligatorio");
  const { data, error } = await db
    .from("attribute_definitions")
    .insert({
      org_id: orgId,
      product_type_id: productTypeId,
      name: cleanName,
      slug: slugifyProductType(input.slug || cleanName),
      data_type: input.data_type,
      unit: input.unit?.trim() || null,
      options: normalizeAttributeOptions(input.options || []),
      required: input.required ?? false,
      filterable: input.filterable ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AttributeDefinition;
}

export async function saveProductAttributeValues(
  orgId: string,
  productId: string,
  definitions: AttributeDefinition[],
  values: Record<string, unknown>,
): Promise<void> {
  const rows = definitions
    .map(definition => toProductAttributeValue(
      definition,
      values[definition.id],
      { org_id: orgId, product_id: productId, attribute_definition_id: definition.id },
    ))
    .filter((value): value is ProductAttributeValue => value !== null);

  if (rows.length) {
    const { error } = await db
      .from("product_attribute_values")
      .upsert(rows, { onConflict: "product_id,attribute_definition_id" });
    if (error) throw error;
  }

  const { data: existing, error: existingError } = await db
    .from("product_attribute_values")
    .select("attribute_definition_id")
    .eq("org_id", orgId)
    .eq("product_id", productId);
  if (existingError) throw existingError;
  const keep = new Set(rows.map(row => row.attribute_definition_id));
  const staleIds = (existing || [])
    .map((row: { attribute_definition_id: string }) => row.attribute_definition_id)
    .filter((id: string) => !keep.has(id));
  if (staleIds.length) {
    const { error: deleteError } = await db
      .from("product_attribute_values")
      .delete()
      .eq("org_id", orgId)
      .eq("product_id", productId)
      .in("attribute_definition_id", staleIds);
    if (deleteError) throw deleteError;
  }
}
