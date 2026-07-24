// ── Taxonomía olfativa — fuente de verdad compartida ────────────────────────
// Usada por ProductsPage (ficha perfume + filtros por facetas) y CustomersPage
// (preferencias del cliente). Los `value` de familia/duración/proyección DEBEN
// coincidir con los CHECK de la migración `product_perfume_details`. Los `value`
// se guardan en DB (ascii, sin acentos) y los `label` se muestran en la UI.

export interface TaxItem {
  value: string;
  label: string;
}

// familia_olfativa — CHECK en DB, single-select
export const FAMILIAS_OLFATIVAS: TaxItem[] = [
  { value: "amaderada", label: "Amaderada" },
  { value: "oriental", label: "Oriental" },
  { value: "ambar", label: "Ámbar" },
  { value: "gourmand", label: "Gourmand / Dulce" },
  { value: "floral", label: "Floral" },
  { value: "citrica", label: "Cítrica" },
  { value: "acuatica", label: "Acuática / Fresca" },
  { value: "chipre", label: "Chipre" },
  { value: "fougere", label: "Fougère" },
  { value: "aromatica", label: "Aromática" },
];

// duracion — CHECK en DB, single-select
export const DURACIONES: TaxItem[] = [
  { value: "corta", label: "Corta (2-4 h)" },
  { value: "moderada", label: "Moderada (4-6 h)" },
  { value: "larga", label: "Larga (6-9 h)" },
  { value: "muy_larga", label: "Muy larga (9+ h)" },
];

// proyeccion (sillage) — CHECK en DB, single-select
export const PROYECCIONES: TaxItem[] = [
  { value: "intima", label: "Íntima (piel)" },
  { value: "moderada", label: "Moderada" },
  { value: "fuerte", label: "Fuerte" },
  { value: "enorme", label: "Enorme" },
];

// estacion — text[] libre, multi-select
export const ESTACIONES: TaxItem[] = [
  { value: "verano", label: "Verano" },
  { value: "invierno", label: "Invierno" },
  { value: "primavera", label: "Primavera" },
  { value: "otono", label: "Otoño" },
];

// ocasion — text[] libre, multi-select
export const OCASIONES: TaxItem[] = [
  { value: "diario", label: "Diario" },
  { value: "oficina", label: "Oficina" },
  { value: "noche", label: "Noche" },
  { value: "formal", label: "Formal / Evento" },
  { value: "deportivo", label: "Deportivo" },
];

// Notas olfativas comunes — text[] libre. Compartidas entre las notas del
// perfume (salida/corazón/fondo) y las preferencias del cliente, de modo que
// una futura recomendación cliente↔producto pueda cruzarlas (Phase 2).
export const NOTAS_COMUNES: TaxItem[] = [
  { value: "vainilla", label: "Vainilla" },
  { value: "oud", label: "Oud / Madera de agar" },
  { value: "citricos", label: "Cítricos" },
  { value: "cafe", label: "Café" },
  { value: "cuero", label: "Cuero" },
  { value: "ambar", label: "Ámbar" },
  { value: "almizcle", label: "Almizcle" },
  { value: "rosa", label: "Rosa" },
  { value: "madera", label: "Madera" },
  { value: "especias", label: "Especias" },
  { value: "coco", label: "Coco" },
  { value: "frutal", label: "Frutal" },
  { value: "floral", label: "Floral" },
  { value: "tabaco", label: "Tabaco" },
  { value: "chocolate", label: "Chocolate" },
  { value: "lavanda", label: "Lavanda" },
];

// Género — reutiliza los valores existentes de products.gender como faceta.
export const GENEROS: TaxItem[] = [
  { value: "masculino", label: "Masculino" },
  { value: "femenino", label: "Femenino" },
  { value: "unisex", label: "Unisex" },
];

// Helper: resolver un value a su label para mostrar.
export function taxLabel(items: TaxItem[], value: string | null | undefined): string {
  if (!value) return "";
  return items.find((i) => i.value === value)?.label ?? value;
}
