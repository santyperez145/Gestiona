-- El canal de activación no se adivina.
--
-- Medido 2026-09-01: `pruebas Workspace` no terminó el onboarding, no eligió
-- rubro y no tiene perfil. Aun así `onboarding_goal` era `pos` porque la
-- columna nació con DEFAULT 'pos' (20260821000059) y
-- `normalizeActivationGoal` convertía cualquier valor desconocido en POS.
-- El checklist daba por elegido el mostrador. Es la misma familia que
-- `industry_code DEFAULT 'perfumes'`.
--
-- Un comercio que no eligió está explorando. POS u online se escriben cuando
-- termina el wizard (`complete_business_onboarding`). Exentry, que sí eligió
-- POS y tiene perfil, no se toca.

ALTER TABLE public.organizations
  ALTER COLUMN onboarding_goal SET DEFAULT 'explore';

COMMENT ON COLUMN public.organizations.onboarding_goal IS
  'Primer canal que el comercio quiere llevar a una venta real. pos y online se escriben al terminar el onboarding; explore es el estado de quien todavía no eligió, nunca un default de producto.';

UPDATE public.organizations o
SET onboarding_goal = 'explore'
WHERE o.onboarding_completed = false
  AND o.onboarding_goal = 'pos'
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_business_profiles p
    WHERE p.org_id = o.id
  );

DO $$
DECLARE
  v_default text;
  v_incompletos int;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.organizations'::regclass
    AND a.attname = 'onboarding_goal';

  IF v_default IS DISTINCT FROM '''explore''::text' THEN
    RAISE EXCEPTION 'onboarding_goal default no es explore: %', v_default;
  END IF;

  SELECT count(*) INTO v_incompletos
  FROM public.organizations
  WHERE onboarding_completed = false
    AND onboarding_goal <> 'explore';

  IF v_incompletos <> 0 THEN
    RAISE EXCEPTION
      'hay % comercios sin terminar onboarding con un canal que nadie eligió',
      v_incompletos;
  END IF;
END $$;
