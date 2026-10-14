-- Presupuestos: convertir en venta una sola vez y por la venta real.
--
-- Matriz POS, fila «Presupuestos/pedidos». Medido 2026-10-14 en el código:
-- «Convertir en venta» insertaba desde el navegador una única venta con las
-- descripciones unidas como producto y ganancia 0: no movía stock, no pasaba
-- por la caja ni por la factura, y ensuciaba los reportes. El botón seguía en
-- un presupuesto aceptado y nada impedía convertirlo dos veces.
--
-- Desde esta versión el presupuesto se convierte en la caja: los renglones de
-- la venta llevan `quote_id` y pasan por `create_sales_transaction_v2/v3`
-- (stock, caja, precio y tope de descuento validados en la base). Este
-- disparador, en la misma transacción que la venta:
-- · exige que el presupuesto sea del mismo negocio;
-- · rechaza un presupuesto rechazado;
-- · lo marca aceptado y convertido por esa transacción, y si ya lo convirtió
--   otra venta, rechaza: un presupuesto no se cobra dos veces. Varios
--   renglones de la misma venta pueden llevar el mismo presupuesto (todo
--   renglón llega con su transacción: `trg_assign_sale_transaction` corre
--   antes y se la asigna incluso a un insert suelto).
-- Un presupuesto convertido queda congelado: ítems, importes, estado y la
-- marca de conversión no se pueden cambiar (la app escribe `quotes` directo,
-- así que sin esto se podía borrar la marca y cobrarlo otra vez). Notas y
-- datos de contacto siguen editables.
-- Idempotente.
BEGIN;

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS converted_transaction_id uuid;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS converted_at timestamptz;
COMMENT ON COLUMN public.quotes.converted_transaction_id IS
  'Venta de la caja (sale_transactions.id) que convirtió el presupuesto; la escribe trg_presupuesto_convertido.';

CREATE OR REPLACE FUNCTION public.presupuesto_convertido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  q record;
BEGIN
  SELECT id, org_id, status, quote_number, converted_transaction_id INTO q
    FROM public.quotes WHERE id = NEW.quote_id FOR UPDATE;
  IF NOT FOUND OR q.org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'El presupuesto no es de este negocio' USING ERRCODE = '22023';
  END IF;
  IF q.status = 'rejected' THEN
    RAISE EXCEPTION 'El presupuesto % está rechazado', q.quote_number USING ERRCODE = '22023';
  END IF;
  IF q.converted_transaction_id IS NOT NULL AND q.converted_transaction_id <> NEW.sale_transaction_id THEN
    RAISE EXCEPTION 'El presupuesto % ya se convirtió en una venta', q.quote_number USING ERRCODE = '23505';
  END IF;
  IF q.converted_transaction_id IS NULL THEN
    PERFORM set_config('gestiona.presupuesto_convirtiendo', NEW.quote_id::text, true);
    UPDATE public.quotes
       SET status = 'accepted', converted_transaction_id = NEW.sale_transaction_id,
           converted_at = now(), updated_at = now()
     WHERE id = NEW.quote_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.presupuesto_convertido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_presupuesto_convertido ON public.sales;
CREATE TRIGGER trg_presupuesto_convertido
  BEFORE INSERT ON public.sales
  FOR EACH ROW WHEN (NEW.quote_id IS NOT NULL)
  EXECUTE FUNCTION public.presupuesto_convertido();

CREATE OR REPLACE FUNCTION public.guard_presupuesto_convertido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.converted_transaction_id IS NOT NULL AND (
       NEW.converted_transaction_id IS DISTINCT FROM OLD.converted_transaction_id
    OR NEW.converted_at IS DISTINCT FROM OLD.converted_at
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.items IS DISTINCT FROM OLD.items
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    RAISE EXCEPTION 'El presupuesto % ya se vendió: no se puede cambiar. Duplicalo para armar uno nuevo.', OLD.quote_number
      USING ERRCODE = '55000';
  END IF;
  -- La marca la pone sólo la venta (trg_presupuesto_convertido).
  IF OLD.converted_transaction_id IS NULL AND NEW.converted_transaction_id IS NOT NULL
     AND current_setting('gestiona.presupuesto_convirtiendo', true) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'Un presupuesto se marca como vendido sólo al cobrarlo en la caja' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_presupuesto_convertido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_presupuesto_convertido ON public.quotes;
CREATE TRIGGER trg_guard_presupuesto_convertido
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.guard_presupuesto_convertido();

COMMIT;
