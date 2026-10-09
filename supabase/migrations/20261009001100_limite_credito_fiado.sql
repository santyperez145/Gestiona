-- Límite de crédito del fiado.
--
-- Una venta fiado genera una deuda (create_sales_transaction). Hasta ahora
-- nada impedía que un cliente acumulara deuda sin tope. Cada cliente puede
-- tener `credit_limit_ars` (NULL = sin límite) y la base rechaza la deuda de
-- una venta que lo supere, sumando lo pendiente del cliente y los renglones
-- del mismo ticket. Sólo dueños y administradores cambian el límite.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS credit_limit_ars numeric(14,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_credit_limit_ars_check') THEN
    ALTER TABLE public.customers ADD CONSTRAINT customers_credit_limit_ars_check CHECK (credit_limit_ars IS NULL OR credit_limit_ars >= 0);
  END IF;
END;
$$;

COMMENT ON COLUMN public.customers.credit_limit_ars IS
  'Tope de deuda pendiente (fiado) en ARS. NULL: sin límite. Lo valida trg_debts_respetar_limite_credito.';

-- Saldo pendiente del cliente. SECURITY INVOKER: respeta RLS de debts.
CREATE OR REPLACE FUNCTION public.saldo_fiado_cliente(p_org uuid, p_customer uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(sum(d.remaining_ars), 0)
  FROM public.debts d
  WHERE d.org_id = p_org AND d.customer_id = p_customer AND d.status <> 'paid';
$$;

REVOKE ALL ON FUNCTION public.saldo_fiado_cliente(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_fiado_cliente(uuid, uuid) TO authenticated, service_role;

-- Corre después de trg_debts_link_customer (orden alfabético) para usar el
-- cliente ya vinculado por nombre.
CREATE OR REPLACE FUNCTION public.trg_debts_respetar_limite_credito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limite numeric;
  v_nombre text;
  v_pendiente numeric;
BEGIN
  IF NEW.sale_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- El bloqueo serializa dos cajas fiando al mismo cliente a la vez.
  SELECT c.credit_limit_ars, c.name INTO v_limite, v_nombre
  FROM public.customers c
  WHERE c.id = NEW.customer_id AND c.org_id = NEW.org_id
  FOR UPDATE;

  IF v_limite IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(d.remaining_ars), 0) INTO v_pendiente
  FROM public.debts d
  WHERE d.org_id = NEW.org_id AND d.customer_id = NEW.customer_id AND d.status <> 'paid';

  IF v_pendiente + COALESCE(NEW.remaining_ars, NEW.amount_ars, 0) > v_limite THEN
    RAISE EXCEPTION 'El fiado supera el límite de crédito de «%»: debe %, límite %, disponible %.',
      v_nombre,
      to_char(v_pendiente, 'FM999999999990.00'),
      to_char(v_limite, 'FM999999999990.00'),
      to_char(greatest(v_limite - v_pendiente, 0), 'FM999999999990.00')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_debts_respetar_limite_credito() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_debts_respetar_limite_credito ON public.debts;
CREATE TRIGGER trg_debts_respetar_limite_credito
  BEFORE INSERT ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.trg_debts_respetar_limite_credito();

-- Sólo dueño/admin cambian el límite; el resto del cliente sigue editable.
CREATE OR REPLACE FUNCTION public.trg_customers_limite_credito_solo_encargado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service_role y procesos internos
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.credit_limit_ars IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.credit_limit_ars IS DISTINCT FROM OLD.credit_limit_ars) THEN
    IF NOT public.has_org_role(NEW.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
      RAISE EXCEPTION 'Sólo un dueño o administrador puede cambiar el límite de crédito'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_customers_limite_credito_solo_encargado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customers_limite_credito_solo_encargado ON public.customers;
CREATE TRIGGER trg_customers_limite_credito_solo_encargado
  BEFORE INSERT OR UPDATE OF credit_limit_ars ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.trg_customers_limite_credito_solo_encargado();
