-- Fixture transaccional de la selección de cumpleaños y su claim. No invoca
-- Edge Functions, DolarAPI ni Meta y no envía ningún mensaje.
--
-- Ejecutar:
--   npx supabase db query --linked --file supabase/verificaciones/20260829_tareas_programadas_seguras.sql

BEGIN;

SELECT set_config('gestiona.fixture_user', (SELECT id::text FROM auth.users ORDER BY created_at LIMIT 1), true);
SELECT set_config('gestiona.fixture_org', gen_random_uuid()::text, true);
SELECT set_config('gestiona.fixture_customer', gen_random_uuid()::text, true);

INSERT INTO public.organizations(id, name, slug, owner_user_id)
VALUES (
  current_setting('gestiona.fixture_org')::uuid,
  'ZZ Edge recovery',
  'zz-edge-recovery-' || left(current_setting('gestiona.fixture_org'), 8),
  current_setting('gestiona.fixture_user')::uuid
);

INSERT INTO public.settings(org_id, user_id, business_name, whatsapp_birthday_enabled)
VALUES (
  current_setting('gestiona.fixture_org')::uuid,
  current_setting('gestiona.fixture_user')::uuid,
  'ZZ Comercio',
  true
)
ON CONFLICT (org_id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  whatsapp_birthday_enabled = true;

INSERT INTO public.customers(
  id, org_id, user_id, name, phone, birthday, marketing_consent_at
)
VALUES (
  current_setting('gestiona.fixture_customer')::uuid,
  current_setting('gestiona.fixture_org')::uuid,
  current_setting('gestiona.fixture_user')::uuid,
  'ZZ Cumpleaños',
  '+54 11 0000 0000',
  (current_date - interval '30 years')::date,
  now()
);

SET LOCAL ROLE service_role;

DO $candidate_and_claim$
DECLARE
  v_candidate record;
  v_duplicate_blocked boolean := false;
BEGIN
  SELECT * INTO v_candidate
  FROM public.birthday_whatsapp_candidates(current_date)
  WHERE customer_id = current_setting('gestiona.fixture_customer')::uuid;

  IF v_candidate.customer_id IS NULL
     OR v_candidate.business_name IS DISTINCT FROM 'ZZ Comercio' THEN
    RAISE EXCEPTION 'El candidato consentido no fue seleccionado';
  END IF;

  INSERT INTO public.birthday_whatsapp_deliveries(
    org_id, customer_id, birthday_date, status
  ) VALUES (
    current_setting('gestiona.fixture_org')::uuid,
    current_setting('gestiona.fixture_customer')::uuid,
    current_date,
    'processing'
  );

  BEGIN
    INSERT INTO public.birthday_whatsapp_deliveries(
      org_id, customer_id, birthday_date, status
    ) VALUES (
      current_setting('gestiona.fixture_org')::uuid,
      current_setting('gestiona.fixture_customer')::uuid,
      current_date,
      'processing'
    );
  EXCEPTION WHEN unique_violation THEN
    v_duplicate_blocked := true;
  END;

  IF NOT v_duplicate_blocked THEN
    RAISE EXCEPTION 'El mismo cumpleaños se reservó dos veces';
  END IF;
END;
$candidate_and_claim$;

RESET ROLE;
ROLLBACK;

SELECT
  'scheduled_edge_recovery' AS check_name,
  (SELECT count(*) FROM cron.job
   WHERE jobname IN ('fetch-usd-rate-daily', 'send-birthday-whatsapp-daily')
     AND active) AS active_jobs,
  has_function_privilege(
    'authenticated',
    'public.birthday_whatsapp_candidates(date)',
    'execute'
  ) AS authenticated_can_enumerate,
  (SELECT count(*) FROM public.organizations WHERE name = 'ZZ Edge recovery')
  + (SELECT count(*) FROM public.birthday_whatsapp_deliveries d
     JOIN public.organizations o ON o.id = d.org_id
     WHERE o.name = 'ZZ Edge recovery') AS restos;
