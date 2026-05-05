-- Persistir estado de onboarding por organizacion
-- Evita que el usuario vea el wizard al iniciar sesion desde otro dispositivo

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Marcar como completadas las orgs que ya tienen settings con business_name configurado
-- (indica que pasaron por el wizard)
UPDATE public.organizations o
SET onboarding_completed = true
WHERE EXISTS (
  SELECT 1 FROM public.settings s
  WHERE s.org_id = o.id
    AND s.business_name IS NOT NULL
    AND s.business_name != ''
    AND s.business_name != 'Mi Negocio'
);
