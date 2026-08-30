# Evidencia visual — Turno de caja y activación de sucursal

**Fecha:** 2026-08-29  
**Producción:** `https://exentryimports.vercel.app`  
**Bundle validado:** despliegue de `31ddc01` (`Ready`, 27 s)  
**Sesión:** administrador real de Exentry Imports, navegación de sólo lectura.

## Qué se encontró

La primera carga del turno nuevo mostró la autoridad server-side, pero también
la línea de base real: las 2 organizaciones productivas tenían 0 sucursales.
Sin una recuperación, el flujo terminaba en “Sin sucursales activas”. No se creó
un local ficticio ni se completaron domicilio/datos del comercio por backfill.

El segundo despliegue reemplazó ese callejón sin salida por:

- owner/admin: `Configurar sucursal` → `/sucursales`;
- vendedor: instrucción de pedir la configuración a un administrador;
- POS: aviso de que la venta puede continuar pero quedará sin turno;
- Turno: mismo CTA dentro del contexto de apertura/cierre.

## Matriz publicada

La ruta `/caja/turno` se validó con la sesión autenticada y viewport real:

| Viewport | `innerWidth` | `scrollWidth` | H1 | CTA visible | Overflow horizontal |
|---:|---:|---:|---|---|---|
| 360 | 360 | 356 | Apertura & Cierre de Caja | Sí | No |
| 768 | 768 | 764 | Apertura & Cierre de Caja | Sí | No |
| 1024 | 1024 | 1020 | Apertura & Cierre de Caja | Sí | No |
| 1440 | 1440 | 1436 | Apertura & Cierre de Caja | Sí | No |

En `/caja`, el carrito mobile a 360 px y el panel desktop a 1440 px mostraron
“Caja todavía no tiene una sucursal”, el CTA y cero overflow horizontal. No se
abrió una sesión, no se creó una ubicación y no se confirmó ninguna venta.

## Automatización

`e2e/panel.spec.ts` codifica los dos estados válidos —selector existente o CTA
de activación— y repite 360/768/1024/1440 verificando H1, recuperación y
overflow. El spec compila y aparece entre los 46 recorridos. En esta PC, la
ejecución CLI autenticada no pudo reutilizar el archivo local porque su sesión
había vencido y redirigió a Login; la matriz publicada se completó con la sesión
vigente del navegador integrado. La ejecución bloqueante seguirá dependiendo de
`E2E_USER`/`E2E_PASSWORD` o de renovar el estado local por el setup oficial.

## Límite pendiente

La UI del estado vacío está validada. El selector poblado y una apertura/cierre
real siguen pendientes hasta que el dueño configure una sucursal; el fixture SQL
ya cubre autoridad, concurrencia, cálculos, RLS, outsider y limpieza.
