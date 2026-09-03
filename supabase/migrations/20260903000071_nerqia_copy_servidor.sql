-- Completa el rebrand en mensajes producidos por funciones SQL. Las
-- migraciones históricas son inmutables y siguen documentando el nombre con
-- el que se aplicaron; la definición activa es la que debe hablar de Nerqia.
--
-- X-Gestiona-* es un contrato público versionado y se conserva hasta que haya
-- alias, telemetría de adopción y una ventana formal de deprecación.

DO $$
DECLARE
  v_function record;
  v_definition text;
BEGIN
  FOR v_function IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc LIKE '%Gestiona%'
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_definition := replace(v_definition, 'X-Gestiona', 'X-__NERQIA_LEGACY_HEADER__');
    v_definition := replace(v_definition, 'Gestiona', 'Nerqia');
    v_definition := replace(v_definition, 'X-__NERQIA_LEGACY_HEADER__', 'X-Gestiona');
    EXECUTE v_definition;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_visible_old_brand integer;
  v_legacy_headers integer;
BEGIN
  SELECT count(*)
    INTO v_visible_old_brand
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND replace(p.prosrc, 'X-Gestiona', 'X-Legacy') LIKE '%Gestiona%';

  IF v_visible_old_brand <> 0 THEN
    RAISE EXCEPTION '% funciones públicas conservan copy visible de la marca anterior', v_visible_old_brand;
  END IF;

  SELECT count(*)
    INTO v_legacy_headers
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc LIKE '%X-Gestiona%';

  IF v_legacy_headers = 0 THEN
    RAISE EXCEPTION 'Los headers X-Gestiona-* se retiraron sin versión de reemplazo';
  END IF;
END;
$$;
