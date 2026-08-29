# Evidencia — API Keys con sesión autenticada

**Fecha:** 2026-08-29  
**Superficie:** `https://exentryimports.vercel.app/integraciones?tab=apikeys`  
**Rol:** administrador de una organización real  
**Método:** sesión ya iniciada en el navegador integrado; no se copiaron cookies,
tokens ni credenciales y no se creó ni revocó ninguna key.

## Matriz ejecutada

Se abrió la tab `API Keys` y se verificaron el panel, el estado vacío y el
diálogo `Crear API Key` en tema claro y oscuro. La matriz responsive fue:

| Viewport | Claro | Oscuro | Overflow horizontal |
|---:|:---:|:---:|:---:|
| 360 px | ✅ | ✅ | No |
| 768 px | ✅ | ✅ | No |
| 1024 px | ✅ | ✅ | No |
| 1440 px | ✅ | ✅ | No |

En los ocho casos la página conservó `Integraciones & API`, la tab seleccionada
`API Keys` y el CTA `Crear API Key`. El tema claro resolvió el canvas como
`rgb(245, 246, 249)` y el oscuro como `rgb(13, 15, 23)`: no apareció branding
del comercio ni un fondo oscuro heredado dentro del modo claro.

La consola de la navegación autenticada devolvió **0 warnings y 0 errors**. No
se reprodujeron el fallo de chunk dinámico/MIME ni el WebSocket abortado que se
habían reportado en despliegues anteriores.

## Hallazgo y corrección

En el modal móvil la descripción de `stock:write` se mostraba como
`ajustar stock (con asiento de Kar…)`. El control funcionaba, pero escondía una
consecuencia relevante antes de emitir una credencial con permiso de escritura.

`AdvancedApiKeysPanel` en `main` dejó de truncar las descripciones: cada fila
alinea el checkbox arriba y permite que scope y consecuencia envuelvan dentro
del ancho disponible. `apiPublicaEndurecida.test.ts` protege el contrato para
que `SCOPE_DESC` no vuelva a recibir `truncate`.

## Estado de deploy

El commit `76a3c4a` se pusheó a `main`, pero el status check oficial de GitHub
devolvió Vercel `failure` con `Deployment rate limited — retry in 24 hours`.
Una navegación nueva con cache-buster confirmó que producción seguía sirviendo
`assets/index-EniERmOG.js`; al reabrir el modal a 360 px, el DOM todavía tenía
`text-muted-foreground truncate` y no la nueva clase de wrapping.

Por eso esta evidencia separa dos hechos: la matriz de la versión actualmente
publicada está hecha y el fix está construido/testeado en `main`, pero falta la
verificación post-deploy. No se presenta el cambio visual como productivo hasta
que Vercel acepte un build y el DOM publicado muestre `min-w-0 leading-snug`.

## Alcance honesto

La prueba demuestra composición, responsive, temas, contenido autenticado,
foco básico del diálogo y ausencia de errores visibles para API Keys en el
bundle anterior. No creó una credencial —hacerlo habría modificado acceso
persistente— y no reemplaza la comprobación post-deploy, una prueba de tarea con
otro comercio ni la matriz de Conexiones/Webhooks y transportistas que permanece
en el slice 16 de `DESIGNROADMAP.md`.
