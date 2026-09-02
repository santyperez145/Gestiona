import { firstProductPath } from '@/lib/activationHandoff';

export type ActivationGoal = 'pos' | 'online' | 'explore';
export type EffectiveActivationGoal = Exclude<ActivationGoal, 'explore'>;

export interface ActivationReadinessSignals {
  onboarding_goal?: string | null;
  identity_ready?: boolean | null;
  catalog_products_count?: number | null;
  sellable_stock_products_count?: number | null;
  catalog_ready?: boolean | null;
  stock_ready?: boolean | null;
  online_channel_ready?: boolean | null;
  legal_ready?: boolean | null;
  mercadopago_ready?: boolean | null;
  online_payment_ready?: boolean | null;
  online_shipping_ready?: boolean | null;
  fiscal_status?: string | null;
  fiscal_ready?: boolean | null;
  pos_sales_total?: number | null;
  first_pos_sale_at?: string | null;
  online_orders_total?: number | null;
  first_online_sale_at?: string | null;
}

export interface ActivationMilestone {
  id: 'identity' | 'catalog' | 'stock' | 'channel' | 'payment' | 'shipping' | 'fiscal' | 'sale';
  label: string;
  detail: string;
  done: boolean;
  href: string;
  actionLabel: string;
  owner: 'merchant' | 'platform' | 'shared';
}

export interface ActivationReadiness {
  selectedGoal: ActivationGoal;
  effectiveGoal: EffectiveActivationGoal | null;
  needsGoalChoice: boolean;
  milestones: ActivationMilestone[];
  doneCount: number;
  total: number;
  progress: number;
  complete: boolean;
  next: ActivationMilestone | null;
}

export function normalizeActivationGoal(value: string | null | undefined): ActivationGoal {
  return value === 'online' || value === 'pos' || value === 'explore' ? value : 'explore';
}

function fiscalDetail(status: string | null | undefined): { detail: string; owner: ActivationMilestone['owner'] } {
  switch (status) {
    case 'listo':
      return { detail: 'ARCA ya devolvió evidencia de un ciclo de facturación real.', owner: 'shared' };
    case 'falta_certificado_propio':
      return { detail: 'Falta cargar el certificado de homologación o producción para validar ARCA.', owner: 'merchant' };
    case 'falta_plataforma':
      return { detail: 'La plataforma todavía debe habilitar su certificado para el modo delegado.', owner: 'platform' };
    case 'falta_delegar':
      return { detail: 'El comercio debe delegar WSFE en ARCA; Gestiona lo marca listo sólo después de verificar una operación.', owner: 'merchant' };
    case 'falta_verificar_ciclo':
      return { detail: 'Las credenciales están cargadas, pero falta obtener un CAE para probar el ciclo completo.', owner: 'shared' };
    default:
      return { detail: 'Faltan CUIT, punto de venta o datos del emisor para poder facturar.', owner: 'merchant' };
  }
}

/**
 * Convierte señales de base en una ruta de activación comprensible.
 *
 * POS y online comparten identidad, catálogo, stock, fiscal y primera venta.
 * El canal cambia lo que significa cobrar y entregar: POS ya puede cobrar en
 * efectivo/transferencia y entregar en mostrador; online necesita una tienda,
 * un medio utilizable, logística y páginas legales publicadas.
 */
export function evaluateActivationReadiness(signals: ActivationReadinessSignals): ActivationReadiness {
  const selectedGoal = normalizeActivationGoal(signals.onboarding_goal);
  const effectiveGoal = selectedGoal === 'explore' ? null : selectedGoal;
  const online = effectiveGoal === 'online';
  const routeChosen = effectiveGoal !== null;
  const fiscal = fiscalDetail(signals.fiscal_status);
  const catalogCount = Number(signals.catalog_products_count || 0);
  const stockCount = Number(signals.sellable_stock_products_count || 0);

  const milestones: ActivationMilestone[] = [
    {
      id: 'identity',
      label: online ? 'Identidad y legales publicados' : 'Identidad del negocio',
      detail: online
        ? signals.identity_ready && !signals.legal_ready
          ? 'El negocio está identificado, pero faltan términos y privacidad revisados y publicados.'
          : 'Nombre comercial, términos y privacidad identifican a quien vende.'
        : 'El nombre del negocio queda visible en comprobantes y operaciones.',
      done: Boolean(signals.identity_ready) && (!online || Boolean(signals.legal_ready)),
      href: online && !signals.legal_ready ? '/tienda-online?tab=pages' : '/ajustes',
      actionLabel: online && !signals.legal_ready ? 'Completar legales' : 'Configurar identidad',
      owner: 'merchant',
    },
    {
      id: 'catalog',
      label: 'Catálogo vendible',
      detail: catalogCount > 0
        ? `${catalogCount} ${catalogCount === 1 ? 'producto activo con precio' : 'productos activos con precio'}.`
        : 'Cargá al menos un producto activo con precio de venta.',
      done: Boolean(signals.catalog_ready),
      href: catalogCount === 0 ? firstProductPath(effectiveGoal) : '/productos',
      actionLabel: 'Cargar producto',
      owner: 'merchant',
    },
    {
      id: 'stock',
      label: 'Stock disponible',
      detail: stockCount > 0
        ? `${stockCount} ${stockCount === 1 ? 'producto puede venderse hoy' : 'productos pueden venderse hoy'}.`
        : 'Ingresá stock real; cargar una ficha no alcanza para vender.',
      done: Boolean(signals.stock_ready),
      href: '/productos',
      actionLabel: 'Ingresar stock',
      owner: 'merchant',
    },
    {
      id: 'channel',
      label: online ? 'Tienda publicada' : 'Canal POS elegido',
      detail: !routeChosen
        ? 'Elegí POS o tienda online para definir la ruta de salida.'
        : online
          ? 'La tienda necesita estar activa y tener una dirección pública.'
          : 'El POS está incluido y funciona con el mismo catálogo y stock del negocio.',
      done: routeChosen && (!online || Boolean(signals.online_channel_ready)),
      href: online ? '/tienda-online' : '/caja',
      actionLabel: online ? 'Publicar tienda' : 'Abrir POS',
      owner: 'merchant',
    },
    {
      id: 'payment',
      label: online ? 'Cobro online utilizable' : 'Cobro en mostrador',
      detail: !routeChosen
        ? 'El medio necesario depende del canal que elijas.'
        : online
          ? signals.mercadopago_ready
            ? 'Mercado Pago está conectado y vigente.'
            : 'Habilitá transferencia con CBU/alias, efectivo, o conectá Mercado Pago.'
          : 'El POS permite efectivo, transferencia, débito, crédito y pagos divididos.',
      done: routeChosen && (!online || Boolean(signals.online_payment_ready)),
      href: online ? '/tienda-online?tab=settings' : '/caja',
      actionLabel: online ? 'Configurar cobros' : 'Ver cobros',
      owner: 'merchant',
    },
    {
      id: 'shipping',
      label: online ? 'Entrega disponible' : 'Entrega en mostrador',
      detail: !routeChosen
        ? 'La entrega se define después de elegir el canal.'
        : online
          ? 'El checkout necesita retiro, envío plano/gratis o al menos una zona con tarifa.'
          : 'La operación se entrega en el local y no necesita tarifario de envío.',
      done: routeChosen && (!online || Boolean(signals.online_shipping_ready)),
      href: online ? '/envios?tab=zonas' : '/caja',
      actionLabel: online ? 'Configurar entrega' : 'Abrir POS',
      owner: 'merchant',
    },
    {
      id: 'fiscal',
      label: 'Circuito fiscal verificado',
      detail: fiscal.detail,
      done: Boolean(signals.fiscal_ready),
      href: '/afip',
      actionLabel: 'Configurar ARCA',
      owner: fiscal.owner,
    },
    {
      id: 'sale',
      label: online ? 'Primera venta online' : 'Primera venta POS',
      detail: !routeChosen
        ? 'La primera venta se atribuye al canal que elijas.'
        : online
          ? Number(signals.online_orders_total || 0) > 0
            ? 'Ya existe una orden online con pago acreditado.'
            : 'Hacé y cobrá una orden real para cerrar la activación.'
          : Number(signals.pos_sales_total || 0) > 0
            ? 'Ya existe una venta registrada desde el POS.'
            : 'Registrá una venta real desde el POS para cerrar la activación.',
      done: routeChosen && (online
        ? Number(signals.online_orders_total || 0) > 0
        : Number(signals.pos_sales_total || 0) > 0),
      href: online ? '/tienda-online?tab=orders' : '/caja',
      actionLabel: online ? 'Ver órdenes' : 'Registrar venta',
      owner: 'merchant',
    },
  ];

  const doneCount = milestones.filter(milestone => milestone.done).length;
  const total = milestones.length;
  const complete = routeChosen && doneCount === total;

  return {
    selectedGoal,
    effectiveGoal,
    needsGoalChoice: !routeChosen,
    milestones,
    doneCount,
    total,
    progress: Math.round((doneCount / total) * 100),
    complete,
    next: milestones.find(milestone => !milestone.done) || null,
  };
}

export function activationGoalLabel(goal: ActivationGoal): string {
  if (goal === 'online') return 'Tienda online';
  if (goal === 'pos') return 'POS / mostrador';
  return 'Sin canal elegido';
}
