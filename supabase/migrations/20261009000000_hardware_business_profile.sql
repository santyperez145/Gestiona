-- Ferretería usa el catálogo polimórfico existente. El preset sólo declara
-- información descriptiva; marca, SKU, precio, proveedores, variantes y stock
-- siguen en sus autoridades actuales. Presentación no es una unidad de stock
-- ni habilita venta fraccionada o conversiones de unidades.
-- Se ofrece en onboarding y Tipos + Atributos; no se aplica a comercios ni
-- retipa productos existentes sin la confirmación owner/admin del Blueprint.

INSERT INTO public.industry_presets (
  code, name, default_color, default_secondary_color, ai_tone, active,
  sort_order, profile_version, default_settings, product_type_templates
)
VALUES (
  'ferreteria', 'Ferretería', '#F97316', '#1E293B',
  'técnico, claro y profesional rioplatense', true,
  9, 1, '{}'::jsonb,
  $hardware$[
    {
      "name": "Artículo de ferretería",
      "slug": "articulo-ferreteria",
      "description": "Herramientas, materiales y accesorios; las variantes y el inventario se administran en el catálogo único.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Modelo / referencia", "slug": "modelo-referencia", "data_type": "text", "filterable": true, "sort_order": 0},
        {"name": "Material", "slug": "material", "data_type": "text", "filterable": true, "sort_order": 1},
        {"name": "Medida", "slug": "medida", "data_type": "text", "filterable": true, "sort_order": 2},
        {"name": "Presentación", "slug": "presentacion", "data_type": "select", "options": ["Unidad", "Caja", "Paquete", "Blíster", "Juego", "Bobina", "Envase"], "filterable": true, "sort_order": 3}
      ]
    }
  ]$hardware$::jsonb
)
-- Un perfil ya registrado no se pisa: una evolución se publica con versión
-- y revisión explícitas, no reemplazando silenciosamente su estructura.
ON CONFLICT (code) DO NOTHING;
