import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('búsqueda asistida de imágenes', () => {
  const fn = read('supabase/functions/search-product-images/index.ts');
  const product = read('src/pages/ProductsPage.tsx');
  const images = read('src/hooks/useCatalogImages.ts');
  const config = read('supabase/config.toml');

  it('autentica, autoriza el tenant y limita abuso server-side', () => {
    expect(fn).toContain('getAuthedUser(req)');
    expect(fn).toContain(".from('memberships')");
    expect(fn).toContain("['owner', 'admin']");
    expect(fn).toContain("client.rpc('has_permission'");
    expect(fn).toContain('checkRateLimit');
    expect(config).toContain('[functions.search-product-images]');
  });

  it('busca sólo contenido comercial y nunca autoaplica', () => {
    expect(fn).toContain('license_type');
    expect(fn).toContain('commercial');
    expect(fn).toContain('auto_apply: false');
    expect(fn).toContain('requires_review: true');
  });

  it('conserva selección humana y carga manual', () => {
    expect(images).toContain("supabase.functions.invoke('search-product-images'");
    expect(product).toContain('selectImageCandidate');
    expect(product).toContain('fileInputRef.current?.click()');
    expect(product).toContain('handlePaste');
  });
  it('copia solamente IDs revalidados; no escribe productos ni confia en URLs de la UI', () => {
    expect(fn).toContain('body.candidate_id');
    expect(fn).toContain(".from('catalog_image_sources').insert");
    expect(fn).not.toContain('body.url');
    expect(fn).not.toContain(".from('products').update");
    expect(fn).toContain('body.review_product !== true');
    expect(fn).toContain('body.review_rights !== true');
  });
});
