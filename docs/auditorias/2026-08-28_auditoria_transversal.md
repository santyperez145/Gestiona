# Auditoría transversal — 2026-08-28

Esta fotografía no significa «no puede existir otro bug». Significa que cada
afirmación de abajo tiene un comando o una consulta reproducible, y que lo que
no pudo probarse quedó abierto en vez de declararse sano por intuición.

## Alcance ejecutado

- remoto y worktree;
- libro de migraciones y dry-run contra la base vinculada;
- 19 vistas de auditoría/consistencia y RLS de todas las tablas públicas;
- ACL reales de funciones `SECURITY DEFINER`;
- columnas con nombres de credenciales y presencia de secretos heredados;
- buckets y objetos de Storage;
- salud de pg_cron y respuesta real de Edge Functions;
- compilación de las 70 Edge Functions;
- enlaces y números documentales;
- árbol de dependencias productivas y `npm audit --omit=dev`.

## Resultado medido

| Superficie | Evidencia al 2026-08-28 | Estado |
|---|---|---|
| Git | remoto alineado, worktree limpio al iniciar | Verde |
| Migraciones | 481 archivos / 481 registradas; `db push --dry-run` sin brecha | Verde |
| Edge estática | 70 funciones pasan `npm run check:functions` | Verde |
| Documentación | 61 enlaces internos en 38 documentos; 1 número sin fecha corregido | Verde |
| RLS | 0 tablas públicas sin RLS; policies sin tenant, índices tenant, settings faltantes y stock negativo en 0 | Verde |
| Secretos heredados | 0 valores en las siete columnas de credenciales antiguas de `settings`; 0 webhooks y 0 transportistas con secreto | Verde hoy; falta retirar columnas muertas |
| Storage | 25 backups privados, 52 imágenes de producto y 2 de marketing; Finance privado y vacío. `expense-receipts` era público pero tiene 0 objetos | Amarillo: privatizar antes del primer comprobante |
| Cron | 25 jobs activos; 22.155 éxitos y 3 fallas en 7 días. Las tres fueron `expire-overdue-trials` y sus últimas 12 corridas ya son exitosas | Resuelto, conservar señal |
| Edge runtime | 215 invocaciones / 12 fallas en 24 h; 429 / 42 en 7 días; 0 huérfanas | Amarillo: `fetch-usd-rate` y cumpleaños no demostraron recuperación ese día |
| Pagos | 2 pagos ARS 1 anteriores a la traza; sin pérdida actual y documentados como prueba histórica | Deuda histórica, no incidente actual |
| Dependencias | `npm audit` completo: 0 alertas productivas o de tooling; comando reproducible desde moderado | Verde; `xlsx` conserva su guarda separada por venir del CDN oficial |

## Hallazgo crítico cerrado en esta auditoría

Seis RPC internas conservaban `EXECUTE` explícito para `anon` aunque las
migraciones revocaban `PUBLIC`. La diferencia importa: `PUBLIC` es el conjunto
implícito; no borra un grant directo ya asentado para un rol.

`20260828000160_las_funciones_internas_no_son_anonimas.sql` cerró:

- lectura/aplicación de cambios de precio;
- registro de consumo/costo de IA;
- registro, reconciliación y poda de telemetría Edge.

Cada función tiene ahora dos barreras: ACL exclusiva de `service_role` y guarda
interna. La prueba contra la base real ejecutó los seis ataques como anon,
conservó el camino service role, dejó `audit_costo_expuesto = 0` y 0 restos.

## Dependencias: evidencia, no reputación

`npm audit --omit=dev` encontró:

- `nanoid 3.3.16`, CVE-2026-67213 alta; parche 3.3.18;
- `DOMPurify 3.4.12`, XSS moderada; parche 3.4.13;
- React Router 6.30.4, dos vectores de redirect/XSS; la línea segura completa
  exige React Router 7.18 o posterior.

Fuentes primarias: [nanoid GHSA](https://github.com/advisories/GHSA-2v37-7h3g-55p8),
[DOMPurify GHSA](https://github.com/advisories/GHSA-55q2-fjhq-7xh7),
[React Router redirect/XSS](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2)
y [bypass por backslash](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6).

No se aplicó `npm audit fix` a ciegas: proponía React Router 6.30.6, que elimina
una alerta de `react-router-dom` pero sigue dentro del rango vulnerable de
`react-router`.

El slice posterior cerró la superficie completa:

- React Router/DOM 7.18.3, DOMPurify 3.4.14 y nanoid 3.3.18;
- Vite 8.2.2 + esbuild 0.28.2, `vite-plugin-pwa` 1.3.0 y el plugin React
  estándar 6.1.1; el engine mínimo quedó en Node 20.19, que es el contrato de
  Vite 8;
- `npm run check:dependencies` audita producción **y tooling** desde severidad
  moderada. Una vulnerabilidad del build también corre con acceso al repo y
  secretos del deploy, por lo que el chequeo reproducible no usa `--omit=dev`;
- 11 guardas fijan líneas mínimas, engine y el comando de auditoría para que una instalación
  distraída no reabra los avisos;
- la paleta Ctrl+K dejó de montarse dos veces y ahora tiene un único dueño lazy
  en `AppLayout`, sin duplicar listeners globales;
- Vitest y Vite comparten el plugin estándar, los alias usan
  `import.meta.dirname`, y el selector CSS que Vite 8 detectó como inválido fue
  reemplazado por una selección de token de clase válida;
- la puerta completa detectó una regresión propia de la migración: Rolldown
  absorbía recursivamente helpers compartidos dentro de PDF/charts y volvía a
  precargarlos en Storefront. Utils/PDF/charts/xlsx desactivan esa captura;
  React/Query/Radix/Supabase conservan su grafo para no generar ciclos de
  ejecución. Un intento demasiado agresivo dejó la tienda en el splash y el
  E2E lo rechazó antes del commit. La configuración final bajó el entry de
  185,76 a 150,45 KiB gzip y el precache de 2.025,05 a 1.986,06 KiB, sin quitar
  offline del POS ni romper la tienda.

Evidencia: `npm audit` 0, 89/89 imports de páginas, 32/32 E2E públicos en
desktop/mobile contra el bundle local de producción y build completo en 4,03 s
en la medición final. El PWA precachea 18 entradas / 1.986,06 KiB. El primer E2E con dev server tuvo 1 retry
por transformación fría (31 s, luego 3,1 s); la puerta ahora ejecuta
`build + vite preview`; la repetición final terminó sin retries en 38,2 s.
La puerta final completó typecheck, lint con 0 errores/140 warnings conocidos y
1.936/1.936 tests en 184 archivos.

⚠️ `vite-plugin-pwa` 1.3.0 —última versión instalada al corte— todavía pasa
`inlineDynamicImports` al build del service worker y Vite 8 lo marca deprecado.
El build termina y el SW se genera; es deuda upstream visible, no se parcheó
`node_modules` ni se silenció el warning.

⚠️ La credencial OAuth disponible en esta PC no tiene scope `workflow`:
GitHub rechazó el intento de elevar el job bloqueante de `critical` a
`moderate`. El workflow conserva el audit completo informativo y el repo expone
`npm run check:dependencies`; elevar esa puerta en GitHub sigue pendiente de una
credencial con permiso para editar Actions. El código y el deploy no quedaron
bloqueados por esa limitación de transporte.

## Orden de continuación

1. Privatizar `expense-receipts` antes del primer archivo y entregar URLs
   firmadas, sin romper comprobantes existentes (hoy hay 0).
2. Explicar y corregir las dos tareas Edge sin recuperación comprobada:
   cotización diaria y cumpleaños WhatsApp. No invocarlas a mano porque podrían
   enviar mensajes o duplicar acciones reales.
3. Retirar del esquema las columnas de secretos heredadas sólo cuando todas sus
   lecturas estén probadas en cero y exista migración de salida reversible.
4. Completar P1-04 con `payments.edit` para refund y prueba cross-branch cuando
   existan dos ubicaciones reales aptas.
