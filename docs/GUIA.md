# Guía del proyecto

**Estado:** vigente. **Corte:** 2026-09-04.

Esta guía explica dónde mirar sin exigir conocimiento previo del historial.

## Qué construye Nerqia

Nerqia conecta la tienda online con la operación real del comercio:

    producto → stock → tienda/POS/canal → orden → cobro → entrega
           → costo + comisión + envío + impuestos → margen → acción

Commerce atrae y convierte. Business opera. Finance controla gastos y
obligaciones. Pay reconcilia cobros. Platform administra el servicio.

## Mapa del repositorio

| Ruta | Contenido |
|---|---|
| src/pages | Páginas privadas y landing. |
| src/storefront | Tienda pública, catálogo, carrito y checkout. |
| src/components | Componentes de dominio y UI compartida. |
| src/app | Manifiesto de rutas y composición de la aplicación. |
| src/lib | Reglas, cálculos, clientes e invariantes. |
| src/integrations/supabase | Cliente y tipos generados de Supabase. |
| supabase/migrations | Esquema, funciones, RLS y verificaciones. |
| supabase/functions | Integraciones server-side. |
| api | Endpoints Vercel públicos/SEO. |
| e2e | Flujos Playwright. |
| src/test | Tests Vitest y guardas arquitectónicas. |
| docs | Documentación vigente. |

## Orden de lectura

1. [README](../README.md): ejecución y comandos.
2. [ROADMAP](../ROADMAP.md): presente y prioridad.
3. [CONTRIBUTING](../CONTRIBUTING.md): reglas de trabajo.
4. [Arquitectura](ARQUITECTURA.md): autoridades y límites.
5. [Interfaz](INTERFAZ.md): patrones visuales.
6. [Índice](INDICE.md): documentación por dominio.

Antes de precios, checkout, clientes o Platform, leer [LEGAL.md](LEGAL.md).

## Flujo de una ruta

src/app/routeManifest.ts declara ruta, página lazy, módulo, roles y aliases. El
sidebar y las guardas se derivan del mismo contrato. Las rutas públicas y los
montajes /finance y /platform se componen en src/App.tsx.

Para agregar una pantalla:

1. comprobar que el trabajo no exista;
2. elegir superficie y autoridad;
3. declararla en el manifiesto correcto;
4. validar permiso en UI y servidor;
5. cubrir estados y tests;
6. comprobar navegación y enlace directo.

## Flujo de datos

TanStack Query lee contratos Supabase. Las operaciones sensibles llaman RPC o
Edge Functions. PostgreSQL valida tenant, estado y reglas antes de escribir.

Nunca:

- escribir stock o totales calculados desde el cliente;
- consultar tablas de secretos;
- usar un fallback vacío para ocultar un error;
- asumir que una migración ya está aplicada;
- crear una segunda tabla para una entidad del Core.

## Un cambio pequeño

1. Traer el remoto.
2. Leer el archivo, tests y contrato de datos cercanos.
3. Definir resultado observable.
4. Implementar sin ampliar el alcance.
5. Ejecutar tests focales.
6. Pasar la puerta completa.
7. Validar local y producción.
8. Actualizar sólo la documentación que quedó afectada.
9. Commit, push y deploy Ready.

## Base y migraciones

Una migración usa 14 dígitos, es idempotente y contiene verificación reversible
cuando cambia dinero, stock o permisos. Se aplica con:

    npx supabase db query --linked --file supabase/migrations/<archivo>.sql
    npx supabase db push --linked --dry-run

La última consulta de una fixture debe demostrar cero restos. No se toca un dato
real para que una prueba dé verde.

## Cómo verificar

    NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
    NODE_OPTIONS=--max-old-space-size=6144 npm run lint
    NODE_OPTIONS=--max-old-space-size=6144 npm test
    NODE_OPTIONS=--max-old-space-size=6144 npm run build
    npm run check:enlaces
    git diff --check

Los cálculos van a Vitest. Los flujos y responsive van a Playwright. RLS y
triggers se prueban en SQL como roles reales. El navegador se abre contra local
antes del push y contra nerqia.app después del deploy.

## Dónde resolver dudas

- producto/prioridad: [ROADMAP.md](../ROADMAP.md);
- diseño: [DESIGNROADMAP.md](../DESIGNROADMAP.md);
- datos/seguridad: [ARQUITECTURA.md](ARQUITECTURA.md);
- permisos: [permisos.md](permisos.md);
- variables/deploy: [CONFIGURACION.md](CONFIGURACION.md);
- incidentes: [SOPORTE_DIAGNOSTICO.md](SOPORTE_DIAGNOSTICO.md);
- pagos: [PAGOS.md](PAGOS.md);
- Finance: [FINANCE.md](FINANCE.md);
- tienda/SEO: [SEO_INDEXACION.md](SEO_INDEXACION.md);
- normativa: [LEGAL.md](LEGAL.md).

Si una respuesta histórica contradice un documento vigente, manda el documento
vigente y el código probado. Git conserva el contexto anterior.
