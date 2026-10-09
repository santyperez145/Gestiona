import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProductTypeTemplates } from '@/lib/businessProfile';
import { defaultProductTypeId } from '@/lib/productTypes';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20261009000000_hardware_business_profile.sql');
const verification = read('supabase/verificaciones/20261009_hardware_business_profile.sql');
const declaration = migration.match(/\$hardware\$([\s\S]*?)\$hardware\$::jsonb/)?.[1];
if (!declaration) throw new Error('Falta la declaración JSON del perfil Ferretería');
const rawTemplates = JSON.parse(declaration);
const templates = parseProductTypeTemplates(rawTemplates);

describe('Ferretería usa el Business Profiler y el catálogo único', () => {
  it('declara un tipo claro que permite el default sin adivinar el producto', () => {
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ name: 'Artículo de ferretería', slug: 'articulo-ferreteria' });
    expect(rawTemplates[0].maneja_stock).toBe(true);
    expect(defaultProductTypeId([{ id: 'tipo-ferreteria', source: 'business_profile' }])).toBe('tipo-ferreteria');
    expect(migration).toContain("'ferreteria', 'Ferretería'");
  });

  it('declara sólo atributos descriptivos y presentación, no otra autoridad de inventario', () => {
    expect(templates[0].attributes.map(attribute => [attribute.slug, attribute.dataType])).toEqual([
      ['modelo-referencia', 'text'], ['material', 'text'], ['medida', 'text'], ['presentacion', 'select'],
    ]);
    expect(templates[0].attributes[3].options).toEqual(['Unidad', 'Caja', 'Paquete', 'Blíster', 'Juego', 'Bobina', 'Envase']);
    expect(templates[0].attributes.every(attribute => !attribute.required && attribute.unit === null)).toBe(true);
    const reserved = new Set(['marca', 'sku', 'stock', 'precio']);
    expect(templates[0].attributes.every(attribute => !reserved.has(attribute.slug))).toBe(true);
  });

  it('sólo ofrece el preset sin reemplazar uno existente, retipar productos ni cambiar schema', () => {
    const sql = migration.replace(/--[^\n]*/g, '');
    expect(sql).toContain('INSERT INTO public.industry_presets');
    expect(sql).toMatch(/ON CONFLICT\s*\(code\)\s*DO NOTHING/);
    expect(sql).not.toMatch(/\b(ALTER|DROP|CREATE|DELETE|UPDATE)\b/i);
    expect(sql).not.toContain('public.products');
    expect(sql).not.toMatch(/\b(?:SELECT|PERFORM)\s+public\.(?:configure_business_profile|provision_business_blueprint)/i);
  });

  it('verifica la autoridad actual, sus permisos y replay sin dejar fixtures', () => {
    expect(verification).toMatch(/^BEGIN;$/m);
    expect(verification).toMatch(/ROLLBACK;\s*$/);
    expect(verification).toContain('public.provision_business_blueprint');
    expect(verification).toContain('public.business_blueprint_preview');
    expect(verification).toContain("membership.role = 'owner'");
    expect(verification).toContain("(v_org, v_outsider, 'viewer')");
    expect(verification).toContain("public.provision_business_blueprint(v_custom_org, 'ferreteria', v_key)");
    expect(verification).toContain('EXCEPTION WHEN insufficient_privilege');
    expect(verification).toContain("v_replay->>'run_id' IS DISTINCT FROM v_first->>'run_id'");
    expect(verification).toContain("EXCEPTION WHEN SQLSTATE 'ZX001'");
    expect(verification).toContain('IF v_resto <> 0 THEN');
    expect(verification).not.toMatch(/\bINSERT INTO auth\.users\b/i);
    expect(verification).not.toMatch(/\b(?:CREATE|DROP)\s+(?:FUNCTION|TRIGGER|TABLE)\b/i);
    expect(verification).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM) public\.products\b/i);
  });
});
