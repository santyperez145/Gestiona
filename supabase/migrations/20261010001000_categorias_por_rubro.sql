-- Categorías según el rubro del comercio.
--
-- Medido 2026-10-10 en «Ferreteria Famatina»: 6.846 productos en «otro» y el
-- resto en categorías importadas escritas de diez maneras («PINTURERIA»,
-- «Herramientaselectricas», «Cerradurasycandados»). El comercio había elegido
-- «otro» como rubro porque la ferretería no existía todavía, y la ficha le
-- seguía pidiendo género y mililitros.
--
-- * rubro_reglas_categoria: reglas por rubro (datos, no código). Cada regla
--   lleva una expresión sobre el texto normalizado (minúsculas, sin tildes,
--   sólo letras y números) y se evalúa por prioridad; la primera gana.
--   `sobre = 'categoria'` reconoce una categoría importada y la unifica;
--   `sobre = 'nombre'` clasifica por el nombre del producto.
-- * categorizar_productos(org, aplicar): sin aplicar devuelve la vista previa
--   (cuántos van a cada categoría, con ejemplos); al aplicar crea las
--   categorías que falten, cambia los productos y anota cada cambio en
--   categorizacion_cambios para poder deshacerlo (deshacer_categorizacion).
-- * Una categoría propia que no se reconoce se respeta; un producto sin
--   categoría útil y sin regla para su nombre va a «Varios», no a «otro».
-- * trg_products_categoria_por_rubro aplica lo mismo en cada alta: una
--   importación entra ya categorizada.

CREATE TABLE IF NOT EXISTS public.rubro_reglas_categoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  industry_code text NOT NULL,
  categoria_slug text NOT NULL CHECK (categoria_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  categoria_nombre text NOT NULL,
  sobre text NOT NULL CHECK (sobre IN ('categoria', 'nombre')),
  patron text NOT NULL,
  prioridad integer NOT NULL,
  UNIQUE (industry_code, sobre, categoria_slug, patron)
);

ALTER TABLE public.rubro_reglas_categoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reglas de categorías visibles" ON public.rubro_reglas_categoria;
CREATE POLICY "Reglas de categorías visibles" ON public.rubro_reglas_categoria FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.rubro_reglas_categoria FROM PUBLIC, anon;
GRANT SELECT ON public.rubro_reglas_categoria TO authenticated;
GRANT ALL ON public.rubro_reglas_categoria TO service_role;

CREATE TABLE IF NOT EXISTS public.categorizacion_cambios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  anterior text,
  nueva text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categorizacion_cambios_lote ON public.categorizacion_cambios(org_id, lote_id);

ALTER TABLE public.categorizacion_cambios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Miembros ven cambios de categorías" ON public.categorizacion_cambios;
CREATE POLICY "Miembros ven cambios de categorías" ON public.categorizacion_cambios FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.categorizacion_cambios FROM PUBLIC, anon;
GRANT SELECT ON public.categorizacion_cambios TO authenticated;
GRANT ALL ON public.categorizacion_cambios TO service_role;

-- Texto comparable: minúsculas, sin tildes, separadores como un espacio.
CREATE OR REPLACE FUNCTION public.texto_catalogo(p text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT btrim(regexp_replace(lower(unaccent(COALESCE(p, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

-- ── Ferretería ─────────────────────────────────────────────────────────────
DELETE FROM public.rubro_reglas_categoria WHERE industry_code = 'ferreteria';
INSERT INTO public.rubro_reglas_categoria (industry_code, categoria_slug, categoria_nombre, sobre, patron, prioridad) VALUES
  -- Categorías importadas que ya decían qué eran.
  ('ferreteria', 'herramientas-electricas', 'Herramientas eléctricas', 'categoria', '^(herramientas ?electricas|maquinas ?electricas|herramienta electrica)$', 1),
  ('ferreteria', 'herramientas-manuales', 'Herramientas manuales', 'categoria', '^(herramientas ?manuales|herramientas)$', 1),
  ('ferreteria', 'soldadura', 'Soldadura', 'categoria', '^(electrodos|soldadura|insumos soldadura)$', 1),
  ('ferreteria', 'discos-y-abrasivos', 'Discos y abrasivos', 'categoria', '^(abrasivos|discos)$', 1),
  ('ferreteria', 'pintureria', 'Pinturería', 'categoria', '^(pintureria|pinturas?)$', 1),
  ('ferreteria', 'electricidad', 'Electricidad', 'categoria', '^(electricidad|iluminacion)$', 1),
  ('ferreteria', 'plomeria-y-sanitarios', 'Plomería y sanitarios', 'categoria', '^(plomeria|canos|sanitarios|griferia)$', 1),
  ('ferreteria', 'buloneria-y-fijaciones', 'Bulonería y fijaciones', 'categoria', '^(buloneria|grampas|tornilleria|fijaciones)$', 1),
  ('ferreteria', 'cerrajeria-y-herrajes', 'Cerrajería y herrajes', 'categoria', '^(herrajes|bisagras|cerraduras ?y ?candados|cerrajeria|mensulas|regatones y plasticos|carpinteria y muebleria)$', 1),
  ('ferreteria', 'herreria-y-aberturas', 'Herrería y aberturas', 'categoria', '^(herreria|accesorios ?rejas|portones|cortinas?|motores)$', 1),
  ('ferreteria', 'adhesivos-y-cintas', 'Adhesivos y cintas', 'categoria', '^(adhesivos|cintas)$', 1),
  ('ferreteria', 'seguridad', 'Seguridad e indumentaria de trabajo', 'categoria', '^(seguridad|indumentaria)$', 1),
  ('ferreteria', 'jardin-y-riego', 'Jardín y riego', 'categoria', '^(jardineria|jardin|riego)$', 1),
  ('ferreteria', 'gas-y-camping', 'Gas y camping', 'categoria', '^(camping|gas|calefaccion)$', 1),
  ('ferreteria', 'construccion', 'Construcción y albañilería', 'categoria', '^(albanileria|construccion|techista|zingueria|alambres)$', 1),

  -- Por nombre: lo más específico primero.
  ('ferreteria', 'soldadura', 'Soldadura', 'nombre', '\m(electrodos?|soldador[a]?|alambre (de soldar|mig|flux|tig|duca)|mig|careta sold\w*|mascara (de )?soldar|varilla de aporte|fundente|estano)\M', 10),
  ('ferreteria', 'herramientas-electricas', 'Herramientas eléctricas', 'nombre', '\m(einhell|dremel|taladro|amoladora|motosierra|bordeadora|ingletadora|compresor|sierra circular|router|lijadora|hidrolavadora|atornillador|rotomartillo|demoledor|caladora|pistola (de )?calor|inalamb\w*|bateria \d+ ?v|cargador|neumatic\w*|caloventor)\M', 20),
  ('ferreteria', 'cajas-y-organizacion', 'Cajas y organización', 'nombre', '\m(caja (de )?herramientas|caja (gardex|plast\w*)|cartucheras?|cajon plegable|organizador|maletin|e case|bolso (porta )?herramientas|bolso bosch|exhibidor|carro (plegable|\d+ ruedas))\M', 25),
  ('ferreteria', 'electricidad', 'Electricidad', 'nombre', '\m(cables?|lamparas?|jeluz|fichas? electrica|tomas?(corriente)?|tecla|interruptor|corrugado|cinta aisladora|aisladora|buscapolo|clips?|enchufe|prolongador|portalampara|disyuntor|termica|pasacable|floron|led|tablero|caja de luz)\M', 30),
  ('ferreteria', 'pintureria', 'Pinturería', 'nombre', '\m(aerosol|latex|esmalte|pinturas?|lasur|barniz|brocha|rodillo|diluyente|dilurras|thinner|aguarras|fijador|enduido|enmasc\w*|acrilico|acrlico|impermeabilizante|antioxido|convertidor|pincel|sellador|latizador|bandeja (para )?pintor)\M', 35),
  ('ferreteria', 'mechas-y-accesorios', 'Mechas, brocas y accesorios', 'nombre', '\m(mechas?|brocas?|broc|fresa|hojas? (de )?(calar|sierra)|sierras? copa|insertos?|puntas?|boquillas? magnetica|cincel|barren(o|itos))\M', 40),
  ('ferreteria', 'discos-y-abrasivos', 'Discos y abrasivos', 'nombre', '\m(discos?|lijas?|flap|abrasiv\w*|cepillo (copa|circ\w*|acero|wembley))\M', 42),
  ('ferreteria', 'cerrajeria-y-herrajes', 'Cerrajería y herrajes', 'nombre', '\m(candados?|cerraduras?|cerrojo|bisagras?|herrajes?|picaporte|manijas?|corredera|portacandado|pasador|pomo|tirador|cierrapuertas|burletes?|burl|zocalo|fieltro|regaton|percha|persiana)\M', 45),
  ('ferreteria', 'jardin-y-riego', 'Jardín y riego', 'nombre', '\m(azada|palas?|rastrillo|escardillo|manguera|riego|barrehojas|podadora|poda|cortadora (de )?cesped|cortacesped|pileta|regadera|aspersor|maceta|jard)\M', 48),
  ('ferreteria', 'buloneria-y-fijaciones', 'Bulonería y fijaciones', 'nombre', '\m(bulon(es)?|tornillos?|tuercas?|arandelas?|clavos?|tarugos?|fischer|grampas?|remaches?|chaveta|argollas?|pernos?|abrazaderas?|varilla roscada|gancho|autoperforantes?)\M', 50),
  ('ferreteria', 'plomeria-y-sanitarios', 'Plomería y sanitarios', 'nombre', '\m(canos?|codos?|cuplas?|bujes?|curvas?|flexibles?|canillas?|griferia|valvulas?|boya|acoples?|teflon|destapacion|sifon|llave de paso|niple|reduccion|tapon|ips|polimex|polietileno|termofusion|tanque|inodoro|deposito|ducha|mezcladora|rejilla|bomba (de )?agua|ptfe|flotante|inod\w*|destapa\w*|presurizadora|cubrejunta|bomba \w* centrifuga)\M', 55),
  ('ferreteria', 'adhesivos-y-cintas', 'Adhesivos y cintas', 'nombre', '\m(adhesivos?|cola vinilica|colas?|siliconas?|poxi\w*|fana|pegamento|cianoacrilato|epoxi|masilla|barras? adh|autoadhesivo|abrojo|cianoacr\w*|epoxy|superpox|espuma de poliuretano|poliuretano|bifaz|cinta (adhesiva|doble faz|embal\w*|empaque|multiuso|adelbras|con aluminio|antidesl\w*)|ductb? tape|film (stretch|pvc))\M', 60),
  ('ferreteria', 'cadenas-y-elevacion', 'Cadenas, eslingas y elevación', 'nombre', '\m(aparejo|eslinga|cinta de amarre|cincha|cadenas?|cable de acero|guarda ?cabo|grillete|malacate|tensor|soga|cuerda)\M', 62),
  ('ferreteria', 'seguridad', 'Seguridad e indumentaria de trabajo', 'nombre', '\m(guantes?|anteojos?|antiparras?|proteccion (ocular|auditiva|respiratoria|facial)|protector|casco|barbijo|mascara|botin|chaleco|faja|arnes|delantal\w*|cono senalizacion|cinta (peligro|demarcatoria|pvc tacsa)|libus)\M', 65),
  ('ferreteria', 'lubricantes-y-quimicos', 'Lubricantes y químicos', 'nombre', '\m(grasa|aceites?|aceitex|desoxidante|cauchet|wd 40|lubricante|desengrasante|antihumed\w*)\M', 70),
  ('ferreteria', 'limpieza-y-plagas', 'Limpieza y control de plagas', 'nombre', '\m(escobillon|escoba|secador|baldes?|insecticida|k othrina|hormikill|hormiguicida|raticida|lavandina|detergente|limpiador|estopa|bolsas? de residuos|cepillo barrendero)\M', 72),
  ('ferreteria', 'gas-y-camping', 'Gas y camping', 'nombre', '\m(anafe|cartucho \w* ?gas|garrafa|butano|camping|calentador|farol|carpa|conservadora|fogonero|bolso matero)\M', 74),
  ('ferreteria', 'automotor', 'Automotor', 'nombre', '\m(aut|automotor|vehiculo|parabrisas|opticas|trailer|bidon (para )?combustible|vacuometro|caballete p automovil|camilla \w* mecanico)\M', 76),
  ('ferreteria', 'construccion', 'Construcción y albañilería', 'nombre', '\m(cemento|cal|arena|hierro|malla|ladrillos?|construccion en seco|durlock|placa de yeso|perfil|montante|solera|membrana|aislante|chapa|carretilla|hormigonera|estribos?|escaleras?|alambres?|concertina|alambre de puas|cortadora de ceramicos|cortadora ceramica)\M', 78),
  ('ferreteria', 'herramientas-manuales', 'Herramientas manuales', 'nombre', '\m(destornillador\w*|dest|bocallaves?|boc|llaves?|alicates?|pinzas?|martillos?|formon|cortafrio|barretas?|escuadras?|calibre|cinta metrica|metro|serrucho|arco (de )?sierra|arco|cucharas?|llana|fratacho|espatula|cutter|trincheta|cortaperno|corta ?alambre|corta ?cadena|grinfa|barra de (extension|fuerza)|adaptador|juego de herramientas|limas?|remachadora|dobladora|nivel|plomada|tenaza|morsa|sargento|prensa|crique|engrasadora|inflador|tijeras?|cojinetes?|cabos?|alic|cuchillas?|cuchillo|escofina|sacabocados?|lapiz carpintero|iman|hacha|machete|costilla|alisador|cucharin|comparador|alesometro|inclinometro|tripode|medicion|extractor\w*|cortacano|engramp\w*|atadora|tubos|aplicador|pistola)\M', 80);

-- Categoría que corresponde a un producto según el rubro:
--   1. la categoría que trae, si una regla la reconoce (se unifica);
--   2. si no trae una categoría útil (vacía, «otro», «varios», el rubro
--      mismo), la que diga su nombre, o «Varios»;
--   3. si trae una categoría propia que no se reconoce, se respeta (NULL).
CREATE OR REPLACE FUNCTION public.categoria_sugerida(p_industry text, p_categoria text, p_nombre text)
RETURNS TABLE (slug text, nombre text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cat text := public.texto_catalogo(p_categoria);
  v_nom text := public.texto_catalogo(p_nombre);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.rubro_reglas_categoria r WHERE r.industry_code = p_industry) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.categoria_slug, r.categoria_nombre FROM public.rubro_reglas_categoria r
  WHERE r.industry_code = p_industry AND r.sobre = 'categoria' AND v_cat <> '' AND v_cat ~ r.patron
  ORDER BY r.prioridad, r.id LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  IF v_cat IN ('', 'otro', 'otros', 'varios', 'general', 'multirubro', 'multi rubro', 'sin categoria', public.texto_catalogo(p_industry))
     OR v_cat = 'varios' THEN
    RETURN QUERY
    SELECT r.categoria_slug, r.categoria_nombre FROM public.rubro_reglas_categoria r
    WHERE r.industry_code = p_industry AND r.sobre = 'nombre' AND v_nom ~ r.patron
    ORDER BY r.prioridad, r.id LIMIT 1;
    IF FOUND THEN RETURN; END IF;
    slug := 'varios'; nombre := 'Varios';
    RETURN NEXT;
  END IF;
END;
$$;

-- Alta de producto (carga manual o importación): entra con su categoría
-- unificada o sugerida, y la categoría existe en la tienda.
CREATE OR REPLACE FUNCTION public.trg_products_categoria_por_rubro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rubro text;
  v_slug text;
  v_nombre text;
BEGIN
  SELECT s.industry_code INTO v_rubro FROM public.settings s WHERE s.org_id = NEW.org_id;
  IF v_rubro IS NULL THEN RETURN NEW; END IF;
  SELECT c.slug, c.nombre INTO v_slug, v_nombre FROM public.categoria_sugerida(v_rubro, NEW.category, NEW.name) c;
  IF v_slug IS NULL OR v_slug = NEW.category THEN RETURN NEW; END IF;
  NEW.category := v_slug;
  INSERT INTO public.ecommerce_categories (org_id, store_id, name, slug, sort_order, is_active)
  VALUES (NEW.org_id, NULL, v_nombre, v_slug, 100, true)
  ON CONFLICT (org_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_products_categoria_por_rubro() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_products_categoria_por_rubro ON public.products;
CREATE TRIGGER trg_products_categoria_por_rubro
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_products_categoria_por_rubro();

CREATE OR REPLACE FUNCTION public.categorizar_productos(p_org uuid, p_aplicar boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rubro text;
  v_lote uuid := gen_random_uuid();
  v_resumen jsonb;
  v_total integer;
  v_cambios integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_org_member(p_org, v_actor)
     OR NOT public.has_permission(p_org, 'products', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para editar productos' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT s.industry_code INTO v_rubro FROM public.settings s WHERE s.org_id = p_org;
  IF NOT EXISTS (SELECT 1 FROM public.rubro_reglas_categoria WHERE industry_code = v_rubro) THEN
    RETURN jsonb_build_object('ok', false, 'rubro', v_rubro,
      'error', 'Todavía no hay categorías automáticas para este rubro. Elegí el rubro de tu negocio en Productos › Tipos y atributos.');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _categorizacion (product_id uuid, nombre_producto text, anterior text, slug text, nombre text) ON COMMIT DROP;
  TRUNCATE _categorizacion;
  INSERT INTO _categorizacion
  SELECT p.id, p.name, p.category, s.slug, s.nombre
  FROM public.products p
  CROSS JOIN LATERAL public.categoria_sugerida(v_rubro, p.category, p.name) s
  WHERE p.org_id = p_org AND p.category IS DISTINCT FROM s.slug;

  SELECT count(*) INTO v_total FROM public.products WHERE org_id = p_org;
  SELECT count(*) INTO v_cambios FROM _categorizacion;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'cantidad' DESC), '[]'::jsonb) INTO v_resumen FROM (
    SELECT jsonb_build_object('slug', c.slug, 'nombre', c.nombre, 'cantidad', count(*)::int,
      'ejemplos', (array_agg(c.nombre_producto ORDER BY c.nombre_producto))[1:3]) AS x
    FROM _categorizacion c GROUP BY c.slug, c.nombre
  ) g;

  IF p_aplicar AND v_cambios > 0 THEN
    INSERT INTO public.ecommerce_categories (org_id, store_id, name, slug, sort_order, is_active)
    SELECT DISTINCT ON (c.slug) p_org, NULL, c.nombre, c.slug, 100, true
    FROM _categorizacion c
    ON CONFLICT (org_id, slug) DO NOTHING;

    INSERT INTO public.categorizacion_cambios (lote_id, org_id, product_id, anterior, nueva, actor_id)
    SELECT v_lote, p_org, c.product_id, c.anterior, c.slug, v_actor FROM _categorizacion c;

    UPDATE public.products p SET category = c.slug
    FROM _categorizacion c WHERE p.id = c.product_id AND p.org_id = p_org;
  END IF;

  RETURN jsonb_build_object('ok', true, 'rubro', v_rubro, 'aplicado', p_aplicar AND v_cambios > 0,
    'lote_id', CASE WHEN p_aplicar AND v_cambios > 0 THEN v_lote END,
    'total', v_total, 'cambios', v_cambios,
    'sin_cambio', v_total - v_cambios, 'por_categoria', v_resumen);
END;
$$;

CREATE OR REPLACE FUNCTION public.deshacer_categorizacion(p_org uuid, p_lote uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid())
     OR NOT public.has_permission(p_org, 'products', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para editar productos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Sólo vuelve atrás lo que nadie cambió después.
  UPDATE public.products p SET category = c.anterior
  FROM public.categorizacion_cambios c
  WHERE c.org_id = p_org AND c.lote_id = p_lote AND p.id = c.product_id AND p.category = c.nueva;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.categorizacion_cambios WHERE org_id = p_org AND lote_id = p_lote;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.categorizar_productos(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deshacer_categorizacion(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.categorizar_productos(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deshacer_categorizacion(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.categoria_sugerida(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.texto_catalogo(text) TO authenticated, service_role;
