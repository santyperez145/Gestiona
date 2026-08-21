-- F0 / matriz de pagos — una sola identidad para la liquidación ecommerce.
--
-- `payment_transactions.source` admite y guarda `ecommerce`, y el helper
-- compartido de Store Pay + webhook envía ese valor. El ledger buscaba
-- `ecommerce_order`, un nombre que ni siquiera admite el CHECK de la tabla.
-- Consecuencia: la orden se asentaba, pero sin la comisión real del proveedor;
-- el neto contable quedaba inflado.
--
-- La función es larga y su última versión también resuelve costo de ventas y
-- cuenta de cobro. Se modifica desde la definición ya versionada, exigiendo la
-- forma esperada, para no reescribir de memoria doscientas líneas de dinero.

DO $migration$
DECLARE
  v_definition text;
  v_old_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.ledger_asentar_orden_pagada(jsonb)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Falta ledger_asentar_orden_pagada(jsonb)';
  END IF;

  v_old_count := (
    length(v_definition) - length(replace(v_definition, 'source = ''ecommerce_order''', ''))
  ) / length('source = ''ecommerce_order''');

  IF v_old_count = 1 THEN
    v_definition := replace(
      v_definition,
      'source = ''ecommerce_order''',
      'source = ''ecommerce'''
    );
    EXECUTE v_definition;
  ELSIF v_old_count = 0
    AND strpos(v_definition, 'source = ''ecommerce''') > 0 THEN
    NULL; -- idempotente
  ELSE
    RAISE EXCEPTION
      'La definición del ledger no tiene la forma esperada (coincidencias antiguas: %)',
      v_old_count;
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.ledger_asentar_orden_pagada(jsonb) IS
  'Asienta una orden online usando la liquidación source=ecommerce, incluida comisión real, IVA, plataforma y costo de ventas; idempotente por orden.';

DO $verify$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.ledger_asentar_orden_pagada(jsonb)'::regprocedure
  );
BEGIN
  IF strpos(v_definition, 'source = ''ecommerce''') = 0
     OR strpos(v_definition, 'source = ''ecommerce_order''') > 0 THEN
    RAISE EXCEPTION 'El ledger no quedó alineado al vocabulario de payment_transactions';
  END IF;
END
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000055', 'ledger_payment_source') ON CONFLICT DO NOTHING;
