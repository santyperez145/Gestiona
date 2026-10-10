-- ═══════════════════════════════════════════════════════════════════════════
-- Rubros de cualquier comercio, en el orden en que aparecen en la calle
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido el 2026-10-09 en la base vinculada: nueve rubros activos, con
-- Perfumes y Vapers en los dos primeros lugares —los del negocio original—, y
-- sin ferretería, librería, hogar, mascotas, deportes, juguetería ni
-- autopartes. Quien entraba a configurar una ferretería elegía «Otro» y
-- arrancaba con un tipo de producto que sólo tiene marca y modelo.
--
-- Los rubros son datos (20260827000090): agregar uno es un INSERT. Cada uno
-- trae tipos de producto con los atributos que de verdad se filtran en ese
-- rubro —la medida y el material en una ferretería, la especie y la etapa en
-- un pet shop—, así el catálogo arranca útil en vez de vacío.
--
-- Los existentes no cambian de código ni de plantillas: sólo de orden, y dos
-- de nombre para que digan lo que abarcan («Almacén y alimentos», «Belleza y
-- cosmética», «Tecnología y electro»). Una organización con un rubro ya
-- elegido no se toca: `configure_business_profile` sólo corre cuando se elige.
--
-- Idempotente (ON CONFLICT (code) DO UPDATE). Reversible: UPDATE active=false.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Orden y nombres de los existentes ──────────────────────────────────────
UPDATE public.industry_presets SET sort_order = 1,  name = 'Almacén y alimentos'   WHERE code = 'alimentos';
UPDATE public.industry_presets SET sort_order = 2                                   WHERE code = 'indumentaria';
UPDATE public.industry_presets SET sort_order = 4,  name = 'Tecnología y electro'  WHERE code = 'tecnologia';
UPDATE public.industry_presets SET sort_order = 6,  name = 'Belleza y cosmética'   WHERE code = 'cosmetica';
UPDATE public.industry_presets SET sort_order = 7                                   WHERE code = 'gastronomia';
UPDATE public.industry_presets SET sort_order = 8                                   WHERE code = 'servicios';
UPDATE public.industry_presets SET sort_order = 14                                  WHERE code = 'perfumes';
UPDATE public.industry_presets SET sort_order = 15                                  WHERE code = 'vapers';

-- ── Rubros nuevos ──────────────────────────────────────────────────────────
INSERT INTO public.industry_presets
  (code, name, default_color, default_secondary_color, ai_tone, active, sort_order,
   profile_version, default_settings, product_type_templates)
VALUES
  ('ferreteria', 'Ferretería y construcción', '24 90% 50%', '210 15% 35%',
   'práctico y claro', true, 3, 1, '{}'::jsonb,
   '[{
      "name": "Artículo de ferretería",
      "slug": "articulo-ferreteria",
      "description": "Herramientas, bulonería, sanitarios, electricidad y materiales. Lo que se vende por metro o por kilo usa la unidad de medida del producto.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Medida", "slug": "medida", "data_type": "text", "filterable": true},
        {"name": "Material", "slug": "material", "data_type": "select",
         "options": ["Acero", "Acero inoxidable", "Bronce", "Galvanizado", "Hierro", "Plástico", "PVC", "Madera", "Aluminio"], "filterable": true},
        {"name": "Rubro", "slug": "rubro-ferreteria", "data_type": "select",
         "options": ["Herramientas", "Bulonería", "Electricidad", "Sanitarios", "Pinturería", "Construcción", "Jardín"], "filterable": true}
      ]
    },
    {
      "name": "Herramienta eléctrica",
      "slug": "herramienta-electrica",
      "description": "Herramientas con motor: llevan garantía y número de serie.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Potencia", "slug": "potencia-w", "data_type": "number", "unit": "W", "filterable": true},
        {"name": "Alimentación", "slug": "alimentacion", "data_type": "select",
         "options": ["220 V", "Batería", "Batería y 220 V"], "filterable": true},
        {"name": "Garantía", "slug": "garantia-meses", "data_type": "number", "unit": "meses", "filterable": false}
      ]
    }]'::jsonb),

  ('hogar', 'Hogar y decoración', '28 45% 55%', '160 25% 40%',
   'cálido y cercano', true, 5, 1, '{}'::jsonb,
   '[{
      "name": "Artículo de hogar",
      "slug": "articulo-hogar",
      "description": "Bazar, textil, decoración y muebles. Color y medida se administran como variantes si tienen stock propio.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Ambiente", "slug": "ambiente", "data_type": "select",
         "options": ["Cocina", "Living", "Dormitorio", "Baño", "Exterior", "Oficina"], "filterable": true},
        {"name": "Material", "slug": "material", "data_type": "text", "filterable": true},
        {"name": "Medidas", "slug": "medidas", "data_type": "text", "filterable": false}
      ]
    }]'::jsonb),

  ('libreria', 'Librería y papelería', '214 70% 48%', '45 90% 50%',
   'amable y ordenado', true, 9, 1, '{}'::jsonb,
   '[{
      "name": "Artículo de librería",
      "slug": "articulo-libreria",
      "description": "Útiles escolares, papelería, artículos de oficina y arte.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Categoría", "slug": "categoria-libreria", "data_type": "select",
         "options": ["Escolar", "Oficina", "Arte", "Papelería", "Regalería"], "filterable": true},
        {"name": "Nivel", "slug": "nivel", "data_type": "multiselect",
         "options": ["Inicial", "Primaria", "Secundaria", "Universidad"], "filterable": true}
      ]
    },
    {
      "name": "Libro",
      "slug": "libro",
      "description": "Libros con ISBN como código de barras.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Autor", "slug": "autor", "data_type": "text", "filterable": true},
        {"name": "Editorial", "slug": "editorial", "data_type": "text", "filterable": true},
        {"name": "Género", "slug": "genero-literario", "data_type": "text", "filterable": true}
      ]
    }]'::jsonb),

  ('mascotas', 'Mascotas', '145 55% 40%', '30 80% 55%',
   'cariñoso y confiable', true, 10, 1, '{}'::jsonb,
   '[{
      "name": "Alimento para mascotas",
      "slug": "alimento-mascotas",
      "description": "Alimento balanceado y snacks. El peso de la bolsa es el dato con el que se compara precio.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Especie", "slug": "especie", "data_type": "select",
         "options": ["Perro", "Gato", "Ave", "Pez", "Roedor", "Otro"], "filterable": true},
        {"name": "Etapa", "slug": "etapa", "data_type": "select",
         "options": ["Cachorro", "Adulto", "Senior", "Todas"], "filterable": true},
        {"name": "Peso neto", "slug": "peso-neto-kg", "data_type": "number", "unit": "kg", "filterable": true}
      ]
    },
    {
      "name": "Accesorio para mascotas",
      "slug": "accesorio-mascotas",
      "description": "Correas, camas, juguetes, higiene.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Especie", "slug": "especie", "data_type": "select",
         "options": ["Perro", "Gato", "Ave", "Pez", "Roedor", "Otro"], "filterable": true},
        {"name": "Tamaño", "slug": "tamano", "data_type": "select",
         "options": ["Chico", "Mediano", "Grande"], "filterable": true}
      ]
    }]'::jsonb),

  ('deportes', 'Deportes y aire libre', '200 80% 45%', '95 55% 45%',
   'enérgico y directo', true, 11, 1, '{}'::jsonb,
   '[{
      "name": "Artículo deportivo",
      "slug": "articulo-deportivo",
      "description": "Equipamiento, calzado e indumentaria deportiva. Talle y color van como variantes.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Deporte", "slug": "deporte", "data_type": "select",
         "options": ["Fútbol", "Running", "Tenis y pádel", "Gimnasio", "Natación", "Ciclismo", "Camping", "Pesca", "Otro"], "filterable": true},
        {"name": "Género", "slug": "genero", "data_type": "select",
         "options": ["Unisex", "Mujer", "Hombre", "Niños"], "filterable": true}
      ]
    }]'::jsonb),

  ('jugueteria', 'Juguetería', '330 75% 55%', '50 95% 55%',
   'alegre y claro', true, 12, 1, '{}'::jsonb,
   '[{
      "name": "Juguete",
      "slug": "juguete",
      "description": "Juguetes y juegos. La edad recomendada es el primer filtro de quien compra para regalar.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Edad recomendada", "slug": "edad-recomendada", "data_type": "select",
         "options": ["0 a 2 años", "3 a 5 años", "6 a 8 años", "9 a 12 años", "Más de 12 años"], "filterable": true},
        {"name": "Tipo de juego", "slug": "tipo-juego", "data_type": "select",
         "options": ["Didáctico", "Muñecos y figuras", "Vehículos", "Juegos de mesa", "Aire libre", "Construcción", "Peluches"], "filterable": true}
      ]
    }]'::jsonb),

  ('autopartes', 'Autopartes y accesorios', '0 0% 30%', '4 80% 50%',
   'técnico y preciso', true, 13, 1, '{}'::jsonb,
   '[{
      "name": "Repuesto",
      "slug": "repuesto",
      "description": "Repuestos y accesorios. El código de fabricante y la compatibilidad son lo que se busca.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Marca", "slug": "marca", "data_type": "text", "filterable": true},
        {"name": "Código de fabricante", "slug": "codigo-fabricante", "data_type": "text", "filterable": true},
        {"name": "Vehículo compatible", "slug": "vehiculo-compatible", "data_type": "text", "filterable": true},
        {"name": "Sistema", "slug": "sistema", "data_type": "select",
         "options": ["Motor", "Frenos", "Suspensión", "Eléctrico", "Filtros y lubricantes", "Carrocería", "Accesorios"], "filterable": true}
      ]
    }]'::jsonb)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      default_color = EXCLUDED.default_color,
      default_secondary_color = EXCLUDED.default_secondary_color,
      ai_tone = EXCLUDED.ai_tone,
      product_type_templates = EXCLUDED.product_type_templates,
      active = EXCLUDED.active,
      sort_order = EXCLUDED.sort_order;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación: cada rubro nuevo se aplica de verdad y deja sus tipos
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_user   uuid;
  v_codigo text;
  v_tipos  int;
  v_attrs  int;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'Fixture de rubros omitido: no hay miembro';
    RETURN;
  END IF;
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ verificacion rubros nuevos', 'zz-rubros-nuevos-' || substr(v_org::text, 1, 8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  FOREACH v_codigo IN ARRAY ARRAY['ferreteria', 'hogar', 'libreria', 'mascotas', 'deportes', 'jugueteria', 'autopartes'] LOOP
    PERFORM public.configure_business_profile(v_org, v_codigo);
  END LOOP;

  SELECT count(*) INTO v_tipos FROM public.product_types WHERE org_id = v_org;
  SELECT count(*) INTO v_attrs FROM public.attribute_definitions a
    JOIN public.product_types t ON t.id = a.product_type_id WHERE t.org_id = v_org;
  ASSERT v_tipos >= 10, 'los rubros nuevos dejaron ' || v_tipos || ' tipos, se esperaban 10';
  ASSERT v_attrs >= 30, 'los rubros nuevos dejaron ' || v_attrs || ' atributos';

  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.product_types WHERE org_id = v_org;
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' tipos ZZ';

  RAISE NOTICE 'OK: % tipos y % atributos de los siete rubros nuevos, sin restos', v_tipos, v_attrs;
END $verif$;
