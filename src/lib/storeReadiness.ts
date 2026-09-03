/**
 * ¿Esta tienda puede vender de verdad?
 *
 * Hoy se puede publicar una tienda sin zonas de envío, sin forma de cobrar y sin
 * peso en los productos. Queda online, el comprador llega, y falla en silencio:
 * el checkout no cotiza, o cotiza y no hay con qué pagar. Desde afuera parece
 * que la plataforma no funciona.
 *
 * Este módulo evalúa esas condiciones y separa lo que **impide** vender de lo
 * que sólo conviene mejorar. Es puro y testeado porque es la diferencia entre
 * "publiqué mi tienda" y "mi tienda vende".
 */

import { firstProductPath } from '@/lib/activationHandoff';
import { accionLegalDelChecklist } from '@/lib/legalPages';
import { storeBankTransferReady, storeOffersBankTransfer } from '@/lib/storeTransfer';
import { esMedioGestionaPay } from '@/lib/gestionaPay';

export type CheckSeverity = 'blocker' | 'warning' | 'suggestion';

export interface ReadinessCheck {
  id: string;
  title: string;
  /** Qué pasa si no se resuelve, en términos del comprador */
  detail: string;
  severity: CheckSeverity;
  done: boolean;
  actionLabel?: string;
  actionHref?: string;
}

export interface StoreReadinessInput {
  store: {
    is_active?: boolean;
    slug?: string | null;
    name?: string | null;
    logo_url?: string | null;
    description?: string | null;
    meta_title?: string | null;
    payment_methods?: string[] | null;
    shipping_mode?: string | null;
    pickup_enabled?: boolean | null;
    pickup_address?: string | null;
    shipping_cost?: number | null;
    notification_email?: string | null;
  } | null;
  /** Productos publicables: con stock y con precio */
  publishedProducts: number;
  /** Cuántos de esos no declaran peso (sólo pesa en modo zonas) */
  productsWithoutWeight: number;
  /** Zonas activas de la organización */
  shippingZones: number;
  /** Zonas que además tienen al menos una tarifa cargada */
  zonesWithRates: number;
  /** Provincias cubiertas por alguna zona, de 24 */
  coveredProvinces: number;
  /** MercadoPago efectivamente conectado (token o OAuth) */
  paymentConnected: boolean;
  /** CBU / alias de settings (o flag ya resuelto desde el panel) */
  bank_cbu?: string | null;
  bank_alias?: string | null;
  /** Preferí pasar bank_cbu/alias; el flag queda por compatibilidad de tests. */
  bankTransferReady?: boolean;
  /** Páginas que faltan, siguen como plantilla o todavía son borradores. */
  legalPages: {
    missingOrTemplate: number;
    drafts: number;
  };
}

export interface StoreReadiness {
  checks: ReadinessCheck[];
  blockers: ReadinessCheck[];
  warnings: ReadinessCheck[];
  /** false = publicar la tienda hoy no le sirve a nadie */
  canPublish: boolean;
  /** 0–100, sólo para dar sensación de progreso */
  score: number;
}

const TOTAL_PROVINCES = 24;

/** Medios de pago que no necesitan pasarela para poder cobrar. */
const OFFLINE_METHODS = ['transferencia', 'efectivo'];

export function evaluateStoreReadiness(input: StoreReadinessInput): StoreReadiness {
  const s = input.store;
  const checks: ReadinessCheck[] = [];

  const methods = s?.payment_methods ?? [];
  const mode = s?.shipping_mode ?? 'flat';
  const pickup = !!s?.pickup_enabled;

  // ── Sin productos no hay tienda ─────────────────────────────────────────
  checks.push({
    id: 'products',
    title: 'Publicar al menos un producto',
    detail: input.publishedProducts === 0
      ? 'La tienda se ve vacía: sólo aparecen productos con stock y con precio cargado.'
      : `${input.publishedProducts} ${input.publishedProducts === 1 ? 'producto publicado' : 'productos publicados'}.`,
    severity: 'blocker',
    done: input.publishedProducts > 0,
    actionLabel: 'Ir a Productos',
    actionHref: input.publishedProducts === 0 ? firstProductPath('online') : '/productos',
  });

  // ── Poder cobrar ────────────────────────────────────────────────────────
  const hasOffline = methods.some(m => OFFLINE_METHODS.includes(m));
  const wantsPay = methods.some(esMedioGestionaPay);
  const canCollect = hasOffline || (wantsPay && input.paymentConnected);

  checks.push({
    id: 'payments',
    title: 'Tener una forma de cobrar',
    detail: methods.length === 0
      ? 'No hay ningún medio de pago habilitado: el comprador llega al final y no puede pagar.'
      : !canCollect
        ? 'Gestiona Pay está marcado pero no está activo, y no hay otro medio: el checkout no puede cobrar.'
        : wantsPay && input.paymentConnected
          ? 'Gestiona Pay activo (procesado con Mercado Pago).'
          : 'Cobro por transferencia o efectivo habilitado.',
    severity: 'blocker',
    done: canCollect,
    actionLabel: wantsPay && !input.paymentConnected ? 'Activar Gestiona Pay' : 'Ver medios de pago',
    // Medios de la tienda y OAuth de Pay viven en Commerce → Pagos y envíos.
    actionHref: '/tienda-online?tab=settings',
  });

  // Transferencia sin CBU/alias no cobra: el pedido queda en «te escribimos».
  if (storeOffersBankTransfer(methods)) {
    const ready = input.bankTransferReady === true
      || storeBankTransferReady({
        bank_cbu: input.bank_cbu,
        bank_alias: input.bank_alias,
      });
    checks.push({
      id: 'bank-transfer',
      title: 'Cargar CBU o alias',
      detail: ready
        ? 'El comprador ve los datos para transferir al cerrar el pedido.'
        : 'Transferencia está habilitada pero sin CBU ni alias: el checkout cobra «en teoría» y el pedido dice que vas a escribir. Sin eso no hay primera venta sola.',
      severity: 'blocker',
      done: ready,
      actionLabel: 'Cargar datos bancarios',
      actionHref: '/tienda-online?tab=settings',
    });
  }

  // El interruptor de Gestiona Pay no cobra: cobra la conexión OAuth.
  // Con transferencia el bloqueante de arriba no dispara, y el comprador igual
  // veía un medio muerto. Aviso, no bloqueo: todavía se puede vender offline.
  checks.push({
    id: 'pay-rail',
    title: 'Activar Gestiona Pay',
    detail: !wantsPay
      ? 'La tienda no ofrece Gestiona Pay.'
      : input.paymentConnected
        ? 'Gestiona Pay activo: el checkout puede cobrar online.'
        : hasOffline
          ? 'Gestiona Pay está marcado, pero el checkout no lo va a ofrecer hasta que actives la cuenta. El comprador sólo ve transferencia o efectivo.'
          : 'Sin Gestiona Pay activo el checkout no puede cobrar online.',
    severity: 'warning',
    done: !wantsPay || input.paymentConnected,
    actionLabel: 'Activar Gestiona Pay',
    actionHref: '/tienda-online?tab=settings',
  });

  // ── Poder entregar ──────────────────────────────────────────────────────
  if (pickup) {
    const address = String(s?.pickup_address ?? '').trim();
    checks.push({
      id: 'pickup-address',
      title: 'Decir dónde se retira',
      detail: address
        ? 'Dirección de retiro cargada.'
        : 'Retiro en tienda está activo pero sin dirección: el comprador ve «te vamos a contactar» en vez de un lugar.',
      severity: 'blocker',
      done: !!address,
      actionLabel: 'Cargar dirección',
      actionHref: '/tienda-online?tab=settings',
    });
  }

  if (mode === 'zones') {
    const canQuote = input.zonesWithRates > 0;
    checks.push({
      id: 'shipping-rates',
      title: 'Cargar tarifas de envío',
      detail: input.shippingZones === 0
        ? 'La tienda cotiza por zona pero no hay ninguna zona creada: el checkout no va a poder calcular el envío.'
        : !canQuote
          ? `Hay ${input.shippingZones} ${input.shippingZones === 1 ? 'zona' : 'zonas'} sin ninguna tarifa cargada: el checkout no puede cotizar.`
          : `${input.zonesWithRates} de ${input.shippingZones} zonas con tarifas.`,
      // Con retiro en tienda habilitado el comprador todavía tiene una salida,
      // así que no impide vender: molesta, no bloquea.
      severity: pickup ? 'warning' : 'blocker',
      done: canQuote,
      actionLabel: input.shippingZones === 0 ? 'Crear zonas' : 'Completar tarifario',
      actionHref: '/envios?tab=zonas',
    });

    if (canQuote && input.coveredProvinces < TOTAL_PROVINCES) {
      const faltan = TOTAL_PROVINCES - input.coveredProvinces;
      // Que "alguna" zona cotice no consuela a quien vive en las otras: si
      // falta más de la mitad del país, la tienda no está para vender, está
      // para vender en una ciudad. Con retiro en local hay salida, así que ahí
      // molesta en vez de bloquear.
      const casiTodoElPais = faltan > TOTAL_PROVINCES / 2;
      checks.push({
        id: 'coverage',
        title: 'Cubrir todo el país',
        detail: pickup
          ? `${faltan} ${faltan === 1 ? 'provincia' : 'provincias'} sin envío a domicilio: fuera de tu cobertura el checkout sólo ofrece retiro en tienda. No prometas envío nacional hasta completar el tarifario.`
          : `${faltan} ${faltan === 1 ? 'provincia' : 'provincias'} sin tarifa de envío: un comprador de ahí no puede terminar la compra.`,
        severity: casiTodoElPais && !pickup ? 'blocker' : 'warning',
        done: false,
        actionLabel: 'Completar tarifario',
        actionHref: '/envios?tab=zonas',
      });
    }

    if (input.productsWithoutWeight > 0) {
      checks.push({
        id: 'weights',
        title: 'Cargar el peso de los productos',
        detail: `${input.productsWithoutWeight} ${input.productsWithoutWeight === 1 ? 'producto no declara' : 'productos no declaran'} peso: se cotiza con el peso estimado de la tienda, así que el envío puede salir mal cobrado.`,
        severity: 'warning',
        done: false,
        actionLabel: 'Completar pesos',
        actionHref: '/productos?completar=pesos',
      });
    }
  } else if (mode === 'flat') {
    const cost = Number(s?.shipping_cost ?? 0);
    checks.push({
      id: 'shipping-flat',
      title: 'Definir el costo de envío',
      detail: cost > 0
        ? 'Precio de envío plano configurado.'
        : 'El envío está en $0 para todo el país. Si es a propósito, conviene usar el modo "Envío gratis" para que quede claro en la tienda.',
      severity: 'suggestion',
      done: cost > 0,
      actionLabel: 'Configurar envíos',
      actionHref: '/tienda-online?tab=settings',
    });
  }

  // ── Presentación ────────────────────────────────────────────────────────
  checks.push({
    id: 'slug',
    title: 'Elegir la dirección de la tienda',
    detail: s?.slug
      ? `Tu tienda vive en /tienda/${s.slug}`
      : 'Sin dirección propia no hay link que compartir.',
    severity: 'blocker',
    done: !!s?.slug,
    actionLabel: 'Configurar',
    actionHref: '/tienda-online?tab=settings',
  });

  // ── Información legal para quien compra ────────────────────────────────
  const legalMissing = input.legalPages.missingOrTemplate;
  const legalDrafts = input.legalPages.drafts;
  const legalDone = legalMissing === 0 && legalDrafts === 0;
  const legalDetail = legalMissing > 0
    ? legalMissing === 1
      ? 'Falta la política de privacidad o los términos, o siguen con una plantilla sin completar: el comprador no sabe quién vende ni cómo se tratan sus datos.'
      : 'Faltan la política de privacidad y los términos, o siguen con plantillas sin completar: el comprador no sabe quién vende ni cómo se tratan sus datos.'
    : legalDrafts === 1
      ? 'Hay una página legal en borrador. Revisala y publicala antes de recibir datos de compradores.'
      : 'Las páginas legales están en borrador. Revisalas y publicalas antes de recibir datos de compradores.';
  const legalAction = accionLegalDelChecklist({
    missingOrTemplate: legalMissing,
    drafts: legalDrafts,
  });
  checks.push({
    id: 'legal-pages',
    title: 'Publicar términos y privacidad',
    detail: legalDone ? 'Términos y política de privacidad publicados.' : legalDetail,
    severity: 'blocker',
    done: legalDone,
    actionLabel: legalAction.actionLabel,
    actionHref: legalAction.actionHref,
  });

  // Aviso, no bloqueo: store-order-email cae al email del dueño. Sin casilla
  // de la tienda los legales también piden un contacto al generar.
  const avisoEmail = String(s?.notification_email ?? '').trim();
  checks.push({
    id: 'notification-email',
    title: 'Email para avisos de venta',
    detail: avisoEmail
      ? 'Los pedidos nuevos llegan a ese correo.'
      : 'Sin email de la tienda, los avisos de pedido van al correo del dueño. Conviene uno de ventas.',
    severity: 'warning',
    done: !!avisoEmail,
    actionLabel: 'Cargar email',
    actionHref: '/tienda-online?tab=settings',
  });

  checks.push({
    id: 'branding',
    title: 'Subir el logo',
    detail: s?.logo_url
      ? 'Logo cargado.'
      : 'Sin logo la tienda se ve genérica y transmite menos confianza al comprar.',
    severity: 'suggestion',
    done: !!s?.logo_url,
    actionLabel: 'Diseño',
    actionHref: '/tienda-online?tab=design',
  });

  checks.push({
    id: 'seo',
    title: 'Completar título y descripción',
    detail: s?.meta_title || s?.description
      ? 'Descripción cargada.'
      : 'Es lo que se ve en Google y al compartir el link por WhatsApp.',
    severity: 'suggestion',
    done: !!(s?.meta_title || s?.description),
    actionLabel: 'SEO',
    actionHref: '/tienda-online?tab=settings',
  });

  const blockers = checks.filter(c => c.severity === 'blocker' && !c.done);
  const warnings = checks.filter(c => c.severity === 'warning' && !c.done);

  // El score cuenta todo para dar sensación de progreso, pero publicar sólo
  // depende de que no queden bloqueantes.
  const done = checks.filter(c => c.done).length;
  const score = checks.length > 0 ? Math.round((done / checks.length) * 100) : 0;

  return { checks, blockers, warnings, canPublish: blockers.length === 0, score };
}

/** Resumen de una línea, para mostrar junto al estado de la tienda. */
export function readinessSummary(r: StoreReadiness): string {
  if (r.blockers.length > 0) {
    return r.blockers.length === 1
      ? 'Falta 1 cosa para poder vender'
      : `Faltan ${r.blockers.length} cosas para poder vender`;
  }
  if (r.warnings.length > 0) {
    return r.warnings.length === 1
      ? 'Lista para vender, con 1 detalle pendiente'
      : `Lista para vender, con ${r.warnings.length} detalles pendientes`;
  }
  return 'Lista para vender';
}
