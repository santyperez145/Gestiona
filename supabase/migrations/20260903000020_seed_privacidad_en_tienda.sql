-- Al sembrar páginas de tienda faltaba política de privacidad (Ley 25.326).
-- El checklist exige politica-de-privacidad + terminos; sin la fila el 2º
-- comercio ve «faltan» aunque abrió Páginas. Siempre draft con marcador
-- «Completá acá» — no se publica ni se inventa CUIT.

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
       4, 'draft'),

      (v_store.org_id, v_store.id, 'politica-de-privacidad', 'Política de privacidad',
       '## Quién trata tus datos' || E'\n\n' ||
       'Completá acá tu razón social, CUIT, domicilio y un medio de contacto.' || E'\n\n' ||
       '## Qué datos guardamos' || E'\n\n' ||
       'Cuando comprás guardamos nombre, email, teléfono y dirección de envío ' ||
       'para procesar la compra y el despacho (Ley 25.326).' || E'\n\n' ||
       '## Tus derechos' || E'\n\n' ||
       'Podés pedir acceso, rectificación o supresión. Escribí al contacto de la tienda.',
       5, 'draft')
    ON CONFLICT (store_id, slug) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM nuevas;

  RETURN jsonb_build_object('ok', true, 'creadas', v_creadas);
END;
$$;

REVOKE ALL  ON FUNCTION public.seed_store_pages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_store_pages(uuid) TO authenticated;

-- Backfill: tiendas que ya tienen páginas pero no privacidad.
INSERT INTO public.store_pages (org_id, store_id, slug, title, content, sort_order, status)
SELECT s.org_id, s.id, 'politica-de-privacidad', 'Política de privacidad',
       '## Quién trata tus datos' || E'\n\n' ||
       'Completá acá tu razón social, CUIT, domicilio y un medio de contacto.' || E'\n\n' ||
       '## Qué datos guardamos' || E'\n\n' ||
       'Cuando comprás guardamos nombre, email, teléfono y dirección de envío ' ||
       'para procesar la compra y el despacho (Ley 25.326).' || E'\n\n' ||
       '## Tus derechos' || E'\n\n' ||
       'Podés pedir acceso, rectificación o supresión. Escribí al contacto de la tienda.',
       5, 'draft'
FROM public.ecommerce_stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_pages p
  WHERE p.store_id = s.id AND p.slug = 'politica-de-privacidad'
)
ON CONFLICT (store_id, slug) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'seed_store_pages'
      AND pg_get_functiondef(oid) LIKE '%politica-de-privacidad%'
  ) THEN
    RAISE EXCEPTION 'seed_store_pages no incluye politica-de-privacidad';
  END IF;
END $$;
