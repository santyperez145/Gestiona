-- Nerqia: identidad pública canónica sin romper namespaces técnicos.
--
-- `gestiona_pay`, `gestiona_envios` y X-Gestiona-* son identificadores ya
-- persistidos/publicados. Se conservan por compatibilidad; sólo cambia la
-- marca que ve una persona.

UPDATE public.payment_providers
   SET nombre = 'Nerqia Pay',
       nombre_publico = 'Nerqia Pay',
       descripcion = 'Producto de cobro de Nerqia (modelo Pago Nube). En Argentina el procesamiento corre por Mercado Pago: autorizás tu cuenta y el dinero entra ahí. Nerqia orquesta checkout, conciliación y comisión.'
 WHERE codigo = 'gestionapay';

UPDATE public.payment_providers
   SET descripcion = 'Rail de procesamiento de Nerqia Pay. Se activa al conectar Nerqia Pay; no es un medio aparte en la tienda.'
 WHERE codigo = 'mercadopago';

UPDATE public.platform_integration_registry
   SET display_name = 'Envíos Nerqia',
       updated_at = now()
 WHERE integration_key = 'gestiona_envios';

UPDATE public.platform_integration_registry
   SET description = replace(description, 'Envíos Gestiona', 'Envíos Nerqia'),
       updated_at = now()
 WHERE description LIKE '%Envíos Gestiona%';

-- No se pisa un dominio de correo propio que el operador ya haya configurado.
-- El dominio anterior nunca existió; al pasar al nuevo se invalida cualquier
-- marca de verificación hasta que Resend confirme el DNS de nerqia.app.
UPDATE public.platform_messaging_config
   SET email_dominio = CASE
         WHEN email_dominio IS NULL OR lower(email_dominio) = 'gestiona.app'
           THEN 'nerqia.app'
         ELSE email_dominio
       END,
       email_nombre = CASE
         WHEN email_nombre = 'Gestiona' THEN 'Nerqia'
         ELSE email_nombre
       END,
       email_verificado_at = CASE
         WHEN lower(COALESCE(email_dominio, '')) = 'gestiona.app' THEN NULL
         ELSE email_verificado_at
       END,
       updated_at = now()
 WHERE id;

-- Las firmas vigentes del checkout son extensas y ya están verificadas. Se
-- actualiza sólo el copy del producto de pago, sin tocar IDs, precios, stock ni
-- lógica transaccional.
DO $body$
DECLARE
  v_function record;
  v_definition text;
BEGIN
  FOR v_function IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosrc LIKE '%Gestiona Pay%'
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_definition := replace(v_definition, 'Gestiona Pay', 'Nerqia Pay');
    EXECUTE v_definition;
  END LOOP;
END
$body$;

DO $verify$
BEGIN
  IF (SELECT nombre_publico FROM public.payment_providers WHERE codigo = 'gestionapay')
       IS DISTINCT FROM 'Nerqia Pay' THEN
    RAISE EXCEPTION 'payment_providers no adoptó Nerqia Pay';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.platform_integration_registry
     WHERE (display_name LIKE '%Gestiona%' OR description LIKE '%Envíos Gestiona%')
  ) THEN
    RAISE EXCEPTION 'el catálogo merchant conserva marca visible anterior';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosrc LIKE '%Gestiona Pay%'
  ) THEN
    RAISE EXCEPTION 'una función pública conserva el nombre anterior de Pay';
  END IF;
END
$verify$;
