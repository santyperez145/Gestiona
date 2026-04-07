

# Plan: Optimización Mobile + Catálogo Web Compartible en Tiempo Real

## Resumen

Dos mejoras principales:
1. **Optimización mobile completa** de todas las páginas del sistema
2. **Catálogo web público en tiempo real** que reemplaza el workflow actual de Canva — un link compartible en Instagram que se actualiza solo cuando cambian precios o stock

---

## 1. Catálogo Público Web Optimizado para Instagram

El catálogo público actual (`/catalogo/:userId`) ya existe y tiene realtime, pero necesita mejoras para reemplazar Canva:

**Mejoras al catálogo público:**
- Diseño visual tipo "tienda online" optimizado para mobile (Instagram abre links en browser mobile)
- Header con logo, nombre del negocio y colores de marca (leídos de settings)
- Grid de productos con fotos grandes, nombre, marca, y precios bien separados (efectivo/transferencia vs tarjeta)
- Filtro por categoría visible como chips/tabs horizontales
- Badge de descuento prominente
- Footer con contacto/Instagram del negocio
- Meta tags Open Graph para que al compartir en Instagram/WhatsApp se vea preview con imagen y título
- El link ya se actualiza en tiempo real (realtime habilitado) — no necesitás tocar nada en Instagram, el mismo link siempre muestra datos actualizados

**Archivos:** `src/pages/PublicCatalogPage.tsx`, `src/pages/CatalogPage.tsx`, `index.html` (meta tags)

---

## 2. Optimización Mobile de Todas las Páginas

Revisar y mejorar responsive en cada página:

**Dashboard:** 
- KPIs en grid 2 columnas en mobile (ya parcialmente hecho)
- Charts apilados verticalmente con scroll
- Selector de categoría como dropdown compacto

**ProductsPage:**
- Tablas convertidas a cards en mobile
- Formulario de producto en modal full-screen en mobile
- Botones de acción como iconos compactos

**SalesPage / PurchasesPage / DebtsPage:**
- Tablas con scroll horizontal o convertidas a cards en mobile
- Formularios adaptados a pantalla completa
- Filtros colapsables

**CatalogPage (interno):**
- Grid 1 columna en mobile muy pequeño, 2 columnas en mobile normal
- Botones de compartir/descargar sticky en bottom

**InfluencerExchangesPage / CustomersPage:**
- Cards en lugar de tablas en mobile

**SettingsPage:**
- Formulario en columna única
- Color picker adaptado

**AppLayout (sidebar):**
- Ya funciona con drawer mobile — verificar que no haya overflow

**Archivos:** Todas las páginas en `src/pages/`, `src/components/AppLayout.tsx`

---

## 3. Meta Tags para Compartir en Redes

Agregar meta tags dinámicos para que al pegar el link del catálogo en Instagram/WhatsApp se vea:
- Título: "{Nombre Negocio} — Catálogo"
- Descripción: "X productos disponibles"
- Imagen: logo del negocio o imagen del primer producto

Como es una SPA, los meta tags base van en `index.html` y se pueden mejorar con una edge function que sirva HTML con meta tags dinámicos para `/catalogo/:userId`.

**Archivos:** `index.html`, nueva edge function `catalog-meta` (opcional)

---

## Detalles Técnicos

### Catálogo público mobile-first
- CSS: grid-cols-1 en <400px, grid-cols-2 en >400px
- Imágenes lazy loading con `loading="lazy"`
- Sticky header con nombre del negocio
- Scroll suave entre categorías

### Responsive tables → cards
- Usar `useIsMobile()` hook existente
- En mobile: renderizar `<div>` cards en lugar de `<table>`
- Mantener todas las acciones (editar, eliminar) accesibles

### Workflow Instagram
- El usuario comparte el link `/catalogo/:userId` en su bio de Instagram
- Cuando actualiza precios/stock, el link ya muestra los datos nuevos automáticamente (realtime ya implementado)
- No necesita Canva ni regenerar nada

### Orden de implementación
1. Catálogo público mobile-first con diseño visual mejorado
2. Meta tags Open Graph
3. Responsive en Dashboard y ProductsPage
4. Responsive en SalesPage, PurchasesPage, DebtsPage
5. Responsive en páginas restantes

