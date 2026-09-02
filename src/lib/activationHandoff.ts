/**
 * El wizard escribe `?onboarding=1&goal=pos|online` al terminar.
 * Si nadie lee esos parámetros, el comercio aterriza en un catálogo genérico
 * o en una tienda vacía y el clic de "empezar a vender" se pierde.
 */

export type HandoffGoal = 'pos' | 'online';

export function parseActivationHandoff(params: {
  get(name: string): string | null;
}): { fromWizard: boolean; goal: HandoffGoal | null } {
  const fromWizard = params.get('onboarding') === '1';
  const raw = params.get('goal');
  const goal: HandoffGoal | null = raw === 'pos' || raw === 'online' ? raw : null;
  return { fromWizard, goal };
}

/** Catálogo vacío: el query conserva el canal elegido para abrir el formulario. */
export function firstProductPath(goal: HandoffGoal | null | undefined): string {
  if (goal === 'online') return '/productos?onboarding=1&goal=online';
  if (goal === 'pos') return '/productos?onboarding=1&goal=pos';
  return '/productos';
}

/** Después del primer SKU vendible, el mostrador es el siguiente clic. */
export function posHandoffPath(): string {
  return '/caja?onboarding=1';
}

/** Después del primer SKU online, Commerce es el siguiente clic. */
export function commerceHandoffPath(): string {
  return '/tienda-online?onboarding=1&goal=online';
}

export function firstProductFormDescription(goal: HandoffGoal | null) {
  if (goal === 'online') {
    return 'Nombre, precio de venta y stock real. La tienda vende el mismo catálogo; sin unidades no hay nada que publicar.';
  }
  return 'Nombre, precio de venta y stock real. El costo puede esperar: sin unidades el mostrador no cobra.';
}

export function firstProductEmptyCopy(goal: HandoffGoal | null) {
  if (goal === 'online') {
    return {
      title: 'Todavía no hay nada que publicar',
      description: 'La tienda vende el catálogo del Business Core. Cargá un producto con precio y stock; después volvés a Commerce a publicar.',
      actionLabel: 'Cargar el primer producto',
    };
  }
  if (goal === 'pos') {
    return {
      title: 'Cargá el primer producto del mostrador',
      description: 'Nombre, precio de venta y stock real. Sin eso el POS no tiene qué cobrar.',
      actionLabel: 'Cargar el primer producto',
    };
  }
  return {
    title: 'Todavía no hay productos',
    description: 'Creá el primer producto para activar catálogo, stock y rentabilidad por canal.',
    actionLabel: 'Nuevo producto',
  };
}

export function storeHandoffCopy() {
  return {
    title: 'Primero el catálogo, después la vitrina',
    description: 'Elegiste vender online. La tienda se ve vacía hasta que haya un producto con precio y stock. El stock es el mismo del mostrador.',
    actionLabel: 'Cargar el primer producto',
    href: firstProductPath('online'),
  };
}
