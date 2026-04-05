import { ProductCategory, ProductGender } from './types';
import { calculateProductProfits } from './store';

interface RawProduct {
  name: string;
  brand: string;
  category: ProductCategory;
  gender: ProductGender;
  costUSD: number;
  salePriceARS: number;
  discountPriceARS: number;
  stock: number;
}

const rawProducts: RawProduct[] = [
  { name: 'LATTAFA KHAMRAH 100ML', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.50, salePriceARS: 66766, discountPriceARS: 53413, stock: 2 },
  { name: 'LATTAFA FAKHAR EXTRAIT GOLD 100ML', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 18.90, salePriceARS: 64712, discountPriceARS: 51769, stock: 2 },
  { name: 'Lattafa Asad 100ml', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 22.50, salePriceARS: 77038, discountPriceARS: 61630, stock: 1 },
  { name: 'Lattafa Asad Zanzibar', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 16.00, salePriceARS: 54782, discountPriceARS: 43826, stock: 1 },
  { name: 'LATTAFA FAKHAR MAN SILVER 100ML', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 18.00, salePriceARS: 61630, discountPriceARS: 49304, stock: 1 },
  { name: 'LATTAFA MAAHIR LEGACY 100ML UNISEX', brand: 'Lattafa', category: 'perfume_arabe', gender: 'unisex', costUSD: 19.41, salePriceARS: 66458, discountPriceARS: 53166, stock: 2 },
  { name: 'LATTAFA QAED AL FURSAN UNLIMITED WHITE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 14.00, salePriceARS: 47935, discountPriceARS: 38348, stock: 2 },
  { name: 'Afnan 9am Dive', brand: 'Afnan', category: 'perfume_arabe', gender: 'masculino', costUSD: 23.00, salePriceARS: 78750, discountPriceARS: 63000, stock: 2 },
  { name: 'Afnan 9pm Black', brand: 'Afnan', category: 'perfume_arabe', gender: 'masculino', costUSD: 21.50, salePriceARS: 73614, discountPriceARS: 58891, stock: 1 },
  { name: 'Armaf Mandarin Sky', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 22.00, salePriceARS: 75326, discountPriceARS: 60261, stock: 1 },
  { name: 'ARMAF CLUB DE NUIT URBAN ELIX 105ML', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 25.50, salePriceARS: 87309, discountPriceARS: 69848, stock: 1 },
  { name: 'Rasasi Hawas For Him', brand: 'Rasasi', category: 'perfume_arabe', gender: 'masculino', costUSD: 21.75, salePriceARS: 74470, discountPriceARS: 59576, stock: 3 },
  { name: 'French Avenue Liquid Brun', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 34.00, salePriceARS: 116413, discountPriceARS: 93130, stock: 1 },
  { name: 'Afnan 9am Yellow', brand: 'Afnan', category: 'perfume_arabe', gender: 'masculino', costUSD: 21.00, salePriceARS: 71902, discountPriceARS: 57522, stock: 1 },
  { name: 'Afnan 9pm Elixir', brand: 'Afnan', category: 'perfume_arabe', gender: 'masculino', costUSD: 29.50, salePriceARS: 101005, discountPriceARS: 80804, stock: 1 },
  { name: 'AFNAN 9PM REBEL', brand: 'Afnan', category: 'perfume_arabe', gender: 'masculino', costUSD: 27.50, salePriceARS: 94157, discountPriceARS: 75326, stock: 1 },
  { name: 'ARMAF CLUB DE NUIT ICONIC', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 29.40, salePriceARS: 100663, discountPriceARS: 80530, stock: 1 },
  { name: 'ARMAF CLUB DE NUIT INTENSE', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 26.00, salePriceARS: 89021, discountPriceARS: 71217, stock: 1 },
  { name: 'ARMAF ODYSSEY GO MANGO', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 31.00, salePriceARS: 106141, discountPriceARS: 84913, stock: 1 },
  { name: 'Maison Alhambra Barber Marmara', brand: 'Maison Alhambra', category: 'perfume_arabe', gender: 'masculino', costUSD: 16.00, salePriceARS: 54782, discountPriceARS: 43826, stock: 1 },
  { name: 'Maison Alhambra Toscano', brand: 'Maison Alhambra', category: 'perfume_arabe', gender: 'masculino', costUSD: 14.50, salePriceARS: 49647, discountPriceARS: 39717, stock: 1 },
  { name: 'Al Haramain Amber Oud Gold', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'unisex', costUSD: 28.50, salePriceARS: 97581, discountPriceARS: 78065, stock: 1 },
  { name: 'Bharara King', brand: 'Bharara', category: 'perfume_arabe', gender: 'masculino', costUSD: 39.00, salePriceARS: 133526, discountPriceARS: 106821, stock: 1 },
  { name: 'ARMAF LEGESI', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 22.50, salePriceARS: 77038, discountPriceARS: 61630, stock: 2 },
  { name: 'LATTAFA VELVET ROSE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 17.50, salePriceARS: 59918, discountPriceARS: 47935, stock: 2 },
  { name: 'LATTAFA BADEE AL OUD AMETHYST', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 16.50, salePriceARS: 56494, discountPriceARS: 45195, stock: 1 },
  { name: 'LATTAFA YARA 100ML', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 19.00, salePriceARS: 65054, discountPriceARS: 52043, stock: 3 },
  { name: 'LATTAFA YARA MUSK 100ML', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 19.00, salePriceARS: 65054, discountPriceARS: 52043, stock: 1 },
  { name: 'LATTAFA YARA CANDY 100ML', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 19.00, salePriceARS: 65054, discountPriceARS: 52043, stock: 1 },
  { name: 'Lattafa Mayar', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 20.00, salePriceARS: 68478, discountPriceARS: 54782, stock: 2 },
  { name: 'Afnan 9am Femme', brand: 'Afnan', category: 'perfume_arabe', gender: 'femenino', costUSD: 21.00, salePriceARS: 71902, discountPriceARS: 57522, stock: 1 },
  { name: 'ARMAF CLUB DE NUIT WOMAN', brand: 'Armaf', category: 'perfume_arabe', gender: 'femenino', costUSD: 23.00, salePriceARS: 78750, discountPriceARS: 63000, stock: 1 },
  { name: 'FRENCH AVENUE GABARDINE II', brand: 'French Avenue', category: 'perfume_arabe', gender: 'femenino', costUSD: 25.50, salePriceARS: 87309, discountPriceARS: 69848, stock: 1 },
  { name: 'AZZARO THE MOST WANTED 100ML', brand: 'Azzaro', category: 'perfume_diseñador', gender: 'masculino', costUSD: 37.50, salePriceARS: 128391, discountPriceARS: 102713, stock: 1 },
  { name: 'DIOR SAUVAGE EDP 100ML', brand: 'Dior', category: 'perfume_diseñador', gender: 'masculino', costUSD: 42.00, salePriceARS: 143799, discountPriceARS: 115039, stock: 1 },
  { name: 'JEAN PAUL GAULTIER LE MALE 125ML', brand: 'Jean Paul Gaultier', category: 'perfume_diseñador', gender: 'masculino', costUSD: 35.50, salePriceARS: 121543, discountPriceARS: 97235, stock: 1 },
  { name: 'CHANEL BLEU EDP 100ML', brand: 'Chanel', category: 'perfume_diseñador', gender: 'masculino', costUSD: 45.00, salePriceARS: 154070, discountPriceARS: 123256, stock: 1 },
  { name: 'CAROLINA HERRERA BAD BOY EDT 100ML', brand: 'Carolina Herrera', category: 'perfume_diseñador', gender: 'masculino', costUSD: 33.00, salePriceARS: 112978, discountPriceARS: 90382, stock: 1 },
  { name: 'VERSACE EROS EDT 100ML', brand: 'Versace', category: 'perfume_diseñador', gender: 'masculino', costUSD: 30.00, salePriceARS: 102713, discountPriceARS: 82170, stock: 2 },
  { name: 'PACO RABANNE 1 MILLION 100ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'masculino', costUSD: 32.00, salePriceARS: 109560, discountPriceARS: 87648, stock: 1 },
  { name: 'INVICTUS VICTORY EDT 100ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'masculino', costUSD: 34.00, salePriceARS: 116413, discountPriceARS: 93130, stock: 1 },
];

// Export for Supabase seeding
export const seedProductsList = rawProducts.map(raw => {
  const exchangeRate = 1695;
  const customsPercent = 15;
  const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
    raw.costUSD, customsPercent, raw.salePriceARS, exchangeRate
  );
  return {
    name: raw.name,
    brand: raw.brand,
    category: raw.category,
    gender: raw.gender,
    cost_usd: raw.costUSD,
    customs_fee: customsFee,
    total_cost_usd: totalCostUSD,
    sale_price_ars: raw.salePriceARS,
    discount_price_ars: raw.discountPriceARS || null,
    profit_per_unit_ars: profitPerUnitARS,
    profit_per_unit_usd: profitPerUnitUSD,
    stock: raw.stock,
  };
});

// Legacy localStorage seed (kept for backward compat)
export function seedProducts() {
  // No-op now — seeding happens via Supabase
}
