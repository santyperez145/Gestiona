-- ═══════════════════════════════════════════════════════════════════════════
-- `sales_sin_cliente` filtraba por org sólo del lado del cliente
--
-- La vista se creó en 20260731000016 sin `security_invoker`, así que evaluaba
-- la RLS de `sales` como su dueño — es decir, la salteaba. El panel filtra por
-- `org_id` en la consulta, pero eso es una decisión del navegador: cualquier
-- usuario autenticado podía pedir las ventas de otra organización cambiando ese
-- filtro.
--
-- Con `security_invoker = true` la RLS de `sales` se evalúa como el usuario que
-- consulta, así que el aislamiento entre organizaciones deja de depender de que
-- el front pida bien.
--
-- El patrón inverso — vista definer con WHERE explícito — es correcto para las
-- superficies públicas (`catalog_products`), donde la vista ES el control de
-- acceso. Acá no: esto lo consulta un usuario logueado que ya tiene su propia
-- RLS, y lo correcto es respetarla.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.sales_sin_cliente;

CREATE VIEW public.sales_sin_cliente
WITH (security_invoker = true) AS
SELECT
  s.org_id,
  s.customer_name,
  count(*)         AS ventas,
  sum(s.total_ars) AS total_ars,
  max(s.date)      AS ultima_venta
FROM public.sales s
WHERE s.customer_id IS NULL
  AND public.normalize_person_name(s.customer_name) IS NOT NULL
GROUP BY s.org_id, s.customer_name;

COMMENT ON VIEW public.sales_sin_cliente IS
  'Ventas cuyo nombre no matchea ningún cliente del CRM. security_invoker: hereda la RLS de sales, así el aislamiento entre organizaciones no depende del filtro que mande el front.';

GRANT SELECT ON public.sales_sin_cliente TO authenticated;
