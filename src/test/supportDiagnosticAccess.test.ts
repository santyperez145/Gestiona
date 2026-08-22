import { describe, expect, it } from 'vitest';
import { findForbiddenDiagnosticKey, parseSupportDiagnosticSnapshot } from '@/lib/supportDiagnosticAccess';

const safeSnapshot = {
  schema_version: 1,
  generated_at: '2026-08-22T03:00:00.000Z',
  access: { request_id: 'request-1', view_count: 1 },
  organization: { id: 'org-1', name: 'Comercio de prueba', slug: 'prueba' },
  activation: { catalog_ready: true, fiscal_status: 'listo' },
  business_profile: { industry_code: 'perfumes', profile_version: 1 },
  catalog_quality: { active_products: 10, missing_image: 2 },
  stock_accuracy: { accuracy_pct: 90, products_mismatched: 1 },
  delivery_queue: { pending: 0, failed: 0 },
  integrations: [{ key: 'mercadopago', operational_status: 'connected' }],
};

describe('diagnóstico temporal de soporte', () => {
  it('interpreta únicamente el contrato agregado versionado', () => {
    const parsed = parseSupportDiagnosticSnapshot(safeSnapshot);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.catalogQuality.active_products).toBe(10);
    expect(parsed.integrations).toHaveLength(1);
  });

  it('rechaza PII, secretos y valores monetarios aunque aparezcan anidados', () => {
    expect(findForbiddenDiagnosticKey({ nested: [{ access_token: 'secret' }] })).toBe('access_token');
    expect(() => parseSupportDiagnosticSnapshot({
      ...safeSnapshot,
      integrations: [{ key: 'mercadopago', last_error: 'respuesta cruda' }],
    })).toThrow('last_error');
    expect(() => parseSupportDiagnosticSnapshot({
      ...safeSnapshot,
      catalog_quality: { product_name: 'Producto identificable' },
    })).toThrow('product_name');
  });

  it('rechaza versiones desconocidas o snapshots incompletos', () => {
    expect(() => parseSupportDiagnosticSnapshot({ ...safeSnapshot, schema_version: 2 })).toThrow('incompatible');
    expect(() => parseSupportDiagnosticSnapshot({ schema_version: 1 })).toThrow('incompatible');
  });
});
