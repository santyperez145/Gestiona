# Evidencia — Storefront D5.1: resiliencia de medios

**Fecha:** 2026-08-30  
**Estado:** implementación y puerta local completas; publicación pendiente.

## Hallazgo productivo

En `https://exentryimports.vercel.app/tienda/exentryimports?audit=d5-home`, la
primera imagen del banner estaba completa para el navegador, pero no era un
bitmap válido:

~~~text
src=https://capturetheatlas.com/es/fotografia-de-larga-exposicion/
complete=true
naturalWidth=0
naturalHeight=0
~~~

La captura mostraba un hero negro con el ícono nativo de archivo roto. El
banner conservaba título y CTA, por lo que el defecto era recuperación de
medios y no ausencia de contenido. La auditoría fue de sólo lectura: no se
alteró la configuración ni un dato del comercio.

## Decisión

- Toda imagen pública deja una composición estable debajo y oculta únicamente
  la etiqueta que falló.
- Un recurso que luego carga vuelve a mostrarse; esto cubre cambio de slide,
  miniatura y fuente mobile/desktop.
- El banner conserva título, subtítulo y CTA como HTML accesible sobre un
  fallback que usa los tokens del merchant.
- Cards, PDP, categorías, logo, búsqueda, carrito y sugerencias conservan
  placeholders propios en vez del ícono del navegador.
- Gestión muestra un alerta de recurso inválido y Banners bloquea guardar o
  reactivar un banner activo hasta reemplazar la imagen.
- El fallback protege la conversión, pero no declara que la URL externa esté
  sana ni autoriza reemplazar contenido del comercio.

## Benchmark oficial

- [Shopify: imágenes del tema](https://help.shopify.com/en/manual/online-store/images/theme-images):
  proporción, foco y optimización automática.
- [Shopify: editor de temas](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor):
  preview antes de guardar/publicar.
- [Tiendanube: slider desktop/mobile](https://ayuda.tiendanube.com/es_ES/122998-carrusel-de-imagenes/cual-es-el-tamano-recomendado-del-slider-para-mi-tiendanube):
  activos adaptados al viewport.
- [Tiendanube: banners](https://ayuda.tiendanube.com/es_CO/123046-banners/cual-es-el-tamano-recomendado-del-banner):
  texto y botones configurados en el editor, fuera de la imagen.

Gestiona traduce esos patrones a una experiencia resiliente y auditable; no
copia composición ni activos.

## Cobertura automatizada inicial

`src/test/storefrontMediaResilience.test.tsx` verifica:

1. ocultar un recurso roto y recuperarlo al cargar;
2. preservar título, subtítulo y CTA del banner sobre el fallback;
3. exponer la URL fallida en `ImageUpload` y notificar su invalidez.

~~~text
npm exec vitest run src/test/storefrontMediaResilience.test.tsx
  PASS — 3/3

npm run typecheck
  PASS

npm run lint -- --quiet
  PASS — 0 errores
~~~

## Puerta completa

~~~text
npm run typecheck
  PASS

npm run lint
  PASS — 0 errores, 139 warnings conocidos

npm test
  PASS — 211 archivos, 2.089 pruebas

npm run build
  PASS — PWA, 18 entradas / 2.018,70 KiB

npm run check:functions
  PASS — 74 Edge Functions

npm run check:dependencies
  PASS — 0 vulnerabilidades

npm run check:enlaces
  PASS — 82 enlaces internos en 51 documentos

npm run check:conteos
  PASS — 74 funciones / 497 migraciones
~~~

## Pendiente para cerrar

- deployment `Ready` asociado al dominio principal;
- tienda pública sin ícono roto y con CTA recuperable;
- alerta visible en Gestión sin guardar ni alterar el banner;
- matriz 360/768/1024/1440 sin overflow ni logs nuevos.
