import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Un vendedor borraba zonas y tarifas de envío por la API: la política FOR ALL
 * chequeaba el rol sólo en WITH CHECK, y un DELETE sólo evalúa USING. Medido
 * el 2026-10-10 con scripts/shipping-config-matrix.sql (antes 1 y 1, después 0).
 */
const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');

describe('el tarifario lo tocan dueño y admin', () => {
  const migracion = leer('supabase/migrations/20261010000200_tarifario_solo_encargados.sql');
  // El código, sin la cabecera que cuenta qué había antes.
  const sql = migracion.slice(migracion.indexOf('DO $$'));

  it('separa las políticas por comando y borra la FOR ALL', () => {
    expect(sql).toContain("DROP POLICY IF EXISTS org_%1$s ON public.%1$I");
    expect(sql).toContain('FOR SELECT TO authenticated');
    expect(sql).toContain('FOR DELETE TO authenticated');
    expect(sql).not.toMatch(/FOR ALL/);
  });

  it('el borrado exige rol de encargado, no sólo membresía', () => {
    const borrar = sql.slice(sql.indexOf('FOR DELETE'), sql.indexOf('$p$, v_tabla);', sql.indexOf('FOR DELETE')));
    expect(borrar).toContain("public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])");
  });

  it('la matriz deja constancia y revierte', () => {
    const matriz = leer('scripts/shipping-config-matrix.sql');
    expect(matriz).toContain("'vendedor borra zona'");
    expect(matriz.trim().endsWith('ROLLBACK;')).toBe(true);
  });

  it('la pantalla no le ofrece la configuración a un vendedor', () => {
    const envios = leer('src/pages/DeliveryTrackingPage.tsx');
    expect(envios).toContain('const configuraEnvios = activeRole === "owner" || activeRole === "admin";');
    expect(envios).toContain('{configuraEnvios && <>');
  });

  it('las escrituras de envíos miran el error', () => {
    const envios = leer('src/pages/DeliveryTrackingPage.tsx');
    expect(envios).not.toMatch(/\n\s+await supabase\.from\("deliveries"\)\.(update|delete)\(/);
    expect(envios).not.toMatch(/\n\s+await supabase\.from\("delivery_events"\)\.insert\(/);
  });
});
