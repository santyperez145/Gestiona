-- Movimientos: todo el dinero que entró y salió, desde sus fuentes.
--
-- Medido el 2026-10-15: «Movimientos financieros — libro mayor de todos los
-- ingresos y egresos» leía sólo `financial_movements`, que en toda la
-- plataforma tenía 1 fila (un gasto). Ni las ventas (34 de Exentry, $1,1 M),
-- ni los cobros de cuenta corriente, ni los reintegros de devoluciones ni los
-- pagos a proveedores llegaban ahí, y la pantalla además comparaba la
-- dirección con 'income'/'expense' cuando la base guarda 'in'/'out': los
-- totales daban siempre $0.
--
-- `movimientos_de_dinero` une las fuentes que ya registran cada movimiento,
-- sin duplicarlo:
--   · ventas cobradas (no fiadas, sin deuda): por ticket y medio;
--   · cobros de cuenta corriente (debt_payments, y lo saldado antes de que
--     existieran los recibos);
--   · reintegros de devoluciones completados;
--   · pagos a proveedores (supplier_payments);
--   · lo que ya está en financial_movements (gastos, compras pagadas, etc.).
-- Una venta fiada entra cuando se cobra la deuda, no antes ni dos veces.
-- Corre con los permisos de quien la lee (security_invoker).
-- Idempotente.
BEGIN;

CREATE OR REPLACE VIEW public.movimientos_de_dinero
WITH (security_invoker = true) AS
SELECT
  'venta:' || coalesce(s.sale_transaction_id, s.id)::text || ':' || coalesce(s.payment_method, 'efectivo') AS id,
  s.org_id,
  'in'::text AS direction,
  'sale'::text AS source_type,
  coalesce(s.sale_transaction_id, min(s.id::text)::uuid) AS source_id,
  round(sum(s.total_ars), 2) AS amount_ars,
  CASE WHEN count(*) = 1 THEN 'Venta: ' || min(s.product_name)
       ELSE 'Venta: ' || min(s.product_name) || ' y ' || (count(*) - 1) || ' más' END AS description,
  max(s.customer_name) AS counterparty,
  coalesce(s.payment_method, 'efectivo') AS payment_method,
  min(s.date) AS happened_at
FROM public.sales s
WHERE s.paid
  AND coalesce(s.payment_method, 'efectivo') NOT IN ('fiado', 'cuenta_corriente')
  AND NOT EXISTS (SELECT 1 FROM public.debts d WHERE d.sale_id = s.id)
GROUP BY s.org_id, coalesce(s.sale_transaction_id, s.id), coalesce(s.payment_method, 'efectivo'), s.sale_transaction_id

UNION ALL
SELECT 'cobro:' || p.id::text, p.org_id, 'in', 'debt_payment', p.debt_id, round(p.amount_ars, 2),
       'Cobro de cuenta corriente' || coalesce(': ' || d.customer_name, ''), d.customer_name,
       coalesce(p.payment_method, 'efectivo'), coalesce(p.paid_at, p.created_at)
FROM public.debt_payments p
LEFT JOIN public.debts d ON d.id = p.debt_id

UNION ALL
-- Deudas saldadas con el sistema anterior, que no dejaba recibo (Exentry: 3,
-- $149.500, del 31/7). Se muestra lo cobrado sin recibo, marcado como tal; no
-- se reescriben los datos.
SELECT 'cobro-sin-recibo:' || d.id::text, d.org_id, 'in', 'debt_payment', d.id,
       round(d.paid_ars - coalesce((SELECT sum(p.amount_ars) FROM public.debt_payments p WHERE p.debt_id = d.id), 0), 2),
       'Cobro de cuenta corriente sin recibo (registrado antes de los recibos)' || coalesce(': ' || d.customer_name, ''),
       d.customer_name, 'sin_dato', d.updated_at
FROM public.debts d
WHERE coalesce(d.paid_ars, 0) - coalesce((SELECT sum(p.amount_ars) FROM public.debt_payments p WHERE p.debt_id = d.id), 0) > 0.01

UNION ALL
SELECT 'reintegro:' || r.id::text, r.org_id, 'out', 'return', r.return_transaction_id, round(r.amount, 2),
       'Reintegro de devolución', NULL, coalesce(r.sale_method, r.method), coalesce(r.completed_at, r.created_at)
FROM public.sales_return_refunds r
WHERE r.status = 'completed'

UNION ALL
SELECT 'pago-proveedor:' || sp.id::text, sp.org_id, 'out', 'supplier_payment', sp.supplier_debt_id, round(sp.amount_ars, 2),
       'Pago a ' || coalesce(sd.supplier_name, 'proveedor'), sd.supplier_name,
       coalesce(sp.method, 'efectivo'), sp.paid_at
FROM public.supplier_payments sp
LEFT JOIN public.supplier_debts sd ON sd.id = sp.supplier_debt_id

UNION ALL
SELECT 'mov:' || m.id::text, m.org_id, m.direction, m.source_type, m.source_id, round(m.amount_ars, 2),
       m.description, m.counterparty, m.payment_method, m.happened_at
FROM public.financial_movements m;

COMMENT ON VIEW public.movimientos_de_dinero IS
  'Dinero que entró y salió del negocio, desde sus fuentes (ventas cobradas, cobros de cuenta corriente, reintegros, pagos a proveedores y financial_movements). @revisada: security_invoker, cada fuente aplica su RLS.';

REVOKE ALL ON public.movimientos_de_dinero FROM PUBLIC, anon;
GRANT SELECT ON public.movimientos_de_dinero TO authenticated, service_role;

COMMIT;
