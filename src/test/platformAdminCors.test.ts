import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/functions/platform-admin-action/index.ts'),
  'utf8',
);

describe('platform-admin-action CORS contract', () => {
  it('permite explícitamente el origen productivo actual', () => {
    expect(source).toContain('"https://nerqia.app"');
    expect(source).toContain('"https://www.nerqia.app"');
    // Compatibilidad temporal durante el corte de dominio.
    expect(source).toContain('"https://exentryimports.vercel.app"');
  });

  it('usa coincidencia exacta y no sustituye un origen desconocido', () => {
    expect(source).toContain('getAllowedOrigins().has(origin)');
    expect(source).not.toContain('ALLOWED_ORIGINS[0]');
    expect(source).toContain('Origen no permitido');
  });

  it('cubre tanto el preflight como la respuesta real', () => {
    expect(source).toContain('"Access-Control-Allow-Methods": "POST, OPTIONS"');
    expect(source).toContain('status: 204');
    expect(source).toContain('jsonResponse(data, status, req)');
  });

  it('permite sumar dominios exactos por configuración sin usar wildcard', () => {
    expect(source).toContain('PLATFORM_ALLOWED_ORIGINS');
    expect(source).not.toMatch(/Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/);
  });
});
