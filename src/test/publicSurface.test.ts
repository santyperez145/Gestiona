import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guardia de la superficie pública.
 *
 * Las páginas que ve un visitante anónimo son el único lugar del código donde
 * un `select()` de más se convierte en una filtración de datos: lo que piden
 * viaja al navegador de cualquiera. Este test falla si vuelven a leer tablas
 * crudas o columnas sensibles, en vez de las vistas y RPCs saneados.
 *
 * Se hace sobre el texto fuente a propósito: no hace falta base ni sesión, corre
 * en milisegundos, y atrapa el error en el momento de escribirlo. La protección
 * real es RLS — esto evita que alguien la intente esquivar sin darse cuenta.
 */

/**
 * Toda la superficie anónima. `src/storefront/` se enumera completo a propósito:
 * la primera versión de este test sólo miraba `src/pages` y se le pasó que
 * `storeContext.tsx` leía la tabla `products` cruda. Con la política cerrada eso
 * habría dejado la tienda sin un solo producto en producción.
 */
function publicSources(): string[] {
  const fijos = [
    'src/pages/PublicCatalogPage.tsx',
    'src/pages/PublicPaymentPage.tsx',
    'src/pages/StorefrontPage.tsx',
    'src/pages/InfluencerPortalPage.tsx',
  ];
  const dir = resolve(process.cwd(), 'src/storefront');
  const storefront = existsSync(dir)
    ? readdirSync(dir)
        .filter(f => /\.(tsx?|ts)$/.test(f))
        .map(f => `src/storefront/${f}`)
    : [];
  return [...fijos, ...storefront];
}

const PUBLIC_PAGES = publicSources();

/** Columnas que nunca pueden salir a una superficie pública. */
const FORBIDDEN_COLUMNS = [
  // Credenciales
  'mp_access_token', 'mp_webhook_secret', 'webhook_secret', 'api_key',
  'smtp_pass', 'smtp_user', 'afip_ta_token', 'afip_ta_sign', 'evolution_api_key',
  'service_role',
  // Costos y márgenes
  'total_cost_usd', 'cost_usd', 'customs_fee', 'profit_per_unit_ars',
  'profit_per_unit_usd', 'customs_percent',
  'decant_margin_10ml', 'decant_margin_5ml', 'decant_margin_2_5ml',
];

/**
 * Tablas que una página pública no puede consultar directamente. Cada una tiene
 * su vista o RPC saneado; leer la tabla cruda depende de una política permisiva,
 * que es exactamente lo que se cerró.
 */
const FORBIDDEN_TABLES: Record<string, string> = {
  settings: 'settings_public / catalog_settings',
  products: 'catalog_products',
  product_variants: 'catalog_product_variants',
  payment_links: 'get_public_payment_link() / confirm_payment_link_transfer()',
  coupons: 'validación server-side en el checkout',
  memberships: 'no corresponde en una superficie pública',
  platform_admins: 'no corresponde en una superficie pública',
  payment_transactions: 'no corresponde en una superficie pública',
  shipping_carriers: 'shipping-quote (las credenciales del contrato no salen)',
};

function readPage(rel: string): string | null {
  const path = resolve(process.cwd(), rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Quita comentarios para no marcar una mención en una explicación. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('superficie pública', () => {
  it('las páginas públicas existen (si se renombran, hay que actualizar este test)', () => {
    const faltantes = PUBLIC_PAGES.filter(p => readPage(p) === null);
    expect(faltantes).toEqual([]);
  });

  for (const page of PUBLIC_PAGES) {
    describe(page.split('/').pop(), () => {
      it('no pide columnas de credenciales, costos ni márgenes', () => {
        const raw = readPage(page);
        if (raw === null) return;
        const code = stripComments(raw);
        const encontradas = FORBIDDEN_COLUMNS.filter(c => code.includes(c));
        expect(encontradas, `columnas sensibles en ${page}`).toEqual([]);
      });

      it('no consulta tablas crudas: usa las vistas y RPCs saneados', () => {
        const raw = readPage(page);
        if (raw === null) return;
        const code = stripComments(raw);
        const encontradas = Object.keys(FORBIDDEN_TABLES).filter(t =>
          new RegExp(`\\.from\\(\\s*["'\`]${t}["'\`]\\s*\\)`).test(code));
        const detalle = encontradas
          .map(t => `${t} → usar ${FORBIDDEN_TABLES[t]}`)
          .join('; ');
        expect(encontradas, `tablas crudas en ${page}: ${detalle}`).toEqual([]);
      });
    });
  }
});

/**
 * `publicDataSource.ts` es el ÚNICO lugar autorizado a leer las tablas crudas,
 * como fallback mientras una migración no está aplicada. Por eso no entra en la
 * lista de arriba — pero sí tiene que respetar las columnas: un fallback que
 * expone costos es la misma filtración por otro camino.
 */
describe('publicDataSource (fallback de migración)', () => {
  const src = readPage('src/lib/publicDataSource.ts');

  it('existe', () => {
    expect(src).not.toBeNull();
  });

  it('no pide columnas de credenciales, costos ni márgenes', () => {
    if (!src) return;
    const code = stripComments(src);
    const encontradas = FORBIDDEN_COLUMNS.filter(c => code.includes(c));
    expect(encontradas, 'el fallback expone columnas sensibles').toEqual([]);
  });

  it('sólo cae a la tabla cuando la relación o la función no existen', () => {
    if (!src) return;
    const code = stripComments(src);
    // Cada fallback tiene que estar guardado por una de las dos detecciones:
    // si no, un error de red o de permisos abriría la puerta en silencio.
    const fallbacks = (code.match(/warnFallback\(/g) ?? []).length;
    const guardas = (code.match(/isMissingRelation\(|isMissingFunction\(/g) ?? []).length;
    expect(fallbacks).toBeGreaterThan(0);
    expect(guardas).toBeGreaterThanOrEqual(fallbacks);
  });
});

describe('vistas públicas', () => {
  const migration = readPage('supabase/migrations/20260731000001_rls_hardening.sql');

  it('la migración de hardening está en el repo', () => {
    expect(migration).not.toBeNull();
  });

  it('ninguna vista pública selecciona columnas de costo o credenciales', () => {
    if (!migration) return;
    // Se aísla el cuerpo de cada CREATE VIEW para no mirar los comentarios
    // explicativos de arriba, que nombran las columnas justamente para advertir.
    const vistas = [...migration.matchAll(
      /CREATE\s+VIEW\s+public\.(\w+)\s+AS([\s\S]*?);/gi)];
    expect(vistas.length).toBeGreaterThan(0);

    const problemas: string[] = [];
    for (const [, nombre, cuerpo] of vistas) {
      if (nombre === 'rls_audit_open_policies') continue;
      const limpio = stripComments(cuerpo);
      // Las columnas de costo pueden aparecer DENTRO de un cálculo (el precio de
      // decant se computa acá justamente para no exponerlas). Lo que no puede
      // pasar es que se proyecten como columna propia.
      for (const col of ['mp_access_token', 'smtp_pass', 'api_key', 'webhook_secret', 'afip_ta_token', 'evolution_api_key']) {
        if (limpio.includes(col)) problemas.push(`${nombre} expone ${col}`);
      }
      for (const col of ['total_cost_usd', 'cost_usd', 'profit_per_unit_ars', 'customs_fee']) {
        // Proyección directa: "p.total_cost_usd," o "total_cost_usd\n" sin estar
        // dentro de un paréntesis de cálculo.
        if (new RegExp(`^\\s*(\\w+\\.)?${col}\\s*,?\\s*$`, 'm').test(limpio)) {
          problemas.push(`${nombre} proyecta ${col}`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });
});
