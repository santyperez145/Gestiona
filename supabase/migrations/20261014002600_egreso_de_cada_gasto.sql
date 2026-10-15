-- Gastos: el egreso en Movimientos lo mantiene la base, igual que el gasto.
--
-- Medido el 2026-10-14: el egreso de un gasto lo anotaba el navegador después
-- de guardar (supabaseStore.addExpenseDB), sin atomicidad y tragándose el
-- error; editar o borrar el gasto no tocaba el egreso, y ningún gasto creado
-- por el servidor (recurrentes, reintegros, comisiones, liquidaciones a
-- creadores) llegaba a Movimientos. Había 1 gasto y 0 egresos de gastos.
--
-- Ahora un disparador en `expenses` crea, actualiza o borra el movimiento
-- (source_type 'expense', source_id = el gasto) en la misma transacción. Se
-- completan los gastos existentes. Es SECURITY DEFINER porque quien carga un
-- gasto puede no tener permiso de escribir Movimientos; sólo replica el gasto.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.egreso_de_gasto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_medio text;
  v_canal text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.financial_movements WHERE org_id = OLD.org_id AND source_type = 'expense' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.org_id IS NULL OR coalesce(NEW.amount_ars, 0) <= 0 THEN
    DELETE FROM public.financial_movements WHERE source_type = 'expense' AND source_id = NEW.id;
    RETURN NEW;
  END IF;

  v_medio := lower(coalesce(nullif(btrim(NEW.payment_method), ''), 'efectivo'));
  v_canal := CASE WHEN v_medio IN ('efectivo', 'cash') THEN 'cash'
                  WHEN v_medio IN ('transferencia', 'deposito') THEN 'bank'
                  WHEN v_medio IN ('credito', 'debito', 'tarjeta', 'mercado_pago', 'mercadopago', 'qr', 'modo') THEN 'card'
                  ELSE 'other' END;

  UPDATE public.financial_movements
     SET org_id = NEW.org_id, amount_ars = NEW.amount_ars, payment_method = v_medio, channel = v_canal,
         affects_cash = v_canal = 'cash', affects_bank = v_canal = 'bank',
         description = coalesce(nullif(btrim(NEW.description), ''), 'Gasto: ' || coalesce(NEW.category, 'general')),
         counterparty = NEW.vendor, happened_at = coalesce(NEW.date, NEW.created_at, now()),
         metadata = jsonb_build_object('category', NEW.category, 'vendor', NEW.vendor, 'cost_center', NEW.cost_center)
   WHERE source_type = 'expense' AND source_id = NEW.id;
  IF NOT FOUND THEN
    INSERT INTO public.financial_movements (org_id, direction, source_type, source_id, amount_ars, description, counterparty,
                                            payment_method, channel, affects_cash, affects_bank, happened_at, created_by, metadata)
    VALUES (NEW.org_id, 'out', 'expense', NEW.id, NEW.amount_ars,
            coalesce(nullif(btrim(NEW.description), ''), 'Gasto: ' || coalesce(NEW.category, 'general')), NEW.vendor,
            v_medio, v_canal, v_canal = 'cash', v_canal = 'bank', coalesce(NEW.date, NEW.created_at, now()), NEW.user_id,
            jsonb_build_object('category', NEW.category, 'vendor', NEW.vendor, 'cost_center', NEW.cost_center));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.egreso_de_gasto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_egreso_de_gasto ON public.expenses;
CREATE TRIGGER trg_egreso_de_gasto
AFTER INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.egreso_de_gasto();

-- Los gastos existentes sin su egreso.
INSERT INTO public.financial_movements (org_id, direction, source_type, source_id, amount_ars, description, counterparty,
                                        payment_method, channel, affects_cash, affects_bank, happened_at, created_by, metadata)
SELECT e.org_id, 'out', 'expense', e.id, e.amount_ars,
       coalesce(nullif(btrim(e.description), ''), 'Gasto: ' || coalesce(e.category, 'general')), e.vendor,
       lower(coalesce(nullif(btrim(e.payment_method), ''), 'efectivo')),
       CASE WHEN lower(coalesce(nullif(btrim(e.payment_method), ''), 'efectivo')) IN ('efectivo', 'cash') THEN 'cash'
            WHEN lower(e.payment_method) IN ('transferencia', 'deposito') THEN 'bank'
            WHEN lower(e.payment_method) IN ('credito', 'debito', 'tarjeta', 'mercado_pago', 'mercadopago', 'qr', 'modo') THEN 'card'
            ELSE 'other' END,
       lower(coalesce(nullif(btrim(e.payment_method), ''), 'efectivo')) IN ('efectivo', 'cash'),
       lower(coalesce(e.payment_method, '')) IN ('transferencia', 'deposito'),
       coalesce(e.date, e.created_at), e.user_id,
       jsonb_build_object('category', e.category, 'vendor', e.vendor, 'cost_center', e.cost_center, 'completado', '2026-10-14')
  FROM public.expenses e
 WHERE e.org_id IS NOT NULL AND coalesce(e.amount_ars, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM public.financial_movements m WHERE m.source_type = 'expense' AND m.source_id = e.id);

COMMIT;
