-- Salud del negocio, organización por organización.
--
-- La plataforma cobra 5% por venta, pero hasta acá sólo podía ver el total del
-- mes: `platform_revenue_monthly` agrupa por mes y moneda, no por comercio. La
-- primera pregunta de cualquiera que opera un marketplace es "¿quién me da la
-- plata?", y la segunda es "¿quién dejó de dármela?" — ninguna de las dos se
-- podía responder sin escribir SQL a mano.
--
-- El MRR de suscripciones tampoco alcanza: un comercio puede estar al día con
-- el plan y no haber vendido nada en dos meses. Ese es exactamente el que se va
-- a dar de baja, y es el único que se puede salvar si se lo detecta a tiempo.
--
-- La vista deriva una señal por comercio, y esa señal es toda la utilidad:
--
--   * `sin_activar` — se registró, nunca cobró un peso. Es onboarding roto, no
--     churn: se arregla con una llamada, no con un descuento.
--   * `en_riesgo`   — facturaba y dejó de hacerlo. El de la llamada urgente.
--   * `cayendo`     — factura menos de la mitad que el mes pasado.
--   * `creciendo`   — factura más del 20% que el mes pasado.
--   * `estable`     — el resto de los que facturan.
--   * `dormido`     — hace más de 90 días que no cobra. Ya se fue, aunque el
--                     plan siga activo.
--
-- La vista NO lleva `security_invoker`: abajo tiene tablas cuyas policies son
-- por organización, así que con invoker devolvería vacío para el staff de
-- plataforma —que no es miembro de ninguna—. El control lo hace la propia
-- cláusula `WHERE public.is_platform_admin(auth.uid())`. Es el mismo criterio
-- que las vistas `*_status` de credenciales.
--
-- Idempotente.

CREATE OR REPLACE VIEW public.platform_org_health AS
WITH tx AS (
  SELECT
    org_id,
    SUM(gross_amount) FILTER (WHERE created_at >= now() - interval '30 days')  AS gmv_30d,
    SUM(gross_amount) FILTER (WHERE created_at >= now() - interval '60 days'
                                AND created_at <  now() - interval '30 days')  AS gmv_prev_30d,
    SUM(platform_fee) FILTER (WHERE created_at >= now() - interval '30 days')  AS comision_30d,
    SUM(platform_fee)                                                          AS comision_total,
    SUM(gross_amount)                                                          AS gmv_total,
    COUNT(*)          FILTER (WHERE created_at >= now() - interval '30 days')  AS cobros_30d,
    COUNT(*)                                                                   AS cobros_total,
    MAX(created_at)                                                            AS ultimo_cobro,
    MIN(created_at)                                                            AS primer_cobro
  FROM public.payment_transactions
  WHERE status = 'approved'
  GROUP BY org_id
),
conteos AS (
  SELECT o.id AS org_id,
         (SELECT count(*) FROM public.memberships m WHERE m.org_id = o.id)             AS miembros,
         (SELECT count(*) FROM public.products   p WHERE p.org_id = o.id)             AS productos,
         (SELECT count(*) FROM public.ecommerce_stores s
           WHERE s.org_id = o.id AND s.is_active)                                     AS tiendas_activas
  FROM public.organizations o
)
SELECT
  o.id                        AS org_id,
  o.name                      AS org_name,
  o.slug,
  o.created_at                AS org_creada,
  o.trial_ends_at,
  o.onboarding_completed,
  pl.name                     AS plan_name,
  pl.price_usd_monthly,
  -- `status` es un enum, así que el default va como texto: sin el cast, el
  -- COALESCE intenta meter 'sin_suscripcion' dentro del enum y falla.
  COALESCE(s.status::text, 'sin_suscripcion') AS subscription_status,

  COALESCE(t.gmv_30d, 0)        AS gmv_30d,
  COALESCE(t.gmv_prev_30d, 0)   AS gmv_prev_30d,
  COALESCE(t.gmv_total, 0)      AS gmv_total,
  COALESCE(t.comision_30d, 0)   AS comision_30d,
  COALESCE(t.comision_total, 0) AS comision_total,
  COALESCE(t.cobros_30d, 0)     AS cobros_30d,
  COALESCE(t.cobros_total, 0)   AS cobros_total,
  t.ultimo_cobro,
  t.primer_cobro,
  -- Días desde el último cobro. NULL si nunca cobró: es un estado distinto de
  -- "hace mucho", y mezclarlos es justamente lo que esconde el onboarding roto.
  CASE WHEN t.ultimo_cobro IS NOT NULL
       THEN EXTRACT(day FROM now() - t.ultimo_cobro)::int END AS dias_sin_cobrar,

  c.miembros,
  c.productos,
  c.tiendas_activas,

  -- Variación mes contra mes. Sin mes anterior no hay variación: devolver 100%
  -- para el primero haría ver "creciendo" a cualquiera que recién arranca.
  CASE WHEN COALESCE(t.gmv_prev_30d, 0) > 0
       THEN ROUND((COALESCE(t.gmv_30d, 0) - t.gmv_prev_30d) * 100.0 / t.gmv_prev_30d, 1)
  END AS variacion_pct,

  CASE
    WHEN t.cobros_total IS NULL OR t.cobros_total = 0            THEN 'sin_activar'
    WHEN t.ultimo_cobro < now() - interval '90 days'             THEN 'dormido'
    WHEN COALESCE(t.gmv_30d, 0) = 0 AND COALESCE(t.gmv_prev_30d, 0) > 0 THEN 'en_riesgo'
    WHEN COALESCE(t.gmv_prev_30d, 0) > 0
     AND COALESCE(t.gmv_30d, 0) < t.gmv_prev_30d * 0.5           THEN 'cayendo'
    WHEN COALESCE(t.gmv_prev_30d, 0) > 0
     AND COALESCE(t.gmv_30d, 0) > t.gmv_prev_30d * 1.2           THEN 'creciendo'
    ELSE 'estable'
  END AS senal

FROM public.organizations o
LEFT JOIN tx       t  ON t.org_id  = o.id
LEFT JOIN conteos  c  ON c.org_id  = o.id
LEFT JOIN public.subscriptions s ON s.org_id = o.id
LEFT JOIN public.plans pl ON pl.id = COALESCE(s.plan_id, o.plan_id)
WHERE public.is_platform_admin(auth.uid());

REVOKE ALL ON public.platform_org_health FROM PUBLIC;
GRANT SELECT ON public.platform_org_health TO authenticated;

COMMENT ON VIEW public.platform_org_health IS
  'Salud por organización para el panel de plataforma: GMV 30d vs 30d previos, '
  'comisión generada y una señal derivada (sin_activar / en_riesgo / cayendo / '
  'creciendo / estable / dormido). Filtra por is_platform_admin() adentro: no '
  'lleva security_invoker a propósito.';
