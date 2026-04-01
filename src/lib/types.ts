export interface Product {
  id: string;
  name: string;
  category: 'vaper' | 'perfume';
  costUSD: number;
  customsFee: number; // 15% of costUSD
  totalCostUSD: number;
  salePriceARS: number;
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
}

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceARS: number;
  totalARS: number;
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
}
