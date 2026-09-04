# Interfaz de Nerqia

**Estado:** vigente. **Corte:** 2026-09-04.

Este documento traduce el sistema visual a implementación. La dirección está
en [DESIGNROADMAP.md](../DESIGNROADMAP.md) y la evaluación completa en
[ESTANDAR_EXPERIENCIA_COMPETITIVA.md](ESTANDAR_EXPERIENCIA_COMPETITIVA.md).

## Identidad

- UI de trabajo clara, sobria y densa.
- Violeta Nerqia para acción/foco; colores semánticos para estados.
- Inter en interfaz; Sora sólo en titulares de marca.
- Radios contenidos, bordes suaves y sombras mínimas.
- Sin cards anidadas, orbes, gradientes decorativos o tracking negativo.
- Storefront adapta la marca del comercio; no hereda el chrome administrativo.

Los tokens viven en src/index.css y Tailwind. No introducir colores o
espaciados locales cuando existe un token semántico.

## Primitives

Usar primero los componentes de src/components/ui y patrones compartidos:

| Necesidad | Componente/patrón |
|---|---|
| Encabezado | PageHeader |
| Vistas internas | WorkspaceViewTabs |
| Resultado sin datos | EmptyState |
| Carga/error/parcial | WorkspaceState |
| Paginación | DataPagination |
| Fecha | DateRangeFilter |
| Archivo | FilePicker |
| Imagen | ImageUpload |
| Acción | Button + Lucide |
| Detalle contextual | Sheet |
| Confirmación peligrosa | AlertDialog |

Una primitive nueva necesita al menos dos consumidores o una complejidad real
que no deba repetirse.

## Layouts

### Organización

AppLayout contiene sidebar, topbar y contexto de organización. El rail agrupa
trabajos diarios, Commerce, compras, cobranzas, finanzas, marketing, reportes y
sistema. Las rutas salen de routeManifest.ts.

### Commerce

/tienda-online es el workspace de configuración/rendimiento de la tienda;
/pedidos-online es la cola operativa. Ambas comparten selector de tienda y
preservan ?store=<id>. No crear una segunda administración por cada vitrina.

### Finance

FinanceLayout usa navegación propia orientada a gastos, documentos,
solicitudes, políticas, medios de pago y conciliación. Reutiliza identidad y
datos del Core sin mostrar las páginas de Business dentro de otro menú.

### Platform

PlatformLayout es un control plane. Sus pantallas priorizan colas, health,
merchant 360, riesgo y acciones auditables. El violeta diferencia el contexto,
no sustituye jerarquía.

### Tienda

StoreLayout es mobile-first. Producto, variantes, imágenes, precio,
disponibilidad, entrega y compra deben ser visibles y verificables. Cada tema
usa tokens/versionado, no CSS arbitrario inyectado.

## Densidad y medidas

- Contenido de gestión: ancho útil amplio y columnas estables.
- Header de página: compacto; una acción primaria.
- Controles touch: mínimo 40 px, 44 px en checkout/POS.
- Cards: radio máximo 8 px salvo primitive existente.
- Tablas: header fijo cuando ayuda, números alineados y unidad visible.
- Panel de detalle: ancho estable y scroll interno.
- No escalar tipografía con viewport.
- Reservar tamaño de imágenes, charts, skeletons y counters para evitar CLS.

## Navegación y persistencia

- Ruta, tab, búsqueda, filtros compartibles y entidad seleccionada van en URL.
- Preferencias como columnas o rail colapsado pueden usar storage versionado.
- Cambiar de pestaña del navegador no reinicia el estado server-side.
- Volver/avanzar restaura contexto.
- Cambiar organización/tienda invalida sólo queries de ese contexto.
- Una nueva versión de la PWA se activa por acción explícita.

## Estados

Toda vista cubre loading, refresh, empty inicial, empty filtrado, error, offline
o stale, permiso, parcial y éxito. Formularios agregan dirty state; datos
concurrentes agregan conflicto.

El error no desaparece en un toast: permanece cerca del contenido y ofrece
retry. Una respuesta parcial se rotula como parcial, nunca como cero.

## Formularios

- Labels visibles y validación inline.
- Campos agrupados por decisión, no por tabla.
- Defaults sólo cuando son universalmente seguros.
- Guardado único e idempotente.
- Botón primario muestra progreso sin cambiar tamaño.
- Acciones destructivas separadas y confirmadas.
- Imágenes sólo con ImageUpload.

## Índices y colas

- Búsqueda con debounce razonable.
- Filtros en URL y contador activo.
- Vistas guardadas separadas de segmentos.
- Selección masiva con alcance explícito.
- Columnas configurables si la densidad lo justifica.
- Paginación server-side en poblaciones grandes.
- Fila clickeable sólo si no compite con sus controles.
- Cola muestra prioridad/SLA, responsable y próxima acción.

## Accesibilidad

Objetivo WCAG 2.2 AA: teclado completo, foco visible, nombres accesibles,
contraste, zoom 200%, lector y reducción de movimiento. Validar al menos 360,
390, 768, 1024, 1280×720 y 1440 px.

## Revisión

Antes de cerrar una pantalla:

1. comprobar arquetipo, ruta y autoridad;
2. probar datos vacíos, largos, parciales y error;
3. recorrer teclado y foco;
4. capturar desktop y móvil;
5. revisar overflow, solapamientos, consola y requests;
6. ejecutar Playwright/Axe cuando corresponda;
7. probar el resultado real, no sólo el render.
