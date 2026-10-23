-- Comprobantes de compra: la mitad que faltaba del Libro IVA Digital.
--
-- Un Responsable Inscripto paga cada mes el IVA de sus ventas menos el crédito
-- fiscal de sus compras. Nerqia tenía las ventas (cada factura con CAE) pero
-- no dónde registrar las facturas de los proveedores: ni CUIT, ni comprobante,
-- ni IVA. Sin eso no hay Libro IVA Compras ni posición de IVA del mes.
--
-- Cada fila es un comprobante recibido, con lo que pide el diseño de registro
-- de ARCA (RG 4597): tipo, punto de venta, número, CUIT y razón social del
-- emisor, alícuotas (neto e IVA), conceptos no gravados, exentos, percepciones
-- e impuestos internos. `periodo` es el mes en que se imputa el crédito.
--
-- La base valida lo que el importador de ARCA rechazaría:
--   · Comprobantes B y C no discriminan IVA: no llevan alícuotas.
--   · A y M: el IVA de cada alícuota corresponde a su neto (±1 peso).
--   · El total es la suma de sus partes (salvo B y C, como en el diseño).
--   · No se carga dos veces el mismo comprobante del mismo proveedor.
--
-- Datos fiscales del negocio: leen y escriben quienes pueden editar compras o
-- facturación (dueño y administradores siempre; vendedores, sólo si se les da).
-- Idempotente. Reversible: DROP TABLE public.comprobantes_de_compra.
BEGIN;

CREATE TABLE IF NOT EXISTS public.comprobantes_de_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  periodo text NOT NULL CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  fecha date NOT NULL,
  tipo_comprobante integer NOT NULL CHECK (tipo_comprobante BETWEEN 1 AND 999),
  punto_venta integer NOT NULL CHECK (punto_venta BETWEEN 0 AND 99999),
  numero bigint NOT NULL CHECK (numero > 0),
  cuit_emisor text NOT NULL CHECK (cuit_emisor ~ '^[0-9]{11}$'),
  razon_social_emisor text NOT NULL CHECK (length(btrim(razon_social_emisor)) BETWEEN 1 AND 200),
  alicuotas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(alicuotas) = 'array'),
  no_gravado numeric(15,2) NOT NULL DEFAULT 0 CHECK (no_gravado >= 0),
  exento numeric(15,2) NOT NULL DEFAULT 0 CHECK (exento >= 0),
  percepcion_iva numeric(15,2) NOT NULL DEFAULT 0 CHECK (percepcion_iva >= 0),
  percepcion_nacionales numeric(15,2) NOT NULL DEFAULT 0 CHECK (percepcion_nacionales >= 0),
  percepcion_iibb numeric(15,2) NOT NULL DEFAULT 0 CHECK (percepcion_iibb >= 0),
  percepcion_municipal numeric(15,2) NOT NULL DEFAULT 0 CHECK (percepcion_municipal >= 0),
  impuestos_internos numeric(15,2) NOT NULL DEFAULT 0 CHECK (impuestos_internos >= 0),
  otros_tributos numeric(15,2) NOT NULL DEFAULT 0 CHECK (otros_tributos >= 0),
  total numeric(15,2) NOT NULL CHECK (total > 0),
  notas text CHECK (notas IS NULL OR length(notas) <= 1000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comprobantes_de_compra_unico UNIQUE (org_id, cuit_emisor, tipo_comprobante, punto_venta, numero)
);

CREATE INDEX IF NOT EXISTS comprobantes_de_compra_periodo_idx
  ON public.comprobantes_de_compra (org_id, periodo, fecha);

COMMENT ON TABLE public.comprobantes_de_compra IS
  'Comprobantes recibidos de proveedores para el Libro IVA Digital Compras y la posición de IVA del mes. alicuotas = [{tasa, neto, iva}].';

-- Valida lo que ARCA rechazaría al importar el libro.
CREATE OR REPLACE FUNCTION public.validar_comprobante_de_compra()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_alic jsonb;
  v_tasa numeric;
  v_neto numeric;
  v_iva numeric;
  v_suma numeric := 0;
  v_tasas numeric[] := ARRAY[]::numeric[];
  -- B, C, tiques y FCE B/C: no discriminan IVA (tabla de comprobantes de ARCA).
  v_sin_iva boolean := NEW.tipo_comprobante IN (6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 61, 64, 82, 83, 111, 206, 207, 208, 211, 212, 213);
BEGIN
  NEW.razon_social_emisor := btrim(NEW.razon_social_emisor);
  IF v_sin_iva AND jsonb_array_length(NEW.alicuotas) > 0 THEN
    RAISE EXCEPTION 'Los comprobantes B y C no discriminan IVA: no llevan alícuotas.' USING ERRCODE = '22023';
  END IF;
  FOR v_alic IN SELECT * FROM jsonb_array_elements(NEW.alicuotas) LOOP
    IF jsonb_typeof(v_alic) <> 'object' OR jsonb_typeof(v_alic->'tasa') <> 'number'
       OR jsonb_typeof(v_alic->'neto') <> 'number' OR jsonb_typeof(v_alic->'iva') <> 'number' THEN
      RAISE EXCEPTION 'Cada alícuota lleva tasa, neto e IVA numéricos.' USING ERRCODE = '22023';
    END IF;
    v_tasa := (v_alic->>'tasa')::numeric;
    v_neto := round((v_alic->>'neto')::numeric, 2);
    v_iva := round((v_alic->>'iva')::numeric, 2);
    IF v_tasa NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
      RAISE EXCEPTION 'Alícuota de IVA no admitida: %.', v_tasa USING ERRCODE = '22023';
    END IF;
    IF v_tasa = ANY (v_tasas) THEN
      RAISE EXCEPTION 'La alícuota % está repetida.', v_tasa USING ERRCODE = '22023';
    END IF;
    IF v_neto < 0 OR v_iva < 0 OR abs(v_iva - round(v_neto * v_tasa / 100, 2)) > 1 THEN
      RAISE EXCEPTION 'El IVA de la alícuota % no corresponde a su neto.', v_tasa USING ERRCODE = '22023';
    END IF;
    v_tasas := v_tasas || v_tasa;
    v_suma := v_suma + v_neto + v_iva;
  END LOOP;
  IF NOT v_sin_iva THEN
    IF jsonb_array_length(NEW.alicuotas) = 0 AND NEW.no_gravado + NEW.exento = 0 THEN
      RAISE EXCEPTION 'Un comprobante A o M necesita al menos una alícuota, o importes no gravados o exentos.' USING ERRCODE = '22023';
    END IF;
    v_suma := v_suma + NEW.no_gravado + NEW.exento + NEW.percepcion_iva + NEW.percepcion_nacionales
      + NEW.percepcion_iibb + NEW.percepcion_municipal + NEW.impuestos_internos + NEW.otros_tributos;
    IF abs(v_suma - NEW.total) > 0.01 THEN
      RAISE EXCEPTION 'El total (%) no coincide con la suma de sus partes (%).', NEW.total, v_suma USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.periodo < to_char(NEW.fecha, 'YYYY-MM') THEN
    RAISE EXCEPTION 'El período de imputación no puede ser anterior a la fecha del comprobante.' USING ERRCODE = '22023';
  END IF;
  IF NEW.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s WHERE s.id = NEW.supplier_id AND s.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'El proveedor no es de este negocio.' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.validar_comprobante_de_compra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validar_comprobante_de_compra ON public.comprobantes_de_compra;
CREATE TRIGGER trg_validar_comprobante_de_compra
BEFORE INSERT OR UPDATE ON public.comprobantes_de_compra
FOR EACH ROW EXECUTE FUNCTION public.validar_comprobante_de_compra();

ALTER TABLE public.comprobantes_de_compra ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comprobantes_de_compra_leer ON public.comprobantes_de_compra;
CREATE POLICY comprobantes_de_compra_leer ON public.comprobantes_de_compra
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'purchases', 'edit') OR public.has_permission(org_id, 'invoices', 'edit'));

DROP POLICY IF EXISTS comprobantes_de_compra_crear ON public.comprobantes_de_compra;
CREATE POLICY comprobantes_de_compra_crear ON public.comprobantes_de_compra
  FOR INSERT TO authenticated
  WITH CHECK ((public.has_permission(org_id, 'purchases', 'edit') OR public.has_permission(org_id, 'invoices', 'edit'))
              AND created_by = auth.uid());

DROP POLICY IF EXISTS comprobantes_de_compra_editar ON public.comprobantes_de_compra;
CREATE POLICY comprobantes_de_compra_editar ON public.comprobantes_de_compra
  FOR UPDATE TO authenticated
  USING (public.has_permission(org_id, 'purchases', 'edit') OR public.has_permission(org_id, 'invoices', 'edit'))
  WITH CHECK (public.has_permission(org_id, 'purchases', 'edit') OR public.has_permission(org_id, 'invoices', 'edit'));

DROP POLICY IF EXISTS comprobantes_de_compra_borrar ON public.comprobantes_de_compra;
CREATE POLICY comprobantes_de_compra_borrar ON public.comprobantes_de_compra
  FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'purchases', 'delete') OR public.has_permission(org_id, 'invoices', 'delete'));

-- Producción le da todo a authenticated en cada tabla nueva (privilegios por
-- defecto de public): se revoca todo y se otorga sólo lo que hace falta.
REVOKE ALL ON public.comprobantes_de_compra FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comprobantes_de_compra TO authenticated;
GRANT ALL ON public.comprobantes_de_compra TO service_role;

-- Un comprobante no cambia de negocio ni de autor.
CREATE OR REPLACE FUNCTION public.comprobante_de_compra_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Un comprobante no cambia de negocio ni de autor.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.comprobante_de_compra_inmutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_comprobante_de_compra_inmutable ON public.comprobantes_de_compra;
CREATE TRIGGER trg_comprobante_de_compra_inmutable
BEFORE UPDATE ON public.comprobantes_de_compra
FOR EACH ROW EXECUTE FUNCTION public.comprobante_de_compra_inmutable();

COMMIT;
