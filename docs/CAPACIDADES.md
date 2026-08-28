# Capacidades — qué está construido, qué está probado y qué se usa

**Medido contra la base de producción el 2026-08-28.** Cada fila lleva el número
con el que se decidió su estado. Los comandos están al final para volver a
correrlo.

## Por qué existe este documento

Este repo tiene una tendencia clara: **la documentación describe código, no
realidad.** "Está construido" y "se probó contra el organismo" se leen igual en
un README, y de ahí sale la confusión más cara del proyecto — creer que algo
funciona porque el archivo existe.

Ya pasó dos veces con consecuencias:

- La firma del webhook de MercadoPago **nunca validaba**. El código estaba,
  compilaba y se veía correcto. Toda compra quedaba pagada del lado de
  MercadoPago e impaga del lado de la tienda, en silencio, hasta que alguien
  cobró de verdad.
- El chat de IA devolvía texto enlatado y guardaba `Math.random()` como uso de
  tokens. Existía, respondía, y no era IA.

Cuatro estados, y la diferencia entre ellos es **qué evidencia hay**:

| Estado | Qué significa | Qué evidencia hace falta |
|---|---|---|
| 🔨 **built** | El código existe, compila y pasa sus tests | El archivo y el test |
| 🔬 **verified** | Se ejercitó contra el sistema real —la base de producción, el proveedor, el organismo— y el resultado se puede volver a mirar | Una corrida reproducible: `drill:payments`, un bloque `DO` con datos `ZZ`, una respuesta del organismo |
| ⚙️ **operated** | Corrió en producción con datos reales al menos una vez, **fuera** de una verificación | Filas en la base que nadie creó para probar |
| 📈 **adopted** | Un comercio lo usa de forma repetida | Volumen sostenido, no un caso |

⚠️ **Los estados no son acumulativos por definición, sino por evidencia.** Algo
puede estar `operated` sin estar `verified` —pasó en producción pero nadie probó
sus bordes— y eso es peor que al revés, no mejor. Se marca lo que se puede
mostrar.

---

## El estado, hoy

### Business Core

| Capacidad | Estado | Evidencia (remedida 2026-08-28) |
|---|---|---|
| Catálogo de productos | 📈 adopted | 60 productos activos |
| Clientes / CRM | 📈 adopted | **25 clientes reales** (2026-08-27). Eran 34: nueve eran de prueba y se borraron en `20260827000130`, así que toda métrica sobre `customers` venía inflada un 26% |
| Ventas | 📈 adopted | 34 ventas |
| Inventario / Kardex | ⚙️ operated | 104 movimientos de stock (2026-08-28). ⚠️ **6 de ellos apuntan a ventas que ya no existen**, todos del 2026-07-31 —la época del descuento doble—. No se borran por código: el Kardex se concilia contando. El salto desde 40 es la reparación del costo de las 34 ventas del 2026-08-26, que revirtió y reaplicó cada una |
| Eventos de dominio (H2) | ⚙️ operated | 21 en `domain_events` |
| Toma física auditada | 🔨 built | **0 conteos cerrados**. El circuito `abrir/registrar/cerrar` está y se probó, pero nadie contó todavía — y contar es justamente lo que P0-03 necesita |
| Ledger financiero (H3) | ⚙️ operated | **56 asientos** (2026-08-28): ventas, gastos y cobranzas asentados y conciliados **exacto** contra la fuente operativa (ventas $1.143.696 = $1.143.696, costo $798.851, gastos $21.560, 0 descuadrados). `trg_sale_ledger`, `trg_expense_ledger` y `trg_debt_ledger` asientan lo nuevo solos; `operaciones_sin_asentar` = 0 y Deudores netea a $0 con las 3 deudas saldadas. El P&L lee de acá |

### Canales

| Capacidad | Estado | Evidencia (remedida 2026-08-28) |
|---|---|---|
| Tienda online pública | ⚙️ operated | 1 tienda publicada, 6 órdenes, 2 pagadas |
| POS | 🔨 built | **0 ventas con `source = 'pos'`** (sigue en 0 al 2026-08-27). El código lo escribe (`POSPage.tsx:979`), así que no es un bug de instrumentación: nadie vendió por mostrador. Las 32 ventas `manual` son carga a mano |
| MercadoLibre | 🔨 built | **0 conexiones, 0 publicaciones.** 5 tablas, 3 funciones y 3 Edge Functions construidas y sin una sola cuenta conectada. ⚠️ Construir más acá es construir a ciegas: no hay contra qué verificarlo |
| WhatsApp | 🔨 built | Sin medición de uso en esta pasada |

### Plata

| Capacidad | Estado | Evidencia (remedida 2026-08-28) |
|---|---|---|
| Cobro online (MercadoPago) | ⚙️ operated | 2 transacciones aprobadas, 1 conexión OAuth. Dos compras reales de $1 el 2026-07-31 |
| Comisión de plataforma | 🔬 verified | ⚠️ **Cambió el 2026-08-26: hoy SÍ cobra.** 0,5%, `is_active = true`, `approval_status = approved`, vigente desde el 26/8 — es la salida del economics gate P0-09. La fila anterior de este documento decía «0 activas → hoy no cobra nada» y quedó vieja en un día. Cobró dos veces con la regla de entonces (`application_fee: 0.05` informado por MercadoPago) |
| Gross profit por pago | 🔬 verified | 9/9 con el JWT de un admin real. Los únicos datos son los 2 pagos de $1 |
| Reintegros | 🔬 verified | **0 RMA reales.** 16/16 escenarios en `drill:payments`, incluidos monto mayor al cobrado y `NULL` no autoriza |
| Cuotas | ⚙️ operated | **2 planes cargados, 1 activo** (3 sin interés) al 2026-08-28. La fila anterior decía «0 configurados» y quedó vieja. El catálogo, el PDF de WhatsApp y la tienda **leían un texto fijo** «3 cuotas sin interés» sin mirar esta tabla; desde el 2026-08-27 salen de `cuotas_publicas`. 10/10 en verificación y `store-pay` valida antes de cobrar |
| Suscripción al SaaS | 🔨 built | 1 suscripción en **`past_due`**, plan `trial`, proveedor `mercadopago`. Precios en pesos cargados y ya visibles en la consola de plataforma (hasta el 2026-08-27 mostraba y filtraba por USD, así que `starter` —$19.900/mes, USD 0— figuraba **«Gratis»** y sumaba 0 al MRR). ⚠️ Sin cobro probado: `mp-subscribe` ahora deriva el token de `MP_APP_ID` + `MP_APP_SECRET` por `client_credentials`, pero ese camino **no se ejerció contra MercadoPago** |
| Idempotencia (H1) | 🔬 verified | `checkout_idempotente` y `timeout_sin_doble_cobro` en la matriz |

### Fiscal y legal

| Capacidad | Estado | Evidencia (remedida 2026-08-28) |
|---|---|---|
| Facturación ARCA | 🔬 verified | **Conexión probada contra el organismo el 2026-08-27**: `delegacion_verificada = true`, Ticket de Acceso de WSAA vigente, y `FECompUltimoAutorizado` respondió con el CUIT del comercio. Se puede volver a mirar (`delegacion_verificada_at`, `ta_expires_at`). ⚠️ Sigue en **0 comprobantes**: conectado no es emitido. Ver la nota de abajo |
| Notas de crédito | 🔬 verified | Contradocumentación verificada con datos `ZZ` |
| Páginas legales | 🔨 built | El generador escribe el borrador; falta que el dueño cargue razón social, CUIT y domicilio y publique |

⚠️ **Sobre ARCA, con precisión (actualizado 2026-08-27).**

La **conexión** pasó a 🔬 `verified` y la evidencia se puede volver a mirar:
`delegacion_verificada = true` con fecha 2026-08-27, Ticket de Acceso de WSAA
vigente en `afip_platform_credentials`, y `FECompUltimoAutorizado` respondiendo
con el CUIT del comercio. El panel dice «AFIP conectado».

Llegar ahí destapó cinco bugs encadenados —el TRA se declaraba 3 h en el futuro,
el ticket venía escapado y no se des-escapaba, el regex del faultcode no
aceptaba atributos, el ticket se podía perder, y la verificación decía `ok` sin
guardar nada—. Ninguno se veía desde el anterior.

⚠️ **Pero `afip_comprobantes` sigue en 0.** Conectado no es emitido: no queda
en la base ninguna evidencia del CAE 86330773876924 que CLAUDE.md declara
emitido en la sesión 114. La causa más probable es el borrado de las
organizaciones de prueba —de 4 quedaron 2—; no se investigó más porque la
salida es la misma: emitir una de nuevo. **La facturación no pasa a
`operated` hasta que haya un comprobante que alguien pueda abrir.**

### Operación

| Capacidad | Estado | Evidencia (remedida 2026-08-28) |
|---|---|---|
| Backups | ⚙️ operated | 10 snapshots |
| Crons | ⚙️ operated | 20 activos |
| Restore drill | 🔬 verified | `npm run drill:restore`, con RTO y RPO medidos |
| Aislamiento entre comercios | 🔬 verified | 260 tablas con `org_id` y RLS recorridas como usuario real no-staff: **0 fugas** en las 38 donde la otra organización tiene filas. Las 222 restantes no se pueden probar con datos —ninguna org tiene filas ahí— y por eso la garantía es estática: `audit_policies_sin_tenant` = 0 |
| Envíos | 🔨 built | 6 zonas y **tarifa en 1 sola**. 0 envíos preparados |
| API pública | 🔨 built | **0 API keys emitidas** |

### Avisos y seguridad de las tareas programadas (2026-08-28)

| Capacidad | Estado | Evidencia (2026-08-28) |
|---|---|---|
| Alertas del negocio | ⚙️ operated | **227 notificaciones**, 45 creadas el 2026-08-28 disparando `check-alerts` de verdad y contando filas. ⚠️ Hasta ese día **nunca había guardado ninguna**: informaba «45 creadas» y escribía 0 porque faltaba `org_id` (NOT NULL) y el `.error` no se miraba. Además avisaba sólo a los `admin`, dejando afuera al dueño —y un comercio de una sola persona no recibía nada—, y deduplicaba entre personas, así que un aviso que ya había visto otro no llegaba nunca |
| Aviso por correo | 🔬 verified | Cadena completa probada de punta a punta: aviso marcado → cola → `avisos-por-correo` devuelve `enviados: 1` → `email_enviado_at` estampado para no reenviarlo. ⚠️ Hasta el 2026-08-28 **0 avisos se marcaban**: el mecanismo existía sin haberse usado una vez. Hoy lo piden cuatro —acceso de soporte, trial por vencer, suspensión por límite de plan y cambio de precio— con el criterio de «dónde puede leerlo la persona» |
| Tareas programadas autenticadas | 🔬 verified | Las **19** funciones de cron devuelven **401** a una request sin credenciales, y `invoke_edge_function` recibe **200**. ⚠️ Antes no había nada que distinguiera al cron de cualquiera con la URL: se podía disparar spam a los clientes de todos los comercios, crear gastos ajenos y correr automatizaciones, gratis y desde afuera |
| Cupo de IA por plan | 🔨 built | `org_entitlements` devuelve `ia_cupo_mensual`/`ia_usado`/`ia_restante`, siete funciones registran el consumo y el corte está en el servidor. ⚠️ **`ai_usage_stats` sigue en 0 filas** porque `ANTHROPIC_API_KEY` no está configurada: no se pudo probar que la función deployada registre. Verificado sí el SQL, el permiso en los dos sentidos y que las 7 responden |
| Buzón documental de Finance | 🔨 built | ⚠️ **0 documentos**, y hasta el 2026-08-28 era imposible cargar uno: tres funciones del circuito cortaban con `42702 column reference is ambiguous`. Finance está **habilitado** desde el 2026-08-22. Corregido y comprobado que el error desapareció; falta que alguien suba el primer archivo |

### Inteligencia

| Capacidad | Estado | Evidencia (remedida 2026-08-28) |
|---|---|---|
| Recomendaciones de oferta | 🔨 built | 25 generadas, **0 aplicadas**. El `AI Action Rate` es 0% y ése es el número que importa, no cuántas se generan |
| Chat / copiloto | 🔨 built | ⚠️ Falta `ANTHROPIC_API_KEY` en los secretos: hoy responde error |

### Tienda — features de conversión

| Capacidad | Estado | Evidencia (remedida 2026-08-28) |
|---|---|---|
| Reseñas de compra verificada | 🔨 built | 0 reseñas |
| Preguntas sobre el producto | 🔨 built | 0 preguntas |

---

## Cómo leer este cuadro antes de lanzar

📌 **Hay una sola organización a propósito.** El producto todavía no se lanzó:
el dueño está probándolo de punta a punta con su propio comercio y abre a otros
cuando esté todo bien. Eso cambia cómo se lee la tabla.

⚠️ **`adopted` no es una meta hoy, y `built` no es una falla.** Que
MercadoLibre tenga 0 conexiones o que la API pública tenga 0 keys no es deuda:
es que todavía no se abrió. Perseguir esos ceros sería trabajar contra el plan.

**Lo que sí importa antes de lanzar es que nada esté roto.** Y para eso la
columna que manda es la distancia entre 🔨 y 🔬: una capacidad `built` que nunca
se ejercitó contra el sistema real es una que puede fallar el primer día con un
comercio de verdad mirando. Ahí es donde aparecieron, esta semana, el guard de
reintegros que un NULL salteaba y las cinco policies que dejaban leer el
catálogo propio de otro comercio.

### Lo que bloquea el lanzamiento, medido el 2026-08-28

Ninguna de estas se resuelve escribiendo código. Están en orden de cuánto
duele que falte.

1. **ARCA en producción.** Es lo único que impide facturar en Argentina. Falta
   el certificado de producción y el alta del punto de venta como *Web
   Services*. Y conviene **emitir una en homologación y dejarla**: hoy no queda
   ningún comprobante en la base con el que demostrar que el circuito cierra.

2. **`ANTHROPIC_API_KEY` no está en los secretos** (medido con
   `supabase secrets list`). ⚠️ Toda la IA responde error: el copiloto, las
   descripciones, el análisis, las recomendaciones. Y como no corre, tampoco se
   pudo probar que el cupo por plan registre el consumo — el circuito está
   construido y verificado en SQL, pero le falta el último tramo.
   📌 Es además el diferencial declarado del producto: sin esa clave, la
   demostración que separa a Gestiona de un ecommerce no existe.

3. **Contar el inventario** (P0-03). El Kardex no es confiable desde el
   descuento doble, y ningún código lo arregla: se corrige contando. Hoy hay
   además **6 movimientos huérfanos** del 2026-07-31 apuntando a ventas
   borradas.

4. **Las tarifas de envío.** 6 zonas activas y tarifa en **1 sola**. Con el
   retiro en local habilitado, las otras 5 no ven «no hay envío»: ven una única
   opción —ir a buscarlo a CABA—, que parece un checkout que funciona. El botón
   «Completar el tarifario» las estima; falta contrastarlas con el correo real.

5. **WhatsApp no tiene número.** `whatsapp_listo = false`,
   `whatsapp_proveedor = 'ninguno'`. La integración es la API oficial de Meta y
   necesita un número y un token de la plataforma.

⚠️ **Y un riesgo que no es un bloqueador pero se cobra solo: 36 de 60
imágenes del catálogo viven en otro proyecto Supabase.** Hoy responden 200,
pero `wcfohngxrtopgggumjmw` no está en ninguna configuración, no entra en los
backups del proyecto actual, y Supabase pausa los proyectos gratuitos por
inactividad —servir imágenes estáticas puede no contar como actividad—. El día
que se pause, la tienda pierde el 60% de las fotos **en silencio**: el navegador
muestra un hueco, no un error.

📌 Se ve con `audit_imagen_en_otro_proyecto`, que a diferencia de las demás
vistas de auditoría **no tiene que estar vacía**: describe algo que sigue ahí.
Moverlas es descargar y subir archivo por archivo —subir, comprobar que la URL
nueva responde 200, y recién entonces actualizar la fila—, y eso toca el
catálogo real, así que es decisión del dueño.

📌 **El correo SÍ sale, y eso cambió.** `platform_messaging_config` tiene
`smtp_configurado = true` con Gmail (`smtp.gmail.com:465`), y el envío se probó
de punta a punta el 2026-08-28. ⚠️ Pero `email_dominio` está en NULL: sale desde
una casilla de Gmail, no desde un dominio propio. Alcanza para avisos
transaccionales a un puñado de comercios; **no alcanza para campañas** —una
cuenta personal de Gmail tiene tope diario y termina en spam—. Verificar un
dominio sigue pendiente, pero ya no es un bloqueador: es un techo.

Y una que sí es código pero depende de un secreto: la suscripción no cobra
hasta que el token de plataforma funcione.

⚠️ **`MP_APP_ID` no es un token.** Es el identificador público de la
aplicación y no autentica ninguna llamada; confundirlos hace perder una tarde.
Pero no hace falta cargar un secreto nuevo: con `MP_APP_ID` + `MP_APP_SECRET`
—los que ya usa `mp-connect` para el OAuth de los comercios— MercadoPago
entrega un token por `client_credentials`, y actúa sobre la cuenta **dueña de
la aplicación**, que es la de la plataforma. `MP_PLATFORM_ACCESS_TOKEN` sigue
teniendo prioridad si está cargado.

📌 **Escrito según la documentación del proveedor, no ejercido.** Los secretos
viven en el entorno de las Edge Functions y no se pueden leer desde el repo, así
que este camino se confirma contratando una suscripción de prueba — y hasta
entonces la fila de arriba se queda en 🔨 `built`.

⚠️ Y lo que este cuadro **no** mide: latencia, error rate, P95. Eso es P0-07 y
necesita un exporter que hoy no existe. Un estado `operated` acá significa "pasó
al menos una vez", no "anda bien bajo carga".

---

## Cómo se vuelve a medir

Las cantidades salen de consultas directas a producción. El bloque completo está
en el commit que creó este archivo; las que más se repiten:

```bash
npm run db -- --sql "select source, count(*) from public.sales group by source"
npm run db -- --sql "select count(*) from public.invoices"
npm run db -- --sql "select count(*) from public.ai_offer_recommendations where status='applied'"
```

Sin `SUPABASE_DB_URL` en la máquina, lo mismo con el CLI:

```bash
npx supabase db query --linked --file consulta.sql
```

📌 **Al actualizar este documento, cambiar también la fecha del encabezado.** Un
estado sin fecha es exactamente el problema que este archivo viene a resolver.
