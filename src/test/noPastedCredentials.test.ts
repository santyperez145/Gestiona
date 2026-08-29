/**
 * Guardia: las integraciones que tienen OAuth no vuelven a pedir el token.
 *
 * `IntegrationsPage` llegó a ofrecer las dos cosas a la vez: el panel de OAuth
 * y, más abajo, un campo para pegar el access token de MercadoPago y otro para
 * el de MercadoLibre. Dos caminos para lo mismo, y el peor de los dos:
 *
 *   - Un token pegado se guarda en `settings`, tabla que la UI lee. El de OAuth
 *     vive en `payment_connections` / `meli_connections`, con RLS y **cero**
 *     policies: sólo las tocan las Edge Functions con `service_role`.
 *   - MercadoPago rechaza el `marketplace_fee` cuando la preferencia se firma
 *     con un token pegado a mano, porque no hay relación marketplace. O sea que
 *     esa vía ni siquiera podía cobrar la comisión de la plataforma.
 *
 * Este test falla si alguna de esas columnas vuelve a aparecer en una pantalla.
 * Si algún día hace falta de verdad, se documenta acá el motivo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** Columnas de credencial que nunca pueden volver a una pantalla. */
const COLUMNAS_PROHIBIDAS = [
  'mp_access_token',
  'ml_access_token',
  'ml_refresh_token',
  // AFIP: el certificado y su clave firman facturas fiscales a nombre del
  // contribuyente. Vivían en `settings`, que cualquier miembro de la org puede
  // leer — RLS es por fila, no por columna. Ahora entran por Edge Function y
  // la UI sólo ve `afip_connection_status`.
  'afip_certificate',
  'afip_private_key',
  'private_key',
  // Evolution API permite enviar WhatsApp como el comercio. No tiene OAuth,
  // por eso entra una vez por `evolution-credentials` y queda en una tabla sin
  // policies; la UI sólo ve `evolution_connection_status`.
  'evolution_api_url',
  'evolution_api_key',
  'evolution_instance',
];

/** Dónde vive la UI de la organización. */
const RAICES = ['src/pages', 'src/components'];

function archivos(dir: string): string[] {
  const abs = resolve(process.cwd(), dir);
  const out: string[] = [];
  const recorrer = (d: string) => {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) recorrer(full);
      else if (/\.tsx?$/.test(e)) out.push(full);
    }
  };
  recorrer(abs);
  return out;
}

/** Sin comentarios: una mención en una explicación no es un uso. */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('credenciales que ya tienen OAuth', () => {
  it('ninguna pantalla lee ni escribe el token de MercadoPago o MercadoLibre', () => {
    const infractores: string[] = [];

    for (const raiz of RAICES) {
      for (const archivo of archivos(raiz)) {
        const src = sinComentarios(readFileSync(archivo, 'utf8'));
        for (const col of COLUMNAS_PROHIBIDAS) {
          if (src.includes(col)) {
            infractores.push(`${archivo.split(/[\\/]/).slice(-2).join('/')} → ${col}`);
          }
        }
      }
    }

    expect(
      infractores,
      'Se conectan por OAuth (`mp-connect`, `meli-oauth`). El token no debe ' +
      'pasar por la UI ni guardarse en `settings`.',
    ).toEqual([]);
  });

  it('los paneles de OAuth siguen montados en Integraciones', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/IntegrationsPage.tsx'), 'utf8');
    // Si se sacan los paneles sin reemplazo, no queda forma de conectar nada.
    expect(src).toContain('PaymentConnectionsPanel');
    expect(src).toContain('MercadoLibrePanel');
  });

  it('Evolution usa el endpoint seguro y el asistente no envía WhatsApp directo', () => {
    const integrations = readFileSync(resolve(process.cwd(), 'src/pages/IntegrationsPage.tsx'), 'utf8');
    const assistant = readFileSync(resolve(process.cwd(), 'src/components/ai-chat/AIChatAssistantTab.tsx'), 'utf8');
    expect(integrations).toContain('evolution_connection_status');
    expect(integrations).toContain('evolution-credentials');
    expect(assistant).toContain('Abrir campañas seguras');
    expect(assistant).not.toContain('/message/sendText/');
  });
});
