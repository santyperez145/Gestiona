import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Nerqia tiene que poder gestionar cualquier rubro. Lo que sigue salió el
 * 2026-10-09, medido contra la base real: 8.837 productos, 54 perfumes,
 * cero ventas de decants en toda la historia.
 */
const ROOT = process.cwd();
const leer = (ruta: string) => readFileSync(resolve(ROOT, ruta), 'utf8');

/** Código sin comentarios: contar la historia de algo borrado no es tenerlo. */
function soloCodigo(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function fuentes(): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const p = join(dir, entrada);
      if (statSync(p).isDirectory()) { recorrer(p); continue; }
      if (!/\.(ts|tsx)$/.test(p) || /\.test\.tsx?$/.test(p)) continue;
      const rel = p.split('\\').join('/').slice(ROOT.split('\\').join('/').length + 1);
      if (rel.startsWith('src/test/') || rel === 'src/integrations/supabase/types.ts') continue;
      salida.push(rel);
    }
  };
  recorrer(resolve(ROOT, 'src'));
  return salida;
}

describe('sin legado de un solo rubro', () => {
  it('el fraccionado en decants no existe en la aplicación', () => {
    const conDecants = fuentes().filter(f => /decant/i.test(soloCodigo(leer(f))));
    expect(conDecants).toEqual([]);
  });

  it('ninguna página pública inventa cuánta gente está mirando', () => {
    // El catálogo mostraba «N personas viendo este producto ahora» con un hash
    // del id más la hora: prueba social falsa ante compradores reales.
    const conVisitasInventadas = fuentes().filter(f => {
      const codigo = soloCodigo(leer(f));
      return /pseudoRandom|personas viendo|\} viendo/.test(codigo);
    });
    expect(conVisitasInventadas).toEqual([]);
  });

  it('el Dashboard no «repara» costos sumándoles aduana', () => {
    // Desde C28.1 el costo cargado ya incluye la aduana: el control marcaba
    // todo producto nuevo y «Reparar» le sumaba un 15 % al costo.
    expect(soloCodigo(leer('src/lib/cashFlow.ts'))).not.toContain('outdated_cost');
    expect(soloCodigo(leer('src/components/dashboard/ConsistencyAlerts.tsx'))).not.toMatch(/customs|total_cost_usd/);
  });

  it('editar un producto viejo no le baja el costo en silencio', () => {
    const productos = soloCodigo(leer('src/pages/ProductsPage.tsx'));
    expect(productos).toContain('const puesto = Number(product?.total_cost_usd) || 0;');
    expect(productos).not.toContain("useState(product?.cost_usd?.toString() || '')");
  });

  it('el calendario comercial habla a cualquier comercio y no vende el 2 de abril', () => {
    const marketing = leer('src/pages/MarketingPage.tsx');
    const calendario = marketing.slice(marketing.indexOf('const dates: CampaignDate[] = ['), marketing.indexOf('];', marketing.indexOf('const dates: CampaignDate[] = [')));
    expect(calendario).not.toMatch(/perfum|fragan|oler|olfat|decant/i);
    const malvinas = calendario.split('\n').find(l => l.includes("'Día de los Veteranos'")) ?? '';
    expect(malvinas).not.toMatch(/descuento|oferta|promo/i);
  });

  it('un producto nuevo no nace con oferta', () => {
    // El formulario completaba solo el precio c/descuento con el 20 % por
    // defecto, y la autoridad de precios cobra ese precio cuando es menor.
    const productos = soloCodigo(leer('src/pages/ProductsPage.tsx'));
    expect(productos).not.toContain('if (!manualDiscountPrice) setDiscountPriceARS(autoDiscountPrice.toString());');
    expect(productos).toContain('Precio de oferta (opcional)');
    expect(productos).toContain('placeholder="Sin oferta"');
  });

  it('el seed de perfumes de ejemplo no volvió', () => {
    expect(soloCodigo(leer('src/lib/supabaseStore.ts'))).not.toContain('seedProductsForUser');
  });
});
