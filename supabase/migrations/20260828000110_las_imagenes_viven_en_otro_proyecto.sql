-- 36 imágenes del catálogo viven en un proyecto Supabase que no es el nuestro
--
-- ── Cómo apareció ─────────────────────────────────────────────────────────
--
-- Auditando los datos estructurados de la tienda, el JSON-LD de un producto
-- devolvió una imagen alojada en `wcfohngxrtopgggumjmw.supabase.co`, mientras
-- que el logo del comercio sale de `hummeopatkniwkyrrhwc` — que es el proyecto
-- de la aplicación.
--
-- Medido el 2026-08-28: **37 filas** apuntan al proyecto viejo.
--
--     products.image_url    36
--     settings.logo_url      1
--
-- ⚠️ **No están rotas: responden 200.** La primera medición dio 404 y era un
-- artefacto —la URL venía truncada por el ancho de la tabla del runner—.
-- Verificado con la URL completa: 200, 64 KB, `image/png`.
--
-- ── Por qué importa igual ─────────────────────────────────────────────────
--
-- `scripts/migrate-data.mjs` nombra a ese proyecto como «el proyecto real»:
-- hubo una migración y las URLs de imagen quedaron apuntando al host anterior.
-- Ningún archivo de configuración lo menciona hoy.
--
-- 📌 Eso deja **el 60% del catálogo colgando de un proyecto que nadie
-- administra**: no está en las variables de entorno, no entra en los backups
-- del proyecto actual, y Supabase pausa los proyectos gratuitos por
-- inactividad. Servir imágenes estáticas puede no contar como actividad.
--
-- El día que se pause, la tienda pierde 36 fotos **en silencio** —el navegador
-- muestra un hueco, no un error— y la conversión se cae sin que nada avise.
--
-- ── Por qué esta migración no lo arregla ──────────────────────────────────
--
-- Mover los archivos es descargar de un proyecto y subir a otro, y eso toca el
-- catálogo real. Hacerlo a medias deja productos sin foto, que es peor que el
-- riesgo que viene a resolver. La forma segura es por archivo: subir, comprobar
-- que la URL nueva responde 200, y **recién entonces** actualizar la fila; si
-- algo falla, las que no se movieron conservan la URL que funciona.
--
-- Eso es una decisión del dueño sobre sus datos, no un arreglo silencioso. Lo
-- que sí corresponde es que deje de estar escondido.

CREATE OR REPLACE VIEW public.audit_imagen_en_otro_proyecto AS
SELECT 'products'::text  AS tabla,
       p.id::text        AS fila,
       p.org_id,
       p.name            AS que_es,
       p.image_url       AS url
  FROM public.products p
 WHERE p.image_url LIKE '%wcfohngxrtopgggumjmw%'
UNION ALL
SELECT 'settings',
       s.id::text,
       s.org_id,
       'logo del comercio',
       s.logo_url
  FROM public.settings s
 WHERE s.logo_url LIKE '%wcfohngxrtopgggumjmw%';

COMMENT ON VIEW public.audit_imagen_en_otro_proyecto IS
  'Imágenes alojadas en el proyecto Supabase anterior. Hoy responden 200, pero '
  'ese proyecto no está en ninguna configuración ni en los backups: el día que '
  'se pause, la tienda pierde las fotos en silencio. Mover los archivos es '
  'decisión del dueño; esta vista existe para que no se olvide.';

REVOKE ALL ON public.audit_imagen_en_otro_proyecto FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_n int;
  v_prod int;
BEGIN
  SELECT count(*) INTO v_n FROM public.audit_imagen_en_otro_proyecto;

  -- ⚠️ Esta vista NO tiene que estar vacía hoy: describe un riesgo real que
  -- sigue ahí. Lo que se verifica es que **encuentre** lo que se midió, porque
  -- una vista que devuelve 0 por un error de filtro esconde el problema en vez
  -- de mostrarlo — y se leería como «ya está resuelto».
  ASSERT v_n = 37,
    'la vista devuelve ' || v_n || ' y se midieron 37: o el filtro está mal, '
    'o alguien movió imágenes y hay que actualizar este número';

  SELECT count(*) INTO v_prod FROM public.audit_imagen_en_otro_proyecto
   WHERE tabla = 'products';
  ASSERT v_prod = 36, 'productos afectados: ' || v_prod || ', se midieron 36';

  -- Y que no marque de más: las que ya están en el proyecto actual quedan afuera.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.audit_imagen_en_otro_proyecto
     WHERE url LIKE '%hummeopatkniwkyrrhwc%'),
    'la vista marca imágenes que ya están en el proyecto actual';

  RAISE NOTICE 'OK: % imagen(es) colgando del proyecto anterior, a la vista', v_n;
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000110', 'las_imagenes_viven_en_otro_proyecto')
ON CONFLICT DO NOTHING;
