import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Segunda vuelta del barrido de RLS (2026-10-10): 65 tablas de gestión donde
 * un vendedor creaba, editaba y borraba —proveedores, la lista de bajas de
 * email, tipos de producto—. Ver scripts/management-writes-matrix.sql.
 */
const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');
const migracion = leer('supabase/migrations/20261010000400_gestion_escriben_encargados.sql');
const codigo = migracion.slice(migracion.indexOf('DO $$'));
const tablas = [...codigo.matchAll(/^\s+"([a-z_]+)": "[a-z_]+",?$/gm)].map(m => m[1]);

describe('gestión: escriben dueño y admin', () => {
  it('cubre las 65 tablas medidas', () => {
    expect(tablas).toHaveLength(65);
    for (const t of ['suppliers', 'email_suppressions', 'product_types', 'fixed_assets']) expect(tablas).toContain(t);
  });

  it('deja afuera lo que usa un vendedor o lo que no tiene org_id', () => {
    // Clientes reasigna puntos al fusionar; las hijas pasan por la tabla padre.
    for (const t of ['loyalty_points', 'customers', 'tasks', 'deliveries', 'plm_versions', 'recipe_ingredients']) {
      expect(tablas).not.toContain(t);
    }
  });

  it('no deja políticas FOR ALL y escribir exige rol', () => {
    expect(codigo).not.toMatch(/FOR ALL/);
    expect(codigo).toContain("public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])");
    expect(codigo).toContain('FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()))');
  });

  it('la matriz prueba vendedor y dueño y revierte', () => {
    const matriz = leer('scripts/management-writes-matrix.sql');
    expect(matriz).toContain("'vendedor borra una baja de email'");
    expect(matriz).toContain("'dueño borra una baja de email'");
    expect(matriz.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});

describe('las tablas hijas siguen a su padre (20261010000500)', () => {
  const hijas = leer('supabase/migrations/20261010000500_hijas_escriben_encargados.sql');
  const sql = hijas.slice(hijas.indexOf('DO $$'));

  it('cubre las seis hijas sin org_id', () => {
    for (const t of ['plm_quality_checks', 'plm_stage_history', 'plm_versions', 'portal_ticket_messages', 'purchase_request_items', 'recipe_ingredients']) {
      expect(sql).toContain(`('${t}',`);
    }
  });

  it('resuelve el rol en la organización del padre', () => {
    expect(sql).toContain("public.has_org_role(p.org_id, auth.uid(), ARRAY['owner', 'admin'])");
    expect(sql).not.toMatch(/FOR ALL/);
  });

  it('la matriz incluye una hija', () => {
    expect(leer('scripts/management-writes-matrix.sql')).toContain("'vendedor borra un ingrediente (hija)'");
  });
});
