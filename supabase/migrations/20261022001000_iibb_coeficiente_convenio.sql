-- Coeficiente unificado del Convenio Multilateral en cada inscripción de IIBB.
--
-- La liquidación mensual de Ingresos Brutos (Libro IVA Digital → «Ingresos
-- Brutos del período») reparte la base imponible del mes entre las
-- jurisdicciones con este coeficiente, el que surge del CM05 de cada año.
-- Para el contribuyente local queda NULL: toda la base va a su jurisdicción.
--
-- Escriben dueño y administrador (políticas de 20261010000400); leen los
-- miembros.
-- Reversible: ALTER TABLE public.iibb_registrations DROP COLUMN coeficiente.
BEGIN;

ALTER TABLE public.iibb_registrations ADD COLUMN IF NOT EXISTS coeficiente numeric(7,6);
ALTER TABLE public.iibb_registrations DROP CONSTRAINT IF EXISTS iibb_registrations_coeficiente_check;
ALTER TABLE public.iibb_registrations ADD CONSTRAINT iibb_registrations_coeficiente_check
  CHECK (coeficiente IS NULL OR (coeficiente > 0 AND coeficiente <= 1));
COMMENT ON COLUMN public.iibb_registrations.coeficiente IS
  'Coeficiente unificado del Convenio Multilateral (CM05), mayor que 0 y hasta 1. NULL para contribuyente local.';

COMMIT;
