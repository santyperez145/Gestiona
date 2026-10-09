-- Observaciones de ARCA en comprobantes autorizados.
--
-- ARCA puede otorgar el CAE y avisar algo a la vez (Observaciones/Obs): por
-- ejemplo, un receptor con datos dudosos o un monotributista cerca de su tope.
-- afip-authorize sólo lo escribía en el log. Ahora se guarda en la factura para
-- que el comercio lo vea; lo escribe únicamente el servicio, una sola vez.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS afip_observaciones jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_afip_observaciones_array') THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_afip_observaciones_array
      CHECK (afip_observaciones IS NULL OR jsonb_typeof(afip_observaciones) = 'array');
  END IF;
END;
$$;

COMMENT ON COLUMN public.invoices.afip_observaciones IS
  'Observaciones de ARCA al otorgar el CAE: [{code, msg}]. Sólo las escribe afip_registrar_observaciones (service_role).';

-- Desde el navegador no se inventan ni se borran observaciones.
CREATE OR REPLACE FUNCTION public.trg_invoices_observaciones_solo_servicio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.afip_observaciones := NULL;
  ELSIF NEW.afip_observaciones IS DISTINCT FROM OLD.afip_observaciones THEN
    NEW.afip_observaciones := OLD.afip_observaciones;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_observaciones_solo_servicio ON public.invoices;
CREATE TRIGGER trg_invoices_observaciones_solo_servicio
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoices_observaciones_solo_servicio();

CREATE OR REPLACE FUNCTION public.afip_registrar_observaciones(p_invoice_id uuid, p_observaciones jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_observaciones IS NULL OR jsonb_typeof(p_observaciones) <> 'array' OR jsonb_array_length(p_observaciones) = 0 THEN
    RETURN;
  END IF;
  -- Sólo sobre un comprobante ya autorizado y sin observaciones previas.
  UPDATE public.invoices
  SET afip_observaciones = (
    SELECT jsonb_agg(jsonb_build_object('code', (o->>'code')::int, 'msg', left(COALESCE(o->>'msg', ''), 500)))
    FROM jsonb_array_elements(p_observaciones) o
    WHERE (o->>'code') ~ '^\d{1,6}$'
  )
  WHERE id = p_invoice_id AND cae IS NOT NULL AND afip_observaciones IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.afip_registrar_observaciones(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_registrar_observaciones(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.trg_invoices_observaciones_solo_servicio() FROM PUBLIC, anon, authenticated;
