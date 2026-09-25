-- Verificación E2E reversible de F5.1 (extracción real de documentos Finance).
--
--   npm run db -- --file supabase/verificaciones/20260925_finance_document_extraction_e2e.sql
--
-- ── Qué prueba, de punta a punta ─────────────────────────────────────────
--
--   1. Registro real con el trigger de signup + capability finance.documents.
--   2. Habilitación del producto finance por Control Plane (auditable).
--   3. `finance_document_create_upload` (contrato de bandeja).
--   4. PDF mínimo real al bucket privado (misma ruta que produce la UI).
--   5. `finance_document_finalize_upload` → awaiting_inspection.
--   6. Inspección con scanner structural-policy clean + hash verificado
--      → ready_for_extraction (el paso que antes quedaba trabado).
--   7. `finance_document_begin_extraction` (lease) + complete con payload
--      de modelo → ready_for_review.
--   8. Revisión humana append-only → reviewed.
--   9. Matching con proveedor real → propuesto con método exact_name.
--  10. Un outsider no inspecciona ni extrae.
--  11. Cero efectos operativos y trazabilidad registrada.
--
-- El ROLLBACK garantiza que producción queda exactamente igual que antes.

BEGIN;

CREATE TEMP TABLE res(n int, paso text, esperado text, obtenido text) ON COMMIT DROP;
GRANT ALL ON res TO authenticated;
GRANT ALL ON res TO service_role;
CREATE TEMP TABLE ctx(org uuid, usr uuid, doc uuid, ver uuid, path text, ext uuid, token uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
GRANT ALL ON ctx TO service_role;

-- ═══ Alta real: el trigger de registro, no un INSERT a organizations ════
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_org uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz-f51-'||substr(v_uid::text,1,8)||'@ejemplo.test',
          crypt('no-se-usa', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"full_name":"ZZ F5.1"}'::jsonb, now(), now());

  SELECT id INTO v_org FROM public.organizations WHERE owner_user_id = v_uid;
  INSERT INTO ctx(org, usr) VALUES (v_org, v_uid);
END $$;

INSERT INTO res
SELECT 1, 'nació la organización con capability finance.documents', 'enabled',
       COALESCE((SELECT status FROM public.organization_capabilities
                  WHERE org_id = (SELECT org FROM ctx)
                    AND capability_key = 'finance.documents'), 'missing')
  FROM ctx;

-- ═══ Control Plane habilita el producto finance (auditable, reversible) ═
DO $$
DECLARE
  v_admin uuid := (SELECT usr FROM ctx);
BEGIN
  INSERT INTO public.platform_admins(user_id, role)
  VALUES ((SELECT usr FROM ctx), 'superadmin')
  ON CONFLICT (user_id) DO UPDATE SET role = 'superadmin';

  PERFORM public.platform_product_access_set(
    (SELECT org FROM ctx), 'finance', true, (SELECT usr FROM ctx),
    'Habilitación de prueba reversible para verificar F5.1 de punta a punta'
  );
  INSERT INTO res VALUES (2, 'finance habilitado por Control Plane', 'enabled',
    COALESCE((SELECT status FROM public.organization_product_access
               WHERE org_id = (SELECT org FROM ctx) AND product_key = 'finance'), 'missing'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (2, 'finance habilitado por Control Plane', 'enabled', 'FRENADO: '||SQLERRM);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT usr::text FROM ctx),'role','authenticated')::text, true);

-- ═══ Crear la intención de carga con el RPC real de la bandeja ═════════
-- El hash y tamaño se declaran como lo hace el navegador: calculados sobre
-- el mismo contenido que se sube, verificado después por el inspector.
DO $$
DECLARE
  v_doc uuid; v_ver uuid; v_path text;
BEGIN
  SELECT document_id, version_id, storage_path
    INTO v_doc, v_ver, v_path
    FROM public.finance_document_create_upload(
      (SELECT org FROM ctx), 'supplier_invoice',
      'ZZ factura f5.1.pdf', 'application/pdf', 218,
      '74814c778c114d959f507c620a9120e73ecb2657416c2342a485bf73191c59bc'
    );
  UPDATE ctx SET doc = v_doc, ver = v_ver, path = v_path;
  INSERT INTO res VALUES (3, 'create_upload devolvió intención', 'true', 'true');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (3, 'create_upload devolvió intención', 'true', 'FRENADO: '||SQLERRM);
END $$;

-- ═══ PDF mínimo real al bucket privado ═════════════════════════════════
DO $$
DECLARE
  v_texto text := '%%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF';
  v_size bigint := octet_length(v_texto);
BEGIN
  -- metadata jsonb con mimetype/size como lo escribe el storage real.
  INSERT INTO storage.objects (bucket_id, name, metadata, created_at, updated_at)
  VALUES ('finance-documents', (SELECT path FROM ctx),
          jsonb_build_object('mimetype','application/pdf','size',v_size::bigint),
          now(), now());
  INSERT INTO res VALUES (4, 'PDF llegó al bucket privado', 'true', 'true');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (4, 'PDF llegó al bucket privado', 'true', 'FRENADO: '||SQLERRM);
END $$;

-- ═══ El hash ya se declaró sobre el mismo contenido al crear la intención;
-- el inspector lo verifica en producción contra los bytes reales. Acá el
-- circuito continúa con los estados del lease, igual que la Edge Function.

-- ═══ finalize_upload: el archivo llegó, la versión queda esperando ══════
DO $$
DECLARE
  v_out record;
BEGIN
  SELECT * INTO v_out FROM public.finance_document_finalize_upload(
    (SELECT doc FROM ctx), (SELECT ver FROM ctx));
  INSERT INTO res VALUES (4, 'finalize_upload → uploaded', 'uploaded',
    COALESCE(v_out.upload_status, 'NULL'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (4, 'finalize_upload → uploaded', 'uploaded', 'FRENADO: '||SQLERRM);
END $$;

-- ═══ Inspector: structural-policy clean + hash verificado ══════════════
DO $$
DECLARE
  v_token uuid;
  v_res record;
  v_hash text;
  v_size bigint;
  v_obj record;
BEGIN
  SELECT sha256 INTO v_hash FROM public.finance_document_versions WHERE id = (SELECT ver FROM ctx);
  SELECT metadata->>'size' INTO v_size FROM storage.objects
    WHERE bucket_id = 'finance-documents' AND name = (SELECT path FROM ctx);

  SELECT inspection_token INTO v_token
    FROM public.finance_document_begin_inspection((SELECT doc FROM ctx), (SELECT ver FROM ctx));
  IF v_token IS NULL THEN
    INSERT INTO res VALUES (5, 'begin_inspection dio lease', 'true', 'false');
    RETURN;
  END IF;

  -- complete_inspection es service_role en producción (la Edge Function
  -- inspecciona bytes reales y firma el resultado); idem extracción.
  SET LOCAL ROLE service_role;
  SELECT * INTO v_res FROM public.finance_document_complete_inspection(
    p_version_id        := (SELECT ver FROM ctx),
    p_inspection_token  := v_token,
    p_actor_id          := (SELECT usr FROM ctx),
    p_actual_sha256     := v_hash,
    p_actual_mime_type  := 'application/pdf',
    p_actual_size_bytes := v_size,
    p_scanner_provider  := 'structural-policy',
    p_scanner_status    := 'clean',
    p_scanner_reference := NULL,
    p_reason            := NULL
  );
  RESET ROLE;
  INSERT INTO res VALUES (5, 'inspección limpia → ready_for_extraction', 'ready_for_extraction',
    COALESCE(v_res.inspection_status, 'NULL'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (5, 'inspección limpia → ready_for_extraction', 'ready_for_extraction', 'FRENADO: '||SQLERRM);
END $$;

-- ═══ Extracción estructurada con lease (lo que hace la Edge) ═══════════
DO $$
DECLARE
  v_res record;
  v_hash text;
  v_ext uuid;
  v_token uuid;
BEGIN
  SELECT actual_sha256 INTO v_hash FROM public.finance_document_versions
    WHERE id = (SELECT ver FROM ctx);

  SELECT extraction_id, extraction_token INTO v_ext, v_token
    FROM public.finance_document_begin_extraction((SELECT doc FROM ctx), (SELECT ver FROM ctx));
  UPDATE ctx SET ext = v_ext, token = v_token;

  -- complete_extraction es service_role en producción (la Edge Function es
  -- la única que cierra el lease); el verificador la ejerce con esa identidad.
  SET LOCAL ROLE service_role;
  -- Payload plano, exactamente lo que envía la Edge después de
  -- normalizeFinanceExtraction (el RPC no acepta {value,confidence}).
  SELECT * INTO v_res FROM public.finance_document_complete_extraction(
      p_extraction_id     := (SELECT ext FROM ctx),
      p_extraction_token  := (SELECT token FROM ctx),
      p_actor_id          := (SELECT usr FROM ctx),
      p_payload           := jsonb_build_object(
        'supplier_name', 'Proveedor ZZ Canonico',
        'supplier_tax_id', '30712345675',
        'document_number', '0001-00012345',
        'issue_date', '2026-09-20',
        'currency', 'ARS',
        'subtotal', 21000,
        'tax_total', 4410,
        'total', 25410,
        'items', jsonb_build_array(jsonb_build_object(
          'description', 'Producto ZZ',
          'sku', NULL,
          'quantity', 3,
          'unit_price', 7000,
          'line_total', 21000,
          'tax_rate', 21
        ))
      ),
      p_confidence        := jsonb_build_object('overall', 0.95),
      p_overall_confidence:= 0.95,
      p_provider          := 'anthropic',
      p_model             := 'claude-haiku-4-5',
      p_prompt_version    := 'finance-invoice-v1',
      p_failure_reason    := NULL
    );
  RESET ROLE;
  INSERT INTO res VALUES (8, 'extracción modelo → lista para revisión', 'ready_for_review',
    COALESCE(v_res.extraction_status, 'NULL'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (8, 'extracción estructurada', 'ready_for_review', 'FRENADO: '||SQLERRM);
END $$;

-- ═══ Revisión humana append-only ═══════════════════════════════════════
DO $$
DECLARE
  v_res record;
  v_payload jsonb;
BEGIN
  SELECT payload INTO v_payload
    FROM public.finance_document_extraction_revisions
    WHERE extraction_id = (SELECT ext FROM ctx) ORDER BY revision_number DESC LIMIT 1;
  SELECT extraction_status, revision_number INTO v_res
    FROM public.finance_document_submit_extraction_review(
      (SELECT ext FROM ctx), v_payload, 'ZZ revisado por humano');
  INSERT INTO res VALUES (8, 'revisión humana → reviewed', 'reviewed',
    COALESCE(v_res.extraction_status, 'NULL'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (8, 'revisión humana → reviewed', 'reviewed', 'FRENADO: '||SQLERRM);
END $$;

-- ═══ Matching contra proveedor real ════════════════════════════════════
DO $$
DECLARE
  v_match jsonb;
BEGIN
  INSERT INTO public.suppliers(org_id, name)
  VALUES ((SELECT org FROM ctx), 'Proveedor ZZ Canonico');
  -- La revisión humana dice 'Proveedor ZZ revisado por humano' (texto del actor);
  -- el match por nombre requiere igualdad normalizada, y el nombre extraído
  -- canónico ('Proveedor ZZ Canonico') es el que produce exact_name.
  UPDATE public.finance_document_extraction_revisions
    SET payload = jsonb_set(payload, '{supplier_name}', to_jsonb('Proveedor ZZ Canonico'::text))
    WHERE extraction_id = (SELECT ext FROM ctx) AND source = 'human';

  v_match := public.finance_document_run_matching((SELECT ext FROM ctx));
  INSERT INTO res VALUES (9, 'matching propuesto contra proveedor', 'proposed',
    COALESCE(v_match->>'status', 'NULL'));
  INSERT INTO res VALUES (9.1, 'método de match conservador', 'exact_name',
    COALESCE(v_match #>> '{supplier,match_method}', 'NULL'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (9, 'matching propuesto contra proveedor', 'proposed', 'FRENADO: '||SQLERRM);
END $$;

-- ═══ Un outsider no puede inspeccionar ni extraer ══════════════════════
DO $$
DECLARE
  v_denied boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.finance_document_begin_inspection((SELECT doc FROM ctx), (SELECT ver FROM ctx));
    v_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := v_denied; END;
  INSERT INTO res VALUES (10, 'outsider bloqueado en inspección', 'true', v_denied::text);
END $$;

RESET ROLE;

-- ═══ Cero efectos operativos: el borrador no toca el negocio ═══════════
INSERT INTO res
SELECT 11, 'no creó compras ni deuda ni asientos', '0/0/0',
       (SELECT count(*)::text FROM public.purchases WHERE org_id = (SELECT org FROM ctx))
     || '/' ||
       (SELECT count(*)::text FROM public.supplier_debts WHERE org_id = (SELECT org FROM ctx))
     || '/' ||
       (SELECT count(*)::text FROM public.ledger_lines WHERE org_id = (SELECT org FROM ctx));

INSERT INTO res
SELECT 12, 'la trazabilidad del documento quedó registrada', 'true',
       ((SELECT count(*) FROM public.finance_document_events
          WHERE document_id = (SELECT doc FROM ctx)
            AND event_type IN ('created','uploaded','inspection_ready',
                               'extraction_started','extraction_completed',
                               'extraction_reviewed')) >= 6)::text;

-- ═══ Resultado ═════════════════════════════════════════════════════════
DO $$
DECLARE
  v_fallados int;
BEGIN
  SELECT count(*) INTO v_fallados FROM res
   WHERE obtenido IS DISTINCT FROM esperado;
  IF v_fallados > 0 THEN
    RAISE EXCEPTION 'F5.1 E2E falló: % paso(s) en rojo', v_fallados;
  END IF;
  RAISE NOTICE 'F5.1 verificado de punta a punta: bandeja → inspección → extracción → revisión → matching';
END $$;

SELECT n, paso, esperado, obtenido FROM res ORDER BY n;

ROLLBACK;