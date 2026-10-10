-- ═══════════════════════════════════════════════════════════════════════════
-- Un vendedor no borra comprobantes fiscales, ni crea claves de API, ni toca
-- la configuración de cobros
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Barrido del 2026-10-10 sobre `pg_policies` de la base vinculada, después de
-- encontrar el agujero del tarifario (20261010000200). Diecisiete tablas
-- sensibles tenían UNA política `FOR ALL` cuyo USING es «cualquier miembro»
-- y sin WITH CHECK —o sea, el mismo USING para escribir—. Ningún REVOKE ni
-- política restrictiva lo compensaba: `authenticated` tiene DELETE, INSERT y
-- UPDATE.
--
-- Comprobado como un vendedor real (rol authenticated con sus claims), en una
-- transacción revertida:
--
--     borra un comprobante de ARCA ............. 1 fila
--     crea una clave de API de la organización . 1 fila
--     configura el proveedor de cobros ......... 1 fila
--
-- Las rutas que escriben en estas tablas ya eran sólo para dueño y admin en
-- la interfaz; la base era lo único que faltaba. Antes de restringir se midió
-- que ninguna función de la base escribe en ellas con el rol de quien llama
-- (todas son SECURITY DEFINER), y que desde el cliente sólo escriben páginas
-- sólo-admin: no se rompen ventas, cobros ni facturación.
--
-- Reglas:
--
--   Configuración y dinero: leen los miembros —el POS necesita saber qué
--   medios de cobro hay y en qué sucursal está—; escriben dueño y admin.
--
--   Claves de API: sólo dueño y admin, también para leer.
--
--   Comprobantes de ARCA: un comprobante con CAE no se borra, ni siquiera el
--   dueño: se anula con nota de crédito. Sí se puede borrar un borrador sin CAE.
--
--   Auditoría (stock_history, document_access_log): se registra, no se edita
--   ni se borra. Un registro que cualquiera borra no audita nada.
--
-- Idempotente: borra la política FOR ALL original y las de esta migración
-- antes de crearlas. Reversible: recrear la FOR ALL de cada tabla.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tabla text;
  v_previa text;
  -- La política única original de cada tabla, medida el 2026-10-10.
  v_originales constant jsonb := '{
    "affiliate_payouts": "org_aff_payouts",
    "afip_alicuotas": "org_afip_alicuotas",
    "afip_comprobantes": "org_afip_comprobantes",
    "bank_transactions": "org_members_manage_bank_transactions",
    "cheques": "cheques_org_access",
    "customer_payments": "org_members_manage_customer_payments",
    "document_access_log": "org_doc_access_log",
    "ecommerce_stores": "org_ecom_stores",
    "financial_movements": "org_members_manage_financial_movements",
    "locations": "locations_org_access",
    "org_api_keys": "org_api_keys_org_access",
    "org_payment_providers": "org_payment_providers_org",
    "payment_routing": "payment_routing_org",
    "stock_history": "org_members_manage_stock_history",
    "supplier_payments": "org_members_manage_supplier_payments",
    "tax_declarations": "org_tax_declarations",
    "withholding_records": "org_withholdings"
  }'::jsonb;
  v_encargado constant text := $e$public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])$e$;
  v_miembro   constant text := $m$public.is_org_member(org_id, auth.uid())$m$;
BEGIN
  FOR v_tabla, v_previa IN SELECT key, value #>> '{}' FROM jsonb_each(v_originales) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_previa, v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_leer ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_crear ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_editar ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_borrar ON public.%1$I', v_tabla);

    -- ── Leer ──────────────────────────────────────────────────────────────
    EXECUTE format('CREATE POLICY %1$s_leer ON public.%1$I FOR SELECT TO authenticated USING (%2$s)',
      v_tabla, CASE v_tabla WHEN 'org_api_keys' THEN v_encargado ELSE v_miembro END);

    -- ── Crear ─────────────────────────────────────────────────────────────
    -- La auditoría la registra cualquiera que actúa; el resto, encargados.
    EXECUTE format('CREATE POLICY %1$s_crear ON public.%1$I FOR INSERT TO authenticated WITH CHECK (%2$s)',
      v_tabla, CASE WHEN v_tabla IN ('stock_history', 'document_access_log') THEN v_miembro ELSE v_encargado END);

    -- ── Editar y borrar ───────────────────────────────────────────────────
    -- La auditoría no se edita ni se borra: no se crean esas políticas.
    IF v_tabla NOT IN ('stock_history', 'document_access_log') THEN
      EXECUTE format('CREATE POLICY %1$s_editar ON public.%1$I FOR UPDATE TO authenticated USING (%2$s) WITH CHECK (%2$s)',
        v_tabla, v_encargado);
      EXECUTE format('CREATE POLICY %1$s_borrar ON public.%1$I FOR DELETE TO authenticated USING (%2$s)',
        v_tabla, CASE v_tabla
          -- Un comprobante con CAE existe ante ARCA: se anula, no se borra.
          WHEN 'afip_comprobantes' THEN v_encargado || ' AND cae IS NULL'
          ELSE v_encargado END);
    END IF;
  END LOOP;
END $$;
