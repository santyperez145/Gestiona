-- Las 37 imágenes volvieron al proyecto de la aplicación
--
-- ── Qué se hizo ───────────────────────────────────────────────────────────
--
-- `20260828000110` dejó a la vista que **37 filas** apuntaban a
-- `wcfohngxrtopgggumjmw.supabase.co` —36 imágenes de producto y el logo del
-- comercio— y decía que moverlas era decisión del dueño. El dueño la tomó el
-- 2026-08-28: «eliminá el otro Supabase».
--
-- Se movieron con la Edge Function `migrar-imagenes`, que corre del lado del
-- servidor porque ahí vive la `service_role`. Por cada archivo, de a uno:
--
--   1. Descargar del proyecto viejo. Si falla → se deja como está.
--   2. Subir al bucket del proyecto actual. Si falla → se deja como está.
--   3. Pedir la URL nueva y comprobar que responda 200 **con el mismo peso**.
--      Si no → se deja como está.
--   4. Recién entonces, actualizar la fila.
--
-- ⚠️ **Ese orden es lo único que lo hace seguro.** Si se corta a la mitad, las
-- filas que no se movieron conservan la URL que funciona. Y no se borró nada
-- del proyecto viejo: borrar el origen antes de que el destino esté probado es
-- cómo una migración de archivos deja un catálogo sin fotos.
--
-- ── Resultado, medido ─────────────────────────────────────────────────────
--
--     antes    36 productos en el proyecto viejo, 14 en el actual, 10 sin foto
--     después  50 productos en el proyecto actual, 10 sin foto, 0 en el viejo
--
-- Verificado además fuera de la función, pidiendo cinco URLs migradas al azar:
-- las cinco responden **200 con bytes de imagen reales** (204 KB, 126 KB,
-- 107 KB, 64 KB, 162 KB), y la primera coincide byte a byte con el original
-- que se midió antes de mover (64.172 bytes).
--
-- ── Qué falta, y es del dueño ─────────────────────────────────────────────
--
-- 📌 El proyecto `wcfohngxrtopgggumjmw` ya **no lo necesita nadie**: ninguna
-- fila de la base lo nombra y ningún archivo de configuración lo menciona. Se
-- puede borrar desde el panel de Supabase. Conviene mirar la tienda primero:
-- las fotos tienen que estar todas, y si algo faltara, el original todavía está
-- del otro lado.

COMMENT ON VIEW public.audit_imagen_en_otro_proyecto IS
  'Imágenes que todavía viven en el proyecto Supabase anterior. Tiene que estar '
  'VACÍA desde el 2026-08-28, cuando se migraron las 37 con migrar-imagenes. '
  'Una fila acá significa que algo volvió a guardar una URL de ese host, o que '
  'una migración vieja reapareció: el proyecto ya no está en ninguna '
  'configuración y puede desaparecer sin aviso.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_pend  int;
  v_aqui  int;
  v_sin   int;
  v_migra int;
BEGIN
  -- ── a. No queda nada apuntando al proyecto viejo ────────────────────────
  SELECT count(*) INTO v_pend FROM public.audit_imagen_en_otro_proyecto;
  ASSERT v_pend = 0,
    v_pend || ' fila(s) siguen apuntando al proyecto anterior';

  -- ── b. ⚠️ Y ningún producto perdió su foto en el camino ─────────────────
  -- Sin esta mitad, «0 pendientes» pasaría igual habiendo puesto todo en NULL.
  SELECT count(*) FILTER (WHERE image_url LIKE '%hummeopatkniwkyrrhwc%'),
         count(*) FILTER (WHERE image_url IS NULL)
    INTO v_aqui, v_sin
    FROM public.products;

  ASSERT v_aqui = 50,
    'productos con imagen en el proyecto actual: ' || v_aqui || ', se esperaban 50';
  ASSERT v_sin = 10,
    'productos sin imagen: ' || v_sin || ', eran 10 antes de migrar — '
    'si subió, la migración perdió fotos';

  -- ── c. Las 36 movidas están donde las dejó la función ───────────────────
  SELECT count(*) INTO v_migra FROM public.products
   WHERE image_url LIKE '%/migradas/%';
  ASSERT v_migra = 36,
    'se movieron ' || v_migra || ' y se esperaban 36';

  -- ── d. Y el logo del comercio tambien volvio ────────────────────────────
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.settings WHERE logo_url LIKE '%wcfohngxrtopgggumjmw%'),
    'el logo del comercio sigue en el proyecto anterior';

  RAISE NOTICE 'OK: 0 en el proyecto viejo, % productos con foto acá, % sin foto',
    v_aqui, v_sin;
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000120', 'las_imagenes_ya_estan_en_casa')
ON CONFLICT DO NOTHING;
