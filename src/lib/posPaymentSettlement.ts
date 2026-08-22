export interface PosSettlementPreview {
  gross: number;
  providerFee: number;
  providerFeeIva: number;
  platformFee: number;
  net: number;
  error?: string;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Vista previa del mismo residuo que calcula
 * `confirm_pos_payment_settlement` en PostgreSQL. La base sigue siendo la
 * autoridad; esto evita ofrecer un botón que sabemos que va a rechazar.
 */
export function previewPosSettlement(
  grossInput: number,
  providerFeeInput: number,
  providerFeeIvaInput: number,
  platformFeeInput: number,
): PosSettlementPreview {
  const values = [grossInput, providerFeeInput, providerFeeIvaInput, platformFeeInput];
  if (values.some(value => !Number.isFinite(value))) {
    return {
      gross: 0,
      providerFee: 0,
      providerFeeIva: 0,
      platformFee: 0,
      net: 0,
      error: 'Completá todos los importes con números válidos.',
    };
  }

  const gross = money(grossInput);
  const providerFee = money(providerFeeInput);
  const providerFeeIva = money(providerFeeIvaInput);
  const platformFee = money(platformFeeInput);

  if (gross <= 0) {
    return { gross, providerFee, providerFeeIva, platformFee, net: 0, error: 'El bruto debe ser mayor a cero.' };
  }
  if (providerFee < 0 || providerFeeIva < 0 || platformFee < 0) {
    return { gross, providerFee, providerFeeIva, platformFee, net: 0, error: 'Los costos no pueden ser negativos.' };
  }

  const net = money(gross - providerFee - providerFeeIva - platformFee);
  if (net < 0) {
    return { gross, providerFee, providerFeeIva, platformFee, net, error: 'Los costos superan el importe bruto.' };
  }

  return { gross, providerFee, providerFeeIva, platformFee, net };
}
