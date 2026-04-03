import { Product, ProductCategory, ProductGender } from './types';
import { getProducts, saveProducts, getSettings, calculateProductProfits } from './store';

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

function extractBrand(name: string): string {
  const brandMap: [string, string][] = [
    ['LATTAFA', 'Lattafa'],
    ['AFNAN', 'Afnan'],
    ['ARMAF', 'Armaf'],
    ['FRENCH AVENUE', 'French Avenue'],
    ['RASASI', 'Rasasi'],
    ['MAISON ALHAMBRA', 'Maison Alhambra'],
    ['AL HARAMAIN', 'Al Haramain'],
    ['BHARARA', 'Bharara'],
    ['AZZARO', 'Azzaro'],
    ['DIOR', 'Dior'],
    ['ARMANI', 'Armani'],
    ['JEAN PAUL', 'Jean Paul Gaultier'],
    ['TOM FORD', 'Tom Ford'],
    ['CHANEL', 'Chanel'],
    ['COCO', 'Chanel'],
    ['VERSACE', 'Versace'],
    ['EROS', 'Versace'],
    ['YSL', 'Yves Saint Laurent'],
    ['INVICTUS', 'Paco Rabanne'],
    ['MILLION', 'Paco Rabanne'],
    ['ONE MILLION', 'Paco Rabanne'],
    ['PHANTOM', 'Paco Rabanne'],
    ['LA VIE EST BELLE', 'Lancôme'],
    ['FAME', 'Paco Rabanne'],
    ['LADY MILLION', 'Paco Rabanne'],
    ['OLYMPEA', 'Paco Rabanne'],
    ['DONNA', 'Valentino'],
    ['UOMO', 'Valentino'],
    ['BAD BOY', 'Carolina Herrera'],
    ['WANTED', 'Azzaro'],
    ['NAXOS', 'Xerjoff'],
  ];
  const upper = name.toUpperCase();
  for (const [key, brand] of brandMap) {
    if (upper.startsWith(key) || upper.includes(key)) return brand;
  }
  return 'Otro';
}

// Exchange rate from Excel: $1,695
// Customs: 13.04% (15% on base = ~13.04% effective)
// Discount: 20% off sale price

const rawProducts: RawProduct[] = [
  // === PERFUMES ARABES MASCULINOS (from Page 2 - actual stock batch) ===
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
  { name: 'ARMAF ODYSSEY MEGA', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.00, salePriceARS: 65054, discountPriceARS: 52043, stock: 1 },
  { name: 'FRENCH AVENUE VULCAN FEU', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 31.00, salePriceARS: 106141, discountPriceARS: 84913, stock: 1 },
  { name: 'LATTAFA ART OF UNIVERSE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 27.50, salePriceARS: 94157, discountPriceARS: 75326, stock: 1 },
  { name: 'LATTAFA BADEE AL OUD AMETHYST', brand: 'Lattafa', category: 'perfume_arabe', gender: 'unisex', costUSD: 18.00, salePriceARS: 61630, discountPriceARS: 49304, stock: 1 },
  { name: 'LATTAFA BADEE AL OUD FOR GLORY', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 18.50, salePriceARS: 63342, discountPriceARS: 50674, stock: 1 },
  { name: 'LATTAFA BADEE AL OUD HONOR AND GLORY', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 18.50, salePriceARS: 63342, discountPriceARS: 50674, stock: 1 },

  // === ELECTRÓNICOS ===
  { name: 'AIRPODS PRO 2 REPLICA', brand: 'Apple (Replica)', category: 'electronico', gender: 'unisex', costUSD: 6.50, salePriceARS: 33383, discountPriceARS: 26706, stock: 10 },
  { name: 'CARGADOR 20W', brand: 'Apple (Replica)', category: 'electronico', gender: 'unisex', costUSD: 2.50, salePriceARS: 17120, discountPriceARS: 13696, stock: 10 },
  { name: 'TV BOX', brand: 'Genérico', category: 'electronico', gender: 'unisex', costUSD: 13.00, salePriceARS: 55638, discountPriceARS: 44511, stock: 10 },

  // === PERFUMES ARABES FEMENINOS ===
  { name: 'Afnan 9pm Femme', brand: 'Afnan', category: 'perfume_arabe', gender: 'femenino', costUSD: 23.00, salePriceARS: 78750, discountPriceARS: 63000, stock: 1 },
  { name: 'ARMAF CLUB DE NUIT LIONHEART WOMAN', brand: 'Armaf', category: 'perfume_arabe', gender: 'femenino', costUSD: 26.00, salePriceARS: 89021, discountPriceARS: 71217, stock: 1 },
  { name: 'ARMAF CLUB DE NUIT MALEKA', brand: 'Armaf', category: 'perfume_arabe', gender: 'femenino', costUSD: 28.00, salePriceARS: 95869, discountPriceARS: 76695, stock: 1 },
  { name: 'LATTAFA ECLAIRE EAU DE PARFUM FEMININO', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 22.00, salePriceARS: 75326, discountPriceARS: 60261, stock: 1 },
  { name: 'LATTAFA EMAAN', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 17.75, salePriceARS: 60774, discountPriceARS: 48619, stock: 1 },
  { name: 'LATTAFA FAKHAR FEMENINO', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 20.00, salePriceARS: 68478, discountPriceARS: 54782, stock: 1 },
  { name: 'LATTAFA HAYA PINK', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 21.00, salePriceARS: 71902, discountPriceARS: 57522, stock: 1 },
  { name: 'LATTAFA MAYAR ROSA', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 17.00, salePriceARS: 58206, discountPriceARS: 46565, stock: 1 },
  { name: 'LATTAFA QIMMAH', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 18.75, salePriceARS: 64198, discountPriceARS: 51359, stock: 1 },
  { name: 'LATTAFA YARA CANDY', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 18.00, salePriceARS: 61630, discountPriceARS: 49304, stock: 1 },
  { name: 'LATTAFA YARA', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 17.75, salePriceARS: 60774, discountPriceARS: 48619, stock: 1 },
  { name: 'LATTAFA YARA MOI', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 16.50, salePriceARS: 56494, discountPriceARS: 45195, stock: 1 },
  { name: 'LATTAFA YARA TOUS', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 16.50, salePriceARS: 56494, discountPriceARS: 45195, stock: 1 },

  // === CATALOGO COMPLETO (Page 3 - available to order, stock 0) ===
  // Masculino Árabe
  { name: 'AL HARAMAIN AMBER OUD BLEU EDITION', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 37.99, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AL HARAMAIN AMBER OUD DUBAI NIGHT', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 33.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AL HARAMAIN AMBER OUD GOLD', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 36.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AL HARAMAIN AMBER OUD GOLD EDITION EXTREME', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 39.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AL HARAMAIN AMBER OUD PRIVATE EDITION', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 49.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AL HARAMAIN AMBER OUD ROUGE', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 50.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AL HARAMAIN AMBER OUD ULTRA VIOLET', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 50.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AL HARAMAIN AMBER OUD WHITE EDITION', brand: 'Al Haramain', category: 'perfume_arabe', gender: 'masculino', costUSD: 37.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT BLING', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 38.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT IMPERIALE', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 28.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT MILESTONE', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 23.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT OUD', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 42.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT PRECIEUX I', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 35.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT PRECIEUX IV', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 43.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT SILLAGE', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 25.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF CLUB DE NUIT UNTOLD', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 30.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF ODYSSEY CANDEE', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF ODYSSEY HOMME BLACK', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.40, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF ODYSSEY HOMME WHITE EDITION', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF ODYSSEY LIMONI FRESH EDITION', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF ODYSSEY MARSHMALLOW', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 31.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF ODYSSEY SPECTRA', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 16.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMAF ODYSSEY WILD ONE', brand: 'Armaf', category: 'perfume_arabe', gender: 'masculino', costUSD: 16.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA BLEU', brand: 'Bharara', category: 'perfume_arabe', gender: 'masculino', costUSD: 34.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA CHOCOLATE', brand: 'Bharara', category: 'perfume_arabe', gender: 'masculino', costUSD: 39.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA DOUBLE BLEU', brand: 'Bharara', category: 'perfume_arabe', gender: 'masculino', costUSD: 34.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA KING', brand: 'Bharara', category: 'perfume_arabe', gender: 'masculino', costUSD: 37.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA NICHE', brand: 'Bharara', category: 'perfume_arabe', gender: 'masculino', costUSD: 34.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA ONYX', brand: 'Bharara', category: 'perfume_arabe', gender: 'masculino', costUSD: 39.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'FRENCH AVENUE COCOA MORADO', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 21.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'FRENCH AVENUE GHOST SPECTRE', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 25.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'FRENCH AVENUE VENENO BIANCO', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 36.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'FRENCH AVENUE VENENO', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 31.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'FRENCH AVENUE VULCAN BAIE', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 27.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'FRENCH AVENUE VULCAN SABLE', brand: 'French Avenue', category: 'perfume_arabe', gender: 'masculino', costUSD: 23.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA AL NOBLE AMEER', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 15.25, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA AL NOBLE SAFEER', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 15.35, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA AL NOBLE WAZEER', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 15.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA ART OF ARABIA II', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 22.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA ART OF ARABIA III', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 22.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA ASAD BOURBON', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA ASAD ELIXIR', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 22.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA ECLAIRE BANOFFI', brand: 'Lattafa', category: 'perfume_arabe', gender: 'unisex', costUSD: 24.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA ECLAIRE PISTACHE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'unisex', costUSD: 25.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA FAKHAR EAU DE PARFUM MASCULINO', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA FAKHAR EXTRAIT', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 16.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA FAKHAR PLATIN', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 18.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA HAYAATI AL MALEKY', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 10.35, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA HAYAATI', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 10.30, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA HAYAATI GOLD ELIXIR', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 9.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA HIS CONFESSION', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 21.25, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA KHAMRAH DUKHAN', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 16.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA KHAMRAH QAHWA', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 15.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA NICHE EMARATI LUJAIN', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 27.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA NICHE EMARATI REMAS', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 27.95, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PETRA', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE AL QIAM GOLD', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.25, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE ANSAAM GOLD', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE ARTISAN ETHNIQUE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 23.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE ISHQ AL SHUYUKH GOLD', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 16.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE ISHQ AL SHUYUKH SILVER', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.25, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE MAHARJAN GOLD', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE NEBRAS', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE THARWAH GOLD', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 25.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA PRIDE VINTAGE RADIO', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 17.20, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA QAED AL FURSAN BLACK', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 14.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA TERIAQ', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.90, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA THE KINGDOM MAN WHITE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'masculino', costUSD: 19.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'RASASI HAWAS ELIXIR', brand: 'Rasasi', category: 'perfume_arabe', gender: 'masculino', costUSD: 22.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'RASASI HAWAS KOBRA', brand: 'Rasasi', category: 'perfume_arabe', gender: 'masculino', costUSD: 37.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'RASASI HAWAS MALIBU', brand: 'Rasasi', category: 'perfume_arabe', gender: 'masculino', costUSD: 38.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'RASASI HAWAS BLACK', brand: 'Rasasi', category: 'perfume_arabe', gender: 'masculino', costUSD: 26.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'RASASI HAWAS ICE', brand: 'Rasasi', category: 'perfume_arabe', gender: 'masculino', costUSD: 34.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },

  // === PERFUMES DISEÑADOR MASCULINOS ===
  { name: 'AZZARO THE MOST WANTED PARFUM', brand: 'Azzaro', category: 'perfume_diseñador', gender: 'masculino', costUSD: 63.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'AZZARO WANTED EDP', brand: 'Azzaro', category: 'perfume_diseñador', gender: 'masculino', costUSD: 52.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BAD BOY COBALT EDP 100ML', brand: 'Carolina Herrera', category: 'perfume_diseñador', gender: 'masculino', costUSD: 75.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'CHANEL ALLURE HOMME SPORT EDT 100ML', brand: 'Chanel', category: 'perfume_diseñador', gender: 'masculino', costUSD: 115.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'CHANEL ALLURE HOMME SPORT EXTREME 100ML', brand: 'Chanel', category: 'perfume_diseñador', gender: 'masculino', costUSD: 130.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'DIOR SAUVAGE EDP 100ML', brand: 'Dior', category: 'perfume_diseñador', gender: 'masculino', costUSD: 90.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'DIOR SAUVAGE ELIXIR 100ML', brand: 'Dior', category: 'perfume_diseñador', gender: 'masculino', costUSD: 160.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'DIOR SAUVAGE EAU FORTE PARFUM 100ML', brand: 'Dior', category: 'perfume_diseñador', gender: 'masculino', costUSD: 125.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMANI ACQUA DI GIO PROFONDO EDP 100ML', brand: 'Armani', category: 'perfume_diseñador', gender: 'masculino', costUSD: 91.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMANI ACQUA DI GIO EDT 100ML', brand: 'Armani', category: 'perfume_diseñador', gender: 'masculino', costUSD: 51.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'JPG LE MALE EDT 125ML', brand: 'Jean Paul Gaultier', category: 'perfume_diseñador', gender: 'masculino', costUSD: 58.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'PACO RABANNE 1 MILLION ELIXIR 100ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'masculino', costUSD: 69.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'PACO RABANNE INVICTUS PARFUM 100ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'masculino', costUSD: 63.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'PACO RABANNE PHANTOM EDP INTENSE 100ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'masculino', costUSD: 63.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'VALENTINO UOMO BORN IN ROMA EDP INTENSE 100ML', brand: 'Valentino', category: 'perfume_diseñador', gender: 'masculino', costUSD: 120.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'VERSACE EROS FLAME EDP 100ML', brand: 'Versace', category: 'perfume_diseñador', gender: 'masculino', costUSD: 58.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'YSL Y EDP 100ML', brand: 'Yves Saint Laurent', category: 'perfume_diseñador', gender: 'masculino', costUSD: 99.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'XERJOFF NAXOS', brand: 'Xerjoff', category: 'perfume_diseñador', gender: 'masculino', costUSD: 162.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'TOM FORD OMBRE LEATHER', brand: 'Tom Ford', category: 'perfume_diseñador', gender: 'masculino', costUSD: 165.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },

  // === FEMENINO CATALOGO ===
  { name: 'Afnan 9am Femme (catálogo)', brand: 'Afnan', category: 'perfume_arabe', gender: 'femenino', costUSD: 25.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA GODDESS', brand: 'Bharara', category: 'perfume_arabe', gender: 'femenino', costUSD: 36.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA NICHE FEMME', brand: 'Bharara', category: 'perfume_arabe', gender: 'femenino', costUSD: 36.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA QUEEN', brand: 'Bharara', category: 'perfume_arabe', gender: 'femenino', costUSD: 36.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'BHARARA ROSE', brand: 'Bharara', category: 'perfume_arabe', gender: 'femenino', costUSD: 37.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA HER CONFESSION', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 21.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA MAYAR CHERRY INTENSE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 14.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA MAYAR NATURAL INTENSE', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 14.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA YARA ELIXIR', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 20.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA BADEE AL OUD NOBLE BLUSH', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 18.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LATTAFA BADEE AL OUD SUBLIME', brand: 'Lattafa', category: 'perfume_arabe', gender: 'femenino', costUSD: 18.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'RASASI HAWAS FOR HER', brand: 'Rasasi', category: 'perfume_arabe', gender: 'femenino', costUSD: 18.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },

  // === PERFUMES DISEÑADOR FEMENINOS ===
  { name: 'CHANEL COCO EDP 100ML', brand: 'Chanel', category: 'perfume_diseñador', gender: 'femenino', costUSD: 147.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'CHANEL COCO MADEMOISELLE EDP 100ML', brand: 'Chanel', category: 'perfume_diseñador', gender: 'femenino', costUSD: 147.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'DIOR J\'ADORE EDP 100ML', brand: 'Dior', category: 'perfume_diseñador', gender: 'femenino', costUSD: 89.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'DIOR MISS DIOR EDP 100ML', brand: 'Dior', category: 'perfume_diseñador', gender: 'femenino', costUSD: 92.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'ARMANI MY WAY EDP 90ML', brand: 'Armani', category: 'perfume_diseñador', gender: 'femenino', costUSD: 93.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'JPG LA BELLE EDP 100ML', brand: 'Jean Paul Gaultier', category: 'perfume_diseñador', gender: 'femenino', costUSD: 69.50, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'LANCÔME LA VIE EST BELLE EDP 100ML', brand: 'Lancôme', category: 'perfume_diseñador', gender: 'femenino', costUSD: 71.75, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'PACO RABANNE FAME EDP 80ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'femenino', costUSD: 71.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'PACO RABANNE LADY MILLION EDP 80ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'femenino', costUSD: 59.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'PACO RABANNE OLYMPEA EDP 80ML', brand: 'Paco Rabanne', category: 'perfume_diseñador', gender: 'femenino', costUSD: 67.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
  { name: 'VALENTINO DONNA BORN IN ROMA EDP 100ML', brand: 'Valentino', category: 'perfume_diseñador', gender: 'femenino', costUSD: 115.00, salePriceARS: 0, discountPriceARS: 0, stock: 0 },
];

export function seedProducts() {
  const existing = getProducts();
  if (existing.length > 0) return; // Don't overwrite existing data

  const settings = getSettings();
  const products: Product[] = rawProducts.map(raw => {
    // Auto-calculate sale price for catalog items (no price set)
    // Using the formula from Excel: costUSD * 1.15 (pasero) * exchangeRate * markup
    let salePriceARS = raw.salePriceARS;
    let discountPriceARS = raw.discountPriceARS;
    
    if (salePriceARS === 0 && raw.costUSD > 0) {
      // Calculate suggested price: costWithPasero * exchangeRate * 1.95 markup (matching Excel ~95% margin)
      const costWithPasero = raw.costUSD * (1 + settings.customsPercent / 100);
      salePriceARS = Math.round(costWithPasero * settings.exchangeRate * 1.95);
      discountPriceARS = Math.round(salePriceARS * 0.8);
    }

    const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
      raw.costUSD, settings.customsPercent, salePriceARS, settings.exchangeRate
    );

    return {
      id: crypto.randomUUID(),
      name: raw.name,
      brand: raw.brand,
      category: raw.category,
      gender: raw.gender,
      costUSD: raw.costUSD,
      customsFee,
      totalCostUSD,
      salePriceARS,
      discountPriceARS: discountPriceARS || undefined,
      profitPerUnitARS,
      profitPerUnitUSD,
      stock: raw.stock,
      createdAt: new Date().toISOString(),
    };
  });

  saveProducts(products);
}
