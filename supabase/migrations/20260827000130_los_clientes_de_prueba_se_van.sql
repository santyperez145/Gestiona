-- Los nueve clientes de prueba se van
--
-- ── Por qué ahora ─────────────────────────────────────────────────────────
--
-- El ROADMAP los documentó el 2026-08-26 y decidió no borrarlos ahí, con dos
-- razones buenas: son filas reales de la base del dueño, y hacerlo dentro de
-- una migración de esquema mezcla dos cosas que deben poder revertirse por
-- separado. Ésta es esa migración aparte: **no toca esquema**.
--
-- Lo que empuja a hacerlo es una métrica, no la prolijidad.
-- Una medición histórica reportaba «34 clientes» como señal de adopción, y nueve
-- de esos 34 son de prueba: **los reales son 25**, así que cualquier número
-- construido sobre `customers` está inflado un 26%. Y el dueño está por
-- lanzar con esa lista a la vista.
--
--   creado       nombre                                   ventas  deudas
--   2026-07-31   ZZ Circuito Test                         0       0
--   2026-08-11   ZZ Devolucion, ZZ Arrepentido            0       0
--   2026-08-19   ZZ Ledger                                0       0
--   2026-08-20   ZZ Comprador, ZZ Dos, ZZ FALLA, ZZ Uno   0       0
--   2026-08-26   ZZ Comprador                             0       0
--
-- ── Qué NO se borra, y por qué ────────────────────────────────────────────
--
-- ⚠️ **El producto «ZZ NO COMPRAR - Prueba de pago» y sus dos ventas se
-- quedan.** El prefijo engaña: no son basura de verificación, son **la
-- evidencia de que el cobro real funcionó** —las dos compras de $1 del
-- 2026-07-31, con su `application_fee` informado por MercadoPago— y
-- CONTRIBUTING.md las cita como prueba. Borrarlas sacaría de la base lo único que
-- demuestra que la plata entró.
--
-- Tampoco se tocan tres movimientos de Kardex «ZZ producto» del 2026-07-31:
-- su producto ya no existe, así que no se ven en ninguna ficha, y reescribir
-- Kardex histórico del comercio real por prolijidad no vale el riesgo.
--
-- Sí se borra un movimiento «ZZ divergencia» del 2026-08-27: es mío, de la
-- verificación de `20260827000020`. Sobrevivió porque el DELETE de la venta
-- **dispara el trigger que crea un movimiento nuevo**, después de que la
-- migración ya había borrado los suyos. Es el mismo orden que hay que respetar
-- al limpiar cualquier dato ZZ con ventas.
--
-- ── La guarda ─────────────────────────────────────────────────────────────
--
-- El borrado exige que el cliente no tenga NADA colgando: ni ventas, ni
-- deudas, ni presupuestos, ni comunicaciones, ni puntos, ni oportunidades. Un
-- cliente de prueba al que alguien le cargó algo real deja de ser de prueba.

DELETE FROM public.customers c
 WHERE c.name LIKE 'ZZ %'
   AND NOT EXISTS (SELECT 1 FROM public.sales                   x WHERE x.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.debts                   x WHERE x.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.quotes                  x WHERE x.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.customer_communications x WHERE x.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.loyalty_points          x WHERE x.customer_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.deals                   x WHERE x.customer_id = c.id);

-- El movimiento que dejó mi propia verificación.
DELETE FROM public.stock_movements
 WHERE product_name = 'ZZ divergencia'
   AND movement_type = 'sale_deleted';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_quedan  int;
  v_reales  int;
  v_pago    int;
  v_ventas  int;
  v_borrado boolean;
  v_id      uuid;
BEGIN
  -- ── a. No quedan clientes de prueba sin actividad ───────────────────────
  SELECT count(*) INTO v_quedan
    FROM public.customers c WHERE c.name LIKE 'ZZ %'
     AND NOT EXISTS (SELECT 1 FROM public.sales x WHERE x.customer_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM public.debts x WHERE x.customer_id = c.id);
  ASSERT v_quedan = 0, 'quedaron ' || v_quedan || ' clientes de prueba';

  -- ── b. ⚠️ Y los clientes REALES siguen ahí ──────────────────────────────
  -- Sin esta mitad, un DELETE demasiado ancho dejaría el punto (a) igual de
  -- verde y se habría llevado la cartera del comercio.
  SELECT count(*) INTO v_reales FROM public.customers WHERE name NOT LIKE 'ZZ %';
  ASSERT v_reales >= 25,
    'quedan sólo ' || v_reales || ' clientes reales: el borrado se llevó de más';

  -- ── c. ⚠️ Y la evidencia del cobro real NO se tocó ──────────────────────
  SELECT count(*) INTO v_pago FROM public.products
   WHERE name = 'ZZ NO COMPRAR - Prueba de pago';
  SELECT count(*) INTO v_ventas FROM public.sales
   WHERE product_name = 'ZZ NO COMPRAR - Prueba de pago';
  ASSERT v_pago = 1,   'se borró el producto de la prueba de pago real';
  ASSERT v_ventas = 2, 'se borraron las ventas de $1 que prueban que el cobro funciona';

  -- ── d. La guarda frena a un cliente con actividad ───────────────────────
  -- Una guarda que nunca frena nada tampoco sirve.
  INSERT INTO public.customers (id, org_id, user_id, name)
  SELECT gen_random_uuid(), m.org_id, m.user_id, 'ZZ Con Deuda'
    FROM public.memberships m LIMIT 1
  RETURNING id INTO v_id;

  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, status)
  SELECT c.org_id, c.user_id, v_id, 'ZZ Con Deuda', 1000, 'pending'
    FROM public.customers c WHERE c.id = v_id;

  DELETE FROM public.customers c
   WHERE c.name = 'ZZ Con Deuda'
     AND NOT EXISTS (SELECT 1 FROM public.debts x WHERE x.customer_id = c.id);

  SELECT EXISTS (SELECT 1 FROM public.customers WHERE id = v_id) INTO v_borrado;
  ASSERT v_borrado, 'la guarda NO frenó: se borró un cliente con deuda';

  -- Y se limpia lo que creó esta verificación.
  DELETE FROM public.debts     WHERE customer_id = v_id;
  DELETE FROM public.customers WHERE id = v_id;
  ASSERT NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_id), 'quedó el ZZ Con Deuda';

  RAISE NOTICE 'OK: se fueron los de prueba, quedaron % reales, la evidencia del cobro intacta', v_reales;
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000130', 'los_clientes_de_prueba_se_van')
ON CONFLICT DO NOTHING;
