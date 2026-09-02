/**
 * Reglas puras de honestidad para campañas WhatsApp.
 * El envío real vive en Meta Cloud vía Edge; acá sólo se decide si la UI puede ofrecer Enviar.
 */

export function whatsappCampaignChannelReady(input: {
  whatsapp_listo?: boolean | null;
}): boolean {
  return input.whatsapp_listo === true;
}

/** Un resultado con 0 entregas no es un éxito, aunque el invoke haya sido 2xx. */
export function whatsappCampaignSendSucceeded(result: {
  sent?: number | null;
  error?: string | null;
}): boolean {
  if (result.error) return false;
  return Number(result.sent ?? 0) > 0;
}
