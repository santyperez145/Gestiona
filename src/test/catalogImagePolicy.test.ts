import { describe, expect, it, vi } from 'vitest';
import { allowedCatalogDownload, boundedBytes, catalogCandidate, fetchCatalogImage, imageMatch, publicHttps } from '../../supabase/functions/_shared/catalogImages';

const image = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Bosch GSB 13 RE',
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/tool.jpg',
  thumbnail: 'https://api.openverse.org/v1/images/11111111-1111-4111-8111-111111111111/thumb/',
  foreign_landing_url: 'https://commons.wikimedia.org/wiki/File:Tool.jpg',
  license: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', width: 800, height: 600,
};
describe('politica ejecutable de imagenes de catalogo', () => {
  it('rankea marca y modelo como senales, nunca como certeza del articulo', () => {
    const same = imageMatch('Taladro GSB 13 RE', 'Bosch', image.title);
    expect(same.model_matched).toBe(true); expect(same.brand_matched).toBe(true); expect(same.exact_product).toBe(false);
    expect(same.score).toBeGreaterThan(imageMatch('Taladro GSB 13 RE', 'Bosch', 'Taladro manual').score);
    expect(imageMatch('GSB 13', 'Bosch', 'GSB 130 Bosch').model_matched).toBe(false);
  });
  it.each(['http://upload.wikimedia.org/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png',
    'https://user:pass@upload.wikimedia.org/a.png', 'https://upload.wikimedia.org.evil.com/a.png', 'https://upload.wikimedia.org:444/a.png', 'https://metadata.google.internal/a.png'])('no descarga %s', value => {
    expect(allowedCatalogDownload(value)).toBeNull();
  });
  it('acepta solo proveedores controlados y enlaces publicos sin credenciales', () => {
    expect(allowedCatalogDownload(image.url)).toBe(image.url);
    expect(allowedCatalogDownload('https://live.staticflickr.com/a.jpg')).not.toBeNull();
    expect(publicHttps('javascript:alert(1)')).toBeNull();
    expect(catalogCandidate(image, 'Taladro GSB 13 RE', 'Bosch')).toMatchObject({ id: image.id, license: 'cc0', match: { exact_product: false } });
  });
  it.each([{ license: 'by' }, { license: 'by-nc' }, { license: '' }, { watermarked: true }, { mature: true },
    { foreign_landing_url: null }, { license_url: 'javascript:alert(1)' }, { url: 'https://elsewhere.example/a.png' }, { id: 'bad' }])('rechaza metadatos no utilizables %j', change => {
    expect(catalogCandidate({ ...image, ...change }, 'Taladro', 'Bosch')).toBeNull();
  });
  it('rechaza exceso real aunque no exista Content-Length', async () => {
    const response = new Response(new Uint8Array(11));
    await expect(boundedBytes(response, 10)).rejects.toThrow('catalog_response_size');
  });
  it('nunca sigue un redirect a un host distinto permitido por terceros', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }));
    await expect(fetchCatalogImage(image.url, new AbortController().signal, fetcher)).rejects.toThrow('catalog_image_redirect');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  });
  it('no consume ni acepta contenido activo disfrazado por el proveedor', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
    await expect(fetchCatalogImage(image.url, new AbortController().signal, fetcher)).rejects.toThrow('catalog_image_type');
  });
});
