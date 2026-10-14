-- Cheques: ciclo de vida custodiado por la base y cliente vinculado.
--
-- Páginas legacy (pedido del dueño 2026-10-14). Medido en el código: la
-- cartera de cheques cambiaba de estado sin reglas (un acreditado podía volver
-- a pendiente, un cancelado pasar a depositado), «Depositar» aparecía también
-- en los cheques emitidos, uno depositado no se podía marcar rebotado y el
-- cliente era texto suelto.
--
-- · Estados válidos (trg_guard_cheque_estado):
--     recibido: pendiente → depositado | rebotado | cancelado;
--               depositado → acreditado | rebotado.
--     emitido:  pendiente → debitado (cleared) | rebotado | cancelado.
--   Acreditado, rebotado y cancelado son finales. Una vez fuera de pendiente,
--   tipo, monto, número y banco no cambian. La fecha de depósito la pone la base.
-- · Monto mayor a cero y número único por negocio, tipo y banco.
-- · `customer_id`: el cliente de la lista (si se eligió uno).
-- Idempotente.
BEGIN;

ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.cheques ADD COLUMN IF NOT EXISTS estado_cambiado_at timestamptz;
ALTER TABLE public.cheques DROP CONSTRAINT IF EXISTS cheques_monto_positivo;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_monto_positivo CHECK (amount_ars > 0);
CREATE UNIQUE INDEX IF NOT EXISTS cheques_numero_unico
  ON public.cheques (org_id, type, lower(btrim(coalesce(bank_name, ''))), btrim(check_number))
  WHERE check_number IS NOT NULL AND btrim(check_number) <> '';

CREATE OR REPLACE FUNCTION public.guard_cheque_estado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Un cheque nuevo entra como pendiente' USING ERRCODE = '22023';
    END IF;
    IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'El cliente no es de este negocio' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'pending' AND (
       NEW.type IS DISTINCT FROM OLD.type OR NEW.amount_ars IS DISTINCT FROM OLD.amount_ars
    OR NEW.check_number IS DISTINCT FROM OLD.check_number OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    RAISE EXCEPTION 'Un cheque ya depositado, acreditado, rebotado o cancelado no se puede editar' USING ERRCODE = '55000';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'El cliente no es de este negocio' USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_ok := CASE
      WHEN OLD.type = 'received' AND OLD.status = 'pending'   THEN NEW.status IN ('deposited', 'bounced', 'cancelled')
      WHEN OLD.type = 'received' AND OLD.status = 'deposited' THEN NEW.status IN ('cleared', 'bounced')
      WHEN OLD.type = 'issued'   AND OLD.status = 'pending'   THEN NEW.status IN ('cleared', 'bounced', 'cancelled')
      ELSE false END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'Un cheque % no puede pasar de «%» a «%»',
        CASE OLD.type WHEN 'received' THEN 'recibido' ELSE 'emitido' END, OLD.status, NEW.status
        USING ERRCODE = '55000';
    END IF;
    NEW.estado_cambiado_at := now();
    IF NEW.status IN ('deposited', 'cleared') AND NEW.deposited_at IS NULL THEN
      NEW.deposited_at := current_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cheque_estado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_cheque_estado ON public.cheques;
CREATE TRIGGER trg_guard_cheque_estado
  BEFORE INSERT OR UPDATE ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.guard_cheque_estado();

COMMIT;
