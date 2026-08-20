-- ═══════════════════════════════════════════════════════════════════════════
-- RG 5.616 — la condición frente al IVA del receptor va en el comprobante
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Descubierto emitiendo la primera factura de homologación contra ARCA:
--
--     10246: Campo Condicion Frente al IVA del receptor es obligatorio
--            conforme a lo reglamentado por la Resolucion General Nro 5616
--
-- Sin ese campo **ninguna factura se autoriza**. No es opcional ni una mejora:
-- es un rechazo duro de WSFE.
--
-- Los códigos ya estaban modelados en `src/lib/fiscalIdentity.ts` desde el
-- trabajo de identidad fiscal —1 responsable inscripto, 4 exento, 5 consumidor
-- final, 6 monotributo—. Lo que faltaba era llevarlos al comprobante.
--
-- El default es **5 (consumidor final)** porque es lo que corresponde a una
-- venta de tienda sin datos fiscales del comprador, que es la mayoría.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS condicion_iva_receptor int NOT NULL DEFAULT 5;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_condicion_iva_valida;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_condicion_iva_valida
  CHECK (condicion_iva_receptor IN (1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16));

COMMENT ON COLUMN public.invoices.condicion_iva_receptor IS
  'Codigo de condicion IVA del receptor segun ARCA (RG 5.616). 1=RI, 4=Exento, 5=Consumidor Final, 6=Monotributo. Sin esto WSFE rechaza con error 10246.';

-- Traduce la condición que ya guarda la orden al código de ARCA. Espejo de
-- `CONDICIONES_IVA` en src/lib/fiscalIdentity.ts.
CREATE OR REPLACE FUNCTION public.condicion_iva_codigo(p_condicion text)
RETURNS int LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE lower(COALESCE(p_condicion, ''))
    WHEN 'responsable_inscripto' THEN 1
    WHEN 'exento'                THEN 4
    WHEN 'monotributo'           THEN 6
    ELSE 5   -- consumidor final: el default correcto para una venta de tienda
  END;
$fn$;
