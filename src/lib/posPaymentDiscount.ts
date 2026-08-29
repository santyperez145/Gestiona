import {
  porcentajeDe,
  precioConMedioDePago,
  type PaymentDiscounts,
} from "@/lib/paymentDiscount";

export interface PosPaymentDiscountSettings {
  discount_cash_percent?: number | null;
  discount_transfer_percent?: number | null;
  discount_debit_percent?: number | null;
  discount_credit_percent?: number | null;
}

/**
 * Adapta las columnas históricas de `settings` al vocabulario del POS.
 *
 * QR no se inventa: hoy no tiene una columna propia y por eso vale 0. Si se
 * decide ofrecer ese incentivo tendrá que nacer como una configuración
 * explícita y con su espejo SQL.
 */
export function posPaymentDiscounts(
  settings: PosPaymentDiscountSettings | null | undefined,
): PaymentDiscounts {
  return {
    efectivo: Number(settings?.discount_cash_percent ?? 0),
    transferencia: Number(settings?.discount_transfer_percent ?? 0),
    debito: Number(settings?.discount_debit_percent ?? 0),
    credito: Number(settings?.discount_credit_percent ?? 0),
  };
}

/**
 * El cobro dividido no aplica un descuento automático ambiguo. Cada parte
 * puede tener una regla distinta y el monto del primer medio ya está expresado
 * sobre el total final; ponderarlo volvería circular la cuenta. La UI lo dice
 * de forma explícita y el servidor aplica la misma regla.
 */
export function posPaymentDiscountPercent(
  method: string | null | undefined,
  settings: PosPaymentDiscountSettings | null | undefined,
  splitMode = false,
): number {
  if (splitMode) return 0;
  return porcentajeDe(method, posPaymentDiscounts(settings));
}

/**
 * Precio unitario mostrado por Caja.
 *
 * `currentPrice` ya incluye la mejor oferta/promoción. El descuento del medio
 * se calcula contra lista y compite con ella: gana el menor, nunca se acumulan
 * dos descuentos automáticos por accidente. Espejo de
 * `create_sales_transaction_v2` desde 20260829000040.
 */
export function posPriceForPayment(
  listPrice: number,
  currentPrice: number,
  method: string | null | undefined,
  settings: PosPaymentDiscountSettings | null | undefined,
  splitMode = false,
): number {
  if (splitMode) return Number(currentPrice) || 0;
  return precioConMedioDePago(
    listPrice,
    currentPrice,
    method,
    posPaymentDiscounts(settings),
  );
}
