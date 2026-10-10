import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Un vendedor borraba comprobantes de ARCA, creaba claves de API y configuraba
 * cobros: diecisiete tablas sensibles con una sola política FOR ALL de
 * miembro. Medido el 2026-10-10 con scripts/sensitive-writes-matrix.sql.
 */
const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');
const migracion = leer('supabase/migrations/20261010000300_escrituras_sensibles_solo_encargados.sql');
const codigo = migracion.slice(migracion.indexOf('DO $$'));

describe('escrituras sensibles sólo para dueño y admin', () => {
  it('cubre las diecisiete tablas medidas', () => {
    const tablas = [...codigo.matchAll(/^\s+"([a-z_]+)": "[a-z_]+",?$/gm)].map(m => m[1]);
    expect(tablas).toHaveLength(17);
    for (const t of ['afip_comprobantes', 'org_api_keys', 'org_payment_providers', 'stock_history']) {
      expect(tablas).toContain(t);
    }
  });

  it('no deja ninguna política FOR ALL', () => {
    expect(codigo).not.toMatch(/FOR ALL/);
  });

  it('escribir exige rol de encargado', () => {
    expect(codigo).toContain("public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])");
    expect(codigo).toMatch(/FOR UPDATE TO authenticated USING \(%2\$s\) WITH CHECK \(%2\$s\)/);
  });

  it('un comprobante con CAE no se borra, ni siquiera el dueño', () => {
    expect(codigo).toContain("WHEN 'afip_comprobantes' THEN v_encargado || ' AND cae IS NULL'");
  });

  it('la auditoría no se edita ni se borra', () => {
    expect(codigo).toContain("IF v_tabla NOT IN ('stock_history', 'document_access_log') THEN");
  });

  it('las claves de API ni siquiera las lee un vendedor', () => {
    expect(codigo).toContain("CASE v_tabla WHEN 'org_api_keys' THEN v_encargado ELSE v_miembro END");
  });

  it('la matriz prueba los dos lados y revierte', () => {
    const matriz = leer('scripts/sensitive-writes-matrix.sql');
    expect(matriz).toContain("'vendedor borra comprobante ARCA'");
    expect(matriz).toContain("'dueño borra comprobante CON CAE'");
    expect(matriz.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});
