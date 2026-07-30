-- Páginas de contenido de la tienda: "Sobre nosotros", "Preguntas frecuentes",
-- "Cambios y devoluciones", "Términos y condiciones".
--
-- No son un lujo: en Argentina la Ley 24.240 obliga a publicar el régimen de
-- cambios y el botón de arrepentimiento, y MercadoPago pide datos de contacto y
-- políticas visibles antes de aprobar una cuenta de vendedor. Sin estas páginas
-- la tienda no está lista para vender, aunque el checkout funcione.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.store_pages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id)    ON DELETE CASCADE,
  store_id     uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  -- Va en la URL: /tienda/:slug/pagina/:page_slug
  slug         text NOT NULL,
  title        text NOT NULL,
  -- Markdown liviano. Se renderiza con un parser propio y acotado en el
  -- cliente: nada de HTML crudo del comercio, que sería un XSS servido desde
  -- el dominio de la tienda.
  content      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'published'
               CHECK (status IN ('published', 'draft')),
  show_in_footer boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  -- SEO propio; si está vacío se cae al título.
  meta_description text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, slug)
);

CREATE INDEX IF NOT EXISTS store_pages_store_idx
  ON public.store_pages(store_id, status, sort_order);

ALTER TABLE public.store_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_pages_org_select" ON public.store_pages;
CREATE POLICY "store_pages_org_select" ON public.store_pages
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "store_pages_org_write" ON public.store_pages;
CREATE POLICY "store_pages_org_write" ON public.store_pages
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- `updated_at` a mano: el cliente no debería poder mentir sobre cuándo se editó.
CREATE OR REPLACE FUNCTION public.touch_store_page()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_store_page ON public.store_pages;
CREATE TRIGGER trg_touch_store_page
  BEFORE UPDATE ON public.store_pages
  FOR EACH ROW EXECUTE FUNCTION public.touch_store_page();

-- ── Lectura pública ───────────────────────────────────────────────────────
-- Sólo las publicadas de una tienda activa. El comprador es anónimo, así que
-- va por RPC security definer y no por la tabla cruda.
CREATE OR REPLACE FUNCTION public.get_store_pages(p_slug text)
RETURNS TABLE (
  id               uuid,
  slug             text,
  title            text,
  content          text,
  show_in_footer   boolean,
  sort_order       int,
  meta_description text,
  updated_at       timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, p.slug, p.title, p.content, p.show_in_footer, p.sort_order,
         p.meta_description, p.updated_at
  FROM public.store_pages p
  JOIN public.ecommerce_stores s ON s.id = p.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND p.status = 'published'
  ORDER BY p.sort_order, p.title;
$$;

REVOKE ALL  ON FUNCTION public.get_store_pages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_pages(text) TO anon, authenticated;

-- ── Plantillas ────────────────────────────────────────────────────────────
-- Una tienda que arranca con las cuatro páginas vacías es una tienda que las
-- deja vacías. Se siembran con un borrador redactado para Argentina, que el
-- comercio edita en vez de escribir de cero.
CREATE OR REPLACE FUNCTION public.seed_store_pages(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store record;
  v_creadas int := 0;
BEGIN
  SELECT id, org_id, name INTO v_store
  FROM public.ecommerce_stores WHERE id = p_store_id;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  IF NOT public.has_org_role(v_store.org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'No tenés permiso para editar esta tienda';
  END IF;

  -- ON CONFLICT DO NOTHING: sembrar dos veces no pisa lo que ya escribieron.
  WITH nuevas AS (
    INSERT INTO public.store_pages (org_id, store_id, slug, title, content, sort_order, status)
    VALUES
      (v_store.org_id, v_store.id, 'sobre-nosotros', 'Sobre nosotros',
       '## Quiénes somos' || E'\n\n' ||
       'Contá acá quién está detrás de ' || v_store.name || ': cuándo empezaron, ' ||
       'qué venden y por qué alguien debería comprarles a ustedes.' || E'\n\n' ||
       '## Cómo trabajamos' || E'\n\n' ||
       '- Productos 100% originales' || E'\n' ||
       '- Envíos a todo el país' || E'\n' ||
       '- Atención personalizada por WhatsApp',
       1, 'draft'),

      (v_store.org_id, v_store.id, 'preguntas-frecuentes', 'Preguntas frecuentes',
       '## ¿Los productos son originales?' || E'\n\n' ||
       'Sí. Respondé acá con detalle: es la duda que más frena la compra.' || E'\n\n' ||
       '## ¿Cuánto tarda el envío?' || E'\n\n' ||
       'Entre 3 y 7 días hábiles según la provincia. Apenas despachamos te ' ||
       'mandamos el código de seguimiento por email.' || E'\n\n' ||
       '## ¿Qué formas de pago aceptan?' || E'\n\n' ||
       'Tarjeta de crédito y débito por MercadoPago, transferencia bancaria y ' ||
       'efectivo al retirar.' || E'\n\n' ||
       '## ¿Puedo retirar en persona?' || E'\n\n' ||
       'Contá acá si tenés punto de retiro, dirección y horarios.',
       2, 'draft'),

      (v_store.org_id, v_store.id, 'cambios-y-devoluciones', 'Cambios y devoluciones',
       '## Botón de arrepentimiento' || E'\n\n' ||
       'Si comprás online tenés **10 días corridos** desde que recibís el ' ||
       'producto para arrepentirte de la compra y que te devolvamos el dinero, ' ||
       'sin necesidad de dar explicaciones (Ley 24.240, art. 34). El costo de ' ||
       'devolución corre por nuestra cuenta.' || E'\n\n' ||
       'Para hacerlo, escribinos indicando tu número de orden.' || E'\n\n' ||
       '## Cambios' || E'\n\n' ||
       'Aceptamos cambios dentro de los 30 días, con el producto sin usar y en ' ||
       'su envase original.' || E'\n\n' ||
       '## Producto fallado' || E'\n\n' ||
       'Si te llegó dañado o no es lo que pediste, avisanos dentro de las 48 ' ||
       'horas con una foto y lo resolvemos sin cargo.',
       3, 'draft'),

      (v_store.org_id, v_store.id, 'terminos-y-condiciones', 'Términos y condiciones',
       '## Alcance' || E'\n\n' ||
       'Estos términos regulan las compras hechas en la tienda online de ' ||
       v_store.name || '. Al comprar, aceptás lo que sigue.' || E'\n\n' ||
       '## Precios y stock' || E'\n\n' ||
       'Los precios están expresados en pesos argentinos e incluyen IVA. ' ||
       'Pueden cambiar sin aviso; rige el precio vigente al momento de ' ||
       'confirmar la orden. Las publicaciones están sujetas a stock.' || E'\n\n' ||
       '## Datos personales' || E'\n\n' ||
       'Tus datos se usan sólo para procesar la compra y el envío. Podés ' ||
       'pedir su acceso, rectificación o supresión cuando quieras (Ley 25.326).' || E'\n\n' ||
       '## Contacto' || E'\n\n' ||
       'Completá acá tu razón social, CUIT, domicilio y un medio de contacto.',
       4, 'draft')
    ON CONFLICT (store_id, slug) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM nuevas;

  RETURN jsonb_build_object('ok', true, 'creadas', v_creadas);
END;
$$;

REVOKE ALL  ON FUNCTION public.seed_store_pages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_store_pages(uuid) TO authenticated;
