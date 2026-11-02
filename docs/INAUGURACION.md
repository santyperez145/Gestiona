# Inauguración: el día cero de Nerqia

**Estado:** vigente desde el 2026-10-31. **Owner:** Dirección (todas las posiciones).
Baja el escalón «Producción restaurada y verificada» del [Plan de llegada](PLAN_DE_LLEGADA.md) a una secuencia con responsables, tiempos y cómo se verifica cada paso. Si este documento y el plan se contradicen, manda el plan.

## 1. Semáforo (medido el 2026-10-31, actualizado el 2026-11-02)

| Frente | Estado | Qué falta |
|---|---|---|
| **Base de producción (Supabase)** | 🔴 Apagada: el proyecto figura `INACTIVE` por la factura impaga (aviso #29 abierto desde el 19/10). | Pagar. Es lo único que impide abrir. |
| Sitio `nerqia.app` | 🟢 Monta en Chromium: `humo-produccion.yml` lo abre después de cada publicación y cada hora y abre un issue si queda en blanco (el 2026-11-01 un build roto quedó 51 min en blanco y el control anterior sólo miraba el 200). | — |
| Código | 🟢 CI, simulacro de la base desde cero (48 matrices) y E2E local en verde: panel, circuito de gestión, barrido con datos, tienda y alta de un comercio nuevo. La puerta abre el build en Chromium antes de cada subida. | — |
| Construido sin aplicar | 🟡 Las migraciones desde el 21/10 y las funciones que cambiaron desde entonces. | Un comando (paso 2). |
| Alta de comercios | 🟢 Registro, mail de confirmación con nuestra plantilla, login y negocio creado, verificado de punta a punta contra la base local (`e2e/alta-de-comercio.spec.ts`). | Repetirlo en producción (paso 3). |
| Cobro de la suscripción | 🟡 Construido con Mercado Pago (`mp-subscribe`, `cancel-subscription`, Mi plan con baja). Precios publicados: Starter $19.900, Pro $34.900, Business $69.900 por mes. Cada cobro genera la factura de Nerqia al comercio (CUIT 20-44648443-6; C, o A/B si fuera responsable inscripto), en Plataforma › Negocio. | Un cobro real con tarjeta (paso 5) y el certificado de ARCA de Nerqia (paso 4b). |
| ARCA | 🟡 Certificado propio por comercio, factura completa, Libro IVA, caja fiscal y portal del contador construidos. | Certificado y primer CAE real (paso 4). |
| Legal | 🟡 Términos y privacidad publicados, con el CUIT y la condición de Nerqia; faltan razón social y domicilio del prestador; las tiendas muestran el botón de arrepentimiento (Res. 424/2020) en el encabezado y el pie; el plan se da de baja desde Mi plan. | Razón social y domicilio del prestador (dueño). |
| Rendimiento | 🟢 Medido en cada corrida del E2E: las 70 pantallas del panel y la tienda (escritorio y teléfono), con presupuestos que fallan si algo empeora. Desde el 31/10: −19 % de consultas, un solo cargador al entrar y sin saltos en la tienda. Landing en celular: rendimiento 83, accesibilidad 100. | — |
| Respaldo y monitoreo | 🟢 Respaldo diario por comercio, semáforo de Platform, auditoría de seguridad diaria y `estado-produccion.yml` cada 6 horas. | Tarjeta de respaldo y alertas de facturación (paso 1). |

## 2. Secuencia del día cero

| # | Paso | Quién | Tiempo | Terminado cuando |
|---|---|---|---|---|
| 1 | Pagar la factura de Supabase. Cargar una tarjeta de respaldo y alertas de facturación en Supabase, Vercel y el dominio. | **Dueño** | 10 min | Supabase › Billing sin deuda; el proyecto figura `ACTIVE_HEALTHY`. |
| 2 | `npm run restaurar` (revisa y muestra) y después `npm run restaurar -- --ejecutar`: simulacro contra producción, aplica las migraciones, audita permisos, publica todas las funciones, regenera los tipos, cierra el aviso y relanza el CI. Se detiene en el primer paso que falle. | Dirección | ≈ 1 h | Los 7 pasos en OK, el aviso #29 cerrado y el CI en verde con el E2E contra producción. |
| 3 | Humo en producción: crear una cuenta nueva y confirmarla por mail; entrar a Exentry; una venta en la caja; un pedido de prueba en la tienda (transferencia, acreditar, despachar); el Libro y el resultado del mes. | Dirección | 30 min | Todo sin errores y sin nada en Platform › Errores de la app. |
| 4 | Certificado de ARCA de Exentry con el asistente de ARCA (clave fiscal) y la primera factura con CAE. | **Dueño** (clave fiscal) | 15 min | Una factura de producción con CAE, revisada. |
| 4b | Nerqia factura sus suscripciones (CUIT 20-44648443-6, monotributo): crear la organización de Nerqia, conectar su certificado de ARCA y activarla en Plataforma › Negocio › «Facturación de Nerqia». | **Dueño** (clave fiscal) y Dirección | 20 min | La primera suscripción cobrada tiene su factura C con CAE. |
| 5 | Cobros reales: suscripción Starter con tu tarjeta y su baja; una compra en la tienda con Mercado Pago combinada con saldo a favor, y su reintegro. | **Dueño** (plata real) | 15 min | El pago figura acreditado en Nerqia y en Mercado Pago; el reintegro, devuelto en los dos. |
| 6 | Abrir el registro y empezar con los 10 comercios del plan (guion en [ENTREVISTAS_E2](ENTREVISTAS_E2.md)). | **Dueño**, con material de Dirección | — | Primeros comercios con alta. |

## 3. Criterios para abrir

Se abre cuando se cumplen los cinco:

1. CI y E2E en verde contra producción.
2. Auditoría de seguridad diaria en cero (`auditoria_de_seguridad_diaria`).
3. Un comercio real factura con CAE.
4. Un cobro real de Mercado Pago acreditado.
5. El respaldo diario del día terminó bien para todos los comercios.

## 4. Si algo sale mal

- `npm run restaurar -- --ejecutar` se detiene en el primer paso que falla y dice cuál. Las migraciones son idempotentes: se corrige y se vuelve a correr.
- Un despliegue del sitio se revierte desde Vercel, como indica [RELEASE_RECOVERY](RELEASE_RECOVERY.md).
- Un respaldo se prueba con `npm run drill:restore` ([RESTORE](RESTORE.md)).

## 5. Lo que no bloquea la apertura

Siguen como gates externos, sin frenar la inauguración: lotes reales de ARBA y e-ARCIBA, controlador fiscal en Modo Entrenamiento, FCE, CAEA y factura E en homologación, contratos con transportistas y cuentas para firmar las apps nativas.
