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
