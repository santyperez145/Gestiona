# Gestiona — contexto para Claude Code

**El sistema donde el negocio es uno solo, aunque venda por muchos lados.** El
mostrador, la tienda online y los marketplaces comparten el mismo stock, los
mismos clientes, los mismos costos y la misma verdad sobre cuánto se ganó.

En concreto: sistema de gestión completo (stock, POS, finanzas, multi-tienda,
canjes con influencers, marketing) **más** tiendas online que venden de verdad,
**más** un panel desde el que se administran todas las organizaciones y se cobra
comisión por venta.

⚠️ **La tienda no es el producto**, y describirlo como "alternativa a
Tiendanube" orienta mal las decisiones: lleva a competir donde se pierde. El
diferencial es que **el margen real por canal necesita cuatro datos a la vez**
—costo con aduana, comisión del medio de pago, envío e IVA— y acá están los
cuatro porque el proyecto nació importando. Un ecommerce no sabe el costo; un
ERP no sabe la comisión. Ver [docs/ESTRATEGIA.md](docs/ESTRATEGIA.md).

📌 **Lineamiento 2026-08-14:** Gestiona se piensa como **sistema operativo para
comercios omnicanal**, no como creador de tiendas. El corazón es el Business
Core —productos, órdenes, clientes, finanzas e inventario— y POS, tienda,
MercadoLibre, WhatsApp y futuras integraciones son canales alrededor de ese
núcleo. Si un módulo intenta inventar su propio stock, precio, margen, cobro o
cliente, va contra la arquitectura.

Tres superficies separadas, y esa separación es deliberada:

| Superficie | Ruta | Quién | Chrome |
|---|---|---|---|
| Organización | `/` | `memberships` | `AppLayout`, acento dorado |
| Plataforma | `/platform` | `platform_admins` | `PlatformLayout`, acento violeta |
| Tienda pública | `/tienda/:slug` | comprador anónimo | `StoreLayout` |

Ser staff de plataforma **no** otorga permisos dentro de una organización. Ver
[docs/permisos.md](docs/permisos.md).

⚠️ **Antes de tocar precios, datos de clientes o el panel de plataforma, leer
[docs/LEGAL.md](docs/LEGAL.md).** Es el relevamiento contra la normativa
argentina, requisito por requisito. El botón de arrepentimiento y el link a
Defensa del Consumidor ya están (sesión 108), y el generador de páginas legales
escribe la política de privacidad y los términos (sesión 109) — **falta que el
dueño cargue razón social, CUIT y domicilio, y publique**. Se generan como
borrador a propósito: publicar un texto legal por él sería firmarlo en su
nombre.

¿Arrancando de cero? [docs/GUIA.md](docs/GUIA.md) explica la plataforma y el
código para alguien sin experiencia, con un orden de estudio y ejercicios sobre
los archivos de este repo.

---

## ⚠️ Antes de escribir código

**Se trabaja desde dos PCs en paralelo.** El remoto avanza sin aviso.

```bash
git fetch origin
git log --oneline main..origin/main   # qué hay en el remoto que no tengo
git log --oneline origin/main..main   # qué tengo sin pushear
```

Si el remoto está adelante, **leer los títulos de los commits antes de
planificar**. Una vez se construyó un checkout completo de tienda online que ya
existía mejor hecho en el remoto, y hubo que descartarlo. Si el trabajo propio
colisiona, **preguntar cuál implementación sobrevive** — es decisión de producto,
no de merge.

---

## Cómo se trabaja acá

Esta sección existe para que cualquier sesión, en cualquier PC, arranque con el
mismo criterio. No es estilo: cada regla salió de algo que se rompió.

**No caer en "ERP feature factory".** El modo de falla de este proyecto no es
quedarse corto: es agregar. Antes de construir algo nuevo, ubicarlo en uno de
los cinco pilares del `ROADMAP.md`: productos/inventario, POS/caja, ecommerce,
clientes/ventas o inteligencia. Si no acerca a un segundo comercio real a su
primera venta, no fortalece el stock único, no muestra margen por canal, no
reduce riesgo o no mide uso/tracción, queda congelado aunque sea buena idea.

**La IA no es un chatbot decorativo.** El objetivo es Business Copilot: detectar
qué comprar, qué canal deja menos margen, qué clientes se enfrían y qué promo
conviene ejecutar. Cada recomendación útil debería tener una acción posible y,
después, una métrica de adopción (`AI Action Rate`). Generar descripciones es
comodity; operar con el grafo del negocio es el diferencial.

**Una feature no está hecha hasta que se probó contra la base real.** No hay
staging. El patrón, que ya encontró cinco bugs que ningún test unitario iba a
encontrar, está más abajo en "Verificación". La última fila del `SELECT` cuenta
los restos y tiene que dar `0`.

**El navegador se verifica contra `localhost`, no contra Vercel.** El deploy va
del `git push`, así que hasta que no se pushea, el sitio publicado tiene el
código viejo aunque las migraciones ya estén aplicadas. Verificar contra
`exentryimports.vercel.app` da falsos negativos garantizados.

⚠️ **Pero eso necesita un `.env`, y no está en las dos PCs.** Sin
`VITE_SUPABASE_URL` el cliente se construye con la URL vacía (ver
`src/integrations/supabase/client.ts`) y la app levanta pero no se conecta a
nada: la tienda pública dice "Tienda no encontrada" con la tienda activa en la
base. **Eso no es un bug, es la falta del archivo** — y confundirlo cuesta una
hora. Comprobar antes de planificar una verificación en navegador:

```bash
ls .env .env.local 2>/dev/null || echo "sin .env: el navegador no llega a la base"
```

Sin `.env`, lo único que el navegador prueba es que compila y que no hay errores
de consola. Todo lo demás se verifica contra la base, y conviene hacerlo
ejecutando como el rol real (`SET LOCAL ROLE anon` o `authenticated` con
`request.jwt.claims`) para que la RLS se evalúe de verdad y no como superusuario.

**No se toca dato real del negocio para verificar.** Ya pasó: para probar el
aviso de reposición se puso en cero el stock de un perfume y el valor original
se perdió — `stock_movements` no lo tenía. Si hace falta un producto agotado,
se crea uno `ZZ` y se borra; si no hay más remedio que tocar uno real, se
**guarda el valor antes** en la tabla temporal del test.

**El stock lo mueve la base, y sólo la base. El cliente nunca escribe
`products.stock`.** No es una preferencia de estilo: se rompió dos veces por lo
mismo. La segunda fue peor — `addSaleDB`, `addSaleWithVariantDB` y
`addPurchaseDB` ajustaban el stock **después** de insertar la fila, que ya había
disparado el trigger, así que **vender 3 unidades bajaba 6 y comprar 5 subía
10**, en el POS, en Ventas, en Presupuestos y en el chat de IA. Estuvo así
meses; se veía en el Kardex en negativo con el stock real positivo, porque los
números se venían corrigiendo a mano.

`trg_sale_stock_movement` y `trg_purchase_stock_movement` cubren INSERT, UPDATE
y DELETE, y `record_stock_movement` es el único lugar que toca `products.stock`,
`product_variants.stock` y `location_stock`. Para mover stock por un camino
nuevo, se llama a esa función — no se escribe la columna.

La regla general: **antes de tocar stock o totales, buscar el trigger.**

```bash
npm run db -- --sql "select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal"
```

Y **no tapar el resultado con `GREATEST(0, ...)` ni `Math.max(0, ...)`**: eso fue
lo que hizo que el descuento doble pasara desapercibido y lo que permitió que
una transferencia entre sucursales inventara 40 unidades. Un stock negativo es
un dato que hay que mirar. La vista `stock_negativo` tiene que estar vacía.

**Una vista nueva no reemplaza a una existente: convive con ella.** Cambiarle el
filtro por abajo a `catalog_products` habría afectado al catálogo por WhatsApp
y a la página pública. La tienda lee `store_catalog_products`, hermana y sin el
filtro de stock. Mismo criterio para los RPC.

**No tragarse errores.** Un `?? []` convierte "no tengo permiso" en "no hay
nada", y son problemas opuestos. Se distingue el error de relación inexistente
(`42P01`/`42883`/`PGRST205`/`PGRST202`, que sí justifica el fallback) de
cualquier otro, que se reporta.

**Los tests guardia mandan.** `publicSurface`, `edgeFunctionAuth` y
`moduleMap` no son burocracia: `edgeFunctionAuth` falló apenas apareció una
función nueva que manda emails, antes de que llegara a producción. Si uno falla,
se arregla el código o se documenta el motivo en la allowlist — nunca se afloja
el test.

**Los números medidos van con la fecha o con el comando al lado.** Este repo es
público y su documentación se lee de afuera: un análisis externo citó "418 tests
unitarios" tomándolo de una línea vieja de `ROADMAP.md` cuando ya eran 811. Un
número sin fecha se convierte en el dato que otros repiten.

**Antes de afirmar algo sobre un competidor, verificarlo o marcarlo como no
verificado.** "Tiendanube no tiene POS" era cierto y puede haber dejado de serlo
en 2026. En `docs/ESTRATEGIA.md` cada afirmación va marcada ✅ medido, 📌 criterio
o ❓ sin verificar, y esa separación se mantiene.

**Los mensajes de commit son largos a propósito.** Explican *por qué* se hizo
así y *qué encontró la verificación*, no qué archivos cambiaron. El estado del
proyecto vive ahí y en `ROADMAP.md`; `git log --oneline -20` es el resumen.

**Pushear es una decisión explícita.** Se commitea siempre, se pushea cuando el
dueño lo pide: el push dispara el deploy de producción en Vercel.

**Trabajo en slices.** Cada slice es migración → verificación en producción →
UI → puerta completa (`typecheck` + `lint` + `test` + `build`) → navegador →
commit → `ROADMAP.md`. No se acumulan tres features sin commitear.

---

## Reglas del repo

**El CI es bloqueante.** Antes de cada commit:

```bash
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck && npm run lint && npm test
```

**No usar `npx tsc --noEmit`.** El `tsconfig.json` raíz tiene `"files": []` y
sólo `references`, así que ese comando sale con éxito **sin chequear un solo
archivo** — daba verde siempre. Por eso llegaron a producción errores que
rompían páginas enteras (un `DialogFooter` sin importar dejó Productos en
pantalla blanca). `npm run typecheck` apunta a `tsconfig.app.json` y sí chequea;
el `NODE_OPTIONS` no es opcional, sin él se queda sin memoria a los 6 minutos
(`types.ts` tiene ~20 mil líneas).

`lint` tolera ~140 warnings de `exhaustive-deps`: son deuda conocida y **no se
tocan en masa** (provoca loops de refetch). Errores: cero.

**Los flujos se cubren con Playwright, los cálculos con vitest.** Los **811**
unitarios (`npm test`, 2026-08-13) verifican cuentas; los bugs que costaron plata fueron todos de
integración y ninguno los habría agarrado. Los E2E viven en `e2e/` y leen la
base de producción, así que son **de sólo lectura**: ninguno crea una orden.

```bash
npm run test:e2e            # chromium + un teléfono
npx playwright install      # la primera vez, baja el navegador
```

Corren contra `localhost` levantando el dev server solo. `E2E_BASE_URL` apunta
a otro lado si hace falta. Vitest sólo mira `src/**`, así que no se pisan.

**Los specs del panel necesitan un usuario de prueba.** Sin él se saltean y la
suite sigue verde — un test rojo por falta de configuración enseña a ignorar
los tests rojos. Para activarlos, crear un usuario en Supabase (Authentication
→ Add user, con "Auto Confirm"), darle membresía `owner` o `admin` en la
organización, y exportar:

```bash
export E2E_USER=pruebas@tudominio.com
export E2E_PASSWORD=...
```

`auth.setup.ts` inicia sesión **contra la API, no contra el formulario**, y
guarda la sesión en `e2e/.auth/usuario.json` para que el resto la reuse. Ese
archivo es un token válido y está en `.gitignore`: se trata como cualquier otro
secreto. La contraseña nunca se imprime, ni siquiera cuando el login falla.

Ese usuario es de prueba y ve datos reales de producción: conviene que no tenga
más permisos de los que el spec necesita.

**Los cálculos de plata van a funciones puras testeadas**, nunca inline:
`businessCalc.ts`, `shippingCalc.ts`, `paymentFees.ts`, `storeReadiness.ts`.
Cuando la misma cuenta existe en SQL (para que el servidor sea la autoridad), el
comentario de cada lado dice que son espejos.

**Las imágenes se suben por archivo, nunca por URL pegada.** `ImageUpload` es
el componente único: elegir, arrastrar o pegar, y comprime en el navegador
antes de subir — una foto de teléfono pesa 3 a 8 MB y un banner así arruina la
carga de la home. Las reglas puras viven en `imageUpload.ts` con 19 tests.
Pedir una URL obliga a subir el archivo a otro lado primero y termina en
banners que apuntan a un Drive que alguien despublica.

⚠️ **El repo compila con `strictNullChecks: false`.** TypeScript no estrecha
uniones discriminadas por booleano: un `{ok:true} | {ok:false;motivo}` deja
`motivo` inaccesible en la rama del error. Usar un objeto con el campo
opcional.

**Nada de precios ni stock desde el cliente.** El checkout manda ids y
cantidades; precios, stock, cupones, envío y comisiones se recalculan en la base.

---

## Migraciones

### ✅ `db push` volvió a servir — y hay que mantenerlo así

Durante meses fue un comando prohibido: el libro estaba 168 atrás y un `push`
habría corrido la migración que dropea tablas. Al 2026-08-02 está reconciliado:
**268 archivos, 268 registradas, brecha 0**, y el CLI lo confirma.

```bash
npx supabase db push --linked --dry-run
# {"upToDate":true,"migrations":[],"message":"Remote database is up to date."}
```

⚠️ **Al 2026-08-05 volvió a romperse, y por el camino inverso.** Hay **cinco
migraciones anotadas en el libro sin archivo en el repo**:

    20260802000009  preguntas_producto
    20260802000010  salud_por_organizacion
    20260805000001  promo_llevando_2
    20260805000002  categorias_de_tienda
    20260805000003  menu_de_tienda

Los objetos **están en la base** —`product_questions`, `platform_org_health`,
`ecommerce_categories`, `store_promo_2x_discount` y sus RPC— pero los archivos no
están en `main` ni en ninguna rama del remoto. Se aplicaron con `db query --file`
y se anotaron, y nunca se commitearon.

Consecuencias, en orden de gravedad:

1. **Ese trabajo no está versionado.** Si la base se reconstruye, se pierde.
2. `db push` vuelve a abortar con `LegacyDbPushMissingLocalError`.
3. La sugerencia que imprime el CLI —`migration repair --status reverted`— es
   **la peor salida posible**: marcarlas como revertidas haría que un `push`
   las quiera correr de nuevo, y no hay archivo que correr.

La salida correcta es que la PC que las aplicó commitee los archivos. Si eso no
pasa, se reconstruyen desde el catálogo, pero conviene coordinarlo antes para no
terminar con dos versiones del mismo objeto con números distintos.

**Ese `--dry-run` es el chequeo de salud del libro.** Si algún día devuelve
migraciones en la lista, el libro se volvió a desfasar y hay que mirar por qué
antes de correr nada.

Se llegó ahí por tres caminos, y conviene saber cuál aplica a cada problema:

**1. Reconciliar lo aplicado sin registrar** —
`scripts/reconciliar-migraciones.mjs`:

```bash
node scripts/reconciliar-migraciones.mjs             # informe, no escribe
node scripts/reconciliar-migraciones.mjs --detalle   # + qué objeto falta
node scripts/reconciliar-migraciones.mjs --registrar # anota las confirmadas
```

Deduce si una migración está aplicada extrayendo del archivo los objetos que
crea y preguntándole al catálogo cuáles existen. Ignora lo que esté dentro de un
bloque `DO`: ahí el SQL se arma con `format()` y los nombres no están escritos,
así que buscarlos daría falsos negativos.

**2. Los nombres de archivo tienen que tener 14 dígitos exactos.** Es lo que
espera el CLI, y era el bloqueo real que quedaba después de reconciliar: con 8,
10 o 16 dígitos el archivo le resulta **invisible**, y entonces la versión que sí
está en el libro "no existe localmente" y aborta con
`LegacyDbPushMissingLocalError`. Se renombraron 12 preservando el orden
lexicográfico y actualizando el libro en la misma pasada.

**3. Lo que no va a correr nunca, se borra del repo.** Había 13 migraciones que
creaban módulos sacados del producto (`sla_rules`, `elearning`,
`carbon_footprint`, `franchise_management`, `hr_portal`…). No estaban aplicadas
y sus 44 tablas no existen ni las usa ningún código, así que dejarlas sólo servía
para que un `db push` **resucitara** módulos muertos. Están en la historia de git
si alguna vez hacen falta.

**La destructiva se aplicó** (2026-08-02). Dropeó 57 tablas de módulos retirados
que entre todas tenían **0 filas**. La documentación decía "aplicarla sin backup
borra datos"; no había ninguno, y ese rótulo fue lo único que la frenó un año.
Se verificó antes que ningún código las referenciara, y después que el `CASCADE`
no se hubiera llevado nada de la tienda pública: las 15 relaciones y funciones
del storefront siguen ahí y `get_store_by_slug` responde como rol `anon`.

⚠️ **Que `db push` sirva no lo vuelve el camino por default.** Sigue siendo más
seguro `db query --file` para aplicar una migración y verificarla en el mismo
paso, sobre todo porque permite correr los bloques `DO` de verificación. Lo que
cambia es que ya no es un comando que destruye la base si alguien lo tipea.

Al aplicar una migración a mano, **anotarla** — es lo que evita volver al pozo:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260731000021', 'order_shipping') ON CONFLICT DO NOTHING;
```

Es lo único que frena que la brecha siga creciendo.

Lo que se usa en la práctica, y funciona sin credenciales extra porque el
proyecto ya está linkeado:

```bash
npx supabase db query --linked --file supabase/migrations/2026XXXX_lo_que_sea.sql
```

Sirve para aplicar la migración **y** para correr los bloques de verificación.
Cada archivo tiene que ser idempotente (`IF NOT EXISTS`, `DROP POLICY IF
EXISTS`, `CREATE OR REPLACE`) porque se corre más de una vez.

Alternativa manual: `supabase/00_diagnostico.sql` → `01_aplicar_pendientes.sql`
→ `02_verificar.sql` pegados en el SQL Editor, o `npm run db -- --file x.sql`.

**Consecuencia que ya causó un incidente en producción:** el código cliente
**no puede** asumir que la migración del mismo commit está aplicada. Se cambiaron
las lecturas a vistas nuevas y la tienda mostró cero productos teniendo cientos.
El patrón correcto está en [src/lib/publicDataSource.ts](src/lib/publicDataSource.ts):
intentar lo nuevo y caer a lo anterior **sólo** si la relación o la función no
existen (`42P01`/`42883`/`PGRST205`/`PGRST202`), nunca ante un error genérico. Y
**no tragarse errores con `?? []`**.

Al crear una tabla, **verificar que el nombre no exista ya**: `CREATE TABLE IF
NOT EXISTS` es un no-op silencioso y después falla el índice. Pasó con
`shipping_zones`/`shipping_rates`, que ya existían desde
`20260523000075_logistics.sql` con otra forma.

**El número de la migración se elige DESPUÉS de traer el remoto, no antes, y va
con 14 dígitos exactos.** Las dos PCs numeran a partir de lo que ven, así que dos
sesiones en paralelo eligen el mismo. Ya pasó: `20260731000013` salió dos veces,
una como `marketplace_fee` en el remoto y otra como `order_shipping` local. Se
arregla renombrando el archivo —el contenido es idempotente y ya aplicado, no
hace falta tocar la base— pero si además queda registrado en el libro con el
número viejo, hay que corregir las dos puntas. Antes de crear el archivo:

```bash
git fetch origin && ls supabase/migrations | tail -5
```

Los 14 dígitos no son estética: con 8, 10 o 16 el CLI no ve el archivo y
`db push` aborta con `LegacyDbPushMissingLocalError` diciendo que la versión del
libro no existe localmente. Pasó con 12 archivos y costó entender el mensaje,
que apunta a la parte equivocada del problema.

---

## Seguridad — invariantes con test

Este proyecto arrastraba políticas `USING (true)` de cuando era una app de un
solo negocio. Con la clave anónima (que va en el bundle) se leían los tokens de
MercadoPago y las contraseñas SMTP de **todas** las organizaciones. Está cerrado
(`20260731000001_rls_hardening.sql`) y hay guardas para que no vuelva:

- **`publicSurface.test.ts`** — falla si una página pública lee una tabla cruda o
  pide una columna de credencial, costo o margen. Cubre `src/pages/Public*` y
  todo `src/storefront/`.
- **`edgeFunctionAuth.test.ts`** — falla si una función que usa una API paga no
  exige usuario real. `verify_jwt` **no es una barrera**: la anon key es un JWT
  válido y público. Usar `_shared/requireUser.ts`.
- **`rls_audit_open_policies`** (vista SQL) — lista políticas sin filtro de
  tenant. Debería estar vacía salvo `plans`, que es el pricing público.
- **`moduleMap.test.ts`** — el vocabulario de módulos de permisos vive sólo en
  `src/lib/permissionModules.ts`; agregar uno es una edición, no tres.

El staff de plataforma pasa por `MfaGate` sin excepción: es la cuenta más
valiosa del sistema para un atacante.

**Tablas de credenciales: RLS habilitada y CERO policies, a propósito.**
`payment_connections`, `meli_connections` y `afip_padron_cache` sólo las tocan
las Edge Functions con `service_role`. La UI lee vistas `*_status` que exponen
si está conectado y con qué cuenta, nunca el token. Esas vistas van **sin**
`security_invoker`: con él corren con permisos de quien consulta, y como la
tabla de abajo no tiene policies devolvían siempre vacío — el panel decía "sin
conectar" con la cuenta vinculada. El control lo hace la cláusula `WHERE
is_org_member(...)` de la propia vista.

**Los compradores de una tienda no son usuarios del SaaS.** El trigger
`handle_new_user_create_org` le crea a cada alta una organización, rol `owner` y
un trial de 14 días. Los registros de tienda llegan marcados con
`account_type = 'store_customer'` en el metadata y el trigger los saltea. Sin
eso, cada cliente que compraba un perfume se volvía dueño de una organización y
ensuciaba las métricas.

---

## Credenciales: ninguna pasa por el navegador

El patrón ya está aplicado a las cuatro que había, y `noPastedCredentials.test.ts`
falla si alguna vuelve a aparecer en una pantalla.

**Lo que tiene OAuth, se conecta por OAuth.** MercadoPago (`mp-connect`),
MercadoLibre (`meli-oauth`) y Tiendanube lo tenían desde antes, pero
Integraciones seguía ofreciendo **en paralelo** un campo para pegar el token a
mano. Dos caminos para lo mismo, y el peor de los dos: un token pegado queda en
`settings`, que la UI lee, mientras que el de OAuth vive en tablas con RLS y
cero policies. Además MercadoPago **rechaza el `marketplace_fee`** con un token
pegado a mano, así que esa vía ni siquiera podía cobrar comisión.

**Lo que no tiene OAuth, no es que falte hacerlo.** Correo Argentino y Andreani
usan usuario y clave de contrato; AFIP usa un certificado X.509; Evolution API
una clave de instancia propia. Para AFIP lo más parecido al modelo marketplace
es que cada comercio delegue el servicio WSFE al CUIT de la plataforma desde
"Administrador de Relaciones" — ahí no sube ninguna clave.

**Para las que no la tienen, el secreto entra por Edge Function y nunca vuelve.**
`afip_credentials` es el ejemplo: RLS habilitada, cero policies, y la UI lee
`afip_connection_status`. Probado con el rol `authenticated` y el JWT del dueño:
la tabla devuelve **0 filas**.

⚠️ **RLS es por fila, no por columna.** `settings` tiene una policy `SELECT`
para todos los miembros de la organización, así que **cualquier secreto que se
guarde ahí lo puede leer cualquier empleado**. Ahí estaba la clave privada de
AFIP. Antes de agregar una columna a `settings`, preguntarse si es un secreto.

---

## Cron: sin dos secretos en el vault, fallan los 13 en silencio

Los cron jobs llaman Edge Functions vía `public.invoke_edge_function(nombre)`,
que lee `SUPABASE_URL` y `SUPABASE_ANON_KEY` del **vault de Supabase**. Si
faltan, **todos** fallan sin avisar: no corren alertas de stock, avisos de deuda,
reactivación, KPI diario, digest semanal, automatizaciones, campañas ni los
emails de las secuencias. Así estuvo hasta el 2026-07-29.

Ante cualquier "no me llegan las alertas / los emails", mirar **primero**
`cron.job_run_details` y el vault, no el código de la función:

```sql
SELECT j.jobname, d.status, d.end_time
FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
ORDER BY d.end_time DESC LIMIT 20;
```

Detalle en [docs/CRON.md](docs/CRON.md).

---

## Verificación: probar contra producción y limpiar

No hay entorno de staging. Lo que se hizo en estas sesiones y funciona: un
bloque `DO $$ ... $$` que inserta datos de prueba con prefijo `ZZ`, ejecuta el
camino real (RPC incluido), guarda los resultados en una tabla temporal, y
**borra todo antes de terminar**. La última fila del `SELECT` cuenta los restos,
que tienen que dar `0`.

Así aparecieron bugs que ningún test unitario iba a encontrar: un `CHECK` que
no contemplaba el canal `tienda_online` y hacía fallar toda venta online, y un
descuento de stock duplicado porque `trg_sale_stock_movement` ya lo hacía.
**Antes de descontar stock o tocar totales, revisar si hay un trigger que ya lo
haga.**

---

## Scripts

```bash
npm run deploy:functions        # 56 edge functions (bypassa la ExecutionPolicy)
npm run deploy:functions:sh     # lo mismo por Git Bash
npm run db -- --file x.sql      # SQL contra la base (necesita SUPABASE_DB_URL)
```

`deploy-functions` deriva la lista del filesystem: una función nueva no puede
quedar sin deployar. Va sin JWT **sólo** lo que esté en la allowlist explícita
del script. Si falla con `Import ... 521`, es esm.sh caído — reintentar.

---

## Estado y pendientes

El detalle vive en los mensajes de commit, que son largos a propósito. Para el
estado al día, `git log --oneline -20`.

⚠️ **Antes de elegir qué construir, leer `ROADMAP.md` §5 "El camino".** Los
bloques A–G son un **catálogo agrupado por tema**, no un plan, y agrupar por
tema hace que todo parezca igual de urgente. El plan son las cinco fases, cada
una con una condición de salida verificable, más la lista de lo **congelado** y
lo **bloqueado por fuera del código**.

La regla que ordena todo: **cada fase existe para destrabar la siguiente.** Hoy
la fase 0 es "que se le pueda vender a alguien" y está frenada por el
certificado de homologación de AFIP, que es un trámite gratis. Elegir un ítem
del bloque B porque parece divertido es exactamente lo que este orden viene a
evitar.

El análisis del 2026-08-14 traduce el norte en una regla práctica: los próximos
90 días tienen que producir **producto confiable y vendible**, no más amplitud.
Prioridad: AFIP real, base legal publicada, onboarding medible, MercadoLibre
completo, POS/panel con E2E, checkout sin fricción cuando haya tráfico para
medirlo, offline POS robusto, backups con restore probado, observabilidad de
webhooks/crons/pagos y métricas de plataforma (`G1–G8`).

⚠️ **Al cruzar los bloques aparecieron cuatro pares que eran el mismo trabajo
con dos letras** (C1/F15, D1/F16, D5/F17, D6/F8). Antes de agregar un ítem
nuevo, buscar si ya está con otro nombre.

Pendientes conocidos al 2026-07-31:

**Lo que espera al dueño, no al código:**

- **Cargar las tarifas de envío.** Hay 6 zonas activas y tarifas en **una
  sola**: CABA — verificado contra la base: 1 provincia de 24 tiene tarifa. El
  retiro en local **sí** está habilitado, así que lo que ve un comprador de las
  otras 23 no es "No hay envío disponible" sino una única opción: ir a
  buscarlo a CABA. Es peor de lo que suena, porque parece que el checkout
  funciona.

  Desde la sesión 93 hay un botón **"Completar el tarifario"** en Envíos →
  Zonas que estima las 6 zonas por distancia a partir de una tarifa de
  referencia, con vista previa de lo que va a crear y sin pisar lo ya cargado.
  Un precio aproximado vende; ninguna opción de envío no vende nunca. Lo que
  sigue esperando al dueño es **revisar esos números** contra la tarifa real
  del correo.
- **Cargar el peso de los productos.** 59 de 60 activos lo tienen en cero, así
  que `quote_store_shipping` cotiza con `default_item_weight_kg` (0,5 kg) y
  `prepare_order_shipment` declara ese mismo 0,5 en la etiqueta.

  ⚠️ **El error va en la dirección contraria a la intuitiva**, y esto se
  verificó midiendo: los 55 perfumes estiman **0,40 kg** y ninguno pasa de 0,5,
  así que la tienda cotiza **de más**, no de menos. No cuesta margen: cuesta
  ventas, porque el envío caro es de las primeras razones por las que se
  abandona un carrito. En el catálogo de hoy el efecto sobre el precio queda
  además tapado por el envío gratis desde $150.000, que se alcanza a las 3
  unidades — empieza a verse cuando haya tarifas con kg extra en el resto de
  las zonas.

  Desde la sesión 93 el botón **"Completar pesos"** en Productos los estima a
  partir del contenido en ml (los 60 lo tienen cargado) con vista previa y sin
  pisar lo cargado a mano. Sigue faltando **pesar una caja real** y corregir:
  el modelo es una estimación, no una balanza.
- **Diez productos publicados sin foto** y 33 con descripción de menos de 80
  caracteres. Están en el ranking de Productos → Calidad de las publicaciones,
  que ordena por impacto y no por cantidad.
- **Un certificado de AFIP de homologación** para verificar el ciclo de
  facturación. Es gratis y no emite comprobantes reales.
- **Contrato con Correo Argentino o Andreani** para la etiqueta por API.
- ⚠️ **Hay que contar el inventario físico y corregir el stock.** Durante meses
  cada venta descontó el doble y cada compra sumó el doble (arreglado en la
  sesión 91). Los números se venían corrigiendo a mano desde la pantalla, que no
  deja asiento, así que **el stock de la base no es confiable hoy**. Se ve
  comparando el Kardex contra el stock actual: 15 productos no coinciden y
  varios tienen el Kardex en negativo con el stock real positivo.

  ```sql
  SELECT p.name, u.stock_after AS kardex, p.stock, p.stock - u.stock_after AS dif
  FROM (SELECT DISTINCT ON (product_id) product_id, stock_after
          FROM public.stock_movements WHERE product_id IS NOT NULL
         ORDER BY product_id, created_at DESC, id DESC) u
  JOIN public.products p ON p.id = u.product_id
  WHERE p.stock <> u.stock_after ORDER BY abs(p.stock - u.stock_after) DESC;
  ```

  No se corrigió por código a propósito: reconstruirlo exige saber qué ventas
  pasaron por el camino duplicado y cuáles no (las de la tienda online van por
  `mark_store_order_paid`, que nunca duplicó). Se corrige contando.
  Incluye a **"AFNAN 9AM DIVE"**, que quedó en 7 tras una verificación del aviso
  de reposición y ese número tampoco es real.
- Hay un producto **"ZZ NO COMPRAR - Prueba de pago"** publicado en la tienda,
  con stock 1. Se creó para verificar el cobro real; borrarlo cuando no haga
  falta más.

**Lo que espera trabajo:**

- ~~La migración destructiva~~ **aplicada**: 57 tablas huérfanas, 0 filas entre
  todas. Verificado al traerla: 269 archivos, 270 registradas.
- ~~El libro de migraciones desfasado~~ **resuelto**. Se mantiene así anotando
  cada migración al aplicarla — es lo único que frena que la brecha vuelva.
- Las APIs de Correo Argentino y Andreani siguen **sin verificar contra un
  contrato real**: los payloads siguen la documentación publicada.
- **AFIP: falta probarlo contra el organismo.** La estructura está y las
  credenciales ya no se pueden leer desde el cliente (`afip_credentials`, RLS
  con cero policies), pero no hay certificado cargado ni factura emitida.
- **Etiqueta de envío: la imprimible ya está**, con seguimiento que el comprador
  ve con número de orden + email, sin cuenta. Lo que falta es pedirle la
  etiqueta por API al correo, y eso necesita contrato.
- MercadoLibre: falta el botón de publicar en la ficha, importar órdenes como
  ventas y el cron multi-organización (ver `docs/MERCADOLIBRE.md`).

**Regenerar los tipos después de cada migración**, o el typecheck reporta
errores fantasma en archivos que no se tocaron:

```bash
npx supabase gen types typescript --project-id hummeopatkniwkyrrhwc > src/integrations/supabase/types.ts
```

### Secretos sin los cuales hay features muertas

Ver [docs/CONFIGURACION.md](docs/CONFIGURACION.md). Los dos que más duelen:
`ANTHROPIC_API_KEY` (toda la IA responde error) y `RESEND_API_KEY` (los crons de
email corren, encuentran los destinatarios y no pueden enviar).

### Brechas contra Tiendanube / Empretienda

Lo que la tienda todavía no tiene, en orden de impacto:

1. **Revisar las tarifas de envío.** Hay 6 zonas y tarifas en una sola: 1
   provincia de 24, verificado. Con el retiro en local habilitado, las otras 23
   ven **una** opción —ir a buscarlo a CABA—, que parece un checkout que
   funciona. `Completar el tarifario` las genera estimadas por distancia;
   falta contrastarlas con la tarifa real del correo.
2. **AFIP probado contra el organismo.** La estructura está y las credenciales
   ya no se pueden leer desde el cliente, pero no hay certificado cargado ni
   factura emitida.
3. **Etiqueta por API del correo.** La imprimible ya funciona; la de Correo
   Argentino y Andreani necesita un contrato para poder verificar el payload.

**El circuito de plata ya corrió entero.** Dos compras reales de $1 acreditadas,
con el `application_fee` de $0,05 derivado a la plataforma. Llegar hasta ahí
destapó cuatro bugs que ninguna lectura del código encontró — están en
`ROADMAP.md` §11, sesión 90. El más caro: **la firma del webhook de MercadoPago
nunca validaba**, así que toda compra quedaba pagada del lado de MercadoPago e
impaga del lado de la tienda, en silencio.

El despacho ya está: preparar el envío desde la orden, etiqueta imprimible, y
seguimiento que el comprador ve con número de orden + email, sin cuenta.

El CRM por `customer_id` tampoco es ya una brecha: `CustomersPage` lee por id
desde el commit 2a7d5c7. El cruce vive en `customerMatch.ts` (puro, 10 tests) y
su `normalizeName` es espejo de `public.normalize_person_name` — si se toca una,
se toca la otra. Una fila **enlazada** se cruza sólo por id; una sin enlazar,
por nombre normalizado, porque no hay trigger que enlace lo viejo cuando se da
de alta un cliente nuevo y leer sólo por id le mostraría la ficha vacía.

**Ya no queda nada del CRM cruzando por nombre.** `quotes` y
`customer_communications` recibieron la columna en `20260802000001` y usan el
mismo trigger genérico que las otras tres, así que `trg_sales_link_customer`
sirve hoy a cinco tablas. Verificado forzando el caso: con el mismo cliente
escrito de tres formas, la lectura vieja mostraba **1 de 3** presupuestos y 1 de
3 comunicaciones.

Del lado del cliente el cruce va por `crmRowsForCustomer`, que hace **dos
consultas en vez de un `.or()`**: el `or` de PostgREST se arma concatenando en
una sola cadena, así que un nombre con coma o paréntesis —"Pérez, Juan", "Ana
(mayorista)"— rompe el filtro o lo convierte calladamente en otro.

**Las notas del cliente viven en `customers.notes`**, no en `customer_notes`.
Esa tabla es heredada y está vacía: los dos caminos de nota escribían ahí con
una constraint que no existe (`42P10`) y sin mirar `.error`, así que la UI decía
"Nota guardada" con cero filas guardadas. Se escribe con `appendCustomerNote`,
que lanza si falla.

`marketplace_fee` **cobra de verdad**, confirmado contra MercadoPago: se aplica
en `store-pay` desde el commit 85fa7b1, con `platform_commission_amount()` como
única fuente del número para que el checkout cobre exactamente lo que la
liquidación registra. Sólo se
aplica con credenciales OAuth — con un token pegado a mano MercadoPago rechaza
la preferencia.

✅ **Ya cobró.** Dos compras reales de $1, `approved`/`accredited`, con la
comisión de plataforma descontada — MercadoPago informa `application_fee: 0.05`
en las dos. **La regla base está en 5%, no en 0%** como decía este archivo: si
se hace una compra ahora, ese 5% se va a la cuenta de MercadoPago dueña de la
aplicación (`MP_APP_ID`). Conviene confirmar cuál es antes de escalar.

Cómo se derivó la comisión, porque no es obvio: MercadoPago **no necesita que le
digas la cuenta**. La deduce de quién emitió el token. El comercio autoriza la
app de la plataforma por OAuth, MP devuelve un token del vendedor emitido por
esa app, y al acreditar el pago el neto va al vendedor y el `marketplace_fee` al
dueño de la aplicación. Por eso con un token pegado a mano MP rechaza la
preferencia: no existe la relación marketplace.

**Lo que la tienda ganó en las sesiones 93–97**, y las decisiones que hay que
respetar al tocarlo:

- **Preguntas sobre el producto** (`product_questions`). Sólo se publican las
  **respondidas**: una tira de preguntas sin contestar dice que acá no atiende
  nadie. Preguntar pide cuenta pero **no** compra —esa es toda la diferencia con
  las reseñas, el que pregunta todavía no compró— con tope de 5 pendientes por
  persona.
- **Promo "llevando 2"** (`store_promo_2x_discount`). El ahorro se cuenta **por
  producto cruzando líneas**, no por línea: los productos con promo son vapers
  con 9 y 10 sabores, así que la compra real son dos líneas de una unidad y una
  regla por línea no dispararía nunca. Va como descuento y no bajando el
  subtotal —que tiene que seguir siendo la suma de los ítems— pero se resta
  **antes** del cupón: la promo es un precio, no una rebaja.
- **Categorías propias** (`ecommerce_categories`, `get_store_categories`). El
  nombre dejó de estar hardcodeado. `products.category` **sigue guardando el
  slug** y sigue siendo lo que usan el POS, los precios por categoría y las
  ofertas masivas: esta tabla le agrega nombre, orden y presentación a ese slug,
  no lo reemplaza. Renombrar no toca el slug.
- **Subcategorías** (`parent_id`). Lo que las hace servir es que **entrar al
  padre trae los productos de las hijas** (`slugsDeRama`): sin eso, tocar el
  padre da una página vacía. El menú lleva **sólo primer nivel**, contando la
  rama entera para que un padre sin productos propios entre igual.
- **Menú configurable** (`ecommerce_stores.nav_links`). **Vacío significa
  "armalo solo"**, no "menú vacío", y si todos los links quedaron rotos se
  vuelve al automático: el header no puede quedarse sin forma de llegar al
  catálogo. Sólo http(s) —un `javascript:` ahí es un XSS servido— validado al
  guardar **y** al mostrar.
- **Calidad de la publicación** y **Completar pesos** en Productos, y
  **Completar el tarifario** en Envíos. Los tres siguen el mismo patrón: el
  panel señala el problema, un botón lo arregla en masa con **vista previa**, y
  nunca pisa lo cargado a mano.
- **Cross-selling en el carrito** (`crossSell.ts`). Primero lo que **completa el
  envío gratis**, con tope de 1,6× lo que falta: un producto que pasa el umbral
  por cinco veces no completa nada.
- **Promociones en la tienda** (`store_promo_price`, espejo de `bestPromoPrice`).
  La promoción se resuelve **dentro del precio de la línea**, no como descuento
  aparte: una promoción es un precio, así que el volumen, el cupón y el medio de
  pago trabajan después sobre el número correcto. Quedan afuera las que tienen
  `coupon_code` (van por cupones), `buy_x_get_y`/`bundle`/`free_shipping`
  (necesitan lógica de carrito) y `applies_to = customers` (es de orden).

  ⚠️ **Van tres mecánicas de precio que una superficie ignoraba en silencio**
  —`price_2x_ars`, las categorías y las promociones—. Al agregar una nueva hay
  que revisar **las cuatro**: POS, catálogo interno, catálogo público y tienda
  online.
- **Descuento por cantidad** (`quantity_discounts`, `store_volume_discount`).
  "Llevando 3 o más, 15% off", con alcance todos/categoría/producto. **Por
  producto gana el mejor entre el 2x fijo y la mejor regla, nunca la suma**, y
  entre varias reglas gana la de mayor descuento. La cantidad se cuenta
  cruzando líneas. El carrito lo espeja con `get_store_quantity_discounts`:
  sin ese RPC el cliente mostraría menos de lo que se cobra.
- ⚠️ **La oferta y el descuento por medio de pago NO se acumulan: se cobra el
  mejor, nunca la suma** (`precioConMedioDePago`, espejo de
  `20260806000001_descuento_no_acumula.sql`). Se aplicaban uno sobre otro, así
  que un producto con 20% off pagado por transferencia con 20% terminaba con
  **36% de descuento real** y el precio tachado no correspondía a ningún
  porcentaje redondo. El descuento del medio se mide contra el precio de
  **lista**, por línea: si la oferta ya deja el precio por debajo, no descuenta
  nada más; si el medio es mejor que la oferta, gana el medio —publicar "20% OFF
  con transferencia" y cobrar el 10% de la oferta sería romper la promesa—. Para
  poder compararlo, la línea de `resolve_store_line` lleva `list_price`.

  ⚠️ **Pero "oferta" significa dos cosas distintas y el código no puede
  adivinar cuál.** Un 20% off puede ser "éste es el precio con transferencia"
  o una liquidación real sobre la que el 20% todavía corresponde. Lo decide el
  comercio: `ecommerce_stores.payment_discount_stacks` es la política y
  `products.offer_stacks_payment` la pisa por producto (NULL = usa la
  política). El default es **false** porque equivocarse hacia "no acumula"
  cobra de más y el comprador se queja, mientras que equivocarse hacia
  "acumula" regala margen en silencio. La vista `store_catalog_products`
  resuelve las dos en `payment_base_price` para que la tienda muestre el precio
  sin conocer la política ni cruzar dos tablas.
- **Negocio por comercio** en `/platform/negocio` (`platform_org_health`).
  Ordena por urgencia, no por facturación, y el KPI es el **GMV en riesgo**
  medido con el mes **anterior**: el que está en riesgo hoy factura cero.

**El dinero se redondea en un solo lugar** (`redondear_moneda` en SQL,
`rounding.ts` en el cliente). No hay más `round(x, 2)` sueltos para importes
nuevos: los decimales los define la moneda. Y el redondeo es media unidad
hacia arriba **en valor absoluto** — `Math.round(-0.5)` da `-0`, así que un
reintegro se redondeaba para el lado equivocado.

Cuando un total se reparte entre líneas, va por `prorratear()`: garantiza que
las partes sumen exactamente el total, con el resto a la última. Tres partes
iguales de $100 dejan un centavo colgado, y ese centavo es la diferencia entre
que una factura cierre y que no.

**El IVA es por producto** (`products.tax_rate`). **NULL significa "la de la
organización", no cero** — cero es exento, una tasa válida y distinta. Eso
también decide cómo se guarda desde la UI: `parseFloat('') || null` convertiría
un 0 legítimo en NULL y el exento pasaría a gravado.

⚠️ **Lo que se aprendió verificando, y cuesta caro repetir:**

- **Un bloque `DO $` corre como superusuario y bypassa la RLS.** Un test de
  permisos ahí da falsos positivos de agujero. Va con `SET ROLE anon` /
  `authenticated` de verdad.
- **Un subquery que le pasa un argumento a un RPC `SECURITY DEFINER` corre en el
  contexto del llamador.** `get_store_categories((SELECT slug FROM
  ecommerce_stores ...))` como anon recibe NULL, porque anon no lee esa tabla.
- **Para tocar una función grande, regenerarla desde `pg_get_functiondef` con un
  script**, insertando los cambios. Reescribir `create_store_order` (186 líneas)
  o `get_store_by_slug` de memoria es como casi se rompe `mark_store_order_paid`.
- **`{(a?.length || b?.length) && …}` con las dos vacías evalúa a `0`, y React
  imprime el cero.** Había un 0 suelto en la ficha de casi todos los productos.
- **Antes de dropear un RPC público, comprobar con grep quién lo llama** en
  `src`, `api` y las edge functions. Agregar una columna al **final** de la
  firma no rompe a quien lee por nombre de campo.
- **Antes de construir algo del ROADMAP, medirlo contra la base.** A10
  ("historial de precios") figuraba como faltante y estaba entero: 656 filas,
  627 con autor, trigger y gráfico en pantalla. Empezar por el código lo habría
  construido dos veces.
- **`LIKE '%_iva%'` matchea "inactiva".** El `_` es comodín de un carácter. Para
  buscar un nombre de columna que empieza con guión bajo hay que escaparlo.
- **Verificar en los dos sentidos.** Una búsqueda difusa que "encuentra" no
  sirve si encuentra todo: se prueba que traiga *y* que no traiga de más. Lo
  mismo para un permiso: que deje pasar a quien corresponde y frene al resto.

Ya resueltas (sesiones 87–91): reseñas de compra verificada, páginas de
contenido, banners con vigencia, filtro por rango de precio, lista de deseos,
aviso de reposición, CRM por `customer_id` **completo** (las cinco tablas),
despacho con etiqueta y seguimiento, la limpieza de credenciales, y las notas
de cliente, que decían guardarse y no guardaban nada.

---

## Lenguaje visual y rediseno (2026-08-14)

La UI de Gestiona toma de los kits de ecommerce la jerarquia, la densidad de informacion y la claridad de las acciones, pero no copia pantallas ni assets. El producto tiene que verse como un sistema operativo omnicanal, no como un template de tienda.

- La superficie de organizacion usa un workspace neutral con acciones en ambar; la superficie de plataforma conserva violeta para que nadie confunda tenant con staff.
- El modo claro es el punto de entrada para leer tablas, metricas y estados. El modo oscuro sigue siendo una opcion completa.
- Cada pantalla debe tener orientacion visible, busqueda global accesible y una accion primaria clara. El topbar de la organizacion es parte del sistema.
- Las tarjetas son herramientas de lectura o accion, con radio maximo de 8px, jerarquia de borde y sombra discreta. No se anidan tarjetas dentro de tarjetas.
- Los numeros se alinean y se comparan con periodo, canal, sucursal y variacion. Un KPI sin fecha o fuente no se presenta como verdad.
- El dashboard abre con cuatro metricas de Business Core y deja el resto en una segunda capa visual. Las tarjetas metricas viven en componentes reutilizables para que Ventas, Stock, Finanzas y Plataforma no inventen estilos paralelos.
- Mobile no es una version comprimida: tablas tienen scroll explicito, acciones llegan a 40px y la navegacion conserva Resumen, POS, Ventas, Productos y Clientes.
- Los kits de Figma son referencias de criterio. La implementacion vive en los componentes y tokens del repo para que todas las superficies evolucionen juntas.
- El shell de organizacion debe priorizar lectura y accion: sidebar silencioso, breadcrumb visible, busqueda global, estado operativo y una accion primaria. Las tarjetas metricas no son decoracion: deben tener una sola lectura y una fuente temporal clara.
- `PageHeader`, `MetricCard` y `KPICard` son la base compartida. Antes de crear una tarjeta, toolbar o encabezado nuevo, buscar si el componente existente puede resolverlo. Las tablas de Productos, Ventas y Plataforma deben conservar scroll horizontal en mobile y estados legibles sin depender del modo oscuro.
- Las referencias de ecommerce/admin se usan para jerarquia, densidad, filtros, tablas y composicion. No se copian assets ni pantallas: el contenido, los estados y el lenguaje tienen que responder al Business Core de Gestiona.

El slice de rediseno se verifica con screenshot en desktop y mobile, typecheck, lint, test y build antes de avanzar a otra superficie.

---

## Acceso directo a la base

Es lo que convierte "creo que el esquema es así" en "lo miré". Sin esto se
escriben migraciones a ciegas, que fue lo que costó tres idas y vueltas en la
sesión 89.

Hay dos caminos, y conviene saber cuál está disponible **antes** de planificar:

**1. El runner del repo — el bueno, pero es por máquina.**

```bash
npm run db -- --sql "select count(*) from public.sales"
npm run db -- --file supabase/00_diagnostico.sql
```

Necesita dos variables de usuario: `SUPABASE_DB_URL` (pooler **session**,
`aws-1-us-east-1`, puerto 5432 — la conexión directa `db.<ref>.supabase.co`
**no responde**, es IPv6) y `SUPABASE_CA_CERT` apuntando a `prod-ca-2021.crt`,
que hace que el TLS se verifique de verdad en vez de usar `PGSSL_INSECURE=1`.

**Están puestas en una sola de las dos PCs.** Se trabaja desde dos, así que no
se puede dar por hecho: comprobar antes de contar con esto.

```powershell
[Environment]::GetEnvironmentVariable('SUPABASE_DB_URL','User')
```

Vacío ⇒ esta máquina no lo tiene. Si devuelve algo pero el shell no la ve, la
app arrancó antes de que se definieran, y alcanza con:

```powershell
$env:SUPABASE_DB_URL = [Environment]::GetEnvironmentVariable('SUPABASE_DB_URL','User')
```

Y si el runner falla con `Cannot find package 'pg'`, faltan dependencias:
`npm install`.

**2. El CLI de Supabase — anda en cualquier máquina, sin configurar nada**,
porque el proyecto ya está linkeado. Es lo que se usa para aplicar migraciones
y sirve igual para consultar, sólo que pide un archivo en vez de `--sql`:

```bash
npx supabase db query --linked --file consulta.sql
```

El runner **nunca imprime la credencial** y se niega a correr `DROP TABLE`,
`TRUNCATE`, `DROP COLUMN` o un `DELETE` sin `WHERE` salvo que se le pase
`--allow-destructive`. Para probar algo contra datos reales sin riesgo: envolver
en `BEGIN; ... ROLLBACK;` — así se verificaron los triggers de CRM.

---

## Arrancar una sesión nueva

```bash
git fetch origin && git log --oneline -20
```

Los mensajes de commit son el estado del proyecto. `ROADMAP.md` §5 tiene lo que
falta para la paridad con Tiendanube, en orden de impacto, y §11 el historial
por sesión.

Después: leer "Cómo se trabaja acá" arriba, elegir el primero de la lista de
brechas, y trabajarlo como slice.
