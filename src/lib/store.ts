import { Product, Purchase, Sale, Debt, Settings } from './types';

const KEYS = {
  products: 'vaper_products',
  purchases: 'vaper_purchases',
  sales: 'vaper_sales',
  debts: 'vaper_debts',
  settings: 'vaper_settings',
};

function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function set<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify(data));
}

// Products
export function getProducts(): Product[] { return get(KEYS.products, []); }
export function saveProducts(p: Product[]) { set(KEYS.products, p); }
export function addProduct(p: Product) { const all = getProducts(); all.push(p); saveProducts(all); }
export function updateProduct(p: Product) { saveProducts(getProducts().map(x => x.id === p.id ? p : x)); }
export function deleteProduct(id: string) { saveProducts(getProducts().filter(x => x.id !== id)); }

// Purchases
export function getPurchases(): Purchase[] { return get(KEYS.purchases, []); }
export function savePurchases(p: Purchase[]) { set(KEYS.purchases, p); }
export function addPurchase(p: Purchase) {
  const all = getPurchases(); all.push(p); savePurchases(all);
  // Update stock
  const products = getProducts();
  const prod = products.find(x => x.id === p.productId);
  if (prod) { prod.stock += p.quantity; saveProducts(products); }
}
export function deletePurchase(id: string) { savePurchases(getPurchases().filter(x => x.id !== id)); }

// Sales
export function getSales(): Sale[] { return get(KEYS.sales, []); }
export function saveSales(s: Sale[]) { set(KEYS.sales, s); }
export function addSale(s: Sale) {
  const all = getSales(); all.push(s); saveSales(all);
  // Update stock
  const products = getProducts();
  const prod = products.find(x => x.id === s.productId);
  if (prod) { prod.stock = Math.max(0, prod.stock - s.quantity); saveProducts(products); }
  // Create debt if not paid
  if (!s.paid) {
    addDebt({
      id: crypto.randomUUID(),
      saleId: s.id,
      customerName: s.customerName || 'Sin nombre',
      amountARS: s.totalARS,
      paidARS: 0,
      remainingARS: s.totalARS,
      description: `Venta de ${s.quantity}x ${s.productName}`,
      date: s.date,
      status: 'pending',
    });
  }
}
export function deleteSale(id: string) { saveSales(getSales().filter(x => x.id !== id)); }

// Debts
export function getDebts(): Debt[] { return get(KEYS.debts, []); }
export function saveDebts(d: Debt[]) { set(KEYS.debts, d); }
export function addDebt(d: Debt) { const all = getDebts(); all.push(d); saveDebts(all); }
export function updateDebt(d: Debt) { saveDebts(getDebts().map(x => x.id === d.id ? d : x)); }
export function deleteDebt(id: string) { saveDebts(getDebts().filter(x => x.id !== id)); }

// Settings
export function getSettings(): Settings { return get(KEYS.settings, { exchangeRate: 1200, customsPercent: 15 }); }
export function saveSettings(s: Settings) { set(KEYS.settings, s); }

// Helpers
export function formatARS(n: number) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n); }
export function formatUSD(n: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
