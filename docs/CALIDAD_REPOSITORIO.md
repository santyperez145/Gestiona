# Calidad del repositorio

**Responsable:** ingeniería. **Corte:** 2026-09-20.
Propósito: mantener una base verificable y registrar lo que impide publicarla.
La prioridad de producto vive en [ROADMAP](../ROADMAP.md).

## Qué significa el contador

### Seguimiento de seguridad — 2026-09-21

Corregidos controles de usuario y beneficio IA en `ai-brief-generator`, y
contabilización de consumo en briefs y clasificación financiera. La clasificación
mantiene el JWT del usuario/RLS, exige permiso de edición y busca el gasto por
organización antes de consumir créditos. Rechaza categorías inválidas y no
presenta una escritura fallida como exitosa. No se exponen errores del proveedor.

Once pruebas ejecutan los handlers transpilados con fronteras externas simuladas;
la guarda anónima falló al retirar deliberadamente la autorización y se restauró.
Esto no equivale a un despliegue ni a una prueba real de proveedor. El webhook de
Mercado Pago sigue siendo un bloqueo prioritario independiente: verificar firma
obligatoria y recuperar liquidación/reconciliación canónica antes de publicar.

Verificación del seguimiento, 2026-09-21 (`npm test`): 34 pruebas dirigidas aprobadas; suite completa
2.961 casos, 2.935 aprobados y 26 fallidos, sin fallos nuevos frente a la limpieza.
Se resolvieron tres guardas de autorización, beneficio y consumo. Typecheck,
lint completo sin errores, Deno check de ambas funciones, build, enlaces,
conteos y diff check aprobaron. Las once pruebas añadidas comprueban ejecución
de límites críticos: reducir el contador no es un objetivo de seguridad.

Sobre `900d3b43`, `npm test -- --reporter=json --outputFile=test-results/baseline.json`
ejecutó 2.962 casos: 2.931 aprobados y 31 fallidos. Había 311 archivos de test;
217 leen fuentes mediante `readFileSync`/`readFile`. Estos archivos pueden mezclar
comportamiento y guardas: no son 217 integraciones probadas, ni el contador
demuestra que pagos, correo o base productiva funcionen.

El baseline también aprobó typecheck y lint sin errores. Compilar y analizar
tipos no reemplaza ejecutar flujos. Los reportes locales viven en `test-results/`
(ignorado); el historial de cambios vive en Git.

Resultado local posterior a la limpieza, 2026-09-20: `npm test` ejecutó 2.950
casos (2.921 aprobados, 29 fallidos, ninguno omitido). Comparar nombres completos
de fallos con el baseline no mostró regresiones nuevas. Se retiraron doce casos
redundantes/de política editorial y se corrigió la indexación documental; los
fallos funcionales y de seguridad siguen visibles. Typecheck, lint sin errores,
build, enlaces internos, conteos y `git diff --check` aprobaron.

`git diff HEAD --name-only --diff-filter=D` contó 79 archivos retirados en esta
revisión; 24 dependencias directas se eliminaron. No hubo validación de
transacciones productivas ni certificación de proveedores en esta limpieza.

## Retiro con evidencia

- Primitives, hooks y wrappers sin consumidores en el grafo de aplicación/tests.
- CSS de demostración Vite y módulo vacío `graphInit`.
- Volcados de errores TypeScript y notas de sesión duplicadas bajo `Gestiona/`.
- Bundle SQL generado en mayo: las migraciones versionadas son la autoridad.
- Test `true === true`, verificación de frases del estándar y escaneo de rutas
  literales de otros tests. Un import/lectura inexistente ya hace fallar Vitest.
- Restricciones de extensión y nombres de herramientas en documentos: conservar
  los controles de documentos de entrada e índice, sin condicionar contenido a
  una cantidad arbitraria de líneas.
- Dependencias directas sin consumidores; CLI Supabase y tipos de confetti pasan
  a desarrollo. Knip queda fijado como herramienta de auditoría, no como runtime.

No se borraron migraciones aplicadas, datos, configuración local ni código
pendiente del checkout original. Todo archivo retirado es recuperable con Git.

## Auditoría reproducible de uso

`npm run check:unused` analiza archivos y dependencias. `knip.json` declara las
entradas de Vercel, Deno, scripts, ejemplos, tests y Playwright para no confundir
un endpoint llamado desde fuera con código muerto. Supabase CLI se conserva
porque lo usa el procedimiento operacional aunque no haya un import JavaScript.
La configuración de Playwright se analiza como fuente sin ejecutarla: la
auditoría no necesita credenciales de producción.

El reporte sigue fallando mientras haya candidatos pendientes; no se ocultan
con una lista de exclusión. Un candidato no autoriza por sí solo su eliminación.
CI exige `npx knip --include dependencies --no-progress`, que sí aprueba después
de la limpieza. El análisis completo mantiene los doce candidatos funcionales
para resolver en el orden del roadmap, sin convertirlos en falsos verdes.

## Bloqueos observados antes de la limpieza

| Prioridad | Evidencia | Cierre exigido |
|---|---|---|
| P0 | `ai-brief-generator` invoca proveedor sin los controles compartidos de usuario y plan; `finance-auto-categorize` no registra consumo según la guarda. | Autorización, tenant, cupo y consumo verificados; rechazo antes del gasto. |
| P0 | Fallan contratos de webhook MP, liquidación compartida, suscripción, reversas y QR. | Revisar código y comportamiento de pagos; no actualizar strings para silenciar la alarma. |
| P1 | Marketing acepta vistas de automatizaciones/ofertas/marca/combos/imágenes, pero muestra placeholders mientras sus componentes no tienen importadores. | Restablecer los flujos con permisos y pruebas de interacción. |
| P1 | Dos rutas montan conciliación bancaria; hay grupos vacíos y páginas sin entrada. | Una autoridad/ruta por capacidad, redirects para enlaces viejos y navegación validada. |
| P1 | Falla el cálculo esperado de importación; el caso de concurrencia de checkout sólo busca palabras en SQL. | Validar aritmética contra el contrato y concurrencia en base reversible. |
| P2 | Guardas de copy/clases, conteo fijo de funciones, configuración de cuotas y selector de tienda no acompañan refactors. | Distinguir cambio legítimo de regresión, preferir resultados observables. |

Otros candidatos que requieren una decisión funcional antes de eliminarlos:
`SettlementsTab`, `PlatformDashboard`, `ProductsPriceImport`,
`MarketingTemplatesTab`, `creatorProfileDB` y páginas de campañas/discovery aún
sin integrar. `useInfluencerProductAccess` e `influencerProductDB` dejaron de ser
candidatos: ahora gobiernan el gate real de la superficie. Que un archivo
compile no demuestra que esté accesible.

Seguimiento 2026-09-21 (`npm test -- --reporter=json`), superficie Influencers:
2.965 casos, 2.943 aprobados y 22 fallidos. No aparecieron fallos nuevos frente
al corte posterior de IA; se resolvieron cuatro fallos de navegación/manifest.
Typecheck, lint, build, Deno check de `platform-admin-action`, enlaces, conteos
y diff check aprobaron. La migración quedó versionada, aún no aplicada ni
certificada contra la base productiva.

No se habilita publicación a producción mientras la puerta esté roja. Una rama
de revisión puede conservar y compartir el trabajo sin afirmar cierre operativo.

## Criterio competitivo

Fuentes oficiales consultadas el 2026-09-20:

- [Shopify: Test Budget](https://shopify.engineering/test-budget-time-constrained-ci-feedback):
  evalúa costo y riesgo de ejecución; tener muchos tests no es por sí solo deuda.
- [Shopify: ejecutar menos tests](https://shopify.engineering/spark-joy-by-running-fewer-tests):
  selecciona mediante relaciones entre código y pruebas, no por un recorte arbitrario.
- [Google: cuánto testing es suficiente](https://testing.googleblog.com/2021/06/how-much-testing-is-enough.html):
  combina capas y recorridos críticos de usuario.

Decisión Nerqia: medir protección de ventas/stock/pagos/identidad, defectos
escapados, estabilidad y tiempo de feedback. No presentar número de tests,
pantallas ni líneas como tracción o garantía para inversores.
