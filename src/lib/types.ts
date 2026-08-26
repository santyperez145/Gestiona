/**
 * Tipos del prototipo original, anteriores a la multi-tenencia.
 *
 * ⚠️ **Este archivo lo importa un solo lugar**: `seedData.ts`, y sólo por
 * `ProductCategory` y `ProductGender` — verificado con grep sobre todo `src` el
 * 2026-08-26. Las pantallas usan los tipos generados de Supabase o interfaces
 * locales propias, así que `Product`, `Purchase`, `Sale`, `Debt` y `Settings`
 * de acá abajo no los consume nadie. Conviene saberlo antes de "arreglarlos".
 *
 * `ProductCategory` era la unión cerrada de los cuatro slugs de la perfumería
 * original. Como tipo *de la aplicación* eso dejó de ser cierto el día que cada
 * comercio crea sus categorías: el slug es texto libre y la lista de verdad
 * vive en `ecommerce_categories`, no en el compilador.
 */
export type ProductCategory = string;
export type ProductGender = 'masculino' | 'femenino' | 'unisex';

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: ProductCategory;
  gender: ProductGender;
  costUSD: number;
  customsFee: number;
  totalCostUSD: number;
  salePriceARS: number;
  discountPriceARS?: number;
  profitPerUnitARS: number;
  profitPerUnitUSD: number;
  stock: number;
  description?: string;
  createdAt: string;
}

export interface Purchase {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCostUSD: number;
  customsFee: number;
  totalUSD: number;
  exchangeRate: number;
  totalARS: number;
  date: string;
  supplier?: string;
  batchName?: string;
}

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceARS: number;
  discountApplied: boolean;
  totalARS: number;
  costPerUnitUSD: number;
  profitARS: number;
  profitUSD: number;
  customerName?: string;
  date: string;
  paid: boolean;
}

export interface Debt {
  id: string;
  saleId?: string;
  customerName: string;
  amountARS: number;
  paidARS: number;
  remainingARS: number;
  description: string;
  date: string;
  dueDate?: string;
  status: 'pending' | 'partial' | 'paid';
}

export interface Settings {
  exchangeRate: number;
  customsPercent: number;
  defaultDiscountPercent: number;
}
