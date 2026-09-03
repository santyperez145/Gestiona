export const BRAND_NAME = 'Nerqia';
export const BRAND_DOMAIN = 'nerqia.app';
export const BRAND_ORIGIN = `https://${BRAND_DOMAIN}`;
export const BRAND_MARK_SRC = '/brand/nerqia-mark.png';

export const BRAND_PRODUCTS = {
  business: `${BRAND_NAME} Business`,
  commerce: `${BRAND_NAME} Commerce`,
  finance: `${BRAND_NAME} Finance`,
  pay: `${BRAND_NAME} Pay`,
  platform: `${BRAND_NAME} Platform`,
} as const;

/**
 * Stable identifiers keep the former technical namespace so sessions,
 * payment methods and webhook consumers do not break during the rebrand.
 */
export const LEGACY_TECHNICAL_NAMESPACE = 'gestiona';
