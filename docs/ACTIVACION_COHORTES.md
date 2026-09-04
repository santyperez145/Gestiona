# Cohortes de activación

**Estado:** vigente. **Corte:** 2026-09-04.

## Qué se mide

Una organización se activa cuando logra la primera venta real en el canal que
eligió durante onboarding:

- `pos`: primera fila de `sales` con `source = 'pos'`;
- `online`: primera orden con pago `paid`, `partial` o `refunded`;
- `explore`: no está activada hasta elegir una ruta.

Terminar el formulario, crear una tienda, publicar un producto o registrar un
cobro de suscripción no sustituyen esa venta. Los ocho hitos de
`organization_activation_readiness` explican dónde se detuvo el recorrido.

## Denominadores

`platform_activation_cohorts` agrupa por mes de alta. Las tasas a 7, 14 y 30
días sólo incluyen organizaciones que ya cumplieron esa edad. Una alta reciente
no entra todavía en el denominador de 30 días.

Los porcentajes globales se recalculan sumando numeradores y denominadores; no
se promedian porcentajes mensuales.

## Autoservicio y costo de soporte

`activation_interventions` registra únicamente:

- hito asistido;
- tipo de intervención;
- minutos reales;
- resultado estructurado;
- fecha y actor de auditoría.

No admite notas libres ni datos de clientes. Staff ve una vista que tampoco
expone actor ni clave de idempotencia. Sólo Support o Superadmin escriben a
través de RPC; Finance puede leer el costo agregado.

Una activación es autoservicio cuando no tuvo una intervención antes de su
primera venta. Las intervenciones posteriores no alteran esa clasificación. Un
evento anulado sigue auditable, pero deja de sumar.

La métrica no inventa historia: `platform_metric_watermarks` marca desde cuándo
el registro es confiable. Organizaciones anteriores aparecen como “histórico
sin base”, nunca como cero minutos ni autoservicio.

## Verificación contra producción

```bash
npm run db -- --file supabase/verificaciones/20260821_cohortes_activacion.sql
```

El ensayo usa un staff y una organización existentes dentro de una
subtransacción: registra dos veces la misma clave, exige una sola fila y 17
minutos, anula dos veces, comprueba que el costo vuelva a cero, bloquea un
usuario no staff y fuerza rollback. La última aserción exige cero restos.

## Lectura para producto e inversores

Antes de presentar una tasa, acompañarla con:

- fecha de corte;
- cantidad de organizaciones del denominador;
- ventana madura usada;
- cuántas altas están cubiertas por el watermark;
- minutos de ayuda por alta instrumentada.

Con cuatro organizaciones y un solo comercio real, la lectura actual es una
línea de base técnica, no evidencia de product-market fit. La primera cohorte
defendible empieza con el segundo comercio creado después del watermark.

> **Al 2026-08-27 son dos organizaciones, no cuatro** (`Exentry Imports` y
> `pruebas Workspace`): se borraron dos de prueba. Los productos (60) y las
> ventas (34) no cambiaron, así que no se perdió nada operativo — pero el
> `CASCADE` sí se llevó lo que colgaba de ellas, y ahí probablemente estaba la
> evidencia del CAE de homologación. La conclusión de este párrafo no cambia:
> sigue siendo línea de base, con un comercio real.
