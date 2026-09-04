# Nerqia — guía de contribución

Este archivo es la autoridad de trabajo para cualquier persona o proceso que
modifique el repositorio. Centraliza las reglas para evitar versiones
divergentes.

## Misión

Nerqia es un Commerce Operating System. La tienda es la puerta; el Business
Graph es la ventaja. Commerce, POS, Mercado Libre, WhatsApp, Pay y Finance
comparten productos, stock, clientes, costos, órdenes, cobros y margen.

Documentos de entrada:

1. [ROADMAP.md](ROADMAP.md): estado, prioridad y gates.
2. [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): límites técnicos.
3. [docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md](docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md): UI, investigación y adopción tecnológica.
4. [DESIGNROADMAP.md](DESIGNROADMAP.md): dirección visual.
5. [docs/LEGAL.md](docs/LEGAL.md): obligatorio antes de precios, clientes,
   checkout o Platform.
6. [docs/INDICE.md](docs/INDICE.md): resto de documentación vigente.

## Superficies

| Superficie | Ruta | Acceso | Chrome |
|---|---|---|---|
| Organización | `/` | `memberships` + permisos | `AppLayout` |
| Finance | `/finance` | entitlement + `finance.view` | `FinanceLayout` |
| Platform | `/platform` | `platform_admins` + MFA | `PlatformLayout` |
| Tienda pública | `/tienda/:slug` o dominio | comprador | `StoreLayout` |

Ser staff de Platform no concede acceso a una organización. Finance comparte
identidad/Core, pero no clona páginas de Business.

## Antes de escribir código

Se trabaja desde dos PCs y el remoto puede avanzar sin aviso:

```bash
git fetch origin
git log --oneline main..origin/main
git log --oneline origin/main..main
```

Si el remoto está adelante, leer los commits y hacer pull antes de planificar.
Si dos implementaciones colisionan como decisión de producto, no elegir a
ciegas: pedir criterio. Nunca revertir cambios ajenos.

Antes de una pantalla, modal, tabla, filtro, dependencia o cambio de stack, leer
el estándar competitivo. Antes de una migración, volver a traer remoto y mirar
los últimos nombres de `supabase/migrations`.

## Principios de producto

- Una feature entra en Commerce, productos/inventario, POS/caja,
  clientes/ventas, Finance o inteligencia. Si no mejora primera venta, stock
  único, margen, riesgo o adopción, se congela.
- Completo significa un flujo de punta a punta; no muchas pantallas a medias.
- La IA es Business Copilot: evidencia, acción revisable y resultado. Texto
  generado sin acción es commodity.
- Antes de crear una ruta o función, buscar su equivalente. Una capacidad tiene
  una ruta canónica y una autoridad.
- Comparaciones con terceros llevan fuente oficial y fecha. Lo no verificado se
  marca como hipótesis.
- Los pushes son automáticos al cerrar cada slice; cada push dispara producción
  en Vercel.

## Invariantes de datos

### Un solo Core

- Productos, variantes, categorías, stock, clientes, proveedores, costos y
  tarifas pertenecen a la organización.
- Una tienda define dominio, tema, navegación, páginas, pedidos, recuperación,
  reseñas, preguntas y analítica.
- Un canal referencia entidades del Core; no crea su propio inventario, cliente
  o cálculo de margen.
- Categorías se consultan con `useOrgCategories`/`useOrgCategoryNames`; nunca se
  enumeran slugs a mano ni se adivina rubro/categoría.

### Stock

El cliente nunca escribe `products.stock`, `product_variants.stock` ni
`location_stock`. Triggers de ventas/compras y `record_stock_movement` son la
autoridad. Antes de tocar stock o totales, buscar triggers:

```bash
npm run db -- --sql "select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal"
```

No ocultar negativos con `GREATEST(0, ...)` o `Math.max(0, ...)`. Un negativo es
evidencia. `stock_negativo` debe quedar vacío.

### Dinero

- El checkout envía ids y cantidades; la base recalcula precio, descuento,
  stock, cupón, envío, impuestos y comisión.
- Cálculos compartidos viven en funciones puras testeadas (`businessCalc`,
  `shippingCalc`, `paymentFees`, `storeReadiness`) y, si existen en SQL, ambos
  lados declaran que son espejos.
- Un proveedor externo no está acreditado porque el navegador lo diga. Webhook,
  consulta y reconciliación son idempotentes.

### Errores y consultas

- Un `select()` con columna inexistente deja la pantalla vacía. La guarda
  `columnasQueExisten.test.ts` compara selects con tipos reales.
- Nunca convertir un error de permiso/red en `[]` o `null`. Sólo usar fallback
  de relación/RPC anterior ante `42P01`, `42883`, `PGRST205` o `PGRST202`.
- Cada `catch` operativo registra contexto con `console.error` y muestra una
  recuperación honesta.
- Ignorar respuestas viejas al cambiar organización, tienda o filtros.

### Rutas y permisos

`src/app/routeManifest.ts` declara id, ruta, módulo, roles, página y aliases.
Router, sidebar, búsqueda y `moduleForRoute` derivan de ahí. `module: null`
requiere `openReason`.

Las membresías, permisos y entitlements se validan también en servidor. RLS es
por fila, no por columna. Staff de Platform y miembros del comercio son modelos
separados.

## Seguridad

- `publicSurface.test.ts` impide tablas crudas/costos/credenciales en páginas
  públicas.
- `edgeFunctionAuth.test.ts` exige usuario real para funciones pagas o
  sensibles. `verify_jwt` no basta: la anon key también es JWT.
- `payment_connections`, `meli_connections`, `afip_credentials` y equivalentes
  tienen RLS y cero policies; sólo `service_role` las toca. La UI lee vistas de
  estado sanitizadas.
- Secretos nunca entran en `settings`, localStorage, logs o respuestas. OAuth se
  usa donde existe; otros secretos entran por Edge Function y no vuelven.
- API keys se emiten server-side, se muestran una vez, guardan sólo hash y
  scopes. Validar antes de reservar idempotencia.
- Compradores de tienda usan `account_type=store_customer`; no reciben
  organización ni membresía SaaS.
- Platform pasa por `MfaGate` sin excepción.
- Imágenes se cargan con `ImageUpload`; no se pide pegar URLs.
- `xlsx` apunta a SheetJS 0.20.3 en su CDN. No ejecutar `npm install xlsx`.

## UI y código

- Seguir patrones existentes y primitives compartidas antes de crear otras.
- Mantener archivos y funciones enfocados; extraer sólo cuando reduce
  complejidad real o duplicación.
- Comentarios breves explican decisiones no obvias, autoridad o riesgos; no
  narran sintaxis.
- Quitar código muerto encontrado dentro del alcance del slice. No hacer
  limpiezas masivas de hooks o estilos sin tests/screenshot: pueden introducir
  refetch loops o regresiones.
- Usar íconos Lucide, tabs para vistas, controles adecuados y tooltips para
  íconos no familiares.
- Sin cards dentro de cards, hero dentro de card, decoración de orbes o layouts
  de marketing en herramientas operativas.
- Mantener dimensiones estables, texto sin solaparse y respuesta real en móvil.
- No escalar fuente por viewport ni usar tracking negativo.
- Storefront necesita assets reales; el panel administrativo prioriza densidad,
  comparación y acción.
- Toda vista cubre loading, refresh, empty inicial/filtrado, error, offline/stale,
  permiso, parcial, éxito y dirty state cuando aplique.
- Navegación interna usa React Router. Actualizaciones PWA nunca recargan solas;
  ofrecen una acción manual que preserva el trabajo.

El repo compila con `strictNullChecks: false`: TypeScript no estrecha algunas
uniones booleanas. Usar campos opcionales o una forma que el compilador pueda
discriminar.

## Trabajo por slices

Secuencia habitual:

1. traer remoto y leer contexto;
2. localizar autoridad, trigger, RLS, rutas y contratos existentes;
3. investigar referencia oficial si la afirmación puede haber cambiado;
4. definir un resultado observable y el menor slice completo;
5. migración idempotente y verificación reversible;
6. UI con estados y permisos completos;
7. tests focales y guardas de regresión;
8. puerta completa;
9. navegador contra `localhost` y luego producción;
10. actualizar documentación vigente, commit, push y esperar Vercel `Ready`.

No acumular features sin publicar. Un hallazgo productivo se corrige antes de
seguir con el roadmap.

## Puerta técnica

Antes de cada commit:

```bash
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
NODE_OPTIONS=--max-old-space-size=6144 npm run lint
NODE_OPTIONS=--max-old-space-size=6144 npm test
NODE_OPTIONS=--max-old-space-size=6144 npm run build
git diff --check
```

No usar `npx tsc --noEmit`: el `tsconfig.json` raíz tiene `files: []`.
Warnings `exhaustive-deps` conocidos no se corrigen en masa; errores de lint:
cero.

Flujos usan Playwright; cálculos usan Vitest. E2E autenticado necesita
`E2E_USER` y `E2E_PASSWORD`. El archivo `e2e/.auth/usuario.json` es secreto y
queda ignorado.

Los números medidos llevan fecha o comando reproducible. Ejecutar:

```bash
npm run check:conteos
npm run check:enlaces
```

## Navegador y entorno

El navegador se prueba contra `localhost` antes del push. Vercel tiene el código
anterior hasta que el deploy quede `Ready`.

Comprobar configuración:

```bash
Get-ChildItem .env,.env.local -ErrorAction SilentlyContinue
```

Sin `VITE_SUPABASE_URL` la UI puede compilar y mostrar “Tienda no encontrada”
sin que sea un bug de datos. Sin credenciales E2E, sólo se validan superficies
públicas y compilación.

No modificar datos reales para probar. Crear fixtures `ZZ` dentro de una
transacción, verificar la última consulta con `0` restos y terminar en
`ROLLBACK`. Si una prueba debe tocar un valor real, guardar y restaurar el valor
en la misma transacción.

## Migraciones

1. Elegir número después de `git fetch`; exactamente 14 dígitos.
2. Verificar que tablas/columnas/funciones no existan con otra forma.
3. Escribir SQL idempotente.
4. Aplicar con:

```bash
npx supabase db query --linked --file supabase/migrations/2026XXXXXXXXXX_nombre.sql
```

5. Incluir o ejecutar verificación reversible como roles reales.
6. Registrar la versión en `supabase_migrations.schema_migrations` en la misma
   sesión si el archivo no lo hace.
7. Comprobar:

```bash
npx supabase db push --linked --dry-run
```

La salida esperada contiene `"upToDate":true` y `"migrations":[]`. No seguir la
sugerencia automática de marcar `reverted` si el libro menciona un archivo
ausente: reconstruir o recuperar el archivo correcto.

El cliente nunca asume que la migración del mismo commit ya está aplicada.
Funciones/vistas nuevas usan fallback al contrato anterior sólo ante
relación/función inexistente.

## Cron y operaciones

Los cron llaman Edge Functions mediante `public.invoke_edge_function` y
requieren `SUPABASE_URL` y `SUPABASE_ANON_KEY` en Vault. `cron.job_run_details`
indica despacho, no ejecución: la respuesta real vive en
`platform_edge_invocation_health` y `edge_invocation_log`. Ver
[docs/CRON.md](docs/CRON.md).

## Acceso directo a la base

`npx supabase db query --linked` usa Management API y funciona para SQL/archivos
en este proyecto. `npm run db` requiere `SUPABASE_DB_URL` como variable de
usuario; nunca guardarla en el repo.

## Estado actual

Corte técnico 2026-09-04: `main` publicado en `nerqia.app`, TypeScript y build
verdes, lint con 0 errores/142 warnings conocidos y 2.727 tests en 297 archivos
(`npm test`). Commerce y Pedidos cargan datos reales en sesión autenticada.

Prioridad inmediata: surtido/publicación multi-tienda, migración de comercio,
estados completos de checkout y primer documento Finance real. Gates externos:
identidad legal, conteo físico, certificaciones live de pago/logística/ARCA y
segundo comercio.

## Documentación

- Cada tema tiene una autoridad listada en [docs/INDICE.md](docs/INDICE.md).
- ROADMAP contiene presente y futuro, no una bitácora.
- Incidentes y evidencias cerradas viven en Git.
- Un documento nuevo requiere dueño, propósito y ausencia de solapamiento.
- Si un cambio vuelve falso un `.md`, se corrige en el mismo slice.
