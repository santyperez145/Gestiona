-- ═══════════════════════════════════════════════════════════════════════════
-- El demo del onboarding es del rubro que eligió el comercio
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Quien elegía «Todavía quiero explorar» en el onboarding recibía, fuera cual
-- fuera su rubro, BACCARAT ROUGE 540, GOOD GIRL y SAUVAGE EDP, con costo en
-- dólares y «aduana», y un intento de renombrar la tienda a «Mi Perfumería».
-- Era lo primero que veía una ferretería. Medido en `seed_demo_data` viva el
-- 2026-10-10; la base tiene 8.837 productos y 54 perfumes.
--
-- Ahora el demo lee el rubro de `organization_business_profiles` (lo fija
-- `configure_business_profile` antes de sembrar) y carga tres productos
-- típicos de ese rubro, tres ventas, un saldo pendiente y un cliente. Costos
-- en pesos (`cost_ars`), sin aduana. Los rubros que no se stockean —servicios,
-- platos— cargan productos con `maneja_stock = false`. Sin rubro, un surtido
-- general.
--
-- No toca la configuración del negocio: el nombre ya lo eligió el comercio.
-- Misma firma, mismos grants (sólo service_role, vía la edge function).
-- Idempotente; reversible reaplicando la versión anterior.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Tres productos por rubro: nombre, marca, categoría, costo, precio, stock
  -- y si lleva stock. Precios de referencia en pesos, redondos.
  v_catalogo constant jsonb := $catalogo${
    "alimentos": [
      {"n": "Yerba mate 1 kg", "m": null, "c": "almacen", "costo": 2800, "precio": 4200, "stock": 40, "s": true},
      {"n": "Aceite de girasol 1,5 L", "m": null, "c": "almacen", "costo": 2400, "precio": 3600, "stock": 30, "s": true},
      {"n": "Galletitas surtidas 400 g", "m": null, "c": "almacen", "costo": 900, "precio": 1500, "stock": 60, "s": true}],
    "indumentaria": [
      {"n": "Remera básica de algodón", "m": null, "c": "remeras", "costo": 6000, "precio": 12000, "stock": 25, "s": true},
      {"n": "Jean recto", "m": null, "c": "pantalones", "costo": 14000, "precio": 28000, "stock": 15, "s": true},
      {"n": "Buzo con capucha", "m": null, "c": "buzos", "costo": 12000, "precio": 24000, "stock": 10, "s": true}],
    "ferreteria": [
      {"n": "Taladro percutor 13 mm 750 W", "m": null, "c": "herramientas", "costo": 45000, "precio": 72000, "stock": 4, "s": true},
      {"n": "Tornillo autoperforante 8 x 1\" (caja x100)", "m": null, "c": "buloneria", "costo": 2500, "precio": 4500, "stock": 50, "s": true},
      {"n": "Cinta métrica 5 m", "m": null, "c": "herramientas", "costo": 3000, "precio": 5500, "stock": 20, "s": true}],
    "tecnologia": [
      {"n": "Auriculares inalámbricos", "m": null, "c": "audio", "costo": 15000, "precio": 28000, "stock": 12, "s": true},
      {"n": "Cargador USB-C 20 W", "m": null, "c": "cargadores", "costo": 5000, "precio": 9500, "stock": 30, "s": true},
      {"n": "Cable USB-C 1 m", "m": null, "c": "cables", "costo": 1500, "precio": 3500, "stock": 45, "s": true}],
    "hogar": [
      {"n": "Juego de sábanas 2 plazas", "m": null, "c": "textil", "costo": 15000, "precio": 29000, "stock": 8, "s": true},
      {"n": "Taza de cerámica 350 ml", "m": null, "c": "bazar", "costo": 1800, "precio": 3900, "stock": 36, "s": true},
      {"n": "Almohadón decorativo", "m": null, "c": "deco", "costo": 4000, "precio": 8500, "stock": 14, "s": true}],
    "cosmetica": [
      {"n": "Crema hidratante facial 50 ml", "m": null, "c": "cuidado-facial", "costo": 6000, "precio": 11500, "stock": 18, "s": true},
      {"n": "Protector solar FPS 50", "m": null, "c": "solares", "costo": 8000, "precio": 14500, "stock": 15, "s": true},
      {"n": "Shampoo 400 ml", "m": null, "c": "capilar", "costo": 2500, "precio": 4800, "stock": 30, "s": true}],
    "gastronomia": [
      {"n": "Milanesa con papas fritas", "m": null, "c": "platos", "costo": 3500, "precio": 9500, "stock": 0, "s": false},
      {"n": "Café con leche", "m": null, "c": "cafeteria", "costo": 900, "precio": 2800, "stock": 0, "s": false},
      {"n": "Agua mineral 500 ml", "m": null, "c": "bebidas", "costo": 400, "precio": 1500, "stock": 48, "s": true}],
    "servicios": [
      {"n": "Visita técnica", "m": null, "c": "servicios", "costo": 0, "precio": 15000, "stock": 0, "s": false},
      {"n": "Hora de trabajo", "m": null, "c": "servicios", "costo": 0, "precio": 12000, "stock": 0, "s": false},
      {"n": "Instalación estándar", "m": null, "c": "servicios", "costo": 2000, "precio": 25000, "stock": 0, "s": false}],
    "libreria": [
      {"n": "Cuaderno universitario 80 hojas", "m": null, "c": "escolar", "costo": 2200, "precio": 4200, "stock": 40, "s": true},
      {"n": "Lapicera azul", "m": null, "c": "escolar", "costo": 300, "precio": 700, "stock": 120, "s": true},
      {"n": "Resma A4 500 hojas", "m": null, "c": "oficina", "costo": 5500, "precio": 9500, "stock": 20, "s": true}],
    "mascotas": [
      {"n": "Alimento para perro adulto 15 kg", "m": null, "c": "alimento", "costo": 32000, "precio": 48000, "stock": 10, "s": true},
      {"n": "Arena sanitaria 4 kg", "m": null, "c": "higiene", "costo": 3000, "precio": 5500, "stock": 25, "s": true},
      {"n": "Correa regulable", "m": null, "c": "accesorios", "costo": 3500, "precio": 7500, "stock": 15, "s": true}],
    "deportes": [
      {"n": "Pelota de fútbol N.º 5", "m": null, "c": "futbol", "costo": 12000, "precio": 22000, "stock": 12, "s": true},
      {"n": "Botella térmica 750 ml", "m": null, "c": "accesorios", "costo": 7000, "precio": 13500, "stock": 20, "s": true},
      {"n": "Colchoneta de yoga", "m": null, "c": "fitness", "costo": 9000, "precio": 17000, "stock": 10, "s": true}],
    "jugueteria": [
      {"n": "Rompecabezas 500 piezas", "m": null, "c": "juegos", "costo": 5000, "precio": 9800, "stock": 15, "s": true},
      {"n": "Auto a fricción", "m": null, "c": "vehiculos", "costo": 2500, "precio": 5500, "stock": 30, "s": true},
      {"n": "Juego de mesa familiar", "m": null, "c": "juegos", "costo": 9000, "precio": 17500, "stock": 8, "s": true}],
    "autopartes": [
      {"n": "Filtro de aceite", "m": null, "c": "filtros", "costo": 4500, "precio": 8500, "stock": 20, "s": true},
      {"n": "Lámpara H4 12 V", "m": null, "c": "electrico", "costo": 2500, "precio": 5200, "stock": 30, "s": true},
      {"n": "Escobillas limpiaparabrisas (par)", "m": null, "c": "accesorios", "costo": 6000, "precio": 11500, "stock": 12, "s": true}],
    "perfumes": [
      {"n": "Eau de parfum floral 100 ml", "m": null, "c": "fragancias", "costo": 30000, "precio": 52000, "stock": 6, "s": true},
      {"n": "Eau de parfum amaderado 100 ml", "m": null, "c": "fragancias", "costo": 32000, "precio": 56000, "stock": 5, "s": true},
      {"n": "Body splash 250 ml", "m": null, "c": "corporal", "costo": 6000, "precio": 11000, "stock": 20, "s": true}],
    "vapers": [
      {"n": "Vaper descartable 5000 puffs", "m": null, "c": "descartables", "costo": 6000, "precio": 11000, "stock": 25, "s": true},
      {"n": "Líquido 30 ml", "m": null, "c": "liquidos", "costo": 3000, "precio": 6500, "stock": 30, "s": true},
      {"n": "Resistencia de repuesto", "m": null, "c": "repuestos", "costo": 1500, "precio": 3500, "stock": 40, "s": true}],
    "otro": [
      {"n": "Linterna LED recargable", "m": null, "c": "general", "costo": 5000, "precio": 9500, "stock": 15, "s": true},
      {"n": "Pilas AA (pack x4)", "m": null, "c": "general", "costo": 1800, "precio": 3600, "stock": 40, "s": true},
      {"n": "Caja organizadora", "m": null, "c": "general", "costo": 3500, "precio": 6900, "stock": 20, "s": true}]
  }$catalogo$::jsonb;
  v_rubro text;
  v_items jsonb;
  v_item  jsonb;
  v_ids   uuid[] := '{}';
  v_id    uuid;
  v_sale  uuid;
  v_precio numeric;
  v_costo  numeric;
  v_today date := current_date;
  i int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE org_id = p_org_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org already has products');
  END IF;

  SELECT obp.industry_code INTO v_rubro
    FROM public.organization_business_profiles obp WHERE obp.org_id = p_org_id;
  v_items := COALESCE(v_catalogo -> v_rubro, v_catalogo -> 'otro');

  FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
    v_item := v_items -> i;
    v_costo := (v_item ->> 'costo')::numeric;
    v_precio := (v_item ->> 'precio')::numeric;
    INSERT INTO public.products (
      org_id, user_id, name, brand, category, cost_usd, customs_fee, total_cost_usd,
      cost_ars, cost_currency, sale_price_ars, profit_per_unit_ars, profit_per_unit_usd,
      stock, maneja_stock, featured)
    VALUES (
      p_org_id, p_user_id, v_item ->> 'n', COALESCE(v_item ->> 'm', ''), v_item ->> 'c', 0, 0, 0,
      v_costo, 'ARS', v_precio, v_precio - v_costo, 0,
      (v_item ->> 'stock')::int, (v_item ->> 's')::boolean, i = 0)
    RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  -- Tres ventas de los últimos días; la última, fiada.
  FOR i IN 1 .. 3 LOOP
    v_item := v_items -> (i - 1);
    v_costo := (v_item ->> 'costo')::numeric;
    v_precio := (v_item ->> 'precio')::numeric;
    v_sale := gen_random_uuid();
    INSERT INTO public.sales (
      id, org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars,
      cost_per_unit_usd, cost_of_goods_ars, profit_ars, profit_usd, customer_name, date, paid, payment_method)
    VALUES (
      v_sale, p_org_id, p_user_id, v_ids[i], v_item ->> 'n', CASE WHEN i = 2 THEN 2 ELSE 1 END,
      v_precio, v_precio * CASE WHEN i = 2 THEN 2 ELSE 1 END,
      0, v_costo * CASE WHEN i = 2 THEN 2 ELSE 1 END, (v_precio - v_costo) * CASE WHEN i = 2 THEN 2 ELSE 1 END, 0,
      (ARRAY['María González', 'Laura Martínez', 'Carlos Pérez'])[i],
      (v_today - (3 - i))::timestamptz, i <> 3, (ARRAY['transferencia', 'efectivo', 'transferencia'])[i]);
    IF i = 3 THEN
      INSERT INTO public.debts (org_id, user_id, sale_id, customer_name, amount_ars, paid_ars, remaining_ars, status, description)
      VALUES (p_org_id, p_user_id, v_sale, 'Carlos Pérez', v_precio, 0, v_precio, 'pending', (v_item ->> 'n') || ' — pago pendiente');
    END IF;
  END LOOP;

  INSERT INTO public.customers (org_id, user_id, name, phone, tags, notes)
  VALUES (p_org_id, p_user_id, 'María González', '+54 9 11 1234-5678', ARRAY['Frecuente'], 'Cliente de ejemplo: borralo cuando cargues los tuyos.')
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'rubro', COALESCE(v_rubro, 'otro'), 'products', jsonb_array_length(v_items), 'sales', 3);
END;
$function$;

REVOKE ALL ON FUNCTION public.seed_demo_data(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, uuid) TO service_role;
