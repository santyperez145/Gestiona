-- ═══════════════════════════════════════════════════════════════════════════
-- Categorías por rubro: gastronomía, autopartes y librería
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TESIS §4: las puertas de entrada son «catálogo grande» (ferreterías,
-- repuestos, librerías, mayoristas), «marca con influencers» y «negocio con
-- muchos gastos» (gastronomía, servicios, distribuidoras). Después de
-- 20261010003100 tenían reglas ferretería, cosmética e indumentaria; faltaban
-- los rubros de catálogo grande y de muchos gastos. Medido 2026-10-11: ningún
-- comercio usa todavía gastronomía, autopartes ni librería, así que no hay
-- catálogo propio que respetar.
--
-- Mismo formato que las tandas anteriores; menos de 20 reglas por rubro (se
-- mantienen compiladas en memoria, ver 20261010002100) y patrones sin tildes
-- ni ñ (el texto comparable las quita). Los plurales de palabras que terminan
-- en consonante van como «(es)?» para reconocer también el singular; de
-- paso se corrigen tres de la tanda anterior.
--
-- Idempotente (borra y vuelve a cargar sólo estos tres rubros). Reversible:
-- DELETE de esos rubros.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DELETE FROM public.rubro_reglas_categoria WHERE industry_code IN ('gastronomia', 'autopartes', 'libreria');

INSERT INTO public.rubro_reglas_categoria (industry_code, categoria_slug, categoria_nombre, sobre, patron, prioridad) VALUES
  -- ── Gastronomía ────────────────────────────────────────────────────────
  ('gastronomia', 'bebidas', 'Bebidas', 'categoria', '^(bebidas?|gaseosas?|tragos?|vinos?|cervezas?|cafeteria)$', 1),
  ('gastronomia', 'platos-principales', 'Platos principales', 'categoria', '^(platos? principales?|principales?|minutas?|platos?)$', 1),
  ('gastronomia', 'entradas', 'Entradas', 'categoria', '^(entradas?|picadas?|para compartir)$', 1),
  ('gastronomia', 'postres', 'Postres', 'categoria', '^(postres?|dulces?)$', 1),
  ('gastronomia', 'pizzas-y-empanadas', 'Pizzas y empanadas', 'categoria', '^(pizzas?|empanadas?|pizzeria)$', 1),
  ('gastronomia', 'insumos', 'Insumos', 'categoria', '^(insumos?|materia prima|mercaderia|descartables?)$', 1),
  ('gastronomia', 'bebidas', 'Bebidas', 'nombre', '\m(coca|pepsi|sprite|fanta|gaseosa|agua mineral|agua con gas|agua sin gas|jugo|limonada|cerveza|pinta|vino|malbec|fernet|aperitivo|cafe|cortado|capuchino|te|licuado|trago|gin|vermut)\M', 10),
  ('gastronomia', 'pizzas-y-empanadas', 'Pizzas y empanadas', 'nombre', '\m(pizzas?|muzzarella|muzza|fugazzeta|calzone|empanadas?|faina)\M', 15),
  ('gastronomia', 'postres', 'Postres', 'nombre', '\m(flan|helado|tiramisu|brownie|torta|cheesecake|budin|panqueque|mousse|postre|alfajor|medialuna|facturas?)\M', 20),
  ('gastronomia', 'entradas', 'Entradas', 'nombre', '\m(picada|provoleta|rabas|bastones|papas fritas|nachos|bruschettas?|tapas|ensalada|sopa)\M', 25),
  ('gastronomia', 'insumos', 'Insumos', 'nombre', '\m(harina|aceite|azucar|sal fina|levadura|queso por kg|descartables?|servilletas?|bandejas?|vasos? descartables?|film)\M', 30),
  ('gastronomia', 'platos-principales', 'Platos principales', 'nombre', '\m(milanesa|bife|lomo|hamburguesa|pastas?|ravioles|noquis|sorrentinos|tallarines|pollo|pescado|risotto|guiso|parrillada|asado|sandwich|wrap|tarta)\M', 35),

  -- ── Autopartes ─────────────────────────────────────────────────────────
  ('autopartes', 'motor', 'Motor', 'categoria', '^(motor|repuestos? de motor|distribucion)$', 1),
  ('autopartes', 'frenos', 'Frenos', 'categoria', '^(frenos?|sistema de frenos)$', 1),
  ('autopartes', 'suspension-y-direccion', 'Suspensión y dirección', 'categoria', '^(suspension|direccion|tren delantero)$', 1),
  ('autopartes', 'electricidad', 'Electricidad del automotor', 'categoria', '^(electricidad|electrico|iluminacion|baterias?)$', 1),
  ('autopartes', 'filtros-y-lubricantes', 'Filtros y lubricantes', 'categoria', '^(filtros?|lubricantes?|aceites?)$', 1),
  ('autopartes', 'accesorios', 'Accesorios', 'categoria', '^(accesorios?|tuning|interior|exterior)$', 1),
  ('autopartes', 'filtros-y-lubricantes', 'Filtros y lubricantes', 'nombre', '\m(filtro de aceite|filtro de aire|filtro de combustible|filtro de habitaculo|filtros?|aceite \d+w|aceite de motor|lubricante|liquido refrigerante|refrigerante|liquido de frenos|grasa)\M', 10),
  ('autopartes', 'frenos', 'Frenos', 'nombre', '\m(pastillas? de freno|pastillas?|discos? de freno|cintas? de freno|campanas?|bombas? de freno|cilindros? de rueda|calipers?|zapatas?)\M', 15),
  ('autopartes', 'electricidad', 'Electricidad del automotor', 'nombre', '\m(bateria|alternador|burro de arranque|motor de arranque|bujias?|cables? de bujia|bobina|fusibles?|lamparas?|faros?|opticas?|relays?|sensor)\M', 20),
  ('autopartes', 'suspension-y-direccion', 'Suspensión y dirección', 'nombre', '\m(amortiguador(es)?|espiral(es)?|parrillas?|rotulas?|bujes?|extremos? de direccion|bieletas?|cremallera|axial(es)?|ruleman(es)?|crapodinas?)\M', 25),
  ('autopartes', 'motor', 'Motor', 'nombre', '\m(correa de distribucion|kit de distribucion|correas?|tensor|bomba de agua|bomba de aceite|juntas?|reten(es)?|aros de piston|piston(es)?|valvulas?|radiador|termostato|embrague|kit de embrague|inyector(es)?)\M', 30),
  ('autopartes', 'accesorios', 'Accesorios', 'nombre', '\m(cubre ?asientos?|alfombras?|funda|volante|portaequipaje|barras? de techo|limpiaparabrisas|escobillas?|matafuego|baliza|kit de seguridad|ambientador)\M', 35),

  -- ── Librería ───────────────────────────────────────────────────────────
  ('libreria', 'escolar', 'Útiles escolares', 'categoria', '^(escolar(es)?|utiles? escolares?|utiles?)$', 1),
  ('libreria', 'oficina', 'Artículos de oficina', 'categoria', '^(oficina|articulos? de oficina|comercial)$', 1),
  ('libreria', 'papeleria', 'Papelería', 'categoria', '^(papeleria|papeles?|resmas?)$', 1),
  ('libreria', 'arte-y-manualidades', 'Arte y manualidades', 'categoria', '^(arte|artistica|manualidades|bellas artes)$', 1),
  ('libreria', 'libros', 'Libros', 'categoria', '^(libros?|textos?|editorial)$', 1),
  ('libreria', 'papeleria', 'Papelería', 'nombre', '\m(resmas?|papel a4|papel oficio|hojas? (rayadas?|cuadriculadas?|lisas?)|repuesto de hojas|papel glase|cartulinas?|afiches?|papel madera|sobres?|etiquetas?)\M', 10),
  ('libreria', 'arte-y-manualidades', 'Arte y manualidades', 'nombre', '\m(oleos?|acrilicos?|acuarelas?|temperas?|pincel(es)?|lienzo|bastidor|atril|plastilina|porcelana fria|goma eva|fibrofacil|brillantina|stickers?)\M', 15),
  ('libreria', 'oficina', 'Artículos de oficina', 'nombre', '\m(abrochadora|broches?|perforadora|clips?|biblioratos?|carpetas? colgantes?|folios?|sellos?|almohadillas?|cinta de embalar|calculadora|agendas?|talonarios?|resaltador(es)?)\M', 20),
  ('libreria', 'escolar', 'Útiles escolares', 'nombre', '\m(cuadernos?|carpetas?|lapiz|lapices|lapiceras?|biromes?|boligrafos?|gomas? de borrar|sacapuntas|reglas?|escuadras?|compas|transportador|marcador(es)?|fibras?|crayon(es)?|mochilas?|cartucheras?|plasticola|tijeras?)\M', 25),
  ('libreria', 'libros', 'Libros', 'nombre', '\m(libros?|novelas?|manual|diccionario|atlas|enciclopedia|cuentos?|isbn)\M', 30);

-- Corrección de 20261010003100: un plural «-es?» no reconoce el singular
-- terminado en consonante («cinturones?» no encuentra «cinturón»). Se
-- corrige el patrón sin recargar las reglas.
UPDATE public.rubro_reglas_categoria
SET patron = replace(replace(patron, 'mocasines?', 'mocasin(es)?'), 'cinturones?', 'cinturon(es)?')
WHERE industry_code = 'indumentaria' AND (patron LIKE '%mocasines?%' OR patron LIKE '%cinturones?%');
UPDATE public.rubro_reglas_categoria
SET patron = replace(patron, 'pinceles? de maquillaje', 'pincel(es)? de maquillaje')
WHERE industry_code = 'cosmetica' AND patron LIKE '%pinceles? de maquillaje%';

COMMIT;
