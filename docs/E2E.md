# E2E críticos

**Estado:** gate vigente. **Corte:** 2026-09-10.

La puerta E2E prueba la tienda pública en Chromium de escritorio y teléfono, y
las superficies críticas del panel con una identidad técnica. Los specs leen la
base vinculada; no crean ventas, órdenes, envíos ni comprobantes.

Checkout C20: un escenario desktop/mobile intercepta toda creación de orden y
las Edge Functions, retiene la respuesta y devuelve un resultado incompleto.
Verifica estado visible, campos bloqueados, ausencia de desborde, carrito
conservado y reintento con la misma clave. Las pruebas de componente cubren
recarga, doble submit, fallo del pago y segunda compra idéntica. No certifican
pagos live ni concurrencia de sesiones con claves diferentes.

La entrada al checkout también cubre el CTA de la ficha: en escritorio no se
oculta del árbol accesible al salir del viewport; la sustitución por barra fija
se aplica sólo en móvil. Ambos botones dicen "Agregar al carrito".

`store-order.spec.ts` usa un pedido sintético e intercepta lectura, seguimiento,
pagos y creación. Comprueba recuperación de red inicial y botones de tarjeta/
redirect en desktop/mobile. Los tests de componente verifican aislamiento al
cambiar de pedido, respuestas tardías, conservación del detalle y polling
secuencial limitado, sólo para pagos digitales pendientes.
La acción "Actualizar estado del pedido" consulta el estado canónico sin
recargar la página; también está disponible para transferencias y efectivo.

Referencia verificada el 2026-09-10: [Shopify distingue estado de pedido, pago y
entrega](https://help.shopify.com/en/manual/fulfillment/managing-orders/order-status).
La decisión de reintentar consultas sin recrear compras es propia de Nerqia;
estas pruebas no certifican un cobro ni un webhook real.

Pedidos C23: `storeOrderQueuePage.test.tsx` cubre contrato paginado, cambio de
vitrina con respuesta tardía, debounce, errores/reintento, navegación por URL,
CSV de página y vacío filtrado. La fixture reversible
`supabase/verificaciones/20260910_store_order_queue.sql` verifica 251 pedidos en
una tienda y otra vitrina aislada: historial antiguo, acentos, búsqueda literal,
montos, orden estable, última página, contadores y denegación de anon/otro tenant.
Su consulta final exige cero organizaciones sintéticas restantes.

Referencia verificada el 2026-09-10: [Shopify busca y filtra el historial de
pedidos](https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders).
Las páginas de 50, el CSV explícitamente limitado a la página y el umbral actual
de 24 horas son decisiones propias; no equivalen a paridad completa con Shopify.

## Contrato del gate

- Vite construye el bundle de producción y lo sirve con `vite preview` en
  `4173` por defecto y `--strictPort`. Probar el artefacto real evita que cuatro
  browsers compitan por la transformación inicial del dev server.
- El arranque del servidor tiene un margen de `180s` para completar `build +
  preview`; el tiempo de compilar el bundle no se confunde con el timeout de una
  interacción del navegador.
- Un proceso preexistente nunca se reutiliza salvo opt-in explícito con
  `E2E_REUSE_SERVER=true`.
- CI exige `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `E2E_STORE_SLUG`, `E2E_USER` y `E2E_PASSWORD`.
- CI define `E2E_REQUIRE_AUTH=true`: una credencial ausente falla, no saltea.
- La identidad de CI es miembro `admin` de una organización, no staff de
  plataforma. No tiene acceso a `/platform`.
- Local falla antes de abrir 72 browsers si faltan las dos variables públicas
  de Supabase. Una pantalla vacía por `supabaseUrl is required` no se confunde
  con 72 regresiones de producto.

Esta separación evita dos falsos verdes que existían: levantar la app sin
conexión a Supabase y saltear silenciosamente todo el panel.

El 2026-08-28 también se retiró el dev server de esta puerta: 31/32 escenarios
terminaron en el primer intento, pero el primero de mobile 375 px agotó 30 s
durante la compilación en caliente y pasó en 3,1 s al reintentar. Un retry local
no demuestra estabilidad y CI no reintenta; `build + preview` prueba el mismo
tipo de bundle que llega a producción y transforma ese caso en una señal útil.

## Comandos

~~~bash
npm run test:e2e:public
npm run test:e2e:ci
~~~

Si esta PC no tiene el runtime público local, el barrido público puede ejecutarse
contra el artefacto publicado. Los specs interceptan visitas, carritos e inicios
de checkout y no crean pedidos:

~~~bash
E2E_BASE_URL=https://nerqia.app npm run test:e2e:public
~~~

Última evidencia productiva (2026-09-06): **70 aprobados y 2 omitidos** en
Chromium desktop/mobile. Los dos omitidos requieren que el catálogo real tenga
un producto completamente agotado; las variantes agotadas sí quedaron cubiertas.

Para reutilizar deliberadamente un servidor local:

~~~bash
E2E_PORT=4173 E2E_REUSE_SERVER=true npm run test:e2e:public
~~~

Si un spec futuro necesita escribir, debe usar datos con prefijo `ZZ`, probar
el rol real y demostrar limpieza con cero restos. Hasta que exista ese fixture,
el workflow permanece de sólo lectura.

## Incidente que cerró este slice

El 2026-08-21 había otra aplicación Java escuchando en `localhost:8080`.
Playwright tenía `reuseExistingServer: true`, la aceptó y ejecutó los tests
contra una respuesta JSON ajena a Nerqia. El puerto estricto y el test guardia
impiden que esa configuración reaparezca.
