export function productMatchesCode(product: { sku?: string | null; barcode?: string | null; barcode_aliases?: string[] | null }, input: string): boolean {
  const code = input.trim();
  return !!code && (product.sku === code || product.barcode === code || !!product.barcode_aliases?.includes(code));
}
