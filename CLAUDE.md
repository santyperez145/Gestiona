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

El flujo es: `supabase/00_diagnostico.sql` → `01_aplicar_pendientes.sql` →
`02_verificar.sql`, pegados en el SQL Editor. Si hay credenciales, se puede usar
el runner:

```bash
npm run db -- --file supabase/00_diagnostico.sql
```

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

Lo que la tienda todavía no tiene, en orden de impacto: reseñas de productos
(no existe ni la tabla), páginas de contenido editables (Sobre nosotros,
Preguntas frecuentes, Cambios), banner/slider con enlaces en la home, lista de
deseos y aviso de reposición, y filtro por rango de precio.
