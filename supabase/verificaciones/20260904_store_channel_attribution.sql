-- Verificación reversible D5.25: visita → carrito → checkout → snapshot.
-- Elige una tienda activa con producto y miembro, no toca stock ni crea orden.

BEGIN;

SELECT
  set_config('app.zz_store_slug', s.slug, true),
  set_config('app.zz_org_id', s.org_id::text, true),
  set_config('app.zz_member_id', m.user_id::text, true),
  set_config('app.zz_product_id', p.id::text, true)
FROM public.ecommerce_stores s
JOIN LATERAL (
  SELECT user_id
  FROM public.memberships
  WHERE org_id = s.org_id
  ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END
  LIMIT 1
) m ON true
JOIN LATERAL (
  SELECT id
  FROM public.products
  WHERE org_id = s.org_id AND is_active
  ORDER BY created_at
  LIMIT 1
) p ON true
WHERE s.is_active
ORDER BY s.created_at
LIMIT 1;

DO $$
BEGIN
  IF NULLIF(current_setting('app.zz_store_slug', true), '') IS NULL THEN
    RAISE EXCEPTION 'No hay tienda activa con producto y miembro para verificar';
  END IF;
END;
$$;

UPDATE public.ecommerce_stores
SET first_party_analytics_enabled = false
WHERE org_id = current_setting('app.zz_org_id')::uuid;

SET LOCAL ROLE anon;

SELECT public.record_store_visit(
  current_setting('app.zz_store_slug'),
  'zz-attribution-disabled-00000000000001',
  jsonb_build_object('utm_source', 'google', 'utm_medium', 'cpc')
)->>'tracked' AS disabled_not_tracked;

RESET ROLE;
SELECT count(*) AS disabled_rows
FROM public.ecommerce_store_visits
WHERE visit_token_hash = encode(extensions.digest(
  convert_to('zz-attribution-disabled-00000000000001', 'UTF8'),
  'sha256'
), 'hex');

-- La prueba publica temporalmente el contenido mínimo dentro del ROLLBACK; no
-- cambia la política real ni firma por el comercio.
UPDATE public.store_pages
SET content = content || E'\n\nVisitas de 30 minutos; UTM; sin IP ni URL completa; 13 meses.'
WHERE store_id = (
  SELECT id FROM public.ecommerce_stores
  WHERE org_id = current_setting('app.zz_org_id')::uuid
)
  AND slug = 'politica-de-privacidad'
  AND status = 'published';

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('app.zz_member_id'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;
SELECT public.set_store_first_party_analytics(
  current_setting('app.zz_org_id')::uuid,
  true,
  true
)->>'enabled' AS owner_enabled;
RESET ROLE;

SET LOCAL ROLE anon;

SELECT public.record_store_visit(
  current_setting('app.zz_store_slug'),
  'zz-attribution-visit-0000000000000001',
  jsonb_build_object(
    'utm_source', 'Google',
    'utm_medium', 'CPC',
    'utm_campaign', 'ZZ D5.25',
    'referrer_host', 'www.google.com'
  )
)->>'channel' AS first_channel;

-- Un segundo touch no puede convertir first-touch paid en social.
SELECT public.record_store_visit(
  current_setting('app.zz_store_slug'),
  'zz-attribution-visit-0000000000000001',
  jsonb_build_object('utm_source', 'instagram', 'utm_medium', 'social')
)->>'channel' AS preserved_first_channel;

SELECT public.save_store_cart_v3(
  current_setting('app.zz_store_slug'),
  'zz-attribution-cart-00000000000000001',
  jsonb_build_array(jsonb_build_object(
    'product_id', current_setting('app.zz_product_id'),
    'quantity', 1
  )),
  NULL,
  'zz-attribution-visit-0000000000000001'
)->>'visit_linked' AS cart_linked;

SELECT public.start_store_checkout_v2(
  current_setting('app.zz_store_slug'),
  'zz-attribution-cart-00000000000000001',
  jsonb_build_array(jsonb_build_object(
    'product_id', current_setting('app.zz_product_id'),
    'quantity', 1
  )),
  NULL,
  'zz-attribution-visit-0000000000000001'
)->>'checkout_started' AS checkout_started;

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('app.zz_member_id'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

SELECT jsonb_path_query_first(
  public.get_store_performance_snapshot(
    current_setting('app.zz_org_id')::uuid,
    NULL,
    NULL
  ),
  '$.channels[*] ? (@.channel == "paid")'
) AS paid_channel;

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000099',
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    PERFORM public.get_store_performance_snapshot(
      current_setting('app.zz_org_id')::uuid,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'El outsider pudo leer el snapshot de Commerce';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

RESET ROLE;
DELETE FROM public.ecommerce_cart_sessions
WHERE session_token = 'zz-attribution-cart-00000000000000001';
DELETE FROM public.ecommerce_store_visits
WHERE visit_token_hash = encode(extensions.digest(
  convert_to('zz-attribution-visit-0000000000000001', 'UTF8'),
  'sha256'
), 'hex');

SELECT
  (SELECT count(*) FROM public.ecommerce_cart_sessions
   WHERE session_token LIKE 'zz-attribution-%')
  +
  (SELECT count(*) FROM public.ecommerce_store_visits
   WHERE visit_token_hash = encode(extensions.digest(
     convert_to('zz-attribution-visit-0000000000000001', 'UTF8'),
     'sha256'
   ), 'hex')) AS residuos;

ROLLBACK;
