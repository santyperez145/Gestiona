# Gestiona — contexto para Claude Code

Plataforma multi-tenant tipo Tiendanube/Empretienda: sistema de gestión completo
(stock, POS, finanzas, multi-tienda, canjes con influencers, marketing) **más**
tiendas online que venden de verdad, **más** un panel desde el que se administran
todas las organizaciones y se cobra comisión por venta.

Tres superficies separadas, y esa separación es deliberada:

| Superficie | Ruta | Quién | Chrome |
|---|---|---|---|
| Organización | `/` | `memberships` | `AppLayout`, acento dorado |
| Plataforma | `/platform` | `platform_admins` | `PlatformLayout`, acento violeta |
| Tienda pública | `/tienda/:slug` | comprador anónimo | `StoreLayout` |

Ser staff de plataforma **no** otorga permisos dentro de una organización. Ver
[docs/permisos.md](docs/permisos.md).

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

**Una feature no está hecha hasta que se probó contra la base real.** No hay
staging. El patrón, que ya encontró cinco bugs que ningún test unitario iba a
encontrar, está más abajo en "Verificación". La última fila del `SELECT` cuenta
los restos y tiene que dar `0`.

**El navegador se verifica contra `localhost`, no contra Vercel.** El deploy va
del `git push`, así que hasta que no se pushea, el sitio publicado tiene el
código viejo aunque las migraciones ya estén aplicadas. Verificar contra
`exentryimports.vercel.app` da falsos negativos garantizados.

**No se toca dato real del negocio para verificar.** Ya pasó: para probar el
aviso de reposición se puso en cero el stock de un perfume y el valor original
se perdió — `stock_movements` no lo tenía. Si hace falta un producto agotado,
se crea uno `ZZ` y se borra; si no hay más remedio que tocar uno real, se
**guarda el valor antes** en la tabla temporal del test.

**Antes de descontar stock o tocar totales, revisar si ya hay un trigger que lo
haga.** `trg_sale_stock_movement` ya descuenta: sumarle un descuento manual
dejó un stock de 2 en −2.

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

**Los cálculos de plata van a funciones puras testeadas**, nunca inline:
`businessCalc.ts`, `shippingCalc.ts`, `paymentFees.ts`, `storeReadiness.ts`.
Cuando la misma cuenta existe en SQL (para que el servidor sea la autoridad), el
comentario de cada lado dice que son espejos.

**Nada de precios ni stock desde el cliente.** El checkout manda ids y
cantidades; precios, stock, cupones, envío y comisiones se recalculan en la base.

---

## Migraciones: se aplican A MANO

`supabase db push` **no sirve** en este repo: cuatro grupos de migraciones
comparten prefijo de versión (`20260506`, `20260507`, `20260519000001`,
`20260523000006` — 13 archivos ya aplicados) y el CLI usa ese prefijo como clave.

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

**El número de la migración se elige DESPUÉS de traer el remoto, no antes.**
Las dos PCs numeran a partir de lo que ven, así que dos sesiones en paralelo
eligen el mismo. Ya pasó: `20260731000013` salió dos veces, una como
`marketplace_fee` en el remoto y otra como `order_shipping` local. Se arregla
renombrando el archivo — el contenido es idempotente y ya aplicado, no hace
falta tocar la base — pero es justamente lo que engorda la lista de prefijos
duplicados que tiene inutilizable a `db push`. Antes de crear el archivo:
`git fetch origin && ls supabase/migrations | tail -5`.

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

Pendientes conocidos al 2026-07-31:

- **Stock de "AFNAN 9AM DIVE" quedó en 7 y ese número no es real.** Se puso en
  cero para verificar el aviso de reposición y el valor original se perdió.
  Corregirlo desde Productos con el número que corresponda.
- Las 4 páginas de contenido de la tienda están **como borrador**, a la espera
  de que el dueño las revise y publique.

- **`send-team-invite` corre en producción sin código en el repo.** Está ACTIVE
  desde 2026-05-12, con `verify_jwt=true`. No es urgente porque está protegida,
  pero es una función que nadie puede revisar ni versionar, y que `npm run
  deploy:functions` **no** actualiza — deriva la lista del filesystem, así que
  esta no existe para el script. Dos salidas: bajar el código del dashboard y
  commitearlo, o borrarla si el flujo de invitaciones ya no la usa. Chequeo:
  comparar `supabase functions list` contra `supabase/functions/*/index.ts`.
- `20260723000003_drop_orphaned_feature_tables.sql` **sin aplicar y DESTRUCTIVA**
  (~75 tablas). Va aparte, con backup.
- Los 4 grupos de versiones duplicadas hay que resolverlos a mano en
  `supabase_migrations.schema_migrations`.
- Las APIs de Correo Argentino y Andreani siguen **sin verificar contra un
  contrato real**: los payloads siguen la documentación publicada.
- Falta AFIP, que es el gap crítico de siempre: sin factura no hay venta formal.
- Falta etiqueta de envío y tracking automático con los correos.
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

1. **Etiqueta de envío y tracking automático** con Correo Argentino y Andreani.
   Las APIs están integradas para cotizar, pero el ciclo no se cierra: no se
   genera la etiqueta ni se actualiza el seguimiento solo.
2. **AFIP en la tienda.** Sin factura no hay venta formal. Es el gap crítico de
   siempre, y aplica a toda la app, no sólo a la tienda.

El CRM por `customer_id` tampoco es ya una brecha: `CustomersPage` lee por id
desde el commit 2a7d5c7. El cruce vive en `customerMatch.ts` (puro, 10 tests) y
su `normalizeName` es espejo de `public.normalize_person_name` — si se toca una,
se toca la otra. Una fila **enlazada** se cruza sólo por id; una sin enlazar,
por nombre normalizado, porque no hay trigger que enlace lo viejo cuando se da
de alta un cliente nuevo y leer sólo por id le mostraría la ficha vacía.

Quedaron por nombre `quotes` y `customer_communications`: no tienen la columna,
así que para esas hace falta migración, no sólo cambiar la lectura.

`marketplace_fee` ya **no** es una brecha: se aplica en `store-pay` desde el
commit 85fa7b1, con `platform_commission_amount()` como única fuente del número
para que el checkout cobre exactamente lo que la liquidación registra. Sólo se
aplica con credenciales OAuth — con un token pegado a mano MercadoPago rechaza
la preferencia.

⚠️ **Nada de esto cobró todavía.** La regla base de comisión está en 0% y no hay
ninguna compra completada: el circuito de plata está verificado por partes pero
nunca corrió entero. Confirmarlo con una compra real es lo primero a hacer,
porque si algo falla ahí cambia el orden de todo lo demás.

Ya resueltas (sesiones 87–88): reseñas de compra verificada, páginas de
contenido, banners con vigencia, filtro por rango de precio, lista de deseos y
aviso de reposición.

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
