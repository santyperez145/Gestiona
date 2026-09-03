/**
 * La primera publicación no es un panel de analítica ni un aviso de Mercado Pago.
 *
 * Tres trampas del camino online:
 * 1. El wizard mandaba a Commerce con el toast «Publicá la tienda». POS manda
 *    a cargar el producto. Sin catálogo no hay nada que publicar.
 * 2. El overview abre con Revenue $0, un embudo en cero y «Activar Gestiona
 *    Pay». Transferencia ya cobra; el catálogo no está. Pay no es el primer clic.
 * 3. «Checkout iniciado» era `carritos_con_items * 0.37`. Un número plausible
 *    que nadie midió. `sinSimulacion` cubre el chat de IA; este embudo era el
 *    mismo vicio en otra pantalla.
 */

export type StoreCartSession = {
  status: string | null;
  items: unknown;
};

export type StoreFunnelStep = {
  label: string;
  value: number;
  pct: number;
  color: string;
};

export function storeWizardFinishCopy() {
  return {
    toast: 'Ruta online elegida. Cargá un producto con precio y stock; después publicás la tienda.',
  };
}

export function storeShouldShowPerformanceChrome(input: {
  sessionCount: number;
  orderCount: number;
}): boolean {
  return input.sessionCount > 0 || input.orderCount > 0;
}

/**
 * El banner de Pay no es el siguiente clic de publicar.
 *
 * Transferencia es el default. El checkout no ofrece Mercado Pago hasta que
 * Pay esté vivo. Empujar «Activar Gestiona Pay» encima del checklist hacía
 * que el primer producto aterrizara en OAuth en vez de en slug, entrega y
 * legales. El aviso de `pay-rail` sigue en el estado de la tienda.
 */
export function storeShouldLeadWithPay(input: {
  publishedProducts: number;
  paymentConnected: boolean;
  wantsMercadoPago: boolean;
  hasOfflinePayment: boolean;
}): boolean {
  if (input.publishedProducts === 0) return false;
  if (input.paymentConnected) return false;
  if (!input.wantsMercadoPago) return false;
  if (input.hasOfflinePayment) return false;
  return true;
}

/** En Pagos y envíos, identidad antes de OAuth cuando aún no hay fila. */
export function storeShouldLeadSettingsWithIdentity(
  storeId: string | null | undefined,
): boolean {
  return !storeId;
}

/** Tras el primer Guardar: puente al catálogo (Pay puede esperar). */
export function storeAfterCreateCopy() {
  return {
    title: 'Tienda creada. Ahora el catálogo',
    description:
      'Ya hay vitrina con dirección. Cargá un producto con precio y stock; después publicás. Gestiona Pay puede esperar.',
    actionLabel: 'Cargar el primer producto',
    href: '/productos?onboarding=1&goal=online',
  };
}

/**
 * Con tienda ya creada y transferencia habilitada sin CBU/alias, el panel no
 * puede abrir con OAuth de Pay: es el mismo error que identity-first, un paso
 * después. Tiendanube/Shopify: el medio offline usable antes del gateway.
 */
export function storeShouldLeadSettingsWithBank(input: {
  storeId: string | null | undefined;
  offersTransfer: boolean;
  bankReady: boolean;
}): boolean {
  if (!input.storeId) return false;
  if (!input.offersTransfer) return false;
  if (input.bankReady) return false;
  return true;
}

export function storeBankLeadCopy() {
  return {
    title: 'Cargá CBU o alias para cobrar',
    description:
      'Transferencia ya está marcada. Sin CBU ni alias el pedido dice «te vamos a escribir» y no hay primera venta sola. Gestiona Pay puede esperar.',
  };
}

/**
 * El draft activa retiro. Sin dirección el checklist bloquea publicar y el
 * comprador ve «te contactamos». Square/Shopify: lugar del pickup antes del
 * gateway. Va después de identidad y CBU.
 */
export function storeShouldLeadSettingsWithPickup(input: {
  storeId: string | null | undefined;
  pickupEnabled: boolean;
  addressReady: boolean;
}): boolean {
  if (!input.storeId) return false;
  if (!input.pickupEnabled) return false;
  if (input.addressReady) return false;
  return true;
}

export function storePickupLeadCopy() {
  return {
    title: 'Decí dónde se retira',
    description:
      'Retiro en tienda está activo. Sin dirección el pedido dice que vas a contactar al comprador. Gestiona Pay puede esperar.',
  };
}

/**
 * Al crear la tienda hay que sembrar borradores legales.
 * Si espera a que abran Páginas, el checklist dice «faltan» y el 2º comercio
 * no publica. Tiendanube/Shopify: plantillas al nacer la tienda. Siempre
 * draft — publicar sin CUIT/razón sería firmar por el dueño.
 */
export function storeShouldSeedPagesOnCreate(creatingStore: boolean): boolean {
  return creatingStore === true;
}

/**
 * Sin legales publicados el checklist bloquea. Después de CBU y retiro, el
 * panel no puede abrir con OAuth: el próximo clic es Páginas (Tiendanube /
 * Shopify: políticas antes de ir live). No publica por el dueño.
 */
export function storeShouldLeadSettingsWithLegal(input: {
  storeId: string | null | undefined;
  legalReady: boolean;
}): boolean {
  if (!input.storeId) return false;
  if (input.legalReady) return false;
  return true;
}

export function storeLegalLeadCopy() {
  return {
    title: 'Completá y publicá términos y privacidad',
    description:
      'Sin razón social, CUIT y páginas publicadas el comprador no sabe quién vende. Usá el generador en Páginas; Gestiona Pay puede esperar.',
    actionLabel: 'Ir a Páginas',
  };
}

/**
 * Tras legales, el correo de avisos va antes de OAuth. Sin casilla de la tienda
 * la primera venta cae al inbox del dueño o nadie la ve. Shopify/Tiendanube:
 * contacto de la tienda en el setup, no Pay primero.
 */
export function storeShouldLeadSettingsWithEmail(input: {
  storeId: string | null | undefined;
  emailReady: boolean;
}): boolean {
  if (!input.storeId) return false;
  if (input.emailReady) return false;
  return true;
}

export function storeEmailLeadCopy() {
  return {
    title: 'Email para avisos de venta',
    description:
      'Cuando alguien compre, el aviso tiene que llegar a una casilla que mirás. Si falta, cae al correo del dueño. Gestiona Pay puede esperar.',
  };
}

/** Sin fila en ecommerce_stores el 2º comercio no puede publicar ni legales. */
export function storeShouldShowStoreMissingHandoff(
  storeId: string | null | undefined,
): boolean {
  return !storeId;
}

export function storeMissingCopy() {
  return {
    title: 'Creá la tienda online',
    description:
      'Todavía no hay vitrina. Guardá nombre y dirección (slug) para poder cargar legales, banners y compartir el link. El catálogo es el del Business Core.',
    actionLabel: 'Configurar y guardar',
  };
}

/** Badge del header: no confundir «sin crear» con «inactiva». */
export function storeStatusLabel(input: {
  storeExists: boolean;
  isActive: boolean;
  canPublish: boolean;
  readinessSummary: string;
}): string {
  if (!input.storeExists) return '○ Sin crear';
  if (!input.isActive) return '○ Inactiva';
  if (input.canPublish) return '● Activa';
  return `▲ ${input.readinessSummary}`;
}

/** Sin catálogo no hay vitrina: el CTA manda a productos aunque no venga del wizard. */
export function storeShouldShowCatalogHandoff(publishedProducts: number): boolean {
  return Number(publishedProducts) <= 0;
}

/** El recorte de primera publicación no aplica a una vitrina ya activa. */
export function storeShouldShowAfterCatalog(input: {
  fromWizard: boolean;
  publishedProducts: number;
  storeActive: boolean;
}): boolean {
  return input.fromWizard && input.publishedProducts > 0 && !input.storeActive;
}

export function storeAfterCatalogCopy(input: { canPublish: boolean }) {
  if (input.canPublish) {
    return {
      title: 'Listo para publicar',
      description:
        'El catálogo está y transferencia ya cobra. Publicá para que el link funcione. Gestiona Pay puede esperar.',
    };
  }
  return {
    title: 'Ahora publicá la tienda',
    description:
      'El catálogo ya está. Falta una dirección para compartir, una forma de entregar y quién vende. Transferencia ya cobra; Gestiona Pay puede esperar.',
  };
}

/**
 * Nudges del camino a publicar: pesos, legales y cobertura.
 * Ordenados por impacto en el checkout (no por módulo).
 */
export type StorePublishNudge = {
  id: 'weights' | 'legal' | 'shipping';
  title: string;
  detail: string;
  actionLabel: string;
  actionHref: string;
};

export function storePublishNudges(input: {
  productsWithoutWeight: number;
  legalMissingOrDraft: number;
  shippingGaps: boolean;
}): StorePublishNudge[] {
  const out: StorePublishNudge[] = [];
  if (input.shippingGaps) {
    out.push({
      id: 'shipping',
      title: 'Completar el tarifario',
      detail:
        'Sin tarifas en casi todo el país el checkout parece andar y falla afuera de tu zona. Con retiro habilitado el comprador sólo puede ir a buscarlo.',
      actionLabel: 'Precios por provincia',
      actionHref: '/envios?tab=zonas',
    });
  }
  if (input.legalMissingOrDraft > 0) {
    out.push({
      id: 'legal',
      title: 'Publicar términos y privacidad',
      detail:
        'Las páginas legales en plantilla o borrador no alcanzan: el comprador tiene que ver quién vende antes de dejar datos.',
      actionLabel: 'Revisar legales',
      actionHref: '/tienda-online?tab=pages',
    });
  }
  if (input.productsWithoutWeight > 0) {
    out.push({
      id: 'weights',
      title: 'Completar pesos',
      detail: `${input.productsWithoutWeight} ${input.productsWithoutWeight === 1 ? 'producto' : 'productos'} sin peso: el envío se cotiza con estimado.`,
      actionLabel: 'Completar pesos',
      actionHref: '/productos?completar=pesos',
    });
  }
  return out;
}

/** El CTA de primera publicación: activar de verdad, no mandar a buscar un interruptor. */
export function storePublishCta(input: { canPublish: boolean }): {
  kind: 'activate' | 'complete';
  label: string;
} {
  if (input.canPublish) {
    return { kind: 'activate', label: 'Publicar la tienda' };
  }
  return { kind: 'complete', label: 'Pagos y envíos' };
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return parseFloat(((part / total) * 100).toFixed(1));
}

export function storeFunnelFromCarts(sessions: StoreCartSession[]): StoreFunnelStep[] {
  const total = sessions.length;
  const withItems = sessions.filter((row) => Array.isArray(row.items) && row.items.length > 0).length;
  const converted = sessions.filter((row) => row.status === 'converted').length;
  return [
    { label: 'Sesiones', value: total, pct: total > 0 ? 100 : 0, color: 'bg-blue-400' },
    { label: 'Con items en carrito', value: withItems, pct: pct(withItems, total), color: 'bg-indigo-400' },
    { label: 'Órdenes completadas', value: converted, pct: pct(converted, total), color: 'bg-emerald-400' },
  ];
}

export function storeAbandonedCartCount(sessions: StoreCartSession[]): number {
  return sessions.filter((row) => row.status === 'abandoned').length;
}

/**
 * El link que el comercio comparte. Sin slug no hay puerta.
 * El origin lo pone el navegador; no se inventa un dominio propio (F4).
 */
export function urlPublicaDeTienda(
  origin: string,
  slug: string | null | undefined,
): string | null {
  const host = origin.trim().replace(/\/$/, '');
  const s = (slug ?? '').trim();
  if (!host || !s) return null;
  return `${host}/tienda/${s}`;
}
