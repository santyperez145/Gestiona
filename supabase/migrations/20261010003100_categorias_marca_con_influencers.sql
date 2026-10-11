-- ═══════════════════════════════════════════════════════════════════════════
-- Categorías por rubro para la puerta «marca con influencers»
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TESIS §4: la segunda puerta de entrada es «marca con influencers»
-- (indumentaria, cosmética, perfumería, accesorios). Medido 2026-10-11:
-- `rubro_reglas_categoria` sólo tenía reglas de ferretería (35); de los 16
-- rubros configurables, ninguno más ordenaba solo su catálogo al importar.
-- Uno de los comercios activos es de perfumería (59 productos, categorías
-- propias `perfume_arabe`, `perfume_diseñador` y `vaper`).
--
-- Reglas nuevas para cosmética e indumentaria, con el mismo formato que
-- ferretería (`categoria` anclada al nombre de la categoría, `nombre` por
-- palabras del producto, prioridad menor = más específica). Cada rubro tiene
-- menos de 20 reglas: quedan compiladas en memoria (ver 20261010002100).
--
-- Perfumería queda afuera a propósito: el único comercio del rubro ya tiene
-- su propia organización (`perfume_arabe`, `perfume_diseñador`), con
-- identificadores que esta tabla no admite (sólo minúsculas y guiones). Con
-- reglas nuevas sus productos nuevos irían a otra categoría y el catálogo
-- quedaría partido en dos. Se respeta lo que el comercio armó.
--
-- Idempotente (borra y vuelve a cargar sólo estos dos rubros). Reversible:
-- DELETE de esos rubros.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DELETE FROM public.rubro_reglas_categoria WHERE industry_code IN ('cosmetica', 'indumentaria');

INSERT INTO public.rubro_reglas_categoria (industry_code, categoria_slug, categoria_nombre, sobre, patron, prioridad) VALUES
  -- ── Cosmética ──────────────────────────────────────────────────────────
  ('cosmetica', 'maquillaje', 'Maquillaje', 'categoria', '^(maquillajes?|make ?up)$', 1),
  ('cosmetica', 'cuidado-facial', 'Cuidado facial', 'categoria', '^(cuidado facial|skin ?care|facial(es)?|rostro)$', 1),
  ('cosmetica', 'cuidado-capilar', 'Cuidado capilar', 'categoria', '^(cuidado capilar|cabello|capilar(es)?|pelo)$', 1),
  ('cosmetica', 'cuidado-corporal', 'Cuidado corporal', 'categoria', '^(cuidado corporal|corporal(es)?|cuerpo)$', 1),
  ('cosmetica', 'unas', 'Uñas', 'categoria', '^(unas|esmaltes?|manicura)$', 1),
  ('cosmetica', 'maquillaje', 'Maquillaje', 'nombre', '\m(labial(es)?|lip ?gloss|gloss|base de maquillaje|base liquida|corrector|rubor|blush|iluminador|sombras?|paleta|delineador|eyeliner|mascara de pestanas|rimel|polvo (compacto|suelto)|bronceador en polvo|primer|brochas?|pinceles? de maquillaje)\M', 10),
  ('cosmetica', 'unas', 'Uñas', 'nombre', '\m(esmaltes?|top coat|base coat|quitaesmalte|lima de unas|semipermanente|kapping|unas)\M', 15),
  ('cosmetica', 'cuidado-capilar', 'Cuidado capilar', 'nombre', '\m(shampoo|champu|acondicionador|mascara capilar|tratamiento capilar|tintura|coloracion|keratina|serum capilar|bano de crema|ampollas? capilar(es)?|alisado)\M', 20),
  ('cosmetica', 'cuidado-facial', 'Cuidado facial', 'nombre', '\m(serum|crema facial|contorno de ojos|limpiador facial|agua micelar|tonico|exfoliante facial|mascarilla|protector solar facial|acido hialuronico|retinol|niacinamida|vitamina c)\M', 25),
  ('cosmetica', 'cuidado-corporal', 'Cuidado corporal', 'nombre', '\m(crema corporal|locion corporal|body|exfoliante corporal|aceite corporal|desodorante|antitranspirante|protector solar|bronceador|jabon|gel de ducha)\M', 30),

  -- ── Indumentaria ───────────────────────────────────────────────────────
  ('indumentaria', 'remeras-y-tops', 'Remeras y tops', 'categoria', '^(remeras?|tops?|musculosas?|camisetas?)$', 1),
  ('indumentaria', 'pantalones', 'Pantalones', 'categoria', '^(pantalon(es)?|jeans?|jogg(ers?|ings?)|calzas?|leggings?)$', 1),
  ('indumentaria', 'buzos-y-abrigos', 'Buzos y abrigos', 'categoria', '^(buzos?|abrigos?|camperas?|sweaters?|sacos?|hoodies?)$', 1),
  ('indumentaria', 'vestidos-y-faldas', 'Vestidos y faldas', 'categoria', '^(vestidos?|polleras?|faldas?|monos?|enteritos?)$', 1),
  ('indumentaria', 'calzado', 'Calzado', 'categoria', '^(calzados?|zapatillas?|zapatos?|botas?|sandalias?)$', 1),
  ('indumentaria', 'accesorios', 'Accesorios', 'categoria', '^(accesorios?|bijou|bijouterie|carteras?|bolsos?|cinturones?|gorras?)$', 1),
  ('indumentaria', 'ropa-interior', 'Ropa interior', 'categoria', '^(ropa interior|lenceria|medias?|bodies|bikinis?|mallas?)$', 1),
  ('indumentaria', 'calzado', 'Calzado', 'nombre', '\m(zapatillas?|zapatos?|botas?|botinetas?|sandalias?|ojotas?|mocasines?|borcegos?|pantuflas?|stilettos?)\M', 10),
  ('indumentaria', 'ropa-interior', 'Ropa interior', 'nombre', '\m(corpinos?|bombachas?|boxers?|slips?|medias?|soquetes?|conjunto de lenceria|lenceria|bikinis?|mallas?|trikinis?|pijamas?|camison)\M', 15),
  ('indumentaria', 'accesorios', 'Accesorios', 'nombre', '\m(carteras?|bolsos?|mochilas?|rinoneras?|billeteras?|cinturones?|gorras?|gorros?|bufandas?|guantes?|anteojos de sol|lentes de sol|aros|collares?|pulseras?|anillos?|panuelos?|vinchas?)\M', 20),
  ('indumentaria', 'vestidos-y-faldas', 'Vestidos y faldas', 'nombre', '\m(vestidos?|polleras?|faldas?|monos?|enteritos?|jumpsuits?)\M', 25),
  ('indumentaria', 'buzos-y-abrigos', 'Buzos y abrigos', 'nombre', '\m(buzos?|hoodies?|camperas?|abrigos?|tapados?|parkas?|sweaters?|cardigans?|chalecos?|sacos?|blazers?|polar(es)?|rompevientos)\M', 30),
  ('indumentaria', 'pantalones', 'Pantalones', 'nombre', '\m(pantalon(es)?|jeans?|joggers?|joggings?|calzas?|leggings?|bermudas?|shorts?|cargos?|palazzos?)\M', 35),
  ('indumentaria', 'remeras-y-tops', 'Remeras y tops', 'nombre', '\m(remeras?|tops?|musculosas?|camisas?|camisetas?|blusas?|chombas?|polos?|crop|bodys?)\M', 40);

COMMIT;
