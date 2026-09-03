import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isPotentialCustomStoreHostname,
  storeDomainDnsRecords,
  storeDomainStatusCopy,
  validateCustomStoreDomain,
} from '@/lib/storeCustomDomain';
import {
  sanitizedStoreDomainState,
  validateStoreDomainServer,
} from '../../supabase/functions/_shared/storeDomain';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dominios propios de Commerce', () => {
  it.each([
    ['tienda.marca.com', true],
    ['MARCA.COM.', true],
    ['https://marca.com', false],
    ['marca.com/tienda', false],
    ['localhost', false],
    ['127.0.0.1', false],
    ['nerqia.app', false],
    ['tienda.nerqia.app', false],
    ['preview.vercel.app', false],
  ])('valida %s igual en browser y servidor', (input, expected) => {
    expect(validateCustomStoreDomain(input).valid).toBe(expected);
    expect(validateStoreDomainServer(input).valid).toBe(expected);
  });

  it('sólo trata un host externo válido como posible tienda', () => {
    expect(isPotentialCustomStoreHostname('tienda.marca.com')).toBe(true);
    expect(isPotentialCustomStoreHostname('nerqia.app')).toBe(false);
    expect(isPotentialCustomStoreHostname('exentryimports.nerqia.app')).toBe(false);
    expect(isPotentialCustomStoreHostname('localhost')).toBe(false);
  });

  it('prioriza challenge TXT y la recomendación DNS dinámica de Vercel', () => {
    const pending = sanitizedStoreDomainState(
      'tienda.marca.com',
      {
        apexName: 'marca.com',
        verified: false,
        verification: [{ type: 'TXT', domain: '_vercel.marca.com', value: 'challenge', reason: 'ownership' }],
      },
      {
        configuredBy: null,
        misconfigured: true,
        recommendedCNAME: [{ rank: 2, value: 'old.example' }, { rank: 1, value: 'new.vercel-dns.com' }],
      },
    );
    expect(pending.status).toBe('pending_verification');
    expect(storeDomainDnsRecords(pending.verification)).toEqual([
      { type: 'TXT', name: '_vercel.marca.com', value: 'challenge', purpose: 'ownership' },
      { type: 'CNAME', name: 'tienda.marca.com', value: 'new.vercel-dns.com', purpose: 'routing' },
    ]);
  });

  it('distingue ownership, DNS, TLS y activo sin prometer conexión antes de tiempo', () => {
    expect(sanitizedStoreDomainState('marca.com', { apexName: 'marca.com', verified: true }, {
      configuredBy: null,
      misconfigured: true,
      recommendedIPv4: [{ rank: 1, value: ['1.2.3.4'] }],
    }).status).toBe('pending_dns');
    expect(sanitizedStoreDomainState('marca.com', { apexName: 'marca.com', verified: true }, {
      configuredBy: 'A',
      misconfigured: true,
    }).status).toBe('misconfigured');
    expect(sanitizedStoreDomainState('marca.com', { apexName: 'marca.com', verified: true }, {
      configuredBy: 'A',
      misconfigured: false,
    }).status).toBe('active');
    expect(storeDomainStatusCopy('active').label).toBe('Conectado');
  });

  it('mantiene el token fuera del navegador y la mutación detrás de usuario owner/admin', () => {
    const edge = source('supabase/functions/store-domain/index.ts');
    const panel = source('src/components/ecommerce/StoreDomainsPanel.tsx');
    expect(edge).toContain("Deno.env.get('VERCEL_TOKEN')");
    expect(edge).toContain('requireUser');
    expect(edge).toContain("['owner', 'admin']");
    expect(edge).toContain(".from('ecommerce_stores')");
    expect(panel).not.toContain('VERCEL_TOKEN');
    expect(panel).not.toContain('api.vercel.com');
    expect(panel).toContain("functions.invoke<DomainResponse>('store-domain'");
  });

  it('versiona ciclo de vida, unicidad y resolución pública mínima', () => {
    const migration = source('supabase/migrations/20260903000080_store_custom_domains.sql');
    expect(migration).toContain('ecommerce_stores_custom_domain_key');
    expect(migration).toContain('get_store_slug_by_host');
    expect(migration).toContain("custom_domain_status = 'active'");
    expect(migration).toContain('s.is_active = true');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_store_slug_by_host(text) TO anon, authenticated');
  });
});
