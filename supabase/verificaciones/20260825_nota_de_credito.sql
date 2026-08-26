CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
GRANT ALL ON r TO authenticated;
CREATE TEMP TABLE inv_antes AS SELECT id FROM public.invoices;

DO $blk$
DECLARE
  v_org uuid; v_dueno uuid; v_f uuid; v_nc uuid; v_nc2 uuid;
  v_txt text; v_n int; v_num numeric; v_fallo text;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);

  -- Una factura ZZ "autorizada": con CAE, como si ARCA ya la hubiera aceptado.
  INSERT INTO public.invoices (
    org_id, number, customer_name, issue_date, status, currency,
    subtotal, tax_pct, tax_amount, total, tipo_comprobante,
    condicion_iva_receptor, cae, cae_vencimiento, numero_afip, afip_status)
  VALUES (
    v_org, 'ZZ-NC-TEST', 'ZZ Cliente', CURRENT_DATE, 'sent', 'ARS',
    8264.46, 21, 1735.54, 10000, 1, 1, 'ZZ99999999999999',
    CURRENT_DATE + 10, 99999, 'authorized')
  RETURNING id INTO v_f;

  -- ── 1. ⚠️ Una factura con CAE no se edita ───────────────────────────────
  v_fallo := NULL;
  BEGIN
    UPDATE public.invoices SET total = 1 WHERE id = v_f;
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (1,'no se puede cambiar el total de una factura con CAE',
    COALESCE(left(v_fallo,50),'ACEPTO'), v_fallo IS NOT NULL);

  v_fallo := NULL;
  BEGIN
    UPDATE public.invoices SET customer_tax_id = '20111111112' WHERE id = v_f;
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (2,'ni el CUIT del receptor', COALESCE(left(v_fallo,40),'ACEPTO'),
    v_fallo IS NOT NULL);

  -- Pero sí lo que cambia legítimamente después de emitir.
  v_fallo := NULL;
  BEGIN
    UPDATE public.invoices SET status='paid', paid_at=now() WHERE id = v_f;
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (3,'pero SI se puede marcar como cobrada',
    COALESCE(left(v_fallo,40),'ok'), v_fallo IS NULL);

  -- ── 4. Tampoco se borra ─────────────────────────────────────────────────
  v_fallo := NULL;
  BEGIN
    DELETE FROM public.invoices WHERE id = v_f;
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (4,'una factura autorizada no se borra',
    COALESCE(left(v_fallo,40),'BORRO'), v_fallo IS NOT NULL);

  -- ── 5. La nota de credito lleva la misma clase ──────────────────────────
  INSERT INTO r VALUES (5,'Factura A (1) -> Nota de credito A (3)',
    COALESCE(public.tipo_nota_credito(1)::text,'-'), public.tipo_nota_credito(1) = 3);
  INSERT INTO r VALUES (6,'Factura B (6) -> NC B (8), C (11) -> NC C (13)',
    public.tipo_nota_credito(6)||'/'||public.tipo_nota_credito(11),
    public.tipo_nota_credito(6) = 8 AND public.tipo_nota_credito(11) = 13);

  -- ── 7. Emitir una NC parcial ────────────────────────────────────────────
  v_nc := public.emitir_nota_credito(v_f, 'ZZ devolucion parcial', 4000);
  SELECT tipo_comprobante INTO v_n FROM public.invoices WHERE id = v_nc;
  INSERT INTO r VALUES (7,'la NC de una Factura A sale tipo 3', v_n::text, v_n = 3);

  SELECT total, tax_amount INTO v_num, v_n FROM public.invoices WHERE id = v_nc;
  INSERT INTO r VALUES (8,'con el importe pedido', v_num::text, v_num = 4000);

  -- ⚠️ El IVA se prorratea: 4000/10000 del IVA original (1735,54) = 694,22.
  SELECT tax_amount INTO v_num FROM public.invoices WHERE id = v_nc;
  INSERT INTO r VALUES (9,'y el IVA prorrateado, no el total', v_num::text,
    v_num = ROUND(1735.54 * 4000 / 10000, 2));

  -- ── 10. No se puede acreditar mas que el total ──────────────────────────
  v_fallo := NULL;
  BEGIN
    PERFORM public.emitir_nota_credito(v_f, 'ZZ excede', 7000);
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (10,'4000 + 7000 sobre una factura de 10000 se rechaza',
    COALESCE(left(v_fallo,45),'ACEPTO'), v_fallo IS NOT NULL);

  -- Pero el saldo exacto si.
  v_nc2 := public.emitir_nota_credito(v_f, 'ZZ resto');
  SELECT total INTO v_num FROM public.invoices WHERE id = v_nc2;
  INSERT INTO r VALUES (11,'el saldo exacto (6000) se acredita', v_num::text, v_num = 6000);

  -- Y una tercera ya no.
  v_fallo := NULL;
  BEGIN
    PERFORM public.emitir_nota_credito(v_f, 'ZZ tercera');
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (12,'agotado el saldo, no hay mas notas',
    COALESCE(left(v_fallo,45),'ACEPTO'), v_fallo IS NOT NULL);

  -- ── 13. Sin motivo no se emite ──────────────────────────────────────────
  v_fallo := NULL;
  BEGIN
    PERFORM public.emitir_nota_credito(v_f, '   ');
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (13,'una NC sin motivo se rechaza',
    COALESCE(left(v_fallo,40),'ACEPTO'), v_fallo IS NOT NULL);

  -- ── 14. Una NC no se corrige con otra NC ────────────────────────────────
  v_fallo := NULL;
  BEGIN
    PERFORM public.emitir_nota_credito(v_nc, 'ZZ sobre una NC');
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (14,'no se emite una NC sobre otra NC',
    COALESCE(left(v_fallo,45),'ACEPTO'), v_fallo IS NOT NULL);

  -- ── 15. Un ajeno no emite notas de credito ──────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  v_fallo := NULL;
  BEGIN
    PERFORM public.emitir_nota_credito(v_f, 'ZZ hackeo');
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  INSERT INTO r VALUES (15,'un ajeno no puede emitir una nota de credito',
    COALESCE(left(v_fallo,40),'ACEPTO'), v_fallo IS NOT NULL);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);

  -- ── 16. La vista de saldos ──────────────────────────────────────────────
  SELECT saldo INTO v_num FROM public.facturas_con_nota_credito WHERE factura_id = v_f;
  INSERT INTO r VALUES (16,'la vista muestra saldo cero', COALESCE(v_num::text,'-'), v_num = 0);

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ── Limpieza ────────────────────────────────────────────────────────────
  ALTER TABLE public.invoices DISABLE TRIGGER trg_factura_autorizada_no_se_borra;
  ALTER TABLE public.domain_events DISABLE TRIGGER trg_domain_events_inmutable;
  DELETE FROM public.outbox_events WHERE event_id IN
    (SELECT id FROM public.domain_events WHERE aggregate_id IN (v_f, v_nc, v_nc2));
  DELETE FROM public.domain_events WHERE aggregate_id IN (v_f, v_nc, v_nc2);
  ALTER TABLE public.domain_events ENABLE TRIGGER trg_domain_events_inmutable;
  DELETE FROM public.invoices WHERE nota_credito_de = v_f;
  DELETE FROM public.invoices WHERE id = v_f;
  ALTER TABLE public.invoices ENABLE TRIGGER trg_factura_autorizada_no_se_borra;
END $blk$;

INSERT INTO r
SELECT 17, 'restos',
  (SELECT count(*) FROM public.invoices WHERE id NOT IN (SELECT id FROM inv_antes))::text || ' restos',
  (SELECT count(*) FROM public.invoices WHERE id NOT IN (SELECT id FROM inv_antes)) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
