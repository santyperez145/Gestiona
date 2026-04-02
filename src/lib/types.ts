export type ProductCategory = 'perfume_arabe' | 'perfume_diseñador' | 'vaper' | 'electronico';
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
