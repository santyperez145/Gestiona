import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Los dos scripts de despliegue tienen que publicar sin JWT de gateway
 * exactamente las mismas funciones. Medido 2026-10-10: divergían entre sí y
 * con producción en siete funciones —trusted-device y mp-installments entre
 * ellas—, así que un despliegue completo cambiaba la autenticación según qué
 * script se corriera.
 */
const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');

function sinJwtBash(): Set<string> {
  const sh = leer('scripts/deploy-functions.sh');
  const ini = sh.indexOf('NO_JWT=(');
  return new Set([...sh.slice(ini, sh.indexOf('\n)', ini)).matchAll(/"([a-z0-9-]+)"/g)].map(m => m[1]));
}

function sinJwtPowerShell(): Set<string> {
  const ps = leer('scripts/deploy-functions.ps1');
  const ini = ps.indexOf('"stripe-webhook"');
  return new Set([...ps.slice(ini, ps.indexOf('\n)', ini)).matchAll(/"([a-z0-9-]+)"/g)].map(m => m[1]));
}

describe('scripts de despliegue de funciones', () => {
  it('publican sin JWT las mismas funciones', () => {
    expect([...sinJwtPowerShell()].sort()).toEqual([...sinJwtBash()].sort());
  });

  it('incluyen las públicas por diseño y las que validan su propia sesión', () => {
    for (const f of ['mp-installments', 'trusted-device', 'afip-authorize', 'store-pay', 'shipping-quote']) {
      expect(sinJwtBash().has(f), f).toBe(true);
    }
  });
});
