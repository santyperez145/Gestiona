-- ═══════════════════════════════════════════════════════════════════════════
-- Categorías por rubro: alimentos, tecnología, hogar, mascotas, deportes y
-- juguetería
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nerqia es para cualquier rubro (TESIS §1). Después de las tandas anteriores
-- (ferretería, cosmética, indumentaria, gastronomía, autopartes, librería)
-- quedaban seis rubros configurables sin reglas: el catálogo de esos
-- comercios no se ordenaba solo al importar o dar de alta. Medido
-- 2026-10-11: ningún comercio los usa todavía.
--
-- Mismo formato y cuidados que 20261011000000: menos de 20 reglas por rubro,
-- patrones sin tildes ni ñ, y plurales de palabras que terminan en consonante
-- como «(es)?» para reconocer también el singular. Quedan sin reglas
-- «servicios» (no vende productos con catálogo), «otro» y «perfumes» (a
-- propósito, ver 20261010003100).
--
-- Idempotente (borra y vuelve a cargar sólo estos seis rubros). Reversible:
-- DELETE de esos rubros.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DELETE FROM public.rubro_reglas_categoria
WHERE industry_code IN ('alimentos', 'tecnologia', 'hogar', 'mascotas', 'deportes', 'jugueteria');

INSERT INTO public.rubro_reglas_categoria (industry_code, categoria_slug, categoria_nombre, sobre, patron, prioridad) VALUES
  -- ── Alimentos ──────────────────────────────────────────────────────────
  ('alimentos', 'almacen', 'Almacén', 'categoria', '^(almacen|secos|despensa|comestibles)$', 1),
  ('alimentos', 'bebidas', 'Bebidas', 'categoria', '^(bebidas?|gaseosas?|aguas?|jugos?|vinos?|cervezas?)$', 1),
  ('alimentos', 'lacteos', 'Lácteos', 'categoria', '^(lacteos?|fiambreria|quesos?)$', 1),
  ('alimentos', 'congelados', 'Congelados', 'categoria', '^(congelados?|freezer)$', 1),
  ('alimentos', 'limpieza', 'Limpieza', 'categoria', '^(limpieza|art(iculos)? de limpieza)$', 1),
  ('alimentos', 'golosinas', 'Golosinas y snacks', 'categoria', '^(golosinas?|snacks?|kiosco)$', 1),
  ('alimentos', 'bebidas', 'Bebidas', 'nombre', '\m(gaseosa|coca|pepsi|sprite|agua mineral|agua saborizada|jugo|cerveza|vino|fernet|aperitivo|energizante|soda)\M', 10),
  ('alimentos', 'lacteos', 'Lácteos', 'nombre', '\m(leche|yogur|yogurt|queso|manteca|crema de leche|dulce de leche|ricota|postrecito|jamon|salame|mortadela)\M', 15),
  ('alimentos', 'congelados', 'Congelados', 'nombre', '\m(congelad[oa]s?|helado|hamburguesas? congeladas?|nuggets|papas prefritas|medallones)\M', 20),
  ('alimentos', 'limpieza', 'Limpieza', 'nombre', '\m(lavandina|detergente|jabon en polvo|suavizante|limpiador|desinfectante|esponjas?|trapo de piso|bolsas de residuos|papel higienico|rollo de cocina)\M', 25),
  ('alimentos', 'golosinas', 'Golosinas y snacks', 'nombre', '\m(alfajor(es)?|chocolates?|caramelos?|chicles?|galletitas?|papas fritas|snacks?|mani|turron(es)?|chupetin(es)?)\M', 30),
  ('alimentos', 'almacen', 'Almacén', 'nombre', '\m(fideos|arroz|harina|azucar|aceite|yerba|cafe|te en saquitos|mate cocido|polenta|lentejas|porotos|atun|pure de tomate|mayonesa|ketchup|sal fina|galletas de arroz|cereales?)\M', 35),

  -- ── Tecnología ─────────────────────────────────────────────────────────
  ('tecnologia', 'celulares', 'Celulares y accesorios', 'categoria', '^(celular(es)?|telefonia|smartphones?)$', 1),
  ('tecnologia', 'computacion', 'Computación', 'categoria', '^(computacion|informatica|notebooks?|pc)$', 1),
  ('tecnologia', 'audio-y-video', 'Audio y video', 'categoria', '^(audio|video|audio y video|tv|televisores?)$', 1),
  ('tecnologia', 'gaming', 'Gaming', 'categoria', '^(gaming|gamer|consolas?|videojuegos?)$', 1),
  ('tecnologia', 'accesorios', 'Accesorios', 'categoria', '^(accesorios?|cables?|cargadores?)$', 1),
  ('tecnologia', 'gaming', 'Gaming', 'nombre', '\m(playstation|ps[45]|xbox|nintendo|switch|joystick|gamepad|consola|silla gamer|headset gamer)\M', 10),
  ('tecnologia', 'celulares', 'Celulares y accesorios', 'nombre', '\m(celular(es)?|iphone|samsung galaxy|motorola|xiaomi|redmi|funda|templado|vidrio templado|protector de pantalla|smartwatch|reloj inteligente)\M', 15),
  ('tecnologia', 'computacion', 'Computación', 'nombre', '\m(notebook|laptop|pc|monitor(es)?|teclado|mouse|impresora|disco (solido|rigido)|ssd|pendrive|memoria ram|router|tablet|webcam)\M', 20),
  ('tecnologia', 'audio-y-video', 'Audio y video', 'nombre', '\m(auricular(es)?|parlante|bluetooth speaker|smart tv|televisor|proyector|barra de sonido|microfono|camara)\M', 25),
  ('tecnologia', 'accesorios', 'Accesorios', 'nombre', '\m(cargador(es)?|cable (usb|hdmi|tipo c)|adaptador(es)?|power ?bank|bateria externa|soporte|hub usb)\M', 30),

  -- ── Hogar ──────────────────────────────────────────────────────────────
  ('hogar', 'cocina', 'Cocina', 'categoria', '^(cocina|bazar|vajilla)$', 1),
  ('hogar', 'bano', 'Baño', 'categoria', '^(bano|banio|toallas?)$', 1),
  ('hogar', 'dormitorio', 'Dormitorio y blanquería', 'categoria', '^(dormitorio|blanqueria|ropa de cama)$', 1),
  ('hogar', 'decoracion', 'Decoración', 'categoria', '^(decoracion|deco|iluminacion)$', 1),
  ('hogar', 'organizacion', 'Organización', 'categoria', '^(organizacion|orden|almacenamiento)$', 1),
  ('hogar', 'cocina', 'Cocina', 'nombre', '\m(sarten(es)?|ollas?|cacerolas?|cuchillos?|tablas? de picar|vasos?|tazas?|platos?|cubiertos|termos?|mate|pava|tupper|fuentes?|bowl)\M', 10),
  ('hogar', 'bano', 'Baño', 'nombre', '\m(toallas?|toallon(es)?|cortina de bano|alfombra de bano|jabonera|dispenser|porta cepillos)\M', 15),
  ('hogar', 'dormitorio', 'Dormitorio y blanquería', 'nombre', '\m(sabanas?|acolchados?|almohadas?|frazadas?|cubrecama|funda de almohada|edredon(es)?|mantas?)\M', 20),
  ('hogar', 'decoracion', 'Decoración', 'nombre', '\m(cuadros?|espejos?|velas?|floreros?|lamparas?|portarretratos?|almohadon(es)?|plantas? artificial(es)?|difusor(es)?)\M', 25),
  ('hogar', 'organizacion', 'Organización', 'nombre', '\m(cajas? organizadoras?|canastos?|percheros?|estantes?|organizador(es)?|ganchos?|cestos?)\M', 30),

  -- ── Mascotas ───────────────────────────────────────────────────────────
  ('mascotas', 'alimento', 'Alimento', 'categoria', '^(alimentos?|comida|balanceados?)$', 1),
  ('mascotas', 'accesorios', 'Accesorios', 'categoria', '^(accesorios?|correas?|camas?)$', 1),
  ('mascotas', 'higiene-y-salud', 'Higiene y salud', 'categoria', '^(higiene|salud|farmacia|veterinaria)$', 1),
  ('mascotas', 'juguetes', 'Juguetes', 'categoria', '^(juguetes?)$', 1),
  ('mascotas', 'alimento', 'Alimento', 'nombre', '\m(alimento|balanceado|royal canin|pro plan|eukanuba|pedigree|whiskas|dog chow|cat chow|excellent|old prince|snacks? para perro|snacks? para gato|pouch|lata)\M', 10),
  ('mascotas', 'higiene-y-salud', 'Higiene y salud', 'nombre', '\m(piedritas|arena sanitaria|shampoo|antipulgas|pipeta|collar antipulgas|desparasitante|cepillo|corta unas|panales?)\M', 15),
  ('mascotas', 'juguetes', 'Juguetes', 'nombre', '\m(juguetes?|pelotas?|mordillos?|rascador(es)?|soga para perro|peluche)\M', 20),
  ('mascotas', 'accesorios', 'Accesorios', 'nombre', '\m(correas?|collar(es)?|pretal(es)?|camas?|cuchas?|comederos?|bebederos?|transportadoras?|jaulas?|peceras?)\M', 25),

  -- ── Deportes ───────────────────────────────────────────────────────────
  ('deportes', 'indumentaria-deportiva', 'Indumentaria deportiva', 'categoria', '^(indumentaria|ropa deportiva|textil)$', 1),
  ('deportes', 'calzado-deportivo', 'Calzado deportivo', 'categoria', '^(calzado|zapatillas?|botines?)$', 1),
  ('deportes', 'fitness', 'Fitness', 'categoria', '^(fitness|gimnasio|entrenamiento|musculacion)$', 1),
  ('deportes', 'deportes-de-equipo', 'Deportes de equipo', 'categoria', '^(futbol|basquet|voley|rugby|hockey)$', 1),
  ('deportes', 'outdoor', 'Outdoor y camping', 'categoria', '^(outdoor|camping|aventura|ciclismo)$', 1),
  ('deportes', 'calzado-deportivo', 'Calzado deportivo', 'nombre', '\m(zapatillas?|botines?|running|trail)\M', 10),
  ('deportes', 'fitness', 'Fitness', 'nombre', '\m(mancuernas?|pesas?|colchoneta|mat de yoga|banda elastica|soga para saltar|kettlebell|discos? de pesas|barra olimpica|guantes de gimnasio|proteina|creatina)\M', 15),
  ('deportes', 'deportes-de-equipo', 'Deportes de equipo', 'nombre', '\m(pelotas?|camiseta (de )?futbol|canilleras?|arco de futbol|red de voley|aro de basquet|palo de hockey)\M', 20),
  ('deportes', 'outdoor', 'Outdoor y camping', 'nombre', '\m(bicicletas?|casco|carpa|bolsa de dormir|linterna|mochila de trekking|cantimplora|termo)\M', 25),
  ('deportes', 'indumentaria-deportiva', 'Indumentaria deportiva', 'nombre', '\m(calzas?|remera deportiva|short deportivo|campera deportiva|buzo deportivo|top deportivo|medias deportivas|conjunto deportivo)\M', 30),

  -- ── Juguetería ─────────────────────────────────────────────────────────
  ('jugueteria', 'primera-infancia', 'Primera infancia', 'categoria', '^(bebes?|primera infancia|didacticos?)$', 1),
  ('jugueteria', 'juegos-de-mesa', 'Juegos de mesa', 'categoria', '^(juegos de mesa|juegos?|cartas)$', 1),
  ('jugueteria', 'munecas-y-figuras', 'Muñecas y figuras', 'categoria', '^(munecas?|figuras?|coleccionables?)$', 1),
  ('jugueteria', 'vehiculos', 'Vehículos', 'categoria', '^(vehiculos?|autos?|autitos?)$', 1),
  ('jugueteria', 'aire-libre', 'Aire libre', 'categoria', '^(aire libre|exterior|verano)$', 1),
  ('jugueteria', 'juegos-de-mesa', 'Juegos de mesa', 'nombre', '\m(juego de mesa|ludo|domino|cartas|truco|monopoly|t\.?e\.?g\.?|jenga|rompecabezas|puzzle)\M', 10),
  ('jugueteria', 'primera-infancia', 'Primera infancia', 'nombre', '\m(sonajeros?|mordillos?|bebe|didactico|encastre|apilable|cubos? de actividades|gimnasio para bebe)\M', 15),
  ('jugueteria', 'munecas-y-figuras', 'Muñecas y figuras', 'nombre', '\m(munecas?|barbie|figura de accion|figuras?|peluches?|lol|funko|muneco)\M', 20),
  ('jugueteria', 'vehiculos', 'Vehículos', 'nombre', '\m(autitos?|hot wheels|camion(es)?|pista|control remoto|drone|tren)\M', 25),
  ('jugueteria', 'aire-libre', 'Aire libre', 'nombre', '\m(pelotas?|pileta inflable|inflables?|monopatin(es)?|triciclos?|patines|burbujero|pistola de agua)\M', 30);

COMMIT;
