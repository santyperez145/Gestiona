import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditarRutas } from '../../scripts/audit-pages.mjs';

/**
 * Una página del sidebar que no lee datos muestra números inventados.
 *
 * El 2026-10-09 había tres en producción, marcadas `canonical` y con entrada
 * propia en el menú: `/ia-business` («IA Inventario»), `/ia-commerce` («IA
 * Tienda») y `/pricing-dinamico`. Las tres renderizaban un array fijo. La de
 * inventario decía «producto X se agota en 5 días · Basado en ventas
 * históricas. Ventas promedio: 12/día» y ofrecía el botón «Generar Orden de
 * Compra»: un comerciante podía comprar mercadería real mirando una ficción.
 * Y duplicaban features que YA existían de verdad — `/planificacion` tiene
 * forecast, reposición y análisis contra la base.
 *
 * El daño no es una pantalla vacía: es que el resto del producto deja de ser
 * creíble. Una demo puede existir, pero no colgada del menú como si fuera el
 * sistema.
 *
 * Las estáticas se declaran acá, una por una, con su motivo.
 */
const SIN_DATOS_A_PROPOSITO = new Map([
  ['/terminos', 'Texto legal: no hay datos del comercio que mostrar.'],
  ['/privacidad', 'Texto legal: no hay datos del comercio que mostrar.'],
]);

describe('ninguna página del menú muestra datos inventados', () => {
  const informe = auditarRutas();

  it('el manifiesto sigue resolviendo las páginas', () => {
    expect(informe.length).toBeGreaterThan(50);
  });

  it('toda ruta con entrada en el menú lee datos o está declarada estática', () => {
    const inventadas = informe
      .filter(r => !r.lee && !SIN_DATOS_A_PROPOSITO.has(r.path))
      .map(r => `${r.path} (${r.componente})`);
    expect(inventadas, 'agregá la ruta a SIN_DATOS_A_PROPOSITO con su motivo, o conectala a la base').toEqual([]);
  });

  it('las declaradas estáticas siguen existiendo y siguen sin leer datos', () => {
    for (const ruta of SIN_DATOS_A_PROPOSITO.keys()) {
      const encontrada = informe.find(r => r.path === ruta);
      expect(encontrada, `${ruta} salió del manifiesto: sacala de SIN_DATOS_A_PROPOSITO`).toBeDefined();
      expect(encontrada?.lee, `${ruta} ahora lee datos: sacala de la lista`).toBe(false);
    }
  });

  // Cada ruta va en su línea junto a `existsSync`: así `losTestsLeenArchivos
  // QueExisten` las saltea, que es la salida que ese test declara para las
  // guardas que exigen que algo NO exista.
  it('las tres páginas mock de 2026-10-09 no volvieron', () => {
    const raiz = resolve(process.cwd());
    expect(existsSync(resolve(raiz, 'src/pages/BusinessAIPage.tsx')), 'volvió BusinessAIPage').toBe(false);
    expect(existsSync(resolve(raiz, 'src/pages/CommerceAIPage.tsx')), 'volvió CommerceAIPage').toBe(false);
    expect(existsSync(resolve(raiz, 'src/pages/DynamicPricingPage.tsx')), 'volvió DynamicPricingPage').toBe(false);
    expect(existsSync(resolve(raiz, 'src/components/business/BusinessAIInsights.tsx')), 'volvió BusinessAIInsights').toBe(false);
    expect(existsSync(resolve(raiz, 'src/components/commerce/CommerceAIInsights.tsx')), 'volvió CommerceAIInsights').toBe(false);
    expect(existsSync(resolve(raiz, 'src/components/commerce/DynamicPricing.tsx')), 'volvió DynamicPricing').toBe(false);
  });
});
