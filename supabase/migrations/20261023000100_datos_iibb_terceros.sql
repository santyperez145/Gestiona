-- Datos de Ingresos Brutos de proveedores y clientes, para declarar en AGIP.
--
-- El archivo de e-ARCIBA (diseño de AGIP vigente desde enero de 2022) pide,
-- por cada retención o percepción, la situación del sujeto en Ingresos
-- Brutos y su número de inscripción, y su condición frente al IVA. Hasta acá
-- no se guardaban:
--   1. `suppliers`: `iibb_situacion` (1 local, 2 Convenio Multilateral,
--      4 no inscripto), `iibb_inscripcion` y `condicion_iva` (la del padrón
--      de ARCA, la misma clave que `customers.vat_condition`).
--   2. `customers`: `iibb_situacion` e `iibb_inscripcion`.
-- La inscripción local es de 10 dígitos; en Convenio Multilateral es la CUIT.
-- Se escriben con los mismos permisos que el resto de la ficha.
-- Reversible: DROP de las columnas y sus restricciones.
BEGIN;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS iibb_situacion smallint,
  ADD COLUMN IF NOT EXISTS iibb_inscripcion text,
  ADD COLUMN IF NOT EXISTS condicion_iva text;
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_iibb_check;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_iibb_check CHECK (
  (iibb_situacion IS NULL OR iibb_situacion IN (1, 2, 4))
  AND (iibb_inscripcion IS NULL OR iibb_inscripcion ~ '^[0-9]{10,11}$')
  AND (condicion_iva IS NULL OR condicion_iva IN ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final')));

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS iibb_situacion smallint,
  ADD COLUMN IF NOT EXISTS iibb_inscripcion text;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_iibb_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_iibb_check CHECK (
  (iibb_situacion IS NULL OR iibb_situacion IN (1, 2, 4))
  AND (iibb_inscripcion IS NULL OR iibb_inscripcion ~ '^[0-9]{10,11}$'));

COMMENT ON COLUMN public.suppliers.iibb_situacion IS 'Ingresos Brutos para e-ARCIBA: 1 local, 2 Convenio Multilateral, 4 no inscripto.';
COMMENT ON COLUMN public.customers.iibb_situacion IS 'Ingresos Brutos para e-ARCIBA: 1 local, 2 Convenio Multilateral, 4 no inscripto.';

COMMIT;
