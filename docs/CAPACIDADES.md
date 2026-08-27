# Capacidades — qué está construido, qué está probado y qué se usa

**Medido contra la base de producción el 2026-08-26.** Cada fila lleva el número
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

| Capacidad | Estado | Evidencia (2026-08-26) |
|---|---|---|
| Catálogo de productos | 📈 adopted | 60 productos activos |
| Clientes / CRM | 📈 adopted | 34 clientes |
| Ventas | 📈 adopted | 34 ventas |
| Inventario / Kardex | ⚙️ operated | 40 movimientos de stock |
| Eventos de dominio (H2) | ⚙️ operated | 21 en `domain_events` |
| Toma física auditada | 🔨 built | **0 conteos cerrados**. El circuito `abrir/registrar/cerrar` está y se probó, pero nadie contó todavía — y contar es justamente lo que P0-03 necesita |
| Ledger financiero (H3) | ⚙️ operated | **48 asientos** (2026-08-26): ventas, gastos y cobranzas asentados y conciliados **exacto** contra la fuente operativa (ventas $1.143.696 = $1.143.696, costo $798.851, gastos $21.560, 0 descuadrados). `trg_sale_ledger`, `trg_expense_ledger` y `trg_debt_ledger` asientan lo nuevo solos; `operaciones_sin_asentar` = 0 y Deudores netea a $0 con las 3 deudas saldadas. El P&L lee de acá |

### Canales

| Capacidad | Estado | Evidencia (2026-08-26) |
|---|---|---|
| Tienda online pública | ⚙️ operated | 1 tienda publicada, 6 órdenes, 2 pagadas |
| POS | 🔨 built | **0 ventas con `source = 'pos'`**. El código lo escribe (`POSPage.tsx:979`), así que no es un bug de instrumentación: nadie vendió por mostrador. Las 32 ventas `manual` son carga a mano |
| MercadoLibre | 🔨 built | **0 conexiones, 0 publicaciones.** 5 tablas, 3 funciones y 3 Edge Functions construidas y sin una sola cuenta conectada. ⚠️ Construir más acá es construir a ciegas: no hay contra qué verificarlo |
| WhatsApp | 🔨 built | Sin medición de uso en esta pasada |

### Plata

| Capacidad | Estado | Evidencia (2026-08-26) |
|---|---|---|
| Cobro online (MercadoPago) | ⚙️ operated | 2 transacciones aprobadas, 1 conexión OAuth. Dos compras reales de $1 el 2026-07-31 |
| Comisión de plataforma | 🔬 verified | **0 reglas aprobadas, 0 activas** → hoy no cobra nada. Cobró dos veces con la regla vigente entonces (`application_fee: 0.05` informado por MercadoPago) |
| Gross profit por pago | 🔬 verified | 9/9 con el JWT de un admin real. Los únicos datos son los 2 pagos de $1 |
| Reintegros | 🔬 verified | **0 RMA reales.** 16/16 escenarios en `drill:payments`, incluidos monto mayor al cobrado y `NULL` no autoriza |
| Cuotas | 🔬 verified | **0 planes configurados.** 10/10 en verificación, y `store-pay` valida antes de cobrar |
| Suscripción al SaaS | 🔨 built | 1 suscripción en **`past_due`**, plan `trial`, proveedor `mercadopago`. Precios en pesos cargados; falta el secreto `MP_PLATFORM_ACCESS_TOKEN` |
| Idempotencia (H1) | 🔬 verified | `checkout_idempotente` y `timeout_sin_doble_cobro` en la matriz |

### Fiscal y legal

| Capacidad | Estado | Evidencia (2026-08-26) |
|---|---|---|
| Facturación ARCA | 🔨 built | ⚠️ Ver la nota de abajo |
| Notas de crédito | 🔬 verified | Contradocumentación verificada con datos `ZZ` |
| Páginas legales | 🔨 built | El generador escribe el borrador; falta que el dueño cargue razón social, CUIT y domicilio y publique |

⚠️ **Sobre ARCA, con precisión.** `afip_credentials` tiene **1 fila, ambiente
`homologacion`**: el certificado está cargado. Pero `invoices` y
`afip_comprobantes` están **los dos en 0**, así que hoy **no queda en la base
ninguna evidencia** del CAE 86330773876924 que CLAUDE.md declara emitido en la
sesión 114.

Eso no dice que no haya pasado —el número está escrito en un commit de ese día—
pero sí que **no se puede volver a mirar**, y ésa es la diferencia entre 🔬
`verified` y una afirmación. Se queda en 🔨 `built` hasta que haya un comprobante
en la base que alguien pueda abrir. La causa más probable es el borrado de las
organizaciones de prueba de esta semana; no se investigó más porque la salida es
la misma: emitir una de nuevo.

### Operación

| Capacidad | Estado | Evidencia (2026-08-26) |
|---|---|---|
| Backups | ⚙️ operated | 10 snapshots |
| Crons | ⚙️ operated | 20 activos |
| Restore drill | 🔬 verified | `npm run drill:restore`, con RTO y RPO medidos |
| Aislamiento entre comercios | 🔬 verified | 260 tablas con `org_id` y RLS recorridas como usuario real no-staff: **0 fugas** en las 38 donde la otra organización tiene filas. Las 222 restantes no se pueden probar con datos —ninguna org tiene filas ahí— y por eso la garantía es estática: `audit_policies_sin_tenant` = 0 |
| Envíos | 🔨 built | 6 zonas y **tarifa en 1 sola**. 0 envíos preparados |
| API pública | 🔨 built | **0 API keys emitidas** |

### Inteligencia

| Capacidad | Estado | Evidencia (2026-08-26) |
|---|---|---|
| Recomendaciones de oferta | 🔨 built | 25 generadas, **0 aplicadas**. El `AI Action Rate` es 0% y ése es el número que importa, no cuántas se generan |
| Chat / copiloto | 🔨 built | ⚠️ Falta `ANTHROPIC_API_KEY` en los secretos: hoy responde error |

### Tienda — features de conversión

| Capacidad | Estado | Evidencia (2026-08-26) |
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

Las dos cosas que hoy bloquean el lanzamiento y **no** se resuelven con código:

1. **ARCA en producción.** Es lo único que impide facturar en Argentina. Falta
   el certificado de producción y el alta del punto de venta como *Web
   Services*. Y conviene **emitir una en homologación y dejarla**: hoy no queda
   ningún comprobante en la base con el que demostrar que el circuito cierra.
2. **Contar el inventario** (P0-03). El Kardex no es confiable desde el
   descuento doble, y ningún código lo arregla: se corrige contando.

Y una tercera que sí es código, pero depende de un secreto: la suscripción no
cobra hasta que exista `MP_PLATFORM_ACCESS_TOKEN`.

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
