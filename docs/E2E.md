# E2E críticos

La puerta E2E prueba la tienda pública en Chromium de escritorio y teléfono, y
las superficies críticas del panel con una identidad técnica. Los specs leen la
base vinculada; no crean ventas, órdenes, envíos ni comprobantes.

## Contrato del gate

- Vite arranca en `4173` por defecto con `--strictPort`.
- Un proceso preexistente nunca se reutiliza salvo opt-in explícito con
  `E2E_REUSE_SERVER=true`.
- CI exige `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `E2E_STORE_SLUG`, `E2E_USER` y `E2E_PASSWORD`.
- CI define `E2E_REQUIRE_AUTH=true`: una credencial ausente falla, no saltea.
- La identidad de CI es miembro `admin` de una organización, no staff de
  plataforma. No tiene acceso a `/platform`.

Esta separación evita dos falsos verdes que existían: levantar la app sin
conexión a Supabase y saltear silenciosamente todo el panel.

## Comandos

~~~bash
npm run test:e2e:public
npm run test:e2e:ci
~~~

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
contra una respuesta JSON ajena a Gestiona. El puerto estricto y el test guardia
impiden que esa configuración reaparezca.
