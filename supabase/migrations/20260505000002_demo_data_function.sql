-- Demo seed function: inserts sample products, sales and a customer for a new org
-- Called from the seed-demo Edge Function or manually via platform admin action.
-- Safe to call multiple times (uses IF NOT EXISTS style inserts).

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prod1 uuid := gen_random_uuid();
  v_prod2 uuid := gen_random_uuid();
  v_prod3 uuid := gen_random_uuid();
  v_sale1 uuid := gen_random_uuid();
  v_sale2 uuid := gen_random_uuid();
  v_sale3 uuid := gen_random_uuid();
  v_today date := current_date;
BEGIN
  -- Guard: skip if org already has products (avoid double-seeding)
  IF EXISTS (SELECT 1 FROM public.products WHERE org_id = p_org_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org already has products');
  END IF;

  -- ── Products ──────────────────────────────────────────────────────────────────
  INSERT INTO public.products (
    id, org_id, user_id, name, brand, category, gender,
    cost_usd, customs_fee, total_cost_usd,
    sale_price_ars, profit_per_unit_ars, profit_per_unit_usd,
    stock, featured
  ) VALUES
    (v_prod1, p_org_id, p_user_id,
     'BACCARAT ROUGE 540', 'MAISON FRANCIS KURKDJIAN', 'perfume_arabe', 'unisex',
     8.50, 1.50, 10.00, 15000, 5000, 3.33, 12, true),
    (v_prod2, p_org_id, p_user_id,
     'GOOD GIRL', 'CAROLINA HERRERA', 'perfume_mujer', 'mujer',
     6.00, 1.00, 7.00, 10500, 3500, 2.33, 8, false),
    (v_prod3, p_org_id, p_user_id,
     'SAUVAGE EDP', 'DIOR', 'perfume_hombre', 'hombre',
     7.50, 1.50, 9.00, 13500, 4500, 3.00, 5, false);

  -- ── Settings (initialize if missing) ─────────────────────────────────────────
  INSERT INTO public.settings (
    org_id, user_id, business_name, usd_rate_blue, low_stock_threshold
  ) VALUES (
    p_org_id, p_user_id, 'Mi Perfumería', 1200, 3
  ) ON CONFLICT (org_id) DO NOTHING;

  -- ── Sales (last 3 days) ───────────────────────────────────────────────────────
  INSERT INTO public.sales (
    id, org_id, user_id, product_id, product_name,
    quantity, unit_price_ars, total_ars,
    cost_per_unit_usd, profit_ars, profit_usd,
    customer_name, date, paid, payment_method
  ) VALUES
    (v_sale1, p_org_id, p_user_id, v_prod1, 'BACCARAT ROUGE 540',
     1, 15000, 15000, 10.00, 5000, 4.17,
     'María González', (v_today - 2)::timestamptz, true, 'transferencia'),
    (v_sale2, p_org_id, p_user_id, v_prod2, 'GOOD GIRL',
     2, 10500, 21000, 7.00, 7000, 5.83,
     'Laura Martínez', (v_today - 1)::timestamptz, true, 'efectivo'),
    (v_sale3, p_org_id, p_user_id, v_prod3, 'SAUVAGE EDP',
     1, 13500, 13500, 9.00, 4500, 3.75,
     'Carlos Pérez', v_today::timestamptz, false, 'transferencia');

  -- ── Debt for unpaid sale ──────────────────────────────────────────────────────
  INSERT INTO public.debts (
    org_id, user_id, sale_id, customer_name,
    amount_ars, paid_ars, remaining_ars, status, description
  ) VALUES (
    p_org_id, p_user_id, v_sale3, 'Carlos Pérez',
    13500, 0, 13500, 'pending', 'SAUVAGE EDP — pago pendiente'
  );

  -- ── Customer profile ──────────────────────────────────────────────────────────
  INSERT INTO public.customers (
    org_id, user_id, name, phone, tags, notes
  ) VALUES (
    p_org_id, p_user_id, 'María González',
    '+54 9 11 1234-5678', ARRAY['VIP', 'Baccarat'], 'Cliente frecuente, regalo habitual'
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'products', 3, 'sales', 3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, uuid) TO authenticated;
