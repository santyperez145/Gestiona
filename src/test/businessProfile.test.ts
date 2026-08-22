import { describe, expect, it } from 'vitest';
import { parseProductTypeTemplates, summarizeBusinessProfile } from '@/lib/businessProfile';

describe('Business Profiler', () => {
  it('interpreta tipos y atributos declarativos sin ejecutar configuracion arbitraria', () => {
    const templates = parseProductTypeTemplates([
      {
        name: 'Perfume',
        slug: 'perfume',
        description: 'Fragancias',
        ignored_command: 'DROP TABLE products',
        attributes: [
          { name: 'Contenido', slug: 'contenido-ml', data_type: 'number', unit: 'ml' },
          { name: 'Familia', slug: 'familia', data_type: 'multiselect', options: ['Floral', '', 'Amaderada'] },
        ],
      },
    ]);

    expect(templates).toEqual([{
      name: 'Perfume',
      slug: 'perfume',
      description: 'Fragancias',
      attributes: [
        { name: 'Contenido', slug: 'contenido-ml', dataType: 'number', unit: 'ml', options: [], required: false, filterable: true },
        { name: 'Familia', slug: 'familia', dataType: 'multiselect', unit: null, options: ['Floral', 'Amaderada'], required: false, filterable: true },
      ],
    }]);
  });

  it('descarta estructuras y tipos de dato desconocidos', () => {
    expect(parseProductTypeTemplates({ name: 'No es una lista' })).toEqual([]);
    expect(parseProductTypeTemplates([
      { name: 'Sin slug', attributes: [] },
      { name: 'Valido', slug: 'valido', attributes: [
        { name: 'Codigo', slug: 'codigo', data_type: 'executable' },
        { name: 'Activo', slug: 'activo', data_type: 'boolean', required: true, filterable: false },
      ] },
    ])).toEqual([{
      name: 'Valido',
      slug: 'valido',
      description: null,
      attributes: [
        { name: 'Activo', slug: 'activo', dataType: 'boolean', unit: null, options: [], required: true, filterable: false },
      ],
    }]);
  });

  it('resume cantidades y nombres para explicar el cambio antes de aplicarlo', () => {
    const summary = summarizeBusinessProfile(parseProductTypeTemplates([
      { name: 'Dispositivo', slug: 'dispositivo', attributes: [
        { name: 'Modelo', slug: 'modelo', data_type: 'text' },
      ] },
      { name: 'Liquido', slug: 'liquido', attributes: [
        { name: 'Sabor', slug: 'sabor', data_type: 'text' },
        { name: 'Nicotina', slug: 'nicotina', data_type: 'number' },
      ] },
    ]));

    expect(summary).toEqual({
      typeCount: 2,
      attributeCount: 3,
      typeNames: ['Dispositivo', 'Liquido'],
      attributeNames: ['Modelo', 'Sabor', 'Nicotina'],
    });
  });
});
