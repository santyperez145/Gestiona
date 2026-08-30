# Reintegro Mercado Pago de devolución POS — evidencia 2026-08-30

## Alcance certificado

El commit funcional `1ec3c3c` quedó publicado en producción. Vercel informó
`Ready` en 26 segundos para el deployment
`exentryimports-lpizutsm0-santyperez145sgmailcoms-projects.vercel.app`, y el
alias canónico cargó `/devoluciones` con el bundle
`/assets/index-DiXN27KL.js`.

La certificación de este documento cubre el contrato interno y la regresión
visual. **No certifica movimiento de dinero real en Mercado Pago**: la línea
base productiva tiene 0 cuentas conectadas, 0 QR completados, 0 devoluciones
POS y 0 refunds.

## Evidencia de base y servidor

- Migración `20260830000010_pos_refund_mercadopago` aplicada y libro en
  `upToDate=true`.
- Fixture reversible `20260830_pos_refund_mercadopago.sql`: modo Orders, dos
  preparaciones con la misma clave idempotente, rechazo que conserva ARS 5.000
  pendientes, confirmación que lleva el pasivo a ARS 0, refund ID persistido y
  `restos = 0`.
- `refund-pos-payment` figura `ACTIVE`, versión 1 y `verify_jwt=true`; una
  llamada anónima devolvió HTTP 401.
- `npm run check:functions` validó las 73 Edge Functions versionadas. Supabase
  lista 74 activas porque `extract-receipt` está desplegada sin fuente en
  `main`; esa fue la deriva observada durante este corte. Más tarde el slice 76
  la cerró y dejó 74/74, según
  [`2026-08-30_escaner_comprobantes_gastos.md`](2026-08-30_escaner_comprobantes_gastos.md).

## Evidencia publicada autenticada

Sesión real de administrador, sólo lectura y sin crear operaciones:

| Comprobación | Resultado |
|---|---|
| URL | `https://exentryimports.vercel.app/devoluciones` |
| Semántica | un H1 “Devoluciones”, un CTA “Nueva devolución” |
| Datos | estado vacío honesto: 0 operaciones y “Todavía no hay devoluciones” |
| 360 / 768 / 1024 / 1440 px | sin overflow horizontal en los cuatro viewports |
| Alta a 1440 px | diálogo accesible “Nueva devolución de mostrador” |
| Alta a 360 px | CTA físico abre el mismo diálogo; página y diálogo sin overflow |
| Consola desde el reload del deploy | 0 errores, 0 warnings |
| Escrituras | 0; el diálogo se cerró sin seleccionar ticket ni confirmar |

Los controles **Reintegrar / Reintentar / Verificar estado** no pueden
certificarse visualmente con esta organización porque no existe una devolución
Mercado Pago real. Su autoridad y estados están cubiertos por 8 pruebas guardia
y por la fixture PostgreSQL; afirmar una prueba visual o live sería inventar
evidencia.

## Puerta local

- `npm run typecheck`: verde.
- `npm run lint`: 0 errores, 139 warnings históricos conocidos.
- `npm test`: 2.072/2.072 en 207 archivos.
- `npm run build`: Vite + PWA verde.
- `npm run check:functions`: 73/73 entradas Deno.
- `npm run check:dependencies`: 0 vulnerabilidades.
- `npm run check:enlaces`: 79 enlaces internos sin problemas.
- `npm run check:conteos`: sin problemas; referencia local 73 Edge Functions
  y 497 migraciones.

## Gate externo pendiente

Conectar una cuenta productiva por OAuth, cobrar un QR real y ejecutar refund
total/parcial, rechazo, timeout/reconsulta y conciliación. Si la venta tiene
CAE, también emitir y conciliar la nota de crédito ARCA productiva. Ninguna de
esas puertas se reemplaza con una simulación o fixture.
