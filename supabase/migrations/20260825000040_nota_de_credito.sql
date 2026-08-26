-- ═══════════════════════════════════════════════════════════════════════════
-- P0-02 — una factura autorizada no se corrige: se contradocumenta
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Del backlog del 2026-08-24: *"La factura autorizada es inmutable. Corrección
-- mediante documento fiscal."*
--
-- Medido el 2026-08-25: `invoices` **no tiene ningún trigger**, así que una
-- factura con CAE se puede editar como cualquier fila — cambiarle el total, el
-- CUIT o el tipo de comprobante. Del lado de ARCA el comprobante sigue siendo
-- el que se autorizó, así que quedarían dos verdades distintas del mismo
-- documento, y la nuestra sin respaldo.
--
-- Y no existía ninguna función de nota de crédito (`nota_credito`: 0
-- coincidencias en el catálogo). La única forma de "arreglar" una factura mal
-- emitida era editarla.
--
-- ── Los dos lados del mismo problema ───────────────────────────────────────
--
-- 1. **Bloquear la edición** de lo que ARCA ya autorizó.
-- 2. **Dar el camino correcto**: emitir una nota de crédito que la referencia.
--
-- Sin el segundo, el primero deja al comercio sin salida ante un error real.
--
-- ── Los códigos no son arbitrarios ─────────────────────────────────────────
--
-- ARCA numera la nota de crédito por clase, y tiene que ser la **misma clase**
-- que la factura que corrige: A→3, B→8, C→13. Una NC de clase distinta a la
-- factura es un rechazo del organismo, no un detalle.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El vínculo ──────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS nota_credito_de uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS motivo_nota_credito text;

CREATE INDEX IF NOT EXISTS invoices_nota_credito_de_idx
  ON public.invoices (nota_credito_de) WHERE nota_credito_de IS NOT NULL;

COMMENT ON COLUMN public.invoices.nota_credito_de IS
  'Factura que esta nota de credito corrige. ON DELETE RESTRICT: no se borra una factura que tiene notas de credito emitidas.';

-- ── 2. La factura autorizada es inmutable ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_factura_autorizada_inmutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- Sin CAE todavía no hay nada autorizado: es un borrador y se edita.
  IF OLD.cae IS NULL THEN
    RETURN NEW;
  END IF;

  -- ⚠️ Sólo los campos fiscales. `status`, `paid_at` y `notes` cambian después
  -- de emitir por motivos legítimos —se cobró, se envió— y bloquearlos
  -- convertiría la inmutabilidad en un estorbo que alguien terminaría
  -- desactivando.
  IF NEW.total            IS DISTINCT FROM OLD.total
     OR NEW.subtotal      IS DISTINCT FROM OLD.subtotal
     OR NEW.tax_amount    IS DISTINCT FROM OLD.tax_amount
     OR NEW.tax_pct       IS DISTINCT FROM OLD.tax_pct
     OR NEW.currency      IS DISTINCT FROM OLD.currency
     OR NEW.issue_date    IS DISTINCT FROM OLD.issue_date
     OR NEW.customer_tax_id     IS DISTINCT FROM OLD.customer_tax_id
     OR NEW.customer_name       IS DISTINCT FROM OLD.customer_name
     OR NEW.tipo_comprobante    IS DISTINCT FROM OLD.tipo_comprobante
     OR NEW.condicion_iva_receptor IS DISTINCT FROM OLD.condicion_iva_receptor
     OR NEW.numero_afip   IS DISTINCT FROM OLD.numero_afip
     OR NEW.cae           IS DISTINCT FROM OLD.cae
     OR NEW.cae_vencimiento IS DISTINCT FROM OLD.cae_vencimiento THEN
    RAISE EXCEPTION
      'La factura % ya fue autorizada por ARCA (CAE %) y no se puede modificar. Para corregirla, emitir una nota de credito.',
      OLD.number, OLD.cae
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_factura_autorizada_inmutable ON public.invoices;
CREATE TRIGGER trg_factura_autorizada_inmutable
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_factura_autorizada_inmutable();

-- Y tampoco se borra lo que el organismo autorizó: existe de su lado.
CREATE OR REPLACE FUNCTION public.trg_factura_autorizada_no_se_borra()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF OLD.cae IS NOT NULL THEN
    RAISE EXCEPTION
      'La factura % tiene CAE % y existe del lado de ARCA: borrarla la haria desaparecer de un solo lado. Emitir una nota de credito.',
      OLD.number, OLD.cae
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_factura_autorizada_no_se_borra ON public.invoices;
CREATE TRIGGER trg_factura_autorizada_no_se_borra
BEFORE DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_factura_autorizada_no_se_borra();

-- ── 3. El comprobante que corrige ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tipo_nota_credito(p_tipo_factura int)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $fn$
  -- La nota de credito lleva la MISMA clase que la factura que corrige.
  -- Mandar una clase distinta es un rechazo del organismo.
  SELECT CASE p_tipo_factura
    WHEN 1  THEN 3    -- Factura A  -> Nota de credito A
    WHEN 6  THEN 8    -- Factura B  -> Nota de credito B
    WHEN 11 THEN 13   -- Factura C  -> Nota de credito C
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.tipo_nota_credito(int) IS
  'Codigo ARCA de la nota de credito para una factura. NULL si el tipo no es facturable con NC: quien llama decide, pero se entera.';

CREATE OR REPLACE FUNCTION public.emitir_nota_credito(
  p_invoice_id uuid,
  p_motivo     text,
  p_importe    numeric DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_f          public.invoices;
  v_tipo_nc    int;
  v_acreditado numeric;
  v_importe    numeric;
  v_prop       numeric;
  v_neto       numeric;
  v_iva        numeric;
  v_id         uuid;
  v_numero     text;
BEGIN
  SELECT * INTO v_f FROM public.invoices WHERE id = p_invoice_id;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'La factura % no existe', p_invoice_id;
  END IF;

  IF NOT public.has_org_role(v_f.org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador pueden emitir una nota de credito';
  END IF;

  IF COALESCE(btrim(p_motivo), '') = '' THEN
    -- ARCA no lo exige, pero una NC sin motivo es imposible de auditar despues
    -- y es lo primero que pregunta un contador.
    RAISE EXCEPTION 'La nota de credito necesita un motivo';
  END IF;

  IF v_f.nota_credito_de IS NOT NULL THEN
    RAISE EXCEPTION 'Una nota de credito no se corrige con otra nota de credito';
  END IF;

  v_tipo_nc := public.tipo_nota_credito(v_f.tipo_comprobante);
  IF v_tipo_nc IS NULL THEN
    RAISE EXCEPTION 'No hay nota de credito definida para el tipo de comprobante %', v_f.tipo_comprobante;
  END IF;

  -- ⚠️ No se puede acreditar mas de lo que se facturo, sumando las notas
  -- anteriores. Sin esto, dos NC parciales mal cargadas devuelven mas de lo que
  -- entro y el error aparece en la conciliacion del mes.
  SELECT COALESCE(SUM(total), 0) INTO v_acreditado
    FROM public.invoices WHERE nota_credito_de = p_invoice_id;

  v_importe := ROUND(COALESCE(p_importe, v_f.total - v_acreditado), 2);
  IF v_importe <= 0 THEN
    RAISE EXCEPTION 'La factura % ya esta acreditada por completo', v_f.number;
  END IF;
  IF v_acreditado + v_importe > ROUND(v_f.total, 2) + 0.01 THEN
    RAISE EXCEPTION
      'La nota de credito de % supera el saldo de la factura % (total %, ya acreditado %)',
      v_importe, v_f.number, v_f.total, v_acreditado;
  END IF;

  -- Los importes se prorratean con la MISMA proporcion de IVA de la factura:
  -- una NC parcial que devuelva todo el IVA de una vez descuadra el libro IVA.
  v_prop := CASE WHEN v_f.total > 0 THEN v_importe / v_f.total ELSE 1 END;
  v_iva  := ROUND(COALESCE(v_f.tax_amount, 0) * v_prop, 2);
  v_neto := ROUND(v_importe - v_iva, 2);

  v_numero := public.siguiente_numero_factura(v_f.org_id);

  INSERT INTO public.invoices (
    org_id, number, nota_credito_de, motivo_nota_credito,
    customer_name, customer_email, customer_tax_id, customer_address,
    issue_date, due_date, status, currency,
    subtotal, tax_pct, tax_amount, total,
    tipo_comprobante, condicion_iva_receptor,
    afip_status, sale_id, ecommerce_order_id, notes)
  VALUES (
    v_f.org_id, v_numero, p_invoice_id, btrim(p_motivo),
    v_f.customer_name, v_f.customer_email, v_f.customer_tax_id, v_f.customer_address,
    CURRENT_DATE, CURRENT_DATE, 'draft', v_f.currency,
    v_neto, v_f.tax_pct, v_iva, v_importe,
    v_tipo_nc, v_f.condicion_iva_receptor,
    'pending', v_f.sale_id, v_f.ecommerce_order_id,
    'Nota de credito de la factura ' || v_f.number || ': ' || btrim(p_motivo))
  RETURNING id INTO v_id;

  PERFORM public.emitir_evento(v_f.org_id, 'factura', v_id, 'nota_credito.creada',
    jsonb_build_object(
      'invoice_id', v_id, 'corrige_a', p_invoice_id, 'numero', v_numero,
      'tipo', v_tipo_nc, 'importe', v_importe, 'motivo', btrim(p_motivo)));

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.emitir_nota_credito(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_credito(uuid, text, numeric) TO authenticated;

-- ── 4. Qué quedó acreditado ────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.facturas_con_nota_credito AS
SELECT
  f.org_id,
  f.id            AS factura_id,
  f.number        AS factura,
  f.total         AS total_facturado,
  COALESCE(SUM(nc.total), 0)          AS total_acreditado,
  f.total - COALESCE(SUM(nc.total), 0) AS saldo,
  count(nc.id)::int                    AS notas
FROM public.invoices f
JOIN public.invoices nc ON nc.nota_credito_de = f.id
WHERE public.is_org_member(f.org_id, auth.uid())
GROUP BY f.org_id, f.id, f.number, f.total;

GRANT SELECT ON public.facturas_con_nota_credito TO authenticated;
