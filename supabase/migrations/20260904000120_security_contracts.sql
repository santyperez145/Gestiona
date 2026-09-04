-- Contratos de acceso para funciones privilegiadas.
--
-- Una funcion SECURITY DEFINER corre con los permisos de su propietario. Por
-- eso no alcanza con que la UI o una Edge Function validen al usuario: la base
-- debe revocar el acceso de navegador o verificar el tenant y la capacidad.

BEGIN;

-- 1. Operaciones exclusivamente internas. CREATE OR REPLACE conserva grants
-- anteriores, de modo que cada contrato vuelve a revocar todos los roles web.
DO $block$
DECLARE
  v_name text;
  v_args text;
  v_oid oid;
  v_service_only text[] := ARRAY[
    'avisar_trial_por_vencer',
    'costo_unitario_ars',
    'is_email_suppressed',
    'seed_default_alert_rules',
    'seed_default_automation_flows',
    'seed_default_price_list',
    'seed_demo_data',
    'usos_de_cupon_por_persona'
  ];
BEGIN
  FOR v_name, v_args, v_oid IN
    SELECT procedure.proname, pg_get_function_identity_arguments(procedure.oid), procedure.oid
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY(v_service_only)
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      v_name,
      v_args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      v_name,
      v_args
    );
  END LOOP;
END;
$block$;

-- 2. Completar defaults sigue disponible para owner/admin y para los triggers
-- de provisioning. Un miembro de otra organizacion ya no puede sembrar filas.
CREATE OR REPLACE FUNCTION public.seed_default_permissions(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_modules text[] := ARRAY[
    'sales','pos','products','customers','crm','reports',
    'expenses','purchases','invoices','inventory','analytics',
    'marketing','support','settings','team','finance',
    'ecommerce','shipping','payments','influencers'
  ];
  v_module text;
BEGIN
  IF p_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations organization WHERE organization.id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Organizacion inexistente' USING ERRCODE = '22023';
  END IF;

  -- auth.uid() es NULL en triggers internos. El owner_user_id permite que el
  -- trigger AFTER INSERT funcione antes de que se cree la membership.
  IF v_actor IS NOT NULL
     AND NOT public.is_platform_admin(v_actor)
     AND NOT EXISTS (
       SELECT 1
       FROM public.organizations organization
       WHERE organization.id = p_org_id
         AND organization.owner_user_id = v_actor
     )
     AND NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Sin permiso para completar permisos de esta organizacion'
      USING ERRCODE = '42501';
  END IF;

  FOREACH v_module IN ARRAY v_modules LOOP
    INSERT INTO public.role_permissions(
      org_id, role, module, can_view, can_create, can_edit, can_delete, can_export
    ) VALUES (
      p_org_id, 'admin', v_module, true, true, true, true, true
    ) ON CONFLICT (org_id, role, module) DO NOTHING;

    INSERT INTO public.role_permissions(
      org_id, role, module, can_view, can_create, can_edit, can_delete, can_export
    ) VALUES (
      p_org_id,
      'vendedor',
      v_module,
      v_module NOT IN ('finance','payments','settings','team'),
      v_module IN ('sales','pos','customers','crm','support'),
      v_module IN ('sales','pos','customers','ecommerce'),
      false,
      v_module IN ('sales','customers')
    ) ON CONFLICT (org_id, role, module) DO NOTHING;

    INSERT INTO public.role_permissions(
      org_id, role, module, can_view, can_create, can_edit, can_delete, can_export
    ) VALUES (
      p_org_id,
      'viewer',
      v_module,
      v_module NOT IN ('settings','team','finance','payments'),
      false,
      false,
      false,
      v_module IN ('reports','analytics')
    ) ON CONFLICT (org_id, role, module) DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_default_permissions(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_default_permissions(uuid)
  TO authenticated, service_role;

-- 3. El motor de territorios pertenece a Customers. Solo acepta clientes
-- existentes del mismo tenant y nunca asigna a una persona ajena al tenant.
CREATE OR REPLACE FUNCTION public.apply_territory_rules(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_attributes jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rule public.territory_rules;
  v_assigned uuid;
  v_reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_permission(p_org_id, 'customers', 'edit') THEN
    RAISE EXCEPTION 'Sin permiso para asignar territorios'
      USING ERRCODE = '42501';
  END IF;
  IF p_entity_type IS DISTINCT FROM 'customer' THEN
    RAISE EXCEPTION 'Tipo de entidad no soportado' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers customer
    WHERE customer.id = p_entity_id AND customer.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Cliente inexistente en esta organizacion'
      USING ERRCODE = '22023';
  END IF;
  IF pg_column_size(COALESCE(p_attributes, '{}'::jsonb)) > 32768 THEN
    RAISE EXCEPTION 'Los atributos de territorio superan 32 KB'
      USING ERRCODE = '22001';
  END IF;

  FOR v_rule IN
    SELECT rule.*
    FROM public.territory_rules rule
    WHERE rule.org_id = p_org_id AND rule.active
    ORDER BY rule.priority, rule.created_at
  LOOP
    IF NOT public.eval_territory_conditions(
      v_rule.conditions,
      COALESCE(p_attributes, '{}'::jsonb)
    ) THEN
      CONTINUE;
    END IF;

    IF v_rule.use_round_robin THEN
      SELECT member.user_id
      INTO v_assigned
      FROM public.territory_members member
      JOIN public.memberships membership
        ON membership.org_id = p_org_id
       AND membership.user_id = member.user_id
      WHERE member.territory_id = v_rule.territory_id
      ORDER BY (
        SELECT count(*)
        FROM public.territory_assignments assignment
        WHERE assignment.assigned_user_id = member.user_id
          AND assignment.created_at > now() - interval '30 days'
      ), random()
      LIMIT 1;
    ELSE
      v_assigned := v_rule.assigned_user_id;
    END IF;

    IF v_assigned IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.memberships membership
      WHERE membership.org_id = p_org_id AND membership.user_id = v_assigned
    ) THEN
      CONTINUE;
    END IF;

    v_reason := COALESCE(v_rule.name, 'rule:' || v_rule.id::text);
    INSERT INTO public.territory_assignments(
      org_id, entity_type, entity_id, territory_id, rule_id,
      assigned_user_id, reason
    ) VALUES (
      p_org_id, 'customer', p_entity_id, v_rule.territory_id, v_rule.id,
      v_assigned, v_reason
    );
    RETURN v_assigned;
  END LOOP;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_territory_rules(uuid, text, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_territory_rules(uuid, text, uuid, jsonb)
  TO authenticated, service_role;

-- 4. La numeracion de compras modifica estado. Requiere la misma capacidad
-- que la creacion de la orden que consume el numero.
CREATE OR REPLACE FUNCTION public.generate_po_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_next integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_permission(p_org_id, 'purchases', 'create') THEN
    RAISE EXCEPTION 'Sin permiso para crear ordenes de compra'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.po_sequences (org_id, last_number)
  VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE
    SET last_number = public.po_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN 'OC-' || lpad(v_next::text, 4, '0');
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_po_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_po_number(uuid)
  TO authenticated, service_role;

-- 5. Los comercios necesitan saber si los canales estan listos, no conocer la
-- topologia SMTP ni los identificadores internos de WhatsApp de la plataforma.
CREATE OR REPLACE FUNCTION public.mensajeria_de_plataforma()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_config public.platform_messaging_config%ROWTYPE;
  v_privileged boolean;
BEGIN
  SELECT config.* INTO v_config
  FROM public.platform_messaging_config config
  WHERE config.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_privileged := auth.role() = 'service_role'
    OR (auth.uid() IS NOT NULL AND public.is_platform_admin(auth.uid()));

  RETURN jsonb_build_object(
    'email_dominio', v_config.email_dominio,
    'email_nombre', v_config.email_nombre,
    'email_casillas', v_config.email_casillas,
    'email_listo', v_config.email_dominio IS NOT NULL
      AND v_config.email_verificado_at IS NOT NULL,
    'smtp_host', CASE WHEN v_privileged THEN v_config.smtp_host ELSE NULL END,
    'smtp_port', CASE WHEN v_privileged THEN v_config.smtp_port ELSE NULL END,
    'smtp_user', CASE WHEN v_privileged THEN v_config.smtp_user ELSE NULL END,
    'smtp_secure', CASE WHEN v_privileged THEN v_config.smtp_secure ELSE NULL END,
    'smtp_from_email', v_config.smtp_from_email,
    'smtp_configurado', v_config.smtp_host IS NOT NULL
      AND v_config.smtp_user IS NOT NULL
      AND v_config.smtp_from_email IS NOT NULL,
    'whatsapp_proveedor', CASE
      WHEN v_privileged THEN v_config.whatsapp_proveedor ELSE NULL END,
    'whatsapp_phone_number_id', CASE
      WHEN v_privileged THEN v_config.whatsapp_phone_number_id ELSE NULL END,
    'whatsapp_numero_visible', v_config.whatsapp_numero_visible,
    'whatsapp_listo', v_config.whatsapp_proveedor = 'meta_cloud'
      AND v_config.whatsapp_phone_number_id IS NOT NULL
      AND v_config.whatsapp_verificado_at IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mensajeria_de_plataforma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensajeria_de_plataforma()
  TO authenticated, service_role;

-- 6. Registro versionado de excepciones. El hash hace que cambiar el cuerpo de
-- una funcion publica reabra la auditoria aunque conserve nombre y firma.
CREATE TABLE IF NOT EXISTS public.security_function_contracts (
  function_name text NOT NULL,
  identity_arguments text NOT NULL DEFAULT '',
  audience text NOT NULL CHECK (audience IN (
    'public_storefront', 'public_token', 'authenticated_delegate', 'security_helper'
  )),
  rationale text NOT NULL CHECK (char_length(rationale) >= 20),
  definition_hash text NOT NULL,
  reviewed_on date NOT NULL,
  PRIMARY KEY (function_name, identity_arguments)
);

ALTER TABLE public.security_function_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_function_contracts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.security_function_contracts TO service_role;

WITH contracts(function_name, identity_arguments, audience, rationale) AS (
  VALUES
    ('can_review_product', 'p_slug text, p_product_id uuid', 'public_token', 'Valida compra mediante la sesion anonima del storefront.'),
    ('check_store_coupon', 'p_slug text, p_code text, p_subtotal numeric, p_email text, p_shipping numeric', 'public_storefront', 'Cotiza un cupon sin exponer su configuracion privada.'),
    ('confirm_payment_link_transfer', 'p_id uuid', 'public_token', 'La posesion del enlace permite avisar una transferencia, nunca acreditarla.'),
    ('convert_store_cart', 'p_slug text, p_token text', 'public_token', 'Convierte un carrito identificado por un token aleatorio.'),
    ('create_store_order', 'p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text, p_shipping jsonb, p_payment_method text, p_notes text, p_coupon text, p_shipping_option text, p_fiscal jsonb', 'public_storefront', 'Checkout publico con precios y stock recalculados por la base.'),
    ('create_store_order_from_cart_idem', 'p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text, p_shipping jsonb, p_payment_method text, p_notes text, p_coupon text, p_shipping_option text, p_fiscal jsonb, p_idempotency_key text, p_cart_token text', 'public_storefront', 'Checkout publico idempotente ligado a un carrito anonimo.'),
    ('create_store_order_idem', 'p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text, p_shipping jsonb, p_payment_method text, p_notes text, p_coupon text, p_shipping_option text, p_fiscal jsonb, p_idempotency_key text', 'public_storefront', 'Checkout publico idempotente con autoridad de precios server-side.'),
    ('cuotas_publicas', 'p_org uuid', 'public_storefront', 'Expone solamente planes de cuotas publicables de la tienda.'),
    ('dias_para_arrepentirse', 'p_order_id uuid', 'public_token', 'Calcula el plazo legal sin exponer datos internos de la orden.'),
    ('get_cart_by_recovery_token', 'p_token text', 'public_token', 'Recupera un carrito mediante token de alta entropia.'),
    ('get_influencer_portal', 'p_token text', 'public_token', 'Abre el portal limitado de influencer mediante token revocable.'),
    ('get_my_questions', 'p_slug text, p_product_id uuid', 'public_token', 'Devuelve preguntas asociadas a la identidad anonima de tienda.'),
    ('get_my_store_orders', 'p_slug text', 'public_token', 'Devuelve pedidos limitados a la sesion del comprador.'),
    ('get_my_wishlist', 'p_slug text', 'public_token', 'Devuelve favoritos de la sesion anonima del comprador.'),
    ('get_order_tracking', 'p_order_number text, p_email text', 'public_token', 'Rastreo limitado por numero de pedido y correo coincidente.'),
    ('get_public_payment_link', 'p_id uuid', 'public_token', 'Expone el estado minimo de un enlace de cobro no secuencial.'),
    ('get_public_promotions', 'p_org_id uuid', 'public_storefront', 'Expone promociones publicadas, sin costos ni reglas internas.'),
    ('get_public_service_status', '', 'public_storefront', 'Expone solamente el estado publico de servicios de Nerqia.'),
    ('get_published_store_slug', 'p_org_id uuid', 'public_storefront', 'Resuelve el slug publicado para navegacion publica.'),
    ('get_store_banners', 'p_slug text', 'public_storefront', 'Entrega contenido visual publicado por la tienda.'),
    ('get_store_cart', 'p_slug text, p_token text', 'public_token', 'Lee el carrito anonimo identificado por token.'),
    ('get_store_catalog_products', 'p_slug text', 'public_storefront', 'Entrega el catalogo publicable sin columnas de costo.'),
    ('get_store_categories', 'p_slug text', 'public_storefront', 'Entrega categorias publicadas del catalogo.'),
    ('get_store_order_secure', 'p_slug text, p_order_number text, p_access_token text, p_email text', 'public_token', 'Acceso a pedido por token o correo coincidente.'),
    ('get_store_pages', 'p_slug text', 'public_storefront', 'Entrega paginas legales y de contenido publicadas.'),
    ('get_store_perfume_details', 'p_slug text', 'public_storefront', 'Entrega atributos publicos del tipo de producto heredado.'),
    ('get_store_product_recommendations', 'p_slug text, p_product_id uuid, p_limit integer', 'public_storefront', 'Entrega recomendaciones limitadas al catalogo publicado.'),
    ('get_store_quantity_discounts', 'p_slug text', 'public_storefront', 'Entrega descuentos por cantidad visibles al comprador.'),
    ('get_store_questions', 'p_slug text', 'public_storefront', 'Entrega preguntas y respuestas publicadas.'),
    ('get_store_reviews', 'p_slug text', 'public_storefront', 'Entrega resenas moderadas y publicadas.'),
    ('get_store_slug_by_host', 'p_host text', 'public_storefront', 'Resuelve un dominio verificado a su tienda publicada.'),
    ('get_store_variants', 'p_slug text', 'public_storefront', 'Entrega variantes publicadas y disponibilidad mostrable.'),
    ('list_published_store_slugs', '', 'public_storefront', 'Entrega slugs publicados para sitemap e indexacion.'),
    ('normalize_store_cart_items', 'p_org_id uuid, p_items jsonb', 'public_storefront', 'Normaliza items publicos antes del calculo autoritativo.'),
    ('process_drip_unsubscribe', 'p_token text, p_user_agent text, p_ip inet', 'public_token', 'Procesa la baja de correo mediante token firmado.'),
    ('process_whatsapp_unsubscribe', 'p_token text', 'public_token', 'Procesa la baja de WhatsApp mediante token firmado.'),
    ('quote_store_shipping', 'p_slug text, p_province text, p_postal_code text, p_items jsonb', 'public_storefront', 'Cotiza envio con reglas publicas y totales recalculados.'),
    ('record_store_visit', 'p_slug text, p_visit_token text, p_attribution jsonb', 'public_token', 'Registra atribucion limitada por token y rate limit.'),
    ('register_store_marketing_consent', 'p_slug text, p_order_number text, p_email text, p_source text', 'public_token', 'Registra consentimiento vinculado a una compra comprobable.'),
    ('request_stock_alert', 'p_slug text, p_product_id uuid, p_email text, p_variant_id uuid', 'public_storefront', 'Registra un aviso de stock con validacion y rate limit.'),
    ('resolve_store_line', 'p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_qty integer, p_order_subtotal numeric', 'public_storefront', 'Calcula una linea vendible sin devolver costos internos.'),
    ('save_store_cart', 'p_slug text, p_token text, p_items jsonb, p_email text, p_subtotal numeric', 'public_token', 'Persiste un carrito anonimo identificado por token.'),
    ('save_store_cart_v2', 'p_slug text, p_token text, p_items jsonb, p_email text', 'public_token', 'Persiste carrito con normalizacion autoritativa.'),
    ('save_store_cart_v3', 'p_slug text, p_token text, p_items jsonb, p_email text, p_visit_token text', 'public_token', 'Persiste carrito y atribucion mediante tokens anonimos.'),
    ('start_store_checkout', 'p_slug text, p_token text, p_items jsonb, p_email text', 'public_token', 'Marca el inicio de checkout de un carrito anonimo.'),
    ('start_store_checkout_v2', 'p_slug text, p_token text, p_items jsonb, p_email text, p_visit_token text', 'public_token', 'Marca checkout con atribucion anonima vinculada.'),
    ('stock_disponible', 'p_product_id uuid, p_variant_id uuid, p_location_id uuid', 'public_storefront', 'Devuelve disponibilidad vendible, nunca costo ni movimientos.'),
    ('store_cart_weight_kg', 'p_org_id uuid, p_items jsonb, p_default_weight numeric', 'public_storefront', 'Calcula peso para una cotizacion publica de envio.'),
    ('store_iva_config', 'p_slug text', 'public_storefront', 'Expone la presentacion fiscal necesaria en la tienda.'),
    ('store_promo_2x_discount', 'p_org_id uuid, p_items jsonb', 'public_storefront', 'Calcula un descuento publicado sin exponer su costo.'),
    ('store_promo_price', 'p_org_id uuid, p_product_id uuid, p_category text, p_list_price numeric, p_order_subtotal numeric', 'public_storefront', 'Calcula el precio promocional publicable de una linea.'),
    ('store_volume_discount', 'p_org_id uuid, p_items jsonb', 'public_storefront', 'Calcula descuentos de volumen publicados.'),
    ('submit_influencer_content', 'p_token text, p_exchange_id uuid, p_content_url text, p_actual_posts integer', 'public_token', 'Permite entregar evidencia mediante token revocable.'),
    ('toggle_wishlist', 'p_slug text, p_product_id uuid', 'public_token', 'Muta favoritos de la sesion anonima del comprador.'),
    ('transferencia_tienda_lista', 'p_org_id uuid', 'public_storefront', 'Expone si transferencia esta disponible, no sus secretos.'),
    ('upsert_product_review', 'p_slug text, p_product_id uuid, p_rating integer, p_title text, p_body text', 'public_token', 'Registra resena bajo la identidad anonima y moderacion.'),
    ('upsert_store_customer', 'p_slug text, p_name text, p_phone text', 'public_token', 'Actualiza el perfil minimo de la sesion de comprador.'),
    ('create_sales_transaction_v3', 'p_org_id uuid, p_sales jsonb, p_source text', 'authenticated_delegate', 'Delega en create_sales_transaction_v2, que exige permiso de ventas.'),
    ('finance_core_snapshot', 'p_org_id uuid', 'authenticated_delegate', 'Delega acceso en product_surface_access antes de agregar datos.'),
    ('finance_document_begin_extraction', 'p_document_id uuid, p_version_id uuid', 'authenticated_delegate', 'Abre lease despues de finance_document_can con JWT real.'),
    ('finance_document_begin_inspection', 'p_document_id uuid, p_version_id uuid', 'authenticated_delegate', 'Abre lease despues de finance_document_can con JWT real.'),
    ('finance_document_can', 'p_org_id uuid, p_action text', 'security_helper', 'Delega tenant, producto y permiso en organization_capability_access.'),
    ('finance_document_confirm_matching', 'p_match_run_id uuid, p_supplier_id uuid, p_lines jsonb', 'authenticated_delegate', 'Deriva el tenant desde el match y exige finance_document_can.'),
    ('finance_document_create_drafts', 'p_extraction_id uuid', 'authenticated_delegate', 'Deriva el tenant desde la extraccion y exige finance_document_can.'),
    ('finance_document_create_upload', 'p_org_id uuid, p_document_type text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_sha256 text', 'authenticated_delegate', 'Exige finance_document_can antes de reservar storage privado.'),
    ('finance_document_create_version', 'p_document_id uuid, p_file_name text, p_mime_type text, p_size_bytes bigint, p_sha256 text', 'authenticated_delegate', 'Deriva el tenant del documento y exige finance_document_can.'),
    ('finance_document_finalize_upload', 'p_document_id uuid, p_version_id uuid', 'authenticated_delegate', 'Finaliza solo una version accesible por finance_document_can.'),
    ('finance_document_get_matching', 'p_extraction_id uuid', 'authenticated_delegate', 'Deriva tenant desde extraccion y exige finance_document_can.'),
    ('finance_document_mark_upload_failed', 'p_document_id uuid, p_version_id uuid, p_reason text', 'authenticated_delegate', 'Deriva tenant del documento y exige finance_document_can.'),
    ('finance_document_run_matching', 'p_extraction_id uuid', 'authenticated_delegate', 'Deriva tenant desde extraccion y exige finance_document_can.'),
    ('finance_document_storage_read_allowed', 'p_path text', 'security_helper', 'Policy de storage deriva tenant de una ruta validada.'),
    ('finance_document_storage_upload_allowed', 'p_path text', 'security_helper', 'Policy de storage deriva tenant de una ruta validada.'),
    ('finance_document_submit_extraction_review', 'p_extraction_id uuid, p_payload jsonb, p_note text', 'authenticated_delegate', 'Deriva tenant desde extraccion y exige finance_document_can.'),
    ('get_user_role', '_user_id uuid', 'security_helper', 'Helper heredado usado por policies que pasan auth.uid().'),
    ('has_role', '_user_id uuid, _role app_role', 'security_helper', 'Helper heredado usado por policies que pasan auth.uid().'),
    ('organization_capability_access', 'p_org_id uuid, p_capability_key text, p_action text', 'security_helper', 'Delega tenant, entitlement y permiso en capability_evaluate.'),
    ('platform_role', '_user_id uuid', 'security_helper', 'Helper de policies y control plane para rol de plataforma.'),
    ('receive_purchase_order_idem', 'p_order_id uuid, p_items jsonb, p_notes text, p_location_id uuid, p_idempotency_key text', 'authenticated_delegate', 'Deriva tenant de la orden y delega en la recepcion autoritativa.')
)
INSERT INTO public.security_function_contracts(
  function_name,
  identity_arguments,
  audience,
  rationale,
  definition_hash,
  reviewed_on
)
SELECT
  contract.function_name,
  contract.identity_arguments,
  contract.audience,
  contract.rationale,
  md5(pg_get_functiondef(procedure.oid)),
  DATE '2026-09-04'
FROM contracts contract
JOIN pg_proc procedure ON procedure.proname = contract.function_name
  AND pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  AND namespace.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

CREATE OR REPLACE VIEW public.audit_funciones_expuestas AS
SELECT
  procedure.proname AS funcion,
  pg_get_function_identity_arguments(procedure.oid) AS argumentos,
  has_function_privilege('anon', procedure.oid, 'EXECUTE') AS llama_anon,
  has_function_privilege('authenticated', procedure.oid, 'EXECUTE') AS llama_authenticated,
  pg_get_function_identity_arguments(procedure.oid) ILIKE '%org%' AS recibe_org
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
LEFT JOIN public.security_function_contracts contract
  ON contract.function_name = procedure.proname
 AND contract.identity_arguments = pg_get_function_identity_arguments(procedure.oid)
 AND contract.definition_hash = md5(pg_get_functiondef(procedure.oid))
WHERE namespace.nspname = 'public'
  AND procedure.prosecdef
  AND procedure.prorettype <> 'trigger'::regtype
  AND (
    has_function_privilege('anon', procedure.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  )
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%is_org_member%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%is_platform_admin%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%has_permission%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%has_org_role%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%has_platform_role%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%public.memberships%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%exigir_permiso%'
  AND contract.function_name IS NULL;

COMMENT ON VIEW public.audit_funciones_expuestas IS
  'SECURITY DEFINER invocables desde roles web sin guarda reconocida ni contrato versionado. Debe estar vacia; cambiar el cuerpo invalida el hash del contrato.';

REVOKE ALL ON public.audit_funciones_expuestas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_funciones_expuestas TO service_role;

-- Una funcion puede usar costos para calcular un precio publico sin exponerlos.
-- Para retornos compuestos se auditan las columnas devueltas, no palabras del
-- cuerpo. Los retornos escalares/JSON siguen bajo la regla estricta anterior.
CREATE OR REPLACE VIEW public.audit_costo_expuesto AS
SELECT
  procedure.proname AS funcion,
  pg_get_function_identity_arguments(procedure.oid) AS argumentos,
  has_function_privilege('anon', procedure.oid, 'EXECUTE') AS llama_anon,
  has_function_privilege('authenticated', procedure.oid, 'EXECUTE') AS llama_authenticated
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
JOIN pg_type return_type ON return_type.oid = procedure.prorettype
WHERE namespace.nspname = 'public'
  AND procedure.prokind IN ('f', 'p')
  AND procedure.prorettype <> 'trigger'::regtype
  AND has_function_privilege('anon', procedure.oid, 'EXECUTE')
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%is_org_member%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%is_platform_admin%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%has_permission%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%has_org_role%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%has_platform_role%'
  AND pg_get_functiondef(procedure.oid) NOT ILIKE '%public.memberships%'
  AND (
    pg_get_functiondef(procedure.oid) ~* '\mcosto_'
    OR pg_get_functiondef(procedure.oid) ~* '\mcost_'
    OR pg_get_functiondef(procedure.oid) ~* '\mmargen\M'
    OR pg_get_functiondef(procedure.oid) ~* '\mprofit_'
    OR pg_get_functiondef(procedure.oid) ~* 'cost_per_unit'
    OR pg_get_functiondef(procedure.oid) ~* 'unit_cost'
  )
  AND (
    return_type.typrelid = 0
    OR EXISTS (
      SELECT 1
      FROM pg_attribute attribute
      WHERE attribute.attrelid = return_type.typrelid
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND attribute.attname ~* '(costo|cost|margen|profit|ganancia)'
    )
  );

COMMENT ON VIEW public.audit_costo_expuesto IS
  'RPC anonimas que pueden devolver costo o margen. En tipos compuestos inspecciona columnas de salida para no confundir un calculo interno con una filtracion.';

REVOKE ALL ON public.audit_costo_expuesto FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_costo_expuesto TO service_role;

-- 7. Verificacion contra la base real. No modifica datos de comercios.
DO $verify$
DECLARE
  v_count integer;
  v_detail text;
  v_name text;
  v_args text;
  v_oid oid;
  v_org uuid;
  v_message jsonb;
BEGIN
  SELECT count(*), COALESCE(string_agg(funcion || '(' || argumentos || ')', ', '), '')
  INTO v_count, v_detail
  FROM public.audit_funciones_expuestas;
  ASSERT v_count = 0, 'funciones sin contrato: ' || v_detail;

  SELECT count(*), COALESCE(string_agg(funcion || '(' || argumentos || ')', ', '), '')
  INTO v_count, v_detail
  FROM public.audit_costo_expuesto;
  ASSERT v_count = 0, 'RPC con costo expuesto: ' || v_detail;

  SELECT count(*) INTO v_count FROM public.audit_policies_sin_tenant;
  ASSERT v_count = 0, 'hay policies sin tenant';

  SELECT count(*) INTO v_count FROM public.audit_rpc_sin_permiso;
  ASSERT v_count = 0, 'hay RPC de stock/plata sin permiso';

  SELECT count(*) INTO v_count
  FROM public.rls_audit_open_policies
  WHERE tablename NOT IN ('plans', 'payment_providers', 'payment_provider_fees');
  ASSERT v_count = 0, 'hay policies abiertas fuera de catalogos publicos';

  SELECT count(*) INTO v_count FROM public.rls_audit_open_policies;
  ASSERT v_count = 3, 'el contrato de policies abiertas cambio; revisar excepciones';

  SELECT count(*) INTO v_count
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'r'
    AND NOT relation.relrowsecurity;
  ASSERT v_count = 0, 'hay tablas publicas sin RLS';

  FOR v_name, v_args, v_oid IN
    SELECT procedure.proname, pg_get_function_identity_arguments(procedure.oid), procedure.oid
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY(ARRAY[
        'avisar_trial_por_vencer', 'costo_unitario_ars', 'is_email_suppressed',
        'seed_default_alert_rules', 'seed_default_automation_flows',
        'seed_default_price_list', 'seed_demo_data', 'usos_de_cupon_por_persona'
      ])
  LOOP
    ASSERT NOT has_function_privilege(
      'anon', v_oid, 'EXECUTE'
    ), v_name || ' sigue disponible para anon';
    ASSERT NOT has_function_privilege(
      'authenticated', v_oid, 'EXECUTE'
    ), v_name || ' sigue disponible para authenticated';
    ASSERT has_function_privilege(
      'service_role', v_oid, 'EXECUTE'
    ), v_name || ' no quedo disponible para service_role';
  END LOOP;

  SELECT organization.id INTO v_org FROM public.organizations organization LIMIT 1;
  IF v_org IS NOT NULL THEN
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
      true
    );

    BEGIN
      PERFORM public.seed_default_permissions(v_org);
      RAISE EXCEPTION 'un outsider completo permisos de otra organizacion';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      NULL;
    END;

    BEGIN
      PERFORM public.apply_territory_rules(v_org, 'customer', gen_random_uuid(), '{}'::jsonb);
      RAISE EXCEPTION 'un outsider ejecuto reglas de territorio';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      NULL;
    END;

    BEGIN
      PERFORM public.generate_po_number(v_org);
      RAISE EXCEPTION 'un outsider consumio una secuencia de compras';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      NULL;
    END;

    v_message := public.mensajeria_de_plataforma();
    ASSERT v_message->'smtp_host' = 'null'::jsonb,
      'un comercio puede leer smtp_host';
    ASSERT v_message->'smtp_user' = 'null'::jsonb,
      'un comercio puede leer smtp_user';
    ASSERT v_message->'whatsapp_phone_number_id' = 'null'::jsonb,
      'un comercio puede leer whatsapp_phone_number_id';
  END IF;

  PERFORM set_config('request.jwt.claims', '{}'::jsonb::text, true);
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260904000120', 'security_contracts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
