import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tercera vuelta del barrido de RLS (2026-10-10): cinco registros del día a
 * día —uso de cupones, historial de envíos, actividad del CRM, inscripciones a
 * secuencias y campañas por segmento— se podían reescribir. Borrar el uso de
 * un cupón le devolvía a la promoción los usos ya gastados.
 */
const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');
const migracion = leer('supabase/migrations/20261010001500_registros_no_se_reescriben.sql');
const codigo = migracion.slice(migracion.indexOf('DO $$'));

describe('los registros se agregan, no se reescriben', () => {
  it('cubre las cinco tablas y no deja FOR ALL', () => {
    for (const t of ['promotion_usages', 'delivery_events', 'deal_activities', 'drip_enrollments', 'segment_campaigns']) {
      expect(codigo).toContain(`('${t}',`);
    }
    expect(codigo).not.toMatch(/FOR ALL/);
  });

  it('el uso de un cupón y el historial de un envío no los reescribe nadie', () => {
    expect(codigo).toMatch(/\('promotion_usages',[^\n]*false\)/);
    expect(codigo).toMatch(/'delivery_events',[\s\S]*?false\)/);
  });

  it('cualquier miembro sigue registrando: el POS no se rompe', () => {
    expect(codigo).toContain("FOR INSERT TO authenticated WITH CHECK (%2$s)', v_fila.tabla, v_leer");
  });

  it('la matriz prueba los dos lados y revierte', () => {
    const matriz = leer('scripts/daily-records-matrix.sql');
    expect(matriz).toContain("'vendedor registra el uso de un cupón'");
    expect(matriz).toContain("'dueño borra el uso de un cupón (debe ser 0)'");
    expect(matriz.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});
