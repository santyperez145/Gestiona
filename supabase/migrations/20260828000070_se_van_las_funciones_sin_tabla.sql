-- Se van las funciones que apuntan a tablas que ya no existen
--
-- ── Por qué ───────────────────────────────────────────────────────────────
--
-- `20260828000060` corrió `plpgsql_check` sobre todas las funciones de
-- `public` y encontró 13 errores. Tres eran un feature roto —el buzón de
-- Finance, ya corregido—. Los otros diez son restos de los módulos que se
-- retiraron en la migración destructiva de 2026-08-02: funciones que siguen
-- nombrando `badge_definitions`, `payroll_periods`, `rental_contracts`,
-- `event_attendees` y compañía, tablas que se dropearon con sus 0 filas.
--
-- 📌 **El motivo para borrarlas no es la prolijidad: es que el chequeo sirva.**
-- Con diez errores permanentes, la próxima persona que corra `plpgsql_check`
-- tiene que triar diez falsos positivos antes de ver el verdadero — y a la
-- segunda vez deja de correrlo. Un chequeo que hay que filtrar a mano es un
-- chequeo que nadie usa.
--
-- ── Qué se comprobó antes de borrar ───────────────────────────────────────
--
-- Medido el 2026-08-28, y en los tres lugares donde podría estar usada:
--
--   - **El código de la app** (`src`, `supabase/functions`, `api`): ninguna
--     aparece, salvo en `types.ts`, que es generado.
--   - **Triggers**: ninguna está colgada de uno. No podría estarlo: los
--     triggers viven en las tablas que ya no existen.
--   - **Otras funciones**: ninguna las llama.
--
-- ⚠️ Borrar no se deshace, así que se comprobaron las tres cosas antes y no
-- después. Y quedan en la historia de git como todo lo demás.

DROP FUNCTION IF EXISTS public.award_badge(uuid, uuid, uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.award_xp(uuid, uuid, integer, text, jsonb);
DROP FUNCTION IF EXISTS public.generate_claim_number(uuid);
DROP FUNCTION IF EXISTS public.generate_download_token();
DROP FUNCTION IF EXISTS public.generate_dropship_number(uuid);
DROP FUNCTION IF EXISTS public.generate_license_key();
DROP FUNCTION IF EXISTS public.generate_payroll(uuid, uuid);
DROP FUNCTION IF EXISTS public.generate_rental_number(uuid);
DROP FUNCTION IF EXISTS public.generate_ticket_code();
DROP FUNCTION IF EXISTS public.seed_journey_stages(uuid);

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_quedan int;
  v_vivas  int;
BEGIN
  -- ── a. No queda ninguna de las diez ─────────────────────────────────────
  SELECT count(*) INTO v_quedan
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('award_badge', 'award_xp', 'generate_claim_number',
                       'generate_download_token', 'generate_dropship_number',
                       'generate_license_key', 'generate_payroll',
                       'generate_rental_number', 'generate_ticket_code',
                       'seed_journey_stages');
  ASSERT v_quedan = 0, v_quedan || ' función(es) huérfana(s) siguen ahí';

  -- ── b. ⚠️ Y no se llevó puesto nada vivo ────────────────────────────────
  -- Sin esta mitad, «se borraron las diez» pasaría igual habiendo dropeado de
  -- más. El número exacto importa menos que el orden de magnitud: si el
  -- catálogo de funciones se desplomó, algo se fue con ellas.
  SELECT count(*) INTO v_vivas
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public' AND l.lanname = 'plpgsql';
  ASSERT v_vivas > 200,
    'quedaron sólo ' || v_vivas || ' funciones plpgsql: se borró de más';

  -- ── c. Las del buzón de Finance siguen ──────────────────────────────────
  -- Son las que se acaban de arreglar; un DROP de más las habría alcanzado.
  ASSERT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'finance_document%') > 5,
    'se llevó puestas funciones del buzón de Finance';

  RAISE NOTICE 'OK: se fueron las diez huérfanas y quedaron % funciones plpgsql', v_vivas;
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000070', 'se_van_las_funciones_sin_tabla')
ON CONFLICT DO NOTHING;
