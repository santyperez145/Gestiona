export interface PricingSettingsForm {
  discountCash: string;
  discountTransfer: string;
  discountDebit: string;
  discountCredit: string;
  volumeThreshold: string;
  volumeDiscount: string;
  decantMargin10: string;
  decantMargin5: string;
  decantMargin2_5: string;
}

export interface PricingSettingsUpdate {
  discount_cash_percent: number;
  discount_transfer_percent: number;
  discount_debit_percent: number;
  discount_credit_percent: number;
  volume_discount_threshold: number;
  volume_discount_percent: number;
  decant_margin_10ml: number;
  decant_margin_5ml: number;
  decant_margin_2_5ml: number;
}

function decimal(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function paymentDiscount(value: string): number {
  return Math.min(90, Math.max(0, decimal(value, 0)));
}

/**
 * Contrato único entre Ajustes y Caja para la sección Precios.
 *
 * Caja vuelve a acotar estos porcentajes en servidor; esta normalización evita
 * que el formulario persista un valor distinto al que la venta terminaría
 * aplicando y acepta la coma decimal habitual en Argentina.
 */
export function buildPricingSettingsUpdate(form: PricingSettingsForm): PricingSettingsUpdate {
  return {
    discount_cash_percent: paymentDiscount(form.discountCash),
    discount_transfer_percent: paymentDiscount(form.discountTransfer),
    discount_debit_percent: paymentDiscount(form.discountDebit),
    discount_credit_percent: paymentDiscount(form.discountCredit),
    volume_discount_threshold: Math.max(2, integer(form.volumeThreshold, 3)),
    volume_discount_percent: Math.min(90, Math.max(0, decimal(form.volumeDiscount, 10))),
    decant_margin_10ml: Math.max(0, decimal(form.decantMargin10, 250)),
    decant_margin_5ml: Math.max(0, decimal(form.decantMargin5, 350)),
    decant_margin_2_5ml: Math.max(0, decimal(form.decantMargin2_5, 500)),
  };
}
