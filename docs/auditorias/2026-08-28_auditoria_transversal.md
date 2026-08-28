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
| Dependencias | 4 alertas productivas: 1 alta y 3 moderadas | Rojo hasta actualizar |

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
`react-router`. El siguiente slice debe subir a 7.18+, resolver las dos
transitivas y pasar smoke de las 89 páginas, E2E público, typecheck, lint, tests
y build.

## Orden de continuación

1. Dependencias productivas: cero high/moderate sin excepción documentada.
2. Privatizar `expense-receipts` antes del primer archivo y entregar URLs
   firmadas, sin romper comprobantes existentes (hoy hay 0).
3. Explicar y corregir las dos tareas Edge sin recuperación comprobada:
   cotización diaria y cumpleaños WhatsApp. No invocarlas a mano porque podrían
   enviar mensajes o duplicar acciones reales.
4. Retirar del esquema las columnas de secretos heredadas sólo cuando todas sus
   lecturas estén probadas en cero y exista migración de salida reversible.
5. Completar P1-04 con `payments.edit` para refund y prueba cross-branch cuando
   existan dos ubicaciones reales aptas.
