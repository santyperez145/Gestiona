# Gestiona - roadmap actual

**Estado de este documento: 2026-08-21**

Gestiona es el sistema operativo para comercios omnicanal: productos,
inventario, clientes, ventas, pagos y margen viven en un mismo Business Core.
El POS, la tienda online, MercadoLibre, WhatsApp y las futuras integraciones
son canales alrededor de ese núcleo. La tienda es una superficie del producto,
no el producto entero.

Este archivo es un documento de decisión. Dice qué importa ahora, qué evidencia
define el avance y qué queda congelado. No es un changelog ni un inventario de
ideas. El detalle de una implementación vive en sus tests, migraciones, docs y
en el historial de Git.

## 0. La regla que ordena todo

Cada fase tiene que destrabar la siguiente:

1. Hacer que Gestiona pueda venderle a un comercio real con datos confiables.
2. Probar que el mismo núcleo soporta un segundo comercio sin trabajo manual.
3. Convertir el margen por canal en una ventaja difícil de copiar.
4. Hacer que documentos, inteligencia e integraciones reduzcan trabajo real.
5. Escalar sólo después de tener operación repetible y observable.

Una idea nueva entra al roadmap sólo si fortalece al menos uno de estos cinco
pilares: productos e inventario, POS y caja, ecommerce, clientes y ventas, o
inteligencia operativa. Las features que no acercan una primera venta, no
protegen el stock único, no explican el margen, no reducen riesgo o no miden
adopción quedan fuera.

## 1. Producto y arquitectura

### Tesis

El diferencial de Gestiona es el margen real por canal. Para calcularlo hacen
falta a la vez costo de importación, aduana, comisión de pago, envío e IVA.
Un ecommerce suele desconocer el costo real; un ERP suele desconocer la
comisión y la experiencia de venta. Gestiona tiene que unir ambas verdades.

### Business Core

El Core es la autoridad de:

- productos, variantes, atributos y costos;
- stock por ubicación y movimientos de inventario;
- clientes y organizaciones;
- órdenes, ventas, devoluciones y pagos;
- documentos fiscales y asientos financieros;
- margen, eventos y métricas de uso.

Ningún canal inventa su propio stock, precio, margen, cobro u objeto de cliente.
Una integración traduce eventos del canal al Core y devuelve el estado que el
canal necesita mostrar.

### Tres superficies

| Superficie | Ruta | Usuario | Layout |
|---|---|---|---|
| Organización | `/` | miembros de la organización | `AppLayout`, acento dorado |
| Plataforma | `/platform` | `platform_admins` | `PlatformLayout`, acento violeta |
| Tienda pública | `/tienda/:slug` | comprador anónimo | `StoreLayout` |

Ser staff de plataforma no otorga permisos dentro de una organización.
Las reglas completas están en [docs/permisos.md](docs/permisos.md).

## 2. Estado medido

Los números de esta sección tienen fecha. Si cambian, se actualizan con la
fecha y el comando o consulta que los produjo; no se reemplazan en silencio.

| Señal | Estado al 2026-08-21 |
|---|---|
| Edge Functions | 63 |
| Tests unitarios | 1.213, `npm test -- --maxWorkers=1 --fileParallelism=false` (2026-08-21) |
| Organizaciones / comercios que venden de verdad | 4 / 1 |
| Registros POS / tiendas online | 34 / 6 |
| Eventos de dominio / asientos del ledger | 10 / 0 |
| Facturas emitidas por la app / CAE | 0 / 0 |
| Pagos reales de prueba | 2 cobros de ARS 1 |
| Control Plane | Overview, catálogo de integraciones, Merchant 360 y cola operativa sanitizada |

### Comparativa que orienta el producto

La comparación no se usa para declarar ganadores: se usa para no construir una
paridad como si fuera un diferencial. Las fuentes y el detalle verificable viven
en [docs/COMPARACION.md](docs/COMPARACION.md), con corte 2026-08-21.

| Capacidad | Gestiona hecho y medido | Referencia de mercado verificada | Decisión |
|---|---|---|---|
| POS + stock unificado | ✅ PWA offline y movimientos con triggers | Tiendanube, Shopify y Odoo ya integran POS e inventario | Paridad necesaria; no venderla como ventaja única |
| Facturación argentina | 🟡 flujo ARCA nativo y delegado; 0 facturas reales | Tiendanube integra facturación mediante apps de terceros | Diferencial posible sólo después de emitir en producción |
| Margen por canal | ✅ Core reúne costo landed, comisión, envío e IVA | No hay benchmark exhaustivo que permita afirmar exclusividad | Medir uso y mejora de margen antes de usarlo como promesa comercial |
| Confiabilidad server-side | ✅ 63 Edge Functions chequeadas por Deno en CI | Estándar mínimo de operación, no feature de marketing | Reduce riesgo de cobro, webhook, envío y fiscal antes del segundo comercio |

### Lo que ya está

- El modelo de productos, variantes y atributos está preparado para crecer.
- Identidad, membresías y separación de superficies tienen guardas de acceso.
- Checkout y reintegros online tienen idempotencia en los caminos cubiertos.
- El stock se mueve en base de datos mediante movimientos y triggers.
- Las credenciales de pagos, marketplaces y servicios privados no se leen desde
  el navegador; la UI consume estados sanitizados. Evolution API quedó migrada
  el 2026-08-21 a `evolution_connections` (RLS sin policies) y el asistente ya
  no puede enviar WhatsApp directo fuera del flujo con consentimiento y baja.
- El resumen de plataforma consume señales operativas reales de salud,
  activación y cron, y muestra error explícito cuando una señal no está
  disponible.
- El registro inicial de integraciones vive en el Control Plane con separación
  por organización y acceso exclusivo de plataforma.
- Merchant 360 ya permite abrir una organización desde el listado y leer, en
  tabs persistentes, negocio, canales, activación, contexto y evidencia
  sanitizada de Mercado Pago, Mercado Libre, ARCA y Evolution API. Una conexión
  registrada no se presenta como disponibilidad actual del proveedor.
- La cola de Operaciones prioriza fallos reales de entregas, webhooks de
  MercadoLibre, intentos técnicos de pago y cron, sin exponer payloads ni
  errores crudos. Sólo un superadmin puede reintentar una entrega descartada;
  pagos no se reintentan desde plataforma y el reintento deja auditoría.
- Las 63 Edge Functions pasan `deno check` desde CI. El descubrimiento sale del
  filesystem, por lo que una función nueva no puede quedar fuera del gate.

### Lo que todavía no se puede afirmar

- ARCA todavía no tiene una factura emitida por la aplicación en producción.
- El stock actual necesita conteo físico; los arreglos históricos no permiten
  tratarlo como una fuente confiable sin conciliación.
- La identidad legal del comercio sigue pendiente para publicar los textos
  legales generados.
- El onboarding de un segundo comercio todavía no es un camino repetible y
  medido.
- El ledger, los eventos de dominio y los cron necesitan más uso operativo y
  observabilidad antes de considerarse completos.
- Las APIs de transporte y MercadoLibre requieren validación comercial y
  operación multi-organización real.

## 3. Fases y condiciones de salida

### Fase 0 - Producto confiable y vendible

**Estado: activa.** Es la prioridad hasta que un comercio pueda operar sin
correcciones manuales y cerrar el ciclo venta, cobro, stock, documento y margen.

Debe quedar resuelto:

- ARCA real: certificado o delegación válida, una factura de prueba emitida por
  la aplicación y el ciclo de error verificado.
- Legal publicado: razón social, CUIT, domicilio, privacidad, términos y
  arrepentimiento cargados por el dueño y publicados conscientemente.
- Stock conciliado: conteo físico, ajuste con asiento y cero diferencias
  inexplicadas entre stock, Kardex y ubicaciones.
- Pagos: checkout, reintegro y webhook ya son idempotentes; ARCA reserva su
  secuencia y la recepción de compra parcial usa clave idempotente. Falta definir
  captura diferida si se incorpora un proveedor que la requiera y obtener
  evidencia sandbox/producción sin duplicar dinero ni stock.
- Funciones server-side: cada Edge Function debe pasar el chequeo de Deno en
  CI; cobros, webhooks, cotización y facturación no quedan fuera del typecheck.
- Operación observable: webhooks, crons, errores de pago y documentos con
  estado, reintento y responsable visible.

**Salida:** un comercio real puede vender, cobrar, descontar stock, emitir o
dejar documentado el comprobante, calcular margen y recuperar un fallo sin
intervención del equipo de desarrollo.

### Fase 1 - Segundo comercio y Control Plane

**Estado: siguiente objetivo.** La plataforma debe demostrar que el producto
funciona para más de una organización y que el staff puede operar el servicio
sin entrar a tablas ni usar SQL como panel administrativo.

Debe quedar resuelto:

- onboarding completo de un segundo comercio, con datos y métricas separadas;
- Merchant 360 para ver activación, ventas, riesgos, integraciones y próximos
  bloqueos de cada organización;
- registro de integraciones con estado, versión, scopes, health check, webhooks,
  último error y plan, sin mostrar secretos;
- centro de credenciales y conexiones con rotación, revocación y auditoría;
- billing, comisión por venta y estado de suscripción visibles para plataforma;
- cola operativa para fallos de pagos, webhooks, crons y sincronizaciones.

**Salida:** un segundo comercio completa onboarding y su primera venta sin
configuración manual en la base; el staff resuelve incidentes desde
`/platform` y puede explicar qué está pasando en cada organización.

### Fase 2 - Economía por canal y commerce competitivo

**Estado: después de Fase 1.** Acá se construye ventaja, no amplitud genérica.

- costo landed y margen por SKU, orden, canal y período;
- carrito y checkout server-authoritative, con envío y promociones recalculados
  en base;
- dominios, multitienda, temas y migradores con un solo catálogo subyacente;
- MercadoLibre con publicación, órdenes, sincronización y cron multi-org
  operados contra una cuenta real;
- POS offline robusto sólo cuando la cola, la reconciliación y la autoridad del
  servidor estén probadas;
- paneles de canal que expliquen por qué una venta deja o destruye margen.

**Salida:** el dueño decide qué vender y dónde venderlo con una comparación de
margen confiable, y una tienda nueva sale a producción sin duplicar catálogo ni
stock.

### Fase 3 - Documents e Intelligence

**Estado: diseñado, no prioritario todavía.**

- cuentas a pagar desde facturas y órdenes de compra;
- Document AI con extracción, validación y aprobación humana;
- Business Copilot conectado a productos, clientes, órdenes, pagos, stock y
  margen;
- recomendaciones con acción concreta y métrica de adopción `AI Action Rate`;
- alertas de reposición, clientes enfriándose, promociones y compras con
  explicación de la evidencia.

**Salida:** cada recomendación puede rastrearse a datos del Core, tiene una
acción ejecutable y se mide si el operador la acepta.

### Fase 4 - Ecosistema

**Estado: congelada hasta que Fase 2 sea repetible.**

APIs públicas, webhooks para terceros, marketplace de extensiones, partners y
white-label sólo entran cuando los contratos del Core estén estables y exista
un segundo comercio operando.

### Fase 5 - Escala que se gana

**Estado: futura.** Backups con restore probado, SLOs, límites por tenant,
observabilidad distribuida, colas durables, performance y despliegues seguros
se priorizan cuando el uso real lo justifique. Escalar infraestructura antes
de probar la operación sólo aumenta el costo de una mala decisión.

## 4. Cola priorizada

La cola es corta a propósito. Una tarea no entra porque sea interesante: entra
porque produce la evidencia de salida de una fase.

| Orden | Slice | Estado | Dependencia | Evidencia de salida |
|---:|---|---|---|---|
| 1 | ARCA real | Bloqueado externo | certificado o delegación del dueño | una factura de prueba de la app, CAE y error recuperable |
| 2 | Publicación legal | Bloqueado externo | razón social, CUIT y domicilio | páginas publicadas y visibles desde la tienda |
| 3 | Conciliación de stock | Bloqueado externo | conteo físico | ajuste trazable y Kardex sin diferencias |
| 4 | Segundo comercio | Siguiente | disponibilidad del negocio | primera venta sin SQL ni corrección manual |
| 5 | Matriz de pagos y guardia Edge | En curso, 2026-08-21 | escenarios de proveedor | checkout/reintegro/webhook, ARCA y recepción parcial ya tienen guardas; 63 funciones chequeadas. Falta evidencia sandbox/producción y captura diferida sólo si un proveedor la incorpora |
| 6 | Merchant 360 | Base ampliada, 2026-08-21 | señales de Core confiables | ficha operativa por organización con riesgos, próximos pasos y evidencia de conexión |
| 7 | Registro de integraciones 2 | En curso, 2026-08-21 | health checks activos y eventos | versión, scopes, webhook, error y plan por conexión |
| 8 | Centro de operaciones | Base hecha, 2026-08-21 | uso contra fallos reales | cola priorizada y reintento auditado de entrega descartada |
| 9 | Margen por canal | Pendiente | costos y comisiones reales | comparación de contribución por orden y canal |
| 10 | MercadoLibre real | Pendiente | cuenta y operación comercial | publicación, orden importada y conciliación multi-org |

Los puntos 1 a 3 requieren participación del dueño y no se pueden simular con
una pantalla. Si alguno está bloqueado por una decisión o credencial externa,
se documenta y se avanza sólo con slices que no oculten el bloqueo.

## 5. Control Plane

El panel de plataforma es una superficie operativa, no una segunda aplicación
de negocio. No debe editar datos del comercio por fuera de los servicios del
Core ni mostrar secretos.

| Slice | Estado | Próxima prueba |
|---|---|---|
| Platform Overview | Hecho, 2026-08-21 | sumar pagos, webhooks y colas como señales de primera clase |
| Merchant 360 | Base ampliada, 2026-08-21 | probar la ficha con una organización real y sumar health checks activos |
| Integration Registry | Base ampliada, 2026-08-21 | evidencia por comercio de conexión, vigencia y último evento; faltan health check, versión, webhook y plan operativos |
| Credential Control | Base hecha, 2026-08-21 | verificar con una organización real la rotación/revocación de Evolution sin exponer su valor |
| Billing y comisiones | Pendiente | conciliar comisión, suscripción y venta |
| Operations Queue | Base hecha, 2026-08-21 | verificar un reintento real de entrega y sumar resolución controlada de webhook/sync |

Cada vista de plataforma debe tener estado de carga, vacío, error, permiso
insuficiente y dato desactualizado. "Sin evidencia" no significa "todo bien".

## 6. Reglas técnicas no negociables

- El servidor y la base son autoridad para precio, stock, cupón, envío,
  comisión, impuestos y margen. El cliente manda identificadores y cantidades.
- El stock sólo se mueve por `record_stock_movement` y los caminos de base que
  lo invocan. Antes de tocar una venta, compra o transferencia se revisan los
  triggers existentes.
- No se usa `Math.max`, `GREATEST` ni corrección silenciosa para esconder stock
  negativo o diferencias de dinero.
- Los secretos viven en Edge Functions o tablas sin policies para el cliente.
  Las vistas públicas sólo devuelven estados sanitizados.
- RLS separa tenants y roles. Staff de plataforma y miembros de organización
  son permisos distintos.
- Un fallback sólo se permite cuando falta una relación o función compatible;
  un error de permisos, datos o conexión se muestra y se registra.
- Una vista nueva convive con la anterior hasta verificar todas sus superficies.
- Las migraciones llevan 14 dígitos, son idempotentes, se registran al aplicar
  y se regeneran los tipos después.
- No se prueba modificando datos reales sin respaldo y limpieza comprobable.
- Una migración no se considera terminada si el camino real no fue verificado
  con el rol que lo usará.
- Toda Edge Function pasa `npm run check:functions`; el script descubre los
  entrypoints del filesystem y Deno valida imports remotos y el Edge Runtime.

## 7. Experiencia de producto

La interfaz debe ayudar a decidir y operar, no convertir cada módulo en una
lista infinita.

- Cada página extensa se divide por sidebar, tabs internas o subrutas; la
  selección se conserva al cambiar de módulo y al volver del navegador.
- Dashboard e inicio muestran prioridades, bloqueos y acciones; no un mural de
  métricas sin contexto.
- Tablas, filtros, búsqueda y acciones mantienen estados de carga, vacío y
  error sin desplazar toda la pantalla.
- Organización, plataforma y tienda mantienen chrome, permisos y tono visual
  propios.
- El sistema visual usa jerarquía sobria, densidad operativa, espaciado
  consistente, estados accesibles y responsive real. No se agregan tarjetas
  decorativas ni texto de marketing a una pantalla de trabajo.
- Las referencias visuales son inspiración, no contratos de copia: [DashStack]
  (https://www.figma.com/design/MxTlGfApLOZJxXogeHKgjM/DashStack---Free-Admin-Dashboard-UI-Kit---Admin---Dashboard-Ui-Kit---Admin-Dashboard--Community-?node-id=0-1&p=f&t=GMDnm0HnYE48IqNN-0),
  [Ecommerce Admin Panel]
  (https://www.figma.com/es-la/comunidad/file/1290711303197535625/eccomerce-admin-panel),
  [Ecommerce App UI Kit]
  (https://www.figma.com/es-la/comunidad/file/1264098337558102933/ecommerce-app-ui-kit-case-study-ecommerce-mobile-app-ui-kit),
  [Marketplace Design]
  (https://www.figma.com/design/UXGJUCrBaYaIXTzRrg9HWd/Marketplace-Design--Community-?t=bteX9McfbQvxcmBs-0).

La calidad visual se valida junto con el flujo: una pantalla bonita que no
explica el estado del negocio no cumple el objetivo.

## 8. IA e integraciones

### Business Copilot

La IA no es un chat aislado ni un generador de descripciones. Toda capacidad
de IA tiene que declarar:

1. qué datos del Core consulta;
2. qué acción puede ejecutar el usuario;
3. qué permiso y confirmación necesita;
4. qué evidencia explica la recomendación;
5. cómo se mide adopción y resultado.

### Integraciones

Cada integración tiene un adaptador con configuración, credenciales, scopes,
health check, webhook, reintento, rate limit, auditoría y estado de
sincronización. El proveedor no se filtra por toda la aplicación ni crea tablas
paralelas de stock o clientes.

La integración se considera operativa cuando se verifica contra una cuenta real,
se puede reintentar y deja el mismo estado en el Core. La documentación de
MercadoLibre, logística, ARCA y cron se mantiene en sus documentos específicos.

## 9. Definition of Done

Cada slice sigue este orden:

1. identificar el contrato del Core y el tenant afectado;
2. traer remoto y elegir un número libre de migración;
3. migración idempotente y tipos regenerados;
4. verificación con base y rol reales, sin dejar datos de prueba;
5. UI conectada a la fuente de verdad con estados completos;
6. `typecheck`, `check:functions`, `lint`, tests y `build` en verde;
7. navegador contra `localhost` cuando exista `.env`;
8. actualizar este roadmap con estado, fecha y evidencia;
9. commit descriptivo y push explícito.

Puerta local:

```bash
set NODE_OPTIONS=--max-old-space-size=6144
npm run typecheck
npm run check:functions
npm run lint
npm test
npm run build
```

En Windows, los scripts `npm.cmd` son equivalentes. No usar `npx tsc --noEmit`:
el `tsconfig.json` raíz no chequea los archivos de la aplicación.

## 10. Fuera del foco actual

Quedan congelados hasta cumplir las salidas de Fase 0 y Fase 1:

- marketplace de extensiones y APIs públicas para terceros;
- nuevos módulos de RRHH, educación, sustentabilidad o franquicias;
- rediseños sin impacto en una decisión o flujo de operación;
- dashboards que sólo agregan KPIs sin acción ni fuente;
- IA generativa sin acción, permisos y métrica;
- escalado de infraestructura sin una señal de uso que lo justifique.

Esto no elimina una idea. La mantiene fuera del camino crítico para que el
producto pueda terminar lo esencial.

## 11. Bloqueos externos

Estos puntos necesitan una acción del dueño o de un proveedor:

- certificado o delegación de ARCA y prueba de homologación;
- razón social, CUIT y domicilio para publicar los textos legales;
- conteo físico del inventario;
- tarifas y contrato real de Correo Argentino o Andreani;
- credenciales de producción para servicios de email e IA;
- cuenta comercial de MercadoLibre para validar publicación y órdenes.

Un bloqueo externo se mantiene visible en esta lista y no se maquilla como
feature terminada.

## 12. Fuentes y memoria del proyecto

- [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md): tesis, mercado y decisiones de
  posicionamiento.
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): límites del Core y módulos.
- [docs/LEGAL.md](docs/LEGAL.md): obligaciones argentinas y publicación.
- [docs/permisos.md](docs/permisos.md): separación de roles y tenants.
- [docs/CONFIGURACION.md](docs/CONFIGURACION.md): secretos y variables.
- [docs/CRON.md](docs/CRON.md): jobs, vault y diagnóstico.
- [docs/MERCADOLIBRE.md](docs/MERCADOLIBRE.md): integración y pendientes.
- [docs/COMPARACION.md](docs/COMPARACION.md): brechas con referencias del
  mercado, siempre con fecha y nivel de verificación.
- `git log --oneline -20`: historial de slices ejecutados y evidencia técnica.

Cuando un dato o decisión cambie, se actualiza esta página y el documento
especializado correspondiente. No se vuelve a insertar aquí el historial de
sesiones: el roadmap tiene que seguir siendo legible para decidir el próximo
trabajo.
