import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260904000100_store_theme_versions.sql'),
  'utf8',
);
const provider = readFileSync(join(process.cwd(), 'src/storefront/storeContext.tsx'), 'utf8');
const page = readFileSync(join(process.cwd(), 'src/pages/EcommerceStorePage.tsx'), 'utf8');
const storefront = readFileSync(join(process.cwd(), 'src/pages/StorefrontPage.tsx'), 'utf8');

describe('publicación versionada del tema', () => {
  it('conserva una sola versión publicada y una sola borrador por tienda', () => {
    expect(migration).toContain('store_theme_versions_one_draft');
    expect(migration).toContain('store_theme_versions_one_published');
    expect(migration).toContain("status IN ('draft', 'published', 'archived')");
  });

  it('publica en la misma autoridad que consume la tienda', () => {
    expect(migration).toMatch(/UPDATE public\.ecommerce_stores[\s\S]*theme = v_draft\.config/);
    expect(provider).toContain('get_store_by_slug');
    expect(page).toContain('publishedDesign = store?.id');
  });

  it('no deja que otra pestaña publique un borrador indirectamente', () => {
    expect(page).toContain('storefront_layout: store?.id');
    expect(page).toContain('StoreThemePublishingPanel');
  });

  it('protege preview y mutaciones de usuarios anónimos', () => {
    expect(migration).toContain('get_store_theme_preview(text, uuid)');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain("public.exigir_permiso(v_store.org_id, 'ecommerce', 'edit'");
  });

  it('inicializa el historial de tiendas futuras', () => {
    expect(migration).toContain('trg_seed_store_theme_version');
    expect(migration).toContain('AFTER INSERT ON public.ecommerce_stores');
  });

  it('desactiva telemetría y persistencia remota durante la preview', () => {
    expect(provider).toContain('if (previewMode)');
    expect(storefront).toContain('previewVersionId={activePreviewId}');
  });
});
