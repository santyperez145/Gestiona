-- Verificacion reversible. No llama ARCA ni envia correos.
BEGIN;
CREATE TEMP TABLE zz_manual_invoice_tax_results (
  scenario text PRIMARY KEY,
  ok boolean NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_owner uuid;
  v_viewer uuid;
  v_result jsonb;
  v_invoice uuid;
  v_class_c uuid;
BEGIN
  SELECT user_id INTO v_owner
    FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_viewer
    FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL OR v_viewer IS NULL THEN
    RAISE EXCEPTION 'Se necesitan dos identidades existentes';
  END IF;

  INSERT INTO public.organizations(id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ Manual invoice tax', 'zz-manual-tax-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role)
  VALUES (v_org, v_owner, 'owner'), (v_org, v_viewer, 'viewer');
  INSERT INTO public.settings(
    org_id, user_id, afip_tipo_emisor, tax_iva_percent,
    tax_prices_include_iva, exchange_rate
  ) VALUES (
    v_org, v_owner, 'responsable_inscripto', 21, false, 1
  ) ON CONFLICT (org_id) DO UPDATE SET
    afip_tipo_emisor = 'responsable_inscripto',
    tax_iva_percent = 21,
    tax_prices_include_iva = false,
    exchange_rate = 1;
  INSERT INTO public.afip_credentials(
    org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio
  ) VALUES (
    v_org, '20123456786', 1, 'homologacion',
    'responsable_inscripto', 'ZZ Manual invoice tax', 'ZZ Test address'
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  v_result := public.crear_factura_manual(
    v_org,
    jsonb_build_object(
      'name', 'ZZ Responsable receptor',
      'tax_id', '20123456786'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description', 'ZZ Servicio 21', 'quantity', 1,
        'unit_price', 100, 'tax_rate', 21
      ),
      jsonb_build_object(
        'description', 'ZZ Servicio 10.5', 'quantity', 2,
        'unit_price', 50, 'tax_rate', 10.5
      )
    ),
    jsonb_build_object(
      'enabled', true,
      'receiver_condition', 'responsable_inscripto',
      'tax_pct', 21
    ),
    NULL
  );
  RESET ROLE;
  v_invoice := (v_result->>'invoice_id')::uuid;

  INSERT INTO zz_manual_invoice_tax_results
  SELECT 'mixed_header',
    subtotal = 200 AND tax_amount = 31.5 AND total = 231.5
    AND tax_pct = 0 AND tipo_comprobante = 1
  FROM public.invoices WHERE id = v_invoice;
  INSERT INTO zz_manual_invoice_tax_results VALUES (
    'mixed_groups',
    public.invoice_iva_groups(v_invoice) =
      '[{"rate":10.5,"base":100,"amount":10.5},{"rate":21,"base":100,"amount":21}]'::jsonb
  );
  INSERT INTO zz_manual_invoice_tax_results
  SELECT 'line_snapshot', count(*) = 2
    AND count(*) FILTER (WHERE tax_rate = 21 AND tax_amount = 21) = 1
    AND count(*) FILTER (WHERE tax_rate = 10.5 AND tax_amount = 10.5) = 1
  FROM public.invoice_items WHERE invoice_id = v_invoice;

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.crear_factura_manual(
      v_org,
      jsonb_build_object('name', 'ZZ Invalid rate'),
      jsonb_build_array(jsonb_build_object(
        'description', 'ZZ Invalid', 'quantity', 1,
        'unit_price', 100, 'tax_rate', 19
      )),
      jsonb_build_object('enabled', true, 'tax_pct', 21),
      NULL
    );
    RAISE EXCEPTION 'Se admitio una alicuota inventada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%alicuota no admitida%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  INSERT INTO zz_manual_invoice_tax_results VALUES ('invalid_rate_blocked', true);

  UPDATE public.afip_credentials
    SET tipo_emisor = 'monotributista'
    WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  v_result := public.crear_factura_manual(
    v_org,
    jsonb_build_object('name', 'ZZ Consumidor final'),
    jsonb_build_array(jsonb_build_object(
      'description', 'ZZ Clase C', 'quantity', 1,
      'unit_price', 121, 'tax_rate', 21
    )),
    jsonb_build_object(
      'enabled', true,
      'receiver_condition', 'consumidor_final',
      'tax_pct', 21
    ),
    NULL
  );
  RESET ROLE;
  v_class_c := (v_result->>'invoice_id')::uuid;
  INSERT INTO zz_manual_invoice_tax_results
  SELECT 'class_c_forces_zero',
    tipo_comprobante = 11 AND subtotal = 121 AND tax_pct = 0
    AND tax_amount = 0 AND total = 121
  FROM public.invoices WHERE id = v_class_c;
  INSERT INTO zz_manual_invoice_tax_results
  SELECT 'class_c_line_zero',
    count(*) = 1 AND min(tax_rate) = 0 AND min(tax_amount) = 0
  FROM public.invoice_items WHERE invoice_id = v_class_c;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.crear_factura_manual(
      v_org,
      jsonb_build_object('name', 'ZZ Viewer'),
      jsonb_build_array(jsonb_build_object(
        'description', 'ZZ Blocked', 'quantity', 1,
        'unit_price', 1, 'tax_rate', 0
      )),
      jsonb_build_object('enabled', false),
      NULL
    );
    RAISE EXCEPTION 'Viewer pudo crear una factura';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  INSERT INTO zz_manual_invoice_tax_results VALUES ('viewer_blocked', true);

  IF EXISTS (
    SELECT 1 FROM zz_manual_invoice_tax_results WHERE ok IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Fallaron aserciones de factura manual por renglon';
  END IF;
END;
$$;

SELECT * FROM zz_manual_invoice_tax_results ORDER BY scenario;
ROLLBACK;
